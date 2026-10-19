/* Chat, propostas e contrapropostas (RF16, UC09, UC10). */
import { api, h, mount, append, field, form, icon, notice, empty, loading, pageHead, brl, fmtDateTime, localParts, todayLocal, dialog, confirmDialog, toast, state, initials } from "../lib.js";

function fmtWhen(iso) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }); }

export async function page(ctx) {
  const cid = ctx.params.id ? Number(ctx.params.id) : null;
  const me = state.me.user;
  const listBox = h("aside", { class: "card chat-list", "aria-label": "Conversas" });
  const paneBox = h("section", { class: "card chat-pane", "aria-label": "Conversa" });
  let timers = [];
  ctx.onLeave(() => timers.forEach(clearInterval));

  async function loadList() {
    const r = await api.get("/conversations");
    mount(listBox, r.items.length ? r.items.map((c) => h("a", { class: "chat-item", href: `#/conversas/${c.id}`, "aria-current": c.id === cid ? "true" : undefined },
      h("div", { class: "top" }, h("span", { class: "strong" }, c.other_name), c.unread ? h("span", { class: "badge-count", "aria-label": `${c.unread} não lidas` }, c.unread) : null),
      h("div", { class: "muted small" }, c.service_name || (c.my_role === "client" ? "Conversa com profissional" : "Conversa com cliente")),
      h("div", { class: "last" }, c.last_body || "Sem mensagens"))) : empty(r.message, "chat"));
  }

  async function openConversation() {
    const first = await api.get(`/conversations/${cid}`);
    const conv = first.conversation;
    let lastId = 0;
    const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": "Mensagens" });
    const headBox = h("div", { class: "chat-head" });
    const other = conv.my_role === "client" ? { id: conv.worker_id, name: conv.worker_name } : { id: conv.client_id, name: conv.client_name };

    function paintHead(c) {
      mount(headBox, h("div", { class: "row", style: "flex-wrap:nowrap" }, h("div", { class: "avatar", "aria-hidden": "true" }, initials(other.name)),
        h("div", null, h("div", { class: "strong" }, other.name), h("div", { class: "muted small" }, c.service_name || "Conversa direta"))),
        h("div", { class: "row" },
          c.my_role === "client" ? h("a", { class: "btn btn-outline btn-sm", href: `#/profissional/${other.id}` }, "Ver perfil") : null,
          c.open_request ? h("a", { class: "btn btn-outline btn-sm", href: `#/solicitacoes/${c.open_request.id}` }, "Ver solicitação") : null,
          !c.open_request ? h("button", { class: "btn btn-primary btn-sm", type: "button", onClick: () => newProposal(c) }, icon("send"), "Enviar proposta") : null));
    }

    function messageNode(m) {
      if (m.type === "sistema") return h("div", { class: "msg system" }, m.body);
      if (m.type === "proposta" && m.proposal) return proposalNode(m);
      const mine = m.sender_id === me.id;
      return h("div", { class: `msg${mine ? " mine" : ""}` }, h("div", null, m.body), h("div", { class: "meta" }, `${mine ? "Você" : m.sender_name} · ${fmtWhen(m.created_at)}`));
    }

    const proposalNodes = new Map();
    function proposalNode(m) {
      const p = m.proposal;
      const mine = p.sender_id === me.id;
      const st = { pendente: ["pending", "Aguardando resposta"], aceita: ["positive", "Aceita"], recusada: ["negative", "Recusada"], substituida: ["", "Substituída"], cancelada: ["negative", "Cancelada"], expirada: ["", "Expirada"] }[p.status] || ["", p.status];
      const el = h("div", { class: `proposal${p.status === "pendente" ? "" : " settled"}` },
        h("h4", null, p.kind === "contraproposta" ? "Contraproposta" : "Proposta", h("span", { class: `chip ${st[0]}` }, st[1])),
        h("dl", { class: "kv" }, h("dt", null, "Valor"), h("dd", { class: "price" }, brl(p.value)), h("dt", null, "Data e hora"), h("dd", null, fmtDateTime(p.scheduled_start)),
          h("dt", null, "Local"), h("dd", null, p.location), p.notes ? [h("dt", null, "Observações"), h("dd", null, p.notes)] : null),
        h("div", { class: "muted small" }, `${mine ? "Você" : m.sender_name} · ${fmtWhen(m.created_at)}`),
        p.status === "pendente" && !mine ? h("div", { class: "actions" },
          h("button", { class: "btn btn-positive btn-sm", type: "button", onClick: () => act(`/proposals/${p.id}/accept`, {}, "Aceitar esta proposta?") }, icon("check"), "Aceitar"),
          h("button", { class: "btn btn-outline btn-sm", type: "button", onClick: () => counter(p) }, "Contrapropor"),
          h("button", { class: "btn btn-danger btn-sm", type: "button", onClick: () => act(`/proposals/${p.id}/reject`, {}, "Recusar esta proposta? A negociação será encerrada.", true) }, "Recusar")) : null,
        p.status === "pendente" && mine ? h("p", { class: "muted small" }, "Aguardando a resposta da outra parte.") : null);
      proposalNodes.set(p.id, el);
      return el;
    }

    async function act(path, data, question, danger) {
      const ok = await confirmDialog({ title: "Confirmar", message: question, danger, confirmLabel: danger ? "Recusar" : "Aceitar" });
      if (!ok) return;
      try { const r = await api.post(path, data); toast(r.message || "Feito."); await refresh(true); } catch (e) { toast(e.message, "error"); }
    }

    function conditionsFields(init = {}, extraFields = []) {
      return [...extraFields,
        field({ name: "value", label: "Valor (R$)", type: "number", step: "0.01", min: "0.01", required: true, value: init.value ?? "" }),
        field({ name: "date", label: "Data", type: "date", min: todayLocal(), required: true, value: init.date ?? "" }),
        field({ name: "time", label: "Horário", type: "time", required: true, value: init.time ?? "" }),
        field({ name: "location", label: "Local", required: true, maxlength: 200, value: init.location ?? "", class: "full" }),
        field({ name: "notes", label: "Observações", type: "textarea", rows: 2, maxlength: 800, value: init.notes ?? "", class: "full" })];
    }

    function openProposalDialog(title, fields, submit) {
      let dlg;
      const fm = form(fields, { submitLabel: "Enviar", onSubmit: async (v) => { await submit(v); dlg.close(true); await refresh(true); },
        cancel: h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, "Cancelar") });
      dlg = dialog({ title, content: fm.el });
    }

    async function newProposal(c) {
      let extra = [];
      if (!c.service_id) {
        const { profile } = await api.get(`/workers/${c.worker_id}`);
        extra = [field({ name: "service_id", label: "Serviço", type: "select", required: true, class: "full", placeholder: "Selecione", options: profile.services.map((s) => ({ value: s.id, label: `${s.name} — ${brl(s.base_rate)}` })) })];
      }
      openProposalDialog("Enviar proposta", conditionsFields({}, extra), (v) => api.post(`/conversations/${cid}/proposals`, v).then(() => toast("Proposta enviada.")));
    }

    function counter(p) {
      const w = localParts(p.scheduled_start);
      openProposalDialog("Enviar contraproposta", conditionsFields({ value: p.value, date: w.date, time: w.time, location: p.location, notes: p.notes }),
        (v) => api.post(`/proposals/${p.id}/counter`, v).then(() => toast("Contraproposta enviada.")));
    }

    function addMessages(msgs) {
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      msgs.forEach((m) => { log.append(messageNode(m)); lastId = Math.max(lastId, m.id); });
      if (msgs.length && nearBottom) log.scrollTop = log.scrollHeight;
    }

    async function refresh(full = false) {
      if (full) {
        const r = await api.get(`/conversations/${cid}`);
        const keep = log.scrollHeight - log.scrollTop - log.clientHeight;
        lastId = 0; mount(log); proposalNodes.clear(); addMessages(r.messages); log.scrollTop = log.scrollHeight - log.clientHeight - (keep > 80 ? keep : 0); paintHead(r.conversation);
        loadList();
      } else {
        const r = await api.get(`/conversations/${cid}`, { after: lastId });
        // atualiza também o estado de propostas já exibidas
        if (r.messages.some((m) => m.type !== "texto")) { await refresh(true); return; }  // proposta/sistema: redesenha para atualizar cartões
        if (r.messages.length) { addMessages(r.messages); paintHead(r.conversation); loadList(); }
      }
    }

    const input = h("input", { class: "input", name: "body", placeholder: "Digite sua mensagem", maxlength: 2000, "aria-label": "Mensagem", autocomplete: "off" });
    const send = h("button", { class: "btn btn-primary", type: "submit" }, icon("send"), h("span", { class: "sr-only" }, "Enviar"));
    const err = h("div");
    const msgForm = h("form", { class: "chat-form", onSubmit: async (e) => {
      e.preventDefault(); mount(err);
      const text = input.value.trim();
      if (!text) { mount(err, h("div", { class: "err", style: "padding:0 12px 8px", role: "alert" }, "Digite uma mensagem antes de enviar.")); input.focus(); return; }
      send.disabled = true;
      try { await api.post(`/conversations/${cid}/messages`, { body: text }); input.value = ""; await refresh(false); }
      catch (e2) { mount(err, h("div", { class: "err", style: "padding:0 12px 8px", role: "alert" }, e2.message)); }
      finally { send.disabled = false; input.focus(); }
    } }, input, send);

    paintHead(conv);
    mount(paneBox, headBox, log, err, msgForm);
    addMessages(first.messages);
    log.scrollTop = log.scrollHeight;
    loadList();
    timers.push(setInterval(() => refresh(false).catch(() => {}), 4000));
    // propostas pendentes mudam de estado sem novas mensagens (ex.: expiração): recarrega por completo a cada 30 s
    timers.push(setInterval(() => refresh(true).catch(() => {}), 30000));
  }

  const list = loadList();
  if (cid) await openConversation().catch((e) => mount(paneBox, notice(e.message, "error")));
  else mount(paneBox, empty("Selecione uma conversa para começar.", "chat"));
  await list.catch(() => {});
  return h("div", { class: "stack" }, pageHead("Conversas", "Negocie valores, horários e local diretamente com a outra parte."),
    h("div", { class: "chat-layout" }, listBox, paneBox));
}
