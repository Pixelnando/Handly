// Fábrica da aplicação Handly: banco, rotas, servidor HTTP, jobs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ApiError } from './api.js';
import { loadConfig, ROOT } from './config.js';
import { Db, initDb } from './db.js';
import { parseCookies, parseMultipart, readBody, serializeCookie } from './http-utils.js';
import { startJobs } from './jobs.js';
import { Router } from './router.js';
import { nowIso, setClock } from './util.js';
import { tick } from './jobs.js';

import adminR from './routes/admin.js';
import authR from './routes/auth.js';
import catalogR from './routes/catalog.js';
import chatR from './routes/chat.js';
import notificationsR from './routes/notifications.js';
import reportsR from './routes/reports.js';
import requestsR from './routes/requests.js';
import reviewsR from './routes/reviews.js';
import searchR from './routes/search.js';
import servicesR from './routes/services.js';
import subscriptionsR from './routes/subscriptions.js';
import usersR from './routes/users.js';
import verificationR from './routes/verification.js';
import workersR from './routes/workers.js';

const MAX_BODY = 12 * 1024 * 1024;
const API_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const errBody = (code, message, extra = {}) => ({ error: { code, message, ...extra } });

function findIndexHtml(cfg) {
  const candidates = [cfg.INDEX_HTML, path.join(ROOT, 'index.html'), path.join(ROOT, 'public', 'index.html')].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
  throw new Error('index.html (frontend) não encontrado em ' + ROOT);
}

