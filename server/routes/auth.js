// RF01 (cadastro), RF02 (login / recuperação de acesso) e dados da própria conta.
import crypto from 'node:crypto';
import { audit, createSession, fail, hashToken, loadUser, login, newToken, ok, track } from '../api.js';
import { UFS, findCity, searchCities } from '../cities.js';
import { activeSubscription, getProfile } from '../domain.js';
import { sendEmail } from '../mailer.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../passwords.js';
import { addHours, addMinutes, cleanStr, iso, nowIso, onlyDigits, parseIso, utcnow, validCpf, validEmail } from '../util.js';

const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;

export const publicUser = (u) => ({
  id: u.id, name: u.name, login: u.login, email: u.email, role: u.role, city: u.city, uf: u.uf, lat: u.lat, lng: u.lng,
  created_at: u.created_at, cpf_masked: u.cpf.length === 11 ? '***.***.***-' + u.cpf.slice(-2) : null,
});

/** Estado do usuário: perfil de trabalhador, assinatura e funcionalidades disponíveis (RF02.5). */
export function sessionPayload(db, u) {
  const wp = getProfile(db, u.id);
  const sub = activeSubscription(db, u.id);
  let features = ['buscar', 'solicitacoes', 'chat', 'conta', 'assinatura', 'relatorio_usuario'];
  if (wp) {
    features.push('perfil_profissional', 'servicos', 'agenda', 'verificacao');
    if (sub && wp.status === 'ativo') features.push('receber_solicitacoes');
    features.push('relatorio_satisfacao');
  }
  if (u.role === 'admin') features = ['admin', 'relatorio_usuario', 'relatorio_software', 'relatorio_engajamento', 'relatorio_satisfacao'];
  return {
    user: publicUser(u),
    worker: wp ? { id: wp.id, status: wp.status, verification_status: wp.verification_status } : null,
    subscription: sub ? { id: sub.id, plan: sub.plan_name, end_at: sub.end_at, status: sub.status } : null,
    features,
  };
}

const isNil = (v) => v === null || v === undefined;
export function toFloat(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function validateLocation(data) {
  let city = cleanStr(data.city, 80);
  const uf = cleanStr(data.uf, 2).toUpperCase();
  const errs = {};
  if (!city) errs.city = 'Informe a cidade.';
  if (!UFS.includes(uf)) errs.uf = 'Informe uma UF válida.';
  let lat = null, lng = null;
  const known = city && uf ? findCity(city, uf) : null;
  if (known) { city = known.name; lat = known.lat; lng = known.lng; }
  for (const key of ['lat', 'lng']) {
    const raw = data[key];
    if (isNil(raw) || raw === '') continue;
    const v = toFloat(raw);
    if (v === null) { errs[key] = 'Coordenada inválida.'; continue; }
    if ((key === 'lat' && !(v >= -90 && v <= 90)) || (key === 'lng' && !(v >= -180 && v <= 180))) errs[key] = 'Coordenada fora do intervalo.';
    else if (data.use_coords) { if (key === 'lat') lat = v; else lng = v; }
  }
  return { city, uf, lat, lng, errs };
}

export function validatePassword(pw, errs) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) errs.password = 'A senha deve ter entre 8 e 128 caracteres.';
  else if (!(/[A-Za-z]/.test(pw) && /\d/.test(pw))) errs.password = 'A senha deve conter letras e números.';
}

