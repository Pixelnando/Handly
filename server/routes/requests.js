// RF05/RF06/RF07 — solicitar, agendar, consultar e cancelar serviços (UC04, UC07, UC08).
import { ApiError, audit, fail, login, notify, ok, pageArgs, toInt, track } from '../api.js';
import { addMinutes, cleanStr, iso, localToUtc, money, nowIso, parseDate, parseHHMM, parseIso, utcnow } from '../util.js';
import { PROPOSAL_SELECT, addMessage, createProposal, fmtDt, getOrCreateConversation, proposalDict, systemMessage } from '../chatlib.js';
import { cancelEval, checkSlot, expireRequests, getProfile, hasActiveSubscription, loadService } from '../domain.js';
import { toFloat } from './auth.js';

export const STATUS_LABEL = {
  aguardando_resposta: 'Aguardando resposta', em_negociacao: 'Em negociação', agendada: 'Agendada', concluida: 'Concluída',
  cancelada: 'Cancelada', recusada: 'Recusada', expirada: 'Expirada',
};

export const REQ_SQL = `SELECT r.*, cu.name AS client_name, wu.name AS worker_name, wu.city AS worker_city, wu.uf AS worker_uf,
  c.name AS category_name,
  (SELECT id FROM reviews rv WHERE rv.request_id=r.id) AS review_id,
  (SELECT rating FROM reviews rv WHERE rv.request_id=r.id) AS review_rating
  FROM requests r JOIN users cu ON cu.id=r.client_id JOIN users wu ON wu.id=r.worker_id
  LEFT JOIN categories c ON c.id=r.category_id`;

const VIEW_KEYS = ['id', 'client_id', 'worker_id', 'service_id', 'service_name', 'category_id', 'category_name', 'duration_min',
  'scheduled_start', 'scheduled_end', 'location', 'notes', 'base_value', 'agreed_value', 'status', 'cancellation_fee_percent',
  'cancellation_fee_amount', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'completed_at', 'conversation_id', 'created_at',
  'updated_at', 'client_name', 'worker_name', 'worker_city', 'worker_uf', 'review_id', 'review_rating'];

export function view(ctx, r, viewer) {
  const byClient = viewer.id === r.client_id;
  const out = {};
  for (const k of VIEW_KEYS) out[k] = r[k];
  out.status_label = STATUS_LABEL[r.status];
  out.answers = r.answers_json ? JSON.parse(r.answers_json) : [];
  out.my_role = byClient ? 'client' : (viewer.id === r.worker_id ? 'worker' : 'admin');
  out.cancel = cancelEval(ctx.cfg, r, byClient);
  out.can_review = byClient && r.status === 'concluida' && !r.review_id;
  out.can_complete = viewer.id === r.worker_id && r.status === 'agendada' && utcnow() >= parseIso(r.scheduled_start);
  return out;
}

export function loadRequest(db, rid, viewer) {
  const r = db.get(REQ_SQL + ' WHERE r.id=?', rid);
  if (!r || (![r.client_id, r.worker_id].includes(viewer.id) && viewer.role !== 'admin')) fail('not_found', 'Solicitação não encontrada.', 404); // UC07 5a
  return r;
}

// ------------------------------------------------------------------ validação de respostas do formulário (RF06.2)
export function validateAnswers(db, svc, answers) {
  answers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const out = [], errs = {};
  for (const f of db.all('SELECT * FROM service_form_fields WHERE service_id=? ORDER BY position,id', svc.id)) {
    const key = String(f.id);
    let val = answers[key];
    const opts = f.options ? JSON.parse(f.options) : [];
    const empty = val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length) || (typeof val === 'string' && !val.trim());
    if (empty) { if (f.required) errs[`answers.${key}`] = `Preencha “${f.label}”.`; continue; }
    if (f.type === 'number') {
      const n = toFloat(val);
      if (n === null) { errs[`answers.${key}`] = `“${f.label}” deve ser numérico.`; continue; }
      val = n;
    } else if (f.type === 'date') {
      if (!parseDate(String(val))) { errs[`answers.${key}`] = `“${f.label}” deve ser uma data válida.`; continue; }
    } else if (f.type === 'select' || f.type === 'radio') {
      if (!opts.includes(val)) { errs[`answers.${key}`] = `Opção inválida em “${f.label}”.`; continue; }
    } else if (f.type === 'checkbox') {
      val = Array.isArray(val) ? val : [val];
      if (val.some((v) => !opts.includes(v))) { errs[`answers.${key}`] = `Opção inválida em “${f.label}”.`; continue; }
    } else val = cleanStr(val, 1000);
    out.push({ field_id: f.id, label: f.label, value: val });
  }
  if (Object.keys(errs).length) fail('validation', 'Preencha corretamente o formulário do serviço.', 422, { fields: errs });
  return out;
}

/** Lê data+horário informados e calcula início/fim com a duração do serviço. */
export function parseWhen(d, errs, svc) {
  const date = cleanStr(d.date, 10), time = cleanStr(d.time, 5);
  if (!parseDate(date)) errs.date = 'Informe a data desejada.';
  if (parseHHMM(time) === null) errs.time = 'Informe o horário desejado.';
  if ('date' in errs || 'time' in errs) return [null, null];
  const start = localToUtc(date, time);
  return [start, addMinutes(start, svc.avg_duration_min)];
}

