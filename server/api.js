// Convenções da API: erros JSON, autenticação por sessão, auditoria, notificações e paginação.
import crypto from 'node:crypto';
import { addMs, cleanStr, iso, nowIso, parseIso, utcnow, ms } from './util.js';

export class ApiError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code; this.status = status; this.extra = extra;
  }
}
export function fail(code, message, status = 400, extra = {}) { throw new ApiError(code, message, status, extra); }

/** Resposta JSON. */
export const ok = (data = {}, status = 200) => ({ status, json: data });

// ------------------------------------------------------------------ sessão / autenticação
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

export function createSession(ctx, userId, remember) {
  const token = newToken();
  const ts = nowIso();
  ctx.db.run('INSERT INTO sessions(user_id,token_hash,remember,created_at,last_seen_at,ip,user_agent) VALUES(?,?,?,?,?,?,?)',
    userId, hashToken(token), remember ? 1 : 0, ts, ts, ctx.ip, cleanStr(ctx.headers['user-agent'], 200));
  return token;
}

const idleLimitMs = (cfg, remember) => (remember ? cfg.SESSION_REMEMBER_DAYS * ms.DAY : cfg.SESSION_IDLE_MINUTES * ms.MIN);

/** Resolve o usuário da sessão (cookie) e aplica expiração por inatividade (RNF02.5). */
export function loadUser(ctx) {
  if (ctx.userLoaded) return ctx.user;
  ctx.userLoaded = true; ctx.user = null;
  const token = ctx.cookies[ctx.cfg.COOKIE_NAME];
  if (!token) return null;
  const db = ctx.db;
  const sess = db.get('SELECT * FROM sessions WHERE token_hash=?', hashToken(token));
  if (!sess) return null;
  const now = utcnow();
  const last = parseIso(sess.last_seen_at);
  if (now - last > idleLimitMs(ctx.cfg, sess.remember)) {
    db.run('DELETE FROM sessions WHERE id=?', sess.id);
    db.commit();
    ctx.sessionExpired = true;
    return null;
  }
  const user = db.get('SELECT * FROM users WHERE id=?', sess.user_id);
  if (!user || user.status !== 'ativo') {
    db.run('DELETE FROM sessions WHERE id=?', sess.id);
    db.commit();
    return null;
  }
  if ((now - last) / 1000 > 15) {
    db.run('UPDATE sessions SET last_seen_at=? WHERE id=?', iso(now), sess.id);
    db.commit();
  }
  ctx.sessionId = sess.id;
  ctx.user = user;
  return user;
}

export function requireUser(ctx) {
  if (!loadUser(ctx)) {
    if (ctx.sessionExpired) fail('session_expired', 'Sua sessão expirou por inatividade. Entre novamente.', 401);
    fail('unauthenticated', 'É necessário entrar para acessar este recurso.', 401);
  }
  return ctx.user;
}
export function requireAdmin(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') fail('forbidden', 'Acesso restrito a administradores.', 403);
  return ctx.user;
}
/** Envolve um handler exigindo login. */
export const login = (fn) => (ctx) => { requireUser(ctx); return fn(ctx); };
export const admin = (fn) => (ctx) => { requireAdmin(ctx); return fn(ctx); };

// ------------------------------------------------------------------ auditoria / interações / notificações
export function audit(ctx, action, entity = null, entityId = null, details = null, userId = undefined) {
  const uid = userId !== undefined ? userId : (ctx.user ? ctx.user.id : null);
  ctx.db.run('INSERT INTO audit_logs(user_id,action,entity,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)',
    uid, action, entity, entityId, details !== null && details !== undefined ? JSON.stringify(details) : null, ctx.ip, nowIso());
}
export function track(ctx, itype, { userId, categoryId = null, workerId = null, location = null } = {}) {
  const uid = userId !== undefined ? userId : (ctx.user ? ctx.user.id : null);
  ctx.db.run('INSERT INTO interactions(user_id,type,category_id,worker_id,location,ts) VALUES(?,?,?,?,?,?)',
    uid, itype, categoryId, workerId, location, nowIso());
}
export function notify(db, userId, ntype, title, bodyText = null, link = null) {
  db.run('INSERT INTO notifications(user_id,type,title,body,link,created_at) VALUES(?,?,?,?,?,?)',
    userId, ntype, title, bodyText, link, nowIso());
}

// ------------------------------------------------------------------ paginação
export function pageArgs(ctx, def = 20, max = 100) {
  let page = parseInt(ctx.args.get('page') ?? '1', 10);
  page = Number.isFinite(page) ? Math.max(1, page) : 1;
  let size = parseInt(ctx.args.get('size') ?? String(def), 10);
  size = Number.isFinite(size) ? Math.min(max, Math.max(1, size)) : def;
  return { page, size, offset: (page - 1) * size };
}

/** Python-like int() para entradas da API: lança TypeError-like retornando null se inválido. */
export function toInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return parseInt(v, 10);
  return null;
}
export { addMs };
