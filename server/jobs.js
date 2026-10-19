// Rotinas em segundo plano: batimento (disponibilidade), amostras de recursos e manutenção de dados.
import fs from 'node:fs';
import os from 'node:os';
import { expireRequests, refreshSubscriptions } from './domain.js';
import { iso, utcnow } from './util.js';

function rssMb() { return Math.round((process.memoryUsage().rss / 1048576) * 10) / 10; }

/** Executa uma rodada (também chamada diretamente nos testes). Retorna o estado de CPU para a próxima. */
export function tick(db, prev = null) {
  const now = utcnow(); now.setUTCSeconds(0, 0);
  const ts = iso(now);
  db.run('INSERT OR IGNORE INTO heartbeats(ts) VALUES(?)', ts);
  const cpuNow = process.cpuUsage(), wall = Date.now();
  let pct = null;
  if (prev) {
    const used = (cpuNow.user + cpuNow.system - prev.cpu) / 1e6; // s
    pct = Math.round(Math.max(0, used / Math.max(1e-6, (wall - prev.wall) / 1000) * 100) * 10) / 10;
  }
  const load1 = os.loadavg()[0];
  db.run('INSERT OR REPLACE INTO resource_samples(ts,load1,mem_mb,cpu_pct) VALUES(?,?,?,?)', ts, load1, rssMb(), pct);
  refreshSubscriptions(db);
  expireRequests(db);
  db.commit();
  return { cpu: cpuNow.user + cpuNow.system, wall };
}

export function startJobs(app) {
  let prev = null;
  const run = () => app.exclusive(() => { try { prev = tick(app.db, prev); } catch (e) { app.log(`falha na rotina de fundo: ${e.stack || e}`); app.db.rollback(); } });
  run();
  const t = setInterval(run, app.cfg.HEARTBEAT_SECONDS * 1000);
  t.unref();
  return () => clearInterval(t);
}
void fs;
