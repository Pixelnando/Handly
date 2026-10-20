// Suíte de integração do Handly (Node). Cobre os fluxos principais dos requisitos: cadastro/login, trabalhador e serviços,
// agendamento e negociação, cancelamento, avaliação, assinatura, verificação, relatórios e administração.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PW, clock, H, D, makeCpf, startApp } from './helpers.js';

const reg = (o = {}) => ({ name: 'Maria Souza', login: 'maria', cpf: makeCpf(123456789), email: 'maria@teste.com', password: PW, city: 'Ourinhos', uf: 'SP', ...o });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const suite = (name, fn) => test(name, async (t) => { const c = await startApp(); try { await fn(c, t); } finally { await c.stop(); } });

// ------------------------------------------------------------------ contas (RF01, RF02, RN01–RN05, RNF02)
suite('cadastro: sucesso, senha com hash e campos obrigatórios', async (c) => {
  assert.equal((await c.anon.post('/api/auth/register', reg())).status, 201);
  const row = c.db().get("SELECT password_hash, cpf FROM users WHERE login='maria'");
  assert.ok(!row.password_hash.includes(PW) && row.password_hash.startsWith('scrypt'));
  const r = await c.anon.post('/api/auth/register', {});
  assert.equal(r.status, 422);
  for (const f of ['name', 'login', 'cpf', 'email', 'password', 'city', 'uf']) assert.ok(f in r.json.error.fields, f);
});

suite('cadastro: CPF/e-mail/senha inválidos e duplicidade (RN01/RN02)', async (c) => {
  const bad = await c.anon.post('/api/auth/register', reg({ cpf: '11111111111', email: 'x', password: 'abc' }));
  assert.deepEqual(Object.keys(bad.json.error.fields).sort(), ['cpf', 'email', 'password']);
  await c.anon.post('/api/auth/register', reg());
  const d = await c.anon.post('/api/auth/register', reg());
  assert.equal(d.status, 409);
  assert.deepEqual(Object.keys(d.json.error.fields).sort(), ['cpf', 'email', 'login']);
});

suite('defesa CSRF e rotas protegidas', async (c) => {
  const r = await fetch(c.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reg()) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'csrf');
  for (const u of ['/api/auth/me', '/api/requests', '/api/workers/search', '/api/reports']) assert.equal((await c.anon.get(u)).status, 401, u);
});

suite('login por login/e-mail, sessão, logout e bloqueio por tentativas', async (c) => {
  await c.newUser('joana');
  assert.equal((await (await c.login('joana@teste.com')).get('/api/auth/me')).json.user.login, 'joana');
  assert.equal((await c.anon.post('/api/auth/login', { identifier: 'joana', password: 'errada123' })).status, 401);
  assert.equal((await c.anon.post('/api/auth/login', {})).status, 422);
  const a = await c.login('joana');
  await a.post('/api/auth/logout');
  assert.equal((await a.get('/api/auth/me')).status, 401);
  for (let i = 0; i < 5; i++) await c.anon.post('/api/auth/login', { identifier: 'joana', password: 'x' + i });
  assert.equal((await c.anon.post('/api/auth/login', { identifier: 'joana', password: PW })).json.error.code, 'too_many_attempts');
});

suite('sessão expira por inatividade e renova ao usar (RNF02.5)', async (c) => {
  await c.newUser('joana');
  const a = await c.anon.post('/api/auth/login', { identifier: 'joana', password: PW }); // sem "lembrar"
  assert.equal(a.status, 200);
  const api = await (async () => { const x = new (c.anon.constructor)(c.base); await x.post('/api/auth/login', { identifier: 'joana', password: PW }); return x; })();
  const t = clock.now();
  for (let i = 1; i <= 3; i++) { clock.set(clock.plus(t, i * 20 * 60000)); assert.equal((await api.get('/api/auth/me')).status, 200, `passo ${i}`); }
  clock.set(clock.plus(clock.now(), 31 * 60000));
  assert.equal((await api.get('/api/auth/me')).json.error.code, 'session_expired');
});

