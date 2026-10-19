/* Central de relatórios (RF10–RF13, UC11, UC16, UC20–UC22): filtros, visualização em tela e exportação. */
import { api, h, mount, field, form, icon, notice, empty, loading, pageHead, toast, confirmDialog, download, state, todayLocal, addDays, ApiErr } from "../lib.js";

const ACTIVITIES = [["solicitacoes_realizadas", "Solicitações realizadas"], ["solicitacoes_recebidas", "Solicitações recebidas"], ["concluidos", "Serviços concluídos"],
  ["cancelados", "Serviços cancelados"], ["avaliacoes_realizadas", "Avaliações realizadas"], ["avaliacoes_recebidas", "Avaliações recebidas"]];
const STATUSES = [["aguardando_resposta", "Aguardando resposta"], ["em_negociacao", "Em negociação"], ["agendada", "Agendada"], ["concluida", "Concluída"], ["cancelada", "Cancelada"], ["recusada", "Recusada"], ["expirada", "Expirada"]];
const METRICS = [["todas", "Todas"], ["desempenho", "Desempenho"], ["utilizacao", "Utilização"], ["erros", "Erros"]];
const INTERACTIONS = [["acesso", "Acessos (login)"], ["busca", "Buscas"], ["visualizacao_perfil", "Visualizações de perfil"], ["solicitacao", "Solicitações"], ["mensagem", "Mensagens"], ["avaliacao", "Avaliações"]];
const FORMAT_LABEL = { pdf: "PDF", csv: "CSV", xlsx: "Excel (XLSX)" };

