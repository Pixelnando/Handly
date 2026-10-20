/* Handly — shell da aplicação: sessão, roteador por hash, navegação por perfil, polling leve. */
import { api, ApiErr, h, mount, clear, icon, logoFull, state, notice, loading, toast } from "./lib.js";
import * as auth from "./pages/auth.js";
import * as home from "./pages/home.js";
import * as search from "./pages/search.js";
import * as requests from "./pages/requests.js";
import * as chat from "./pages/chat.js";
import * as worker from "./pages/worker.js";
import * as account from "./pages/account.js";
import * as reports from "./pages/reports.js";
import * as admin from "./pages/admin.js";

/* [padrão, página, acesso]  acesso: pub (apenas deslogado), any (logado), user (cliente/trabalhador), admin */
const ROUTES = [
  ["/entrar", auth.login, "pub"],
  ["/cadastro", auth.register, "pub"],
  ["/recuperar", auth.forgot, "pub"],
  ["/redefinir-senha", auth.reset, "open"],
  ["/", home.page, "any"],
  ["/buscar", search.page, "user"],
  ["/profissional/:id", search.profile, "user"],
  ["/servico/:id", search.requestService, "user"],
  ["/solicitacoes", requests.mine, "user"],
  ["/solicitacoes/:id", requests.detail, "user"],
  ["/recebidas", requests.received, "user"],
  ["/avaliacoes", requests.reviews, "user"],
  ["/conversas", chat.page, "user"],
  ["/conversas/:id", chat.page, "user"],
  ["/perfil-profissional", worker.profile, "user"],
  ["/servicos", worker.services, "user"],
  ["/servicos/novo", worker.serviceForm, "user"],
  ["/servicos/:id/editar", worker.serviceForm, "user"],
  ["/verificacao", worker.verification, "user"],
  ["/assinatura", account.subscription, "user"],
  ["/conta", account.myAccount, "user"],
  ["/notificacoes", account.notifications, "any"],
  ["/relatorios", reports.page, "any"],
  ["/admin", admin.dashboard, "admin"],
  ["/admin/usuarios", admin.users, "admin"],
  ["/admin/categorias", admin.categories, "admin"],
  ["/admin/avaliacoes", admin.reviews, "admin"],
  ["/admin/auditoria", admin.audit, "admin"],
  ["/admin/avisos", admin.notices, "admin"],
];

const compiled = ROUTES.map(([pattern, page, access]) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { re, keys, page, access };
});

const shell = document.getElementById("shell");
let leaveFns = [];
let renderToken = 0;
let summaryTimer = null;

export function onLeave(fn) { leaveFns.push(fn); }

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(query)) };
}

function navLinks() {
  const me = state.me;
  if (!me) return [];
  if (me.user.role === "admin") {
    return [["/admin", "Painel"], ["/admin/usuarios", "Usuários"], ["/admin/categorias", "Categorias"], ["/admin/avaliacoes", "Avaliações"],
      ["/admin/auditoria", "Auditoria"], ["/admin/avisos", "Avisos"], ["/relatorios", "Relatórios"]];
  }
  const links = [["/buscar", "Buscar"], ["/solicitacoes", "Solicitações"]];
  if (me.worker) links.push(["/recebidas", "Recebidas"], ["/servicos", "Serviços"]);
  links.push(["/conversas", "Conversas"], ["/relatorios", "Relatórios"]);
  return links;
}

function renderHeader(path) {
  const me = state.me;
  const links = navLinks();
  const isActive = (to) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));
  const nav = h("nav", { class: "nav", "aria-label": "Principal" }, ...links.map(([to, label]) => {
    const a = h("a", { href: "#" + to, "aria-current": isActive(to) ? "page" : undefined }, label);
    if (to === "/conversas" && state.summary.unread_messages) a.append(h("span", { class: "badge-count", "aria-label": `${state.summary.unread_messages} mensagens não lidas` }, state.summary.unread_messages));
    return a;
  }));
  const bell = h("a", { class: "btn btn-ghost", href: "#/notificacoes", "aria-label": state.summary.unread_notifications ? `Notificações: ${state.summary.unread_notifications} não lidas` : "Notificações" },
    icon("bell"), state.summary.unread_notifications ? h("span", { class: "badge-count" }, state.summary.unread_notifications) : null);
  const menuPanel = h("div", { class: "menu-panel", hidden: true, role: "menu" },
    h("div", { class: "menu-head" }, h("div", { class: "strong" }, me.user.name), h("div", { class: "muted small" }, `@${me.user.login}`)),
    h("hr", { class: "sep" }),
    me.user.role !== "admin" ? h("a", { href: "#/conta", role: "menuitem" }, "Minha conta") : null,
    me.user.role !== "admin" ? h("a", { href: "#/assinatura", role: "menuitem" }, me.subscription ? "Assinatura" : "Assinar um plano") : null,
    me.user.role !== "admin" ? h("a", { href: "#/avaliacoes", role: "menuitem" }, "Avaliações") : null,
    me.user.role !== "admin" ? h("a", { href: "#/perfil-profissional", role: "menuitem" }, me.worker ? "Perfil profissional" : "Seja um profissional") : null,
    me.worker ? h("a", { href: "#/verificacao", role: "menuitem" }, "Verificação de perfil") : null,
    h("hr", { class: "sep" }),
    h("button", { type: "button", role: "menuitem", onClick: logout }, "Sair"));
  const trigger = h("button", { class: "btn btn-outline btn-sm", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", onClick: () => {
    menuPanel.hidden = !menuPanel.hidden; trigger.setAttribute("aria-expanded", String(!menuPanel.hidden));
  } }, icon("user"), me.user.name.split(" ")[0]);
  const menu = h("div", { class: "menu" }, trigger, menuPanel);
  menuPanel.addEventListener("click", () => { menuPanel.hidden = true; trigger.setAttribute("aria-expanded", "false"); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) { menuPanel.hidden = true; trigger.setAttribute("aria-expanded", "false"); } });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { menuPanel.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus(); } });
  return h("header", { class: "site-header" }, h("div", { class: "container" },
    h("a", { class: "brand", href: "#/", "aria-label": "Handly — início" }, ...logoFull()),
    nav, h("div", { class: "header-actions" }, me.user.role === "admin" ? null : bell, menu)));
}

