/* Solicitações (RF07), cancelamento (UC08), conclusão e avaliações (RF09, UC05). */
import { api, h, mount, field, icon, stars, notice, empty, loading, pageHead, brl, fmtDateTime, fmtDate, statusChip, pager, toast, dialog, confirmDialog,
  ApiErr, state, debounce } from "../lib.js";

const STATUS_OPTS = [["", "Todos os status"], ["aguardando_resposta", "Aguardando resposta"], ["em_negociacao", "Em negociação"], ["agendada", "Agendadas"],
  ["concluida", "Concluídas"], ["cancelada", "Canceladas"], ["recusada", "Recusadas"], ["expirada", "Expiradas"]];

function listPage(role) {
  return async function () {
    const asWorker = role === "worker";
    const status = field({ name: "status", label: "Status", type: "select", options: STATUS_OPTS.map(([v, l]) => ({ value: v, label: l })) });
    const q = field({ name: "q", label: "Buscar", placeholder: asWorker ? "Cliente ou serviço" : "Profissional ou serviço", maxlength: 80 });
    const box = h("div", { "aria-live": "polite" });
    async function load(page = 1) {
      mount(box, loading());
      const r = await api.get("/requests", { role, status: status.get(), q: q.get(), page, size: 15 });
      mount(box, r.items.length ? h("div", { class: "stack" },
        h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("caption", { class: "sr-only" }, asWorker ? "Solicitações recebidas" : "Minhas solicitações"),
          h("thead", null, h("tr", null, ...["Nº", "Serviço", asWorker ? "Cliente" : "Profissional", "Data e horário", "Valor", "Status", ""].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", null, ...r.items.map((x) => h("tr", null,
            h("td", null, `#${x.id}`), h("td", { class: "strong" }, x.service_name), h("td", null, asWorker ? x.client_name : x.worker_name),
            h("td", { class: "nowrap" }, fmtDateTime(x.scheduled_start)), h("td", { class: "nowrap" }, brl(x.agreed_value ?? x.base_value)), h("td", null, statusChip(x.status)),
            h("td", null, h("a", { class: "btn btn-outline btn-sm", href: `#/solicitacoes/${x.id}`, "aria-label": `Abrir solicitação ${x.id}` }, "Abrir"))))))),
        pager({ page: r.page, size: r.size, total: r.total, onPage: load }))
        : empty(r.message, "calendar", asWorker ? null : h("a", { class: "btn btn-primary btn-sm", href: "#/buscar" }, "Buscar profissionais")));
    }
    const search = debounce(() => load(1), 350);
    status.input.addEventListener("change", () => load(1));
    q.input.addEventListener("input", search);
    load(1).catch((e) => mount(box, notice(e.message, "error")));
    return h("div", { class: "stack" },
      pageHead(asWorker ? "Solicitações recebidas" : "Minhas solicitações", asWorker ? "Acompanhe e responda às solicitações dos seus clientes." : "Consulte o andamento dos serviços que você contratou.",
        asWorker ? null : h("a", { class: "btn btn-primary", href: "#/buscar" }, icon("search"), "Nova busca")),
      h("div", { class: "card" }, h("div", { class: "filters" }, status.el, q.el)), box);
  };
}
export const mine = listPage("client");
export const received = listPage("worker");

/* ------------------------------------------------------------------ avaliação */
function starInput(initial = 0) {
  let value = initial;
  const btns = [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", class: n <= value ? "on" : "", "aria-label": `${n} estrela${n > 1 ? "s" : ""}`, "aria-pressed": String(n <= value), onClick: () => set(n) }, icon("star", "star")));
  function set(n) { value = n; btns.forEach((b, i) => { b.className = i < n ? "on" : ""; b.setAttribute("aria-pressed", String(i < n)); }); }
  return { el: h("div", { class: "star-input", role: "group", "aria-label": "Nota de 1 a 5" }, ...btns), get: () => value };
}

export function reviewDialog({ title, rating = 0, comment = "", onSave }) {
  const stp = starInput(rating);
  const c = field({ name: "comment", label: "Comentário (opcional)", type: "textarea", rows: 4, maxlength: 1000, value: comment });
  const err = h("div");
  let dlg;
  const save = h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
    mount(err);
    if (!stp.get()) { mount(err, notice("Informe a nota de satisfação (1 a 5 estrelas).", "error")); return; }
    save.disabled = true;
    try { await onSave({ rating: stp.get(), comment: c.get() }); dlg.close(true); }
    catch (e) { mount(err, notice(e.message, "error")); save.disabled = false; }
  } }, "Enviar avaliação");
  dlg = dialog({ title, content: h("div", { class: "stack" }, h("div", null, h("div", { class: "legend", style: "margin-bottom:4px" }, "Nota"), stp.el), c.el, err),
    actions: [h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, "Cancelar"), save] });
}

