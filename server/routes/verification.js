// RF15 / UC17 — verificação de perfil por serviço externo.
import { audit, fail, login, notify, ok } from '../api.js';
import { getProfile } from '../domain.js';
import { addHours, cleanStr, iso, nowIso, parseDate, todayUtcStr, utcnow } from '../util.js';
import { ProviderUnavailable, getProvider } from '../verification-provider.js';

const MAX_FILE = 5 * 1024 * 1024;
const MAGIC = [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('%PDF')];

function readFile(files, name, errs) {
  const f = files[name];
  if (!f || !f.length) { errs[name] = 'Envie o arquivo.'; return null; }
  if (f.length > MAX_FILE) { errs[name] = 'Arquivo maior que 5 MB.'; return null; }
  if (!MAGIC.some((m) => f.subarray(0, m.length).equals(m))) { errs[name] = 'Formato inválido. Envie JPG, PNG ou PDF.'; return null; } // confere o conteúdo real
  return f;
}

export default function routes(r) {
  r.get('/workers/me/verification', login((ctx) => {
    const { db, user } = ctx;
    const wp = getProfile(db, user.id);
    if (!wp) fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 403);
    const items = db.all('SELECT id,provider,document_type,document_masked,status,message,requested_at,completed_at FROM verifications WHERE worker_profile_id=? ORDER BY id DESC', wp.id);
    return ok({ status: wp.verification_status, verified_at: wp.verified_at, items,
      required: ['Nome completo (como no documento)', 'Data de nascimento', 'Tipo e número do documento', 'Foto do documento', 'Selfie'] });
  }));

  r.post('/workers/me/verification', login(async (ctx) => {
    const { db, user: u } = ctx;
    const wp = getProfile(db, u.id);
    if (!wp) fail('no_worker_profile', 'Você ainda não possui um perfil de trabalhador.', 403);
    if (wp.verification_status === 'verificado') fail('already_verified', 'Seu perfil já está verificado.', 409);
    const n = db.val('SELECT COUNT(*) FROM verifications WHERE worker_profile_id=? AND requested_at>=?', wp.id, iso(addHours(utcnow(), -24)));
    if (n >= ctx.cfg.VERIFICATION_MAX_ATTEMPTS_24H) fail('too_many_attempts', 'Limite de tentativas de verificação atingido. Tente novamente amanhã.', 429);
    const { fields: form, files } = ctx.multipart();
    const errs = {};
    const name = cleanStr(form.full_name, 120);
    const docType = form.document_type || '';
    const docNumber = cleanStr(form.document_number, 30);
    const birth = parseDate(form.birth_date || '');
    if ([...name].length < 3) errs.full_name = 'Informe o nome completo.';
    if (!['rg', 'cnh'].includes(docType)) errs.document_type = 'Escolha RG ou CNH.';
    if ([...docNumber].length < 4) errs.document_number = 'Informe o número do documento.';
    if (!birth || birth > todayUtcStr()) errs.birth_date = 'Informe a data de nascimento.';
    const docImg = readFile(files, 'document_image', errs);
    const selfie = readFile(files, 'selfie_image', errs);
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs }); // UC17 4a
    const provider = getProvider(ctx.cfg);
    const masked = '•'.repeat(Math.max(0, docNumber.length - 3)) + docNumber.slice(-3);
    const ts = nowIso();
    let result;
    try {
      result = await provider.verify({ cpf: u.cpf, account_name: u.name, name, birth_date: birth, document_type: docType, document_number: docNumber, document_image: docImg, selfie_image: selfie });
    } catch (e) {
      if (!(e instanceof ProviderUnavailable)) throw e;
      db.run(`INSERT INTO verifications(worker_profile_id,user_id,provider,document_type,document_masked,status,message,requested_at,completed_at)
              VALUES(?,?,?,?,?,'nao_concluida',?,?,?)`, wp.id, u.id, provider.name, docType, masked, 'Serviço de verificação indisponível.', ts, nowIso());
      db.commit();
      fail('provider_unavailable', 'Não foi possível concluir a verificação agora. Tente novamente em alguns minutos.', 503); // RF15.10 / UC17 6a
    }
    const approved = result.approved;
    db.run(`INSERT INTO verifications(worker_profile_id,user_id,provider,document_type,document_masked,status,message,requested_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      wp.id, u.id, provider.name, docType, masked, approved ? 'aprovada' : 'rejeitada', result.message, ts, nowIso());
    if (approved) db.run("UPDATE worker_profiles SET verification_status='verificado', verified_at=?, updated_at=? WHERE id=?", nowIso(), nowIso(), wp.id); // RN35
    else db.run("UPDATE worker_profiles SET verification_status='rejeitado', updated_at=? WHERE id=?", nowIso(), wp.id);
    notify(db, u.id, 'verificacao', approved ? 'Perfil verificado' : 'Verificação não aprovada', result.message, '#/verificacao');
    audit(ctx, 'verificacao.resultado', 'worker_profile', wp.id, { aprovada: approved });
    // os bytes dos documentos não são armazenados em nenhum momento (RN36)
    return ok({ approved, message: result.message, status: approved ? 'verificado' : 'rejeitado', can_retry: !approved });
  }));
}
