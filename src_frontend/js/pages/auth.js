/* Cadastro (RF01), login (RF02), recuperação de acesso (UC03). */
import { api, h, field, form, cityPicker, notice, logoFull, maskCpfInput, toast } from "../lib.js";
import { setSession, sessionStorageSafe } from "../app.js";

function authFrame(title, subtitle, content, wide = false) {
  return h("div", { class: "auth-wrap" }, h("div", { class: `card auth-card${wide ? " wide" : ""}` },
    h("div", { class: "brand", role: "img", "aria-label": "Handly" }, ...logoFull()),
    h("h1", { tabindex: "-1", class: "center" }, title), subtitle ? h("p", { class: "muted center" }, subtitle) : null, content));
}

export function login(ctx) {
  const flash = sessionStorageSafe("hd-flash");
  const f = [
    field({ name: "identifier", label: "Login ou e-mail", required: true, autocomplete: "username", class: "full" }),
    field({ name: "password", label: "Senha", type: "password", required: true, autocomplete: "current-password", class: "full" }),
    field({ name: "remember", label: "Manter conectado neste dispositivo", type: "checkbox", class: "full" }),
  ];
  const fm = form(f, {
    submitLabel: "Entrar", submitClass: "btn-primary btn-block", actionsClass: "stack", className: "stack",
    onSubmit: async (v) => {
      const me = await api.post("/auth/login", { identifier: v.identifier, password: v.password, remember: v.remember });
      setSession(me);
      const next = ctx.query.next ? decodeURIComponent(ctx.query.next) : "";
      location.hash = "#" + (next && next.startsWith("/") ? next : me.user.role === "admin" ? "/admin" : "/");
    },
  });
  return authFrame("Entrar", "Acesse sua conta para buscar ou oferecer serviços.", h("div", { class: "stack" },
    flash ? notice(flash, "") : null, fm.el,
    h("p", { class: "center small" }, h("a", { class: "link", href: "#/recuperar" }, "Esqueci meu login ou senha")),
    h("hr", { class: "sep" }),
    h("p", { class: "center" }, "Ainda não tem conta? ", h("a", { class: "link", href: "#/cadastro" }, "Cadastre-se"))));
}

export function register() {
  const city = cityPicker();
  const f = [
    field({ name: "name", label: "Nome completo", required: true, autocomplete: "name", maxlength: 120, class: "full" }),
    field({ name: "login", label: "Login", required: true, autocomplete: "username", maxlength: 30, hint: "3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.", transform: (v) => v.toLowerCase() }),
    field({ name: "cpf", label: "CPF", required: true, inputmode: "numeric", mask: maskCpfInput, maxlength: 14, placeholder: "000.000.000-00" }),
    field({ name: "email", label: "E-mail", type: "email", required: true, autocomplete: "email", maxlength: 254, class: "full" }),
    field({ name: "password", label: "Senha", type: "password", required: true, autocomplete: "new-password", hint: "Mínimo de 8 caracteres, com letras e números." }),
    field({ name: "password2", label: "Confirmar senha", type: "password", required: true, autocomplete: "new-password" }),
    { ...city.city, el: city.els[0] }, city.uf,
  ];
  const fm = form(f, {
    submitLabel: "Criar conta",
    onSubmit: async (v, map) => {
      if (v.password !== v.password2) { map.password2.error("As senhas não coincidem."); map.password2.focus(); return; }
      await api.post("/auth/register", { name: v.name, login: v.login, cpf: v.cpf, email: v.email, password: v.password, city: v.city, uf: v.uf });
      sessionStorageSafe("hd-flash", "Cadastro realizado com sucesso. Agora é só entrar.");
      location.hash = "#/entrar";
    },
  });
  return authFrame("Criar conta", "Cadastro gratuito para clientes. Para oferecer serviços, assine um plano depois.", h("div", { class: "stack" }, fm.el,
    h("p", { class: "center" }, "Já tem conta? ", h("a", { class: "link", href: "#/entrar" }, "Entrar"))), true);
}

export function forgot() {
  const out = h("div");
  const fm = form([field({ name: "identifier", label: "Login ou e-mail cadastrado", required: true, autocomplete: "username", class: "full" })], {
    submitLabel: "Enviar instruções", submitClass: "btn-primary btn-block", className: "stack", actionsClass: "stack",
    onSubmit: async (v) => {
      const r = await api.post("/auth/forgot", { identifier: v.identifier });
      out.replaceChildren(notice(r.message, "success"),
        r.dev_link ? h("p", { class: "small" }, "Ambiente de demonstração (sem SMTP configurado): ", h("a", { class: "link", href: new URL(r.dev_link).hash }, "abrir link de redefinição")) : null);
    },
  });
  return authFrame("Recuperar acesso", "Enviaremos seu login e um link para criar uma nova senha ao e-mail cadastrado.", h("div", { class: "stack" }, fm.el, out,
    h("p", { class: "center" }, h("a", { class: "link", href: "#/entrar" }, "Voltar para o login"))));
}

export function reset(ctx) {
  const token = ctx.query.token || "";
  if (!token) return authFrame("Link inválido", null, h("div", { class: "stack" }, notice("O link de recuperação está incompleto. Solicite um novo.", "error"), h("a", { class: "btn btn-primary", href: "#/recuperar" }, "Solicitar novo link")));
  const fm = form([
    field({ name: "password", label: "Nova senha", type: "password", required: true, autocomplete: "new-password", hint: "Mínimo de 8 caracteres, com letras e números.", class: "full" }),
    field({ name: "password2", label: "Confirmar nova senha", type: "password", required: true, autocomplete: "new-password", class: "full" }),
  ], {
    submitLabel: "Salvar nova senha", submitClass: "btn-primary btn-block", className: "stack", actionsClass: "stack",
    onSubmit: async (v, map) => {
      if (v.password !== v.password2) { map.password2.error("As senhas não coincidem."); map.password2.focus(); return; }
      await api.post("/auth/reset", { token, password: v.password });
      sessionStorageSafe("hd-flash", "Senha alterada. Entre com a nova senha.");
      toast("Senha alterada.");
      location.hash = "#/entrar";
    },
  });
  return authFrame("Nova senha", "Defina uma nova senha para sua conta.", fm.el);
}
