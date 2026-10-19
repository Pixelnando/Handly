/* Assinatura (RF14, UC12), conta do usuário (RF01.3/01.4, LGPD) e notificações. */
import { api, h, mount, field, form, cityPicker, icon, notice, empty, loading, pageHead, brl, fmtDate, fmtDateTime, toast, confirmDialog, state, download } from "../lib.js";
import { reloadMe, sessionStorageSafe } from "../app.js";

/* ------------------------------------------------------------------ assinatura */
export async function subscription() {
  const root = h("div", { class: "stack" });
  const STATUS = { ativa: ["positive", "Ativa"], futura: ["pending", "Renovação agendada"], expirada: ["", "Expirada"], cancelada: ["negative", "Cancelada"] };
  async function load() {
    const [sub, plans] = await Promise.all([api.get("/subscription"), api.get("/plans")]);
    const cur = sub.current;
    async function buy(plan, renewing) {
      const end = new Date(Date.now() + plan.duration_days * 864e5).toLocaleDateString("pt-BR");
      const ok = await confirmDialog({ title: renewing ? "Renovar assinatura" : "Contratar plano", confirmLabel: renewing ? "Renovar" : "Contratar",
        message: h("div", { class: "stack-sm" }, h("p", null, `Plano ${plan.name}: ${brl(plan.price)} por ${plan.duration_days} dias.`),
          notice("Nesta versão o pagamento é simulado: nenhuma cobrança real é feita.")) });
      if (!ok) return;
      try { const r = await api.post(renewing ? "/subscription/renew" : "/subscription", { plan_id: plan.id, confirm: true }); toast(r.message); await reloadMe(); load(); }
      catch (e) { toast(e.message, "error"); }
    }
    const canBuy = sub.can_subscribe, canRenew = sub.can_renew;
    mount(root, pageHead("Assinatura", "Necessária para atuar como profissional e receber novas contratações."),
      sub.alert ? notice(sub.alert + " Contrate um plano para voltar a receber solicitações.") : null,
      cur ? h("section", { class: "card", "aria-labelledby": "h-cur" }, h("div", { class: "card-head" }, h("h2", { id: "h-cur" }, "Assinatura atual"), h("span", { class: "chip positive" }, "Ativa")),
        h("dl", { class: "kv" }, h("dt", null, "Plano"), h("dd", null, cur.plan_name), h("dt", null, "Vigência"), h("dd", null, `${fmtDate(cur.start_at)} a ${fmtDate(cur.end_at)}`),
          h("dt", null, "Dias restantes"), h("dd", null, String(sub.days_left)), h("dt", null, "Valor pago"), h("dd", null, brl(cur.price_paid))),
        sub.future ? h("p", { class: "muted" }, `Renovação contratada: ${sub.future.plan_name}, a partir de ${fmtDate(sub.future.start_at)}.`) : null,
        h("div", { class: "form-actions", style: "justify-content:flex-start" }, h("button", { class: "btn btn-danger btn-sm", type: "button", onClick: async () => {
          const ok = await confirmDialog({ title: "Cancelar assinatura", danger: true, confirmLabel: "Cancelar assinatura", cancelLabel: "Manter",
            message: "Você deixará de aparecer nas buscas e de receber novas contratações. Seu perfil e seus serviços serão preservados." });
          if (!ok) return;
          try { const r = await api.post("/subscription/cancel", { confirm: true }); toast(r.message); await reloadMe(); load(); } catch (e) { toast(e.message, "error"); }
        } }, "Cancelar assinatura"))) : null,
      h("section", { "aria-labelledby": "h-plans" }, h("h2", { id: "h-plans" }, canRenew ? "Renovar assinatura" : "Planos"),
        !canBuy && !canRenew ? notice(sub.future ? "Sua renovação já está contratada." : `A renovação fica disponível nos últimos 7 dias da assinatura.`) : null,
        h("div", { class: "grid cols-3", style: "margin-top:12px" }, ...plans.items.map((p, i) => h("article", { class: `card plan${i === 1 ? " featured" : ""}` },
          h("h3", null, p.name, i === 1 ? h("span", { class: "chip positive", style: "margin-left:8px" }, "Mais escolhido") : null),
          h("div", { class: "big" }, brl(p.price)), h("div", { class: "muted" }, `${p.duration_days} dias · ${brl(p.price / (p.duration_days / 30))}/mês`),
          h("ul", null, ...p.features.map((x) => h("li", null, x))),
          h("button", { class: `btn ${i === 1 ? "btn-positive" : "btn-primary"} btn-block`, type: "button", disabled: !canBuy && !canRenew, style: "margin-top:auto", onClick: () => buy(p, !canBuy && canRenew) },
            canRenew && !canBuy ? "Renovar com este plano" : "Contratar")))),
      ),
      h("section", { class: "card", "aria-labelledby": "h-hist" }, h("h2", { id: "h-hist" }, "Histórico"),
        sub.history.length ? h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("caption", { class: "sr-only" }, "Histórico de assinaturas"),
          h("thead", null, h("tr", null, ...["Plano", "Início", "Fim", "Valor", "Situação"].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", null, ...sub.history.map((x) => { const st = STATUS[x.status] || ["", x.status]; return h("tr", null, h("td", null, x.plan_name), h("td", null, fmtDate(x.start_at)), h("td", null, fmtDate(x.end_at)), h("td", null, brl(x.price_paid)), h("td", null, h("span", { class: `chip ${st[0]}` }, st[1]))); }))))
          : empty("Você ainda não possui assinaturas.", "money")));
  }
  await load();
  return root;
}

/* ------------------------------------------------------------------ conta */
export async function myAccount() {
  const me = state.me.user;
  const city = cityPicker({ city: me.city, uf: me.uf });
  const f = [
    field({ name: "name", label: "Nome completo", required: true, maxlength: 120, value: me.name, class: "full" }),
    field({ name: "login", label: "Login", value: me.login, disabled: true, hint: "O login não pode ser alterado." }),
    field({ name: "cpf", label: "CPF", value: me.cpf_masked, disabled: true, hint: "O CPF não pode ser alterado." }),
    field({ name: "email", label: "E-mail", type: "email", required: true, value: me.email, class: "full" }),
    { ...city.city, el: city.els[0] }, city.uf,
    field({ name: "current_password", label: "Senha atual", type: "password", autocomplete: "current-password", hint: "Necessária apenas para trocar a senha." }),
    field({ name: "new_password", label: "Nova senha", type: "password", autocomplete: "new-password", hint: "Deixe em branco para manter a atual." }),
  ];
  const fm = form(f, {
    submitLabel: "Salvar alterações",
    onSubmit: async (v) => {
      const body = { name: v.name, email: v.email, city: v.city, uf: v.uf };
      if (v.new_password) { body.new_password = v.new_password; body.current_password = v.current_password; }
      const r = await api.put("/users/me", body);
      toast(r.message); await reloadMe();
      fm.fields.current_password.set(""); fm.fields.new_password.set("");
    },
  });
  const exportBtn = h("button", { class: "btn btn-outline", type: "button", onClick: async () => {
    try { const r = await api.get("/users/me/export"); download(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }), "meus-dados-handly.json"); toast("Seus dados foram exportados."); }
    catch (e) { toast(e.message, "error"); }
  } }, icon("download"), "Exportar meus dados");
  const delBtn = h("button", { class: "btn btn-danger", type: "button", onClick: async () => {
    const v = await confirmDialog({ title: "Excluir conta", danger: true, confirmLabel: "Excluir minha conta", cancelLabel: "Voltar",
      message: "Seus dados pessoais serão removidos de forma irreversível. Não é possível excluir com solicitações em andamento.",
      fields: [{ name: "password", label: "Confirme sua senha", type: "password", required: true, autocomplete: "current-password" }] });
    if (!v) return;
    try { await api.post("/users/me/delete", { confirm: true, password: v.password }); sessionStorageSafe("hd-flash", "Sua conta foi excluída."); state.me = null; location.hash = "#/entrar"; location.reload(); }
    catch (e) { toast(e.message, "error"); }
  } }, icon("trash"), "Excluir minha conta");
  return h("div", { class: "stack" }, pageHead("Minha conta", "Atualize seus dados de contato e sua localização."),
    h("section", { class: "card", "aria-labelledby": "h-dados" }, h("h2", { id: "h-dados" }, "Dados pessoais"), fm.el),
    h("section", { class: "card stack", "aria-labelledby": "h-priv" }, h("h2", { id: "h-priv" }, "Privacidade e dados (LGPD)"),
      h("p", { class: "muted" }, "Você pode baixar uma cópia dos seus dados ou solicitar a exclusão da conta."), h("div", { class: "row" }, exportBtn, delBtn)));
}

/* ------------------------------------------------------------------ notificações */
export async function notifications() {
  const root = h("div", { class: "stack" });
  async function load() {
    const r = await api.get("/notifications", { size: 50 });
    mount(root, pageHead("Notificações", "Avisos sobre propostas, agendamentos, assinatura e avaliações.",
      r.items.some((n) => !n.read_at) ? h("button", { class: "btn btn-outline", type: "button", onClick: async () => { await api.post("/notifications/read"); load(); } }, "Marcar todas como lidas") : null),
      h("section", { class: "card" }, r.items.length ? h("ul", { class: "list" }, ...r.items.map((n) => h("li", { class: `notif${n.read_at ? "" : " unread"}` },
        h("a", { class: "list-item", href: n.link || "#/notificacoes", onClick: () => { if (!n.read_at) api.post("/notifications/read", { ids: [n.id] }).catch(() => {}); } },
          h("div", null, h("div", { class: "strong" }, n.title), h("div", { class: "muted" }, n.body)), h("div", { class: "muted small nowrap" }, fmtDateTime(n.created_at)))))) : empty(r.message, "bell")));
  }
  await load();
  return root;
}
