/* Administração (UC23, UC24, RN16, RNF04.2, RN25). */
import { api, h, mount, field, form, icon, stars, notice, empty, loading, pageHead, fmtDateTime, fmtDate, toast, dialog, confirmDialog, pager, debounce } from "../lib.js";

export async function dashboard() {
  const d = await api.get("/admin/dashboard");
  const stat = (num, lbl, href) => h(href ? "a" : "div", { class: `card tight stat${href ? " link-card" : ""}`, href }, h("span", { class: "num" }, String(num ?? "—")), h("span", { class: "lbl" }, lbl));
  return h("div", { class: "stack" }, pageHead("Painel administrativo", "Visão geral da plataforma."),
    d.pending_category_requests ? h("div", { class: "notice" }, `${d.pending_category_requests} solicitação(ões) de nova categoria aguardando análise. `, h("a", { class: "link", href: "#/admin/categorias" }, "Analisar")) : null,
    h("div", { class: "grid cols-4" }, stat(d.users, "Usuários ativos", "#/admin/usuarios"), stat(d.workers, "Perfis profissionais"), stat(d.active_workers, "Profissionais ativos"), stat(d.verified_workers, "Perfis verificados"),
      stat(d.active_subscriptions, "Assinaturas ativas"), stat(d.requests_total, "Solicitações"), stat(d.requests_open, "Em andamento"), stat(d.requests_completed, "Concluídas"),
      stat(d.reviews, "Avaliações", "#/admin/avaliacoes"), stat(d.avg_rating ?? "—", "Nota média"), stat(d.blocked_users, "Usuários bloqueados"), stat(d.pending_category_requests, "Categorias pendentes", "#/admin/categorias")),
    h("div", { class: "row" }, h("a", { class: "btn btn-primary", href: "#/relatorios" }, icon("chart"), "Relatórios"), h("a", { class: "btn btn-outline", href: "#/admin/auditoria" }, "Auditoria"), h("a", { class: "btn btn-outline", href: "#/admin/avisos" }, "Avisos de manutenção")));
}

