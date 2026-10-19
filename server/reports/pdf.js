// Escritor de PDF mínimo (sem dependências): texto Helvetica (WinAnsi), retângulos, linhas, tabelas com quebra de página.
import zlib from 'node:zlib';

const W = (s) => s.split(' ').map(Number);
// larguras Helvetica / Helvetica-Bold para os caracteres 32..126 (milésimos de em)
const HELV = W('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584');
const BOLD = W('278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584');
// cp1252 0x80–0x9F → Unicode
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
const SPECIAL_W = { 0x85: 1000, 0x95: 350, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x9b: 333, 0x8b: 333, 0x99: 1000, 0x80: 556 };
const BASE = 'AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy'; // 0xC0..0xFF → letra base

function toWin(str) { // string → array de códigos WinAnsi
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else if (cp === 0x2192 || cp === 0x203a) out.push(0x3e);
    else out.push(0x3f);
  }
  return out;
}
function charW(code, bold) {
  const t = bold ? BOLD : HELV;
  if (code >= 32 && code <= 126) return t[code - 32];
  if (SPECIAL_W[code]) return SPECIAL_W[code];
  if (code >= 0xc0) { const b = BASE[code - 0xc0]; const bc = b.charCodeAt(0); return bc >= 32 && bc <= 126 ? t[bc - 32] : 556; }
  if (code === 0xa0) return 278;
  return 556;
}
export function textWidth(str, size, bold = false) { return toWin(str).reduce((a, c) => a + charW(c, bold), 0) * size / 1000; }

const pdfStr = (codes) => '(' + codes.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('') + ')';
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); };
const n2 = (n) => (Math.round(n * 100) / 100).toString();

/** Quebra o texto em linhas que caibam em maxW. */
export function wrap(str, maxW, size, bold = false) {
  const lines = [];
  for (const para of String(str ?? '').split(/\r?\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (textWidth(w, size, bold) > maxW) { // palavra maior que a coluna: corta
        let i = w.length;
        while (i > 1 && textWidth(w.slice(0, i), size, bold) > maxW) i--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, i)); w = w.slice(i);
      }
      const t = cur ? `${cur} ${w}` : w;
      if (textWidth(t, size, bold) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

export class Pdf {
  constructor({ width, height, title = '', author = '' }) {
    this.w = width; this.h = height; this.title = title; this.author = author; this.pages = []; this.cur = null;
    this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); }
  /** y = distância do topo da página até a linha de base. */
  text(x, y, str, { size = 10, bold = false, color = '#000000' } = {}) {
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${n2(x)} ${n2(this.h - y)} Td ${pdfStr(toWin(String(str)))} Tj ET`);
  }
  rect(x, y, w, h, fill) { this.cur.push(`${rgb(fill)} rg ${n2(x)} ${n2(this.h - y - h)} ${n2(w)} ${n2(h)} re f`); }
  line(x1, y1, x2, y2, color = '#cccccc', width = 0.25) { this.cur.push(`${rgb(color)} RG ${width} w ${n2(x1)} ${n2(this.h - y1)} m ${n2(x2)} ${n2(this.h - y2)} l S`); }
  rectStroke(x, y, w, h, color = '#cccccc', width = 0.25) { this.cur.push(`${rgb(color)} RG ${width} w ${n2(x)} ${n2(this.h - y - h)} ${n2(w)} ${n2(h)} re S`); }
  build() {
    const objs = []; // índice = número do objeto - 1
    const add = (s) => { objs.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')); return objs.length; };
    const catalog = add(''), pagesId = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const t16 = (s) => '<FEFF' + Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase() + '>';
    const info = add(`<< /Title ${t16(this.title)} /Author ${t16(this.author)} /Producer (Handly) >>`);
    const kids = [];
    for (const ops of this.pages) {
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const cid = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
      const pid = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n2(this.w)} ${n2(this.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`);
      kids.push(pid);
    }
    objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objs[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let pos = parts[0].length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
      parts.push(b); pos += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}
