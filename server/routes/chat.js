// RF16 / UC09 / UC10 — chat, propostas e contrapropostas.
import { audit, fail, login, notify, ok, toInt, track } from '../api.js';
import { PROPOSAL_SELECT, addMessage, createProposal, fmtDt, getOrCreateConversation, proposalDict, systemMessage } from '../chatlib.js';
import { checkSlot, expireRequests, getProfile, hasActiveSubscription, loadService } from '../domain.js';
import { cleanStr, iso, money, nowIso, parseIso } from '../util.js';
import { toFloat } from './auth.js';
import { createRequestWithProposal, parseWhen } from './requests.js';

function loadConv(db, cid, viewer) {
  const c = db.get(`SELECT cv.*, cu.name AS client_name, wu.name AS worker_name, s.name AS service_name FROM conversations cv
    JOIN users cu ON cu.id=cv.client_id JOIN users wu ON wu.id=cv.worker_id LEFT JOIN services s ON s.id=cv.service_id WHERE cv.id=?`, cid);
  if (!c) fail('conversation_unavailable', 'Conversa não disponível.', 404); // UC09 4b
  const participant = [c.client_id, c.worker_id].includes(viewer.id);
  if (!participant && viewer.role !== 'admin') fail('forbidden', 'Você não tem acesso a esta conversa.', 403); // RN39
  c.is_participant = participant;
  return c;
}
const otherOf = (c, uid) => (uid === c.client_id ? c.worker_id : c.client_id);

function proposalFor(db, pid, u) {
  const p = db.get('SELECT * FROM proposals WHERE id=?', pid);
  if (!p) fail('not_found', 'Proposta não encontrada.', 404);
  const c = loadConv(db, p.conversation_id, u);
  if (!c.is_participant) fail('forbidden', 'Somente os participantes podem responder a propostas.', 403); // UC10 9a
  const req = db.get('SELECT * FROM requests WHERE id=?', p.request_id);
  return { p, c, req };
}

function proposalConditions(d, svcRow, errs) {
  let value = toFloat(d.value);
  if (value !== null) value = Math.round(value * 100) / 100;
  if (value === null || !(value > 0 && value <= 1_000_000)) { value = null; errs.value = 'Informe um valor maior que zero.'; }
  const location = cleanStr(d.location, 200);
  if ([...location].length < 5) errs.location = 'Informe o local do serviço.';
  const [start, end] = parseWhen(d, errs, svcRow);
  return { value, location, notes: cleanStr(d.notes, 800), start, end };
}

