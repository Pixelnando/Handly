// Envio de e-mail (RF02.4). Sem SMTP configurado, a mensagem é registrada na tabela outbox (modo simulado).
import net from 'node:net';
import tls from 'node:tls';
import { nowIso } from './util.js';

function smtpSend(cfg, to, subject, body) {
  return new Promise((resolve, reject) => {
    let sock = net.connect(cfg.SMTP_PORT, cfg.SMTP_HOST);
    let buf = '', step = 0, secure = false, resolver = null;
    const timer = setTimeout(() => done(new Error('tempo esgotado')), 10000);
    const done = (err) => { clearTimeout(timer); try { sock.destroy(); } catch { /* */ } err ? reject(err) : resolve(); };
    const fromAddr = (cfg.SMTP_FROM.match(/<([^>]+)>/) || [null, cfg.SMTP_FROM])[1];
    const readReply = () => new Promise((res) => { resolver = res; check(); });
    const check = () => {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) && resolver) {
          const code = Number(lines[i].slice(0, 3));
          buf = lines.slice(i + 1).join('\r\n');
          const r = resolver; resolver = null; r(code); return;
        }
      }
    };
    const attach = () => { sock.on('data', (d) => { buf += d.toString('utf8'); check(); }); sock.on('error', done); };
    const cmd = async (line, expect) => {
      sock.write(line + '\r\n');
      const code = await readReply();
      if (!expect.includes(code)) throw new Error(`SMTP ${code} após "${line.split(' ')[0]}"`);
    };
    attach();
    (async () => {
      step = await readReply(); if (step !== 220) throw new Error('SMTP indisponível');
      await cmd(`EHLO handly.local`, [250]);
      if (cfg.SMTP_PORT !== 465) {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, servername: cfg.SMTP_HOST });
        secure = true; buf = ''; attach();
        await cmd('EHLO handly.local', [250]);
      }
      if (cfg.SMTP_USER) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(cfg.SMTP_USER).toString('base64'), [334]);
        await cmd(Buffer.from(cfg.SMTP_PASSWORD).toString('base64'), [235]);
      }
      await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
      const msg = [`From: ${cfg.SMTP_FROM}`, `To: ${to}`, `Subject: ${enc(subject)}`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
        Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')].join('\r\n');
      await cmd(msg + '\r\n.', [250]);
      await cmd('QUIT', [221]).catch(() => {});
      void secure;
    })().then(() => done(), done);
  });
}

/** Registra na outbox. Sem SMTP é simulado (síncrono); com SMTP envia em segundo plano e atualiza o status. */
export function sendEmail(ctx, toEmail, subject, body) {
  const { cfg, db } = ctx;
  if (!cfg.SMTP_HOST) {
    ctx.log(`E-mail simulado para ${toEmail} | ${subject}`);
    db.run('INSERT INTO outbox(to_email,subject,body,status,error,created_at) VALUES(?,?,?,?,?,?)', toEmail, subject, body, 'simulado', null, nowIso());
    return true;
  }
  const id = db.run('INSERT INTO outbox(to_email,subject,body,status,error,created_at) VALUES(?,?,?,?,?,?)', toEmail, subject, body, 'enviado', null, nowIso()).lastInsertRowid;
  // Envio assíncrono: se falhar (UC03 6a), o status passa a "falhou" por meio da fila exclusiva.
  smtpSend(cfg, toEmail, subject, body).catch((exc) => {
    ctx.app.exclusive(() => {
      ctx.app.db.run("UPDATE outbox SET status='falhou', error=? WHERE id=?", String(exc.message || exc).slice(0, 300), id);
    });
  });
  return true;
}
