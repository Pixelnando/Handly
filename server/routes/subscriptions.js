// RF14 / UC12 — planos e assinatura (RN07, RN30–RN33).
// O pagamento é simulado: ao confirmar a contratação o sistema registra o valor do plano.
// Para cobrança real, integre um gateway em create() antes do INSERT.
import { audit, fail, login, notify, ok, toInt } from '../api.js';
import { activeSubscription, refreshSubscriptions, syncWorkerStatus } from '../domain.js';
import { addDays, iso, ms, nowIso, parseIso, utcnow } from '../util.js';

const RENEW_WINDOW_DAYS = 7;
const planDict = (p) => ({ id: p.id, name: p.name, price: p.price, duration_days: p.duration_days, features: JSON.parse(p.features), active: !!p.active });
const p2 = (n) => String(n).padStart(2, '0');

function create(ctx, renewing) {
  const { db, user: u } = ctx, d = ctx.body;
  if (u.role === 'admin') fail('forbidden', 'Administradores não possuem assinatura.', 403);
  const pid = toInt(d.plan_id);
  const plan = pid === null ? null : db.get('SELECT * FROM plans WHERE id=? AND active=1', pid);
  if (!plan) fail('plan_unavailable', 'O plano selecionado não está disponível.', 404); // UC12 4a
  if (!d.confirm) fail('confirmation_required', 'Confirme a contratação do plano.', 400);
  const cur = activeSubscription(db, u.id);
  let start = utcnow();
  if (cur) {
    const left = parseIso(cur.end_at) - utcnow();
    if (!renewing) fail('subscription_active', 'Você já possui uma assinatura ativa. Aguarde o período de renovação ou cancele a atual.', 409); // RN30
    if (left > RENEW_WINDOW_DAYS * ms.DAY) fail('too_early_to_renew', `A renovação fica disponível nos últimos ${RENEW_WINDOW_DAYS} dias da assinatura.`, 409);
    if (db.get("SELECT 1 AS x FROM subscriptions WHERE user_id=? AND status='futura'", u.id)) fail('already_renewed', 'Sua renovação já está contratada.', 409);
    start = parseIso(cur.end_at);
  } else if (renewing && !db.get('SELECT 1 AS x FROM subscriptions WHERE user_id=?', u.id)) fail('no_subscription', 'Você ainda não possui assinatura para renovar.', 409);
  const end = addDays(start, plan.duration_days);
  const status = start <= utcnow() ? 'ativa' : 'futura';
  const id = db.run('INSERT INTO subscriptions(user_id,plan_id,start_at,end_at,status,price_paid,created_at) VALUES(?,?,?,?,?,?,?)',
    u.id, plan.id, iso(start), iso(end), status, plan.price, nowIso()).lastInsertRowid;
  syncWorkerStatus(db, u.id);
  audit(ctx, 'assinatura.contratacao', 'subscription', id, { plan: plan.name, renovacao: renewing });
  notify(db, u.id, 'assinatura', 'Assinatura registrada', `Plano ${plan.name} até ${p2(end.getUTCDate())}/${p2(end.getUTCMonth() + 1)}/${end.getUTCFullYear()}.`, '#/assinatura');
  return ok({ message: 'Assinatura registrada com sucesso.', id, status }, 201);
}

export default function routes(r) {
  r.get('/plans', login((ctx) => ok({ items: ctx.db.all('SELECT * FROM plans WHERE active=1 ORDER BY duration_days').map(planDict) })));

  r.get('/subscription', login((ctx) => {
    const { db, user } = ctx;
    refreshSubscriptions(db, user.id);
    const hist = db.all(`SELECT s.id,s.start_at,s.end_at,s.status,s.cancelled_at,s.price_paid,s.created_at,p.name AS plan_name,p.id AS plan_id
      FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? ORDER BY s.created_at DESC, s.id DESC`, user.id);
    const cur = activeSubscription(db, user.id);
    const current = hist.find((h) => cur && h.id === cur.id) || null;
    const future = hist.find((h) => h.status === 'futura') || null;
    let daysLeft = null;
    if (current) daysLeft = Math.max(0, Math.floor((parseIso(current.end_at) - utcnow()) / ms.DAY));
    const last = hist[0] || null;
    let alert = null;
    if (!current && last) alert = { expirada: 'Sua assinatura expirou.', cancelada: 'Sua assinatura foi cancelada.' }[last.status] ?? null; // RF14.10 / UC12 9a
    const canRenew = !!(current && daysLeft !== null && daysLeft <= RENEW_WINDOW_DAYS && !future);
    return ok({ current, future, history: hist, days_left: daysLeft, alert, can_subscribe: current === null, can_renew: canRenew });
  }));

  /** Contrata um plano (primeira assinatura ou novo período após expirar/cancelar). */
  r.post('/subscription', login((ctx) => create(ctx, false)));
  /** Renovação: permitida quando a assinatura atual está próxima do vencimento. */
  r.post('/subscription/renew', login((ctx) => create(ctx, true)));

  /** RN32/RN33: cancelar impede novas contratações, mas preserva perfil e serviços. */
  r.post('/subscription/cancel', login((ctx) => {
    const { db, user: u } = ctx;
    const cur = activeSubscription(db, u.id);
    if (!cur) fail('no_active_subscription', 'Você não possui assinatura ativa para cancelar.', 409);
    if (!ctx.body.confirm) fail('confirmation_required', 'Confirme o cancelamento da assinatura.', 400);
    db.run("UPDATE subscriptions SET status='cancelada', cancelled_at=? WHERE user_id=? AND status IN ('ativa','futura')", nowIso(), u.id);
    syncWorkerStatus(db, u.id);
    audit(ctx, 'assinatura.cancelamento', 'subscription', cur.id);
    notify(db, u.id, 'assinatura', 'Assinatura cancelada', 'Você não receberá novas contratações como prestador. Seu perfil e serviços foram preservados.', '#/assinatura');
    return ok({ message: 'Assinatura cancelada. Seu perfil e seus serviços foram preservados.' });
  }));
}
