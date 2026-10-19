// RF09 / UC05 — avaliação de serviços concluídos.
import { audit, fail, login, notify, ok, pageArgs, toInt, track } from '../api.js';
import { ratingStats } from '../domain.js';
import { cleanStr, ms, nowIso, parseIso, utcnow } from '../util.js';

function parseReview(d) {
  const rating = toInt(d.rating);
  if (rating === null || rating < 1 || rating > 5) fail('validation', 'Informe a nota de satisfação.', 422, { fields: { rating: 'Informe uma nota de 1 a 5.' } }); // RF09.9
  return { rating, comment: cleanStr(d.comment, 1000) };
}
const canEdit = (cfg, rv) => utcnow() - parseIso(rv.created_at) <= cfg.REVIEW_EDIT_DAYS * ms.DAY;

export default function routes(r) {
  r.post('/requests/:rid/review', login((ctx) => {
    const { db, user: u } = ctx, rid = ctx.params.rid;
    const rq = db.get('SELECT * FROM requests WHERE id=?', rid);
    if (!rq || rq.client_id !== u.id) fail('not_found', 'Solicitação não encontrada.', 404);
    if (rq.status !== 'concluida') fail('not_completed', 'A avaliação só pode ser feita após a conclusão do serviço.', 409); // RN15
    if (db.get('SELECT 1 AS x FROM reviews WHERE request_id=?', rid)) fail('already_reviewed', 'Este serviço já foi avaliado. Você pode editar a avaliação existente.', 409);
    const { rating, comment } = parseReview(ctx.body);
    const ts = nowIso();
    const id = db.run('INSERT INTO reviews(request_id,client_id,worker_id,service_id,category_id,rating,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      rid, u.id, rq.worker_id, rq.service_id, rq.category_id, rating, comment || null, ts, ts).lastInsertRowid;
    track(ctx, 'avaliacao', { workerId: rq.worker_id, categoryId: rq.category_id });
    notify(db, rq.worker_id, 'avaliacao', 'Você recebeu uma avaliação', `Nota ${rating} em “${rq.service_name}”.`, '#/relatorios');
    audit(ctx, 'avaliacao.criacao', 'review', id);
    return ok({ message: 'Avaliação registrada. Obrigado!', id, stats: ratingStats(db, rq.worker_id) }, 201);
  }));

  r.put('/reviews/:rvid', login((ctx) => {
    const { db, user } = ctx, rvid = ctx.params.rvid;
    const rv = db.get('SELECT * FROM reviews WHERE id=?', rvid);
    if (!rv || rv.client_id !== user.id) fail('not_found', 'Avaliação não encontrada.', 404);
    if (rv.hidden) fail('review_locked', 'Esta avaliação foi removida pela moderação e não pode ser editada.', 403);
    if (!canEdit(ctx.cfg, rv)) fail('edit_not_allowed', `A avaliação só pode ser alterada em até ${ctx.cfg.REVIEW_EDIT_DAYS} dias após o registro.`, 403);
    const { rating, comment } = parseReview(ctx.body);
    db.run('UPDATE reviews SET rating=?, comment=?, updated_at=? WHERE id=?', rating, comment || null, nowIso(), rvid);
    audit(ctx, 'avaliacao.alteracao', 'review', rvid);
    return ok({ message: 'Avaliação atualizada.', stats: ratingStats(db, rv.worker_id) });
  }));

  /** RF09.3 — avaliações que o cliente já realizou. */
  r.get('/reviews/mine', login((ctx) => {
    const { db, user } = ctx;
    const { size, offset } = pageArgs(ctx, 20, 100);
    const items = db.all(`SELECT rv.id,rv.request_id,rv.rating,rv.comment,rv.created_at,rv.updated_at,rv.hidden,u.name AS worker_name,r.service_name
      FROM reviews rv JOIN users u ON u.id=rv.worker_id JOIN requests r ON r.id=rv.request_id
      WHERE rv.client_id=? ORDER BY rv.created_at DESC LIMIT ? OFFSET ?`, user.id, size, offset);
    for (const i of items) i.editable = canEdit(ctx.cfg, i) && !i.hidden;
    const total = db.val('SELECT COUNT(*) FROM reviews WHERE client_id=?', user.id);
    return ok({ items, total, message: total ? null : 'Você ainda não realizou avaliações.' });
  }));

  /** UC05 2/3b — serviços concluídos aguardando avaliação. */
  r.get('/reviews/pending', login((ctx) => {
    const items = ctx.db.all(`SELECT r.id AS request_id, r.service_name, r.completed_at, u.name AS worker_name FROM requests r
      JOIN users u ON u.id=r.worker_id WHERE r.client_id=? AND r.status='concluida'
      AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.request_id=r.id) ORDER BY r.completed_at DESC`, ctx.user.id);
    return ok({ items, message: items.length ? null : 'Não há serviços concluídos disponíveis para avaliação.' });
  }));
}
void toInt;
