// RF08 / UC06 — busca de trabalhadores por localização, categoria e disponibilidade.
import { fail, login, ok, pageArgs, toInt, track } from '../api.js';
import { findCity } from '../cities.js';
import { addDays, cleanStr, dateWeekday, haversineKm, iso, localToUtc, normText, nowIso, parseDate, parseHHMM, utcnow } from '../util.js';
import { toFloat } from './auth.js';

const SORTS = ['proximidade', 'avaliacao', 'popularidade', 'preco'];
const p2 = (n) => String(n).padStart(2, '0');

/** Disponibilidade no perfil (e sem conflito, se houver data+horário). RN17/RN18. */
function available(db, wpId, userId, date, tFrom, tTo) {
  const d = parseDate(date);
  const wins = db.all('SELECT weekday,start_time,end_time FROM availability WHERE worker_profile_id=?', wpId);
  if (d === null) return wins.length > 0;
  const wd = dateWeekday(d);
  const dayWins = wins.filter((w) => w.weekday === wd).map((w) => [parseHHMM(w.start_time), parseHHMM(w.end_time)]);
  if (!dayWins.length) return false;
  const s = tFrom ? parseHHMM(tFrom) : null;
  let e = tTo ? parseHHMM(tTo) : null;
  if (s === null) return true;
  if (e === null) e = s + 30;
  if (!dayWins.some(([ws, we]) => ws <= s && e <= we)) return false;
  const st = localToUtc(date, tFrom);
  const en = localToUtc(date, tTo || `${p2(Math.min(23, Math.floor(e / 60)))}:${p2(e % 60)}`);
  return !db.get(`SELECT 1 AS x FROM requests WHERE worker_id=? AND status IN ('aguardando_resposta','em_negociacao','agendada')
                  AND scheduled_start < ? AND scheduled_end > ?`, userId, iso(en), iso(st));
}

const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) { const x = Number(a[i]), y = Number(b[i]); if (x !== y) return x < y ? -1 : 1; } return 0; };
const round = (v, n) => (v === null || v === undefined ? null : Math.round(v * 10 ** n) / 10 ** n);

