#!/usr/bin/env node
// Ponto de entrada: node server/index.js [--demo] [--port 5000]
import { createApp } from './app.js';
import { seedDemo } from './demo.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

const overrides = {};
if (opt('--port')) overrides.PORT = Number(opt('--port'));
if (opt('--db')) overrides.DB_PATH = opt('--db');

const app = createApp(overrides);
if (flag('--demo') || process.env.HANDLY_DEMO === '1') {
  await app.exclusive(() => seedDemo(app.db, app.log));
}
const addr = await app.listen();
app.start();
console.log(`\n  Handly rodando em http://localhost:${addr.port}\n  (Ctrl+C para parar)\n`);

const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
