// Construção dos relatórios (RF10–RF13). Cada builder devolve um objeto neutro de formato, que os
// exportadores (PDF/CSV/XLSX) e a tela consomem igualmente.
// report = {type,title,generated_at,period,filters[[rótulo,valor]],identification[],summary[],sections[{title,columns,rows}],empty,empty_message,truncated}
import { fail, toInt } from '../api.js';
import { fmtLocal } from '../chatlib.js';
import { getProfile } from '../domain.js';
import {
  addDateDays, addMinutes, cleanStr, diffDays, fmtDayBR, iso, localToUtc, maskCpf, money, nowIso, parseDate, parseIso, utcnow,
} from '../util.js';

export { fmtLocal };
export const STATUS_LABEL = {
  aguardando_resposta: 'Aguardando resposta', em_negociacao: 'Em negociação', agendada: 'Agendada', concluida: 'Concluída',
  cancelada: 'Cancelada', recusada: 'Recusada', expirada: 'Expirada',
};
export const INTERACTION_LABEL = {
  acesso: 'Acessos (login)', busca: 'Buscas', visualizacao_perfil: 'Visualizações de perfil', solicitacao: 'Solicitações',
  mensagem: 'Mensagens/conversas', avaliacao: 'Avaliações',
};
const USER_ACTIVITIES = {
  solicitacoes_realizadas: 'Solicitações realizadas', solicitacoes_recebidas: 'Solicitações recebidas', concluidos: 'Serviços concluídos',
  cancelados: 'Serviços cancelados', avaliacoes_realizadas: 'Avaliações realizadas', avaliacoes_recebidas: 'Avaliações recebidas',
  outras: 'Outras atividades registradas',
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fixed = (v, n) => Number(v).toFixed(n);

/** RN20/RN22/RN27: período com data inicial e final obrigatórias; início <= fim. */
export function periodBounds(d) {
  const s = parseDate(d.start), e = parseDate(d.end);
  const errs = {};
  if (!s) errs.start = 'Informe a data inicial.';
  if (!e) errs.end = 'Informe a data final.';
  if (Object.keys(errs).length) fail('validation', 'Informe o período (data inicial e final).', 422, { fields: errs }); // UC11 3a
  if (s > e) fail('invalid_period', 'Período inválido: a data inicial é posterior à data final.', 422, { fields: { start: 'A data inicial deve ser anterior ou igual à final.' } }); // UC11 3b
  return { s, e, lo: iso(localToUtc(s, '00:00')), hi: iso(localToUtc(addDateDays(e, 1), '00:00')) };
}

const cap = (ctx, arr, trunc) => { if (arr.length > ctx.cfg.REPORT_MAX_ROWS) { trunc.push(true); return arr.slice(0, ctx.cfg.REPORT_MAX_ROWS); } return arr; };

function base(rtype, title, s, e, filters) {
  return {
    type: rtype, title, generated_at: nowIso(),
    period: { start: s, end: e, label: `${fmtDayBR(s)} a ${fmtDayBR(e)}` },
    filters, identification: [], summary: [], sections: [], empty: false, empty_message: null, truncated: false,
  };
}

// ====================================================================== RF10 — relatório de usuário
export function userReport(ctx, viewer, d) {
  const { db } = ctx;
  const { s, e, lo, hi } = periodBounds(d);
  const targetId = toInt(d.user_id || viewer.id);
  if (targetId === null) fail('validation', 'Usuário inválido.', 422);
  if (targetId !== viewer.id && viewer.role !== 'admin') fail('forbidden', 'Você só pode gerar relatórios das suas próprias atividades.', 403); // RN19
  const u = db.get("SELECT * FROM users WHERE id=? AND status!='excluido'", targetId);
  if (!u) fail('not_found', 'Usuário não encontrado.', 404);
  const wp = getProfile(db, targetId);
  const acts = d.activities && (!Array.isArray(d.activities) || d.activities.length) ? d.activities : Object.keys(USER_ACTIVITIES);
  if (!Array.isArray(acts) || acts.some((a) => !has(USER_ACTIVITIES, a))) fail('validation', 'Tipo de atividade inválido.', 422, { fields: { activities: 'Tipo de atividade inválido.' } });
  const statuses = d.statuses && (!Array.isArray(d.statuses) || d.statuses.length) ? d.statuses : [];
  if (statuses.length && (!Array.isArray(statuses) || statuses.some((x) => !has(STATUS_LABEL, x)))) fail('validation', 'Status inválido.', 422, { fields: { statuses: 'Status inválido.' } });
  const filters = [['Período', `${fmtDayBR(s)} a ${fmtDayBR(e)}`], ['Atividades', acts.map((a) => USER_ACTIVITIES[a]).join(', ')],
    ['Status', statuses.length ? statuses.map((x) => STATUS_LABEL[x]).join(', ') : 'Todos']];
  const rep = base('usuario', 'Relatório de atividades do usuário', s, e, filters);
  rep.identification = [['Nome', u.name], ['Login', u.login], ['E-mail', u.email], ['CPF', maskCpf(u.cpf)], ['Localização', `${u.city}/${u.uf}`], ['Perfil', wp ? 'Cliente e trabalhador' : 'Cliente']];
  const trunc = [];
  const MAXR = ctx.cfg.REPORT_MAX_ROWS + 1;
  const stSql = statuses.length ? ` AND r.status IN (${statuses.map(() => '?').join(',')})` : '';
  const cols = ['Nº', 'Solicitada em', 'Serviço', '{}', 'Agendado para', 'Status', 'Valor'];
  const reqRows = (col, otherCol) => db.all(
    `SELECT r.id,r.created_at,r.service_name,ou.name AS other,r.scheduled_start,r.status,r.agreed_value,r.base_value
     FROM requests r JOIN users ou ON ou.id=r.${otherCol} WHERE r.${col}=? AND r.created_at>=? AND r.created_at<?${stSql}
     ORDER BY r.created_at DESC LIMIT ${MAXR}`, targetId, lo, hi, ...statuses);
  const fmtReq = (r) => [r.id, fmtLocal(r.created_at), r.service_name, r.other, fmtLocal(r.scheduled_start), STATUS_LABEL[r.status], money(r.agreed_value !== null ? r.agreed_value : r.base_value)];
  const counts = {};
  if (acts.includes('solicitacoes_realizadas')) {
    const rs = cap(ctx, reqRows('client_id', 'worker_id'), trunc);
    counts['Solicitações realizadas'] = rs.length;
    rep.sections.push({ title: 'Solicitações realizadas', columns: cols.map((c) => c.replace('{}', 'Profissional')), rows: rs.map(fmtReq) });
  }
  if (acts.includes('solicitacoes_recebidas') && wp) {
    const rs = cap(ctx, reqRows('worker_id', 'client_id'), trunc);
    counts['Solicitações recebidas'] = rs.length;
    rep.sections.push({ title: 'Solicitações recebidas', columns: cols.map((c) => c.replace('{}', 'Cliente')), rows: rs.map(fmtReq) });
  }
  if (acts.includes('concluidos')) {
    let both = [];
    for (const [col, other, role] of [['client_id', 'worker_id', 'Cliente'], ['worker_id', 'client_id', 'Profissional']]) {
      if (role === 'Profissional' && !wp) continue;
      for (const r of db.all(
        `SELECT r.id,r.service_name,ou.name AS other,r.completed_at,COALESCE(r.agreed_value,r.base_value) AS v
         FROM requests r JOIN users ou ON ou.id=r.${other} WHERE r.${col}=? AND r.status='concluida'
         AND r.completed_at>=? AND r.completed_at<?${!statuses.length || statuses.includes('concluida') ? '' : ' AND 0'}
         ORDER BY r.completed_at DESC LIMIT ${MAXR}`, targetId, lo, hi))
        both.push([r.id, fmtLocal(r.completed_at), r.service_name, r.other, role, money(r.v)]);
    }
    both = cap(ctx, both, trunc);
    counts['Serviços concluídos'] = both.length;
    rep.sections.push({ title: 'Serviços concluídos', columns: ['Nº', 'Concluído em', 'Serviço', 'Outra parte', 'Seu papel', 'Valor'], rows: both });
  }
  if (acts.includes('cancelados')) {
    let out = db.all(
      `SELECT r.id,r.service_name,r.cancelled_at,r.cancel_reason,r.cancellation_fee_amount,r.client_id,cu.name AS cn,wu.name AS wn,r.cancelled_by
       FROM requests r JOIN users cu ON cu.id=r.client_id JOIN users wu ON wu.id=r.worker_id
       WHERE (r.client_id=? OR r.worker_id=?) AND r.status='cancelada' AND r.cancelled_at>=? AND r.cancelled_at<?
       ${!statuses.length || statuses.includes('cancelada') ? '' : ' AND 0'} ORDER BY r.cancelled_at DESC LIMIT ${MAXR}`, targetId, targetId, lo, hi)
      .map((r) => [r.id, fmtLocal(r.cancelled_at), r.service_name, r.client_id === targetId ? r.wn : r.cn,
        r.cancelled_by === targetId ? 'Você' : 'Outra parte', money(r.cancellation_fee_amount || 0), r.cancel_reason || '']);
    out = cap(ctx, out, trunc);
    counts['Serviços cancelados'] = out.length;
    rep.sections.push({ title: 'Serviços cancelados', columns: ['Nº', 'Cancelado em', 'Serviço', 'Outra parte', 'Cancelado por', 'Taxa', 'Motivo'], rows: out });
  }
  if (acts.includes('avaliacoes_realizadas')) {
    const rs = cap(ctx, db.all(
      `SELECT rv.created_at,wu.name AS wn,r.service_name,rv.rating,rv.comment FROM reviews rv JOIN users wu ON wu.id=rv.worker_id
       JOIN requests r ON r.id=rv.request_id WHERE rv.client_id=? AND rv.created_at>=? AND rv.created_at<? ORDER BY rv.created_at DESC LIMIT ${MAXR}`, targetId, lo, hi), trunc);
    counts['Avaliações realizadas'] = rs.length;
    rep.sections.push({ title: 'Avaliações realizadas', columns: ['Data', 'Profissional', 'Serviço', 'Nota', 'Comentário'], rows: rs.map((r) => [fmtLocal(r.created_at), r.wn, r.service_name, r.rating, r.comment || '']) });
  }
  if (acts.includes('avaliacoes_recebidas') && wp) {
    const rs = cap(ctx, db.all(
      `SELECT rv.created_at,cu.name AS cn,r.service_name,rv.rating,rv.comment FROM reviews rv JOIN users cu ON cu.id=rv.client_id
       JOIN requests r ON r.id=rv.request_id WHERE rv.worker_id=? AND rv.hidden=0 AND rv.created_at>=? AND rv.created_at<? ORDER BY rv.created_at DESC LIMIT ${MAXR}`, targetId, lo, hi), trunc);
    counts['Avaliações recebidas'] = rs.length;
    rep.sections.push({ title: 'Avaliações recebidas', columns: ['Data', 'Cliente', 'Serviço', 'Nota', 'Comentário'], rows: rs.map((r) => [fmtLocal(r.created_at), r.cn, r.service_name, r.rating, r.comment || '']) });
  }
  if (acts.includes('outras')) {
    const rs = db.all('SELECT created_at,action,entity,entity_id FROM audit_logs WHERE user_id=? AND created_at>=? AND created_at<? ORDER BY id DESC LIMIT 300', targetId, lo, hi);
    counts['Outras atividades'] = rs.length;
    rep.sections.push({ title: 'Outras atividades registradas', columns: ['Data', 'Atividade', 'Referência'],
      rows: rs.map((r) => [fmtLocal(r.created_at), r.action.replaceAll('.', ' › '), r.entity ? `${r.entity} #${r.entity_id}` : '']) });
  }
  rep.empty = !Object.values(counts).some((v) => v);
  if (rep.empty) rep.empty_message = 'Não foram encontradas atividades no período selecionado para gerar o relatório.'; // RF10.11
  rep.summary = Object.entries(counts);
  if (wp) { // RF10.6 — serviços ofertados e valores praticados
    const svcs = db.all(`SELECT s.name,c.name AS cat,s.base_rate,s.avg_duration_min,s.created_at FROM services s JOIN categories c ON c.id=s.category_id
      WHERE s.worker_id=? AND s.deleted_at IS NULL ORDER BY s.name`, wp.id);
    rep.sections.push({ title: 'Serviços ofertados', columns: ['Serviço', 'Categoria', 'Valor padrão', 'Duração média'], rows: svcs.map((x) => [x.name, x.cat, money(x.base_rate), `${x.avg_duration_min} min`]) });
    const prat = db.all(`SELECT r.service_name, COUNT(*) AS n, SUM(r.agreed_value) AS total, AVG(r.agreed_value) AS media, MIN(r.agreed_value) AS mn, MAX(r.agreed_value) AS mx
      FROM requests r WHERE r.worker_id=? AND r.status='concluida' AND r.completed_at>=? AND r.completed_at<? AND r.agreed_value IS NOT NULL
      GROUP BY r.service_name ORDER BY total DESC`, targetId, lo, hi);
    rep.sections.push({ title: 'Valores praticados no período (serviços concluídos)', columns: ['Serviço', 'Qtde.', 'Total', 'Média', 'Menor', 'Maior'],
      rows: prat.map((x) => [x.service_name, x.n, money(x.total), money(x.media), money(x.mn), money(x.mx)]) });
  }
  rep.truncated = trunc.length > 0;
  return rep;
}

// ====================================================================== RF11 — relatório de software
export function softwareReport(ctx, viewer, d) {
  const { db, cfg } = ctx;
  const { s, e, lo, hi } = periodBounds(d);
  let metrics = d.metrics && (!Array.isArray(d.metrics) || d.metrics.length) ? d.metrics : ['todas'];
  const allowed = ['desempenho', 'utilizacao', 'erros', 'todas'];
  if (!Array.isArray(metrics) || metrics.some((m) => !allowed.includes(m))) fail('validation', 'Tipo de métrica inválido.', 422, { fields: { metrics: 'Selecione um tipo de métrica válido.' } });
  if (metrics.includes('todas')) metrics = ['desempenho', 'utilizacao', 'erros'];
  const days = diffDays(e, s) + 1;
  if (days > cfg.REPORT_CONFIRM_DAYS && !d.confirm) // RN24
    fail('confirmation_required', `O período selecionado tem ${days} dias (mais de ${cfg.REPORT_CONFIRM_DAYS}). A geração pode demorar. Deseja continuar?`, 409, { days });
  const label = { desempenho: 'Desempenho', utilizacao: 'Utilização', erros: 'Erros' };
  const rep = base('software', 'Relatório técnico da plataforma', s, e, [['Período', `${fmtDayBR(s)} a ${fmtDayBR(e)} (${days} dias)`], ['Métricas', metrics.map((m) => label[m]).join(', ')]]);
  const total = db.val('SELECT COUNT(*) FROM request_log WHERE ts>=? AND ts<?', lo, hi);
  if (total === 0) { rep.empty = true; rep.empty_message = 'Não há dados técnicos registrados para o período informado.'; return rep; } // RF11.10
  const summary = [['Requisições registradas', total]];
  if (metrics.includes('desempenho')) {
    const durs = db.all('SELECT duration_ms FROM request_log WHERE ts>=? AND ts<? ORDER BY duration_ms LIMIT 500000', lo, hi).map((r) => r.duration_ms);
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
    const p95 = durs[Math.min(durs.length - 1, Math.ceil(0.95 * durs.length) - 1)];
    const firstHb = db.val('SELECT MIN(ts) FROM heartbeats');
    let up = null;
    if (firstHb) {
      const now = utcnow(); now.setUTCSeconds(0, 0);
      const a = new Date(Math.max(parseIso(lo), parseIso(firstHb)));
      const b = new Date(Math.min(parseIso(hi), addMinutes(now, 1)));
      const expected = Math.max(1, Math.floor((b - a) / 60000));
      const hb = db.val('SELECT COUNT(*) FROM heartbeats WHERE ts>=? AND ts<?', iso(a), iso(b));
      up = Math.min(100, Math.round((hb / expected) * 10000) / 100);
    }
    const perMin = db.all('SELECT substr(ts,1,16) AS m, COUNT(*) AS n FROM request_log WHERE ts>=? AND ts<? GROUP BY m', lo, hi);
    const counts = perMin.map((r) => r.n);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length);
    const threshold = Math.max(5, mean + 2 * sd);
    const peaks = perMin.filter((r) => r.n >= threshold);
    let busiest = perMin[0];
    for (const r of perMin) if (r.n > busiest.n) busiest = r;
    const res = db.get('SELECT AVG(load1) l, MAX(load1) lm, AVG(mem_mb) m, MAX(mem_mb) mm, AVG(cpu_pct) c, MAX(cpu_pct) cm, COUNT(*) n FROM resource_samples WHERE ts>=? AND ts<?', lo, hi);
    const fmt = (v, suf = '') => (v === null || v === undefined ? '—' : `${fixed(v, 1)}${suf}`);
    rep.sections.push({ title: 'Métricas de desempenho', columns: ['Indicador', 'Valor'], rows: [
      ['Tempo médio de resposta', `${fixed(avg, 1)} ms`], ['Tempo de resposta (p95)', `${fixed(p95, 1)} ms`], ['Tempo máximo de resposta', `${fixed(durs[durs.length - 1], 1)} ms`],
      ['Disponibilidade da plataforma', up !== null ? `${fixed(up, 2)}%` : 'sem dados'],
      ['Picos de acesso (minutos acima de média + 2σ)', peaks.length],
      ['Maior volume em um minuto', `${busiest.n} requisições (${busiest.m.replace('T', ' ')} UTC)`],
      ['Carga média do servidor (1 min) — média / máxima', `${fmt(res.l)} / ${fmt(res.lm)}`],
      ['Memória do processo — média / máxima', `${fmt(res.m, ' MB')} / ${fmt(res.mm, ' MB')}`],
      ['CPU do processo — média / máxima', `${fmt(res.c, '%')} / ${fmt(res.cm, '%')}`],
      ['Amostras de recursos coletadas', res.n]] });
    summary.push(['Tempo médio de resposta', `${fixed(avg, 1)} ms`], ['Disponibilidade', up !== null ? `${fixed(up, 2)}%` : 'sem dados']);
  }
  if (metrics.includes('utilizacao')) {
    const q = (sql, ...a) => db.val(sql, ...a);
    const active = q('SELECT COUNT(DISTINCT user_id) FROM request_log WHERE ts>=? AND ts<? AND user_id IS NOT NULL', lo, hi);
    const top = db.all("SELECT method||' '||route AS r, COUNT(*) AS n FROM request_log WHERE ts>=? AND ts<? GROUP BY r ORDER BY n DESC LIMIT 10", lo, hi);
    rep.sections.push({ title: 'Métricas de utilização', columns: ['Indicador', 'Valor'], rows: [
      ['Usuários ativos', active],
      ['Solicitações de serviço realizadas', q('SELECT COUNT(*) FROM requests WHERE created_at>=? AND created_at<?', lo, hi)],
      ['Serviços concluídos', q('SELECT COUNT(*) FROM requests WHERE completed_at>=? AND completed_at<?', lo, hi)],
      ['Novos usuários cadastrados', q("SELECT COUNT(*) FROM users WHERE role='user' AND created_at>=? AND created_at<?", lo, hi)],
      ['Novos perfis de trabalhador', q('SELECT COUNT(*) FROM worker_profiles WHERE created_at>=? AND created_at<?', lo, hi)],
      ['Assinaturas contratadas', q('SELECT COUNT(*) FROM subscriptions WHERE created_at>=? AND created_at<?', lo, hi)],
      ['Acessos (logins)', q("SELECT COUNT(*) FROM interactions WHERE type='acesso' AND ts>=? AND ts<?", lo, hi)],
      ['Buscas realizadas', q("SELECT COUNT(*) FROM interactions WHERE type='busca' AND ts>=? AND ts<?", lo, hi)],
      ['Mensagens trocadas no chat', q("SELECT COUNT(*) FROM messages WHERE type='texto' AND created_at>=? AND created_at<?", lo, hi)],
      ['Avaliações registradas', q('SELECT COUNT(*) FROM reviews WHERE created_at>=? AND created_at<?', lo, hi)]] });
    rep.sections.push({ title: 'Rotas mais utilizadas', columns: ['Rota', 'Requisições'], rows: top.map((r) => [r.r, r.n]) });
    summary.push(['Usuários ativos', active]);
  }
  if (metrics.includes('erros')) {
    const errs = db.all('SELECT status, COUNT(*) AS n FROM request_log WHERE ts>=? AND ts<? AND status>=400 GROUP BY status ORDER BY n DESC', lo, hi);
    const nErr = errs.reduce((a, r) => a + r.n, 0);
    const n5 = errs.filter((r) => r.status >= 500).reduce((a, r) => a + r.n, 0);
    const top = db.all(`SELECT method||' '||route AS r, status, COUNT(*) AS n FROM request_log WHERE ts>=? AND ts<? AND status>=400
      GROUP BY r,status ORDER BY n DESC LIMIT 10`, lo, hi);
    rep.sections.push({ title: 'Métricas de erros', columns: ['Indicador', 'Valor'], rows: [
      ['Erros registrados (HTTP ≥ 400)', nErr], ['Percentual sobre o total de requisições', `${fixed((nErr / total) * 100, 2)}%`],
      ['Erros de servidor (HTTP 5xx)', n5], ['Percentual de erros de servidor', `${fixed((n5 / total) * 100, 2)}%`]] });
    rep.sections.push({ title: 'Erros por código HTTP', columns: ['Código', 'Ocorrências', '% do total'], rows: errs.map((r) => [r.status, r.n, `${fixed((r.n / total) * 100, 2)}%`]) });
    rep.sections.push({ title: 'Rotas com mais erros', columns: ['Rota', 'Código', 'Ocorrências'], rows: top.map((r) => [r.r, r.status, r.n]) });
    summary.push(['Erros (HTTP ≥ 400)', `${nErr} (${fixed((nErr / total) * 100, 2)}%)`]);
  }
  rep.summary = summary;
  return rep;
}

