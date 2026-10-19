// Funções compartilhadas entre solicitações e chat: conversas, mensagens imutáveis (RN41) e propostas.
import { money, nowIso, parseIso, toLocal } from './util.js';

export function getOrCreateConversation(db, clientId, workerId, serviceId = null) {
  const conv = db.get('SELECT * FROM conversations WHERE client_id=? AND worker_id=? AND ifnull(service_id,0)=ifnull(?,0)', clientId, workerId, serviceId);
  if (conv) return conv;
  const r = db.run('INSERT INTO conversations(client_id,worker_id,service_id,created_at) VALUES(?,?,?,?)', clientId, workerId, serviceId, nowIso());
  return db.get('SELECT * FROM conversations WHERE id=?', r.lastInsertRowid);
}
export function addMessage(db, convId, senderId, mtype, text, proposalId = null) {
  return db.run('INSERT INTO messages(conversation_id,sender_id,type,body,proposal_id,created_at) VALUES(?,?,?,?,?,?)',
    convId, senderId, mtype, text, proposalId, nowIso()).lastInsertRowid;
}
export const systemMessage = (db, convId, text) => addMessage(db, convId, null, 'sistema', text);

export function createProposal(db, convId, requestId, senderId, kind, serviceId, value, startIso, endIso, location, notes, parentId = null) {
  const pid = db.run(
    `INSERT INTO proposals(conversation_id,request_id,sender_id,parent_id,kind,service_id,value,scheduled_start,
     scheduled_end,location,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    convId, requestId, senderId, parentId, kind, serviceId, value, startIso, endIso, location, notes, nowIso()).lastInsertRowid;
  const label = kind === 'contraproposta' ? 'Contraproposta' : 'Proposta';
  addMessage(db, convId, senderId, 'proposta', `${label}: ${money(value)} — ${fmtDt(startIso)}`, pid);
  return pid;
}
const p2 = (n) => String(n).padStart(2, '0');
export function fmtDt(isoStr) {
  const d = toLocal(parseIso(isoStr));
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} às ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
export function fmtLocal(isoStr) { // dd/mm/aaaa HH:MM
  const d = toLocal(parseIso(isoStr));
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
const KEYS = ['id', 'request_id', 'sender_id', 'parent_id', 'kind', 'service_id', 'value', 'scheduled_start', 'scheduled_end', 'location', 'notes', 'status', 'created_at', 'responded_at'];
export const proposalDict = (row) => Object.fromEntries(KEYS.map((k) => [k, row[k]]));
