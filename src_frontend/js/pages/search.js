/* Busca de trabalhadores (RF08), perfil público (RF09.5), solicitação e agendamento (RF05, RF06). */
import { api, h, mount, field, form, cityPicker, icon, stars, state, notice, empty, loading, pageHead, brl, initials, pager, toast,
  WEEKDAYS, WEEKDAYS_SHORT, fmtDay, fmtDate, dateBr, todayLocal, ApiErr } from "../lib.js";

const SORTS = [["", "Automática"], ["proximidade", "Mais próximos"], ["avaliacao", "Melhor avaliados"], ["popularidade", "Mais populares"], ["preco", "Menor preço"]];

function availabilitySummary(av) {
  // agrupa dias consecutivos com os mesmos períodos: "Seg–Sex 08:00–12:00, 13:30–18:00"
  const by = {};
  av.forEach((w) => { (by[w.weekday] = by[w.weekday] || []).push(`${w.start}–${w.end}`); });
  const groups = [];
  Object.keys(by).map(Number).sort((a, b) => a - b).forEach((d) => {
    const key = by[d].join(", ");
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.to === d - 1) last.to = d; else groups.push({ key, from: d, to: d });
  });
  return groups.map((g) => `${g.from === g.to ? WEEKDAYS_SHORT[g.from] : `${WEEKDAYS_SHORT[g.from]}–${WEEKDAYS_SHORT[g.to]}`} ${g.key}`).join(" · ");
}

export function workerCard(w) {
  return h("article", { class: "card worker-card" },
    h("div", { class: "row", style: "flex-wrap:nowrap;align-items:flex-start" },
      h("div", { class: "avatar", "aria-hidden": "true" }, initials(w.name)),
      h("div", { class: "grow" },
        h("h3", null, h("a", { href: `#/profissional/${w.user_id}` }, w.name)),
        h("div", { class: "rate-line" }, stars(w.avg_rating), w.avg_rating ? `${w.avg_rating.toFixed(1)} (${w.review_count})` : "Sem avaliações",
          w.distance_km !== null && w.distance_km !== undefined ? h("span", null, icon("pin", "deco-strong"), ` ${w.distance_km} km`) : null))),
    h("div", { class: "chips" }, w.verification_status === "verificado" ? h("span", { class: "chip positive verified" }, "Perfil verificado") : null,
      ...w.categories.slice(0, 3).map((c) => h("span", { class: "chip" }, c.name))),
    w.description ? h("p", { class: "muted small" }, w.description.length > 140 ? w.description.slice(0, 140) + "…" : w.description) : null,
    h("div", { class: "small muted" }, `${w.city}/${w.uf} · atende até ${w.radius_km} km`),
    w.availability.length ? h("div", { class: "small muted" }, icon("clock", "deco-strong"), " ", availabilitySummary(w.availability)) : null,
    h("div", { class: "row between", style: "margin-top:auto" },
      h("span", null, w.min_rate !== null && w.min_rate !== undefined ? h("span", null, "a partir de ", h("span", { class: "price" }, brl(w.min_rate))) : h("span", { class: "muted" }, "Sem serviços")),
      h("a", { class: "btn btn-primary btn-sm", href: `#/profissional/${w.user_id}` }, "Ver perfil")));
}