// ====================================================================== RF12 — relatório de engajamento
export function engagementReport(ctx, viewer, d) {
  const { db } = ctx;
  const { s, e, lo, hi } = periodBounds(d);
  let cat = d.category_id;
  const loc = cleanStr(d.location, 80);
  const itype = d.interaction_type;
  if (itype && !has(INTERACTION_LABEL, itype)) fail('validation', 'Tipo de interação inválido.', 422, { fields: { interaction_type: 'Tipo de interação inválido.' } });
  let catName = null;
  if (cat !== null && cat !== undefined && cat !== '') {
    cat = toInt(cat);
    if (cat === null) fail('validation', 'Categoria inválida.', 422);
    const row = db.get('SELECT name FROM categories WHERE id=?', cat);
    if (!row) fail('validation', 'Categoria inválida.', 422);
    catName = row.name;
  } else cat = null;
  const rep = base('engajamento', 'Relatório de engajamento', s, e, [
    ['Período', `${fmtDayBR(s)} a ${fmtDayBR(e)}`], ['Categoria', catName || 'Todas'], ['Localização', loc || 'Todas'], ['Tipo de interação', INTERACTION_LABEL[itype] || 'Todas']]);
  let where = 'i.ts>=? AND i.ts<?';
  const args = [lo, hi];
  if (cat) { where += ' AND i.category_id=?'; args.push(cat); }
  if (loc) { where += ' AND i.location LIKE ?'; args.push(`%${loc}%`); }
  if (itype) { where += ' AND i.type=?'; args.push(itype); }
  const n = db.val(`SELECT COUNT(*) FROM interactions i WHERE ${where}`, ...args);
  if (n === 0) { rep.empty = true; rep.empty_message = 'Não existem dados de engajamento disponíveis para os filtros selecionados.'; return rep; } // RN29 / RF12.14
  const q1 = (extra = '') => db.val(`SELECT COUNT(*) FROM interactions i WHERE ${where}${extra}`, ...args);
  const accesses = q1(" AND i.type='acesso'");
  const active = db.val(`SELECT COUNT(DISTINCT i.user_id) FROM interactions i WHERE ${where} AND i.user_id IS NOT NULL`, ...args);
  const reqs = q1(" AND i.type='solicitacao'");
  const avg = active ? n / active : 0;
  rep.summary = [['Acessos à plataforma', accesses], ['Usuários ativos', active], ['Solicitações de serviço', reqs], ['Total de interações', n], ['Média de interações por usuário', fixed(avg, 2)]];
  const byType = db.all(`SELECT i.type AS type, COUNT(*) n FROM interactions i WHERE ${where} GROUP BY i.type ORDER BY n DESC`, ...args);
  rep.sections.push({ title: 'Interações por tipo', columns: ['Tipo', 'Quantidade'], rows: byType.map((r) => [INTERACTION_LABEL[r.type], r.n]) });
  const cats = db.all(`SELECT c.name, COUNT(*) n FROM interactions i JOIN categories c ON c.id=i.category_id
    WHERE ${where} AND i.category_id IS NOT NULL GROUP BY c.id ORDER BY n DESC LIMIT 10`, ...args);
  rep.sections.push({ title: 'Categorias de serviço mais acessadas', columns: ['Categoria', 'Interações'], rows: cats.map((r) => [r.name, r.n]) });
  const workers = db.all(`SELECT u.name, u.city||'/'||u.uf AS loc,
      SUM(i.type='visualizacao_perfil') AS views, SUM(i.type='solicitacao') AS reqs, SUM(i.type='mensagem') AS msgs, COUNT(*) AS n
    FROM interactions i JOIN users u ON u.id=i.worker_id WHERE ${where} AND i.worker_id IS NOT NULL
    GROUP BY i.worker_id ORDER BY n DESC LIMIT 10`, ...args);
  rep.sections.push({ title: 'Profissionais mais procurados', columns: ['Profissional', 'Localização', 'Visualizações', 'Solicitações', 'Conversas', 'Total'],
    rows: workers.map((r) => [r.name, r.loc, r.views, r.reqs, r.msgs, r.n]) });
  const daily = db.all(`SELECT substr(i.ts,1,10) AS d, COUNT(*) n, COUNT(DISTINCT i.user_id) u FROM interactions i WHERE ${where} GROUP BY d ORDER BY d`, ...args);
  rep.sections.push({ title: 'Evolução diária', columns: ['Data (UTC)', 'Interações', 'Usuários ativos'], rows: daily.map((r) => [fmtDayBR(r.d), r.n, r.u]) });
  return rep;
}

