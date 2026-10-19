// Acesso ao SQLite (node:sqlite), criação do esquema e dados iniciais (categorias, planos, administrador).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normText, nowIso } from './util.js';
import { hashPassword } from './passwords.js';

const SCHEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const plain = (r) => (r ? { ...r } : null);

export class Db {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 15000;');
    this.cache = new Map();
    this.inTx = false;
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); if (this.cache.size > 400) this.cache.clear(); this.cache.set(sql, s); }
    return s;
  }
  /** INSERT/UPDATE/DELETE → { lastInsertRowid:number, changes:number } */
  run(sql, ...args) {
    const r = this.stmt(sql).run(...args.map(norm));
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  get(sql, ...args) { return plain(this.stmt(sql).get(...args.map(norm))); }
  all(sql, ...args) { return this.stmt(sql).all(...args.map(norm)).map((r) => ({ ...r })); }
  /** primeira coluna da primeira linha */
  val(sql, ...args) {
    const r = this.stmt(sql).get(...args.map(norm));
    return r ? Object.values(r)[0] : null;
  }
  exec(sql) { this.raw.exec(sql); }
  /** Unidade de trabalho: begin() abre; commit() confirma e reabre; finish(ok) encerra. */
  begin() { if (!this.inTx) { this.raw.exec('BEGIN IMMEDIATE'); this.inTx = true; } }
  commit() { if (this.inTx) { this.raw.exec('COMMIT'); this.inTx = false; this.begin(); } }
  rollback() { if (this.inTx) { try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ } this.inTx = false; this.begin(); } }
  finish(ok) {
    if (!this.inTx) return;
    try { this.raw.exec(ok ? 'COMMIT' : 'ROLLBACK'); } catch { try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ } }
    this.inTx = false;
  }
  close() { try { this.raw.close(); } catch { /* ignore */ } }
}

export const DEFAULT_CATEGORIES = [
  ['Eletricista', 'Instalações, reparos e manutenção elétrica residencial e comercial.'],
  ['Encanador', 'Vazamentos, instalações hidráulicas, desentupimentos e reparos.'],
  ['Pintor', 'Pintura interna e externa, textura, grafiato e acabamento.'],
  ['Pedreiro', 'Alvenaria, reformas, pisos, reboco e pequenas obras.'],
  ['Marceneiro', 'Móveis sob medida, reparos em madeira e acabamentos.'],
  ['Montador de móveis', 'Montagem e desmontagem de móveis e planejados.'],
  ['Diarista e limpeza', 'Limpeza residencial, pós-obra e conservação.'],
  ['Jardinagem', 'Poda, paisagismo, manutenção de jardins e gramados.'],
  ['Chaveiro', 'Abertura, troca e cópia de chaves e fechaduras.'],
  ['Ar-condicionado', 'Instalação, limpeza e manutenção de ar-condicionado.'],
  ['Mudanças e fretes', 'Carretos, mudanças e transporte de materiais.'],
  ['Serralheiro', 'Portões, grades, estruturas metálicas e soldas.'],
  ['Vidraceiro', 'Vidros, espelhos, box e esquadrias.'],
  ['Reparos gerais', 'Pequenos reparos domésticos e serviços variados.'],
];

export const DEFAULT_PLANS = [
  ['Mensal', 29.90, 30, ['Perfil profissional publicado', 'Serviços ilimitados', 'Chat e propostas', 'Relatórios de satisfação']],
  ['Trimestral', 79.90, 90, ['Tudo do plano Mensal', 'Economia de 11%', 'Destaque nas buscas da sua cidade']],
  ['Anual', 269.90, 365, ['Tudo do plano Mensal', 'Economia de 25%', 'Destaque nas buscas da sua cidade']],
];

export function initDb(db, cfg, log = console.log) {
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  const ts = nowIso();
  if (db.val('SELECT COUNT(*) FROM categories') === 0) {
    for (const [name, desc] of DEFAULT_CATEGORIES)
      db.run('INSERT INTO categories(name,norm_name,description,created_at) VALUES(?,?,?,?)', name, normText(name), desc, ts);
  }
  if (db.val('SELECT COUNT(*) FROM plans') === 0) {
    for (const [name, price, days, feats] of DEFAULT_PLANS)
      db.run('INSERT INTO plans(name,price,duration_days,features) VALUES(?,?,?,?)', name, price, days, JSON.stringify(feats));
  }
  if (db.val("SELECT COUNT(*) FROM users WHERE role='admin'") === 0) {
    let password = cfg.ADMIN_PASSWORD;
    if (!password) {
      if (cfg.ENV === 'production') throw new Error('Defina HANDLY_ADMIN_PASSWORD para criar o administrador em produção.');
      password = 'Admin@12345';
    }
    db.run(`INSERT INTO users(name,login,cpf,email,password_hash,city,uf,lat,lng,role,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,'admin',?,?)`,
      'Administrador Handly', cfg.ADMIN_LOGIN, '00000000000', cfg.ADMIN_EMAIL, hashPassword(password),
      'Ourinhos', 'SP', -22.9791, -49.8697, ts, ts);
    if (cfg.ENV !== 'production' && !cfg.ADMIN_PASSWORD)
      log(`[handly] administrador criado: login '${cfg.ADMIN_LOGIN}' / senha '${password}' (apenas desenvolvimento)`);
  }
}