function renderReport(rep) {
  if (rep.empty) return notice(rep.empty_message || "Não há dados para o período informado.");
  const pairs = (arr) => h("dl", { class: "kv" }, ...arr.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, String(v))]));
  return h("div", { class: "stack", "aria-live": "polite" },
    h("div", { class: "card stack-sm" }, h("h2", null, rep.title), h("p", { class: "muted" }, `Período: ${rep.period.label}`), rep.filters.length ? pairs(rep.filters) : null,
      rep.identification.length ? [h("hr", { class: "sep" }), pairs(rep.identification)] : null),
    rep.summary.length ? h("div", { class: "grid cols-4" }, ...rep.summary.map(([k, v]) => h("div", { class: "card tight stat" }, h("span", { class: "num" }, String(v)), h("span", { class: "lbl" }, k)))) : null,
    rep.truncated ? notice("O relatório excedeu o limite de linhas e foi truncado. Reduza o período para ver tudo.") : null,
    ...rep.sections.map((s) => h("section", { class: "card stack-sm" }, h("h3", null, s.title),
      s.rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, s.title),
        h("thead", null, h("tr", null, ...s.columns.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", null, ...s.rows.map((r) => h("tr", null, ...r.map((c) => h("td", null, c === null || c === undefined ? "—" : String(c)))))))) : h("p", { class: "muted" }, s.empty || "Sem registros no período."))));
}

export async function page() {
  const me = state.me;
  const isAdmin = me.user.role === "admin";
  const [{ items: available }, cats] = await Promise.all([api.get("/reports"), api.get("/categories")]);
  const catOpts = cats.items.map((c) => ({ value: c.id, label: c.name }));
  const out = h("div", { "aria-live": "polite" });
  let selected = available[0];
  const panel = h("section", { class: "card", "aria-labelledby": "h-filtros" });

  function buildFilters(type) {
    const start = field({ name: "start", label: "Data inicial", type: "date", required: true, value: addDays(todayLocal(), -30), max: todayLocal() });
    const end = field({ name: "end", label: "Data final", type: "date", required: true, value: todayLocal() });
    const fs = [start, end];
    if (type === "usuario") {
      fs.push(field({ name: "activities", label: "Atividades", type: "checkgroup", class: "full", value: ACTIVITIES.map((a) => a[0]), options: ACTIVITIES.map(([value, label]) => ({ value, label })) }));
      fs.push(field({ name: "statuses", label: "Status das solicitações (vazio = todos)", type: "checkgroup", class: "full", options: STATUSES.map(([value, label]) => ({ value, label })) }));
      if (isAdmin) fs.push(field({ name: "user_id", label: "ID do usuário (vazio = o seu)", type: "number", min: 1 }));
    } else if (type === "software") {
      fs.push(field({ name: "metrics", label: "Métricas", type: "checkgroup", class: "full", value: ["todas"], options: METRICS.map(([value, label]) => ({ value, label })) }));
    } else if (type === "engajamento") {
      fs.push(field({ name: "category_id", label: "Categoria", type: "select", placeholder: "Todas", options: catOpts }));
      fs.push(field({ name: "interaction_type", label: "Tipo de interação", type: "select", placeholder: "Todas", options: INTERACTIONS.map(([value, label]) => ({ value, label })) }));
      fs.push(field({ name: "location", label: "Localização (cidade/UF)", maxlength: 80, class: "full" }));
    } else if (type === "satisfacao") {
      fs.push(field({ name: "category_id", label: "Categoria", type: "select", placeholder: "Todas", options: catOpts }));
      if (isAdmin) fs.push(field({ name: "worker_id", label: "ID do trabalhador (vazio = todos)", type: "number", min: 1 }));
    }
    return fs;
  }

  async function run(type, values, format, fm, confirmed = false) {
    const body = { ...values, format };
    for (const k of Object.keys(body)) if (body[k] === "" || (Array.isArray(body[k]) && !body[k].length)) delete body[k];
    if (confirmed) body.confirm = true;
    try {
      if (format === "tela") { mount(out, loading()); const r = await api.post(`/reports/${type}`, body); mount(out, renderReport(r.report)); }
      else { const r = await api.post(`/reports/${type}`, body, { blob: true }); download(r.blob, r.filename); toast(`Arquivo ${r.filename} gerado.`); }
    } catch (e) {
      mount(out);
      if (e.code === "confirmation_required" && !confirmed) {
        const ok = await confirmDialog({ title: "Período longo", message: e.message, confirmLabel: "Continuar", cancelLabel: "Voltar" });
        if (ok) return run(type, values, format, fm, true);
        return;
      }
      if (!(e instanceof ApiErr)) throw e;
      Object.entries(e.fields || {}).forEach(([k, m]) => fm.fields[k] && fm.fields[k].error(m));
      mount(out, notice(e.message, "error"));
    }
  }

  function paintPanel() {
    const fs = buildFilters(selected.type);
    const fm = form(fs, { noActions: true, onSubmit: async () => {} });
    const buttons = h("div", { class: "form-actions", style: "justify-content:flex-start" },
      h("button", { class: "btn btn-primary", type: "submit" }, icon("doc"), "Visualizar em tela"),
      ...selected.formats.map((f) => h("button", { class: "btn btn-outline", type: "button", onClick: () => submit(f) }, icon("download"), `Exportar ${FORMAT_LABEL[f] || f}`)));
    fm.el.append(buttons);
    const validate = () => {
      let first = null; fs.forEach((f) => { f.error(""); if (f.required && !f.isFilled()) { f.error("Campo obrigatório."); first = first || f; } });
      if (first) { first.focus(); return false; }
      return true;
    };
    const submit = (format) => { if (!validate()) return; run(selected.type, fm.values(), format, fm); };
    fm.el.addEventListener("submit", (e) => { e.preventDefault(); e.stopImmediatePropagation(); submit("tela"); }, true);
    mount(panel, h("h2", { id: "h-filtros" }, selected.title), h("p", { class: "muted" }, selected.description), fm.el);
    mount(out);
  }

  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Tipos de relatório" }, ...available.map((r) => {
    const b = h("button", { type: "button", role: "tab", "aria-selected": String(r === selected), onClick: () => { selected = r; [...tabs.children].forEach((x) => x.setAttribute("aria-selected", String(x === b))); paintPanel(); } }, r.title);
    return b;
  }));
  paintPanel();
  return h("div", { class: "stack" }, pageHead("Relatórios", "Gere relatórios do período desejado, veja em tela ou exporte."), tabs, panel, out);
}