/* ------------------------------------------------------------------ usuários */
export async function users() {
  const q = field({ name: "q", label: "Buscar", placeholder: "Nome, login ou e-mail", maxlength: 80 });
  const status = field({ name: "status", label: "Situação", type: "select", placeholder: "Todas", options: [{ value: "ativo", label: "Ativos" }, { value: "bloqueado", label: "Bloqueados" }] });
  const role = field({ name: "role", label: "Perfil", type: "select", placeholder: "Todos", options: [{ value: "user", label: "Clientes" }, { value: "worker", label: "Profissionais" }, { value: "admin", label: "Administradores" }] });
  const box = h("div", { "aria-live": "polite" });

  async function details(u) {
    const r = await api.get(`/admin/users/${u.id}`);
    const x = r.user;
    let dlg;
    const act = async (path, title, danger, needReason, extra = {}) => {
      const v = await confirmDialog({ title, danger, confirmLabel: title, message: `${x.name} (@${x.login})`, fields: needReason ? [{ name: "reason", label: "Motivo", type: "textarea", required: true, rows: 3, maxlength: 300 }] : [] });
      if (!v) return;
      try { const res = await api.post(path, { confirm: true, ...v, ...extra }); toast(res.message); dlg.close(true); load(); } catch (e) { toast(e.message, "error"); }
    };
    dlg = dialog({ title: x.name, content: h("div", { class: "stack" },
      h("dl", { class: "kv" }, h("dt", null, "Login"), h("dd", null, x.login), h("dt", null, "E-mail"), h("dd", null, x.email), h("dt", null, "CPF"), h("dd", null, x.cpf_masked),
        h("dt", null, "Local"), h("dd", null, `${x.city}/${x.uf}`), h("dt", null, "Perfil"), h("dd", null, x.role), h("dt", null, "Situação"), h("dd", null, x.status + (x.blocked_reason ? ` — ${x.blocked_reason}` : "")),
        h("dt", null, "Cadastro"), h("dd", null, fmtDate(x.created_at)), h("dt", null, "Solicitações (cliente)"), h("dd", null, String(x.requests_as_client)), h("dt", null, "Solicitações (profissional)"), h("dd", null, String(x.requests_as_worker)),
        x.worker ? [h("dt", null, "Perfil profissional"), h("dd", null, `${x.worker.status} · ${x.worker.verification_status}${x.worker.rating.count ? ` · nota ${x.worker.rating.avg}` : ""}`)] : null)),
      actions: [h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, "Fechar"),
        x.role !== "admin" && x.worker ? (x.worker.status === "bloqueado"
          ? h("button", { class: "btn btn-positive", type: "button", onClick: () => act(`/admin/workers/${x.id}/moderate`, "Liberar perfil profissional", false, false, { block: false }) }, "Liberar perfil")
          : h("button", { class: "btn btn-outline", type: "button", onClick: () => act(`/admin/workers/${x.id}/moderate`, "Bloquear perfil profissional", true, true, { block: true }) }, "Bloquear perfil")) : null,
        x.role !== "admin" ? (x.status === "bloqueado"
          ? h("button", { class: "btn btn-positive", type: "button", onClick: () => act(`/admin/users/${x.id}/unblock`, "Desbloquear usuário", false, false) }, "Desbloquear")
          : h("button", { class: "btn btn-danger", type: "button", onClick: () => act(`/admin/users/${x.id}/block`, "Bloquear usuário", true, true) }, "Bloquear")) : null] });
  }

  async function load(page = 1) {
    mount(box, loading());
    const r = await api.get("/admin/users", { q: q.get(), status: status.get(), role: role.get(), page, size: 25 });
    mount(box, r.items.length ? h("div", { class: "stack" }, h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, "Usuários cadastrados"),
      h("thead", null, h("tr", null, ...["Nome", "Login", "E-mail", "Local", "Perfil", "Situação", ""].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, ...r.items.map((u) => h("tr", null, h("td", { class: "strong" }, u.name), h("td", null, u.login), h("td", null, u.email), h("td", null, `${u.city}/${u.uf}`),
        h("td", null, u.role === "admin" ? "Administrador" : u.is_worker ? "Cliente e profissional" : "Cliente"),
        h("td", null, h("span", { class: `chip ${u.status === "ativo" ? "positive" : "negative"}` }, u.status === "ativo" ? "Ativo" : "Bloqueado")),
        h("td", null, h("button", { class: "btn btn-outline btn-sm", type: "button", "aria-label": `Detalhes de ${u.name}`, onClick: () => details(u).catch((e) => toast(e.message, "error")) }, "Detalhes"))))))),
      pager({ page: r.page, size: r.size, total: r.total, onPage: load })) : empty(r.message, "user"));
  }
  const d = debounce(() => load(1), 350);
  q.input.addEventListener("input", d); status.input.addEventListener("change", () => load(1)); role.input.addEventListener("change", () => load(1));
  load(1);
  return h("div", { class: "stack" }, pageHead("Usuários", "Consulte, bloqueie ou libere contas e perfis profissionais."), h("div", { class: "card" }, h("div", { class: "filters" }, q.el, status.el, role.el)), box);
}

