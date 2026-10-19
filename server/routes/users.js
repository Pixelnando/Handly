// RF01.3/01.4 — gestão da própria conta; RNF08.4 — direitos do titular (exportar e excluir dados).
import crypto from 'node:crypto';
import { audit, fail, login, ok } from '../api.js';
import { getProfile } from '../domain.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { cleanStr, nowIso, onlyDigits, validEmail } from '../util.js';
import { publicUser, validateLocation, validatePassword } from './auth.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export default function routes(r) {
  r.get('/users/me', login((ctx) => ok({ user: publicUser(ctx.user) })));

  /** RN04: o usuário pode alterar seus dados, exceto login e CPF. */
  r.put('/users/me', login((ctx) => {
    const { db, user: u } = ctx, d = ctx.body;
    const errs = {};
    if (has(d, 'login') && cleanStr(d.login).toLowerCase() !== u.login) errs.login = 'O login não pode ser alterado.';
    if (has(d, 'cpf') && !['', u.cpf].includes(onlyDigits(d.cpf))) errs.cpf = 'O CPF não pode ser alterado.';
    const name = cleanStr(has(d, 'name') ? d.name : u.name, 120);
    const email = cleanStr(has(d, 'email') ? d.email : u.email, 254).toLowerCase();
    if (name.length < 3 || !name.includes(' ')) errs.name = 'Informe seu nome completo.';
    if (!validEmail(email)) errs.email = 'E-mail inválido.';
    let city, uf, lat, lng;
    if (!has(d, 'city') && !has(d, 'uf')) ({ city, uf, lat, lng } = u);
    else {
      const loc = validateLocation({ city: has(d, 'city') ? d.city : u.city, uf: has(d, 'uf') ? d.uf : u.uf, lat: d.lat, lng: d.lng, use_coords: d.use_coords });
      ({ city, uf, lat, lng } = loc);
      Object.assign(errs, loc.errs);
    }
    let newHash = u.password_hash;
    if (d.new_password) {
      if (!verifyPassword(String(d.current_password || ''), u.password_hash)) errs.current_password = 'Senha atual incorreta.';
      if (!('password' in errs)) validatePassword(d.new_password, errs);
      if ('password' in errs) { errs.new_password = errs.password; delete errs.password; }
      if (!Object.keys(errs).length) newHash = hashPassword(d.new_password);
    }
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    if (db.get('SELECT 1 AS x FROM users WHERE lower(email)=? AND id!=?', email, u.id))
      fail('duplicate', 'Já existe uma conta com este e-mail.', 409, { fields: { email: 'Já existe uma conta com este e-mail.' } });
    db.run('UPDATE users SET name=?,email=?,city=?,uf=?,lat=?,lng=?,password_hash=?,updated_at=? WHERE id=?', name, email, city, uf, lat, lng, newHash, nowIso(), u.id);
    audit(ctx, 'usuario.alteracao', 'user', u.id, { senha_alterada: newHash !== u.password_hash });
    return ok({ user: publicUser(db.get('SELECT * FROM users WHERE id=?', u.id)), message: 'Dados atualizados.' });
  }));

  /** RF01.4/RN05: exclusão solicitada por usuário autenticado, com confirmação de senha. */
  r.post('/users/me/delete', login((ctx) => {
    const { db, user: u } = ctx, d = ctx.body;
    if (u.role === 'admin') fail('forbidden', 'Contas de administrador não podem ser excluídas por aqui.', 403);
    if (!d.confirm) fail('confirmation_required', 'Confirme a exclusão da conta.', 400);
    if (!verifyPassword(String(d.password || ''), u.password_hash)) fail('invalid_credentials', 'Senha incorreta.', 401);
    const active = db.val("SELECT COUNT(*) FROM requests WHERE (client_id=? OR worker_id=?) AND status IN ('agendada','aguardando_resposta','em_negociacao')", u.id, u.id);
    if (active) fail('has_active_requests', 'Você possui solicitações em andamento. Cancele ou conclua antes de excluir a conta.', 409, { count: active });
    const ts = nowIso();
    const wp = getProfile(db, u.id);
    if (wp) {
      db.run("UPDATE worker_profiles SET deleted_at=?, status='inativo', updated_at=? WHERE id=?", ts, ts, wp.id);
      db.run('UPDATE services SET deleted_at=? WHERE worker_id=? AND deleted_at IS NULL', ts, wp.id);
    }
    db.run("UPDATE subscriptions SET cancelled_at=?, status='cancelada' WHERE user_id=? AND status IN ('ativa','futura')", ts, u.id);
    db.run('DELETE FROM sessions WHERE user_id=?', u.id);
    db.run('DELETE FROM notifications WHERE user_id=?', u.id);
    const tag = `excluido-${u.id}-${crypto.randomBytes(3).toString('hex')}`;
    // Anonimiza: preserva o histórico (mensagens/avaliações de terceiros) sem manter dados pessoais.
    db.run(`UPDATE users SET name='Usuário removido', login=?, cpf=?, email=?, password_hash='!', city='-', uf='--',
            lat=NULL, lng=NULL, status='excluido', deleted_at=?, updated_at=? WHERE id=?`, tag, tag, `${tag}@removido.invalid`, ts, ts, u.id);
    audit(ctx, 'usuario.exclusao', 'user', u.id, null, u.id);
    ctx.clearCookie(ctx.cfg.COOKIE_NAME);
    return ok({ message: 'Conta excluída. Seus dados pessoais foram removidos.' });
  }));

  /** RNF08.4: cópia dos dados pessoais do titular. */
  r.get('/users/me/export', login((ctx) => {
    const { db, user: u } = ctx;
    const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
    const data = {
      gerado_em: nowIso(),
      conta: { ...pick(u, ['name', 'login', 'email', 'city', 'uf', 'created_at']), cpf_final: u.cpf.slice(-2) },
      perfil_profissional: db.get('SELECT phone,description,service_area,radius_km,status,verification_status,created_at FROM worker_profiles WHERE user_id=? AND deleted_at IS NULL', u.id),
      solicitacoes: db.all('SELECT id,service_name,status,scheduled_start,location,base_value,agreed_value,created_at FROM requests WHERE client_id=? OR worker_id=? ORDER BY id', u.id, u.id),
      avaliacoes_feitas: db.all('SELECT request_id,rating,comment,created_at FROM reviews WHERE client_id=?', u.id),
      assinaturas: db.all('SELECT plan_id,start_at,end_at,status,price_paid FROM subscriptions WHERE user_id=?', u.id),
      mensagens_enviadas: db.all("SELECT conversation_id,body,created_at FROM messages WHERE sender_id=? AND type='texto'", u.id),
    };
    audit(ctx, 'usuario.exportacao_dados', 'user', u.id);
    return ok(data);
  }));
}
