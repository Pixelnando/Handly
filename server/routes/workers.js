// RF03 (perfil de trabalhador), UC18/UC19 (perfil e disponibilidade) e perfil público.
import { ApiError, audit, fail, login, ok, pageArgs, toInt, track } from '../api.js';
import { WEEKDAYS, getProfile, hasActiveSubscription, ratingStats, syncWorkerStatus } from '../domain.js';
import { cleanStr, fmtHHMM, has, localMinutes, localWeekday, nowIso, parseHHMM, parseIso, pick, validPhone } from '../util.js';

// ------------------------------------------------------------------ validação de janelas de horário
/** Valida lista [{weekday,start,end}] (RF03.9, UC19): início<fim e sem sobreposição no mesmo dia. */
export function validateWindows(items, field = 'availability', required = true) {
  if (!Array.isArray(items)) fail('validation', 'Informe a disponibilidade de atendimento.', 422, { fields: { [field]: 'Informe a disponibilidade.' } });
  const out = [];
  for (const it of items) {
    const wd = it && typeof it === 'object' ? toInt(it.weekday) : null;
    if (wd === null) fail('validation', 'Dia da semana inválido.', 422, { fields: { [field]: 'Dia da semana inválido.' } });
    const s = parseHHMM(it.start), e = parseHHMM(it.end);
    if (!(wd >= 0 && wd < 7) || s === null || e === null) fail('validation', 'Horário inválido. Use HH:MM.', 422, { fields: { [field]: 'Horário inválido.' } });
    if (s >= e) fail('invalid_interval', `Intervalo inválido em ${WEEKDAYS[wd]}: o horário inicial deve ser anterior ao final.`, 422, { fields: { [field]: 'O horário inicial deve ser anterior ao final.' } });
    out.push([wd, s, e]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    if (a[0] === b[0] && b[1] < a[2]) fail('overlap', `Há períodos sobrepostos em ${WEEKDAYS[a[0]]}. Ajuste os horários.`, 422, { fields: { [field]: 'Períodos sobrepostos.' } });
  }
  if (required && !out.length) fail('validation', 'Informe ao menos um período de disponibilidade.', 422, { fields: { [field]: 'Informe a disponibilidade.' } });
  return out;
}

export const windowsJson = (db, pid) => db.all('SELECT weekday,start_time,end_time FROM availability WHERE worker_profile_id=? ORDER BY weekday,start_time', pid)
  .map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time }));
export const categoriesOf = (db, pid) => db.all('SELECT c.id,c.name FROM categories c JOIN worker_categories wc ON wc.category_id=c.id WHERE wc.worker_profile_id=? ORDER BY c.name', pid);

export function checkCategoryIds(db, ids) {
  if (!Array.isArray(ids) || !ids.length) fail('validation', 'Selecione ao menos uma categoria de serviço.', 422, { fields: { category_ids: 'Selecione ao menos uma categoria.' } });
  const nums = ids.map(toInt);
  if (nums.includes(null)) fail('validation', 'Categoria inválida.', 422, { fields: { category_ids: 'Categoria inválida.' } });
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  const found = db.all(`SELECT id FROM categories WHERE active=1 AND id IN (${uniq.map(() => '?').join(',')})`, ...uniq);
  if (found.length !== uniq.length) fail('validation', 'Uma das categorias não existe ou está desativada.', 422, { fields: { category_ids: 'Categoria indisponível.' } });
  return uniq;
}

export function profileFields(d, errs, current = null) {
  const cur = current || {};
  const phone = cleanStr(pick(d, 'phone', cur.phone), 20);
  const desc = cleanStr(pick(d, 'description', cur.description), 1000);
  const area = cleanStr(pick(d, 'service_area', cur.service_area), 200);
  let radius = toInt(pick(d, 'radius_km', has(cur, 'radius_km') ? cur.radius_km : 20));
  if (!validPhone(phone)) errs.phone = 'Informe um telefone válido com DDD.';
  if ([...area].length < 3) errs.service_area = 'Informe a área de atendimento.';
  if (radius === null || radius < 1 || radius > 300) { errs.radius_km = 'Raio de atendimento entre 1 e 300 km.'; radius = 20; }
  return { phone, desc, area, radius };
}

