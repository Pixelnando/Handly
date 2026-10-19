// Dados de demonstração (node server/index.js --demo). Senha de todos os usuários demo: Demo@1234.
// Clientes: ana, bruno, camila, diego | Trabalhadores: carlos, roberto, juliana, marcos, fernanda, paulo, leticia, sergio
// Administrador: admin / Admin@12345 (criado na inicialização, apenas em desenvolvimento)
import { findCity } from './cities.js';
import { hashPassword } from './passwords.js';
import { addDays, addHours, addMinutes, iso, localDateStr, localToUtc, nowIso, utcnow } from './util.js';

export const PASSWORD = 'Demo@1234';
const CLIENTS = [["Ana Souza", "ana", "Ourinhos", "SP"], ["Bruno Carvalho", "bruno", "Chavantes", "SP"], ["Camila Ferreira", "camila", "Marília", "SP"], ["Diego Martins", "diego", "Ourinhos", "SP"]];
const WORKERS = [["Carlos Mendes", "carlos", "Ourinhos", "SP", "Eletricista", "14998001001", true, "Eletricista há 12 anos. Atendimento residencial e comercial, com garantia de 90 dias nos serviços.", [["Instalação de tomadas e interruptores", 120, 60, "Instalação ou troca de pontos elétricos, com materiais de acabamento inclusos."], ["Troca de chuveiro elétrico", 90, 45, "Instalação segura do chuveiro, com checagem da fiação e do disjuntor."], ["Revisão do quadro de distribuição", 250, 120, "Inspeção completa, reaperto de conexões e organização do quadro."]]], ["Roberto Dias", "roberto", "Ourinhos", "SP", "Encanador", "14998001002", true, "Encanador com atendimento rápido para emergências e reformas hidráulicas.", [["Desentupimento de pia e ralo", 150, 60, "Desentupimento com equipamento profissional."], ["Reparo de vazamentos", 180, 90, "Localização e conserto de vazamentos em canos e registros."]]], ["Juliana Prado", "juliana", "Ourinhos", "SP", "Diarista e limpeza", "14998001003", true, "Limpeza residencial e pós-obra com produtos próprios. Pontualidade e capricho.", [["Limpeza residencial completa", 220, 240, "Limpeza completa de cômodos, banheiros e cozinha."]]], ["Marcos Oliveira", "marcos", "Chavantes", "SP", "Pintor", "14998001004", false, "Pintura residencial interna e externa, texturas e pequenos reparos de parede.", [["Pintura de cômodo (até 15 m²)", 380, 300, "Preparação das paredes, massa corrida e duas demãos de tinta."]]], ["Fernanda Alves", "fernanda", "Marília", "SP", "Jardinagem", "14998001005", true, "Paisagista e jardineira. Manutenção mensal e projetos de jardim.", [["Poda e manutenção de jardim", 200, 180, "Poda, adubação e limpeza de canteiros."]]], ["Paulo Ribeiro", "paulo", "Ourinhos", "SP", "Montador de móveis", "14998001006", false, "Montagem de guarda-roupas, cozinhas e móveis planejados.", [["Montagem de guarda-roupa", 160, 120, "Montagem completa com nivelamento e fixação na parede."], ["Montagem de cozinha modulada", 320, 240, "Montagem de armários aéreos e balcões."]]], ["Letícia Gomes", "leticia", "Assis", "SP", "Ar-condicionado", "14998001007", true, "Técnica em refrigeração. Instalação e limpeza de split.", [["Limpeza de ar-condicionado split", 170, 90, "Higienização completa da evaporadora e condensadora."]]], ["Sérgio Nunes", "sergio", "Londrina", "PR", "Chaveiro", "14998001008", false, "Chaveiro 24h para residências e veículos.", [["Abertura de porta residencial", 130, 30, "Abertura sem danos à fechadura."]]]];
const COMMENTS = ["Excelente profissional, pontual e muito educado.", "Serviço bem executado e preço justo.", "Resolveu o problema rapidamente. Recomendo!", "Muito caprichoso, deixou tudo limpo ao final.", "Bom atendimento, só atrasou um pouco.", "Ótimo trabalho, voltarei a contratar.", "", "Tudo certo, sem reclamações."];

