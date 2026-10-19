// Utilidades: tempo (fixo em America/Sao_Paulo, UTC-3 sem horário de verão), validações e geografia.
// "Datas locais" são representadas como Date deslocado -3h, lido sempre com getUTC*.
export const LOCAL_OFFSET_MIN = -180;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const ms = { MIN, HOUR, DAY };

let clockOverride = null; // apenas testes
export function setClock(d) { clockOverride = d; }
export function utcnow() {
  if (clockOverride) return new Date(clockOverride.getTime());
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}
export const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nowIso = () => iso(utcnow());
export const parseIso = (s) => new Date(s);
export const addMs = (d, n) => new Date(d.getTime() + n);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const addHours = (d, n) => new Date(d.getTime() + n * HOUR);
export const addMinutes = (d, n) => new Date(d.getTime() + n * MIN);

const p2 = (n) => String(n).padStart(2, '0');
export const toLocal = (d) => new Date(new Date(d).getTime() + LOCAL_OFFSET_MIN * MIN);
export const localDateStr = (d) => { const l = toLocal(d); return `${l.getUTCFullYear()}-${p2(l.getUTCMonth() + 1)}-${p2(l.getUTCDate())}`; };
export const localHHMM = (d) => { const l = toLocal(d); return `${p2(l.getUTCHours())}:${p2(l.getUTCMinutes())}`; };
export const localMinutes = (d) => { const l = toLocal(d); return l.getUTCHours() * 60 + l.getUTCMinutes(); };
// weekday: segunda=0 … domingo=6 (igual ao Python)
export const localWeekday = (d) => (toLocal(d).getUTCDay() + 6) % 7;
export function dateWeekday(dateStr) { const [y, m, dd] = dateStr.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7; }

export function localToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - LOCAL_OFFSET_MIN * MIN);
}
export function localDayBounds(dateStr) { const s = localToUtc(dateStr, '00:00'); return [s, new Date(s.getTime() + DAY)]; }

export function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return s; // mantemos a string normalizada
}
export const dateToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const dateStr = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
export const addDateDays = (s, n) => dateStr(new Date(dateToDate(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((dateToDate(a) - dateToDate(b)) / DAY);
export const fmtDayBR = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

export function parseHHMM(s) {
  if (typeof s !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return null;
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
}
export const fmtHHMM = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;

// ---------------------------------------------------------------- texto
export function normText(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function cleanStr(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return max ? [...s].slice(0, max).join('') : s;
}

// ---------------------------------------------------------------- validações
export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
export function validCpf(raw) {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11 || cpf === cpf[0].repeat(11)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(cpf[n])) return false;
  }
  return true;
}
export function maskCpf(cpf) { const d = onlyDigits(cpf); return d.length === 11 ? `***.***.***-${d.slice(-2)}` : '***'; }
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$/;
export const validEmail = (s) => !!s && s.length <= 254 && EMAIL_RE.test(s);
export const validPhone = (s) => { const n = onlyDigits(s).length; return n >= 10 && n <= 13; };

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return null;
  const rad = (x) => (x * Math.PI) / 180, r = 6371;
  const p1 = rad(lat1), p2_ = rad(lat2), dphi = p2_ - p1, dl = rad(lng2 - lng1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2_) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
export function money(v) {
  const [i, d] = Number(v).toFixed(2).split('.');
  return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
}
export function csvSafe(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s && '=+-@\t\r'.includes(s[0]) ? "'" + s : s;
}
// arredondamento "bancário" do Python round(x, n) não é necessário; usamos toFixed
export const round2 = (x) => Math.round(x * 100) / 100;
export const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
/** d.get(k, def) do Python: valor da chave se existir (mesmo null), senão o padrão. */
export const pick = (o, k, def) => (has(o, k) ? o[k] : def);
export const isNil = (v) => v === null || v === undefined;
export const isTrue = (v) => !!v && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
/** Equivalente ao strptime("%Y-%m-%dT%H:%M:%SZ"): retorna Date ou null. */
export function parseIsoStrict(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || iso(d) !== s ? null : d;
}
export const todayUtcStr = () => new Date().toISOString().slice(0, 10);
