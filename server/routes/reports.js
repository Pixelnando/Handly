// RF10–RF13 / UC11, UC16, UC20–UC22 — geração, visualização e exportação de relatórios.
import { audit, fail, login, ok } from '../api.js';
import { getProfile } from '../domain.js';
import { nowIso } from '../util.js';
import { BUILDERS, FORMATS } from '../reports/builders.js';
import { EXPORTERS, filename } from '../reports/exporters.js';

/** Quais relatórios o usuário pode gerar (RN19, RN21, RN26, RF13.9). */
function allowedReports(db, user) {
  const out = [{ type: 'usuario', title: 'Relatório de usuário', formats: [...FORMATS.usuario], description: 'Suas solicitações, serviços concluídos, cancelamentos e avaliações no período.' }];
  if (user.role === 'admin') {
    out.push(
      { type: 'software', title: 'Relatório de software', formats: [...FORMATS.software], description: 'Desempenho, utilização e erros da plataforma.' },
      { type: 'engajamento', title: 'Relatório de engajamento', formats: [...FORMATS.engajamento], description: 'Acessos, usuários ativos, categorias e profissionais mais procurados.' },
      { type: 'satisfacao', title: 'Relatório de satisfação', formats: [...FORMATS.satisfacao], description: 'Notas e comentários dos clientes sobre os serviços concluídos.' });
  } else if (getProfile(db, user.id)) {
    out.push({ type: 'satisfacao', title: 'Relatório de satisfação', formats: [...FORMATS.satisfacao], description: 'Avaliações que você recebeu dos clientes.' });
  }
  return out;
}

export default function routes(r) {
  r.get('/reports', login((ctx) => ok({ items: allowedReports(ctx.db, ctx.user) })));

  r.post('/reports/:rtype~', login((ctx) => {
    const { db, user: u } = ctx, rtype = ctx.params.rtype, d = ctx.body;
    if (!Object.hasOwn(BUILDERS, rtype)) fail('not_found', 'Relatório inexistente.', 404);
    if (!allowedReports(db, u).some((x) => x.type === rtype)) fail('forbidden', 'Você não tem permissão para acessar este relatório.', 403); // RN19/RN21/RN26
    const fmt = 'format' in d ? d.format : 'tela';
    if (fmt !== 'tela' && !FORMATS[rtype].includes(fmt)) // UC16 4a
      fail('format_not_allowed', `Formato não permitido para este relatório. Use: ${FORMATS[rtype].map((f) => f.toUpperCase()).join(', ')}.`, 422, { allowed: [...FORMATS[rtype]] });
    const report = BUILDERS[rtype](ctx, u, d);
    if (report.empty) {
      if (fmt !== 'tela') fail('no_data', report.empty_message, 422);
      return ok({ report }); // RF10.11 / RN29: informa ausência de dados, sem registrar geração
    }
    const filters = Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'format'));
    db.run('INSERT INTO report_logs(user_id,report_type,filters,format,generated_at) VALUES(?,?,?,?,?)', u.id, rtype, JSON.stringify(filters), fmt, nowIso()); // RN25 / RF10.10
    audit(ctx, `relatorio.${fmt !== 'tela' ? 'exportacao' : 'geracao'}`, 'report', null, { type: rtype, format: fmt });
    if (fmt === 'tela') return ok({ report, formats: [...FORMATS[rtype]] });
    let data;
    try { data = EXPORTERS[fmt][0](report); } catch (e) {
      ctx.log(`falha ao exportar relatório: ${e.stack || e}`);
      fail('export_failed', 'Não foi possível gerar o arquivo. Tente novamente.', 500); // UC16 5a
    }
    const fn = filename(report, fmt);
    return { status: 200, raw: data, contentType: EXPORTERS[fmt][1], headers: { 'Content-Disposition': `attachment; filename="${fn}"`, 'X-Filename': fn } };
  }));
}