export default function routes(r) {
  r.get('/workers/search', login((ctx) => {
    const { db, user } = ctx, q = ctx.args;
    const { page, size, offset } = pageArgs(ctx, 12, 50);
    let sort = q.get('sort') || '';
    if (sort && !SORTS.includes(sort)) fail('validation', 'Ordenação inválida.', 422, { fields: { sort: 'Escolha: avaliação, popularidade, preço ou proximidade.' } });
    // localização de referência (RF08.4). Sem informar, usa a do cadastro do cliente.
    const city = cleanStr(q.get('city'), 80), uf = cleanStr(q.get('uf'), 2).toUpperCase();
    let lat = null, lng = null;
    if (q.get('lat') && q.get('lng')) {
      lat = toFloat(q.get('lat')); lng = toFloat(q.get('lng'));
      if (lat === null || lng === null || !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) fail('validation', 'Coordenadas inválidas.', 422, { fields: { lat: 'Coordenadas inválidas.' } });
    }
    let refLabel = null;
    if (lat === null && city) {
      const known = findCity(city, uf);
      if (known) { lat = known.lat; lng = known.lng; refLabel = `${known.name}/${known.uf}`; }
      else refLabel = uf ? `${city}/${uf}` : city;
    } else if (lat !== null) refLabel = city ? `${city}/${uf}` : 'sua posição';
    let cat = null;
    if (q.get('category_id')) {
      cat = toInt(q.get('category_id'));
      if (cat === null) fail('validation', 'Categoria inválida.', 422, { fields: { category_id: 'Categoria inválida.' } });
    }
    const date = q.get('date'), tFrom = q.get('from'), tTo = q.get('to');
    if (date && !parseDate(date)) fail('validation', 'Data inválida.', 422, { fields: { date: 'Data inválida.' } });
    for (const [key, val] of [['from', tFrom], ['to', tTo]]) if (val && parseHHMM(val) === null) fail('validation', 'Horário inválido.', 422, { fields: { [key]: 'Use HH:MM.' } });
    if (tFrom && tTo && parseHHMM(tFrom) >= parseHHMM(tTo)) fail('validation', 'O horário inicial deve ser anterior ao final.', 422, { fields: { to: 'Horário final deve ser maior.' } });
    const weekday = q.get('weekday');
    let maxKm = null;
    if (q.get('max_km')) {
      maxKm = toFloat(q.get('max_km'));
      if (maxKm === null) fail('validation', 'Distância inválida.', 422, { fields: { max_km: 'Distância inválida.' } });
    }
    const text = normText(q.get('q') || '');

    const now = nowIso();
    let sql = `SELECT wp.id AS profile_id, wp.user_id, u.name, u.city, u.uf, u.lat, u.lng, wp.service_area, wp.radius_km,
        wp.description, wp.verification_status,
        (SELECT AVG(rating) FROM reviews r WHERE r.worker_id=u.id AND r.hidden=0) AS avg_rating,
        (SELECT COUNT(*) FROM reviews r WHERE r.worker_id=u.id AND r.hidden=0) AS review_count,
        (SELECT COUNT(*) FROM requests r WHERE r.worker_id=u.id AND r.status='concluida') AS jobs_done,
        (SELECT AVG(base_rate) FROM services s WHERE s.worker_id=wp.id AND s.deleted_at IS NULL) AS avg_rate,
        (SELECT MIN(base_rate) FROM services s WHERE s.worker_id=wp.id AND s.deleted_at IS NULL) AS min_rate,
        (SELECT COUNT(*) FROM interactions i WHERE i.worker_id=u.id AND i.type='visualizacao_perfil' AND i.ts>=?) AS views30
        FROM worker_profiles wp JOIN users u ON u.id=wp.user_id
        WHERE wp.deleted_at IS NULL AND wp.status!='bloqueado' AND u.status='ativo' AND u.id!=?
          AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.cancelled_at IS NULL AND s.start_at<=? AND s.end_at>?)`;
    const args = [iso(addDays(utcnow(), -30)), user.id, now, now];
    if (cat) {
      sql += ` AND (EXISTS (SELECT 1 FROM worker_categories wc WHERE wc.worker_profile_id=wp.id AND wc.category_id=?)
                OR EXISTS (SELECT 1 FROM services s WHERE s.worker_id=wp.id AND s.category_id=? AND s.deleted_at IS NULL))`;
      args.push(cat, cat);
    }
    const cands = db.all(sql, ...args);
    let wdFilter = null;
    if (weekday !== null && weekday !== '') {
      wdFilter = toInt(weekday);
      if (wdFilter === null || wdFilter < 0 || wdFilter > 6) fail('validation', 'Dia da semana inválido.', 422, { fields: { weekday: 'Dia da semana inválido.' } });
    }

    let results = [];
    for (const w of cands) {
      const dist = lat !== null ? haversineKm(lat, lng, w.lat, w.lng) : null;
      if (refLabel) {
        if (dist !== null) { if (dist > (maxKm || w.radius_km)) continue; }
        else {
          const sameCity = normText(w.city) === normText(city) && (!uf || w.uf === uf);
          if (!sameCity && !normText(w.service_area).includes(normText(city))) continue;
        }
      }
      if (text) {
        const hay = normText([w.name, w.service_area, w.description || ''].join(' '));
        const svcNames = db.all('SELECT name FROM services WHERE worker_id=? AND deleted_at IS NULL', w.profile_id).map((x) => normText(x.name)).join(' ');
        if (!hay.includes(text) && !svcNames.includes(text)) continue;
      }
      if (date || wdFilter !== null) {
        if (date) { if (!available(db, w.profile_id, w.user_id, date, tFrom, tTo)) continue; }
        else if (!db.get('SELECT 1 AS x FROM availability WHERE worker_profile_id=? AND weekday=?', w.profile_id, wdFilter)) continue;
      }
      w.distance_km = dist !== null ? round(dist, 1) : null;
      results.push(w);
    }

    if (!sort) sort = lat !== null ? 'proximidade' : 'avaliacao';
    const keyfns = {
      proximidade: (w) => [w.distance_km === null, w.distance_km || 0, -(w.avg_rating || 0)],
      avaliacao: (w) => [-(w.avg_rating || 0), -w.review_count, w.distance_km || 0],
      popularidade: (w) => [-w.jobs_done, -w.views30, -(w.avg_rating || 0)],
      preco: (w) => [w.avg_rate === null, w.avg_rate || 0, 0],
    };
    const kf = keyfns[sort];
    results = results.map((w) => [kf(w), w]).sort((a, b) => cmpKey(a[0], b[0])).map((x) => x[1]);
    const total = results.length;
    const pageItems = results.slice(offset, offset + size);
    for (const w of pageItems) {
      const pid = w.profile_id;
      w.categories = db.all('SELECT c.id,c.name FROM categories c JOIN worker_categories wc ON wc.category_id=c.id WHERE wc.worker_profile_id=? ORDER BY c.name', pid);
      w.availability = db.all('SELECT weekday,start_time,end_time FROM availability WHERE worker_profile_id=? ORDER BY weekday,start_time', pid)
        .map((x) => ({ weekday: x.weekday, start: x.start_time, end: x.end_time }));
      w.services = db.all('SELECT id,name,base_rate FROM services WHERE worker_id=? AND deleted_at IS NULL ORDER BY base_rate LIMIT 3', pid);
      w.avg_rating = round(w.avg_rating, 2);
      w.avg_rate = round(w.avg_rate, 2);
      for (const k of ['lat', 'lng', 'views30', 'profile_id']) delete w[k];
    }
    track(ctx, 'busca', { categoryId: cat, location: refLabel || `${user.city}/${user.uf}` });
    let msg = null;
    if (!total) msg = refLabel ? 'Nenhum trabalhador disponível na localização pesquisada.' : 'Nenhum trabalhador encontrado para os critérios informados.';
    return ok({ items: pageItems, total, page, size, sort, reference: { label: refLabel, lat, lng }, message: msg });
  }));
}
