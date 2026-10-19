// UC24 — administração de usuários, moderação (RN16) e trilhas de auditoria.
import { admin, audit, fail, notify, ok, pageArgs, toInt } from '../api.js';
import { getProfile, ratingStats, syncWorkerStatus } from '../domain.js';
import { cleanStr, maskCpf, nowIso } from '../util.js';

const cnt = (s) => [...s].length;
const pickKeys = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));

function target(ctx, uid) {
  const u = ctx.db.get('SELECT * FROM users WHERE id=?', uid);
  if (!u || u.status === 'excluido') fail('not_found', 'Usuário não encontrado.', 404);
  if (u.id === ctx.user.id || u.role === 'admin') fail('forbidden', 'Não é permitido bloquear administradores.', 403);
  return u;
}

export default function routes(r) {
  r.get('/admin/dashboard', admin((ctx) => {
    const q = (sql, ...a) => ctx.db.val(sql, ...a);
    const now = nowIso();
    const avg = q('SELECT AVG(rating) FROM reviews WHERE hidden=0');
    return ok({
      users: q("SELECT COUNT(*) FROM users WHERE role='user' AND status='ativo'"),
      blocked_users: q("SELECT COUNT(*) FROM users WHERE status='bloqueado'"),
      workers: q('SELECT COUNT(*) FROM worker_profiles WHERE deleted_at IS NULL'),
      active_workers: q("SELECT COUNT(*) FROM worker_profiles WHERE deleted_at IS NULL AND status='ativo'"),
      verified_workers: q("SELECT COUNT(*) FROM worker_profiles WHERE deleted_at IS NULL AND verification_status='verificado'"),
      active_subscriptions: q('SELECT COUNT(*) FROM subscriptions WHERE cancelled_at IS NULL AND start_at<=? AND end_at>?', now, now),
      requests_total: q('SELECT COUNT(*) FROM requests'),
      requests_open: q("SELECT COUNT(*) FROM requests WHERE status IN ('aguardando_resposta','em_negociacao','agendada')"),
      requests_completed: q("SELECT COUNT(*) FROM requests WHERE status='concluida'"),
      reviews: q('SELECT COUNT(*) FROM reviews WHERE hidden=0'),
      avg_rating: avg !== null ? Math.round(avg * 100) / 100 : null,
      pending_category_requests: q("SELECT COUNT(*) FROM category_requests WHERE status='pendente'"),
    });
  }));

  /** RF01.5 — usuários cadastrados em ordem alfabética, com filtros (UC24 3a). */
  r.get('/admin/users', admin((ctx) => {
    const { db } = ctx, a = ctx.args;
    const { page, size, offset } = pageArgs(ctx, 25, 100);
    let sql = `SELECT u.id,u.name,u.login,u.email,u.city,u.uf,u.role,u.status,u.created_at,
      EXISTS(SELECT 1 FROM worker_profiles wp WHERE wp.user_id=u.id AND wp.deleted_at IS NULL) AS is_worker
      FROM users u WHERE u.status!='excluido'`;
    const args = [];
    const q = cleanStr(a.get('q'), 80);
    if (q) { sql += ' AND (u.name LIKE ? OR u.login LIKE ? OR u.email LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (['ativo', 'bloqueado'].includes(a.get('status'))) { sql += ' AND u.status=?'; args.push(a.get('status')); }
    if (a.get('role') === 'worker') sql += ' AND EXISTS(SELECT 1 FROM worker_profiles wp WHERE wp.user_id=u.id AND wp.deleted_at IS NULL)';
    else if (['user', 'admin'].includes(a.get('role'))) { sql += ' AND u.role=?'; args.push(a.get('role')); }
    const total = db.val(`SELECT COUNT(*) FROM (${sql})`, ...args);
    const items = db.all(`${sql} ORDER BY u.name COLLATE NOCASE LIMIT ? OFFSET ?`, ...args, size, offset);
    return ok({ items, total, page, size, message: total ? null : 'Nenhum usuário encontrado para os critérios informados.' }); // UC24 3b
  }));

  r.get('/admin/users/:uid', admin((ctx) => {
    const { db } = ctx, uid = ctx.params.uid;
    const u = db.get('SELECT * FROM users WHERE id=?', uid);
    if (!u) fail('not_found', 'Usuário não encontrado.', 404);
    const wp = getProfile(db, uid);
    const out = pickKeys(u, ['id', 'name', 'login', 'email', 'city', 'uf', 'role', 'status', 'blocked_reason', 'created_at']);
    out.cpf_masked = maskCpf(u.cpf); // dados permitidos (UC24 4)
    out.worker = wp ? { id: wp.id, status: wp.status, verification_status: wp.verification_status, rating: ratingStats(db, uid) } : null;
    out.requests_as_client = db.val('SELECT COUNT(*) FROM requests WHERE client_id=?', uid);
    out.requests_as_worker = db.val('SELECT COUNT(*) FROM requests WHERE worker_id=?', uid);
    return ok({ user: out });
  }));

  r.post('/admin/users/:uid/block', admin((ctx) => {
    const { db } = ctx, uid = ctx.params.uid, d = ctx.body;
    target(ctx, uid);
    if (!d.confirm) fail('confirmation_required', 'Confirme a operação.', 400); // UC24 6/7
    const reason = cleanStr(d.reason, 300);
    if (cnt(reason) < 5) fail('validation', 'Informe o motivo do bloqueio.', 422, { fields: { reason: 'Informe o motivo.' } });
    db.run("UPDATE users SET status='bloqueado', blocked_reason=?, updated_at=? WHERE id=?", reason, nowIso(), uid);
    db.run('DELETE FROM sessions WHERE user_id=?', uid);
    audit(ctx, 'admin.bloqueio_usuario', 'user', uid, { reason });
    return ok({ message: 'Usuário bloqueado.' });
  }));

  r.post('/admin/users/:uid/unblock', admin((ctx) => {
    const uid = ctx.params.uid;
    target(ctx, uid);
    if (!ctx.body.confirm) fail('confirmation_required', 'Confirme a operação.', 400);
    ctx.db.run("UPDATE users SET status='ativo', blocked_reason=NULL, updated_at=? WHERE id=?", nowIso(), uid);
    audit(ctx, 'admin.desbloqueio_usuario', 'user', uid);
    return ok({ message: 'Usuário desbloqueado.' });
  }));

  /** RN16 — bloqueia/desbloqueia perfil profissional que viole as políticas. */
  r.post('/admin/workers/:uid/moderate', admin((ctx) => {
    const { db } = ctx, uid = ctx.params.uid, d = ctx.body;
    const wp = getProfile(db, uid);
    if (!wp) fail('not_found', 'Perfil profissional não encontrado.', 404);
    if (!d.confirm) fail('confirmation_required', 'Confirme a operação.', 400);
    if (d.block) {
      const reason = cleanStr(d.reason, 300);
      if (cnt(reason) < 5) fail('validation', 'Informe o motivo.', 422, { fields: { reason: 'Informe o motivo.' } });
      db.run("UPDATE worker_profiles SET status='bloqueado', updated_at=? WHERE id=?", nowIso(), wp.id);
      notify(db, uid, 'moderacao', 'Seu perfil profissional foi bloqueado', reason, '#/perfil-profissional');
      audit(ctx, 'admin.bloqueio_perfil', 'worker_profile', wp.id, { reason });
      return ok({ message: 'Perfil profissional bloqueado.' });
    }
    db.run("UPDATE worker_profiles SET status='inativo', updated_at=? WHERE id=?", nowIso(), wp.id);
    syncWorkerStatus(db, uid);
    audit(ctx, 'admin.desbloqueio_perfil', 'worker_profile', wp.id);
    return ok({ message: 'Perfil profissional liberado.' });
  }));

  r.get('/admin/reviews', admin((ctx) => {
    const { db } = ctx;
    const { size, offset } = pageArgs(ctx, 25, 100);
    const hidden = ctx.args.get('hidden');
    let sql = `SELECT rv.id,rv.rating,rv.comment,rv.created_at,rv.hidden,rv.hidden_reason,cu.name AS client_name,wu.name AS worker_name,
      r.service_name FROM reviews rv JOIN users cu ON cu.id=rv.client_id JOIN users wu ON wu.id=rv.worker_id
      JOIN requests r ON r.id=rv.request_id WHERE 1=1`;
    const args = [];
    if (['0', '1'].includes(hidden)) { sql += ' AND rv.hidden=?'; args.push(Number(hidden)); }
    const total = db.val(`SELECT COUNT(*) FROM (${sql})`, ...args);
    return ok({ items: db.all(`${sql} ORDER BY rv.created_at DESC LIMIT ? OFFSET ?`, ...args, size, offset), total });
  }));

  /** RN16 — remove da vitrine avaliações que violem as políticas (preserva o registro para auditoria). */
  r.post('/admin/reviews/:rvid/hide', admin((ctx) => {
    const { db } = ctx, rvid = ctx.params.rvid, d = ctx.body;
    if (!db.get('SELECT 1 AS x FROM reviews WHERE id=?', rvid)) fail('not_found', 'Avaliação não encontrada.', 404);
    if (!d.confirm) fail('confirmation_required', 'Confirme a operação.', 400);
    const hide = 'hide' in d ? !!d.hide : true;
    const reason = cleanStr(d.reason, 300);
    if (hide && cnt(reason) < 5) fail('validation', 'Informe o motivo da remoção.', 422, { fields: { reason: 'Informe o motivo.' } });
    db.run('UPDATE reviews SET hidden=?, hidden_reason=?, hidden_by=?, hidden_at=? WHERE id=?', hide ? 1 : 0, hide ? reason : null, hide ? ctx.user.id : null, hide ? nowIso() : null, rvid);
    audit(ctx, 'admin.moderacao_avaliacao', 'review', rvid, { hide, reason });
    return ok({ message: hide ? 'Avaliação removida da exibição.' : 'Avaliação restaurada.' });
  }));

  r.get('/admin/audit', admin((ctx) => {
    const { db } = ctx, a = ctx.args;
    const { page, size, offset } = pageArgs(ctx, 50, 200);
    let sql = 'SELECT a.*, u.login AS user_login FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1';
    const args = [];
    if (a.get('action')) { sql += ' AND a.action LIKE ?'; args.push(cleanStr(a.get('action'), 60) + '%'); }
    if (/^\d+$/.test(a.get('user_id') || '')) { sql += ' AND a.user_id=?'; args.push(Number(a.get('user_id'))); }
    const total = db.val(`SELECT COUNT(*) FROM (${sql})`, ...args);
    return ok({ items: db.all(`${sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...args, size, offset), total, page, size });
  }));

  /** RN25 — geração de relatórios registrada para auditoria. */
  r.get('/admin/report-logs', admin((ctx) => {
    const { db } = ctx;
    const { size, offset } = pageArgs(ctx, 50, 200);
    const items = db.all(`SELECT rl.id,rl.report_type,rl.filters,rl.format,rl.generated_at,u.login AS user_login FROM report_logs rl
      JOIN users u ON u.id=rl.user_id ORDER BY rl.id DESC LIMIT ? OFFSET ?`, size, offset);
    return ok({ items, total: db.val('SELECT COUNT(*) FROM report_logs') });
  }));
}
void toInt;