export async function page() {
  const me = state.me;
  const cats = (await api.get("/categories")).items;
  const city = cityPicker({ city: me.user.city, uf: me.user.uf, required: false });
  const f = {
    q: field({ name: "q", label: "O que você precisa?", placeholder: "Ex.: eletricista, pintura, limpeza", maxlength: 80, class: "full" }),
    category_id: field({ name: "category_id", label: "Categoria", type: "select", placeholder: "Todas", options: cats.map((c) => ({ value: c.id, label: c.name })) }),
    sort: field({ name: "sort", label: "Ordenar por", type: "select", options: SORTS.map(([v, l]) => ({ value: v, label: l })) }),
    date: field({ name: "date", label: "Data", type: "date", min: todayLocal() }),
    from: field({ name: "from", label: "Das", type: "time" }),
    to: field({ name: "to", label: "Até", type: "time" }),
    max_km: field({ name: "max_km", label: "Distância máx. (km)", type: "number", min: 1, max: 500 }),
  };
  const results = h("div", { "aria-live": "polite" });
  let current = 1;
  async function run(pg = 1) {
    current = pg;
    mount(results, loading());
    const params = { page: pg, size: 12 };
    for (const [k, fld] of Object.entries(f)) params[k] = fld.get();
    params.city = city.city.get(); params.uf = city.uf.get();
    try {
      const r = await api.get("/workers/search", params);
      const head = h("p", { class: "muted" }, `${r.total} profissional(is) encontrado(s)`, r.reference.label ? ` · referência: ${r.reference.label}` : "");
      mount(results, head, r.items.length ? h("div", { class: "grid auto" }, ...r.items.map(workerCard)) : empty(r.message || "Nenhum profissional encontrado.", "search"),
        pager({ page: r.page, size: r.size, total: r.total, onPage: (p) => { run(p); window.scrollTo(0, 0); } }));
    } catch (err) {
      mount(results, notice(err.message, "error"));
      Object.entries(err.fields || {}).forEach(([k, m]) => f[k] && f[k].error(m));
    }
  }
  const filterForm = h("form", { class: "card", novalidate: true, role: "search", "aria-label": "Buscar profissionais", onSubmit: (e) => { e.preventDefault(); Object.values(f).forEach((x) => x.error("")); run(1); } },
    h("div", { class: "filters" }, f.q.el, city.els[0], city.uf.el, f.category_id.el, f.sort.el),
    h("details", { style: "margin-top:12px" }, h("summary", { class: "strong", style: "cursor:pointer" }, "Disponibilidade e distância"),
      h("div", { class: "filters", style: "margin-top:12px" }, f.date.el, f.from.el, f.to.el, f.max_km.el)),
    h("div", { class: "form-actions" }, h("button", { class: "btn btn-primary", type: "submit" }, icon("search"), "Buscar")));
  run(1);
  return h("div", { class: "stack" }, pageHead("Buscar profissionais", "Encontre trabalhadores autônomos perto de você, compare avaliações e preços."), filterForm, results);
}

/* ------------------------------------------------------------------ perfil público */
export async function profile(ctx) {
  const { profile: p } = await api.get(`/workers/${ctx.params.id}`);
  const mine = p.user_id === state.me.user.id;
  const reviewsBox = h("div", { class: "stack" });
  let shown = p.reviews.length;
  const renderReviews = (items) => items.map((r) => h("li", null, h("div", { class: "list-item" }, h("div", null, stars(r.rating), " ", h("span", { class: "strong" }, r.client_name), h("span", { class: "muted small" }, ` · ${r.service_name || "Serviço"} · ${fmtDate(r.created_at)}`)),),
    r.comment ? h("p", { class: "muted" }, r.comment) : null));
  const list = h("ul", { class: "list" }, ...renderReviews(p.reviews));
  const more = h("button", { class: "btn btn-outline btn-sm", type: "button", onClick: async () => {
    const r = await api.get(`/workers/${p.user_id}/reviews`, { page: Math.floor(shown / 10) + 1, size: 10 });
    const next = r.items.slice(shown % 10 === 0 ? 0 : shown % 10);
    if (!next.length) { more.remove(); return; }
    list.append(...renderReviews(next)); shown += next.length; if (shown >= r.total) more.remove();
  } }, "Ver mais avaliações");
  const startChat = async () => { const r = await api.post("/conversations", { worker_id: p.user_id }); location.hash = `#/conversas/${r.conversation_id}`; };
  return h("div", { class: "stack" },
    p.status !== "ativo" ? notice("Este perfil não está disponível para novas contratações no momento.") : null,
    h("section", { class: "card" }, h("div", { class: "row", style: "align-items:flex-start;flex-wrap:nowrap" },
      h("div", { class: "avatar lg", "aria-hidden": "true" }, initials(p.name)),
      h("div", { class: "grow stack-sm" },
        h("h1", { tabindex: "-1", style: "margin:0" }, p.name),
        h("div", { class: "chips" }, p.verification_status === "verificado" ? h("span", { class: "chip positive verified" }, "Perfil verificado") : h("span", { class: "chip" }, "Não verificado"),
          ...p.categories.map((c) => h("span", { class: "chip" }, c.name))),
        h("div", { class: "rate-line" }, stars(p.rating.avg), p.rating.count ? `${Number(p.rating.avg).toFixed(1)} · ${p.rating.count} avaliação(ões)` : "Ainda sem avaliações", ` · ${p.jobs_done} serviço(s) concluído(s)`),
        h("div", { class: "muted" }, icon("pin", "deco-strong"), ` ${p.city}/${p.uf} · atende até ${p.radius_km} km — ${p.service_area}`)),
      mine ? h("a", { class: "btn btn-outline", href: "#/perfil-profissional" }, "Editar perfil") : p.status === "ativo" ? h("button", { class: "btn btn-positive", type: "button", onClick: startChat }, icon("chat"), "Conversar") : null),
      p.description ? h("p", { style: "margin-top:16px" }, p.description) : null),
    h("div", { class: "split reverse" },
      h("div", { class: "stack" },
        h("section", { class: "card", "aria-labelledby": "h-serv" }, h("h2", { id: "h-serv" }, "Serviços"),
          p.services.length ? h("ul", { class: "list" }, ...p.services.map((s) => h("li", null, h("div", { class: "list-item" },
            h("div", { class: "grow" }, h("div", { class: "strong" }, s.name), h("div", { class: "muted small" }, `${s.category_name} · ${s.avg_duration_min} min`), h("p", { class: "muted small" }, s.description)),
            h("div", { class: "stack-sm", style: "align-items:flex-end" }, h("span", { class: "price" }, brl(s.base_rate)),
              !mine && p.status === "ativo" ? h("a", { class: "btn btn-primary btn-sm", href: `#/servico/${s.id}` }, "Solicitar") : null))))) : empty("Este profissional ainda não cadastrou serviços.", "tool")),
        h("section", { class: "card", "aria-labelledby": "h-rev" }, h("h2", { id: "h-rev" }, "Avaliações"),
          p.rating.count ? h("div", { class: "stack" }, list, p.rating.count > shown ? more : null) : empty("Este profissional ainda não possui avaliações.", "star"))),
      h("aside", { class: "stack" },
        h("section", { class: "card", "aria-labelledby": "h-disp" }, h("h2", { id: "h-disp" }, "Horários de atendimento"),
          p.availability.length ? h("dl", { class: "kv" }, ...Object.entries(p.availability.reduce((a, w) => { (a[w.weekday] = a[w.weekday] || []).push(`${w.start}–${w.end}`); return a; }, {}))
            .flatMap(([d, v]) => [h("dt", null, WEEKDAYS[d]), h("dd", null, v.join(", "))])) : h("p", { class: "muted" }, "Sem horários cadastrados.")),
        p.avg_rate ? h("section", { class: "card" }, h("div", { class: "stat" }, h("span", { class: "num" }, brl(p.avg_rate)), h("span", { class: "lbl" }, "valor médio dos serviços"))) : null)));
}

