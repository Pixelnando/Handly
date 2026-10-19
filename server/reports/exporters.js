// Exportadores de relatório: PDF (escritor próprio), CSV (Excel pt-BR, ';' e BOM) e XLSX (escritor próprio).
import { csvSafe } from '../util.js';
import { fmtLocal } from './builders.js';
import { Pdf, textWidth, wrap } from './pdf.js';
import { buildXlsx } from './xlsx.js';

// Cores do PDF seguem a paleta da marca (cabeçalhos em verde escuro com texto claro: contraste 5,35:1).
const GREEN_DARK = '#286b74', CREAM = '#f4f0e4', INK = '#1e1e1e';
const NAMES = { usuario: 'relatorio-usuario', software: 'relatorio-software', engajamento: 'relatorio-engajamento', satisfacao: 'relatorio-satisfacao' };

export const filename = (report, ext) => `handly-${NAMES[report.type]}-${report.period.start}_a_${report.period.end}.${ext}`;
const headerBlock = (report) => [['Gerado em', fmtLocal(report.generated_at)], ...report.filters, ...report.identification];
const TRUNC_MSG = 'Atenção: resultado limitado ao máximo de linhas por seção. Refine o período ou os filtros.';

// ------------------------------------------------------------------ CSV
const csvField = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(report) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvField).join(';'));
  row([csvSafe(report.title)]);
  for (const [k, v] of headerBlock(report)) row([csvSafe(k), csvSafe(v)]);
  if (report.summary.length) { lines.push(''); row(['Resumo']); for (const [k, v] of report.summary) row([csvSafe(k), csvSafe(v)]); }
  for (const sec of report.sections) {
    lines.push(''); row([csvSafe(sec.title)]); row(sec.columns.map(csvSafe));
    for (const r of sec.rows) row(r.map(csvSafe));
  }
  if (report.truncated) { lines.push(''); row([TRUNC_MSG]); }
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