/* ------------------------------------------------------------------ categorias */
export async function categories() {
  const root = h("div", { class: "stack" });
  function catDialog(c) {
    let dlg;
    const fm = form([field({ name: "name", label: "Nome", required: true, maxlength: 60, value: c?.name ?? "", class: "full" }),
      field({ name: "description", label: "Descrição", type: "textarea", rows: 3, maxlength: 400, value: c?.description ?? "", class: "full" }),
      c ? field({ name: "active", label: "Categoria ativa", type: "checkbox", value: !!c.active, class: "full" }) : null].filter(Boolean), {
      submitLabel: "Salvar",
      onSubmit: async (v) => { const r = c ? await api.put(`/admin/categories/${c.id}`, v) : await api.post("/admin/categories", v); toast(r.message); dlg.close(true); load(); },
      cancel: h("button", { class: "btn btn-outline", type: "button", onClick: () => dlg.close(null) }, "Cancelar") });
    dlg = dialog({ title: c ? "Editar categoria" : "Nova categoria", content: fm.el });
  }
  async function resolve(cr, approve) {
    const v = await confirmDialog({ title: approve ? "Aprovar categoria" : "Rejeitar solicitação", danger: !approve, confirmLabel: approve ? "Aprovar" : "Rejeitar", message: `“${cr.name}” — solicitada por ${cr.user_name}.`,
      fields: [{ name: "note", label: "Observação ao solicitante (opcional)", type: "textarea", rows: 2, maxlength: 300 }] });
    if (!v) return;
    try { const r = await api.post(`/admin/category-requests/${cr.id}/resolve`, { approve, note: v.note }); toast(r.message); load(); } catch (e) { toast(e.message, "error"); }
  }
  async function load() {
    const r = await api.get("/admin/categories");
    const pend = r.requests.filter((x) => x.status === "pendente");
    mount(root, pageHead("Categorias de serviço", "Gerencie as categorias e analise solicitações dos profissionais.", h("button", { class: "btn btn-primary", type: "button", onClick: () => catDialog(null) }, icon("plus"), "Nova categoria")),
      pend.length ? h("section", { class: "card", "aria-labelledby": "h-pend" }, h("h2", { id: "h-pend" }, "Solicitações pendentes"), h("ul", { class: "list" }, ...pend.map((cr) => h("li", null, h("div", { class: "list-item" },
        h("div", null, h("div", { class: "strong" }, cr.name), h("div", { class: "muted small" }, `${cr.user_name} · ${fmtDate(cr.created_at)}`), h("p", { class: "muted" }, cr.description)),
        h("div", { class: "row" }, h("button", { class: "btn btn-positive btn-sm", type: "button", onClick: () => resolve(cr, true) }, "Aprovar"), h("button", { class: "btn btn-danger btn-sm", type: "button", onClick: () => resolve(cr, false) }, "Rejeitar"))))))) : null,
      h("section", { class: "card flush" }, h("div", { class: "table-wrap", style: "border:0" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, "Categorias"),
        h("thead", null, h("tr", null, ...["Categoria", "Serviços", "Situação", ""].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, ...r.items.map((c) => h("tr", null, h("td", null, h("div", { class: "strong" }, c.name), h("div", { class: "muted small" }, c.description || "")), h("td", null, String(c.services_count)),
          h("td", null, h("span", { class: `chip ${c.active ? "positive" : ""}` }, c.active ? "Ativa" : "Inativa")),
          h("td", null, h("div", { class: "row" }, h("button", { class: "btn btn-outline btn-sm", type: "button", "aria-label": `Editar ${c.name}`, onClick: () => catDialog(c) }, icon("edit"), "Editar"),
            h("button", { class: "btn btn-danger btn-sm", type: "button", "aria-label": `Excluir ${c.name}`, onClick: async () => {
              const ok = await confirmDialog({ title: "Excluir categoria", danger: true, confirmLabel: "Excluir", message: `Excluir “${c.name}”? Se estiver em uso, será apenas desativada.` });
              if (!ok) return;
              try { const x = await api.del(`/admin/categories/${c.id}`); toast(x.message); load(); } catch (e) { toast(e.message, "error"); }
            } }, icon("trash"), "Excluir"))))))))));
  }
  await load();
  return root;
}

/* ------------------------------------------------------------------ avaliações (moderação, RN16) */
export async function reviews() {
  const filter = field({ name: "hidden", label: "Exibição", type: "select", placeholder: "Todas", options: [{ value: "0", label: "Visíveis" }, { value: "1", label: "Removidas" }] });
  const box = h("div");
  async function load(page = 1) {
    mount(box, loading());
    const r = await api.get("/admin/reviews", { hidden: filter.get(), page, size: 25 });
    mount(box, r.items.length ? h("div", { class: "stack" }, h("ul", { class: "list card" }, ...r.items.map((x) => h("li", null, h("div", { class: "list-item" },
      h("div", { class: "grow" }, stars(x.rating), " ", h("span", { class: "strong" }, `${x.client_name} → ${x.worker_name}`), h("div", { class: "muted small" }, `${x.service_name} · ${fmtDate(x.created_at)}${x.hidden ? ` · removida: ${x.hidden_reason}` : ""}`),
        x.comment ? h("p", null, x.comment) : null),
      h("button", { class: `btn btn-sm ${x.hidden ? "btn-positive" : "btn-danger"}`, type: "button", onClick: async () => {
        const v = await confirmDialog({ title: x.hidden ? "Restaurar avaliação" : "Remover avaliação", danger: !x.hidden, confirmLabel: x.hidden ? "Restaurar" : "Remover", message: "A avaliação é preservada para auditoria.",
          fields: x.hidden ? [] : [{ name: "reason", label: "Motivo", type: "textarea", required: true, rows: 3, maxlength: 300 }] });
        if (!v) return;
        try { const res = await api.post(`/admin/reviews/${x.id}/hide`, { confirm: true, hide: !x.hidden, reason: v.reason }); toast(res.message); load(page); } catch (e) { toast(e.message, "error"); }
      } }, x.hidden ? "Restaurar" : "Remover"))))), pager({ page, size: 25, total: r.total, onPage: load })) : empty("Nenhuma avaliação encontrada.", "star"));
  }
  filter.input.addEventListener("change", () => load(1));
  load(1);
  return h("div", { class: "stack" }, pageHead("Moderação de avaliações", "Remova da exibição avaliações que violem as políticas da plataforma."), h("div", { class: "card" }, h("div", { class: "filters" }, filter.el)), box);
}

