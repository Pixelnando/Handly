/* Perfil profissional (RF03, UC13/18/19), serviços (RF04, UC14), verificação (RF15, UC17), nova categoria (UC15). */
import { api, h, mount, field, form, icon, notice, empty, loading, pageHead, brl, fmtDateTime, fmtDate, toast, dialog, confirmDialog, state, ApiErr,
  WEEKDAYS, maskPhoneInput } from "../lib.js";
import { reloadMe } from "../app.js";

/* ------------------------------------------------------------------ editor de disponibilidade semanal */
export function availabilityEditor(initial = [], { label = "Disponibilidade de atendimento" } = {}) {
  const days = WEEKDAYS.map((_, i) => ({ ranges: initial.filter((w) => w.weekday === i).map((w) => ({ start: w.start, end: w.end })) }));
  const err = h("div", { class: "err", role: "alert", hidden: true });
  const root = h("fieldset", { class: "windows" }, h("legend", { class: "legend" }, label), err);
  const body = h("div", { class: "windows" });
  root.append(body);
  function paint() {
    mount(body, ...days.map((d, i) => h("div", { class: "window-day" },
      h("div", { class: "strong" }, WEEKDAYS[i]),
      h("div", { class: "window-ranges" },
        ...d.ranges.map((r, j) => {
          const s = h("input", { class: "input", type: "time", value: r.start, "aria-label": `${WEEKDAYS[i]}, início do período ${j + 1}`, onChange: (e) => { r.start = e.target.value; } });
          const e2 = h("input", { class: "input", type: "time", value: r.end, "aria-label": `${WEEKDAYS[i]}, fim do período ${j + 1}`, onChange: (e) => { r.end = e.target.value; } });
          return h("div", { class: "range" }, s, h("span", { "aria-hidden": "true" }, "até"), e2,
            h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Remover período ${j + 1} de ${WEEKDAYS[i]}`, onClick: () => { d.ranges.splice(j, 1); paint(); } }, icon("trash")));
        }),
        h("div", null, h("button", { class: "btn btn-outline btn-sm", type: "button", onClick: () => { d.ranges.push({ start: "08:00", end: "12:00" }); paint(); } }, icon("plus"), "Adicionar período"),
          !d.ranges.length ? h("span", { class: "muted small", style: "margin-left:8px" }, "Sem atendimento") : null)))));
  }
  paint();
  return { el: root, get: () => days.flatMap((d, i) => d.ranges.map((r) => ({ weekday: i, start: r.start, end: r.end }))),
    error(m) { err.textContent = m || ""; err.hidden = !m; } };
}

/* ------------------------------------------------------------------ perfil profissional */
async function categoriesRequestDialog() {
  let dlg;
  const fm = form([field({ name: "name", label: "Nome da categoria", required: true, maxlength: 60, class: "full" }),
    field({ name: "description", label: "Descrição", type: "textarea", required: true, rows: 3, maxlength: 400, class: "full" })], {
    submitLabel: "Enviar para análise", onSubmit: async (v) => { const r = await api.post("/category-requests", v); toast(r.message); dlg.close(true); },
    cancel: h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, "Cancelar"),
  });
  dlg = dialog({ title: "Solicitar nova categoria", content: fm.el });
}

export async function profile(ctx) {
  const me = state.me;
  const cats = (await api.get("/categories")).items;
  let prof = null;
  try { prof = (await api.get("/workers/me")).profile; } catch (e) { if (e.code !== "no_worker_profile") throw e; }

  if (!prof && !me.subscription) {
    return h("div", { class: "stack" }, pageHead("Seja um profissional", "Ofereça seus serviços para clientes da sua região."),
      h("div", { class: "card stack" }, notice("Para criar seu perfil profissional é necessário ter uma assinatura ativa."),
        h("div", null, h("a", { class: "btn btn-primary", href: "#/assinatura" }, "Ver planos e assinar"))));
  }

  const catF = field({ name: "category_ids", label: "Categorias de atuação", type: "checkgroup", required: true, class: "full", value: prof ? prof.categories.map((c) => c.id) : [],
    options: cats.map((c) => ({ value: c.id, label: c.name })) });
  const f = [
    field({ name: "phone", label: "Telefone (com DDD)", required: true, mask: maskPhoneInput, inputmode: "tel", autocomplete: "tel", maxlength: 15, value: prof?.phone ?? "", placeholder: "(14) 99999-0000" }),
    field({ name: "radius_km", label: "Raio de atendimento (km)", type: "number", required: true, min: 1, max: 300, value: prof?.radius_km ?? 20 }),
    field({ name: "service_area", label: "Área de atendimento", required: true, maxlength: 200, value: prof?.service_area ?? `${me.user.city}/${me.user.uf} e região`, class: "full", hint: "Cidades ou bairros que você atende." }),
    field({ name: "description", label: "Sobre você", type: "textarea", rows: 4, maxlength: 1000, value: prof?.description ?? "", class: "full", hint: "Experiência, especialidades e diferenciais." }),
    catF,
  ];
  const av = availabilityEditor(prof?.availability ?? [{ weekday: 0, start: "08:00", end: "18:00" }, { weekday: 1, start: "08:00", end: "18:00" }, { weekday: 2, start: "08:00", end: "18:00" }, { weekday: 3, start: "08:00", end: "18:00" }, { weekday: 4, start: "08:00", end: "18:00" }]);
  const saveAv = prof ? h("div", { class: "form-actions" }, h("button", { class: "btn btn-positive", type: "button", onClick: async (e) => {
    av.error(""); e.target.disabled = true;
    try { const r = await api.put("/workers/me/availability", { availability: av.get() }); toast(r.message); } catch (er) { av.error(er.message); }
    finally { e.target.disabled = false; }
  } }, "Salvar disponibilidade")) : null;

  const fm = form(f, {
    submitLabel: prof ? "Salvar perfil" : "Criar perfil profissional",
    onSubmit: async (v) => {
      av.error("");
      const body = { phone: v.phone, radius_km: v.radius_km, service_area: v.service_area, description: v.description, category_ids: v.category_ids };
      try {
        if (prof) { const r = await api.put("/workers/me", body); toast(r.message); }
        else { body.availability = av.get(); const r = await api.post("/workers", body); toast(r.message); await reloadMe(); location.hash = "#/servicos/novo"; }
      } catch (e) { if (e.fields && e.fields.availability) av.error(e.fields.availability); if (e.code === "invalid_interval" || e.code === "overlap") av.error(e.message); throw e; }
    },
  });

  const statusBlock = prof ? h("div", { class: "chips" },
    h("span", { class: `chip ${prof.status === "ativo" ? "positive" : prof.status === "bloqueado" ? "negative" : "pending"}` }, `Perfil ${prof.status}`),
    h("span", { class: `chip ${prof.verification_status === "verificado" ? "positive verified" : ""}` }, prof.verification_status === "verificado" ? "Verificado" : `Verificação: ${prof.verification_status.replace("_", " ")}`)) : null;
  const danger = prof ? h("section", { class: "card stack", "aria-labelledby": "h-del" }, h("h2", { id: "h-del" }, "Excluir perfil profissional"),
    h("p", { class: "muted" }, "Seus serviços deixam de ser exibidos. Não é possível excluir com solicitações em andamento."),
    h("div", null, h("button", { class: "btn btn-danger", type: "button", onClick: async () => {
      const ok = await confirmDialog({ title: "Excluir perfil profissional", danger: true, confirmLabel: "Excluir perfil", message: "Tem certeza? Esta ação remove seu perfil e seus serviços da plataforma." });
      if (!ok) return;
      try { await api.del("/workers/me", { confirm: true }); toast("Perfil profissional excluído."); await reloadMe(); location.hash = "#/"; } catch (e) { toast(e.message, "error"); }
    } }, icon("trash"), "Excluir perfil"))) : null;

  return h("div", { class: "stack" },
    pageHead(prof ? "Perfil profissional" : "Criar perfil profissional", prof ? "Mantenha seus dados e horários sempre atualizados." : "Preencha seus dados para começar a receber solicitações.",
      prof ? h("a", { class: "btn btn-outline", href: `#/profissional/${me.user.id}` }, "Ver como cliente") : null,
      prof ? h("a", { class: "btn btn-outline", href: "#/verificacao" }, icon("shield"), "Verificar perfil") : null),
    statusBlock,
    h("section", { class: "card", "aria-labelledby": "h-dados" }, h("h2", { id: "h-dados" }, "Dados do perfil"), fm.el,
      h("div", { style: "margin-top:12px" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: categoriesRequestDialog }, icon("plus"), "Não encontrou sua categoria? Solicite uma nova"))),
    h("section", { class: "card", "aria-labelledby": "h-disp" }, h("h2", { id: "h-disp" }, "Disponibilidade"),
      h("p", { class: "muted" }, "Defina os períodos em que você atende em cada dia. Clientes só conseguem agendar dentro desses horários."), av.el, saveAv,
      prof ? null : h("p", { class: "muted small" }, "A disponibilidade é enviada junto com o perfil.")),
    danger);
}

/* ------------------------------------------------------------------ serviços */
export async function services() {
  const root = h("div", { class: "stack" });
  async function load() {
    const r = await api.get("/services/mine");
    const me = state.me;
    mount(root, pageHead("Meus serviços", "Cadastre o que você oferece, com valores, duração e regras de cancelamento.",
      h("a", { class: "btn btn-primary", href: "#/servicos/novo" }, icon("plus"), "Novo serviço"),
      h("button", { class: "btn btn-outline", type: "button", onClick: categoriesRequestDialog }, "Solicitar categoria")),
      !me.subscription ? notice("Sua assinatura não está ativa: você não aparece nas buscas nem recebe novas contratações. Seus serviços e seu perfil foram preservados.") : null,
      r.items.length ? h("div", { class: "grid auto" }, ...r.items.map((s) => h("article", { class: "card stack-sm" },
        h("div", { class: "card-head" }, h("h3", null, s.name), h("span", { class: "chip" }, s.category_name)),
        h("p", { class: "muted small" }, s.description.length > 130 ? s.description.slice(0, 130) + "…" : s.description),
        h("dl", { class: "kv" }, h("dt", null, "Valor"), h("dd", { class: "price" }, brl(s.base_rate)), h("dt", null, "Duração"), h("dd", null, `${s.avg_duration_min} min`),
          h("dt", null, "Cancelamento"), h("dd", null, `${s.cancellation_fee_percent}%`)),
        h("div", { class: "row end" },
          h("a", { class: "btn btn-outline btn-sm", href: `#/servicos/${s.id}/editar` }, icon("edit"), "Editar"),
          h("button", { class: "btn btn-danger btn-sm", type: "button", "aria-label": `Excluir ${s.name}`, onClick: async () => {
            const ok = await confirmDialog({ title: "Excluir serviço", danger: true, confirmLabel: "Excluir", message: `Excluir “${s.name}”? Solicitações em andamento serão mantidas.` });
            if (!ok) return;
            try { const x = await api.del(`/services/${s.id}`); toast(x.message); load(); } catch (e) { toast(e.message, "error"); }
          } }, icon("trash"), "Excluir"))))) : empty(r.message, "tool", h("a", { class: "btn btn-primary btn-sm", href: "#/servicos/novo" }, "Cadastrar primeiro serviço")));
  }
  await load();
  return root;
}

const FIELD_TYPES = [["text", "Texto curto"], ["textarea", "Texto longo"], ["number", "Número"], ["date", "Data"], ["select", "Lista de opções"], ["radio", "Escolha única"], ["checkbox", "Múltipla escolha"]];

function formFieldsBuilder(initial = []) {
  const items = initial.map((x) => ({ label: x.label, type: x.type, options: (x.options || []).join(", "), required: !!x.required }));
  const root = h("fieldset", { class: "stack" }, h("legend", { class: "legend" }, "Formulário para o cliente (opcional)"),
    h("p", { class: "hint muted small" }, "Perguntas adicionais exibidas ao solicitar este serviço (até 15)."));
  const box = h("div", { class: "stack" });
  const err = h("div", { class: "err", role: "alert", hidden: true });
  root.append(box, err);
  const addBtn = h("button", { class: "btn btn-outline btn-sm", type: "button", onClick: () => { if (items.length >= 15) return; items.push({ label: "", type: "text", options: "", required: false }); paint(); } }, icon("plus"), "Adicionar pergunta");
  function paint() {
    mount(box, ...items.map((it, i) => {
      const needsOpts = ["select", "radio", "checkbox"].includes(it.type);
      return h("div", { class: "card tight stack-sm" },
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { for: `ff-l-${i}` }, "Pergunta"), h("input", { class: "input", id: `ff-l-${i}`, value: it.label, maxlength: 120, onInput: (e) => { it.label = e.target.value; } })),
          h("div", { class: "field" }, h("label", { for: `ff-t-${i}` }, "Tipo"), h("select", { class: "select", id: `ff-t-${i}`, onChange: (e) => { it.type = e.target.value; paint(); } },
            ...FIELD_TYPES.map(([v, l]) => h("option", { value: v, selected: v === it.type }, l)))),
          needsOpts ? h("div", { class: "field full" }, h("label", { for: `ff-o-${i}` }, "Opções (separadas por vírgula)"), h("input", { class: "input", id: `ff-o-${i}`, value: it.options, onInput: (e) => { it.options = e.target.value; } })) : null),
        h("div", { class: "row between" },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: it.required, onChange: (e) => { it.required = e.target.checked; } }), "Resposta obrigatória"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => { items.splice(i, 1); paint(); } }, icon("trash"), "Remover")));
    }), addBtn);
  }
  paint();
  return { el: root, get: () => items.map((it) => ({ ...it, options: it.options })), error(m) { err.textContent = m || ""; err.hidden = !m; } };
}

