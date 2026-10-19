# Handly — tokens de design e contraste (WCAG 2.x AA)

Fonte única de cores: `src_frontend/css/tokens.css`. Nenhum outro arquivo CSS/JS usa cor literal
(exceção técnica: `assets/favicon.svg`, que como imagem não lê variáveis CSS; usa os mesmos valores da paleta).
Verificação automática: `npm test` (lê o próprio `tokens.css`).

## Paleta de marca
| Token | Valor | Uso |
|---|---|---|
| `--hd-card` | `#2c2c2c` | cards, menus, formulários, painéis |
| `--hd-text` | `#f4f0e4` | texto padrão |
| `--hd-red-light` / `--hd-red-dark` | `#ec8f8d` / `#b45656` | ação primária (normal / hover), links, erros |
| `--hd-green-light` / `--hd-green-dark` | `#44a194` / `#286b74` | ação positiva (normal / hover), selos, mensagens próprias |
| `--hd-bg` | `linear-gradient(180deg,#1e1e1e 0%,#290f18 100%)` | fundo padrão |
| `--hd-sep-12/-/-16` | `#f4f0e4` a 12 / 14 / 16 % | separadores |

Derivados (misturas `color-mix` da própria paleta): `--hd-text-muted`, `--hd-card-raised`, `--hd-card-hover`, `--hd-control-border`, `--hd-disabled-*`.

## Foreground por estado (calculado, nunca presumido)
| Componente | Estado | Fundo | Texto | Razão |
|---|---|---|---|---|
| Primária | normal | `#ec8f8d` | `#1e1e1e` | 7,05:1 |
| Primária | hover | `#b45656` | `#fdfcfa` | 4,65:1 |
| Positiva | normal | `#44a194` | `#1e1e1e` | 5,38:1 |
| Positiva | hover | `#286b74` | `#f4f0e4` | 5,35:1 |
| Destrutiva | normal / hover | `#b45656` / mais escuro | `#fdfcfa` | 4,65 / 6,73:1 |

### Exceção documentada
O creme da marca `#f4f0e4` sobre `#b45656` (hover primário) atinge só **4,18:1**, abaixo de AA. Conforme a regra
"preservar o fundo de marca e ajustar o foreground", o fundo permanece `#b45656` e o texto desse estado passa a
`#fdfcfa` (creme clareado em direção ao branco), 4,65:1. O mesmo foreground é usado em botão destrutivo e selo negativo.
Todas as demais combinações usam apenas a paleta e passam AA sem ajuste.

## Interação e acessibilidade
- Links herdam a cor do tema; sublinhado em `:hover` e `:focus-visible`.
- Foco visível: anel de 2 px em `--hd-focus` (`#f4f0e4`), deslocado 2 px, igual em botões, campos, links e controles (≥ 12:1 sobre cards/fundo).
- Bordas de controle ≥ 3:1 (WCAG 1.4.11): 3,84:1 sobre card, 4,58:1 sobre campo.
- Ícones **decorativos** usam opacidade 70 % / 40 % / 24 % (`--hd-icon-op-*`, classes `.deco-strong/-mid/-faint`); texto e ícones informativos nunca recebem opacidade.
- Estado nunca depende só da cor: selos têm texto; desabilitado tem cursor e rótulo; erros têm texto e `aria-invalid`.
- `prefers-reduced-motion` respeitado; navegação por teclado completa; diálogos com foco preso e `Esc`.