/* ------------------------------------------------------------------ calendário + horários */
export function calendarPicker({ days, onPick, selected }) {
  const byMonth = [];
  days.forEach((d) => { const k = d.date.slice(0, 7); let g = byMonth.find((x) => x.key === k); if (!g) { g = { key: k, items: [] }; byMonth.push(g); } g.items.push(d); });
  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const root = h("div", { class: "stack" });
  const buttons = [];
  byMonth.forEach((g) => {
    const first = new Date(g.items[0].date + "T12:00:00Z");
    const [yy, mm] = g.key.split("-");
    const grid = h("div", { class: "cal", role: "group", "aria-label": `${MONTHS[+mm - 1]} de ${yy}` }, ...WEEKDAYS_SHORT.map((d) => h("div", { class: "dow", "aria-hidden": "true" }, d)),
      ...Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => h("div", { class: "pad" })));
    g.items.forEach((d) => {
      const b = h("button", { type: "button", disabled: d.free === 0, class: d.free ? "has-free" : "", "aria-pressed": String(selected === d.date),
        "aria-label": `${fmtDay(d.date)}${d.free ? `, ${d.free} horário(s) livre(s)` : ", sem horários"}`, onClick: () => {
          buttons.forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); onPick(d.date);
        } }, String(+d.date.slice(8)));
      buttons.push(b); grid.append(b);
    });
    root.append(h("div", null, h("h3", null, `${MONTHS[+mm - 1][0].toUpperCase()}${MONTHS[+mm - 1].slice(1)} de ${yy}`), grid));
  });
  return root;
}

/* ------------------------------------------------------------------ solicitar serviço (UC04) */
function dynamicFields(defs) {
  return defs.map((d) => {
    const base = { name: `a${d.id}`, label: d.label, required: d.required, class: "full" };
    const opts = (d.options || []).map((o) => ({ value: o, label: o }));
    if (d.type === "textarea") return { def: d, f: field({ ...base, type: "textarea", rows: 3 }) };
    if (d.type === "select") return { def: d, f: field({ ...base, type: "select", placeholder: "Selecione", options: opts }) };
    if (d.type === "radio") return { def: d, f: field({ ...base, type: "radiogroup", options: opts }) };
    if (d.type === "checkbox") return { def: d, f: field({ ...base, type: "checkgroup", options: opts }) };
    if (d.type === "number") return { def: d, f: field({ ...base, type: "number", step: "any" }) };
    if (d.type === "date") return { def: d, f: field({ ...base, type: "date" }) };
    return { def: d, f: field({ ...base, maxlength: 1000 }) };
  });
}

