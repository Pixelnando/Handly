// Utilitários HTTP: cookies, corpo JSON e multipart/form-data (sem dependências).
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge = null, secure = false, expire = false } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge !== null && maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (expire) c += '; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0';
  if (secure) c += '; Secure';
  return c;
}

/** Retorna { fields, files } ou lança Error se malformado. */
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: {} };
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {}, files = {};
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.subarray(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    let part = buf.subarray(start + 2, next - 2); // remove CRLF após o boundary e antes do próximo
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      const data = part.subarray(sep + 4);
      const name = /name="([^"]*)"/i.exec(head);
      if (name) {
        if (/filename="/i.test(head)) { if (data.length) files[name[1]] = Buffer.from(data); }
        else fields[name[1]] = data.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(Object.assign(new Error('too_large'), { code: 'too_large' })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
