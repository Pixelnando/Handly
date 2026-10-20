/* Biblioteca de interface do Handly: DOM seguro, cliente da API, formulários, diálogos, formatação. */

export const state = { me: null, summary: { unread_messages: 0, unread_notifications: 0, maintenance: [] } };
export const TZ = "America/Sao_Paulo";

/* ------------------------------------------------------------------ DOM (nunca innerHTML) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected" || k === "hidden" || k === "required" || k === "multiple") el[k] = !!v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); return append(el, children); }

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  chat: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bell: "M6 17V11a6 6 0 1 1 12 0v6l2 2H4l2-2zM10 21a2 2 0 0 0 4 0",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  doc: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6",
  tool: "M14.7 6.3a4 4 0 0 0 5 5L21 16l-3 3-4.7-1.3L7 24",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  money: "M3 7h18v10H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  home: "M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9z",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  clipboard: "M9 4h6v3H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 12h6M9 16h6",
  send: "M4 12l16-8-6 16-3-7-7-1z",
  inbox: "M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  menu: "M4 7h16M4 12h16M4 17h16",
};

export function icon(name, cls = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", ICONS[name] || ICONS.doc);
  svg.append(p);
  return svg;
}

export function stars(value, { size } = {}) {
  const wrap = h("span", { class: "stars", role: "img", "aria-label": value ? `Nota ${Number(value).toFixed(1)} de 5` : "Sem avaliações" });
  for (let i = 1; i <= 5; i++) {
    const svg = icon("star", "star" + (value && value >= i - 0.25 ? " on" : ""));
    if (size) svg.style.width = svg.style.height = size;
    wrap.append(svg);
  }
  return wrap;
}

export function logoMark() {
  // Ícone da marca: mão com o indicador apontando (contorno em vermelho claro, definido por token).
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "logo-mark");
  svg.style.width = svg.style.height = "1.5em";
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "rotate(-35 24 24)");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", "M19 25V11a3.2 3.2 0 0 1 6.4 0v11M25.4 21.5h2.4a3.2 3.2 0 0 1 3.2 3.2M31 24.7h1.6a3.2 3.2 0 0 1 3.2 3.2M35.8 27.9V33c0 6.4-4.4 10-10.4 10h-3.6c-3.2 0-5.6-1.8-7.4-4.6l-5-8a3.2 3.2 0 0 1 5.4-3.4L19 32");
  p.setAttribute("fill", "none"); p.setAttribute("stroke-width", "3.4"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  p.style.stroke = "var(--hd-red-light)";
  g.append(p); svg.append(g);
  return svg;
}
// Logotipo completo: ícone + "hand" (verde claro) + "ly" (vermelho claro).
export function logoFull() {
  return [logoMark(), h("span", { class: "wordmark" }, h("span", { class: "wm-hand" }, "hand"), h("span", { class: "wm-ly" }, "ly"))];
}

/* ------------------------------------------------------------------ formatação */
const nf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (v) => (v === null || v === undefined || v === "" ? "—" : nf.format(Number(v)));
const fDate = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fLong = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" });
export const fmtDate = (iso) => (iso ? fDate.format(new Date(iso)) : "—");
export const fmtDateTime = (iso) => (iso ? fDateTime.format(new Date(iso)).replace(",", "") : "—");
export const fmtTime = (iso) => (iso ? fTime.format(new Date(iso)) : "—");
export const fmtLong = (iso) => (iso ? fLong.format(new Date(iso)) : "—");
export const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
export const WEEKDAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
export const WEEKDAYS_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export function fmtDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${WEEKDAYS_SHORT[(d.getUTCDay() + 6) % 7]}, ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function dateBr(dateStr) { const [y, m, d] = dateStr.split("-"); return `${d}/${m}/${y}`; }
export function addDays(dateStr, n) { const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function localParts(iso) {
  // devolve {date:'AAAA-MM-DD', time:'HH:MM'} no fuso do sistema
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function initials(name) { return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join(""); }
export function maskCpfInput(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
export function maskPhoneInput(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export const STATUS_CHIP = {
  aguardando_resposta: ["pending", "Aguardando resposta"], em_negociacao: ["pending", "Em negociação"], agendada: ["positive", "Agendada"],
  concluida: ["positive", "Concluída"], cancelada: ["negative", "Cancelada"], recusada: ["negative", "Recusada"], expirada: ["", "Expirada"],
};
export function statusChip(status) {
  const [cls, label] = STATUS_CHIP[status] || ["", status];
  return h("span", { class: `chip ${cls}` }, label);
}

/* ------------------------------------------------------------------ API */
export class ApiErr extends Error {
  constructor(status, body) {
    const e = (body && body.error) || {};
    super(e.message || "Não foi possível concluir a operação. Tente novamente.");
    this.status = status; this.code = e.code || "error"; this.fields = e.fields || {}; this.extra = e;
  }
}

export async function api(method, path, data, opts = {}) {
  const init = { method, headers: { "X-Requested-With": "XMLHttpRequest" }, credentials: "same-origin" };
  if (data instanceof FormData) init.body = data;
  else if (data !== undefined && data !== null && method !== "GET") { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(data); }
  let url = "/api" + path;
  if (method === "GET" && data) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) if (v !== "" && v !== null && v !== undefined) qs.set(k, v);
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  let res;
  try { res = await fetch(url, init); }
  catch { throw new ApiErr(0, { error: { code: "network", message: "Sem conexão com o servidor. Verifique sua internet e tente novamente." } }); }
  if (opts.blob && res.ok) return { blob: await res.blob(), filename: res.headers.get("X-Filename") || "relatorio" };
  let body = null;
  try { body = await res.json(); } catch { /* resposta sem corpo */ }
  if (!res.ok) {
    const err = new ApiErr(res.status, body);
    if (res.status === 401 && !opts.quiet401 && ["unauthenticated", "session_expired"].includes(err.code)) {
      document.dispatchEvent(new CustomEvent("hd:unauthorized", { detail: err }));
    }
    throw err;
  }
  return body;
}
api.get = (p, q, o) => api("GET", p, q, o);
api.post = (p, d, o) => api("POST", p, d ?? {}, o);
api.put = (p, d, o) => api("PUT", p, d ?? {}, o);
api.del = (p, d, o) => api("DELETE", p, d ?? {}, o);

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------ avisos, toasts, diálogos */
let toastBox;
export function toast(message, kind = "ok") {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  const t = h("div", { class: `toast ${kind === "error" ? "error" : ""}`, role: kind === "error" ? "alert" : undefined }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 4500);
}

export function notice(message, kind = "") {
  return h("div", { class: `notice ${kind}`, role: kind === "error" ? "alert" : "status" }, message);
}

export function empty(message, ico = "inbox", action) {
  return h("div", { class: "empty" }, icon(ico), h("p", null, message), action || null);
}

export function loading() {
  return h("div", { class: "stack", "aria-busy": "true", "aria-label": "Carregando" },
    h("div", { class: "skeleton", style: "width:40%;height:28px" }), h("div", { class: "skeleton", style: "height:90px" }), h("div", { class: "skeleton", style: "height:90px" }));
}

export function dialog({ title, content, actions, onClose, labelledBy = "dlg-title" }) {
  const previous = document.activeElement;
  const box = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy },
    h("h2", { id: labelledBy }, title), content, actions ? h("div", { class: "form-actions" }, actions) : null);
  const overlay = h("div", { class: "overlay" }, box);
  const close = (result) => {
    overlay.remove(); document.removeEventListener("keydown", onKey, true);
    if (previous && previous.focus) previous.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(null); return; }
    if (e.key === "Tab") {
      const f = [...box.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  const firstField = box.querySelector("input,select,textarea") || box.querySelector("button");
  (firstField || box).focus?.();
  return { close, box };
}

/** Confirmação com campos opcionais. Resolve com os valores (objeto) ou null se cancelado. */
export function confirmDialog({ title, message, confirmLabel = "Confirmar", cancelLabel = "Voltar", danger = false, fields = [] }) {
  return new Promise((resolve) => {
    const fs = fields.map((f) => field(f));
    const errBox = h("div");
    const content = h("div", { class: "stack" }, typeof message === "string" ? h("p", null, message) : message, ...fs.map((f) => f.el), errBox);
    let dlg;
    const ok = h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "button", onClick: () => {
      let bad = false;
      for (const f of fs) { f.error(""); if (f.required && !f.isFilled()) { f.error("Campo obrigatório."); bad = true; } }
      if (bad) return;
      dlg.close(Object.fromEntries(fs.map((f) => [f.name, f.get()])) || {});
    } }, confirmLabel);
    const cancel = h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, cancelLabel);
    dlg = dialog({ title, content, actions: [cancel, ok], onClose: resolve });
  });
}

