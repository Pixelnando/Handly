// Infraestrutura dos testes: app isolada por teste (processo único), cliente HTTP com cookie e atalhos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setClock, utcnow, localDateStr, addDateDays, parseIso, addMs } from '../server/util.js';

export const PW = 'Senha123';
let cpfCounter = 500000000;
export function makeCpf(n) {
  const base = String(n).padStart(9, '0').split('').map(Number);
  for (const size of [9, 10]) { const s = base.reduce((a, d, i) => a + d * (size + 1 - i), 0); base.push(((s * 10) % 11) % 10); }
  return base.join('');
}

export class Api {
  constructor(base) { this.base = base; this.cookies = {}; }
  async req(method, url, { json, form, headers } = {}) {
    const h = { 'X-Requested-With': 'XMLHttpRequest', ...(headers || {}) };
    let body;
    if (form) body = form;
    else if (json !== undefined && method !== 'GET') { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.Cookie = ck;
    const r = await fetch(this.base + url, { method, body, headers: h });
    for (const c of r.headers.getSetCookie()) {
      const [nv] = c.split(';'); const i = nv.indexOf('=');
      if (/Max-Age=0/.test(c)) delete this.cookies[nv.slice(0, i)]; else this.cookies[nv.slice(0, i)] = nv.slice(i + 1);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, buf, type, json: type.includes('json') ? JSON.parse(buf.toString('utf8')) : null, text: () => buf.toString('utf8') };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, json = {}, o = {}) { return this.req('POST', u, { json, ...o }); }
  put(u, json = {}) { return this.req('PUT', u, { json }); }
  delete(u, json = {}) { return this.req('DELETE', u, { json }); }
}

export async function startApp() {
  setClock(null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handly-'));
  const app = createApp({ DB_PATH: path.join(dir, 't.db'), JOBS: false, QUIET: true });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const ctx = { app, base, dir, anon: new Api(base) };
  ctx.login = async (ident, password = PW) => { const a = new Api(base); const r = await a.post('/api/auth/login', { identifier: ident, password, remember: true }); if (r.status !== 200) throw new Error(`login ${ident}: ${r.text()}`); return a; };
  ctx.admin = await ctx.login('admin', 'Admin@12345');
  ctx.newUser = async (login, name, city = 'Ourinhos', uf = 'SP') => {
    cpfCounter += 7;
    const r = await ctx.anon.post('/api/auth/register', { name: name || `${login[0].toUpperCase()}${login.slice(1)} Teste`, login, cpf: makeCpf(cpfCounter), email: `${login}@teste.com`, password: PW, city, uf });
    if (r.status !== 201) throw new Error(r.text());
    return ctx.login(login);
  };
  ctx.subscribe = async (api, plan = 1) => { const r = await api.post('/api/subscription', { plan_id: plan, confirm: true }); if (r.status !== 201) throw new Error(r.text()); };
  ctx.week = (s = '08:00', e = '18:00') => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: s, end: e }));
  ctx.newWorker = async (login, person, { city = 'Ourinhos', uf = 'SP', categoryId = 1, withService = true, ...svc } = {}) => {
    const api = await ctx.newUser(login, person, city, uf);
    await ctx.subscribe(api);
    let r = await api.post('/api/workers', { phone: '(14) 99800-1234', category_ids: [categoryId], description: 'Profissional de teste', service_area: `${city} e região`, radius_km: 30, availability: ctx.week() });
    if (r.status !== 201) throw new Error(r.text());
    let sid = null;
    if (withService) {
      r = await api.post('/api/services', { name: 'Serviço de teste', category_id: categoryId, description: 'Descrição do serviço de teste.', base_rate: 100, avg_duration_min: 60, service_area: `${city} e região`, cancellation_fee_percent: 20, ...svc });
      if (r.status !== 201) throw new Error(r.text());
      sid = r.json.service.id;
    }
    return { api, sid };
  };
  ctx.localDay = (ahead) => addDateDays(localDateStr(utcnow()), ahead);
  ctx.makeRequest = async (client, sid, { days = 3, time = '10:00', ...extra } = {}) => {
    const r = await client.post('/api/requests', { service_id: sid, date: ctx.localDay(days), time, location: 'Rua das Flores, 100 - Centro', ...extra });
    if (r.status !== 201) throw new Error(r.text());
    return r.json.request;
  };
  ctx.acceptLatest = async (worker, rid) => {
    const req = (await worker.get(`/api/requests/${rid}`)).json.request;
    const pend = req.proposals.filter((p) => p.status === 'pendente').at(-1);
    return worker.post(`/api/proposals/${pend.id}/accept`);
  };
  ctx.db = () => app.db;
  ctx.stop = async () => { setClock(null); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return ctx;
}
export const clock = { set: (d) => setClock(d), now: () => utcnow(), start: (req) => parseIso(req.scheduled_start), plus: (d, ms) => addMs(d, ms) };
export const H = 3600000, D = 86400000;
