#!/usr/bin/env node
// Gera o front-end em UM único arquivo (HTML+CSS+JS) → index.html, a partir de src_frontend/.
// Uso: node tools/build-frontend.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src_frontend');
const ORDER = ['lib', 'pages/auth', 'pages/home', 'pages/search', 'pages/requests', 'pages/chat', 'pages/worker', 'pages/account', 'pages/reports', 'pages/admin', 'app'];
const nameOf = (p) => p.replace('pages/', '');

function transform(p) {
  let code = fs.readFileSync(path.join(SRC, 'js', `${p}.js`), 'utf8');
  const exports = [];
  code = code.replace(/^export (async )?(function|const|let|class) (\w+)/gm, (_m, a, kind, name) => { exports.push(name); return `${a || ''}${kind} ${name}`; });
  code = code.replace(/^import\s+([\s\S]+?)\s+from\s+"([^"]+)";?/gm, (_m, what, modPath) => {
    what = what.trim();
    const mod = nameOf(modPath.replace(/^(\.\.\/|\.\/)+/, '').replace('.js', ''));
    if (what.startsWith('* as ')) return `const ${what.slice(5).trim()} = __m.${mod};`;
    const names = what.replace(/^[{\s]+|[}\s]+$/g, '').split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(' as ', ': '));
    if (mod === 'app') // dependência circular: resolve na hora da chamada
      return names.map((n) => { const [orig, alias] = n.includes(': ') ? n.split(': ') : [n, n]; return `const ${alias} = (...a) => __m.app.${orig}(...a);`; }).join('\n');
    return `const { ${names.join(', ')} } = __m.${mod};`;
  });
  return `__m.${nameOf(p)} = (function () {\n${code}\nreturn { ${exports.join(', ')} };\n})();\n`;
}

const js = '"use strict";\nconst __m = {};\n' + ORDER.map(transform).join('');
if (js.toLowerCase().includes('</script')) throw new Error('"</script" encontrado no JS');
const css = ['tokens.css', 'base.css', 'components.css'].map((f) => fs.readFileSync(path.join(SRC, 'css', f), 'utf8')).join('\n');
const fav = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(SRC, 'assets', 'favicon.svg')).toString('base64');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
html = html.replace(/  <link rel="icon"[^>]*>\n/, () => `  <link rel="icon" type="image/svg+xml" href="${fav}">\n`);
html = html.replace(/  <link rel="stylesheet"[^>]*>\n/g, '');
html = html.replace('</head>', () => `  <style>\n${css}\n  </style>\n</head>`);
html = html.replace(/  <script type="module" src="[^"]*"><\/script>/, () => `  <script>\n${js}\n  </script>`);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`index.html gerado (${Math.floor(html.length / 1024)} KB)`);
