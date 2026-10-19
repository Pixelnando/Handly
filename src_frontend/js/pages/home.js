/* Página inicial do cliente / trabalhador: resumo do que precisa de atenção. */
import { api, h, icon, state, pageHead, fmtDateTime, brl, statusChip, empty } from "../lib.js";

function requestRow(r, asWorker) {
  return h("li", null, h("a", { class: "list-item", href: `#/solicitacoes/${r.id}` },
    h("div", null, h("div", { class: "strong" }, r.service_name), h("div", { class: "muted small" }, `${asWorker ? r.client_name : r.worker_name} · ${fmtDateTime(r.scheduled_start)}`)),
    h("div", { class: "row" }, h("span", { class: "price" }, brl(r.agreed_value ?? r.base_value)), statusChip(r.status))));
}

export async function page() {
  const me = state.me;
  const [mine, pending, sub, recv] = await Promise.all([
    api.get("/requests", { role: "client", size: 5 }),
    api.get("/reviews/pending"),
    api.get("/subscription"),
    me.worker ? api.get("/requests", { role: "worker", status: "aguardando_resposta,em_negociacao,agendada", size: 5 }) : Promise.resolve(null),
  ]);
  const alerts = [];
  if (sub.alert) alerts.push(h("div", { class: "notice" }, h("strong", null, sub.alert), " ", h("a", { class: "link", href: "#/assinatura" }, "Ver planos")));
  if (me.worker && !me.subscription) alerts.push(h("div", { class: "notice" }, "Seu perfil profissional está sem assinatura ativa: você não aparece nas buscas nem recebe novas contratações."));
  if (sub.can_renew) alerts.push(h("div", { class: "notice" }, `Sua assinatura vence em ${sub.days_left} dia(s). `, h("a", { class: "link", href: "#/assinatura" }, "Renovar")));
  if (pending.items.length) alerts.push(h("div", { class: "notice success" }, `${pending.items.length} serviço(s) concluído(s) aguardando sua avaliação. `, h("a", { class: "link", href: "#/avaliacoes" }, "Avaliar agora")));

  return h("div", { class: "stack" },
    pageHead(`Olá, ${me.user.name.split(" ")[0]}!`, "O que você quer fazer hoje?",
      h("a", { class: "btn btn-primary", href: "#/buscar" }, icon("search"), "Buscar profissionais"),
      me.worker ? null : h("a", { class: "btn btn-outline", href: "#/perfil-profissional" }, icon("tool"), "Quero oferecer serviços")),
    ...alerts,
    h("div", { class: "grid cols-2" },
      h("section", { class: "card", "aria-labelledby": "h-mine" },
        h("div", { class: "card-head" }, h("h2", { id: "h-mine" }, "Minhas solicitações"), h("a", { class: "link small", href: "#/solicitacoes" }, "Ver todas")),
        mine.items.length ? h("ul", { class: "list" }, ...mine.items.map((r) => requestRow(r, false)))
          : empty("Você ainda não possui solicitações de serviço.", "calendar", h("a", { class: "btn btn-primary btn-sm", href: "#/buscar" }, "Encontrar um profissional"))),
      me.worker
        ? h("section", { class: "card", "aria-labelledby": "h-recv" },
          h("div", { class: "card-head" }, h("h2", { id: "h-recv" }, "Solicitações recebidas"), h("a", { class: "link small", href: "#/recebidas" }, "Ver todas")),
          recv.items.length ? h("ul", { class: "list" }, ...recv.items.map((r) => requestRow(r, true))) : empty("Nenhuma solicitação em aberto.", "inbox"))
        : h("section", { class: "card", "aria-labelledby": "h-pro" },
          h("h2", { id: "h-pro" }, "Ofereça seus serviços"),
          h("p", { class: "muted" }, "Cadastre seu perfil profissional, defina horários e valores e receba solicitações de clientes da sua região."),
          h("a", { class: "btn btn-positive", href: me.subscription ? "#/perfil-profissional" : "#/assinatura" }, me.subscription ? "Criar perfil profissional" : "Conhecer os planos"))),
  );
}