/* ------------------------------------------------------------------ campos de formulário */
let uid = 0;
export function field(o) {
  const id = o.id || `f${++uid}-${o.name || "x"}`;
  const hintId = `${id}-hint`, errId = `${id}-err`;
  const type = o.type || "text";
  let control, getter, setter, focusEl;
  const common = { id, name: o.name, required: o.required, disabled: o.disabled, "aria-describedby": [o.hint ? hintId : "", errId].filter(Boolean).join(" ") };
  if (type === "textarea") {
    control = h("textarea", { class: "textarea", rows: o.rows || 4, maxlength: o.maxlength, placeholder: o.placeholder, ...common });
    control.value = o.value ?? "";
    getter = () => control.value.trim(); setter = (v) => { control.value = v ?? ""; };
  } else if (type === "select") {
    control = h("select", { class: "select", ...common },
      o.placeholder !== undefined ? h("option", { value: "" }, o.placeholder) : null,
      ...(o.options || []).map((op) => h("option", { value: op.value, selected: String(op.value) === String(o.value ?? "") }, op.label)));
    getter = () => control.value; setter = (v) => { control.value = v ?? ""; };
  } else if (type === "checkbox") {
    control = h("input", { type: "checkbox", ...common });
    control.checked = !!o.value;
    getter = () => control.checked; setter = (v) => { control.checked = !!v; };
  } else if (type === "checkgroup" || type === "radiogroup") {
    const multi = type === "checkgroup";
    const vals = new Set((multi ? (o.value || []) : [o.value]).map(String));
    const inputs = (o.options || []).map((op, i) => {
      const inp = h("input", { type: multi ? "checkbox" : "radio", name: o.name + (multi ? "" : `-${id}`), value: op.value, id: `${id}-${i}` });
      inp.checked = vals.has(String(op.value));
      return { inp, el: h("label", { class: "check", for: `${id}-${i}` }, inp, h("span", null, op.label)) };
    });
    control = h("div", { class: "check-group", role: multi ? "group" : "radiogroup", "aria-labelledby": `${id}-lbl`, id });
    inputs.forEach((x) => control.append(x.el));
    getter = () => (multi ? inputs.filter((x) => x.inp.checked).map((x) => x.inp.value) : (inputs.find((x) => x.inp.checked) || { inp: { value: "" } }).inp.value);
    setter = (v) => { const s = new Set((multi ? v || [] : [v]).map(String)); inputs.forEach((x) => { x.inp.checked = s.has(x.inp.value); }); };
    focusEl = inputs[0]?.inp;
  } else {
    control = h("input", { class: "input", type: type === "number" ? "number" : type, placeholder: o.placeholder, maxlength: o.maxlength, min: o.min, max: o.max, step: o.step,
      autocomplete: o.autocomplete, inputmode: o.inputmode, pattern: o.pattern, ...common });
    control.value = o.value ?? "";
    if (o.mask) control.addEventListener("input", () => { control.value = o.mask(control.value); });
    getter = () => control.value.trim(); setter = (v) => { control.value = v ?? ""; };
  }
  focusEl = focusEl || control;
  const errEl = h("div", { class: "err", id: errId, role: "alert" });
  errEl.hidden = true;
  let pwBtn = null;
  let inner = control;
  if (type === "password") {
    pwBtn = h("button", { class: "pw-toggle", type: "button", "aria-label": "Mostrar senha", "aria-pressed": "false", onClick: () => {
      const show = control.type === "password";
      control.type = show ? "text" : "password"; pwBtn.textContent = show ? "Ocultar" : "Mostrar";
      pwBtn.setAttribute("aria-pressed", String(show)); pwBtn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    } }, "Mostrar");
    inner = h("div", { class: "pw-wrap" }, control, pwBtn);
  }
  const isInline = type === "checkbox";
  const label = h("label", { for: id, id: `${id}-lbl`, class: isInline ? "check" : undefined }, isInline ? control : null,
    isInline ? h("span", null, o.label) : o.label, o.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null);
  const el = h("div", { class: "field" + (o.class ? " " + o.class : "") },
    type === "checkgroup" || type === "radiogroup" ? h("span", { class: "legend", id: `${id}-lbl` }, o.label, o.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null) : label,
    isInline ? null : inner,
    o.hint ? h("div", { class: "hint", id: hintId }, o.hint) : null, errEl);
  return {
    el, input: control, name: o.name, required: !!o.required, type,
    get: () => (o.transform ? o.transform(getter()) : getter()),
    set: setter,
    isFilled: () => { const v = getter(); return Array.isArray(v) ? v.length > 0 : type === "checkbox" ? v : v !== "" && v !== null; },
    error(msg) {
      errEl.textContent = msg || ""; errEl.hidden = !msg;
      if (type !== "checkgroup" && type !== "radiogroup") control.setAttribute("aria-invalid", msg ? "true" : "false");
    },
    focus: () => focusEl.focus(),
  };
}

