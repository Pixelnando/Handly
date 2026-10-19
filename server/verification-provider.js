// Adaptadores do serviço externo de verificação de identidade (RF15, RN09, RN34–RN36).
// Contrato: verify(payload) -> Promise<{approved, message}> ou lança ProviderUnavailable.
// `mock` (padrão): validação local determinística. O número de documento ERRO503 simula indisponibilidade.
// `http`: POST JSON para HANDLY_VERIFICATION_URL com Bearer HANDLY_VERIFICATION_API_KEY.
import { normText, onlyDigits, validCpf } from './util.js';

export class ProviderUnavailable extends Error {}

function age(birth) { // birth = 'YYYY-MM-DD'
  const now = new Date(), [y, m, d] = birth.split('-').map(Number);
  return now.getUTCFullYear() - y - ((now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) ? 1 : 0);
}

// Similaridade equivalente ao SequenceMatcher.ratio (Ratcliff/Obershelp).
export function similarity(a, b) {
  const matches = (x, y) => {
    if (!x.length || !y.length) return 0;
    let best = 0, bi = 0, bj = 0;
    const prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      let diag = 0;
      for (let j = 1; j <= y.length; j++) {
        const tmp = prev[j];
        prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) { best = prev[j]; bi = i; bj = j; }
        diag = tmp;
      }
    }
    if (!best) return 0;
    return best + matches(x.slice(0, bi - best), y.slice(0, bj - best)) + matches(x.slice(bi), y.slice(bj));
  };
  return a.length + b.length === 0 ? 1 : (2 * matches(a, b)) / (a.length + b.length);
}

class MockProvider {
  name = 'mock';
  async verify(p) {
    if (p.document_number.trim().toUpperCase() === 'ERRO503') throw new ProviderUnavailable('serviço de verificação indisponível');
    if (!validCpf(p.cpf)) return { approved: false, message: 'CPF da conta não passou na validação.' };
    if (similarity(normText(p.name), normText(p.account_name)) < 0.8)
      return { approved: false, message: 'O nome informado no documento não confere com o cadastro.' };
    if (onlyDigits(p.document_number).length < 5) return { approved: false, message: 'Número do documento inválido.' };
    if (age(p.birth_date) < 18) return { approved: false, message: 'É necessário ter 18 anos ou mais.' };
    if (!p.document_image?.length || !p.selfie_image?.length) return { approved: false, message: 'Imagens do documento e da selfie são obrigatórias.' };
    return { approved: true, message: 'Identidade verificada com sucesso.' };
  }
}

class HttpProvider {
  name = 'http';
  constructor(url, key) { this.url = url; this.key = key; }
  async verify(p) {
    const payload = {
      cpf: p.cpf, name: p.name, birth_date: p.birth_date, document_type: p.document_type, document_number: p.document_number,
      document_image: Buffer.from(p.document_image).toString('base64'), selfie_image: Buffer.from(p.selfie_image).toString('base64'),
    };
    let data;
    try {
      const resp = await fetch(this.url, {
        method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      });
      data = await resp.json();
    } catch (exc) { throw new ProviderUnavailable(String(exc.message || exc)); }
    if (!data || typeof data !== 'object' || !('approved' in data)) throw new ProviderUnavailable('resposta inválida do serviço');
    return { approved: !!data.approved, message: String(data.message || '') };
  }
}

export function getProvider(cfg) {
  if (cfg.VERIFICATION_PROVIDER === 'http' && cfg.VERIFICATION_URL) return new HttpProvider(cfg.VERIFICATION_URL, cfg.VERIFICATION_API_KEY);
  return new MockProvider();
}
