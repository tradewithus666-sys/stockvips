import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { uploadImage } from '../lib/storage';
import {
  fetchProducts, createProduct, updateProduct, deleteProduct, reorderProducts,
  fetchAllMembers, grantPermission, revokePermission,
  createArticle, updateArticle, deleteArticle,
} from '../lib/api';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';

const EMPTY_PRODUCT = { name: '', type: 'course', image: '', price: 0, price_quarter: '', price_year: '', description: '', body: '', stock: 100, status: 'active' };

export default function Admin() {
  const [tab, setTab] = useState('products');
  const { t } = useLang();
  return (
    <div>
      <div className="admin-header">
        <h2 className="display">{t('admin_title')}</h2>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          ['products', t('admin_tab_products')],
          ['articles', t('admin_tab_articles')],
          ['members', t('admin_tab_members')],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'products' && <ProductsTab />}
      {tab === 'articles' && <ArticlesTab />}
      {tab === 'members' && <MembersTab />}
    </div>
  );
}

/* ---------------- 商品管理（含拖曳排序） ---------------- */
function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | product object
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const showToast = useToast();
  const { t } = useLang();

  const reload = () => fetchProducts().then(setProducts).finally(() => setLoading(false));
  useEffect(() => { reload(); }, []);

  async function handleSave(form) {
    try {
      const { id, ...rest } = form;
      const payload = {
        ...rest,
        price: Number(form.price) || 0,
        price_quarter: form.price_quarter === '' || form.price_quarter == null ? null : Number(form.price_quarter),
        price_year: form.price_year === '' || form.price_year == null ? null : Number(form.price_year),
        stock: Number(form.stock) || 0,
      };
      if (id) {
        await updateProduct(id, payload);
      } else {
        await createProduct({ ...payload, sort_order: products.length });
      }
      setEditing(null);
      showToast(t('toast_saved'));
      reload();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(t('confirm_delete_product2'))) return;
    await deleteProduct(id);
    reload();
  }

  async function handleToggle(p) {
    await updateProduct(p.id, { status: p.status === 'off' ? 'active' : 'off' });
    reload();
  }

  async function onDrop(targetId) {
    if (!dragId || dragId === targetId) return;
    const items = [...products];
    const fromIdx = items.findIndex((p) => p.id === dragId);
    const toIdx = items.findIndex((p) => p.id === targetId);
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    setProducts(items);
    setDragId(null);
    try {
      await reorderProducts(items);
    } catch (err) {
      showToast(t('toast_sort_failed', err.message));
      reload();
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <div className="admin-header">
        <div />
        <button className="btn btn-amber" onClick={() => setEditing('new')}>{t('add_product_btn2')}</button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '-14px 0 18px' }}>
        {t('products_drag_hint')}
      </p>
      {editing && <ProductForm initial={editing === 'new' ? EMPTY_PRODUCT : editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      <table>
        <thead>
          <tr><th></th><th>{t('th_col_product')}</th><th>{t('th_col_type')}</th><th>{t('th_col_price')}</th><th>{t('th_col_stock_sold')}</th><th>{t('th_col_status')}</th><th>{t('th_col_actions')}</th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr
              key={p.id}
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p.id)}
            >
              <td className="drag-handle">⠿</td>
              <td>{p.name}</td>
              <td>{p.type}</td>
              <td className="mono">${p.price}</td>
              <td className="mono">{p.stock} / {p.sold}</td>
              <td><span className={`pill ${p.status === 'off' ? 'off' : ''}`}>{p.status === 'off' ? t('status_off') : t('status_active')}</span></td>
              <td className="row-actions">
                <div className="icon-btn" onClick={() => setEditing(p)}>✎</div>
                <div className="icon-btn" onClick={() => handleToggle(p)}>{p.status === 'off' ? '↑' : '↓'}</div>
                <div className="icon-btn" onClick={() => handleDelete(p.id)}>🗑</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!products.length && <div className="empty">{t('no_products_yet')}</div>}
    </div>
  );
}

function ProductForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [uploading, setUploading] = useState(false);
  const showToast = useToast();
  const { t } = useLang();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, 'covers');
      setForm({ ...form, image: url });
    } catch (err) {
      showToast(t('toast_upload_failed', err.message));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="form-panel">
      <div style={{ fontWeight: 700, marginBottom: 14 }}>{form.id ? t('admin_edit_product') : t('admin_add_product')}</div>
      <div className="form-grid">
        <div className="field"><label>{t('field_product_name2')}</label><input value={form.name} onChange={set('name')} /></div>
        <div className="field">
          <label>{t('field_product_type2')}</label>
          <select value={form.type} onChange={set('type')}>
            <option value="course">{t('type_option_course')}</option>
            <option value="subscription">{t('type_option_subscription')}</option>
            <option value="shared">{t('type_option_shared')}</option>
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_product_image_upload')}</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {form.image && <img src={form.image} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 10 }} />}
            <input type="file" accept="image/*" onChange={handleFile} />
          </div>
          {uploading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('uploading_label')}</div>}
        </div>
        <div className="field"><label>{t('field_price2')}</label><input type="number" value={form.price} onChange={set('price')} /></div>
        {form.type === 'subscription' && (
          <>
            <div className="field"><label>{t('field_price_quarter2')}</label><input type="number" value={form.price_quarter || ''} onChange={set('price_quarter')} /></div>
            <div className="field"><label>{t('field_price_year2')}</label><input type="number" value={form.price_year || ''} onChange={set('price_year')} /></div>
          </>
        )}
        <div className="field"><label>{t('field_stock2')}</label><input type="number" value={form.stock} onChange={set('stock')} /></div>
        <div className="field" style={{ gridColumn: '1/-1' }}><label>{t('field_desc_card2')}</label><input value={form.description || ''} onChange={set('description')} /></div>
        <div className="field" style={{ gridColumn: '1/-1' }}><label>{t('field_body_detail2')}</label><textarea value={form.body || ''} onChange={set('body')} /></div>
      </div>
      <div className="row-actions">
        <button className="btn btn-amber" onClick={() => onSave(form)}>{t('save_btn')}</button>
        <button className="btn btn-ghost" onClick={onCancel}>{t('cancel_btn')}</button>
      </div>
    </div>
  );
}

/* ---------------- 内容管理（文章：文字／图片区块编辑器，可拖曳/上下移动排序） ---------------- */
function ArticlesTab() {
  const [products, setProducts] = useState([]);
  const [articles, setArticles] = useState([]);
  const [editingId, setEditingId] = useState(null); // null | 'new' | article.id
  const [loading, setLoading] = useState(true);
  const showToast = useToast();
  const { t } = useLang();

  async function reload() {
    const [prods, { data: arts }] = await Promise.all([
      fetchProducts(),
      supabase.from('articles').select('*, products(name)').order('published_at', { ascending: false }),
    ]);
    setProducts(prods.filter((p) => p.type === 'subscription'));
    setArticles(arts || []);
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  async function handleDelete(id) {
    if (!confirm(t('confirm_delete_article2'))) return;
    await deleteArticle(id);
    reload();
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  const editingArticle = editingId && editingId !== 'new' ? articles.find((a) => a.id === editingId) : null;

  return (
    <div>
      <div className="admin-header">
        <div />
        {products.length > 0
          ? <button className="btn btn-amber" onClick={() => setEditingId('new')}>{t('publish_new_article_btn2')}</button>
          : <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{t('articles_need_channel_hint')}</span>}
      </div>
      {editingId && (
        <ArticleForm
          key={editingId}
          products={products}
          initial={editingArticle}
          onDone={() => { setEditingId(null); reload(); showToast(editingArticle ? t('toast_article_saved') : t('toast_article_published')); }}
          onCancel={() => setEditingId(null)}
        />
      )}
      <table>
        <thead><tr><th>{t('th_col_title')}</th><th>{t('th_col_product2')}</th><th>{t('th_col_publish_date')}</th><th>{t('th_col_actions')}</th></tr></thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.id}>
              <td>{a.title}</td>
              <td>{a.products?.name}</td>
              <td>{a.published_at}</td>
              <td className="row-actions">
                <div className="icon-btn" onClick={() => setEditingId(a.id)}>✎</div>
                <div className="icon-btn" onClick={() => handleDelete(a.id)}>🗑</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!articles.length && <div className="empty">{t('no_articles_yet2')}</div>}
    </div>
  );
}