/** Formulário completo com validação de obrigatórios, mapeamento de erros da API e estado de envio. */
export function form(fields, { onSubmit, submitLabel = "Salvar", cancel, className = "form-grid", submitClass = "btn-primary", extra, noActions, actionsClass }) {
  const map = Object.fromEntries(fields.filter((f) => f.name).map((f) => [f.name, f]));
  const banner = h("div", { class: "full" });
  const submit = h("button", { class: `btn ${submitClass}`, type: "submit" }, submitLabel);
  const el = h("form", { novalidate: true }, h("div", { class: className }, ...fields.map((f) => f.el), banner),
    extra || null, noActions ? null : h("div", { class: actionsClass || "form-actions" }, cancel || null, submit));
  const values = () => Object.fromEntries(fields.filter((f) => f.name).map((f) => [f.name, f.get()]));
  const setBusy = (b) => {
    submit.disabled = b; submit.setAttribute("aria-busy", String(b));
    if (b) { submit.dataset.label = submit.textContent; mount(submit, h("span", { class: "spinner" }), "Aguarde…"); } else if (submit.dataset.label) { mount(submit, submit.dataset.label); }
  };
  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    mount(banner);
    let first = null;
    for (const f of fields) {
      if (!f.name) continue;
      f.error("");
      if (f.required && !f.isFilled()) { f.error("Campo obrigatório."); first = first || f; }
    }
    if (first) { first.focus(); mount(banner, notice("Preencha os campos obrigatórios.", "error")); return; }
    setBusy(true);
    try { await onSubmit(values(), map); }
    catch (err) {
      if (!(err instanceof ApiErr)) { console.error(err); mount(banner, notice("Ocorreu um erro inesperado. Tente novamente.", "error")); }
      else {
        let firstBad = null;
        for (const [k, msg] of Object.entries(err.fields || {})) { const f = map[k] || map[k.replace(/^answers\./, "a")]; if (f) { f.error(msg); firstBad = firstBad || f; } }
        mount(banner, notice(err.message, "error"));
        if (firstBad) firstBad.focus();
      }
    } finally { setBusy(false); }
  });
  return { el, fields: map, values, submit, setBusy, banner };
}

