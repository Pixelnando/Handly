// Hash de senha com scrypt (node:crypto). Também verifica hashes "scrypt:" do werkzeug (migração do Python).
import crypto from 'node:crypto';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(pw, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  try {
    let N, r, p, salt, hex;
    if (stored.startsWith('scrypt$')) {
      [, N, r, p, salt, hex] = stored.split('$');
    } else if (stored.startsWith('scrypt:')) { // werkzeug: scrypt:N:r:p$salt$hash
      const [head, s, h] = stored.split('$');
      [, N, r, p] = head.split(':'); salt = s; hex = h;
    } else if (stored.startsWith('pbkdf2:')) { // werkzeug: pbkdf2:sha256:iter$salt$hash
      const [head, s, h] = stored.split('$');
      const [, algo, iter] = head.split(':');
      const key = crypto.pbkdf2Sync(pw, s, Number(iter), Buffer.from(h, 'hex').length, algo);
      return crypto.timingSafeEqual(key, Buffer.from(h, 'hex'));
    } else return false;
    N = Number(N); r = Number(r); p = Number(p);
    const expected = Buffer.from(hex, 'hex');
    const key = crypto.scryptSync(pw, salt, expected.length, { N, r, p, maxmem: 256 * N * r });
    return crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

// Hash dummy para igualar o tempo quando o usuário não existe.
export const DUMMY_HASH = hashPassword('dummy-password-for-timing');
