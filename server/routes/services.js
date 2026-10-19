// RF04 — serviços ofertados (UC14), RF05 — selecionar serviço e agenda (slots).
import { audit, fail, login, ok, toInt, track } from '../api.js';
import { calendarDays, freeSlots, getProfile, loadService, ratingStats, requireActiveWorker } from '../domain.js';
import { cleanStr, fmtHHMM, has, isNil, nowIso, parseDate, pick } from '../util.js';
import { toFloat } from './auth.js';
import { validateWindows, windowsJson } from './workers.js';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cnt = (s) => [...s].length;

/** RF04.4 — formulário adicional associado ao serviço. */
function validateFormFields(items) {
  if (isNil(items) || items === '') return [];
  if (!Array.isArray(items) || items.length > 15) fail('validation', 'O formulário pode ter até 15 campos.', 422, { fields: { form_fields: 'Máximo de 15 campos.' } });
  return items.map((it, i) => {
    const label = cleanStr(isObj(it) ? it.label : null, 120);
    const ftype = isObj(it) ? it.type : null;
    if (!label || !FIELD_TYPES.includes(ftype)) fail('validation', `Campo ${i + 1} do formulário inválido (informe rótulo e tipo).`, 422, { fields: { form_fields: 'Campo inválido.' } });
    let opts = null;
    if (['select', 'radio', 'checkbox'].includes(ftype)) {
      let raw = it.options;
      if (typeof raw === 'string') raw = raw.split(',').map((x) => x.trim());
      opts = (Array.isArray(raw) ? raw : []).map((o) => cleanStr(o, 80)).filter(Boolean);
      if (opts.length < 2) fail('validation', `O campo “${label}” precisa de ao menos duas opções.`, 422, { fields: { form_fields: 'Opções insuficientes.' } });
    }
    return [label, ftype, opts && opts.length ? JSON.stringify(opts) : null, it.required ? 1 : 0, i];
  });
}

function validateService(ctx, d, current = null) {
  const { db, cfg } = ctx;
  const cur = current || {};
  const errs = {};
  const name = cleanStr(pick(d, 'name', cur.name), 100);
  const desc = cleanStr(pick(d, 'description', cur.description), 1500);
  const area = cleanStr(pick(d, 'service_area', cur.service_area), 200);
  const notes = cleanStr(pick(d, 'notes', cur.notes), 800);
  const mode = pick(d, 'availability_mode', has(cur, 'availability_mode') ? cur.availability_mode : 'perfil');
  if (cnt(name) < 3) errs.name = 'Informe o nome do serviço.';
  if (cnt(desc) < 10) errs.description = 'Descreva o serviço (mínimo de 10 caracteres).';
  if (cnt(area) < 3) errs.service_area = 'Informe a área de atendimento.';
  let cat = toInt(pick(d, 'category_id', cur.category_id));
  if (cat === null) errs.category_id = 'Selecione a categoria.';
  else if (!db.get('SELECT 1 AS x FROM categories WHERE id=? AND active=1', cat)) errs.category_id = 'Categoria indisponível.';
  let rate = toFloat(pick(d, 'base_rate', cur.base_rate));
  if (rate !== null) rate = Math.round(rate * 100) / 100;
  if (rate === null || rate <= 0 || rate > 1_000_000) { rate = null; errs.base_rate = 'Informe um valor padrão maior que zero.'; }
  let dur = toInt(pick(d, 'avg_duration_min', cur.avg_duration_min));
  if (dur === null || dur < 15 || dur > 1440) { dur = null; errs.avg_duration_min = 'Tempo médio entre 15 minutos e 24 horas.'; }
  let fee = toFloat(pick(d, 'cancellation_fee_percent', cur.cancellation_fee_percent));
  if (fee === null || fee < 0 || fee > 100) { fee = null; errs.cancellation_fee_percent = 'Informe a taxa de cancelamento (0 a 100%).'; }
  // RN44/RN46: antecedência mínima (padrão 2h) e máxima, dentro dos limites da plataforma
  const rawMin = pick(d, 'min_notice_hours', cur.min_notice_hours);
  const rawMax = pick(d, 'max_notice_hours', cur.max_notice_hours);
  let minH = isNil(rawMin) || rawMin === '' ? cfg.DEFAULT_MIN_NOTICE_HOURS : toInt(rawMin);
  if (minH === null || minH < 1 || minH > cfg.MIN_NOTICE_LIMIT_HOURS) { minH = null; errs.min_notice_hours = `Antecedência mínima entre 1 e ${cfg.MIN_NOTICE_LIMIT_HOURS} horas.`; }
  let maxH = null;
  if (!(isNil(rawMax) || rawMax === '')) {
    maxH = toInt(rawMax);
    if (maxH === null || maxH < 1 || maxH > cfg.MAX_NOTICE_LIMIT_HOURS || (minH && maxH < minH)) {
      maxH = null; errs.max_notice_hours = `Antecedência máxima entre a mínima e ${cfg.MAX_NOTICE_LIMIT_HOURS} horas.`;
    }
  }
  if (!['perfil', 'personalizada'].includes(mode)) errs.availability_mode = 'Modo de disponibilidade inválido.';
  if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
  return { name, description: desc, service_area: area, notes, category_id: cat, base_rate: rate, avg_duration_min: dur,
    cancellation_fee_percent: fee, min_notice_hours: minH, max_notice_hours: maxH, availability_mode: mode };
}

