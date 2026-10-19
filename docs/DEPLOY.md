# Publicar o Handly

Requisitos: Node ≥ 22.13 e um **disco persistente** (o banco é um arquivo SQLite).

## Render
1. Suba o projeto no GitHub e crie um **Web Service** (runtime Node).
2. Build command: vazio. Start command: `node server/index.js`.
3. Em *Disks*, adicione um disco (ex.: montado em `/data`). Requer plano pago.
4. Variáveis: `HANDLY_ENV=production`, `HANDLY_DB=/data/handly.db`, `HANDLY_ADMIN_PASSWORD=<senha forte>`,
   `HANDLY_COOKIE_SECURE=1`, `HANDLY_PUBLIC_URL=https://seu-app.onrender.com`, `NODE_VERSION=22`.

## Railway
1. Novo projeto a partir do repositório; adicione um **Volume** em `/data`.
2. Mesmas variáveis acima (`HANDLY_DB=/data/handly.db`). A porta é lida de `PORT`.

## VPS / computador próprio
`HANDLY_ENV=production HANDLY_ADMIN_PASSWORD=... HANDLY_DB=/var/lib/handly/handly.db node server/index.js`
atrás de um proxy HTTPS (Nginx/Caddy). Faça backup periódico do arquivo `.db`.
