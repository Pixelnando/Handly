// Verifica o contraste WCAG 2.x (AA) dos pares de cores definidos em src_frontend/css/tokens.css.
// Uso: npm test   (ou: node tests/contrast.test.js para ver a tabela)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src_frontend', 'css', 'tokens.css');
const raw = {};
for (const m of fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--(hd-[\w-]+):\s*([^;]+);/g)) raw[m[1]] = m[2].trim();

const parseHex = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
function resolve(v) {
  v = v.trim();
  if (v.startsWith('var(')) return resolve(raw[/var\(--([\w-]+)\)/.exec(v)[1]]);
  if (v.startsWith('#')) return parseHex(v);
  const m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v);
  if (m) { const a = resolve(m[1]), p = Number(m[2]) / 100, b = resolve(m[3]); return a.map((x, i) => Math.round(x * p + b[i] * (1 - p))); }
  throw new Error(v);
}
const lum = (c) => { const [r, g, b] = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const C = (n) => resolve(`var(--${n})`);

// [descrição, primeiro plano, fundo, mínimo]
const PAIRS = [
  ['Texto padrão sobre fundo (início do degradê)', 'hd-text', 'hd-bg-start', 4.5], ['Texto padrão sobre fundo (fim do degradê)', 'hd-text', 'hd-bg-end', 4.5],
  ['Texto padrão sobre card', 'hd-text', 'hd-card', 4.5], ['Texto secundário sobre card', 'hd-text-muted', 'hd-card', 4.5],
  ['Texto secundário sobre fundo (fim)', 'hd-text-muted', 'hd-bg-end', 4.5], ['Texto secundário sobre card elevado', 'hd-text-muted', 'hd-card-raised', 4.5],
  ['Texto sobre card em hover', 'hd-text', 'hd-card-hover', 4.5], ['Texto secundário sobre card em hover', 'hd-text-muted', 'hd-card-hover', 4.5],
  ['Primária — normal', 'hd-primary-fg', 'hd-primary-bg', 4.5], ['Primária — hover', 'hd-primary-fg-hover', 'hd-primary-bg-hover', 4.5],
  ['Positiva — normal', 'hd-positive-fg', 'hd-positive-bg', 4.5], ['Positiva — hover', 'hd-positive-fg-hover', 'hd-positive-bg-hover', 4.5],
  ['Destrutiva — normal', 'hd-danger-fg', 'hd-danger-bg', 4.5], ['Destrutiva — hover', 'hd-danger-fg-hover', 'hd-danger-bg-hover', 4.5],
  ['Secundária (contorno) — normal', 'hd-secondary-fg', 'hd-card', 4.5], ['Secundária (contorno) — hover', 'hd-secondary-fg', 'hd-secondary-bg-hover', 4.5],
  ['Selo positivo', 'hd-chip-positive-fg', 'hd-chip-positive-bg', 4.5], ['Selo negativo', 'hd-chip-negative-fg', 'hd-chip-negative-bg', 4.5],
  ['Selo neutro', 'hd-chip-neutral-fg', 'hd-chip-neutral-bg', 4.5], ['Selo pendente', 'hd-chip-pending-fg', 'hd-chip-pending-bg', 4.5],
  ['Mensagem própria (chat)', 'hd-text', 'hd-green-dark', 4.5], ['Link/erro (vermelho claro) sobre card', 'hd-red-light', 'hd-card', 4.5],
  ['Link (vermelho claro) sobre fundo (fim)', 'hd-red-light', 'hd-bg-end', 4.5], ['Texto em campo', 'hd-text', 'hd-field-bg', 4.5],
  ['Placeholder em campo', 'hd-text-muted', 'hd-field-bg', 4.5], ['Texto desabilitado (informativo)', 'hd-disabled-fg', 'hd-disabled-bg', 3.0],
  // não textuais (WCAG 1.4.11: 3:1). O anel de foco fica 2 px afastado do controle: medido contra a superfície ao redor.
  ['Borda de controle sobre card', 'hd-control-border', 'hd-card', 3.0], ['Borda de controle sobre campo', 'hd-control-border', 'hd-field-bg', 3.0],
  ['Anel de foco sobre card', 'hd-focus', 'hd-card', 3.0], ['Anel de foco sobre fundo (fim)', 'hd-focus', 'hd-bg-end', 3.0],
];

test('contraste WCAG AA dos tokens de cor', () => {
  const bad = [];
  console.log(`${'Par'.padEnd(52)}${'Razão'.padStart(8)}  Mín.  Resultado`);
  for (const [name, fg, bg, need] of PAIRS) {
    const r = ratio(C(fg), C(bg)), okk = r >= need;
    if (!okk) bad.push(name);
    console.log(`${name.padEnd(52)}${r.toFixed(2).padStart(7)}:1  ${String(need).padEnd(4)}  ${okk ? 'OK' : 'FALHA'}`);
  }
  console.log(`\n[informativo] creme da marca #f4f0e4 sobre ${raw['hd-red-dark']}: ${ratio(C('hd-text'), C('hd-red-dark')).toFixed(2)}:1 (< 4,5 — por isso o foreground do hover primário é mais claro)`);
  assert.deepEqual(bad, []);
});