suite('recuperação de acesso: e-mail com login e link; token expira', async (c) => {
  await c.newUser('joana');
  assert.equal((await c.anon.post('/api/auth/forgot', { identifier: 'ninguem' })).status, 404);
  const r = await c.anon.post('/api/auth/forgot', { identifier: 'joana@teste.com' });
  assert.equal(r.status, 200);
  const mail = c.db().get('SELECT * FROM outbox ORDER BY id DESC');
  assert.ok(mail.body.includes('joana') && mail.body.includes('redefinir-senha'));
  const token = new URL(r.json.dev_link.replace('/#/', '/')).searchParams.get('token');
  assert.equal((await c.anon.post('/api/auth/reset', { token, password: 'Nova12345' })).status, 200);
  assert.equal((await c.anon.post('/api/auth/login', { identifier: 'joana', password: 'Nova12345' })).status, 200);
  assert.equal((await c.anon.post('/api/auth/reset', { token, password: 'Outra12345' })).status, 400); // uso único
});

suite('conta: login/CPF imutáveis, troca de senha, exportação e exclusão (RN04/RN05, LGPD)', async (c) => {
  const a = await c.newUser('joana', 'Joana Prado');
  const r = await a.put('/api/users/me', { login: 'outro' });
  assert.ok(r.json.error.fields.login);
  assert.equal((await a.put('/api/users/me', { name: 'Joana P. Silva' })).json.user.name, 'Joana P. Silva');
  assert.ok((await a.put('/api/users/me', { new_password: 'Nova12345', current_password: 'errada' })).json.error.fields.current_password);
  assert.equal((await a.get('/api/users/me/export')).json.conta.login, 'joana');
  assert.equal((await a.post('/api/users/me/delete', { confirm: true, password: 'errada' })).status, 401);
  assert.equal((await a.post('/api/users/me/delete', { confirm: true, password: PW })).status, 200);
  const row = c.db().get("SELECT name,email,city FROM users WHERE status='excluido'");
  assert.equal(row.name, 'Usuário removido');
  assert.equal((await c.anon.post('/api/auth/login', { identifier: 'joana', password: PW })).status, 401);
});

// ------------------------------------------------------------------ trabalhador e serviços (RF03, RF04, RN06–RN13)
suite('trabalhador exige assinatura ativa e valida disponibilidade (RN07)', async (c) => {
  const a = await c.newUser('pedro', 'Pedro Alves');
  const body = { phone: '(14) 99800-1234', category_ids: [1], service_area: 'Ourinhos', radius_km: 30, availability: c.week() };
  assert.equal((await a.post('/api/workers', body)).json.error.code, 'subscription_required');
  await c.subscribe(a);
  assert.equal((await a.post('/api/workers', { ...body, availability: [{ weekday: 0, start: '10:00', end: '09:00' }] })).json.error.code, 'invalid_interval');
  assert.equal((await a.post('/api/workers', { ...body, availability: [{ weekday: 0, start: '08:00', end: '12:00' }, { weekday: 0, start: '11:00', end: '14:00' }] })).json.error.code, 'overlap');
  assert.equal((await a.post('/api/workers', body)).status, 201);
  assert.equal((await a.post('/api/workers', body)).status, 409);
});