// ------------------------------------------------------------------ XLSX
export function toXlsx(report) {
  const sum = [[{ v: csvSafe(report.title), s: 2 }]];
  for (const [k, v] of headerBlock(report)) sum.push([csvSafe(k), csvSafe(v)]);
  sum.push([]);
  if (report.summary.length) { sum.push([{ v: 'Resumo', s: 1 }]); for (const [k, v] of report.summary) sum.push([csvSafe(k), csvSafe(v)]); }
  const sheets = [{ name: 'Resumo', rows: sum, widths: [52, 48] }];
  const used = new Set(['Resumo']);
  for (const sec of report.sections) {
    let name = sec.title.replace(/[\[\]*?/\\:]/g, '').slice(0, 28) || 'Dados';
    const baseName = name; let n = 2;
    while (used.has(name)) { name = `${baseName.slice(0, 25)} ${n}`; n++; }
    used.add(name);
    const rows = [sec.columns.map((c) => ({ v: c, s: 3 })), ...sec.rows.map((r) => r.map((c) => (typeof c === 'string' ? csvSafe(c) : c)))];
    const widths = sec.columns.map((col, i) => Math.min(60, Math.max(12, Math.max(String(col).length, ...sec.rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2)));
    sheets.push({ name, rows, widths, freeze: true });
  }
  return buildXlsx(sheets, { headFill: GREEN_DARK.slice(1), headText: CREAM.slice(1) });
}

// ------------------------------------------------------------------ PDF
export function toPdf(report) {
  const mm = 72 / 25.4;
  const wide = report.sections.some((s) => s.columns.length > 5);
  const [pw, ph] = wide ? [841.89, 595.28] : [595.28, 841.89];
  const doc = new Pdf({ width: pw, height: ph, title: report.title, author: 'Handly' });
  const M = 14 * mm, availW = pw - 2 * M, bottom = ph - 16 * mm;
  let y = M, pageNo = 1;
  const footer = () => {
    doc.text(M, ph - 8 * mm, `Handly — ${report.title} — gerado em ${fmtLocal(report.generated_at)}`, { size: 7.5, color: '#555555' });
    const t = `Página ${pageNo}`;
    doc.text(pw - M - textWidth(t, 7.5), ph - 8 * mm, t, { size: 7.5, color: '#555555' });
  };
  const newPage = () => { footer(); doc.addPage(); pageNo++; y = M; };
  const ensure = (h) => { if (y + h > bottom) newPage(); };
  const para = (str, { size = 9, bold = false, color = INK, leading = size * 1.25 } = {}) => {
    for (const ln of wrap(str, availW, size, bold)) { ensure(leading); y += leading; doc.text(M, y - leading * 0.22, ln, { size, bold, color }); }
  };

  ensure(30); y += 20; doc.text(M, y, report.title, { size: 18, bold: true, color: INK }); y += 6;
  para(`Período: ${report.period.label}`); y += 4;

  const kv = (pairs, labelW, bg) => {
    for (const [k, v] of pairs) {
      const kl = wrap(k, labelW - 8, 8, true), vl = wrap(v, availW - labelW - 8, 8);
      const lines = Math.max(kl.length, vl.length), h = lines * 9.5 + 5;
      ensure(h);
      if (bg) doc.rect(M, y, availW, h, bg);
      kl.forEach((l, i) => doc.text(M + 3, y + 3 + 8 + i * 9.5 - 1.5, l, { size: 8, bold: true, color: INK }));
      vl.forEach((l, i) => doc.text(M + labelW + 3, y + 3 + 8 + i * 9.5 - 1.5, l, { size: 8, color: INK }));
      doc.line(M, y + h, M + availW, y + h, bg ? '#d8d2c2' : '#cccccc');
      y += h;
    }
  };
  kv(headerBlock(report), 40 * mm, null);
  if (report.summary.length) {
    y += 6; ensure(40); y += 12; doc.text(M, y, 'Resumo', { size: 12, bold: true, color: GREEN_DARK }); y += 5;
    kv(report.summary, 90 * mm, CREAM);
  }
  for (const sec of report.sections) {
    ensure(70); y += 18; doc.text(M, y, sec.title, { size: 12, bold: true, color: GREEN_DARK }); y += 6;
    if (!sec.rows.length) { para('Sem registros no período.'); continue; }
    const ncol = sec.columns.length, cw = availW / ncol, pad = 3, fs = 8, lead = 9.5;
    const drawRow = (cells, header, zebra) => {
      const wrapped = cells.map((c) => wrap(c === null || c === undefined ? '' : String(c), cw - 2 * pad, fs, header));
      const h = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * pad;
      return { wrapped, h, header, zebra };
    };
    const paint = (r) => {
      if (r.header) doc.rect(M, y, availW, r.h, GREEN_DARK);
      else if (r.zebra) doc.rect(M, y, availW, r.h, CREAM);
      r.wrapped.forEach((lines, i) => lines.forEach((l, k) => doc.text(M + i * cw + pad, y + pad + fs + k * lead - 1, l, { size: fs, bold: r.header, color: r.header ? CREAM : INK })));
      for (let i = 0; i <= ncol; i++) doc.line(M + i * cw, y, M + i * cw, y + r.h);
      doc.line(M, y, M + availW, y); doc.line(M, y + r.h, M + availW, y + r.h);
      y += r.h;
    };
    const head = drawRow(sec.columns, true, false);
    sec.rows.forEach((cells, idx) => {
      const r = drawRow(cells, false, idx % 2 === 1);
      if (idx === 0) { ensure(head.h + r.h); paint(head); }
      else if (y + r.h > bottom) { newPage(); paint(head); }
      paint(r);
    });
  }
  if (report.truncated) { y += 6; para(TRUNC_MSG); }
  footer();
  return doc.build();
}

export const EXPORTERS = {
  csv: [toCsv, 'text/csv; charset=utf-8'],
  xlsx: [toXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pdf: [toPdf, 'application/pdf'],
};