/* ------------------------------------------------------------------ auditoria */
export async function audit() {
  const action = field({ name: "action", label: "Ação (prefixo)", placeholder: "Ex.: admin., usuario., relatorio.", maxlength: 60 });
  const box = h("div");
  const tabs = ["Registros de auditoria", "Relatórios gerados"];
  let tab = 0;
  async function load(page = 1) {
    mount(box, loading());
    if (tab === 0) {
      const r = await api.get("/admin/audit", { action: action.get(), page, size: 50 });
      mount(box, r.items.length ? h("div", { class: "stack" }, h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, "Auditoria"),
        h("thead", null, h("tr", null, ...["Quando", "Usuário", "Ação", "Objeto", "Detalhes"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, ...r.items.map((a) => h("tr", null, h("td", { class: "nowrap" }, fmtDateTime(a.created_at || a.ts)), h("td", null, a.user_login || "—"), h("td", null, a.action), h("td", null, `${a.entity || ""}${a.entity_id ? " #" + a.entity_id : ""}`),
          h("td", { class: "small muted" }, a.details || "")))))), pager({ page, size: 50, total: r.total, onPage: load })) : empty("Sem registros.", "shield"));
    } else {
      const r = await api.get("/admin/report-logs", { page, size: 50 });
      mount(box, r.items.length ? h("div", { class: "stack" }, h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, "Relatórios gerados"),
        h("thead", null, h("tr", null, ...["Quando", "Usuário", "Relatório", "Formato", "Filtros"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, ...r.items.map((a) => h("tr", null, h("td", { class: "nowrap" }, fmtDateTime(a.generated_at)), h("td", null, a.user_login), h("td", null, a.report_type), h("td", null, a.format), h("td", { class: "small muted" }, a.filters || "")))))), pager({ page, size: 50, total: r.total, onPage: load })) : empty("Nenhum relatório gerado.", "doc"));
    }
  }
  const tabBar = h("div", { class: "tabs", role: "tablist" }, ...tabs.map((t, i) => { const b = h("button", { type: "button", role: "tab", "aria-selected": String(i === 0), onClick: () => { tab = i; [...tabBar.children].forEach((x, j) => x.setAttribute("aria-selected", String(j === i))); load(1); } }, t); return b; }));
  action.input.addEventListener("input", debounce(() => { if (tab === 0) load(1); }, 400));
  load(1);
  return h("div", { class: "stack" }, pageHead("Auditoria", "Trilha de ações administrativas e geração de relatórios."), tabBar, h("div", { class: "card" }, h("div", { class: "filters" }, action.el)), box);
}

/* ------------------------------------------------------------------ avisos de manutenção */
export async function notices() {
  const root = h("div", { class: "stack" });
  async function load() {
    const r = await api.get("/maintenance");
    const msg = field({ name: "message", label: "Mensagem", required: true, maxlength: 300, class: "full" });
    const kind = field({ name: "kind", label: "Tipo", type: "select", options: [{ value: "manutencao", label: "Manutenção programada" }, { value: "indisponibilidade", label: "Indisponibilidade" }] });
    const starts = field({ name: "starts_at", label: "Início", type: "datetime-local", required: true });
    const ends = field({ name: "ends_at", label: "Término", type: "datetime-local", required: true });
    const toIso = (v) => (v ? new Date(v).toISOString().replace(/\.\d+Z$/, "Z") : "");
    const fm = form([msg, kind, starts, ends], { submitLabel: "Publicar aviso", onSubmit: async (v) => {
      const res = await api.post("/admin/maintenance", { message: v.message, kind: v.kind, starts_at: toIso(v.starts_at), ends_at: toIso(v.ends_at) }); toast(res.message); load(); } });
    mount(root, pageHead("Avisos de manutenção", "Os avisos são exibidos no topo para todos os usuários durante a vigência."),
      h("section", { class: "card" }, h("h2", null, "Novo aviso"), fm.el),
      h("section", { class: "card" }, h("h2", null, "Avisos vigentes ou futuros"), r.items.length ? h("ul", { class: "list" }, ...r.items.map((n) => h("li", null, h("div", { class: "list-item" },
        h("div", null, h("div", { class: "strong" }, n.message), h("div", { class: "muted small" }, `${n.kind} · ${fmtDateTime(n.starts_at)} a ${fmtDateTime(n.ends_at)}`)),
        h("button", { class: "btn btn-danger btn-sm", type: "button", onClick: async () => { try { await api.del(`/admin/maintenance/${n.id}`); toast("Aviso removido."); load(); } catch (e) { toast(e.message, "error"); } } }, "Remover"))))) : empty("Nenhum aviso cadastrado.", "bell")));
  }
  await load();
  return root;
}