function renderBanners() {
  const items = state.summary.maintenance || [];
  return items.map((n) => h("div", { class: "banner", role: "status" }, h("strong", null, n.kind === "indisponibilidade" ? "Indisponibilidade programada: " : "Manutenção programada: "), n.message));
}

function frame(path, main, withNav) {
  const body = [];
  if (withNav && state.me) body.push(renderHeader(path));
  body.push(...renderBanners());
  body.push(main);
  if (withNav) body.push(h("footer", { class: "footer" }, h("div", { class: "container" }, "Handly · Projeto acadêmico FATEC Ourinhos · Pagamentos de assinatura simulados nesta versão.")));
  mount(shell, ...body);
}

export async function render() {
  const token = ++renderToken;
  leaveFns.forEach((f) => { try { f(); } catch { /* ignore */ } });
  leaveFns = [];
  const { path, query } = parseHash();
  const route = compiled.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
  const logged = !!state.me;
  if (!route) { frame(path, h("main", { id: "main", class: "container page", tabindex: "-1" }, notice("Página não encontrada."), h("p", null, h("a", { class: "link", href: "#/" }, "Voltar ao início"))), logged); return; }
  const { r } = route;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, route.m[i + 1]]));
  if (r.access === "pub" && logged) { location.replace("#" + (state.me.user.role === "admin" ? "/admin" : "/")); return; }
  if (r.access !== "pub" && r.access !== "open" && !logged) { location.replace("#/entrar?next=" + encodeURIComponent(path + (location.hash.includes("?") ? "?" + location.hash.split("?")[1] : ""))); return; }
  if (r.access === "admin" && state.me.user.role !== "admin") { location.replace("#/"); return; }
  if (r.access === "user" && state.me.user.role === "admin") { location.replace("#/admin"); return; }

  const plain = r.access === "pub" || (r.access === "open" && !logged);
  const main = h("main", { id: "main", class: plain ? "" : "container page", tabindex: "-1" }, loading());
  frame(path, main, !plain);
  const ctx = { params, query, path, onLeave, navigate: (p) => { location.hash = p; }, refreshShell };
  try {
    const node = await r.page(ctx);
    if (token !== renderToken) return;
    mount(main, node);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    const msg = err instanceof ApiErr ? err.message : "Ocorreu um erro inesperado ao carregar a página.";
    mount(main, notice(msg, "error"), h("p", null, h("a", { class: "link", href: "#/" }, "Voltar ao início")));
  }
  const focusTarget = main.querySelector("h1") || main;
  focusTarget.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export function refreshShell() {
  // Atualiza o cabeçalho (contadores, assinatura) sem recarregar a página atual.
  const header = shell.querySelector(".site-header");
  if (header && state.me) header.replaceWith(renderHeader(parseHash().path));
}

async function loadMe() {
  try { state.me = await api.get("/auth/me", null, { quiet401: true }); }
  catch (e) { state.me = null; if (e.code === "session_expired") sessionStorageSafe("hd-flash", "Sua sessão expirou por inatividade. Entre novamente."); }
}

export function sessionStorageSafe(k, v) {
  try { if (v === undefined) { const x = sessionStorage.getItem(k); sessionStorage.removeItem(k); return x; } sessionStorage.setItem(k, v); } catch { /* ignore */ }
  return null;
}

export async function reloadMe() { await loadMe(); refreshShell(); return state.me; }

async function logout() {
  try { await api.post("/auth/logout"); } catch { /* ignore */ }
  state.me = null; stopPolling();
  location.hash = "#/entrar";
  render();
}

export function setSession(me) { state.me = me; startPolling(); }

async function pollSummary() {
  if (!state.me) return;
  try {
    const prev = state.summary.unread_notifications;
    state.summary = await api.get("/summary", null, { quiet401: true });
    refreshShell();
    if (state.summary.unread_notifications > prev && prev !== undefined) toast("Você tem novas notificações.");
  } catch (e) {
    if (e.status === 401) { state.me = null; sessionStorageSafe("hd-flash", "Sua sessão expirou por inatividade. Entre novamente."); stopPolling(); render(); }
  }
}
function startPolling() { stopPolling(); pollSummary(); summaryTimer = setInterval(pollSummary, 25000); }
function stopPolling() { if (summaryTimer) clearInterval(summaryTimer); summaryTimer = null; }

document.addEventListener("hd:unauthorized", (e) => {
  if (!state.me) return;
  state.me = null; stopPolling();
  sessionStorageSafe("hd-flash", e.detail.code === "session_expired" ? "Sua sessão expirou por inatividade. Entre novamente." : "Entre para continuar.");
  location.hash = "#/entrar"; render();
});
window.addEventListener("hashchange", render);

(async function boot() {
  await loadMe();
  if (state.me) startPolling();
  await render();
})();
