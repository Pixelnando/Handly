# Handly — plataforma de serviços (Node.js)

Back-end e front-end completos, em **JavaScript puro, sem dependências npm**. Precisa apenas do **Node 22.13 ou superior**
(usa `node:sqlite`, `node:http` e `node:crypto` nativos). O front-end é um único arquivo, `index.html`, servido pelo próprio servidor.

## Rodar no seu computador

```bash
node -v            # precisa ser v22.13 ou maior
npm run demo       # inicia com dados de demonstração
```

Abra **http://localhost:5000**.

| Perfil | Login | Senha |
|---|---|---|
| Cliente | `ana` | `Demo@1234` |
| Trabalhador | `carlos` | `Demo@1234` |
| Administrador | `admin` | `Admin@12345` (somente em desenvolvimento) |

Sem dados de demonstração: `npm start` (banco vazio, em `data/handly.db`).

## Testes

```bash
npm test     # 27 testes de integração (fluxos dos requisitos) + contraste WCAG AA das cores
```

## Front-end

Fontes em `src_frontend/`. Para regenerar o `index.html`: `node tools/build-frontend.js`.
Paleta e regras de contraste: `docs/DESIGN_TOKENS.md`.

## Variáveis de ambiente

| Variável | Função |
|---|---|
| `HANDLY_ENV` | `production` ativa modo seguro (exige `HANDLY_ADMIN_PASSWORD`) |
| `HANDLY_DB` | caminho do arquivo SQLite (use um disco persistente) |
| `HANDLY_PORT` / `PORT`, `HANDLY_HOST` | porta e endereço |
| `HANDLY_COOKIE_SECURE` | `1` quando servido por HTTPS |
| `HANDLY_PUBLIC_URL` | URL pública (links dos e-mails) |
| `HANDLY_ADMIN_LOGIN`, `HANDLY_ADMIN_EMAIL`, `HANDLY_ADMIN_PASSWORD` | administrador inicial |
| `HANDLY_SMTP_HOST/PORT/USER/PASSWORD/FROM` | envio real de e-mails (sem isso, ficam na caixa de saída do banco) |
| `HANDLY_VERIFICATION_PROVIDER` (`mock`/`http`), `_URL`, `_API_KEY` | verificação de identidade (no `mock`, o documento `ERRO503` simula indisponibilidade) |
| `HANDLY_TEST_MODE` | padrão ligado: sem antecedência mínima e conclusão liberada antes do horário. `0` restaura as regras originais (mínimo de 2 h) |
| `HANDLY_SESSION_IDLE_MIN`, `HANDLY_SESSION_REMEMBER_DAYS` | duração da sessão |

## Publicar (Render / Railway / VPS)

Veja `docs/DEPLOY.md`. **Não use Vercel**: o banco SQLite precisa de disco persistente.
