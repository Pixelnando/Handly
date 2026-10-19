// Roteador mínimo. Padrões: /api/x/:id (somente dígitos → número) e /api/x/:tipo~ (qualquer texto sem "/").
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const names = [];
    const re = pattern.split('/').map((seg) => {
      const m = /^:(\w+)(~?)$/.exec(seg);
      if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push([m[1], m[2] === '~']);
      return m[2] ? '([^/]+)' : '(\\d+)';
    }).join('/');
    this.routes.push({ method, pattern, names, re: new RegExp(`^${re}$`), handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }
  /** → { route, params } | { methodNotAllowed:true } | null */
  match(method, path) {
    let pathHit = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathHit = true;
      if (r.method !== method) continue;
      const params = {};
      r.names.forEach(([n, isStr], i) => { params[n] = isStr ? decodeURIComponent(m[i + 1]) : Number(m[i + 1]); });
      return { route: r, params };
    }
    return pathHit ? { methodNotAllowed: true } : null;
  }
}