export function serializeService(db, s, withForm = true) {
  const out = {};
  for (const k of ['id', 'name', 'category_id', 'description', 'base_rate', 'avg_duration_min', 'service_area', 'availability_mode',
    'cancellation_fee_percent', 'min_notice_hours', 'max_notice_hours', 'notes', 'created_at', 'updated_at']) out[k] = s[k];
  out.category_name = s.category_name ?? null;
  if (withForm) {
    out.form_fields = db.all('SELECT * FROM service_form_fields WHERE service_id=? ORDER BY position,id', s.id).map((f) => ({
      id: f.id, label: f.label, type: f.type, options: f.options ? JSON.parse(f.options) : null, required: !!f.required }));
    if (s.availability_mode === 'personalizada')
      out.availability = db.all('SELECT weekday,start_time,end_time FROM service_availability WHERE service_id=? ORDER BY weekday,start_time', s.id)
        .map((r) => ({ weekday: r.weekday, start: r.start_time, end: r.end_time }));
  }
  return out;
}

function saveServiceChildren(db, sid, d, mode) {
  if (has(d, 'form_fields')) {
    const fields = validateFormFields(d.form_fields);
    db.run('DELETE FROM service_form_fields WHERE service_id=?', sid);
    for (const f of fields) db.run('INSERT INTO service_form_fields(service_id,label,type,options,required,position) VALUES(?,?,?,?,?,?)', sid, ...f);
  }
  if (mode === 'personalizada' && (has(d, 'availability') || !db.get('SELECT 1 AS x FROM service_availability WHERE service_id=?', sid))) {
    const wins = validateWindows(d.availability, 'availability');
    db.run('DELETE FROM service_availability WHERE service_id=?', sid);
    for (const [wd, s, e] of wins) db.run('INSERT INTO service_availability(service_id,weekday,start_time,end_time) VALUES(?,?,?,?)', sid, wd, fmtHHMM(s), fmtHHMM(e));
  }
}

function ownService(ctx, sid) {
  const svc = loadService(ctx.db, sid);
  const wp = getProfile(ctx.db, ctx.user.id);
  if (!svc || !wp || svc.worker_id !== wp.id) fail('not_found', 'Serviço não encontrado.', 404);
  return { svc, wp };
}

function publicService(ctx, sid) {
  const svc = loadService(ctx.db, sid);
  if (!svc || (svc.worker_status !== 'ativo' && ctx.user.id !== svc.worker_user_id)) fail('not_found', 'Serviço não encontrado ou profissional indisponível.', 404);
  return svc;
}