function makeCpf(n) {
  const base = String(n).padStart(9, '0').split('').map(Number);
  for (const size of [9, 10]) {
    const s = base.reduce((a, d, i) => a + d * (size + 1 - i), 0);
    base.push(((s * 10) % 11) % 10);
  }
  return base.join('');
}

function mulberry32(seed) { // gerador pseudoaleatório determinístico
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function seedDemo(db, log = console.log) {
  if (db.val("SELECT COUNT(*) FROM users WHERE role='user'")) { log('[handly] banco já possui usuários; dados de demonstração não foram adicionados.'); return false; }
  const rand = mulberry32(7);
  const randint = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const choice = (arr) => arr[Math.floor(rand() * arr.length)];
  const ph = hashPassword(PASSWORD), ts = nowIso(), now = utcnow();
  let cpfN = 100000000;
  const users = {};
  const addUser = (name, login, city, uf) => {
    cpfN += 7919;
    const c = findCity(city, uf);
    const id = db.run(`INSERT INTO users(name,login,cpf,email,password_hash,city,uf,lat,lng,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      name, login, makeCpf(cpfN), `${login}@exemplo.com`, ph, city, uf, c ? c.lat : null, c ? c.lng : null, iso(addDays(now, -randint(60, 120))), ts).lastInsertRowid;
    users[login] = id;
    return id;
  };
  db.begin();
  for (const [n, l, c, u] of CLIENTS) addUser(n, l, c, u);
  const catIds = Object.fromEntries(db.all('SELECT id,name FROM categories').map((r) => [r.name, r.id]));
  const plan = db.get("SELECT * FROM plans WHERE name='Anual'");
  const services = {};
  for (const [n, l, c, u, cat, phone, verified, desc, svcs] of WORKERS) {
    const uid = addUser(n, l, c, u);
    db.run('INSERT INTO subscriptions(user_id,plan_id,start_at,end_at,status,price_paid,created_at) VALUES(?,?,?,?,?,?,?)', uid, plan.id, iso(addDays(now, -40)), iso(addDays(now, 325)), 'ativa', plan.price, ts);
    const pid = db.run(`INSERT INTO worker_profiles(user_id,phone,description,service_area,radius_km,status,verification_status,verified_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'ativo',?,?,?,?)`, uid, phone, desc, `${c} e região`, 30, verified ? 'verificado' : 'nao_verificado', verified ? ts : null, ts, ts).lastInsertRowid;
    db.run('INSERT INTO worker_categories VALUES(?,?)', pid, catIds[cat]);
    for (let wd = 0; wd < 5; wd++) { // seg-sex 08–12 e 13:30–18
      db.run('INSERT INTO availability(worker_profile_id,weekday,start_time,end_time) VALUES(?,?,?,?)', pid, wd, '08:00', '12:00');
      db.run('INSERT INTO availability(worker_profile_id,weekday,start_time,end_time) VALUES(?,?,?,?)', pid, wd, '13:30', '18:00');
    }
    db.run('INSERT INTO availability(worker_profile_id,weekday,start_time,end_time) VALUES(?,?,?,?)', pid, 5, '08:00', '12:00');
    for (const [name, rate, dur, sdesc] of svcs) {
      const sid = db.run(`INSERT INTO services(worker_id,name,category_id,description,base_rate,avg_duration_min,service_area,
        cancellation_fee_percent,min_notice_hours,max_notice_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        pid, name, catIds[cat], sdesc, rate, dur, `${c} e região`, 20, 2, 24 * 60, ts, ts).lastInsertRowid;
      (services[l] ||= []).push(sid);
    }
    const ff = (sid, label, type, options, required, pos) => db.run('INSERT INTO service_form_fields(service_id,label,type,options,required,position) VALUES(?,?,?,?,?,?)', sid, label, type, options ? JSON.stringify(options) : null, required, pos);
    if (cat === 'Diarista e limpeza') {
      const sid = services[l][0];
      ff(sid, 'Número de cômodos', 'number', null, 1, 0); ff(sid, 'Possui animais de estimação?', 'radio', ['Sim', 'Não'], 1, 1); ff(sid, 'Observações de acesso ao imóvel', 'textarea', null, 0, 2);
    }
    if (cat === 'Eletricista') {
      const sid = services[l][2];
      ff(sid, 'Tipo de instalação', 'select', ['Residencial', 'Comercial'], 1, 0); ff(sid, 'Há disjuntores desarmando?', 'radio', ['Sim', 'Não'], 0, 1);
    }
  }
  // --- histórico: serviços concluídos + avaliações (para perfil, busca por avaliação e relatórios)
  const clients = CLIENTS.map(([, l]) => users[l]);
  const place = 'Rua das Palmeiras, 120 — Centro';
  for (const [, l, c, u] of WORKERS) {
    const wid = users[l];
    const count = randint(3, 7);
    for (let k = 0; k < count; k++) {
      const sid = choice(services[l]);
      const svc = db.get('SELECT * FROM services WHERE id=?', sid);
      const cl = choice(clients);
      const days = randint(3, 55);
      const start = localToUtc(localDateStr(addDays(now, -days)), choice(['09:00', '10:30', '14:00', '15:30']));
      const end = addMinutes(start, svc.avg_duration_min);
      const value = Math.round(svc.base_rate * choice([1, 1, 1.1, 0.95]) * 100) / 100;
      const conv = db.get('SELECT id FROM conversations WHERE client_id=? AND worker_id=? AND service_id=?', cl, wid, sid);
      const convId = conv ? conv.id : db.run('INSERT INTO conversations(client_id,worker_id,service_id,created_at) VALUES(?,?,?,?)', cl, wid, sid, iso(addDays(start, -3))).lastInsertRowid;
      const rid = db.run(`INSERT INTO requests(client_id,worker_id,service_id,service_name,category_id,duration_min,scheduled_start,scheduled_end,
        location,notes,base_value,agreed_value,status,cancellation_fee_percent,completed_at,conversation_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'concluida',?,?,?,?,?)`, cl, wid, sid, svc.name, svc.category_id, svc.avg_duration_min, iso(start), iso(end), place, null,
        svc.base_rate, value, svc.cancellation_fee_percent, iso(end), convId, iso(addDays(start, -3)), iso(end)).lastInsertRowid;
      const prop = db.run(`INSERT INTO proposals(conversation_id,request_id,sender_id,kind,service_id,value,scheduled_start,scheduled_end,location,status,created_at,responded_at)
        VALUES(?,?,?,'proposta',?,?,?,?,?,'aceita',?,?)`, convId, rid, cl, sid, value, iso(start), iso(end), place, iso(addDays(start, -3)), iso(addDays(start, -2))).lastInsertRowid;
      db.run("INSERT INTO messages(conversation_id,sender_id,type,body,proposal_id,created_at,read_at) VALUES(?,?,'proposta',?,?,?,?)", convId, cl, `Proposta: R$ ${value.toFixed(2)}`, prop, iso(addDays(start, -3)), iso(addDays(start, -2)));
      db.run("INSERT INTO messages(conversation_id,sender_id,type,body,created_at,read_at) VALUES(?,NULL,'sistema',?,?,?)", convId, 'Proposta aceita. Condições acordadas registradas.', iso(addDays(start, -2)), iso(addDays(start, -2)));
      if (rand() < 0.85) {
        let x = rand() * 100;
        const rating = x < 55 ? 5 : x < 85 ? 4 : x < 95 ? 3 : 2;
        const at = iso(addHours(end, 5));
        db.run('INSERT INTO reviews(request_id,client_id,worker_id,service_id,category_id,rating,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', rid, cl, wid, sid, svc.category_id, rating, choice(COMMENTS) || null, at, at);
        db.run('INSERT INTO interactions(user_id,type,category_id,worker_id,ts) VALUES(?,?,?,?,?)', cl, 'avaliacao', svc.category_id, wid, at);
      }
      db.run('INSERT INTO interactions(user_id,type,category_id,worker_id,location,ts) VALUES(?,?,?,?,?,?)', cl, 'solicitacao', svc.category_id, wid, `${c}/${u}`, iso(addDays(start, -3)));
    }
  }
  // --- interações de navegação para o relatório de engajamento
  for (let i = 0; i < 160; i++) {
    const uid = choice(clients), wk = choice(WORKERS);
    const t = iso(addHours(addDays(now, -randint(0, 40)), -randint(0, 20)));
    const kind = choice(['acesso', 'busca', 'visualizacao_perfil', 'visualizacao_perfil', 'mensagem']);
    const cat = ['busca', 'visualizacao_perfil', 'mensagem'].includes(kind) ? catIds[wk[4]] : null;
    db.run('INSERT INTO interactions(user_id,type,category_id,worker_id,location,ts) VALUES(?,?,?,?,?,?)', uid, kind, cat,
      ['visualizacao_perfil', 'mensagem'].includes(kind) ? users[wk[1]] : null, `${wk[2]}/${wk[3]}`, t);
  }
  // --- uma solicitação futura agendada e duas pendentes para a demonstração do fluxo
  const future = (loginClient, loginWorker, hours, status, value = null) => {
    const sid = services[loginWorker][0];
    const svc = db.get('SELECT * FROM services WHERE id=?', sid);
    let start = localToUtc(localDateStr(addHours(now, hours)), '10:00');
    if (start < addHours(now, 3)) start = addDays(start, 1);
    const end = addMinutes(start, svc.avg_duration_min);
    const cl = users[loginClient], wid = users[loginWorker];
    const row = db.get('SELECT id FROM conversations WHERE client_id=? AND worker_id=? AND service_id=?', cl, wid, sid);
    const convId = row ? row.id : db.run('INSERT INTO conversations(client_id,worker_id,service_id,created_at) VALUES(?,?,?,?)', cl, wid, sid, ts).lastInsertRowid;
    const loc = 'Av. Brasil, 450 — Jardim América';
    const rid = db.run(`INSERT INTO requests(client_id,worker_id,service_id,service_name,category_id,duration_min,scheduled_start,scheduled_end,
      location,base_value,agreed_value,status,cancellation_fee_percent,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cl, wid, sid, svc.name, svc.category_id, svc.avg_duration_min, iso(start), iso(end), loc, svc.base_rate, value, status, svc.cancellation_fee_percent, convId, ts, ts).lastInsertRowid;
    const pid = db.run(`INSERT INTO proposals(conversation_id,request_id,sender_id,kind,service_id,value,scheduled_start,scheduled_end,location,status,created_at)
      VALUES(?,?,?,'proposta',?,?,?,?,?,?,?)`, convId, rid, cl, sid, svc.base_rate, iso(start), iso(end), loc, status === 'agendada' ? 'aceita' : 'pendente', ts).lastInsertRowid;
    db.run("INSERT INTO messages(conversation_id,sender_id,type,body,proposal_id,created_at) VALUES(?,?,'proposta',?,?,?)", convId, cl, `Proposta: R$ ${svc.base_rate.toFixed(2)}`, pid, ts);
  };
  future('ana', 'carlos', 30, 'agendada', 120.0);
  future('diego', 'carlos', 52, 'aguardando_resposta');
  future('ana', 'juliana', 76, 'aguardando_resposta');
  db.commit();
  log('[handly] dados de demonstração criados. Entre com ana / Demo@1234 (cliente), carlos / Demo@1234 (trabalhador) ou admin / Admin@12345.');
  return true;
}