export async function serviceForm(ctx) {
  const id = ctx.params.id;
  const cats = (await api.get("/categories")).items;
  const s = id ? (await api.get(`/services/${id}`)).service : null;
  const mode = field({ name: "availability_mode", label: "Disponibilidade deste serviço", type: "select", value: s?.availability_mode ?? "perfil", options: [{ value: "perfil", label: "Usar a disponibilidade do meu perfil" }, { value: "personalizada", label: "Definir horários específicos" }] });
  const av = availabilityEditor(s?.availability ?? [], { label: "Horários específicos do serviço" });
  const avWrap = h("div", { class: "full", hidden: mode.get() !== "personalizada" }, av.el);
  mode.input.addEventListener("change", () => { avWrap.hidden = mode.get() !== "personalizada"; });
  const ff = formFieldsBuilder(s?.form_fields ?? []);
  const f = [
    field({ name: "name", label: "Nome do serviço", required: true, maxlength: 100, value: s?.name ?? "" }),
    field({ name: "category_id", label: "Categoria", type: "select", required: true, placeholder: "Selecione", value: s?.category_id ?? "", options: cats.map((c) => ({ value: c.id, label: c.name })) }),
    field({ name: "description", label: "Descrição", type: "textarea", required: true, rows: 3, maxlength: 1500, value: s?.description ?? "", class: "full" }),
    field({ name: "base_rate", label: "Valor padrão (R$)", type: "number", step: "0.01", min: "0.01", required: true, value: s?.base_rate ?? "" }),
    field({ name: "avg_duration_min", label: "Tempo médio (minutos)", type: "number", min: 15, max: 1440, step: 15, required: true, value: s?.avg_duration_min ?? 60 }),
    field({ name: "service_area", label: "Área de atendimento", required: true, maxlength: 200, value: s?.service_area ?? state.me.user.city + "/" + state.me.user.uf, class: "full" }),
    field({ name: "cancellation_fee_percent", label: "Taxa de cancelamento (%)", type: "number", min: 0, max: 100, required: true, value: s?.cancellation_fee_percent ?? 0, hint: "Aplicada a cancelamentos do cliente nas últimas 24 h." }),
    field({ name: "min_notice_hours", label: "Antecedência mínima (horas)", type: "number", min: 1, value: s?.min_notice_hours ?? 2, hint: "Padrão: 2 horas." }),
    field({ name: "max_notice_hours", label: "Antecedência máxima (horas)", type: "number", min: 1, value: s?.max_notice_hours ?? "", hint: "Opcional: até quanto tempo à frente aceita agendamentos." }),
    mode,
    field({ name: "notes", label: "Observações para o cliente", type: "textarea", rows: 2, maxlength: 800, value: s?.notes ?? "", class: "full" }),
  ];
  const fm = form(f, {
    submitLabel: s ? "Salvar serviço" : "Cadastrar serviço",
    extra: h("div", { class: "stack", style: "margin-top:16px" }, avWrap, ff.el),
    cancel: h("a", { class: "btn btn-outline", href: "#/servicos" }, "Cancelar"),
    onSubmit: async (v) => {
      av.error(""); ff.error("");
      const body = { ...v, form_fields: ff.get() };
      if (v.availability_mode === "personalizada") body.availability = av.get();
      try { const r = s ? await api.put(`/services/${s.id}`, body) : await api.post("/services", body); toast(r.message); location.hash = "#/servicos"; }
      catch (e) {
        if (e.fields?.form_fields) ff.error(e.fields.form_fields);
        if (e.fields?.availability || e.code === "overlap" || e.code === "invalid_interval") av.error(e.fields?.availability || e.message);
        throw e;
      }
    },
  });
  return h("div", { class: "stack" }, pageHead(s ? "Editar serviço" : "Novo serviço", "Defina o que você oferece e as regras de agendamento."), h("section", { class: "card" }, fm.el));
}