/** Campo com autocompletar de cidade (usa /locations/cities). */
export function cityPicker({ city = "", uf = "", required = true } = {}) {
  const cityF = field({ name: "city", label: "Cidade", value: city, required, autocomplete: "off", maxlength: 80 });
  const ufF = field({ name: "uf", label: "UF", type: "text", value: uf, required, maxlength: 2, autocomplete: "off", class: "uf" });
  const list = h("div", { class: "suggestions", role: "listbox", hidden: true });
  const wrap = h("div", { class: "autocomplete" }, cityF.el, list);
  let timer;
  cityF.input.setAttribute("role", "combobox");
  cityF.input.setAttribute("aria-autocomplete", "list");
  cityF.input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = cityF.input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api.get("/locations/cities", { q });
        mount(list, ...r.cities.map((c) => h("button", { type: "button", role: "option", onClick: () => { cityF.set(c.name); ufF.set(c.uf); list.hidden = true; } }, `${c.name} — ${c.uf}`)));
        list.hidden = !r.cities.length;
      } catch { list.hidden = true; }
    }, 180);
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) list.hidden = true; });
  ufF.input.addEventListener("input", () => { ufF.input.value = ufF.input.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  return { city: cityF, uf: ufF, els: [wrap, ufF.el] };
}

/* ------------------------------------------------------------------ utilidades diversas */
export function pager({ page, size, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return h("nav", { class: "pager", "aria-label": "Paginação" },
    h("button", { class: "btn btn-outline btn-sm", disabled: page <= 1, onClick: () => onPage(page - 1) }, "Anterior"),
    h("span", { class: "muted" }, `Página ${page} de ${pages} · ${total} resultado(s)`),
    h("button", { class: "btn btn-outline btn-sm", disabled: page >= pages, onClick: () => onPage(page + 1) }, "Próxima"));
}

export function pageHead(title, subtitle, ...actions) {
  return h("div", { class: "page-head" }, h("div", null, h("h1", { tabindex: "-1" }, title), subtitle ? h("p", { class: "muted" }, subtitle) : null),
    actions.length ? h("div", { class: "row" }, ...actions) : null);
}

export function go(path) { location.hash = path; }
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function qs(obj) { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== "" && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; }