export default function routes(r) {
  r.get('/conversations', login((ctx) => {
    const { db, user: u } = ctx;
    const items = db.all(`SELECT cv.id, cv.client_id, cv.worker_id, cv.service_id, cu.name AS client_name, wu.name AS worker_name, s.name AS service_name,
        (SELECT body FROM messages m WHERE m.conversation_id=cv.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT created_at FROM messages m WHERE m.conversation_id=cv.id ORDER BY m.id DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=cv.id AND m.sender_id IS NOT NULL AND m.sender_id!=? AND m.read_at IS NULL) AS unread
      FROM conversations cv JOIN users cu ON cu.id=cv.client_id JOIN users wu ON wu.id=cv.worker_id
      LEFT JOIN services s ON s.id=cv.service_id
      WHERE cv.client_id=? OR cv.worker_id=? ORDER BY last_at DESC, cv.id DESC`, u.id, u.id, u.id);
    for (const c of items) {
      c.other_name = u.id === c.client_id ? c.worker_name : c.client_name;
      c.other_id = otherOf(c, u.id);
      c.my_role = u.id === c.client_id ? 'client' : 'worker';
    }
    return ok({ items, message: items.length ? null : 'Você ainda não possui conversas.' });
  }));

  /** RF16.1 — cliente ou trabalhador inicia conversa (RN37/RN38). */
  r.post('/conversations', login((ctx) => {
    const { db, user: u } = ctx, d = ctx.body;
    if (u.role === 'admin') fail('forbidden', 'Administradores não iniciam conversas.', 403);
    const bad = () => fail('validation', 'Identificador inválido.', 422);
    let workerId, clientId, svc = null;
    if (d.service_id) {
      const sid = toInt(d.service_id); if (sid === null) bad();
      svc = loadService(db, sid);
      if (!svc) fail('not_found', 'Serviço não encontrado.', 404);
      workerId = svc.worker_user_id; clientId = u.id;
    } else if (d.worker_id) {
      workerId = toInt(d.worker_id); if (workerId === null) bad();
      clientId = u.id;
    } else if (d.client_id) {
      if (!getProfile(db, u.id)) fail('forbidden', 'Somente trabalhadores podem iniciar conversa com um cliente.', 403);
      workerId = u.id; clientId = toInt(d.client_id); if (clientId === null) bad();
    } else fail('validation', 'Informe com quem deseja conversar.', 422);
    if (workerId === clientId) fail('validation', 'Você não pode iniciar uma conversa consigo mesmo.', 422);
    const wp = getProfile(db, workerId);
    const other = db.get('SELECT id,status,role FROM users WHERE id=?', u.id === workerId ? clientId : workerId);
    if (!wp || !other || other.status !== 'ativo' || other.role === 'admin') fail('not_found', 'Usuário não disponível para conversa.', 404);
    if (u.id !== workerId && wp.status !== 'ativo') fail('worker_unavailable', 'Este profissional não está disponível no momento.', 409);
    const conv = getOrCreateConversation(db, clientId, workerId, svc ? svc.id : null);
    track(ctx, 'mensagem', { workerId, categoryId: svc ? svc.category_id : null });
    return ok({ conversation_id: conv.id }, 201);
  }));

  r.get('/conversations/:cid', login((ctx) => {
    const { db, user: u } = ctx, cid = ctx.params.cid;
    expireRequests(db);
    const c = loadConv(db, cid, u);
    const after = toInt(ctx.args.get('after') ?? '0') ?? 0;
    if (c.is_participant) // RF16.7: marca como lidas ao abrir
      db.run('UPDATE messages SET read_at=? WHERE conversation_id=? AND sender_id IS NOT NULL AND sender_id!=? AND read_at IS NULL', nowIso(), cid, u.id);
    else audit(ctx, 'chat.acesso_administrativo', 'conversation', cid); // RN39
    const msgs = db.all(`SELECT m.id,m.sender_id,m.type,m.body,m.proposal_id,m.created_at,m.read_at,u.name AS sender_name
      FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.id>? ORDER BY m.id`, cid, after);
    const props = {};
    const pids = msgs.filter((m) => m.proposal_id).map((m) => m.proposal_id);
    if (pids.length) for (const p of db.all(`${PROPOSAL_SELECT} WHERE p.id IN (${pids.map(() => '?').join(',')})`, ...pids)) props[p.id] = proposalDict(p);
    for (const m of msgs) m.proposal = props[m.proposal_id] ?? null;
    const openReq = db.get("SELECT id,status,service_name FROM requests WHERE conversation_id=? AND status IN ('aguardando_resposta','em_negociacao','agendada') ORDER BY id DESC LIMIT 1", cid);
    return ok({
      conversation: {
        id: c.id, client_id: c.client_id, worker_id: c.worker_id, client_name: c.client_name, worker_name: c.worker_name,
        service_id: c.service_id, service_name: c.service_name,
        my_role: u.id === c.client_id ? 'client' : (u.id === c.worker_id ? 'worker' : 'admin'),
        read_only: !c.is_participant, open_request: openReq,
      },
      messages: msgs,
    });
  }));

  r.post('/conversations/:cid/messages', login((ctx) => {
    const { db, user: u } = ctx, cid = ctx.params.cid;
    const c = loadConv(db, cid, u);
    if (!c.is_participant) fail('forbidden', 'Somente os participantes podem enviar mensagens.', 403);
    const text = cleanStr(ctx.body.body, 2000);
    if (!text) fail('validation', 'Digite uma mensagem antes de enviar.', 422, { fields: { body: 'Mensagem vazia.' } }); // UC09 6a
    const other = db.get('SELECT status FROM users WHERE id=?', otherOf(c, u.id));
    if (!other || other.status !== 'ativo') fail('conversation_unavailable', 'O outro participante não está mais disponível.', 409);
    const mid = addMessage(db, cid, u.id, 'texto', text);
    track(ctx, 'mensagem', { workerId: c.worker_id });
    return ok({ id: mid, created_at: nowIso() }, 201);
  }));

  // ---- propostas (UC10)
  /** Envia uma proposta pelo chat. Cria uma solicitação se não houver negociação em aberto. */
  r.post('/conversations/:cid/proposals', login((ctx) => {
    const { db, user: u } = ctx, cid = ctx.params.cid, d = ctx.body;
    const c = loadConv(db, cid, u);
    if (!c.is_participant) fail('forbidden', 'Somente os participantes podem enviar propostas.', 403);
    const sid = c.service_id || d.service_id;
    if (!sid) fail('validation', 'Selecione o serviço da proposta.', 422, { fields: { service_id: 'Selecione o serviço.' } });
    const sidN = toInt(sid);
    const svc = sidN === null ? null : loadService(db, sidN);
    if (!svc || svc.worker_user_id !== c.worker_id) fail('not_found', 'Serviço não encontrado para este profissional.', 404);
    if (svc.worker_status !== 'ativo' || !hasActiveSubscription(db, c.worker_id)) fail('worker_unavailable', 'Este profissional não está disponível para novas contratações.', 409);
    expireRequests(db);
    if (db.get("SELECT 1 AS x FROM requests WHERE conversation_id=? AND status IN ('aguardando_resposta','em_negociacao')", cid))
      fail('negotiation_open', 'Já existe uma negociação em aberto nesta conversa. Responda ou envie uma contraproposta.', 409);
    const errs = {};
    const { value, location, notes, start, end } = proposalConditions(d, svc, errs);
    if (Object.keys(errs).length) fail('validation', 'Preencha os dados da proposta.', 422, { fields: errs }); // UC10 5a
    checkSlot(ctx, svc, start, end);
    const client = db.get('SELECT * FROM users WHERE id=?', c.client_id);
    const { rid, pid } = createRequestWithProposal(db, client, svc, start, end, location, notes, null, u, value, c);
    notify(db, otherOf(c, u.id), 'proposta', 'Nova proposta recebida', `${money(value)} — ${fmtDt(iso(start))}`, `#/conversas/${cid}`);
    audit(ctx, 'proposta.envio', 'proposal', pid);
    return ok({ request_id: rid, proposal_id: pid }, 201);
  }));

  r.post('/proposals/:pid/counter', login((ctx) => {
    const { db, user: u } = ctx, pid = ctx.params.pid;
    expireRequests(db);
    const { p, c, req } = proposalFor(db, pid, u);
    if (p.status !== 'pendente') fail('proposal_closed', 'Esta proposta já foi respondida ou não está mais ativa.', 409);
    if (p.sender_id === u.id) fail('forbidden', 'Você não pode responder à sua própria proposta.', 403);
    const svc = loadService(db, p.service_id, true);
    const errs = {};
    const { value, location, notes, start, end } = proposalConditions(ctx.body, { avg_duration_min: req.duration_min }, errs);
    if (Object.keys(errs).length) fail('validation', 'Preencha os dados da contraproposta.', 422, { fields: errs });
    checkSlot(ctx, svc, start, end, req.id);
    const ts = nowIso();
    db.run("UPDATE proposals SET status='substituida', responded_at=? WHERE id=?", ts, pid);
    const npid = createProposal(db, c.id, req.id, u.id, 'contraproposta', p.service_id, value, iso(start), iso(end), location, notes, pid);
    db.run("UPDATE requests SET status='em_negociacao', scheduled_start=?, scheduled_end=?, location=?, updated_at=? WHERE id=?", iso(start), iso(end), location, ts, req.id);
    notify(db, p.sender_id, 'proposta', 'Contraproposta recebida', `${money(value)} — ${fmtDt(iso(start))}`, `#/conversas/${c.id}`);
    audit(ctx, 'proposta.contraproposta', 'proposal', npid);
    return ok({ proposal_id: npid });
  }));

  r.post('/proposals/:pid/accept', login((ctx) => {
    const { db, user: u } = ctx, pid = ctx.params.pid;
    expireRequests(db);
    const { p, c, req } = proposalFor(db, pid, u);
    if (p.status !== 'pendente') fail('proposal_closed', 'Esta proposta já foi respondida ou não está mais ativa.', 409);
    if (p.sender_id === u.id) fail('forbidden', 'Você não pode aceitar a sua própria proposta.', 403);
    if (!hasActiveSubscription(db, c.worker_id)) fail('subscription_inactive', 'O profissional está sem assinatura ativa e não pode firmar novas contratações.', 409); // RN32
    const svc = loadService(db, p.service_id, true);
    checkSlot(ctx, svc, parseIso(p.scheduled_start), parseIso(p.scheduled_end), req.id);
    const ts = nowIso();
    db.run("UPDATE proposals SET status='aceita', responded_at=? WHERE id=?", ts, pid);
    db.run("UPDATE requests SET status='agendada', agreed_value=?, scheduled_start=?, scheduled_end=?, location=?, notes=?, updated_at=? WHERE id=?",
      p.value, p.scheduled_start, p.scheduled_end, p.location, p.notes, ts, req.id);
    systemMessage(db, c.id, `Proposta aceita. Condições acordadas: ${money(p.value)}, ${fmtDt(p.scheduled_start)}, em ${p.location}.`);
    notify(db, p.sender_id, 'proposta', 'Proposta aceita', `“${req.service_name}” agendado para ${fmtDt(p.scheduled_start)}.`, `#/solicitacoes/${req.id}`);
    audit(ctx, 'proposta.aceite', 'proposal', pid, { value: p.value });
    return ok({ message: 'Proposta aceita. As condições acordadas foram registradas.', request_id: req.id });
  }));

  r.post('/proposals/:pid/reject', login((ctx) => {
    const { db, user: u } = ctx, pid = ctx.params.pid;
    const { p, c, req } = proposalFor(db, pid, u);
    if (p.status !== 'pendente') fail('proposal_closed', 'Esta proposta já foi respondida ou não está mais ativa.', 409);
    if (p.sender_id === u.id) fail('forbidden', 'Você não pode recusar a sua própria proposta.', 403);
    const ts = nowIso();
    db.run("UPDATE proposals SET status='recusada', responded_at=? WHERE id=?", ts, pid);
    db.run("UPDATE requests SET status='recusada', updated_at=? WHERE id=? AND status IN ('aguardando_resposta','em_negociacao')", ts, req.id);
    systemMessage(db, c.id, `Proposta recusada por ${u.name}. A negociação foi encerrada.`);
    notify(db, p.sender_id, 'proposta', 'Proposta recusada', `“${req.service_name}”`, `#/conversas/${c.id}`);
    audit(ctx, 'proposta.recusa', 'proposal', pid);
    return ok({ message: 'Proposta recusada.' });
  }));

  /** RF16.12 — histórico de propostas e contrapropostas da conversa. */
  r.get('/conversations/:cid/proposals', login((ctx) => {
    loadConv(ctx.db, ctx.params.cid, ctx.user);
    return ok({ items: ctx.db.all(`${PROPOSAL_SELECT} WHERE p.conversation_id=? ORDER BY p.id`, ctx.params.cid).map(proposalDict) });
  }));
}