/* ------------------------------------------------------------------ verificação de perfil */
export async function verification() {
  const root = h("div", { class: "stack" });
  async function load() {
    const r = await api.get("/workers/me/verification");
    const status = { nao_verificado: "Não verificado", verificado: "Verificado", rejeitado: "Rejeitado" }[r.status] || r.status;
    const doc = field({ name: "document_image", label: "Foto do documento (JPG, PNG ou PDF, até 5 MB)", type: "file", required: true, class: "full" });
    const selfie = field({ name: "selfie_image", label: "Selfie (JPG ou PNG, até 5 MB)", type: "file", required: true, class: "full" });
    doc.input.accept = "image/jpeg,image/png,application/pdf"; selfie.input.accept = "image/jpeg,image/png";
    const resultBox = h("div");
    const fm = form([
      field({ name: "full_name", label: "Nome completo (como no documento)", required: true, maxlength: 120, class: "full", value: state.me.user.name }),
      field({ name: "birth_date", label: "Data de nascimento", type: "date", required: true }),
      field({ name: "document_type", label: "Tipo de documento", type: "select", required: true, options: [{ value: "rg", label: "RG" }, { value: "cnh", label: "CNH" }] }),
      field({ name: "document_number", label: "Número do documento", required: true, maxlength: 30, class: "full" }), doc, selfie,
    ], {
      submitLabel: "Enviar para verificação",
      onSubmit: async (v) => {
        const fd = new FormData();
        ["full_name", "birth_date", "document_type", "document_number"].forEach((k) => fd.append(k, v[k]));
        fd.append("document_image", doc.input.files[0]); fd.append("selfie_image", selfie.input.files[0]);
        const res = await api.post("/workers/me/verification", fd);
        mount(resultBox, notice(res.message, res.approved ? "success" : "error"));
        toast(res.message, res.approved ? "ok" : "error");
        if (res.approved) { await reloadMe(); load(); }
      },
    });
    mount(root, pageHead("Verificação de perfil", "Confirme sua identidade para exibir o selo de perfil verificado."),
      h("div", { class: "split reverse" },
        h("section", { class: "card", "aria-labelledby": "h-v" }, h("div", { class: "card-head" }, h("h2", { id: "h-v" }, "Enviar documentos"),
          h("span", { class: `chip ${r.status === "verificado" ? "positive verified" : r.status === "rejeitado" ? "negative" : ""}` }, status)),
          r.status === "verificado" ? notice(`Perfil verificado em ${fmtDate(r.verified_at)}.`, "success") : [fm.el, resultBox]),
        h("aside", { class: "stack" },
          h("section", { class: "card", "aria-labelledby": "h-req" }, h("h2", { id: "h-req" }, "O que é necessário"), h("ul", null, ...r.required.map((x) => h("li", null, x))),
            h("p", { class: "muted small", style: "margin-top:12px" }, "Os documentos são enviados ao serviço de verificação e não ficam armazenados no Handly.")),
          h("section", { class: "card", "aria-labelledby": "h-hist" }, h("h2", { id: "h-hist" }, "Tentativas anteriores"),
            r.items.length ? h("ul", { class: "list" }, ...r.items.map((x) => h("li", null, h("div", { class: "strong" }, { aprovada: "Aprovada", rejeitada: "Rejeitada", nao_concluida: "Não concluída" }[x.status] || x.status),
              h("div", { class: "muted small" }, `${fmtDateTime(x.requested_at)} · ${x.document_type.toUpperCase()} ${x.document_masked}`), h("div", { class: "muted small" }, x.message)))) : h("p", { class: "muted" }, "Nenhuma tentativa até agora.")))));
  }
  await load();
  return root;
}