export function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const logs = [];
  const log = (m) => { if (!cfg.QUIET) console.log(m); logs.push(m); if (logs.length > 200) logs.shift(); };
  const db = new Db(cfg.DB_PATH);
  initDb(db, cfg, log);

  const router = new Router();
  for (const mod of [authR, usersR, workersR, catalogR, servicesR, searchR, requestsR, chatR, reviewsR, subscriptionsR, verificationR, notificationsR, reportsR, adminR]) mod(router);

  if (cfg.TEST_HOOKS) { // somente para a suíte de testes (HANDLY_TEST_HOOKS=1): relógio simulado e rodada dos jobs
    router.post('/dev/clock', (ctx) => { setClock(ctx.body.now ? new Date(ctx.body.now) : null); return { status: 200, json: { ok: true } }; });
    router.post('/dev/tick', (ctx) => { tick(ctx.db); return { status: 200, json: { ok: true } }; });
  }

  const html = findIndexHtml(cfg);
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  const pageCsp = `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${hashes}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

  const app = { cfg, db, log, logs, router, queue: Promise.resolve(), server: null, stopJobs: null };

  /** Serializa o acesso ao banco: uma unidade de trabalho por vez (consistência, RNF05.4). */
  app.exclusive = (fn) => {
    const run = async () => {
      db.begin();
      try { const v = await fn(); db.finish(true); return v; } catch (e) { db.finish(false); throw e; }
    };
    const p = app.queue.then(run, run);
    app.queue = p.then(() => {}, () => {});
    return p;
  };

  const secHeaders = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

  function send(res, status, headers, payload) {
    res.writeHead(status, { ...secHeaders, ...headers, 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }
  const sendJson = (res, status, obj, headers = {}) => send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Security-Policy': API_CSP, 'Cache-Control': 'no-store', ...headers }, JSON.stringify(obj));

  async function handleApi(req, res, url) {
    const t0 = performance.now();
    const method = req.method;
    let rawBody = Buffer.alloc(0);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try { rawBody = await readBody(req, MAX_BODY); } catch (e) {
        return sendJson(res, e.code === 'too_large' ? 413 : 400, errBody(e.code === 'too_large' ? 'too_large' : 'bad_request', e.code === 'too_large' ? 'Arquivo ou requisição grande demais.' : 'Requisição inválida.'));
      }
    }
    const out = await app.exclusive(() => {
      const setCookies = [];
      const ctx = {
        app, cfg, db, log, req, method, path: url.pathname, args: url.searchParams, params: {}, headers: req.headers,
        cookies: parseCookies(req.headers.cookie), rawBody, userLoaded: false, user: null, sessionExpired: false, sessionId: null,
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
        setCookie: (name, value, o = {}) => setCookies.push(serializeCookie(name, value, { secure: cfg.COOKIE_SECURE, ...o })),
        clearCookie: (name) => setCookies.push(serializeCookie(name, '', { secure: cfg.COOKIE_SECURE, expire: true })),
        multipart: () => { try { return parseMultipart(rawBody, req.headers['content-type']); } catch { return { fields: {}, files: {} }; } },
        body: {},
      };
      let routeLabel = '(desconhecida)', result;
      const finishResult = (r) => r;
      const run = async () => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.headers['x-requested-with'] !== 'XMLHttpRequest')
          throw new ApiError('csrf', 'Requisição inválida.', 400); // defesa CSRF: o front sempre envia este cabeçalho
        if (rawBody.length && /json/i.test(req.headers['content-type'] || '')) {
          try { const b = JSON.parse(rawBody.toString('utf8')); ctx.body = b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { ctx.body = {}; }
        }
        const m = router.match(method, url.pathname.replace(/^\/api/, '') || '/');
        if (!m) throw new ApiError('not_found', 'Recurso não encontrado.', 404);
        if (m.methodNotAllowed) throw new ApiError('method_not_allowed', 'Método não permitido.', 405);
        routeLabel = '/api' + m.route.pattern;
        ctx.params = m.params;
        return finishResult(await m.route.handler(ctx));
      };
      return run().then((r) => { result = r; }, (e) => {
        if (e instanceof ApiError) result = { status: e.status, json: errBody(e.code, e.message, e.extra) };
        else if (e && /constraint|SQLITE_CONSTRAINT/i.test(String(e.message))) { log(`Integridade: ${e.message}`); result = { status: 409, json: errBody('integrity', 'Operação conflita com dados existentes.') }; }
        else { log(`Erro não tratado em ${method} ${url.pathname}: ${e && e.stack || e}`); result = { status: 500, json: errBody('server_error', 'Ocorreu um erro inesperado. Tente novamente em instantes.') }; }
      }).then(() => {
        // unidade de trabalho: sucesso confirma, erro desfaz
        if (result.status >= 400) db.rollback(); else db.commit();
        try {
          db.run('INSERT INTO request_log(ts,method,route,status,duration_ms,user_id) VALUES(?,?,?,?,?,?)', nowIso(), method, routeLabel, result.status,
            Math.round((performance.now() - t0) * 100) / 100, ctx.user ? ctx.user.id : null);
        } catch { /* telemetria nunca derruba a resposta */ }
        return { result, setCookies };
      });
    });
    const { result, setCookies } = out;
    const headers = { ...(result.headers || {}) };
    if (setCookies.length) headers['Set-Cookie'] = setCookies;
    if (result.raw) return send(res, result.status, { 'Content-Type': result.contentType, 'Content-Security-Policy': API_CSP, 'Cache-Control': 'no-store', ...headers }, result.raw);
    return sendJson(res, result.status, result.json, headers);
  }

  app.handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if ((url.pathname === '/' || url.pathname === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp, 'Cache-Control': 'no-cache' }, req.method === 'HEAD' ? '' : html);
      }
      if (url.pathname === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, 'ok');
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
    } catch (e) {
      log(`Falha ao atender requisição: ${e && e.stack || e}`);
      if (!res.headersSent) sendJson(res, 500, errBody('server_error', 'Ocorreu um erro inesperado. Tente novamente em instantes.'));
      else res.end();
    }
  };

  app.listen = (port = cfg.PORT, host = cfg.HOST) => new Promise((resolve, reject) => {
    app.server = http.createServer(app.handler);
    app.server.on('error', reject);
    app.server.listen(port, host, () => resolve(app.server.address()));
  });
  app.start = () => { if (cfg.JOBS) app.stopJobs = startJobs(app); };
  app.close = async () => {
    if (app.stopJobs) app.stopJobs();
    await app.queue;
    if (app.server) await new Promise((r) => app.server.close(r));
    db.close();
  };
  return app;
}