function ArticleForm({ products, initial, onDone, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [productId, setProductId] = useState(initial?.product_id || products[0]?.id || '');
  const [summary, setSummary] = useState(initial?.summary || '');
  const [blocks, setBlocks] = useState(initial?.blocks?.length ? initial.blocks : [{ type: 'text', value: '' }]);
  const [dragIdx, setDragIdx] = useState(null);
  const [pasting, setPasting] = useState(false);
  const showToast = useToast();
  const { t } = useLang();

  function addTextBlock() { setBlocks([...blocks, { type: 'text', value: '' }]); }
  function addImageBlock() { setBlocks([...blocks, { type: 'image', value: '' }]); }
  function removeBlock(idx) { setBlocks(blocks.filter((_, i) => i !== idx)); }
  function moveBlock(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[j]] = [next[j], next[idx]];
    setBlocks(next);
  }
  function updateBlock(idx, value) {
    const next = [...blocks];
    next[idx] = { ...next[idx], value };
    setBlocks(next);
  }
  function onDrop(targetIdx) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...blocks];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setBlocks(next);
    setDragIdx(null);
  }

  async function handleImageFile(idx, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImage(file, 'articles');
      updateBlock(idx, url);
    } catch (err) {
      showToast(t('toast_upload_failed', err.message));
    }
  }

  // ---- 富文本贴上：整段图文一起贴上，依原始顺序自动拆成文字/图片区块 ----
  // 依据 DOM 结构走访，遇到 <img> 就切出一个图片区块，其余文字合并成段落区块；
  // 图片如果是外部网址就直接沿用，如果是剪贴簿内嵌的图片资料（截图、data URI）则先上传到 Storage 换成正式网址。
  function extractOrderedNodesFromHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'TR', 'SECTION', 'ARTICLE']);
    const raw = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent && node.textContent.trim()) raw.push({ type: 'text', value: node.textContent });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src');
        if (src) raw.push({ type: 'image', value: src });
        return;
      }
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      Array.from(node.childNodes).forEach(walk);
      if (BLOCK_TAGS.has(node.tagName)) raw.push({ type: 'break' });
    }
    Array.from(tmp.childNodes).forEach(walk);

    const ordered = [];
    let buf = '';
    raw.forEach((b) => {
      if (b.type === 'text') { buf += (buf ? ' ' : '') + b.value.trim(); }
      else if (b.type === 'break') { if (buf.trim()) { ordered.push({ type: 'text', value: buf.trim() }); buf = ''; } }
      else if (b.type === 'image') { if (buf.trim()) { ordered.push({ type: 'text', value: buf.trim() }); buf = ''; } ordered.push(b); }
    });
    if (buf.trim()) ordered.push({ type: 'text', value: buf.trim() });
    return ordered;
  }

  async function dataUrlToFile(dataUrl, filename) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  async function handlePaste(e) {
    e.preventDefault();
    const cd = e.clipboardData;
    if (!cd) return;
    setPasting(true);
    try {
      const html = cd.getData('text/html');
      let newBlocks = [];
      let imgCount = 0;

      if (html) {
        const nodes = extractOrderedNodesFromHtml(html);
        for (const n of nodes) {
          if (n.type === 'text') { newBlocks.push({ type: 'text', value: n.value }); continue; }
          // 图片区块：外部网址直接沿用；data URI（例如从 Word/图片编辑器贴上的内嵌图）则先上传换成正式网址
          if (n.value.startsWith('data:')) {
            try {
              const file = await dataUrlToFile(n.value, `pasted_${Date.now()}_${imgCount}.png`);
              const url = await uploadImage(file, 'articles');
              newBlocks.push({ type: 'image', value: url });
              imgCount++;
            } catch (err) {
              showToast(t('toast_upload_failed', err.message));
            }
          } else {
            newBlocks.push({ type: 'image', value: n.value });
            imgCount++;
          }
        }
      } else {
        const text = (cd.getData('text/plain') || '').trim();
        if (text) newBlocks.push({ type: 'text', value: text });
        const items = Array.from(cd.items || []).filter((i) => i.type && i.type.startsWith('image/'));
        for (const item of items) {
          const file = item.getAsFile();
          if (!file) continue;
          try {
            const url = await uploadImage(file, 'articles');
            newBlocks.push({ type: 'image', value: url });
            imgCount++;
          } catch (err) {
            showToast(t('toast_upload_failed', err.message));
          }
        }
      }

      if (newBlocks.length) {
        // 如果目前只有一个空白段落，直接用贴上的内容取代；否则接在既有内容后面
        setBlocks((prev) => {
          const base = prev.length === 1 && prev[0].type === 'text' && !prev[0].value.trim() ? [] : prev;
          return [...base, ...newBlocks];
        });
        showToast(t('toast_paste_extracted', imgCount));
      } else {
        showToast(t('toast_paste_empty'));
      }
    } finally {
      setPasting(false);
      e.target.innerHTML = '';
    }
  }

  async function handleSave() {
    if (!title || !productId) { showToast(t('toast_fill_title_and_product')); return; }
    const cleanBlocks = blocks.map((b) => ({ type: b.type, value: (b.value || '').trim() })).filter((b) => b.value);
    try {
      if (initial) {
        await updateArticle(initial.id, { title, product_id: productId, summary, blocks: cleanBlocks });
      } else {
        await createArticle({ title, product_id: productId, summary, blocks: cleanBlocks });
      }
      onDone();
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <div className="form-panel">
      <div style={{ fontWeight: 700, marginBottom: 14 }}>{initial ? t('edit_article_title2') : t('publish_article_title2')}</div>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_paste_zone_label2')}</label>
          <div
            className="paste-zone"
            contentEditable
            suppressContentEditableWarning
            data-placeholder={pasting ? t('paste_zone_processing') : t('paste_zone_placeholder2')}
            onPaste={handlePaste}
          />
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_article_title2')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('field_article_product2')}</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_summary2')}</label>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>{t('field_content_blocks_label')}</label>
      </div>
      {blocks.length === 0 && <div className="empty">{t('no_blocks_yet2')}</div>}
      {blocks.map((b, idx) => (
        <div
          key={idx}
          className="block-item"
          draggable
          onDragStart={() => setDragIdx(idx)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(idx)}
        >
          <div className="block-controls">
            <button disabled={idx === 0} onClick={() => moveBlock(idx, -1)} title="↑">↑</button>
            <button disabled={idx === blocks.length - 1} onClick={() => moveBlock(idx, 1)} title="↓">↓</button>
            <button onClick={() => removeBlock(idx)} title={t('delete_title')}>🗑</button>
          </div>
          {b.type === 'image' ? (
            <div className="img-row" style={{ flex: 1 }}>
              {b.value ? <img src={b.value} alt="" /> : <div className="badge-icon" style={{ width: 48, height: 48, fontSize: 18 }}>🖼</div>}
              <div className="upload-col">
                <div className="file-input-wrap"><input type="file" accept="image/*" onChange={(e) => handleImageFile(idx, e)} /></div>
                <div className="upload-hint">{t('img_row_upload_hint')}</div>
              </div>
            </div>
          ) : (
            <textarea value={b.value} onChange={(e) => updateBlock(idx, e.target.value)} placeholder={t('field_body_text_placeholder')} />
          )}
        </div>
      ))}
      <div className="row-actions" style={{ marginBottom: 18 }}>
        <button className="btn btn-ghost btn-sm" onClick={addTextBlock}>{t('add_text_block_btn2')}</button>
        <button className="btn btn-ghost btn-sm" onClick={addImageBlock}>{t('add_image_block_btn2')}</button>
      </div>

      <div className="row-actions">
        <button className="btn btn-amber" onClick={handleSave}>{initial ? t('save_changes_btn2') : t('publish_and_notify_btn2')}</button>
        <button className="btn btn-ghost" onClick={onCancel}>{t('cancel_btn')}</button>
      </div>
    </div>
  );
}