export default function routes(r) {
  r.get('/locations/cities', (ctx) => ok({ cities: searchCities(ctx.args.get('q') || '', 12), ufs: UFS }));

  /** RF01.2 / UC01 — o cadastro é feito pelo próprio usuário (RN03). */
  r.post('/auth/register', (ctx) => {
    const { db } = ctx, d = ctx.body;
    const errs = {};
    const name = cleanStr(d.name, 120);
    const loginName = cleanStr(d.login, 30).toLowerCase();
    const cpf = onlyDigits(d.cpf);
    const email = cleanStr(d.email, 254).toLowerCase();
    const password = d.password;
    if (name.length < 3 || !name.trim().includes(' ')) errs.name = 'Informe seu nome completo.';
    if (!LOGIN_RE.test(loginName)) errs.login = 'Login com 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.';
    if (!validCpf(cpf)) errs.cpf = 'CPF inválido.';
    if (!validEmail(email)) errs.email = 'E-mail inválido.';
    validatePassword(password, errs);
    const loc = validateLocation(d);
    Object.assign(errs, loc.errs);
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    const dup = {};
    if (db.get('SELECT 1 AS x FROM users WHERE login=?', loginName)) dup.login = 'Este login já está em uso.';
    if (db.get('SELECT 1 AS x FROM users WHERE cpf=?', cpf)) dup.cpf = 'Já existe uma conta com este CPF.';
    if (db.get('SELECT 1 AS x FROM users WHERE lower(email)=?', email)) dup.email = 'Já existe uma conta com este e-mail.';
    if (Object.keys(dup).length) fail('duplicate', 'Login, CPF ou e-mail já cadastrado.', 409, { fields: dup });
    const ts = nowIso();
    const id = db.run(
      `INSERT INTO users(name,login,cpf,email,password_hash,city,uf,lat,lng,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      name, loginName, cpf, email, hashPassword(password), loc.city, loc.uf, loc.lat, loc.lng, ts, ts).lastInsertRowid;
    audit(ctx, 'usuario.cadastro', 'user', id, null, id);
    return ok({ message: 'Cadastro realizado com sucesso. Agora é só entrar.', id }, 201);
  });

  const recentFailures = (ctx, ident) => {
    const since = iso(addMinutes(utcnow(), -ctx.cfg.LOGIN_WINDOW_MIN));
    return ctx.db.val('SELECT COUNT(*) FROM login_attempts WHERE identifier=? AND success=0 AND ts>=?', ident, since);
  };

  r.post('/auth/login', (ctx) => {
    const { db } = ctx, d = ctx.body;
    const ident = cleanStr(d.identifier || d.login, 254).toLowerCase();
    const password = d.password;
    const errs = {};
    if (!ident) errs.identifier = 'Informe seu e-mail ou login.';
    if (!password) errs.password = 'Informe a senha.';
    if (Object.keys(errs).length) fail('validation', 'Preencha os campos obrigatórios.', 422, { fields: errs });
    if (recentFailures(ctx, ident) >= ctx.cfg.LOGIN_MAX_FAILS)
      fail('too_many_attempts', 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.', 429);
    const user = db.get('SELECT * FROM users WHERE login=? OR lower(email)=?', ident, ident);
    const valid = verifyPassword(typeof password === 'string' ? password : '', user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid || user.status === 'excluido') {
      db.run('INSERT INTO login_attempts(identifier,ip,success,ts) VALUES(?,?,0,?)', ident, ctx.ip, nowIso());
      db.commit(); // a tentativa falha precisa persistir mesmo com resposta de erro
      fail('invalid_credentials', 'Login ou senha inválidos.', 401);
    }
    if (user.status === 'bloqueado') fail('blocked', 'Esta conta está bloqueada. Entre em contato com a administração.', 403);
    db.run('DELETE FROM login_attempts WHERE identifier=?', ident);
    const token = createSession(ctx, user.id, !!d.remember);
    ctx.user = user; ctx.userLoaded = true;
    track(ctx, 'acesso', { userId: user.id, location: `${user.city}/${user.uf}` });
    audit(ctx, 'usuario.login', 'user', user.id, null, user.id);
    ctx.setCookie(ctx.cfg.COOKIE_NAME, token, { maxAge: d.remember ? ctx.cfg.SESSION_REMEMBER_DAYS * 86400 : null });
    return ok(sessionPayload(db, user));
  });

  r.post('/auth/logout', (ctx) => {
    const token = ctx.cookies[ctx.cfg.COOKIE_NAME];
    if (token) ctx.db.run('DELETE FROM sessions WHERE token_hash=?', hashToken(token));
    ctx.clearCookie(ctx.cfg.COOKIE_NAME);
    return ok({ message: 'Sessão encerrada.' });
  });

  r.get('/auth/me', (ctx) => {
    const u = loadUser(ctx);
    if (!u) {
      if (ctx.sessionExpired) fail('session_expired', 'Sua sessão expirou por inatividade. Entre novamente.', 401);
      fail('unauthenticated', 'Não autenticado.', 401);
    }
    return ok(sessionPayload(ctx.db, u));
  });

  /** RF02.3/02.4 / UC03 — envia ao e-mail cadastrado o login e um link de redefinição. */
  r.post('/auth/forgot', (ctx) => {
    const { db } = ctx;
    const ident = cleanStr(ctx.body.identifier, 254).toLowerCase();
    if (!ident) fail('validation', 'Informe seu login ou e-mail.', 422, { fields: { identifier: 'Informe seu login ou e-mail.' } });
    const user = db.get("SELECT * FROM users WHERE (login=? OR lower(email)=?) AND status!='excluido'", ident, ident);
    if (!user) fail('account_not_found', 'Não foi possível localizar uma conta correspondente.', 404);
    const token = newToken();
    db.run('INSERT INTO password_resets(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)', user.id, hashToken(token), iso(addHours(utcnow(), 1)), nowIso());
    const link = `${ctx.cfg.PUBLIC_URL}/#/redefinir-senha?token=${token}`;
    const text = `Olá, ${user.name.split(/\s+/)[0]}!\n\nSeu login no Handly é: ${user.login}\n\n` +
      `Para criar uma nova senha, acesse (válido por 1 hora):\n${link}\n\n` +
      'Se você não pediu esta recuperação, ignore este e-mail.';
    const sent = sendEmail(ctx, user.email, 'Recuperação de acesso — Handly', text);
    audit(ctx, 'usuario.recuperacao_acesso', 'user', user.id, null, user.id);
    if (!sent) { db.commit(); fail('email_failed', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.', 502); }
    const out = { message: 'Enviamos as instruções de recuperação para o e-mail cadastrado.' };
    if (ctx.cfg.DEBUG_TOOLS) out.dev_link = link; // apenas fora de produção
    return ok(out);
  });

  r.post('/auth/reset', (ctx) => {
    const { db } = ctx, d = ctx.body;
    const errs = {};
    validatePassword(d.password, errs);
    if (Object.keys(errs).length) fail('validation', 'Senha inválida.', 422, { fields: errs });
    const row = db.get('SELECT * FROM password_resets WHERE token_hash=?', hashToken(String(d.token ?? '')));
    if (!row || row.used_at || parseIso(row.expires_at) < utcnow()) fail('invalid_token', 'Link de recuperação inválido ou expirado. Solicite um novo.', 400);
    db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', hashPassword(d.password), nowIso(), row.user_id);
    db.run('UPDATE password_resets SET used_at=? WHERE id=?', nowIso(), row.id);
    db.run('DELETE FROM sessions WHERE user_id=?', row.user_id);
    audit(ctx, 'usuario.senha_redefinida', 'user', row.user_id, null, row.user_id);
    return ok({ message: 'Senha alterada. Entre com a nova senha.' });
  });

  r.get('/dev/outbox', (ctx) => {
    if (!ctx.cfg.DEBUG_TOOLS) fail('not_found', 'Recurso não encontrado.', 404);
    return ok({ items: ctx.db.all('SELECT * FROM outbox ORDER BY id DESC LIMIT 20') });
  });
}
void crypto; void login;