export default function routes(r) {
  r.get('/services/mine', login((ctx) => {
    const { db, user } = ctx;
    const wp = getProfile(db, user.id);
    if (!wp) fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 403);
    const items = db.all(`SELECT s.*, c.name AS category_name FROM services s JOIN categories c ON c.id=s.category_id
                          WHERE s.worker_id=? AND s.deleted_at IS NULL ORDER BY s.created_at DESC`, wp.id);
    return ok({ items: items.map((s) => serializeService(db, s, false)), message: items.length ? null : 'Você ainda não cadastrou serviços.' });
  }));

  r.post('/services', login((ctx) => {
    const { db, user } = ctx, d = ctx.body;
    const wp = requireActiveWorker(db, user.id);
    const v = validateService(ctx, d);
    if (db.get('SELECT 1 AS x FROM services WHERE worker_id=? AND lower(name)=lower(?) AND category_id=? AND deleted_at IS NULL', wp.id, v.name, v.category_id))
      fail('duplicate_service', 'Você já possui um serviço com este nome nesta categoria.', 409, { fields: { name: 'Serviço duplicado nesta categoria.' } }); // RN11
    const ts = nowIso();
    const sid = db.run(`INSERT INTO services(worker_id,name,category_id,description,base_rate,avg_duration_min,service_area,availability_mode,
        cancellation_fee_percent,min_notice_hours,max_notice_hours,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      wp.id, v.name, v.category_id, v.description, v.base_rate, v.avg_duration_min, v.service_area, v.availability_mode,
      v.cancellation_fee_percent, v.min_notice_hours, v.max_notice_hours, v.notes, ts, ts).lastInsertRowid;
    saveServiceChildren(db, sid, d, v.availability_mode);
    db.run('INSERT OR IGNORE INTO worker_categories VALUES(?,?)', wp.id, v.category_id);
    audit(ctx, 'servico.criacao', 'service', sid, { name: v.name });
    return ok({ message: 'Serviço cadastrado.', service: serializeService(db, loadService(db, sid)) }, 201);
  }));

  r.get('/services/:sid', login((ctx) => {
    const { db, user } = ctx;
    const svc = loadService(db, ctx.params.sid);
    if (!svc) fail('not_found', 'Serviço não encontrado.', 404);
    const owner = user.id === svc.worker_user_id;
    if (!owner && user.role !== 'admin' && svc.worker_status !== 'ativo') fail('profile_unavailable', 'Este profissional não está disponível no momento.', 404);
    const out = serializeService(db, svc);
    const wp = db.get('SELECT * FROM worker_profiles WHERE id=?', svc.worker_id);
    out.worker = {
      user_id: svc.worker_user_id, name: svc.worker_name, city: svc.worker_city, uf: svc.worker_uf,
      verification_status: wp.verification_status, rating: ratingStats(db, svc.worker_user_id),
      jobs_done: db.val("SELECT COUNT(*) FROM requests WHERE worker_id=? AND status='concluida'", svc.worker_user_id),
      availability: windowsJson(db, wp.id), description: wp.description };
    if (!owner) track(ctx, 'visualizacao_perfil', { workerId: svc.worker_user_id, categoryId: svc.category_id, location: `${svc.worker_city}/${svc.worker_uf}` });
    return ok({ service: out });
  }));

  r.put('/services/:sid', login((ctx) => {
    const { db, user } = ctx, d = ctx.body, sid = ctx.params.sid;
    const { svc, wp } = ownService(ctx, sid);
    requireActiveWorker(db, user.id);
    const v = validateService(ctx, d, svc);
    if (db.get('SELECT 1 AS x FROM services WHERE worker_id=? AND lower(name)=lower(?) AND category_id=? AND deleted_at IS NULL AND id!=?', wp.id, v.name, v.category_id, sid))
      fail('duplicate_service', 'Você já possui um serviço com este nome nesta categoria.', 409, { fields: { name: 'Serviço duplicado nesta categoria.' } });
    // RN13: solicitações em andamento mantêm o snapshot (valor, duração).
    db.run(`UPDATE services SET name=?,category_id=?,description=?,base_rate=?,avg_duration_min=?,service_area=?,availability_mode=?,
        cancellation_fee_percent=?,min_notice_hours=?,max_notice_hours=?,notes=?,updated_at=? WHERE id=?`,
      v.name, v.category_id, v.description, v.base_rate, v.avg_duration_min, v.service_area, v.availability_mode,
      v.cancellation_fee_percent, v.min_notice_hours, v.max_notice_hours, v.notes, nowIso(), sid);
    saveServiceChildren(db, sid, d, v.availability_mode);
    db.run('INSERT OR IGNORE INTO worker_categories VALUES(?,?)', wp.id, v.category_id);
    audit(ctx, 'servico.alteracao', 'service', sid);
    return ok({ message: 'Serviço atualizado.', service: serializeService(db, loadService(db, sid)) });
  }));

  /** Exclusão lógica: solicitações em andamento continuam vinculadas e não são canceladas (RN13). */
  r.delete('/services/:sid', login((ctx) => {
    const { db } = ctx, sid = ctx.params.sid;
    const { svc } = ownService(ctx, sid);
    db.run('UPDATE services SET deleted_at=? WHERE id=?', nowIso(), sid);
    const n = db.val("SELECT COUNT(*) FROM requests WHERE service_id=? AND status IN ('agendada','aguardando_resposta','em_negociacao')", sid);
    audit(ctx, 'servico.exclusao', 'service', sid, { name: svc.name, solicitacoes_em_andamento: n });
    let msg = 'Serviço excluído.';
    if (n) msg += ` ${n} solicitação(ões) em andamento foram mantidas.`;
    return ok({ message: msg, kept_requests: n });
  }));

  // ---- agenda do serviço (RF05.3–05.6)
  r.get('/services/:sid/slots', login((ctx) => {
    const svc = publicService(ctx, ctx.params.sid);
    const date = ctx.args.get('date') || '';
    if (!parseDate(date)) fail('invalid_date', 'Informe a data no formato AAAA-MM-DD.', 400);
    const slots = freeSlots(ctx, svc, date);
    return ok({ date, duration_min: svc.avg_duration_min, slots, message: slots.length ? null : 'Não há horários livres nesta data.' });
  }));

  r.get('/services/:sid/calendar', login((ctx) => {
    const svc = publicService(ctx, ctx.params.sid);
    let days = toInt(ctx.args.get('days') ?? '30');
    days = days === null ? 30 : Math.min(60, Math.max(1, days));
    return ok({ days: calendarDays(ctx, svc, days), duration_min: svc.avg_duration_min });
  }));
}
