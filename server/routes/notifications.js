// Notificações (RF16.8, RF14.10) e avisos de manutenção (RNF04.2).
import { admin, audit, fail, login, ok, pageArgs } from '../api.js';
import { refreshSubscriptions } from '../domain.js';
import { cleanStr, iso, nowIso, parseIsoStrict } from '../util.js';

const activeNotices = (db) => db.all('SELECT id,message,kind,starts_at,ends_at FROM maintenance_notices WHERE ends_at>=? ORDER BY starts_at', nowIso());

export default function routes(r) {
  r.get('/maintenance', (ctx) => ok({ items: activeNotices(ctx.db) }));

  /** Resumo leve para polling: mensagens novas, notificações não lidas e avisos de manutenção. */
  r.get('/summary', login((ctx) => {
    const { db, user: u } = ctx;
    refreshSubscriptions(db, u.id);
    const msgs = db.val(`SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE (c.client_id=? OR c.worker_id=?) AND m.sender_id IS NOT NULL AND m.sender_id!=? AND m.read_at IS NULL`, u.id, u.id, u.id);
    const notif = db.val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL', u.id);
    return ok({ unread_messages: msgs, unread_notifications: notif, maintenance: activeNotices(db) });
  }));

  r.get('/notifications', login((ctx) => {
    const { size, offset } = pageArgs(ctx, 20, 100);
    const items = ctx.db.all('SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', ctx.user.id, size, offset);
    return ok({ items, message: items.length ? null : 'Você não possui notificações.' });
  }));

  r.post('/notifications/read', login((ctx) => {
    let ids = ctx.body.ids;
    const { db, user } = ctx;
    if (Array.isArray(ids) && ids.length) {
      ids = ids.filter((i) => /^\d+$/.test(String(i))).map(Number);
      if (ids.length) db.run(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, nowIso(), user.id, ...ids);
    } else db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', nowIso(), user.id);
    return ok({ message: 'Notificações marcadas como lidas.' });
  }));

  // ---- administração dos avisos
  r.post('/admin/maintenance', admin((ctx) => {
    const d = ctx.body;
    const msg = cleanStr(d.message, 300);
    const kind = 'kind' in d ? d.kind : 'manutencao';
    const errs = {};
    if ([...msg].length < 5) errs.message = 'Descreva o aviso.';
    if (!['manutencao', 'indisponibilidade'].includes(kind)) errs.kind = 'Tipo inválido.';
    const starts = parseIsoStrict(d.starts_at), ends = parseIsoStrict(d.ends_at);
    if (!starts || !ends) errs.starts_at = 'Informe início e término.';
    else if (ends <= starts) errs.ends_at = 'O término deve ser posterior ao início.';
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    const id = ctx.db.run('INSERT INTO maintenance_notices(message,kind,starts_at,ends_at,created_by,created_at) VALUES(?,?,?,?,?,?)',
      msg, kind, iso(starts), iso(ends), ctx.user.id, nowIso()).lastInsertRowid;
    audit(ctx, 'manutencao.aviso', 'maintenance_notice', id);
    return ok({ message: 'Aviso publicado.', id }, 201);
  }));

  r.delete('/admin/maintenance/:nid', admin((ctx) => {
    ctx.db.run('DELETE FROM maintenance_notices WHERE id=?', ctx.params.nid);
    audit(ctx, 'manutencao.remocao', 'maintenance_notice', ctx.params.nid);
    return ok({ message: 'Aviso removido.' });
  }));
}