suite('serviços: CRUD, duplicidade (RN11), antecedência (RN44/RN46) e formulário', async (c) => {
  const { api, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const s = (await api.get(`/api/services/${sid}`)).json.service;
  assert.equal(s.min_notice_hours, 2);
  const dup = await api.post('/api/services', { name: 'serviço de teste', category_id: 1, description: 'Descrição do serviço de teste.', base_rate: 90, avg_duration_min: 60, service_area: 'Ourinhos', cancellation_fee_percent: 0 });
  assert.equal(dup.json.error.code, 'duplicate_service');
  const bad = await api.post('/api/services', { name: 'Outro serviço', category_id: 1, description: 'Descrição do serviço de teste.', base_rate: 0, avg_duration_min: 5, service_area: 'Ourinhos', cancellation_fee_percent: 120, min_notice_hours: 9999 });
  assert.deepEqual(Object.keys(bad.json.error.fields).sort(), ['avg_duration_min', 'base_rate', 'cancellation_fee_percent', 'min_notice_hours']);
  const up = await api.put(`/api/services/${sid}`, { base_rate: 150, form_fields: [{ label: 'Tipo', type: 'select', options: 'A, B', required: true }] });
  assert.equal(up.json.service.base_rate, 150);
  assert.deepEqual(up.json.service.form_fields[0].options, ['A', 'B']);
  const cli = await c.newUser('cliente1', 'Cliente Um');
  const noAns = await cli.post('/api/requests', { service_id: sid, date: c.localDay(3), time: '10:00', location: 'Rua das Flores, 100' });
  assert.ok(Object.keys(noAns.json.error.fields).some((k) => k.startsWith('answers.')));
  assert.equal((await c.makeRequest(cli, sid, { answers: { [up.json.service.form_fields[0].id]: 'A' } })).answers[0].value, 'A');
});

suite('perfil público oculta telefone e profissional inativo some (RN32)', async (c) => {
  const { api } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const pid = (await api.get('/api/auth/me')).json.user.id;
  assert.equal('phone' in (await cli.get(`/api/workers/${pid}`)).json.profile, false);
  assert.equal('phone' in (await api.get(`/api/workers/${pid}`)).json.profile, true);
  await api.post('/api/subscription/cancel', { confirm: true });
  assert.equal((await cli.get(`/api/workers/${pid}`)).status, 404);
  assert.equal((await cli.get('/api/workers/search?city=Ourinhos&uf=SP')).json.total, 0);
  assert.equal((await api.post('/api/services', {})).json.error.code, 'subscription_required');
});

suite('busca: proximidade, categoria, preço e disponibilidade', async (c) => {
  await c.newWorker('perto', 'Perto Silva', { base_rate: 200 });
  await c.newWorker('longe', 'Longe Souza', { city: 'Marília', base_rate: 50 });
  const cli = await c.newUser('joana', 'Joana Prado');
  const near = (await cli.get('/api/workers/search?city=Ourinhos&uf=SP')).json;
  assert.deepEqual(near.items.map((i) => i.name), ['Perto Silva']);
  const wide = (await cli.get('/api/workers/search?city=Ourinhos&uf=SP&max_km=400&sort=preco')).json;
  assert.deepEqual(wide.items.map((i) => i.name), ['Longe Souza', 'Perto Silva']);
  assert.equal((await cli.get('/api/workers/search?category_id=2&city=Ourinhos&uf=SP')).json.total, 0);
  assert.match((await cli.get('/api/workers/search?category_id=2&city=Ourinhos&uf=SP')).json.message, /Nenhum trabalhador/);
  assert.equal((await cli.get('/api/workers/search?sort=xyz')).status, 422);
});

// ------------------------------------------------------------------ agenda e solicitações (RF05–RF07, RN17/18/42–46)
suite('horários livres respeitam disponibilidade, duração e antecedência', async (c) => {
  const { sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const r = (await cli.get(`/api/services/${sid}/slots?date=${c.localDay(3)}`)).json;
  assert.equal(r.slots[0].start, '08:00');
  assert.equal(r.slots.at(-1).end, '18:00');
  assert.equal(r.duration_min, 60);
  await c.makeRequest(cli, sid, { time: '10:00' });
  const after = (await cli.get(`/api/services/${sid}/slots?date=${c.localDay(3)}`)).json.slots.map((s) => s.start);
  assert.ok(!after.includes('10:00') && !after.includes('09:30') && after.includes('11:00'));
  assert.equal((await cli.get(`/api/services/${sid}/calendar?days=7`)).json.days.length, 7);
});

suite('solicitação: proposta + chat, validações e conflito (RN17/RN18)', async (c) => {
  const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  assert.equal((await cli.post('/api/requests', { service_id: sid })).status, 422);
  assert.equal((await cli.post('/api/requests', { service_id: sid, date: c.localDay(3), time: '03:00', location: 'Rua das Flores, 100' })).json.error.code, 'unavailable');
  assert.equal((await cli.post('/api/requests', { service_id: sid, date: c.localDay(0), time: '00:30', location: 'Rua das Flores, 100' })).status, 409);
  const req = await c.makeRequest(cli, sid);
  assert.equal(req.status, 'aguardando_resposta');
  const conv = (await cli.get(`/api/conversations/${req.conversation_id}`)).json;
  assert.equal(conv.messages[0].type, 'proposta');
  const other = await c.newUser('maria', 'Maria Souza');
  assert.equal((await c.makeRequest(other, sid).catch((e) => e.message)).includes('conflict'), true);
  assert.equal((await w.post('/api/requests', { service_id: sid })).json.error.code, 'own_service');
});

suite('negociação: contraproposta, aceite, recusa e permissões (UC10)', async (c) => {
  const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const req = await c.makeRequest(cli, sid);
  const p1 = (await cli.get(`/api/requests/${req.id}`)).json.request.proposals[0];
  assert.equal((await cli.post(`/api/proposals/${p1.id}/accept`)).status, 403); // não responde à própria
  const counter = await w.post(`/api/proposals/${p1.id}/counter`, { value: 130, date: c.localDay(4), time: '14:00', location: 'Av. Brasil, 450 - Centro' });
  assert.equal(counter.status, 200);
  let detail = (await cli.get(`/api/requests/${req.id}`)).json.request;
  assert.equal(detail.status, 'em_negociacao');
  assert.deepEqual(detail.proposals.map((p) => p.status), ['substituida', 'pendente']);
  assert.equal((await c.acceptLatest(cli, req.id)).status, 200);
  detail = (await cli.get(`/api/requests/${req.id}`)).json.request;
  assert.equal(detail.status, 'agendada');
  assert.equal(detail.agreed_value, 130);
  // recusa libera a agenda
  const req2 = await c.makeRequest(cli, sid, { days: 5 });
  const p2 = (await w.get(`/api/requests/${req2.id}`)).json.request.proposals[0];
  assert.equal((await w.post(`/api/proposals/${p2.id}/reject`)).status, 200);
  assert.equal((await w.get(`/api/requests/${req2.id}`)).json.request.status, 'recusada');
  assert.equal((await c.makeRequest(cli, sid, { days: 5 })).status, 'aguardando_resposta');
});

suite('chat: conversa, mensagens, acesso restrito (RN39) e histórico imutável (RN41)', async (c) => {
  const { sid, api: w } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const outsider = await c.newUser('maria', 'Maria Souza');
  const wid = (await w.get('/api/auth/me')).json.user.id;
  const cid = (await cli.post('/api/conversations', { worker_id: wid })).json.conversation_id;
  assert.equal((await cli.post(`/api/conversations/${cid}/messages`, { body: ' ' })).status, 422);
  await cli.post(`/api/conversations/${cid}/messages`, { body: 'Olá!' });
  assert.equal((await w.get(`/api/conversations/${cid}`)).json.messages.at(-1).body, 'Olá!');
  assert.equal((await outsider.get(`/api/conversations/${cid}`)).status, 403);
  assert.equal((await c.admin.get(`/api/conversations/${cid}`)).json.conversation.read_only, true);
  assert.throws(() => c.db().run("UPDATE messages SET body='editada'"), /histórico/);
  assert.throws(() => c.db().run('DELETE FROM messages'), /histórico/);
  assert.equal((await cli.post('/api/conversations', { worker_id: (await cli.get('/api/auth/me')).json.user.id })).status, 422);
  void sid;
});

suite('cancelamento: taxa em 24h, prazo de 2h e concluída não cancela (RN42/RN43)', async (c) => {
  const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const req = await c.makeRequest(cli, sid);
  await c.acceptLatest(w, req.id);
  const start = clock.start((await cli.get(`/api/requests/${req.id}`)).json.request);
  clock.set(clock.plus(start, -10 * H));
  assert.equal((await cli.post(`/api/requests/${req.id}/cancel`, {})).json.error.code, 'confirmation_required');
  clock.set(clock.plus(start, -1 * H));
  assert.equal((await cli.post(`/api/requests/${req.id}/cancel`, { confirm: true })).json.error.code, 'cancel_not_allowed');
  clock.set(clock.plus(start, -10 * H));
  const ok = await cli.post(`/api/requests/${req.id}/cancel`, { confirm: true, reason: 'Imprevisto' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.request.status, 'cancelada');
  assert.equal(ok.json.request.cancellation_fee_amount, 20); // 20% de R$ 100 (cancelamento a menos de 24h)
  const req2 = await c.makeRequest(cli, sid, { days: 6 });
  await c.acceptLatest(w, req2.id);
  clock.set(clock.plus(clock.start(req2), 2 * H));
  assert.equal((await w.post(`/api/requests/${req2.id}/complete`)).status, 200);
  assert.equal((await cli.post(`/api/requests/${req2.id}/cancel`, { confirm: true })).json.error.code, 'cancel_not_allowed');
});

suite('conclusão e avaliação (RN15), edição em até 7 dias e moderação (RN16)', async (c) => {
  const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const req = await c.makeRequest(cli, sid);
  await c.acceptLatest(w, req.id);
  assert.equal((await cli.post(`/api/requests/${req.id}/review`, { rating: 5 })).json.error.code, 'not_completed');
  assert.equal((await w.post(`/api/requests/${req.id}/complete`)).json.error.code, 'too_early');
  clock.set(clock.plus(clock.start(req), 2 * H));
  await w.post(`/api/requests/${req.id}/complete`);
  assert.equal((await cli.post(`/api/requests/${req.id}/review`, { rating: 9 })).status, 422);
  const rv = await cli.post(`/api/requests/${req.id}/review`, { rating: 5, comment: 'Ótimo' });
  assert.equal(rv.status, 201);
  assert.equal(rv.json.stats.avg, 5);
  assert.equal((await cli.post(`/api/requests/${req.id}/review`, { rating: 4 })).json.error.code, 'already_reviewed');
  assert.equal((await cli.put(`/api/reviews/${rv.json.id}`, { rating: 4 })).status, 200);
  const hide = await c.admin.post(`/api/admin/reviews/${rv.json.id}/hide`, { confirm: true, reason: 'Linguagem imprópria' });
  assert.equal(hide.status, 200);
  assert.equal((await cli.put(`/api/reviews/${rv.json.id}`, { rating: 3 })).json.error.code, 'review_locked');
  const wid = (await w.get('/api/auth/me')).json.user.id;
  assert.equal((await cli.get(`/api/workers/${wid}/reviews`)).json.total, 0);
});

suite('solicitações expiradas liberam a agenda', async (c) => {
  const { sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const req = await c.makeRequest(cli, sid);
  clock.set(clock.plus(clock.start(req), 60000));
  assert.equal((await cli.get(`/api/requests/${req.id}`)).json.request.status, 'expirada');
});

// ------------------------------------------------------------------ assinatura (RF14), verificação (RF15)
suite('assinatura: uma ativa (RN30), renovação nos últimos 7 dias, expiração e cancelamento', async (c) => {
  let a = await c.newUser('pedro', 'Pedro Alves');
  assert.equal((await a.get('/api/plans')).json.items.length, 3);
  assert.equal((await a.post('/api/subscription', { plan_id: 1 })).json.error.code, 'confirmation_required');
  await c.subscribe(a);
  assert.equal((await a.post('/api/subscription', { plan_id: 1, confirm: true })).json.error.code, 'subscription_active');
  assert.equal((await a.post('/api/subscription/renew', { plan_id: 1, confirm: true })).json.error.code, 'too_early_to_renew');
  clock.set(clock.plus(clock.now(), 25 * D));
  a = await c.login('pedro');
  const ren = await a.post('/api/subscription/renew', { plan_id: 1, confirm: true });
  assert.equal(ren.status, 201);
  assert.equal(ren.json.status, 'futura');
  clock.set(clock.plus(clock.now(), 10 * D));
  a = await c.login('pedro');
  assert.equal((await a.get('/api/subscription')).json.current.status, 'ativa');
  clock.set(clock.plus(clock.now(), 60 * D));
  a = await c.login('pedro');
  const s = (await a.get('/api/subscription')).json;
  assert.equal(s.current, null);
  assert.match(s.alert, /expirou/);
});

suite('verificação: aprovada, rejeitada, indisponível, arquivos e limite (RN34–RN36)', async (c) => {
  const { api: w } = await c.newWorker('pedro', 'Pedro Teste', { withService: false });
  const form = (o = {}) => {
    const f = new FormData();
    const d = { full_name: 'Pedro Teste', document_type: 'rg', document_number: '123456789', birth_date: '1990-05-10', ...o };
    for (const [k, v] of Object.entries(d)) f.append(k, v);
    f.append('document_image', new Blob([PNG]), 'doc.png'); f.append('selfie_image', new Blob([PNG]), 'selfie.png');
    return f;
  };
  assert.equal((await w.req('POST', '/api/workers/me/verification', { form: form({ document_number: 'ERRO503' }) })).json.error.code, 'provider_unavailable');
  assert.equal((await w.get('/api/workers/me')).json.profile.verification_status, 'nao_verificado');
  const bad = form(); bad.set('document_image', new Blob([Buffer.from('MZ-executavel')]), 'doc.png');
  assert.ok((await w.req('POST', '/api/workers/me/verification', { form: bad })).json.error.fields.document_image);
  const rej = await w.req('POST', '/api/workers/me/verification', { form: form({ full_name: 'Outro Nome Qualquer' }) });
  assert.equal(rej.json.approved, false);
  const okr = await w.req('POST', '/api/workers/me/verification', { form: form() });
  assert.equal(okr.json.approved, true);
  assert.equal((await w.get('/api/workers/me')).json.profile.verification_status, 'verificado');
  const dump = c.db().all('SELECT * FROM verifications').map((r) => JSON.stringify(r)).join('');
  assert.ok(!dump.includes('123456789')); // documento só mascarado
});

// ------------------------------------------------------------------ relatórios (RF10–RF13) e administração
async function reportCtx(c) {
  const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
  const cli = await c.newUser('joana', 'Joana Prado');
  const req = await c.makeRequest(cli, sid);
  await c.acceptLatest(w, req.id);
  const full = (await cli.get(`/api/requests/${req.id}`)).json.request;
  clock.set(clock.plus(clock.start(full), 2 * H));
  await w.post(`/api/requests/${req.id}/complete`);
  await cli.post(`/api/requests/${req.id}/review`, { rating: 5, comment: 'Ótimo' });
  const period = { start: c.localDay(-1), end: c.localDay(10) };
  return { w, cli, period, req };
}

suite('relatório de usuário: tela, filtros, período inválido, acesso e vazio', async (c) => {
  const { cli, w, period } = await reportCtx(c);
  const d = (await cli.post('/api/reports/usuario', period)).json.report;
  assert.equal(d.empty, false);
  assert.ok(d.sections.some((s) => s.title === 'Serviços concluídos' && s.rows.length === 1));
  assert.equal((await cli.post('/api/reports/usuario', { start: period.end, end: period.start })).json.error.code, 'invalid_period');
  assert.equal((await cli.post('/api/reports/usuario', {})).status, 422);
  assert.equal((await cli.post('/api/reports/usuario', { ...period, user_id: 1 })).status, 403);
  assert.equal((await cli.post('/api/reports/software', period)).status, 403);
  assert.equal((await w.post('/api/reports/satisfacao', period)).status, 200);
  const empty = (await cli.post('/api/reports/usuario', { start: '2020-01-01', end: '2020-01-10' })).json.report;
  assert.equal(empty.empty, true);
  assert.equal(c.db().val("SELECT COUNT(*) FROM report_logs WHERE report_type='usuario'"), 1);
});

suite('exportação: PDF, CSV (com neutralização de fórmulas) e XLSX', async (c) => {
  const { cli, period } = await reportCtx(c);
  await cli.put('/api/users/me', { name: '=SOMA(A1) Joana' });
  const pdf = await cli.post('/api/reports/usuario', { ...period, format: 'pdf' });
  assert.equal(pdf.type, 'application/pdf');
  assert.ok(pdf.buf.subarray(0, 4).toString() === '%PDF' && pdf.buf.includes('%%EOF'));
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="handly-relatorio-usuario-/);
  const csv = (await cli.post('/api/reports/usuario', { ...period, format: 'csv' })).buf.toString('utf8');
  assert.ok(csv.startsWith('﻿') && csv.includes("'=SOMA(A1) Joana") && csv.includes('Serviços concluídos'));
  assert.equal((await cli.post('/api/reports/usuario', { ...period, format: 'xlsx' })).json.error.code, 'format_not_allowed');
  const xlsx = await c.admin.post('/api/reports/software', { ...period, format: 'xlsx' });
  assert.equal(xlsx.buf.subarray(0, 2).toString(), 'PK');
  assert.ok(xlsx.buf.includes(Buffer.from('xl/workbook.xml')));
});

suite('relatório de software: métricas, confirmação > 90 dias e vazio (RN24)', async (c) => {
  await reportCtx(c);
  const d = (await c.admin.post('/api/reports/software', { start: c.localDay(-1), end: c.localDay(1), metrics: ['desempenho', 'erros'] })).json.report;
  const perf = Object.fromEntries(d.sections[0].rows);
  assert.match(perf['Tempo médio de resposta'], /ms/);
  assert.ok(d.sections.some((s) => s.title === 'Erros por código HTTP'));
  const long = await c.admin.post('/api/reports/software', { start: c.localDay(-100), end: c.localDay(1) });
  assert.equal(long.json.error.code, 'confirmation_required');
  assert.equal((await c.admin.post('/api/reports/software', { start: c.localDay(-100), end: c.localDay(1), confirm: true })).status, 200);
  assert.equal((await c.admin.post('/api/reports/software', { start: '2020-01-01', end: '2020-01-10' })).json.report.empty, true);
});

suite('relatórios de engajamento e satisfação (admin x trabalhador)', async (c) => {
  const { w, cli, period } = await reportCtx(c);
  const eng = (await c.admin.post('/api/reports/engajamento', period)).json.report;
  assert.ok(eng.summary.some(([k]) => k === 'Usuários ativos'));
  assert.equal((await c.admin.post('/api/reports/engajamento', { ...period, location: 'Narnia' })).json.report.empty, true);
  const sat = (await c.admin.post('/api/reports/satisfacao', period)).json.report;
  assert.equal(sat.summary[1][1], 1);
  const own = (await w.post('/api/reports/satisfacao', period)).json.report;
  assert.equal(own.sections.at(-1).rows[0][1], 'Joana P.'); // privacidade do cliente
  assert.equal((await cli.post('/api/reports/satisfacao', period)).status, 403);
  assert.deepEqual((await w.get('/api/reports')).json.items.map((i) => i.type), ['usuario', 'satisfacao']);
});

suite('administração: usuários, bloqueio, moderação, categorias e painel', async (c) => {
  await c.newUser('zelia', 'Zélia Souza'); await c.newUser('ana', 'Ana Souza');
  const list = (await c.admin.get('/api/admin/users?role=user')).json;
  assert.deepEqual(list.items.map((u) => u.name), ['Ana Souza', 'Zélia Souza']);
  const uid = list.items[0].id;
  assert.equal((await c.admin.post(`/api/admin/users/${uid}/block`, { confirm: true, reason: 'x' })).status, 422);
  assert.equal((await c.admin.post(`/api/admin/users/${uid}/block`, { confirm: true, reason: 'Violação das regras' })).status, 200);
  assert.equal((await c.anon.post('/api/auth/login', { identifier: 'ana', password: PW })).json.error.code, 'blocked');
  assert.equal((await c.admin.post(`/api/admin/users/${uid}/unblock`, { confirm: true })).status, 200);
  const cat = await c.admin.post('/api/admin/categories', { name: 'Dedetização', description: 'Controle de pragas' });
  assert.equal(cat.status, 201);
  assert.equal((await c.admin.post('/api/admin/categories', { name: 'dedetizacao' })).json.error.code, 'category_exists');
  assert.equal((await c.admin.delete(`/api/admin/categories/${cat.json.id}`)).json.deactivated, false);
  assert.equal((await c.admin.get('/api/admin/dashboard')).json.users, 2);
  assert.ok((await c.admin.get('/api/admin/audit')).json.total > 0);
  assert.equal((await (await c.login('ana')).get('/api/admin/dashboard')).status, 403);
  // aviso de manutenção público
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
  const now = clock.now();
  assert.equal((await c.admin.post('/api/admin/maintenance', { message: 'Manutenção programada', starts_at: iso(clock.plus(now, H)), ends_at: iso(clock.plus(now, 2 * H)) })).status, 201);
  assert.equal((await c.anon.get('/api/maintenance')).json.items.length, 1);
});

suite('front-end servido com CSP por hash e rota desconhecida em JSON', async (c) => {
  const r = await fetch(c.base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'sha256-/);
  assert.match(await r.text(), /<title>/);
  const nf = await c.anon.get('/api/nao-existe');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error.code, 'not_found');
  assert.equal((await c.anon.post('/api/categories', {})).status, 405);
});

test('modo de teste: sem antecedência mínima e conclusão imediata', async () => {
  const { startApp } = await import('./helpers.js');
  const c = await startApp();
  try {
    c.app.cfg.TEST_MODE = true;
    const { api: w, sid } = await c.newWorker('pedro', 'Pedro Alves');
    const cli = await c.newUser('joana', 'Joana Prado');
    const now = clock.now();
    const local = new Date(now.getTime() - 3 * H + 31 * 60000); // próximo meio-horário local
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes(), t = Math.ceil(mins / 30) * 30;
    const time = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const r = await cli.post('/api/requests', { service_id: sid, date: c.localDay(t >= 1440 ? 1 : 0), time, location: 'Rua das Flores, 100 - Centro' });
    assert.equal(r.status, 201, r.text());
    await c.acceptLatest(w, r.json.request.id);
    assert.equal((await w.post(`/api/requests/${r.json.request.id}/complete`)).status, 200);
    assert.equal((await cli.post(`/api/requests/${r.json.request.id}/review`, { rating: 5 })).status, 201);
  } finally { await c.stop(); }
});
