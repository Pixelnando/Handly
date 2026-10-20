// Regras de domínio compartilhadas: assinatura, perfil do trabalhador, agenda e cancelamento.
import { fail, notify } from './api.js';
import {
  addDateDays, addHours, addMinutes, addDays, fmtHHMM, iso, localDateStr, localMinutes, localToUtc, localWeekday,
  dateWeekday, nowIso, parseDate, parseHHMM, parseIso, utcnow, ms,
} from './util.js';

export const HOLD_STATUSES = ['aguardando_resposta', 'em_negociacao', 'agendada'];
export const OPEN_STATUSES = ['aguardando_resposta', 'em_negociacao'];
export const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

// ------------------------------------------------------------------ assinatura (RF14, RN07, RN30-RN33)
/** Atualiza o status das assinaturas pelo relógio e sincroniza o perfil profissional (RF14.11). */
export function refreshSubscriptions(db, userId = null) {
  const now = nowIso();
  const flt = userId !== null ? ' AND user_id=?' : '';
  const extra = userId !== null ? [userId] : [];
  const touched = new Set();
  const expiring = db.all(
    `SELECT id,user_id FROM subscriptions WHERE status IN ('ativa','futura') AND cancelled_at IS NULL AND end_at<=?${flt}`, now, ...extra);
  for (const s of expiring) {
    db.run("UPDATE subscriptions SET status='expirada' WHERE id=?", s.id);
    touched.add(s.user_id);
    const still = db.get("SELECT 1 AS x FROM subscriptions WHERE user_id=? AND status IN ('ativa','futura') AND id!=?", s.user_id, s.id);
    if (!still) notify(db, s.user_id, 'assinatura', 'Sua assinatura expirou',
      'Renove para voltar a prestar serviços. Seu perfil e serviços foram preservados.', '#/assinatura');
  }
  const starting = db.all(
    `SELECT id,user_id FROM subscriptions WHERE status='futura' AND cancelled_at IS NULL AND start_at<=? AND end_at>?${flt}`, now, now, ...extra);
  for (const s of starting) {
    db.run("UPDATE subscriptions SET status='ativa' WHERE id=?", s.id);
    touched.add(s.user_id);
  }
  if (userId !== null) touched.add(userId);
  for (const uid of touched) syncWorkerStatus(db, uid);
}

export function activeSubscription(db, userId) {
  refreshSubscriptions(db, userId);
  const now = nowIso();
  return db.get(
    `SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id=s.plan_id
     WHERE s.user_id=? AND s.cancelled_at IS NULL AND s.start_at<=? AND s.end_at>?
     ORDER BY s.end_at DESC LIMIT 1`, userId, now, now);
}
export const hasActiveSubscription = (db, userId) => activeSubscription(db, userId) !== null;
export const getProfile = (db, userId) => db.get('SELECT * FROM worker_profiles WHERE user_id=? AND deleted_at IS NULL', userId);

export function syncWorkerStatus(db, userId) {
  const wp = getProfile(db, userId);
  if (!wp || wp.status === 'bloqueado') return;
  const now = nowIso();
  const active = db.get('SELECT 1 AS x FROM subscriptions WHERE user_id=? AND cancelled_at IS NULL AND start_at<=? AND end_at>?', userId, now, now);
  const nw = active ? 'ativo' : 'inativo';
  if (nw !== wp.status) db.run('UPDATE worker_profiles SET status=?, updated_at=? WHERE id=?', nw, nowIso(), wp.id);
}

/** RN07/RN32: só presta serviços quem tem perfil e assinatura ativa. */
export function requireActiveWorker(db, userId) {
  const wp = getProfile(db, userId);
  if (!wp) fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 403);
  if (wp.status === 'bloqueado') fail('profile_blocked', 'Seu perfil profissional foi bloqueado pela administração.', 403);
  if (!hasActiveSubscription(db, userId))
    fail('subscription_required', 'É necessário ter uma assinatura ativa para atuar como trabalhador. Escolha um plano para continuar.', 402);
  return getProfile(db, userId);
}

// ------------------------------------------------------------------ serviços
export function loadService(db, serviceId, includeDeleted = false) {
  const svc = db.get(
    `SELECT s.*, wp.user_id AS worker_user_id, wp.status AS worker_status, wp.deleted_at AS profile_deleted_at,
            u.name AS worker_name, u.city AS worker_city, u.uf AS worker_uf, c.name AS category_name
     FROM services s JOIN worker_profiles wp ON wp.id=s.worker_id JOIN users u ON u.id=wp.user_id
     JOIN categories c ON c.id=s.category_id WHERE s.id=?`, serviceId);
  if (svc && svc.deleted_at && !includeDeleted) return null;
  return svc;
}

// ------------------------------------------------------------------ agenda (RF05, RN17, RN18, RN44, RN45)
export function windowsFor(db, service, weekday) {
  const rows = service.availability_mode === 'personalizada'
    ? db.all('SELECT start_time,end_time FROM service_availability WHERE service_id=? AND weekday=? ORDER BY start_time', service.id, weekday)
    : db.all('SELECT start_time,end_time FROM availability WHERE worker_profile_id=? AND weekday=? ORDER BY start_time', service.worker_id, weekday);
  return rows.map((r) => [parseHHMM(r.start_time), parseHHMM(r.end_time)]);
}

export function noticeBounds(ctx, service, now) {
  const lo = ctx.cfg.TEST_MODE ? now : addHours(now, service.min_notice_hours || ctx.cfg.DEFAULT_MIN_NOTICE_HOURS);
  const hiH = service.max_notice_hours || ctx.cfg.MAX_NOTICE_LIMIT_HOURS;
  return [lo, addHours(now, hiH)];
}