export function serializeProfile(db, wp, withPrivate = true) {
  const u = db.get('SELECT name,city,uf,lat,lng FROM users WHERE id=?', wp.user_id);
  const out = {
    id: wp.id, user_id: wp.user_id, name: u.name, city: u.city, uf: u.uf, description: wp.description, service_area: wp.service_area,
    radius_km: wp.radius_km, status: wp.status, verification_status: wp.verification_status, verified_at: wp.verified_at,
    categories: categoriesOf(db, wp.id), rating: ratingStats(db, wp.user_id), availability: windowsJson(db, wp.id),
    created_at: wp.created_at, updated_at: wp.updated_at,
    jobs_done: db.val("SELECT COUNT(*) FROM requests WHERE worker_id=? AND status='concluida'", wp.user_id),
  };
  if (withPrivate) out.phone = wp.phone;
  return out;
}

export function reviewsFor(db, workerUserId, limit, offset) {
  return db.all(`SELECT r.id,r.rating,r.comment,r.created_at,r.updated_at,u.name AS client_name,s.name AS service_name
    FROM reviews r JOIN users u ON u.id=r.client_id LEFT JOIN services s ON s.id=r.service_id
    WHERE r.worker_id=? AND r.hidden=0 ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, workerUserId, limit, offset);
}

const noProfile = () => fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 404);
const insertWindows = (db, pid, windows) => { for (const [wd, s, e] of windows) db.run('INSERT INTO availability(worker_profile_id,weekday,start_time,end_time) VALUES(?,?,?,?)', pid, wd, fmtHHMM(s), fmtHHMM(e)); };

export default function routes(r) {
  /** UC13 — Inscrever-se como trabalhador (RN06, RN07, RN08). */
  r.post('/workers', login((ctx) => {
    const { db, user: u } = ctx, d = ctx.body;
    if (u.role === 'admin') fail('forbidden', 'Administradores não podem atuar como trabalhadores.', 403);
    if (getProfile(db, u.id)) fail('already_worker', 'Você já possui um perfil de trabalhador.', 409);
    if (!hasActiveSubscription(db, u.id)) fail('subscription_required', 'É necessário possuir uma assinatura ativa para se inscrever como trabalhador.', 402);
    const errs = {};
    const { phone, desc, area, radius } = profileFields(d, errs);
    let catIds = [];
    try { catIds = checkCategoryIds(db, d.category_ids); } catch (e) { if (e instanceof ApiError) Object.assign(errs, e.extra.fields || {}); else throw e; }
    let windows = [];
    try { windows = validateWindows(d.availability); } catch (e) {
      if (e instanceof ApiError) { if (['invalid_interval', 'overlap'].includes(e.code)) throw e; Object.assign(errs, e.extra.fields || {}); } else throw e;
    }
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    const ts = nowIso();
    const pid = db.run(`INSERT INTO worker_profiles(user_id,phone,description,service_area,radius_km,status,created_at,updated_at) VALUES(?,?,?,?,?,'ativo',?,?)`,
      u.id, phone, desc, area, radius, ts, ts).lastInsertRowid;
    for (const c of catIds) db.run('INSERT INTO worker_categories VALUES(?,?)', pid, c);
    insertWindows(db, pid, windows);
    audit(ctx, 'trabalhador.cadastro', 'worker_profile', pid);
    return ok({ message: 'Perfil profissional criado.', profile: serializeProfile(db, getProfile(db, u.id)) }, 201);
  }));

  r.get('/workers/me', login((ctx) => {
    const { db, user } = ctx;
    if (!getProfile(db, user.id)) noProfile();
    syncWorkerStatus(db, user.id);
    return ok({ profile: serializeProfile(db, getProfile(db, user.id)) });
  }));

  r.put('/workers/me', login((ctx) => {
    const { db, user } = ctx, d = ctx.body;
    const wp = getProfile(db, user.id);
    if (!wp) noProfile();
    if (has(d, 'cpf') && ![null, '', user.cpf].includes(d.cpf)) fail('validation', 'O CPF vinculado à conta não pode ser alterado no perfil profissional.', 422, { fields: { cpf: 'O CPF não pode ser alterado.' } });
    const errs = {};
    const { phone, desc, area, radius } = profileFields(d, errs, wp);
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    if (has(d, 'category_ids')) {
      const catIds = checkCategoryIds(db, d.category_ids);
      db.run('DELETE FROM worker_categories WHERE worker_profile_id=?', wp.id);
      for (const c of catIds) db.run('INSERT INTO worker_categories VALUES(?,?)', wp.id, c);
    }
    db.run('UPDATE worker_profiles SET phone=?,description=?,service_area=?,radius_km=?,updated_at=? WHERE id=?', phone, desc, area, radius, nowIso(), wp.id);
    audit(ctx, 'trabalhador.alteracao', 'worker_profile', wp.id);
    return ok({ message: 'Perfil atualizado.', profile: serializeProfile(db, getProfile(db, user.id)) });
  }));

  /** UC19 — definir períodos por dia; não cancela solicitações já registradas (8a). */
  r.put('/workers/me/availability', login((ctx) => {
    const { db, user } = ctx;
    const wp = getProfile(db, user.id);
    if (!wp) noProfile();
    const windows = validateWindows(ctx.body.availability);
    db.run('DELETE FROM availability WHERE worker_profile_id=?', wp.id);
    insertWindows(db, wp.id, windows);
    db.run('UPDATE worker_profiles SET updated_at=? WHERE id=?', nowIso(), wp.id);
    let outside = 0;
    for (const rq of db.all("SELECT scheduled_start,scheduled_end FROM requests WHERE worker_id=? AND status='agendada' AND scheduled_start>?", user.id, nowIso())) {
      const a = parseIso(rq.scheduled_start), b = parseIso(rq.scheduled_end);
      const sm = localMinutes(a), em = localMinutes(b), wd = localWeekday(a);
      if (!windows.some((w) => w[0] === wd && w[1] <= sm && em <= w[2])) outside++;
    }
    audit(ctx, 'trabalhador.disponibilidade', 'worker_profile', wp.id);
    let msg = 'Disponibilidade atualizada.';
    if (outside) msg += ` Atenção: ${outside} serviço(s) já agendado(s) estão fora dos novos horários e foram mantidos.`;
    return ok({ message: msg, availability: windowsJson(db, wp.id), kept_outside: outside });
  }));

  /** RN10 / UC18 2b–2e — exclusão com confirmação; bloqueada se há serviços em andamento. */
  r.delete('/workers/me', login((ctx) => {
    const { db, user } = ctx;
    const wp = getProfile(db, user.id);
    if (!wp) noProfile();
    if (!ctx.body.confirm) fail('confirmation_required', 'Confirme a exclusão do perfil profissional.', 400);
    const n = db.val("SELECT COUNT(*) FROM requests WHERE worker_id=? AND status IN ('agendada','aguardando_resposta','em_negociacao')", user.id);
    if (n) fail('has_active_requests', 'Existem solicitações em andamento vinculadas ao seu perfil. Conclua ou cancele antes de excluí-lo.', 409, { count: n });
    const ts = nowIso();
    db.run("UPDATE worker_profiles SET deleted_at=?, status='inativo', updated_at=? WHERE id=?", ts, ts, wp.id);
    db.run('UPDATE services SET deleted_at=? WHERE worker_id=? AND deleted_at IS NULL', ts, wp.id);
    audit(ctx, 'trabalhador.exclusao', 'worker_profile', wp.id);
    return ok({ message: 'Perfil profissional excluído.' });
  }));

  // ------------------------------------------------------------------ perfil público (RF05.2, RF09.5/09.6)
  r.get('/workers/:user_id', login((ctx) => {
    const { db, user: u } = ctx;
    const userId = ctx.params.user_id;
    let wp = getProfile(db, userId);
    if (!wp) fail('not_found', 'Perfil de trabalhador não encontrado.', 404);
    syncWorkerStatus(db, userId);
    wp = getProfile(db, userId);
    const owner = u.id === userId || u.role === 'admin';
    if (!owner && wp.status !== 'ativo') fail('profile_unavailable', 'Este profissional não está disponível no momento.', 404);
    const prof = serializeProfile(db, wp, owner);
    prof.services = db.all(`SELECT s.id,s.name,s.description,s.base_rate,s.avg_duration_min,s.category_id,c.name AS category_name,s.service_area,
        s.min_notice_hours,s.max_notice_hours,s.cancellation_fee_percent
      FROM services s JOIN categories c ON c.id=s.category_id WHERE s.worker_id=? AND s.deleted_at IS NULL ORDER BY s.name`, wp.id);
    const rates = prof.services.map((s) => s.base_rate);
    prof.avg_rate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100 : null;
    prof.reviews = reviewsFor(db, userId, 5, 0);
    if (u.id !== userId) track(ctx, 'visualizacao_perfil', { workerId: userId, categoryId: prof.categories.length ? prof.categories[0].id : null, location: `${prof.city}/${prof.uf}` });
    return ok({ profile: prof });
  }));

  r.get('/workers/:user_id/reviews', login((ctx) => {
    const { db } = ctx;
    const { page, size, offset } = pageArgs(ctx, 10, 50);
    const uid = ctx.params.user_id;
    const total = db.val('SELECT COUNT(*) FROM reviews WHERE worker_id=? AND hidden=0', uid);
    return ok({ items: reviewsFor(db, uid, size, offset), total, page, stats: ratingStats(db, uid), message: total ? null : 'Este profissional ainda não possui avaliações.' });
  }));
}
