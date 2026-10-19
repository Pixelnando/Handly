// Categorias de serviço (UC15 solicitar nova categoria, UC23 gerenciar categorias).
import { admin, audit, fail, login, notify, ok } from '../api.js';
import { getProfile } from '../domain.js';
import { cleanStr, normText, nowIso, pick } from '../util.js';

const catPayload = (d, errs) => {
  const name = cleanStr(d.name, 60), desc = cleanStr(d.description, 400);
  if ([...name].length < 3) errs.name = 'Informe o nome da categoria.';
  return { name, desc };
};

export default function routes(r) {
  r.get('/categories', (ctx) => ok({ items: ctx.db.all('SELECT id,name,description FROM categories WHERE active=1 ORDER BY name') }));

  // ---- trabalhador: solicitar categoria (UC15)
  r.post('/category-requests', login((ctx) => {
    const { db, user } = ctx, d = ctx.body;
    if (!getProfile(db, user.id)) fail('no_worker_profile', 'Somente trabalhadores podem solicitar novas categorias.', 403);
    const name = cleanStr(d.name, 60), desc = cleanStr(d.description, 400);
    const errs = {};
    if ([...name].length < 3) errs.name = 'Informe o nome da categoria.';
    if ([...desc].length < 10) errs.description = 'Descreva a categoria (mínimo de 10 caracteres).';
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    const existing = db.get('SELECT id,name,active FROM categories WHERE norm_name=?', normText(name));
    if (existing) fail('category_exists', `Já existe uma categoria equivalente: ${existing.name}.`, 409, { category: existing });
    if (db.get("SELECT 1 AS x FROM category_requests WHERE user_id=? AND status='pendente' AND lower(name)=lower(?)", user.id, name))
      fail('duplicate_request', 'Você já solicitou esta categoria e ela está em análise.', 409);
    const id = db.run('INSERT INTO category_requests(user_id,name,description,created_at) VALUES(?,?,?,?)', user.id, name, desc, nowIso()).lastInsertRowid;
    for (const a of db.all("SELECT id FROM users WHERE role='admin'")) notify(db, a.id, 'categoria', 'Nova solicitação de categoria', name, '#/admin/categorias');
    audit(ctx, 'categoria.solicitacao', 'category_request', id, { name });
    return ok({ message: 'Solicitação enviada para análise.', id }, 201);
  }));

  r.get('/category-requests', login((ctx) => ok({
    items: ctx.db.all('SELECT id,name,description,status,admin_note,created_at,resolved_at FROM category_requests WHERE user_id=? ORDER BY id DESC', ctx.user.id),
  })));

  // ---- administrador (UC23)
  r.get('/admin/categories', admin((ctx) => ok({
    items: ctx.db.all(`SELECT c.*, (SELECT COUNT(*) FROM services s WHERE s.category_id=c.id AND s.deleted_at IS NULL) AS services_count
                       FROM categories c ORDER BY c.active DESC, c.name`),
    requests: ctx.db.all(`SELECT cr.*, u.name AS user_name FROM category_requests cr JOIN users u ON u.id=cr.user_id
                          ORDER BY cr.status='pendente' DESC, cr.id DESC LIMIT 100`),
  })));

  r.post('/admin/categories', admin((ctx) => {
    const { db } = ctx;
    const errs = {};
    const { name, desc } = catPayload(ctx.body, errs);
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    if (db.get('SELECT 1 AS x FROM categories WHERE norm_name=?', normText(name))) fail('category_exists', 'Já existe uma categoria com este nome ou equivalente.', 409);
    const id = db.run('INSERT INTO categories(name,norm_name,description,created_at) VALUES(?,?,?,?)', name, normText(name), desc, nowIso()).lastInsertRowid;
    audit(ctx, 'categoria.criacao', 'category', id, { name });
    return ok({ message: 'Categoria cadastrada.', id }, 201);
  }));

  r.put('/admin/categories/:cid', admin((ctx) => {
    const { db } = ctx, d = ctx.body, cid = ctx.params.cid;
    const cat = db.get('SELECT * FROM categories WHERE id=?', cid);
    if (!cat) fail('not_found', 'Categoria não encontrada.', 404);
    const errs = {};
    const { name, desc } = catPayload({ name: pick(d, 'name', cat.name), description: pick(d, 'description', cat.description) }, errs);
    if (Object.keys(errs).length) fail('validation', 'Corrija os campos destacados.', 422, { fields: errs });
    if (db.get('SELECT 1 AS x FROM categories WHERE norm_name=? AND id!=?', normText(name), cid)) fail('category_exists', 'Já existe uma categoria com este nome ou equivalente.', 409);
    const active = !('active' in d) ? cat.active : (d.active ? 1 : 0);
    db.run('UPDATE categories SET name=?,norm_name=?,description=?,active=? WHERE id=?', name, normText(name), desc, active, cid);
    audit(ctx, 'categoria.alteracao', 'category', cid, { active });
    return ok({ message: 'Categoria atualizada.' });
  }));

  /** Exclui se não houver vínculos; do contrário apenas desativa (serviços existentes são preservados). */
  r.delete('/admin/categories/:cid', admin((ctx) => {
    const { db } = ctx, cid = ctx.params.cid;
    if (!db.get('SELECT * FROM categories WHERE id=?', cid)) fail('not_found', 'Categoria não encontrada.', 404);
    const used = db.val('SELECT (SELECT COUNT(*) FROM services WHERE category_id=?)+(SELECT COUNT(*) FROM worker_categories WHERE category_id=?)+(SELECT COUNT(*) FROM requests WHERE category_id=?)', cid, cid, cid);
    if (used) {
      db.run('UPDATE categories SET active=0 WHERE id=?', cid);
      audit(ctx, 'categoria.desativacao', 'category', cid);
      return ok({ message: 'A categoria está em uso e foi desativada (serviços existentes foram preservados).', deactivated: true });
    }
    db.run('UPDATE category_requests SET category_id=NULL WHERE category_id=?', cid);
    db.run('DELETE FROM categories WHERE id=?', cid);
    audit(ctx, 'categoria.exclusao', 'category', cid);
    return ok({ message: 'Categoria excluída.', deactivated: false });
  }));

  r.post('/admin/category-requests/:rid/resolve', admin((ctx) => {
    const { db } = ctx, d = ctx.body, rid = ctx.params.rid;
    const cr = db.get('SELECT * FROM category_requests WHERE id=?', rid);
    if (!cr) fail('not_found', 'Solicitação não encontrada.', 404);
    if (cr.status !== 'pendente') fail('already_resolved', 'Esta solicitação já foi analisada.', 409);
    const approve = !!d.approve;
    const note = cleanStr(d.note, 300);
    let catId = null;
    if (approve) {
      const ex = db.get('SELECT id FROM categories WHERE norm_name=?', normText(cr.name));
      catId = ex ? ex.id : db.run('INSERT INTO categories(name,norm_name,description,created_at) VALUES(?,?,?,?)', cr.name, normText(cr.name), cr.description, nowIso()).lastInsertRowid;
    }
    db.run('UPDATE category_requests SET status=?,admin_note=?,category_id=?,resolved_at=? WHERE id=?', approve ? 'aprovada' : 'rejeitada', note, catId, nowIso(), rid);
    notify(db, cr.user_id, 'categoria', approve ? 'Categoria aprovada' : 'Categoria não aprovada', cr.name + (note ? ` — ${note}` : ''), '#/servicos');
    audit(ctx, 'categoria.solicitacao_resolvida', 'category_request', rid, { approve });
    return ok({ message: approve ? 'Solicitação aprovada e categoria disponibilizada.' : 'Solicitação rejeitada.' });
  }));
}