/** Valida disponibilidade, antecedência e conflito. Lança ApiError se inválido. */
export function checkSlot(ctx, service, start, end, excludeRequestId = null) {
  const db = ctx.db;
  const now = utcnow();
  if (localDateStr(start) !== localDateStr(end) || end <= start)
    fail('outside_availability', 'O horário escolhido precisa terminar no mesmo dia em que começa.', 409);
  const sMin = localMinutes(start), eMin = localMinutes(end);
  if (!windowsFor(db, service, localWeekday(start)).some(([ws, we]) => ws <= sMin && eMin <= we))
    fail('unavailable', 'O trabalhador não está disponível neste dia e horário.', 409);
  const [lo, hi] = noticeBounds(ctx, service, now);
  if (start < lo) {
    const h = service.min_notice_hours || ctx.cfg.DEFAULT_MIN_NOTICE_HOURS;
    fail('min_notice', `Este serviço exige antecedência mínima de ${h} hora(s) para agendamento.`, 409);
  }
  if (start > hi) fail('max_notice', 'A data escolhida excede a antecedência máxima permitida para este serviço.', 409);
  let sql = `SELECT 1 AS x FROM requests WHERE worker_id=? AND status IN ('aguardando_resposta','em_negociacao','agendada')
             AND scheduled_start < ? AND scheduled_end > ?`;
  const args = [service.worker_user_id, iso(end), iso(start)];
  if (excludeRequestId) { sql += ' AND id != ?'; args.push(excludeRequestId); }
  if (db.get(sql, ...args)) fail('conflict', 'O trabalhador já possui outro serviço ou solicitação neste horário.', 409);
}

export function freeSlots(ctx, service, dateStr) {
  const d = parseDate(dateStr);
  if (!d) fail('invalid_date', 'Data inválida.', 400);
  const now = utcnow();
  const [lo, hi] = noticeBounds(ctx, service, now);
  const dur = service.avg_duration_min;
  const step = ctx.cfg.SLOT_STEP_MIN;
  const dayStart = localToUtc(dateStr, '00:00');
  const busy = ctx.db.all(
    `SELECT scheduled_start s, scheduled_end e FROM requests WHERE worker_id=?
     AND status IN ('aguardando_resposta','em_negociacao','agendada') AND scheduled_start < ? AND scheduled_end > ?`,
    service.worker_user_id, iso(addDays(dayStart, 1)), iso(dayStart)).map((b) => [parseIso(b.s), parseIso(b.e)]);
  const out = [];
  for (const [ws, we] of windowsFor(ctx.db, service, dateWeekday(dateStr))) {
    for (let t = ws; t + dur <= we; t += step) {
      const start = localToUtc(dateStr, fmtHHMM(t));
      const end = addMinutes(start, dur);
      if (lo <= start && start <= hi && !busy.some(([bs, be]) => bs < end && be > start))
        out.push({ start: fmtHHMM(t), end: fmtHHMM(t + dur) });
    }
  }
  return out;
}

export function calendarDays(ctx, service, days = 30) {
  const today = localDateStr(utcnow());
  const out = [];
  for (let i = 0; i < days; i++) {
    const ds = addDateDays(today, i);
    out.push({ date: ds, free: freeSlots(ctx, service, ds).length });
  }
  return out;
}

// ------------------------------------------------------------------ cancelamento (RN42, RN43, RF07.5)
export function cancelEval(cfg, req, byClient, now = null) {
  now = now || utcnow();
  const st = req.status;
  if (st === 'concluida') return { allowed: false, code: 'completed', reason: 'Solicitações concluídas não podem ser canceladas.' };
  if (['cancelada', 'recusada', 'expirada'].includes(st)) return { allowed: false, code: 'closed', reason: 'Esta solicitação já foi encerrada.' };
  const start = parseIso(req.scheduled_start);
  if (now >= start) return { allowed: false, code: 'started', reason: 'O horário agendado já começou; o cancelamento não é mais possível.' };
  let feePct = 0.0, feeAmt = 0.0;
  if (st === 'agendada') {
    const deadline = addHours(start, -cfg.CANCEL_DEADLINE_HOURS);
    if (now > deadline)
      return { allowed: false, code: 'deadline', reason: `O prazo de cancelamento encerrou ${cfg.CANCEL_DEADLINE_HOURS}h antes do início do serviço.` };
    if (byClient && now > addHours(start, -cfg.CANCEL_FEE_WINDOW_HOURS)) {
      feePct = req.cancellation_fee_percent || 0.0;
      feeAmt = Math.round((req.agreed_value || req.base_value) * feePct) / 100;
    }
  }
  return { allowed: true, fee_percent: feePct, fee_amount: feeAmt };
}

/** Solicitações sem acordo cujo horário já passou viram 'expirada' (libera a agenda). */
export function expireRequests(db) {
  const now = nowIso();
  const ids = db.all("SELECT id FROM requests WHERE status IN ('aguardando_resposta','em_negociacao') AND scheduled_start<=?", now).map((r) => r.id);
  for (const rid of ids) {
    db.run("UPDATE requests SET status='expirada', updated_at=? WHERE id=?", now, rid);
    db.run("UPDATE proposals SET status='expirada', responded_at=? WHERE request_id=? AND status='pendente'", now, rid);
  }
  return ids.length;
}

export function ratingStats(db, workerUserId) {
  const r = db.get('SELECT AVG(rating) a, COUNT(*) c FROM reviews WHERE worker_id=? AND hidden=0', workerUserId);
  return { avg: r.a !== null ? Math.round(r.a * 100) / 100 : null, count: r.c };
}

export function jsonLoad(s, def = null) {
  try { return s ? JSON.parse(s) : def; } catch { return def; }
}
export { ms };