/* ------------------------------------------------------------------ detalhe da solicitação */
function proposalCard(p, names) {
  const label = { proposta: "Proposta", contraproposta: "Contraproposta" }[p.kind] || "Proposta";
  const st = { pendente: ["pending", "Pendente"], aceita: ["positive", "Aceita"], recusada: ["negative", "Recusada"], substituida: ["", "Substituída"], cancelada: ["negative", "Cancelada"], expirada: ["", "Expirada"] }[p.status] || ["", p.status];
  return h("li", null, h("div", { class: "list-item" },
    h("div", null, h("div", { class: "strong" }, `${label} de ${names[p.sender_id] || "—"}`), h("div", { class: "muted small" }, `${brl(p.value)} · ${fmtDateTime(p.scheduled_start)} · ${p.location}`), p.notes ? h("div", { class: "muted small" }, p.notes) : null),
    h("div", { class: "stack-sm", style: "align-items:flex-end" }, h("span", { class: `chip ${st[0]}` }, st[1]), h("span", { class: "muted small" }, fmtDateTime(p.created_at)))));
}

export async function detail(ctx) {
  const root = h("div", { class: "stack" });
  async function load() {
    const { request: r } = await api.get(`/requests/${ctx.params.id}`);
    const asClient = r.my_role === "client";
    const names = { [r.client_id]: r.client_name, [r.worker_id]: r.worker_name };
    const actions = [];
    if (r.conversation_id) actions.push(h("a", { class: "btn btn-positive", href: `#/conversas/${r.conversation_id}` }, icon("chat"), r.status === "aguardando_resposta" || r.status === "em_negociacao" ? "Abrir negociação" : "Abrir conversa"));
    if (r.can_complete) actions.push(h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
      const ok = await confirmDialog({ title: "Concluir serviço", message: `Confirmar que “${r.service_name}” foi realizado? O cliente poderá avaliá-lo.`, confirmLabel: "Marcar como concluído" });
      if (!ok) return;
      try { const x = await api.post(`/requests/${r.id}/complete`); toast(x.message); await load(); } catch (e) { toast(e.message, "error"); }
    } }, icon("check"), "Concluir serviço"));
    if (r.can_review) actions.push(h("button", { class: "btn btn-primary", type: "button", onClick: () => reviewDialog({ title: "Avaliar serviço", onSave: (d) => api.post(`/requests/${r.id}/review`, d).then((x) => { toast(x.message); load(); }) }) }, icon("star"), "Avaliar"));
    let cancelBlock = null;
    if (["aguardando_resposta", "em_negociacao", "agendada"].includes(r.status)) {
      if (r.cancel.allowed) {
        actions.push(h("button", { class: "btn btn-danger", type: "button", onClick: async () => {
          const fee = r.cancel.fee_amount > 0 && asClient;
          const v = await confirmDialog({ title: "Cancelar solicitação", danger: true, confirmLabel: "Cancelar solicitação", cancelLabel: "Manter",
            message: h("div", { class: "stack-sm" }, h("p", null, `Deseja cancelar “${r.service_name}”?`),
              fee ? notice(`Atenção: o cancelamento está dentro de 24 h do início. Taxa aplicável: ${brl(r.cancel.fee_amount)} (${r.cancel.fee_percent}%).`) : null),
            fields: [{ name: "reason", label: "Motivo (opcional)", type: "textarea", rows: 3, maxlength: 300 }] });
          if (!v) return;
          try { const x = await api.post(`/requests/${r.id}/cancel`, { confirm: true, reason: v.reason }); toast(x.message); await load(); } catch (e) { toast(e.message, "error"); }
        } }, "Cancelar"));
      } else cancelBlock = notice(r.cancel.reason);
    }
    mount(root,
      pageHead(`Solicitação #${r.id}`, r.service_name, h("a", { class: "btn btn-outline", href: asClient ? "#/solicitacoes" : "#/recebidas" }, "Voltar")),
      h("div", { class: "split reverse" },
        h("div", { class: "stack" },
          h("section", { class: "card", "aria-labelledby": "h-info" }, h("div", { class: "card-head" }, h("h2", { id: "h-info" }, "Dados da solicitação"), statusChip(r.status)),
            h("dl", { class: "kv" },
              h("dt", null, asClient ? "Profissional" : "Cliente"), h("dd", null, asClient ? h("a", { class: "link", href: `#/profissional/${r.worker_id}` }, r.worker_name) : r.client_name),
              h("dt", null, "Categoria"), h("dd", null, r.category_name || "—"),
              h("dt", null, "Data e horário"), h("dd", null, `${fmtDateTime(r.scheduled_start)} (${r.duration_min} min)`),
              h("dt", null, "Local"), h("dd", null, r.location),
              h("dt", null, "Valor"), h("dd", { class: "price" }, brl(r.agreed_value ?? r.base_value), r.agreed_value === null ? h("span", { class: "muted small" }, " (valor padrão, ainda não acordado)") : null),
              r.notes ? [h("dt", null, "Observações"), h("dd", null, r.notes)] : null,
              ...(r.answers || []).flatMap((a) => [h("dt", null, a.label), h("dd", null, Array.isArray(a.value) ? a.value.join(", ") : String(a.value))]),
              r.status === "cancelada" ? [h("dt", null, "Cancelamento"), h("dd", null, `${fmtDateTime(r.cancelled_at)}${r.cancel_reason ? ` — ${r.cancel_reason}` : ""}${r.cancellation_fee_amount ? ` · taxa ${brl(r.cancellation_fee_amount)}` : ""}`)] : null,
              r.completed_at ? [h("dt", null, "Concluída em"), h("dd", null, fmtDateTime(r.completed_at))] : null)),
          h("section", { class: "card", "aria-labelledby": "h-hist" }, h("h2", { id: "h-hist" }, "Histórico de propostas"),
            r.proposals.length ? h("ul", { class: "list" }, ...r.proposals.map((p) => proposalCard(p, names))) : h("p", { class: "muted" }, "Sem propostas registradas.")),
          r.review ? h("section", { class: "card", "aria-labelledby": "h-rev" }, h("h2", { id: "h-rev" }, "Avaliação"), stars(r.review.rating), r.review.comment ? h("p", null, r.review.comment) : null,
            h("p", { class: "muted small" }, `Registrada em ${fmtDate(r.review.created_at)}`)) : null),
        h("aside", { class: "stack" }, h("section", { class: "card stack-sm", "aria-labelledby": "h-act" }, h("h2", { id: "h-act" }, "Ações"), ...actions, cancelBlock,
          !actions.length && !cancelBlock ? h("p", { class: "muted" }, "Nenhuma ação disponível.") : null))));
  }
  await load();
  return root;
}