// ====================================================================== RF13 — relatório de satisfação
export function satisfactionReport(ctx, viewer, d) {
  const { db, cfg } = ctx;
  const { s, e, lo, hi } = periodBounds(d);
  const isAdmin = viewer.role === 'admin';
  const wp = getProfile(db, viewer.id);
  if (!isAdmin && !wp) fail('forbidden', 'Somente administradores e trabalhadores acessam o relatório de satisfação.', 403);
  let workerId = d.worker_id;
  if (!isAdmin) workerId = viewer.id; // RF13.9 — o trabalhador só vê as próprias avaliações
  else if (workerId === '' || workerId === null || workerId === undefined) workerId = null;
  const cat = d.category_id || null;
  let where = 'rv.hidden=0 AND rv.created_at>=? AND rv.created_at<?';
  const args = [lo, hi];
  let catName = null, workerName = null;
  if (cat) {
    const ci = toInt(cat);
    const row = ci === null ? null : db.get('SELECT name FROM categories WHERE id=?', ci);
    if (!row) fail('validation', 'Categoria inválida.', 422);
    catName = row.name; where += ' AND rv.category_id=?'; args.push(ci);
  }
  if (workerId) {
    const wi = toInt(workerId);
    const row = wi === null ? null : db.get('SELECT name FROM users WHERE id=?', wi);
    if (!row) fail('validation', 'Trabalhador inválido.', 422);
    workerName = row.name; where += ' AND rv.worker_id=?'; args.push(wi);
  }
  const rep = base('satisfacao', 'Relatório de satisfação', s, e, [['Período', `${fmtDayBR(s)} a ${fmtDayBR(e)}`], ['Categoria', catName || 'Todas'], ['Trabalhador', workerName || 'Todos']]);
  const stats = db.get(`SELECT COUNT(*) n, AVG(rating) a FROM reviews rv WHERE ${where}`, ...args);
  if (!stats.n) { rep.empty = true; rep.empty_message = 'Não existem avaliações para os filtros selecionados.'; return rep; } // RF13.13
  const n = stats.n;
  const dist = Object.fromEntries(db.all(`SELECT rating, COUNT(*) c FROM reviews rv WHERE ${where} GROUP BY rating`, ...args).map((r) => [r.rating, r.c]));
  const g = (k) => dist[k] || 0;
  const sat = g(4) + g(5), insat = g(1) + g(2);
  rep.summary = [['Média geral das avaliações', fixed(stats.a, 2)], ['Quantidade de avaliações', n],
    ['Clientes satisfeitos (nota 4–5)', `${fixed((sat / n) * 100, 1)}%`], ['Clientes insatisfeitos (nota 1–2)', `${fixed((insat / n) * 100, 1)}%`]];
  rep.sections.push({ title: 'Distribuição das notas', columns: ['Nota', 'Avaliações', 'Percentual'], rows: [5, 4, 3, 2, 1].map((k) => [`${k} estrela(s)`, g(k), `${fixed((g(k) / n) * 100, 1)}%`]) });
  if (isAdmin && !workerId) {
    const per = db.all(`SELECT u.name, AVG(rv.rating) a, COUNT(*) c FROM reviews rv JOIN users u ON u.id=rv.worker_id
      WHERE ${where} GROUP BY rv.worker_id ORDER BY a DESC, c DESC LIMIT 200`, ...args);
    rep.sections.push({ title: 'Média por trabalhador', columns: ['Trabalhador', 'Média', 'Avaliações'], rows: per.map((r) => [r.name, fixed(r.a, 2), r.c]) });
  }
  const trunc = [];
  const revs = cap(ctx, db.all(`SELECT rv.created_at, cu.name AS cn, wu.name AS wn, r.service_name, rv.rating, rv.comment
    FROM reviews rv JOIN users cu ON cu.id=rv.client_id JOIN users wu ON wu.id=rv.worker_id JOIN requests r ON r.id=rv.request_id
    WHERE ${where} ORDER BY rv.created_at DESC LIMIT ${cfg.REPORT_MAX_ROWS + 1}`, ...args), trunc);
  rep.truncated = trunc.length > 0;
  const who = (name) => { // privacidade: o trabalhador vê o cliente só por nome e inicial
    if (isAdmin) return name;
    const parts = name.split(/\s+/).filter(Boolean);
    return parts[0] + (parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '');
  };
  rep.sections.push({ title: 'Avaliações e comentários', columns: ['Data', 'Cliente', 'Trabalhador', 'Serviço', 'Nota', 'Comentário'],
    rows: revs.map((r) => [fmtLocal(r.created_at), who(r.cn), r.wn, r.service_name, r.rating, r.comment || '']) });
  return rep;
}

export const BUILDERS = { usuario: userReport, software: softwareReport, engajamento: engagementReport, satisfacao: satisfactionReport };
export const FORMATS = { usuario: ['pdf', 'csv'], software: ['xlsx'], engajamento: ['pdf', 'csv'], satisfacao: ['pdf', 'csv'] };