/* ---------------- 会员与权限 ---------------- */
function MembersTab() {
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [grantFor, setGrantFor] = useState(null);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();
  const { t } = useLang();

  async function reload() {
    const [m, p] = await Promise.all([fetchAllMembers(), fetchProducts()]);
    setMembers(m);
    setProducts(p);
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  const filtered = search ? members.filter((m) => m.email.includes(search)) : members;

  async function handleGrant(memberId, productId, days) {
    await grantPermission({ memberId, productId, days: days ? Number(days) : null });
    setGrantFor(null);
    showToast(t('toast_permission_granted'));
    reload();
  }

  async function handleRevoke(memberId, productId) {
    if (!confirm(t('confirm_revoke2'))) return;
    await revokePermission({ memberId, productId });
    reload();
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <div className="stat-row">
        <div className="stat-box"><b>{members.length}</b><span>{t('members_total')}</span></div>
        <div className="stat-box"><b>{members.filter((m) => m.permissions?.length).length}</b><span>{t('members_with_access')}</span></div>
      </div>
      <div className="field" style={{ marginBottom: 18 }}>
        <input placeholder={t('search_member_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {filtered.map((m) => (
        <div className="member-card" key={m.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{m.email}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('member_meta', Number(m.balance).toFixed(2), m.created_at?.slice(0, 10))}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setGrantFor(grantFor === m.id ? null : m.id)}>{t('grant_permission_btn2')}</button>
          </div>
          <div className="chip-list">
            {(m.permissions || []).length ? m.permissions.map((pm) => (
              <div className="chip valid" key={pm.id}>
                {pm.products?.name} · {pm.expires_at ?? t('permanent_valid')}
                <span style={{ cursor: 'pointer' }} onClick={() => handleRevoke(m.id, pm.product_id)}>✕</span>
              </div>
            )) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
          </div>
          {grantFor === m.id && <GrantForm products={products} onGrant={(pid, days) => handleGrant(m.id, pid, days)} />}
        </div>
      ))}
    </div>
  );
}

function GrantForm({ products, onGrant }) {
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [days, setDays] = useState('');
  const { t } = useLang();
  return (
    <div style={{ marginTop: 14 }}>
      <div className="form-grid">
        <div className="field">
          <label>{t('field_grant_product2')}</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field"><label>{t('field_grant_days2')}</label><input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" /></div>
      </div>
      <button className="btn btn-amber" onClick={() => onGrant(productId, days)}>{t('confirm_grant_btn2')}</button>
    </div>
  );
}