export async function requestService(ctx) {
  const { service: s } = await api.get(`/services/${ctx.params.id}`);
  const cal = await api.get(`/services/${s.id}/calendar`, { days: 30 });
  let date = "", time = "";
  const slotsBox = h("div", { "aria-live": "polite" }, h("p", { class: "muted" }, "Selecione uma data no calendário para ver os horários livres."));
  const chosen = h("p", { class: "strong", "aria-live": "polite" });
  const whenErr = h("div", { class: "err", role: "alert", hidden: true });
  const dyn = dynamicFields(s.form_fields || []);
  const loc = field({ name: "location", label: "Local de execução do serviço", required: true, maxlength: 200, placeholder: "Rua, número, bairro e cidade", class: "full", value: "" });
  const notes = field({ name: "notes", label: "Observações", type: "textarea", rows: 3, maxlength: 800, class: "full", hint: "Detalhes que ajudem o profissional (opcional)." });

  async function pickDate(d) {
    date = d; time = ""; chosen.textContent = ""; whenErr.hidden = true;
    mount(slotsBox, loading());
    const r = await api.get(`/services/${s.id}/slots`, { date: d });
    if (!r.slots.length) { mount(slotsBox, notice(r.message || "Não há horários livres nesta data.")); return; }
    const btns = r.slots.map((sl) => h("button", { class: "slot", type: "button", "aria-pressed": "false", onClick: () => {
      btns.forEach((b) => b.setAttribute("aria-pressed", "false")); btns[r.slots.indexOf(sl)].setAttribute("aria-pressed", "true");
      time = sl.start; chosen.textContent = `Selecionado: ${fmtDay(d)} das ${sl.start} às ${sl.end}`; whenErr.hidden = true;
    } }, `${sl.start} – ${sl.end}`));
    mount(slotsBox, h("div", { class: "slots", role: "group", "aria-label": `Horários em ${dateBr(d)}` }, ...btns));
  }

  const fm = form([loc, ...dyn.map((x) => x.f), notes], {
    submitLabel: "Enviar solicitação",
    onSubmit: async (v) => {
      if (!date || !time) { whenErr.textContent = "Selecione a data e o horário desejados."; whenErr.hidden = false; return; }
      const answers = {};
      dyn.forEach((x) => { const val = v[x.f.name]; if (val !== "" && !(Array.isArray(val) && !val.length)) answers[x.def.id] = val; });
      const r = await api.post("/requests", { service_id: s.id, date, time, location: v.location, notes: v.notes, answers });
      toast(r.message);
      location.hash = `#/solicitacoes/${r.request.id}`;
    },
    cancel: h("a", { class: "btn btn-outline", href: `#/profissional/${s.worker.user_id}` }, "Voltar"),
  });
  return h("div", { class: "stack" },
    pageHead("Solicitar serviço", `${s.name} com ${s.worker.name}`),
    h("div", { class: "split reverse" },
      h("div", { class: "stack" },
        h("section", { class: "card", "aria-labelledby": "h-when" }, h("h2", { id: "h-when" }, "1. Escolha data e horário"),
          calendarPicker({ days: cal.days, onPick: (d) => pickDate(d).catch((e) => mount(slotsBox, notice(e.message, "error"))) }),
          h("hr", { class: "sep" }), slotsBox, chosen, whenErr),
        h("section", { class: "card", "aria-labelledby": "h-det" }, h("h2", { id: "h-det" }, "2. Detalhes do serviço"), fm.el)),
      h("aside", { class: "card stack-sm" }, h("h2", null, s.name),
        h("div", { class: "chips" }, h("span", { class: "chip" }, s.category_name)),
        h("p", { class: "muted" }, s.description),
        h("dl", { class: "kv" }, h("dt", null, "Valor padrão"), h("dd", { class: "price" }, brl(s.base_rate)), h("dt", null, "Duração"), h("dd", null, `${s.avg_duration_min} min`),
          h("dt", null, "Área"), h("dd", null, s.service_area), h("dt", null, "Antecedência"), h("dd", null, `mín. ${s.min_notice_hours} h${s.max_notice_hours ? `, máx. ${s.max_notice_hours} h` : ""}`),
          h("dt", null, "Cancelamento"), h("dd", null, `${s.cancellation_fee_percent}% de taxa nas últimas 24 h`)),
        s.notes ? h("p", { class: "small muted" }, s.notes) : null,
        notice("Sua solicitação vira uma proposta no chat. O profissional pode aceitar, recusar ou enviar uma contraproposta.")),
    ));
}