/* ------------------------------------------------------------------ avaliações do cliente */
export async function reviews() {
  const root = h("div", { class: "stack" });
  async function load() {
    const [pending, mineR] = await Promise.all([api.get("/reviews/pending"), api.get("/reviews/mine")]);
    mount(root, pageHead("Avaliações", "Avalie os serviços concluídos e consulte suas avaliações."),
      h("section", { class: "card", "aria-labelledby": "h-pend" }, h("h2", { id: "h-pend" }, "Aguardando avaliação"),
        pending.items.length ? h("ul", { class: "list" }, ...pending.items.map((p) => h("li", null, h("div", { class: "list-item" },
          h("div", null, h("div", { class: "strong" }, p.service_name), h("div", { class: "muted small" }, `${p.worker_name} · concluído em ${fmtDate(p.completed_at)}`)),
          h("button", { class: "btn btn-primary btn-sm", type: "button", onClick: () => reviewDialog({ title: `Avaliar ${p.worker_name}`, onSave: (d) => api.post(`/requests/${p.request_id}/review`, d).then((x) => { toast(x.message); load(); }) }) }, "Avaliar"))))) : empty(pending.message, "star")),
      h("section", { class: "card", "aria-labelledby": "h-done" }, h("h2", { id: "h-done" }, "Minhas avaliações"),
        mineR.items.length ? h("ul", { class: "list" }, ...mineR.items.map((r) => h("li", null, h("div", { class: "list-item" },
          h("div", null, h("div", { class: "strong" }, `${r.service_name} — ${r.worker_name}`), stars(r.rating), r.comment ? h("p", { class: "muted" }, r.comment) : null,
            h("div", { class: "muted small" }, `Em ${fmtDate(r.created_at)}${r.hidden ? " · removida pela moderação" : ""}`)),
          r.editable ? h("button", { class: "btn btn-outline btn-sm", type: "button", onClick: () => reviewDialog({ title: "Editar avaliação", rating: r.rating, comment: r.comment || "", onSave: (d) => api.put(`/reviews/${r.id}`, d).then((x) => { toast(x.message); load(); }) }) }, icon("edit"), "Editar") : null)))) : empty(mineR.message, "star")));
  }
  await load();
  return root;
}