/** Cria a solicitação, a conversa e a proposta inicial (RF06.4–06.6). */
export function createRequestWithProposal(db, client, svc, start, end, location, notes, answers, sender, value = null, conv = null) {
  value = value === null ? svc.base_rate : value;
  conv = conv || getOrCreateConversation(db, client.id, svc.worker_user_id, svc.id);
  const ts = nowIso();
  const rid = db.run(`INSERT INTO requests(client_id,worker_id,service_id,service_name,category_id,duration_min,scheduled_start,scheduled_end,
      location,notes,answers_json,base_value,status,cancellation_fee_percent,conversation_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'aguardando_resposta',?,?,?,?)`,
    client.id, svc.worker_user_id, svc.id, svc.name, svc.category_id, svc.avg_duration_min, iso(start), iso(end), location, notes,
    answers && answers.length ? JSON.stringify(answers) : null, svc.base_rate, svc.cancellation_fee_percent, conv.id, ts, ts).lastInsertRowid;
  const pid = createProposal(db, conv.id, rid, sender.id, 'proposta', svc.id, value, iso(start), iso(end), location, notes);
  return { rid, pid, conv };
}

export default function routes(r) {
  /** UC04 — Solicitar e agendar serviço. */
  r.post('/requests', login((ctx) => {
    const { db, user: u } = ctx, d = ctx.body;
    if (u.role === 'admin') fail('forbidden', 'Administradores não contratam serviços.', 403);
    const sid = toInt(d.service_id);
    if (sid === null) fail('validation', 'Selecione um serviço.', 422, { fields: { service_id: 'Selecione um serviço.' } });
    const svc = loadService(db, sid);
    if (!svc) fail('not_found', 'Serviço não encontrado.', 404);
    if (svc.worker_user_id === u.id) fail('own_service', 'Você não pode contratar o seu próprio serviço.', 409);
    if (svc.worker_status !== 'ativo' || !hasActiveSubscription(db, svc.worker_user_id)) fail('worker_unavailable', 'Este profissional não está disponível para novas contratações.', 409); // RN32
    const errs = {};
    const location = cleanStr(d.location, 200);
    const notes = cleanStr(d.notes, 800);
    if ([...location].length < 5) errs.location = 'Informe o local de execução do serviço.';
    const [start, end] = parseWhen(d, errs, svc);
    let answers = null;
    try { answers = validateAnswers(db, svc, d.answers); } catch (e) { if (!(e instanceof ApiError)) throw e; Object.assign(errs, e.extra.fields || {}); }
    if (Object.keys(errs).length) fail('validation', 'Preencha os campos obrigatórios para enviar a solicitação.', 422, { fields: errs }); // UC04 7a / RF06.3
    checkSlot(ctx, svc, start, end); // RN17, RN18, RN44, RN45
    const { rid, conv } = createRequestWithProposal(db, u, svc, start, end, location, notes, answers, u);
    notify(db, svc.worker_user_id, 'solicitacao', 'Nova solicitação de serviço', `${u.name} solicitou “${svc.name}” para ${fmtDt(iso(start))}.`, `#/conversas/${conv.id}`);
    track(ctx, 'solicitacao', { categoryId: svc.category_id, workerId: svc.worker_user_id, location: `${u.city}/${u.uf}` });
    audit(ctx, 'solicitacao.criacao', 'request', rid, { service_id: sid });
    return ok({ message: 'Solicitação registrada e proposta enviada ao profissional.', request: view(ctx, loadRequest(db, rid, u), u), conversation_id: conv.id }, 201);
  }));

  /** RF07.1/07.2/07.8 — solicitações do cliente (role=client) ou recebidas pelo trabalhador (role=worker). */
  r.get('/requests', login((ctx) => {
    const { db, user: u } = ctx;
    expireRequests(db);
    const role = ctx.args.get('role') || 'client';
    if (!['client', 'worker'].includes(role)) fail('validation', 'Perfil inválido.', 422);
    const col = role === 'client' ? 'r.client_id' : 'r.worker_id';
    if (role === 'worker' && !getProfile(db, u.id)) fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 403);
    let sql = `${REQ_SQL} WHERE ${col}=?`;
    const args = [u.id];
    const status = ctx.args.get('status');
    if (status) {
      const sts = status.split(',').filter((s) => s in STATUS_LABEL);
      if (sts.length) { sql += ` AND r.status IN (${sts.map(() => '?').join(',')})`; args.push(...sts); }
    }
    const q = cleanStr(ctx.args.get('q'), 80);
    if (q) { sql += ' AND (r.service_name LIKE ? OR wu.name LIKE ? OR cu.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const { page, size, offset } = pageArgs(ctx, 20, 100);
    const total = db.val(`SELECT COUNT(*) FROM (${sql})`, ...args);
    const items = db.all(`${sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, ...args, size, offset);
    return ok({
      items: items.map((x) => view(ctx, x, u)), total, page, size,
      message: total ? null : (!(status || q) ? 'Você ainda não possui solicitações de serviço.' : 'Nenhuma solicitação corresponde aos critérios consultados.'),
    });
  }));

  r.get('/requests/:rid', login((ctx) => {
    const { db, user } = ctx, rid = ctx.params.rid;
    expireRequests(db);
    const rq = loadRequest(db, rid, user);
    const out = view(ctx, rq, user);
    out.proposals = db.all(`${PROPOSAL_SELECT} WHERE p.request_id=? ORDER BY p.id`, rid).map(proposalDict);
    if (rq.review_id) out.review = db.get('SELECT id,rating,comment,created_at,updated_at,hidden FROM reviews WHERE id=?', rq.review_id);
    return ok({ request: out });
  }));

  /** UC08 — cancelar respeitando prazos (RN42), nunca após concluída (RN43). */
  r.post('/requests/:rid/cancel', login((ctx) => {
    const { db, user: u } = ctx, rid = ctx.params.rid, d = ctx.body;
    expireRequests(db);
    const rq = loadRequest(db, rid, u);
    if (![rq.client_id, rq.worker_id].includes(u.id)) fail('forbidden', 'Somente os participantes podem cancelar.', 403);
    const byClient = u.id === rq.client_id;
    const ev = cancelEval(ctx.cfg, rq, byClient);
    if (!ev.allowed) fail('cancel_not_allowed', ev.reason, 409, { reason_code: ev.code }); // UC08 4a / 4b
    if (!d.confirm) fail('confirmation_required', 'Confirme o cancelamento da solicitação.', 400, { fee_amount: ev.fee_amount, fee_percent: ev.fee_percent });
    const reason = cleanStr(d.reason, 300);
    const ts = nowIso();
    db.run(`UPDATE requests SET status='cancelada', cancelled_at=?, cancelled_by=?, cancel_reason=?, cancellation_fee_amount=?, updated_at=? WHERE id=?`,
      ts, u.id, reason || null, byClient ? ev.fee_amount : 0, ts, rid);
    db.run("UPDATE proposals SET status='cancelada', responded_at=? WHERE request_id=? AND status='pendente'", ts, rid);
    let chatOk = true;
    try { // UC08 9a: falha no chat não impede o registro do cancelamento
      const who = byClient ? 'cliente' : 'profissional';
      let text = `A solicitação “${rq.service_name}” foi cancelada pelo ${who} em ${fmtDt(ts)}.`;
      if (byClient && ev.fee_amount) text += ` Taxa de cancelamento aplicável: ${money(ev.fee_amount)}.`;
      if (reason) text += ` Motivo: ${reason}`;
      if (!rq.conversation_id) throw new Error('sem conversa');
      systemMessage(db, rq.conversation_id, text);
    } catch { chatOk = false; }
    notify(db, byClient ? rq.worker_id : rq.client_id, 'cancelamento', 'Solicitação cancelada', `“${rq.service_name}” foi cancelada.`, `#/solicitacoes/${rid}`);
    audit(ctx, 'solicitacao.cancelamento', 'request', rid, { fee: ev.fee_amount, by: byClient ? 'cliente' : 'trabalhador' });
    let msg = 'Solicitação cancelada.';
    if (byClient && ev.fee_amount) msg += ` Taxa de cancelamento a combinar diretamente com o profissional: ${money(ev.fee_amount)}.`;
    if (!chatOk) msg += ' Não foi possível avisar o profissional pelo chat.';
    return ok({ message: msg, chat_notified: chatOk, request: view(ctx, loadRequest(db, rid, u), u) });
  }));

  /** O trabalhador marca o serviço como concluído (libera a avaliação do cliente — RN15). */
  r.post('/requests/:rid/complete', login((ctx) => {
    const { db, user: u } = ctx, rid = ctx.params.rid;
    const rq = loadRequest(db, rid, u);
    if (u.id !== rq.worker_id) fail('forbidden', 'Somente o profissional pode concluir o serviço.', 403);
    if (rq.status !== 'agendada') fail('invalid_status', 'Somente serviços agendados podem ser concluídos.', 409);
    if (!ctx.cfg.TEST_MODE && utcnow() < parseIso(rq.scheduled_start)) fail('too_early', 'O serviço só pode ser concluído a partir do horário agendado.', 409);
    const ts = nowIso();
    db.run("UPDATE requests SET status='concluida', completed_at=?, updated_at=? WHERE id=?", ts, ts, rid);
    if (rq.conversation_id) systemMessage(db, rq.conversation_id, `Serviço “${rq.service_name}” concluído. O cliente já pode avaliar o atendimento.`);
    notify(db, rq.client_id, 'conclusao', 'Serviço concluído', `Avalie “${rq.service_name}” com ${rq.worker_name}.`, `#/solicitacoes/${rid}`);
    audit(ctx, 'solicitacao.conclusao', 'request', rid);
    return ok({ message: 'Serviço marcado como concluído.', request: view(ctx, loadRequest(db, rid, u), u) });
  }));
}
void addMessage;
