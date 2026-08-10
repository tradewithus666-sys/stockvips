import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { uploadImage } from '../lib/storage';
import {
  fetchProducts, createProduct, updateProduct, deleteProduct, reorderProducts,
  fetchAllMembers, grantPermission, revokePermission, adjustMemberBalance, notifyPermissionGranted, notifyProductContentUpdated,
  createArticle, updateArticle, deleteArticle, notifyTelegramArticle, notifyArticleByEmail,
  fetchCategoriesByProduct, createCategory, deleteCategory,
  fetchAllAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  fetchHelpContent, updateHelpContent,
  fetchDiscordConfig, updateDiscordConfig, triggerDiscordSync,
  fetchTelegramSyncConfig, updateTelegramSyncConfig, triggerTelegramSync,
} from '../lib/api';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt, usdtToHkd, USDT_TO_HKD_RATE } from '../lib/format';
import RichTextEditor from '../components/RichTextEditor';

const EMPTY_PRODUCT = { name: '', type: 'course', image: '', price: 0, price_quarter: '', price_year: '', description: '', body: '', base_sold: 0, status: 'active' };

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
          ['articles', t('admin_tab_articles')],
          ['products', t('admin_tab_products')],
          ['members', t('admin_tab_members')],
          ['announcements', t('admin_tab_announcements')],
          ['help', t('admin_tab_help')],
          ['discord', t('admin_tab_discord')],
          ['telegramsync', t('admin_tab_telegramsync')],
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
      {tab === 'announcements' && <AnnouncementsTab />}
      {tab === 'help' && <HelpTab />}
      {tab === 'discord' && <DiscordTab />}
      {tab === 'telegramsync' && <TelegramSyncTab />}
    </div>
  );
}

function AnnouncementsTab() {
  const [list, setList] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const showToast = useToast();
  const { t } = useLang();

  async function reload() {
    const data = await fetchAllAnnouncements();
    setList(data);
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  async function handleAdd() {
    if (!content.trim()) return;
    await createAnnouncement(content.trim());
    setContent('');
    showToast(t('toast_announcement_added'));
    reload();
  }

  async function toggleActive(a) {
    await updateAnnouncement(a.id, { active: !a.active });
    reload();
  }

  async function handleDelete(id) {
    if (!confirm(t('confirm_delete_announcement'))) return;
    await deleteAnnouncement(id);
    reload();
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <div className="form-panel">
        <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 8 }}>{t('announcement_new_label')}</label>
        <textarea style={{ minHeight: 90 }} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('announcement_placeholder')} />
        <button className="btn btn-amber" style={{ marginTop: 10 }} onClick={handleAdd}>{t('announcement_publish_btn')}</button>
      </div>
      {list.map((a) => (
        <div className="member-card" key={a.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', flex: 1 }}>{a.content}</div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(a)}>{a.active ? t('announcement_hide_btn') : t('announcement_show_btn')}</button>
              <div className="icon-btn" onClick={() => handleDelete(a.id)}>🗑</div>
            </div>
          </div>
          <span className={`pill ${a.active ? '' : 'off'}`} style={{ marginTop: 8, display: 'inline-block' }}>{a.active ? t('status_active') : t('status_off')}</span>
        </div>
      ))}
      {!list.length && <div className="empty">{t('no_announcements_yet')}</div>}
    </div>
  );
}

/* ---------------- 操作教学内容管理 ---------------- */
function HelpTab() {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const { t } = useLang();

  useEffect(() => {
    fetchHelpContent().then((data) => { setBody(data?.body || ''); setLoading(false); });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateHelpContent(body);
      showToast(t('toast_help_saved'));
    } catch (err) {
      showToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('confirm_reset_help'))) return;
    setBody('');
    setSaving(true);
    try {
      await updateHelpContent('');
      showToast(t('toast_help_reset'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 16 }}>{t('help_edit_hint')}</p>
      <div className="form-panel">
        <RichTextEditor value={body} onChange={setBody} />
        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-amber" disabled={saving} onClick={handleSave}>{saving ? t('processing') : t('save_btn')}</button>
          <button className="btn btn-ghost" disabled={saving} onClick={handleReset}>{t('reset_to_default_btn')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Discord 频道同步 ---------------- */
function DiscordTab() {
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const showToast = useToast();
  const { t } = useLang();

  async function reload() {
    const [cfg, prods] = await Promise.all([fetchDiscordConfig(), fetchProducts()]);
    setConfig(cfg);
    setProducts(prods.filter((p) => p.type === 'subscription'));
    if (cfg?.target_product_id) {
      const cats = await fetchCategoriesByProduct(cfg.target_product_id);
      setCategories(cats);
    }
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  async function handleProductChange(productId) {
    setConfig({ ...config, target_product_id: productId, target_category_id: null });
    const cats = productId ? await fetchCategoriesByProduct(productId) : [];
    setCategories(cats);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateDiscordConfig({
        bot_token: config.bot_token || null,
        channel_id: config.channel_id || null,
        target_product_id: config.target_product_id || null,
        target_category_id: config.target_category_id || null,
        enabled: !!config.enabled,
      });
      showToast(t('toast_discord_saved'));
    } catch (err) {
      showToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await triggerDiscordSync();
      if (result.status === 'ok') showToast(t('toast_discord_synced', result.synced));
      else if (result.status === 'not_configured') showToast(t('toast_discord_not_configured'));
      else showToast(t('toast_discord_sync_failed'));
      reload();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 16 }}>{t('discord_hint')}</p>
      <div className="form-panel">
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>{t('discord_bot_token')}</label>
            <input type="password" value={config.bot_token || ''} onChange={(e) => setConfig({ ...config, bot_token: e.target.value })} placeholder="Bot Token" />
          </div>
          <div className="field">
            <label>{t('discord_channel_id')}</label>
            <input value={config.channel_id || ''} onChange={(e) => setConfig({ ...config, channel_id: e.target.value })} placeholder="123456789012345678" />
          </div>
          <div className="field">
            <label>{t('discord_target_channel')}</label>
            <select value={config.target_product_id || ''} onChange={(e) => handleProductChange(e.target.value)}>
              <option value="">{t('category_none')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {config.target_product_id && (
            <div className="field">
              <label>{t('discord_target_category')}</label>
              <select value={config.target_category_id || ''} onChange={(e) => setConfig({ ...config, target_category_id: e.target.value })}>
                <option value="">{t('category_none')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <label className="tg-sync-checkbox">
          <input type="checkbox" checked={!!config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          {t('discord_enable_checkbox')}
        </label>
        <div className="row-actions">
          <button className="btn btn-amber" disabled={saving} onClick={handleSave}>{saving ? t('processing') : t('save_btn')}</button>
          <button className="btn btn-ghost" disabled={syncing} onClick={handleSyncNow}>{syncing ? t('processing') : t('discord_sync_now_btn')}</button>
        </div>
        {config.last_message_id && <div className="upload-hint" style={{ marginTop: 10 }}>{t('discord_last_synced')}: {config.last_message_id}</div>}
      </div>
    </div>
  );
}

/* ---------------- Telegram 频道同步 ---------------- */
function TelegramSyncTab() {
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const showToast = useToast();
  const { t } = useLang();

  async function reload() {
    const [cfg, prods] = await Promise.all([fetchTelegramSyncConfig(), fetchProducts()]);
    setConfig(cfg);
    setProducts(prods.filter((p) => p.type === 'subscription'));
    if (cfg?.target_product_id) {
      const cats = await fetchCategoriesByProduct(cfg.target_product_id);
      setCategories(cats);
    }
    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  async function handleProductChange(productId) {
    setConfig({ ...config, target_product_id: productId, target_category_id: null });
    const cats = productId ? await fetchCategoriesByProduct(productId) : [];
    setCategories(cats);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateTelegramSyncConfig({
        bot_token: config.bot_token || null,
        source_chat_id: config.source_chat_id || null,
        target_product_id: config.target_product_id || null,
        target_category_id: config.target_category_id || null,
        enabled: !!config.enabled,
      });
      showToast(t('toast_discord_saved'));
    } catch (err) {
      showToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await triggerTelegramSync();
      if (result.status === 'ok') showToast(t('toast_discord_synced', result.synced));
      else if (result.status === 'not_configured') showToast(t('toast_discord_not_configured'));
      else showToast(t('toast_discord_sync_failed'));
      reload();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 16 }}>{t('telegramsync_hint')}</p>
      <div className="form-panel">
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>{t('discord_bot_token')} (Telegram)</label>
            <input type="password" value={config.bot_token || ''} onChange={(e) => setConfig({ ...config, bot_token: e.target.value })} placeholder="123456:ABC-DEF..." />
          </div>
          <div className="field">
            <label>{t('telegramsync_source_chat')}</label>
            <input value={config.source_chat_id || ''} onChange={(e) => setConfig({ ...config, source_chat_id: e.target.value })} placeholder="-1001234567890" />
          </div>
          <div className="field">
            <label>{t('discord_target_channel')}</label>
            <select value={config.target_product_id || ''} onChange={(e) => handleProductChange(e.target.value)}>
              <option value="">{t('category_none')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {config.target_product_id && (
            <div className="field">
              <label>{t('discord_target_category')}</label>
              <select value={config.target_category_id || ''} onChange={(e) => setConfig({ ...config, target_category_id: e.target.value })}>
                <option value="">{t('category_none')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <label className="tg-sync-checkbox">
          <input type="checkbox" checked={!!config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          {t('discord_enable_checkbox')}
        </label>
        <div className="row-actions">
          <button className="btn btn-amber" disabled={saving} onClick={handleSave}>{saving ? t('processing') : t('save_btn')}</button>
          <button className="btn btn-ghost" disabled={syncing} onClick={handleSyncNow}>{syncing ? t('processing') : t('discord_sync_now_btn')}</button>
        </div>
        {config.last_update_id && <div className="upload-hint" style={{ marginTop: 10 }}>{t('discord_last_synced')}: {config.last_update_id}</div>}
      </div>
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
      const { id, _notifyOnSave, ...rest } = form;
      const payload = {
        ...rest,
        price: Number(form.price) || 0,
        price_quarter: form.price_quarter === '' || form.price_quarter == null ? null : Number(form.price_quarter),
        price_year: form.price_year === '' || form.price_year == null ? null : Number(form.price_year),
        base_sold: Number(form.base_sold) || 0,
      };
      if (id) {
        await updateProduct(id, payload);
        if (_notifyOnSave) {
          try { await notifyProductContentUpdated(id); } catch (err) { showToast(t('toast_content_notify_failed', err.message)); }
        }
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

  async function onDrop(type, targetId) {
    if (!dragId || dragId === targetId) return;
    const subset = products.filter((p) => p.type === type);
    if (!subset.some((p) => p.id === dragId)) return; // 只允许同类型内拖曳排序
    const fromIdx = subset.findIndex((p) => p.id === dragId);
    const toIdx = subset.findIndex((p) => p.id === targetId);
    const [moved] = subset.splice(fromIdx, 1);
    subset.splice(toIdx, 0, moved);
    setProducts((prev) => {
      const others = prev.filter((p) => p.type !== type);
      return [...others, ...subset].sort((a, b) => prev.indexOf(a) - prev.indexOf(b));
    });
    setDragId(null);
    try {
      await reorderProducts(subset);
    } catch (err) {
      showToast(t('toast_sort_failed', err.message));
      reload();
    }
  }

  // 手机／触控装置不支援原生 HTML5 拖曳（draggable + ondragstart 只有滑鼠才有效），
  // 所以另外补上「上移／下移」按钮，任何装置都能用来调整顺序。同类型内移动。
  async function moveProduct(type, index, dir) {
    const subset = products.filter((p) => p.type === type);
    const target = index + dir;
    if (target < 0 || target >= subset.length) return;
    [subset[index], subset[target]] = [subset[target], subset[index]];
    reload();
    try {
      await reorderProducts(subset);
      reload();
    } catch (err) {
      showToast(t('toast_sort_failed', err.message));
      reload();
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  const TYPE_GROUPS = [
    ['course', t('type_course')],
    ['subscription', t('type_subscription')],
    ['shared', t('type_shared')],
  ];

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

      {TYPE_GROUPS.map(([type, label]) => {
        const subset = products.filter((p) => p.type === type);
        return (
          <div key={type} className="channel-group">
            <div className="channel-group-head">
              <span>{type === 'course' ? '🎓' : type === 'subscription' ? '📡' : '🔑'} {label}</span>
              <span className="tag">{subset.length}</span>
            </div>

            {/* 桌面版：表格 */}
            <div className="table-scroll desktop-only"><table>
              <thead>
                <tr><th></th><th>{t('th_col_product')}</th><th>{t('th_col_price')}</th><th>{t('th_col_sold')}</th><th>{t('th_col_status')}</th><th>{t('th_col_actions')}</th></tr>
              </thead>
              <tbody>
                {subset.map((p, idx) => (
                  <tr
                    key={p.id}
                    draggable
                    onDragStart={() => setDragId(p.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(type, p.id)}
                  >
                    <td className="drag-handle-cell">
                      <span className="drag-handle">⠿</span>
                      <div className="reorder-btns">
                        <button type="button" disabled={idx === 0} onClick={() => moveProduct(type, idx, -1)}>▲</button>
                        <button type="button" disabled={idx === subset.length - 1} onClick={() => moveProduct(type, idx, 1)}>▼</button>
                      </div>
                    </td>
                    <td>{p.name}</td>
                    <td className="mono">${p.price} HKD</td>
                    <td className="mono">{(p.base_sold ?? 0) + (p.sold ?? 0)}</td>
                    <td><span className={`pill ${p.status === 'off' ? 'off' : ''}`}>{p.status === 'off' ? t('status_off') : t('status_active')}</span></td>
                    <td className="row-actions">
                      <div className="icon-btn" onClick={() => setEditing(p)}>✎</div>
                      <div className="icon-btn" onClick={() => handleToggle(p)}>{p.status === 'off' ? '↑' : '↓'}</div>
                      <div className="icon-btn" onClick={() => handleDelete(p.id)}>🗑</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            {/* 手机版：卡片式排版，避免表格在窄屏被挤压、操作图示太密集容易误触 */}
            <div className="mobile-only">
              {subset.map((p, idx) => (
                <div className="product-mcard" key={p.id}>
                  <div className="product-mcard-top">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>${p.price} HKD · {t('th_col_sold')} {(p.base_sold ?? 0) + (p.sold ?? 0)}</div>
                    </div>
                    <span className={`pill ${p.status === 'off' ? 'off' : ''}`}>{p.status === 'off' ? t('status_off') : t('status_active')}</span>
                  </div>
                  <div className="product-mcard-actions">
                    <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => moveProduct(type, idx, -1)}>▲ {t('move_up')}</button>
                    <button className="btn btn-ghost btn-sm" disabled={idx === subset.length - 1} onClick={() => moveProduct(type, idx, 1)}>▼ {t('move_down')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>✎ {t('edit_btn')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(p)}>{p.status === 'off' ? `↑ ${t('status_active')}` : `↓ ${t('status_off')}`}</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>🗑 {t('delete_title')}</button>
                  </div>
                </div>
              ))}
            </div>

            {!subset.length && <div className="empty" style={{ padding: 18 }}>{t('no_products_yet')}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ProductForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    ...initial,
    images: initial.images && initial.images.length ? initial.images : (initial.image ? [initial.image] : []),
    options: initial.options && initial.options.length ? initial.options : [],
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [uploading, setUploading] = useState(false);
  const [notifyOnSave, setNotifyOnSave] = useState(false); // 只有编辑既有商品时才有意义，预设不勾避免小改动就骚扰会员
  const showToast = useToast();
  const { t } = useLang();

  function addOption() {
    setForm({ ...form, options: [...form.options, { name: '', price: 0 }] });
  }
  function updateOption(idx, field, value) {
    const next = [...form.options];
    next[idx] = { ...next[idx], [field]: value };
    setForm({ ...form, options: next });
  }
  function removeOption(idx) {
    setForm({ ...form, options: form.options.filter((_, i) => i !== idx) });
  }

  async function handleFile(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const room = 5 - form.images.length;
    if (room <= 0) { showToast(t('max_images_hint')); return; }
    setUploading(true);
    try {
      const urls = [];
      for (const file of files.slice(0, room)) {
        const url = await uploadImage(file, 'covers');
        urls.push(url);
      }
      setForm({ ...form, images: [...form.images, ...urls] });
    } catch (err) {
      showToast(t('toast_upload_failed', err.message));
    } finally {
      setUploading(false);
    }
  }

  function removeImage(idx) {
    setForm({ ...form, images: form.images.filter((_, i) => i !== idx) });
  }

  function saveWithImages() {
    const cleanOptions = form.type === 'course'
      ? form.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), price: Number(o.price) || 0, body: o.body || '' }))
      : [];
    onSave({ ...form, images: form.images, image: form.images[0] || '', options: cleanOptions, _notifyOnSave: notifyOnSave });
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
          <label>{t('field_product_image_upload')} ({form.images.length}/5)</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {form.images.map((url, idx) => (
              <div key={idx} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 10 }} />
                <div className="icon-btn" style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, fontSize: 11 }} onClick={() => removeImage(idx)}>✕</div>
              </div>
            ))}
          </div>
          {form.images.length < 5 && <input type="file" accept="image/*" multiple onChange={handleFile} />}
          {uploading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('uploading_label')}</div>}
        </div>
        <div className="field">
          <label>{form.type === 'subscription' ? t('field_price_month2') : t('field_price2')}</label>
          <input type="number" value={form.price} onChange={set('price')} />
        </div>
        <div className="field">
          <label>{t('field_price_hkd_input')}</label>
          <input type="number" placeholder={t('hkd_input_placeholder')} onChange={(e) => setForm({ ...form, price: e.target.value ? (Number(e.target.value) / USDT_TO_HKD_RATE).toFixed(2) : form.price })} />
          <div className="upload-hint">{t('hkd_auto_hint')} · {t('hkd_equiv_now')} {usdtToHkd(form.price)} HKD</div>
        </div>
        {form.type === 'subscription' && (
          <>
            <div className="field">
              <label>{t('field_price_quarter2')}</label>
              <input type="number" value={form.price_quarter || ''} onChange={set('price_quarter')} />
            </div>
            <div className="field">
              <label>{t('field_price_hkd_input')}（{t('dur_quarter')}）</label>
              <input type="number" placeholder={t('hkd_input_placeholder')} onChange={(e) => setForm({ ...form, price_quarter: e.target.value ? (Number(e.target.value) / USDT_TO_HKD_RATE).toFixed(2) : form.price_quarter })} />
              <div className="upload-hint">{t('hkd_equiv_now')} {usdtToHkd(form.price_quarter || 0)} HKD</div>
            </div>
            <div className="field">
              <label>{t('field_price_year2')}</label>
              <input type="number" value={form.price_year || ''} onChange={set('price_year')} />
            </div>
            <div className="field">
              <label>{t('field_price_hkd_input')}（{t('dur_year')}）</label>
              <input type="number" placeholder={t('hkd_input_placeholder')} onChange={(e) => setForm({ ...form, price_year: e.target.value ? (Number(e.target.value) / USDT_TO_HKD_RATE).toFixed(2) : form.price_year })} />
              <div className="upload-hint">{t('hkd_equiv_now')} {usdtToHkd(form.price_year || 0)} HKD</div>
            </div>
          </>
        )}
        {form.type === 'course' && (
          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>{t('field_course_options')}</label>
            {form.options.map((opt, idx) => (
              <div key={idx} className="course-option-block">
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ flex: 2 }} placeholder={t('option_name_placeholder')} value={opt.name} onChange={(e) => updateOption(idx, 'name', e.target.value)} />
                  <input style={{ flex: 1 }} type="number" placeholder={t('field_price2')} value={opt.price} onChange={(e) => updateOption(idx, 'price', e.target.value)} />
                  <input style={{ flex: 1 }} type="number" placeholder={t('hkd_input_placeholder')} onChange={(e) => updateOption(idx, 'price', e.target.value ? (Number(e.target.value) / USDT_TO_HKD_RATE).toFixed(2) : opt.price)} />
                  <div className="icon-btn" onClick={() => removeOption(idx)}>✕</div>
                </div>
                <div className="upload-hint" style={{ marginTop: -4, marginBottom: 8 }}>{t('hkd_equiv_now')} {usdtToHkd(opt.price || 0)} HKD</div>
                <label style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>{t('option_body_label')}</label>
                <RichTextEditor value={opt.body || ''} onChange={(html) => updateOption(idx, 'body', html)} />
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addOption}>{t('add_option_btn')}</button>
            <div className="upload-hint" style={{ marginTop: 6 }}>{t('course_options_hint')}</div>
          </div>
        )}
        {(form.type !== 'course' || form.options.length === 0) && (
        <div className="field"><label>{t('field_sold_label2')}</label><input type="number" value={form.base_sold ?? 0} onChange={set('base_sold')} placeholder="0" /></div>
        )}
        <div className="field" style={{ gridColumn: '1/-1' }}><label>{t('field_desc_card2')}</label><input value={form.description || ''} onChange={set('description')} /></div>
        {(form.type !== 'course' || form.options.length === 0) && (
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_body_detail2')}</label>
          <RichTextEditor value={form.body || ''} onChange={(html) => setForm({ ...form, body: html })} />
        </div>
        )}
      </div>
      {form.id && (
        <label className="tg-sync-checkbox">
          <input type="checkbox" checked={notifyOnSave} onChange={(e) => setNotifyOnSave(e.target.checked)} />
          {t('notify_on_content_update_checkbox')}
        </label>
      )}
      <div className="row-actions">
        <button className="btn btn-amber" onClick={saveWithImages}>{t('save_btn')}</button>
        <button className="btn btn-ghost" onClick={onCancel}>{t('cancel_btn')}</button>
      </div>
    </div>
  );
}

/* ---------------- 内容管理（文章：文字／图片区块编辑器，可拖曳/上下移动排序） ---------------- */
function ArticlesTab() {
  const [products, setProducts] = useState([]);
  const [articles, setArticles] = useState([]);
  const [subscriberCounts, setSubscriberCounts] = useState({}); // { product_id: 有效订阅人数 }
  const [loading, setLoading] = useState(true);
  const [selectedChannelId, setSelectedChannelId] = useState(null); // null = 目录页
  const { t } = useLang();

  async function reload() {
    const [prods, { data: arts }] = await Promise.all([
      fetchProducts(),
      supabase.from('articles').select('*, products(name)').order('published_at', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    const subs = prods.filter((p) => p.type === 'subscription');
    setProducts(subs);
    setArticles(arts || []);

    // 查每个频道目前「有效权限」（未过期）的会员数，右边显示用
    if (subs.length) {
      const { data: perms } = await supabase
        .from('permissions')
        .select('product_id, expires_at')
        .in('product_id', subs.map((p) => p.id));
      const today = new Date().toISOString().slice(0, 10);
      const counts = {};
      (perms || []).forEach((pm) => {
        if (pm.expires_at && pm.expires_at < today) return; // 已过期不算
        counts[pm.product_id] = (counts[pm.product_id] || 0) + 1;
      });
      setSubscriberCounts(counts);
    }

    setLoading(false);
  }
  useEffect(() => { reload(); }, []);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  const orphanArticles = articles.filter((a) => !products.some((p) => p.id === a.product_id));
  const selectedProduct = products.find((p) => p.id === selectedChannelId);

  if (selectedChannelId) {
    return (
      <ChannelDetail
        product={selectedProduct}
        articles={articles.filter((a) => a.product_id === selectedChannelId)}
        products={products}
        onBack={() => setSelectedChannelId(null)}
        onChanged={reload}
      />
    );
  }

  return (
    <div>
      <div className="admin-header">
        <div />
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{t('channel_directory_hint')}</span>
      </div>

      <div className="channel-card-grid">
        {products.map((p) => {
          const count = articles.filter((a) => a.product_id === p.id).length;
          return (
            <div className="channel-card" key={p.id} onClick={() => setSelectedChannelId(p.id)}>
              {p.image
                ? <img src={p.image} alt="" className="channel-card-img" />
                : <div className="channel-card-img badge-icon" style={{ fontSize: 26 }}>📡</div>}
              <div className="channel-card-body">
                <div className="channel-card-title">{p.name}</div>
                <div className="channel-card-count">{t('count_articles', count)}</div>
              </div>
              <div className="channel-card-subs" title="已訂閱人數（未過期）">👥 {subscriberCounts[p.id] || 0}</div>
              <div className="channel-card-arrow">→</div>
            </div>
          );
        })}
      </div>
      {!products.length && <div className="empty">{t('articles_need_channel_hint')}</div>}

      {orphanArticles.length > 0 && (
        <div className="channel-group" style={{ marginTop: 30 }}>
          <div className="channel-group-head"><span>⚠️ {t('th_col_product2')}</span></div>
          <div className="table-scroll"><table>
            <thead><tr><th>{t('th_col_title')}</th><th>{t('th_col_publish_date')}</th></tr></thead>
            <tbody>
              {orphanArticles.map((a) => (
                <tr key={a.id}><td>{a.title}</td><td>{formatPublishedAt(a)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// 单一频道管理页：进入后只看到该频道自己的文章，未来可以在这里加频道公告、封面编辑、自动发布排程等功能而不影响目录页
function ChannelDetail({ product, articles, products, onBack, onChanged }) {
  const [editingId, setEditingId] = useState(null); // null | 'new' | article.id
  const [categories, setCategories] = useState([]);
  const [newCatName, setNewCatName] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const showToast = useToast();
  const { t } = useLang();

  async function loadCategories() {
    const list = await fetchCategoriesByProduct(product.id);
    setCategories(list);
    setLoadingCats(false);
  }
  useEffect(() => { loadCategories(); }, [product.id]);

  async function handleDelete(id) {
    if (!confirm(t('confirm_delete_article2'))) return;
    await deleteArticle(id);
    onChanged();
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    await createCategory({ productId: product.id, name: newCatName.trim() });
    setNewCatName('');
    loadCategories();
  }

  async function handleDeleteCategory(id) {
    if (!confirm(t('confirm_delete_category'))) return;
    await deleteCategory(id);
    loadCategories();
  }

  const editingArticle = editingId && editingId !== 'new' ? articles.find((a) => a.id === editingId) : null;
  const catName = (id) => categories.find((c) => c.id === id)?.name || t('category_none');

  return (
    <div>
      <button className="btn btn-ghost" style={{ marginBottom: 18 }} onClick={onBack}>← {t('back_to_channels')}</button>

      <div className="channel-detail-head">
        {product.image
          ? <img src={product.image} alt="" className="channel-detail-img" />
          : <div className="channel-detail-img badge-icon" style={{ fontSize: 30 }}>📡</div>}
        <div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{product.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('count_articles', articles.length)}</div>
        </div>
      </div>

      <div className="form-panel">
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t('category_manage_title')}</div>
        <div className="chip-list" style={{ marginBottom: 10 }}>
          {categories.map((c) => (
            <div className="chip valid" key={c.id}>
              {c.name}
              <span style={{ cursor: 'pointer' }} onClick={() => handleDeleteCategory(c.id)}>✕</span>
            </div>
          ))}
          {!loadingCats && !categories.length && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('no_categories_yet')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ maxWidth: 220 }} placeholder={t('category_name_placeholder')} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }} />
          <button className="btn btn-ghost btn-sm" onClick={handleAddCategory}>{t('add_category_btn')}</button>
        </div>
      </div>

      <div className="admin-header">
        <div />
        <button className="btn btn-amber" onClick={() => setEditingId('new')}>{t('publish_new_article_btn2')}</button>
      </div>

      {editingId && (
        <ArticleForm
          key={editingId}
          products={products}
          categories={categories}
          initial={editingArticle}
          fixedProductId={product.id}
          onDone={() => { setEditingId(null); onChanged(); showToast(editingArticle ? t('toast_article_saved') : t('toast_article_published')); }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {articles.length ? (
        <div className="table-scroll"><table>
          <thead><tr><th>{t('th_col_title')}</th><th>{t('category_col')}</th><th>{t('th_col_publish_date')}</th><th>{t('th_col_actions')}</th></tr></thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>{catName(a.category_id)}</td>
                <td>{formatPublishedAt(a)}</td>
                <td className="row-actions">
                  <div className="icon-btn" onClick={() => setEditingId(a.id)}>✎</div>
                  <div className="icon-btn" onClick={() => handleDelete(a.id)}>🗑</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <div className="empty">{t('no_articles_yet2')}</div>
      )}
    </div>
  );
}

function ArticleForm({ products, categories = [], initial, onDone, onCancel, fixedProductId }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [productId, setProductId] = useState(initial?.product_id || fixedProductId || products[0]?.id || '');
  const [categoryId, setCategoryId] = useState(initial?.category_id || '');
  const [localCategories, setLocalCategories] = useState(categories);
  const [newCatName, setNewCatName] = useState('');
  const [blocks, setBlocks] = useState(initial?.blocks?.length ? initial.blocks : [{ type: 'text', value: '' }]);
  const [dragIdx, setDragIdx] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [syncTelegram, setSyncTelegram] = useState(!initial); // 新增文章预设打勾，编辑既有文章预设不勾（避免改错字就重复发通知）
  const [emailNotify, setEmailNotify] = useState(!initial); // 同上，新文章预设打勾，编辑预设不勾
  const showToast = useToast();
  const { t } = useLang();

  async function handleQuickAddCategory() {
    if (!newCatName.trim() || !productId) return;
    const created = await createCategory({ productId, name: newCatName.trim() });
    setLocalCategories([...localCategories, created]);
    setCategoryId(created.id);
    setNewCatName('');
  }

  function addTextBlock() { setBlocks([...blocks, { type: 'text', value: '' }]); }
  function addImageBlock() { setBlocks([...blocks, { type: 'image', value: '' }]); }
  function addPdfBlock() { setBlocks([...blocks, { type: 'pdf', value: '' }]); }
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

  async function handlePdfFile(idx, e) {
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
      let saved;
      if (initial) {
        saved = await updateArticle(initial.id, { title, product_id: productId, category_id: categoryId || null, blocks: cleanBlocks });
      } else {
        saved = await createArticle({ title, product_id: productId, category_id: categoryId || null, blocks: cleanBlocks });
      }
      if (syncTelegram) {
        try { await notifyTelegramArticle(saved.id); } catch (err) { showToast(t('toast_telegram_notify_failed', err.message)); }
      }
      if (emailNotify) {
        const preview = cleanBlocks.filter((b) => b.type === 'text').slice(0, 2).map((b) => b.value).join('\n') || title;
        try { await notifyArticleByEmail(productId, saved.id, preview); } catch (err) { showToast(t('toast_email_notify_failed', err.message)); }
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
        {!fixedProductId && (
          <div className="field">
            <label>{t('field_article_product2')}</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>{t('field_article_category')}</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('category_none')}</option>
            {localCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input placeholder={t('category_name_placeholder')} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddCategory(); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleQuickAddCategory}>{t('add_category_btn')}</button>
          </div>
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
          ) : b.type === 'pdf' ? (
            <div className="img-row" style={{ flex: 1 }}>
              {b.value ? <div className="badge-icon" style={{ width: 48, height: 48, fontSize: 18 }}>📄</div> : <div className="badge-icon" style={{ width: 48, height: 48, fontSize: 18 }}>📄</div>}
              <div className="upload-col">
                <div className="file-input-wrap"><input type="file" accept="application/pdf" onChange={(e) => handlePdfFile(idx, e)} /></div>
                <div className="upload-hint">{b.value ? b.value.split('/').pop() : t('pdf_row_upload_hint')}</div>
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
        <button className="btn btn-ghost btn-sm" onClick={addPdfBlock}>{t('add_pdf_block_btn2')}</button>
      </div>

      <label className="tg-sync-checkbox">
        <input type="checkbox" checked={syncTelegram} onChange={(e) => setSyncTelegram(e.target.checked)} />
        {t('sync_telegram_checkbox')}
      </label>

      <label className="tg-sync-checkbox">
        <input type="checkbox" checked={emailNotify} onChange={(e) => setEmailNotify(e.target.checked)} />
        {t('email_notify_checkbox')}
      </label>

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
  const [balanceFor, setBalanceFor] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [txFor, setTxFor] = useState(null);
  const [txList, setTxList] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
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

  const filtered = search ? members.filter((m) => m.email.toLowerCase().includes(search.toLowerCase())) : members;

  async function handleGrant(memberId, productIds, days, exactDate) {
    // 【本次修改】productIds 现在是阵列，逐一开通每个选中的商品，各自寄一封通知信
    const ids = Array.isArray(productIds) ? productIds : [productIds];
    let successCount = 0;
    for (const pid of ids) {
      try {
        const granted = await grantPermission({ memberId, productId: pid, days: days ? Number(days) : null, exactDate: exactDate || null });
        successCount++;
        try {
          await notifyPermissionGranted(memberId, pid, granted?.expires_at ?? null);
        } catch (err) {
          showToast(t('toast_grant_email_failed', err.message));
        }
      } catch (err) {
        showToast(err.message);
      }
    }
    setGrantFor(null);
    if (successCount > 0) showToast(t('toast_permission_granted'));
    reload();
  }

  async function handleRevoke(memberId, productId) {
    if (!confirm(t('confirm_revoke2'))) return;
    await revokePermission({ memberId, productId });
    reload();
  }

  async function handleAdjustBalance(memberId) {
    const amount = Number(balanceAmount);
    if (!amount) return;
    await adjustMemberBalance({ memberId, amount });
    setBalanceFor(null);
    setBalanceAmount('');
    showToast(t('toast_balance_adjusted'));
    reload();
  }

  async function toggleTxHistory(memberId) {
    if (txFor === memberId) { setTxFor(null); return; }
    setTxFor(memberId);
    setTxLoading(true);
    const { data } = await supabase
      .from('wallet_tx')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });
    setTxList(data || []);
    setTxLoading(false);
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
            <button className="btn btn-ghost btn-sm" onClick={() => setBalanceFor(balanceFor === m.id ? null : m.id)}>{t('adjust_balance_btn')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => toggleTxHistory(m.id)}>{t('tx_history_btn')}</button>
          </div>
          <div className="chip-list">
            {(m.permissions || []).length ? m.permissions.map((pm) => (
              <div className="chip valid" key={pm.id}>
                {pm.products?.name} · {pm.expires_at ?? t('permanent_valid')}
                <span style={{ cursor: 'pointer' }} onClick={() => handleRevoke(m.id, pm.product_id)}>✕</span>
              </div>
            )) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
          </div>
          {grantFor === m.id && <GrantForm products={products} onGrant={(pids, days, exactDate) => handleGrant(m.id, pids, days, exactDate)} />}
          {balanceFor === m.id && (
            <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="number" style={{ maxWidth: 160 }} value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} placeholder="100 / -50" />
              <button className="btn btn-amber btn-sm" onClick={() => handleAdjustBalance(m.id)}>{t('confirm_adjust_btn')}</button>
            </div>
          )}
          {txFor === m.id && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              {txLoading ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('loading')}</div>
              ) : txList.length ? txList.map((tx) => (
                <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>+{tx.amount} USDT</span>
                  <span style={{ color: 'var(--muted)' }}>{new Date(tx.created_at).toLocaleString()}</span>
                  <span className="pill">{tx.status}</span>
                </div>
              )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('no_tx_yet')}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GrantForm({ products, onGrant }) {
  const [productIds, setProductIds] = useState([]); // 【本次修改】改成阵列，支援一次选多个商品
  const [days, setDays] = useState('');
  const [exactDate, setExactDate] = useState('');
  const { t } = useLang();

  function toggleProduct(id) {
    setProductIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function parseExactDate(str) {
    // 接受 261220 这种 YYMMDD 格式（6 位数），转成 2026-12-20
    const m = /^(\d{2})(\d{2})(\d{2})$/.exec(str.trim());
    if (!m) return null;
    return `20${m[1]}-${m[2]}-${m[3]}`;
  }

  function handleSubmit() {
    if (!productIds.length) { alert(t('please_select_at_least_one_product')); return; }
    if (exactDate.trim()) {
      const parsed = parseExactDate(exactDate);
      if (!parsed) { alert(t('exact_date_format_error')); return; }
      onGrant(productIds, null, parsed);
    } else {
      onGrant(productIds, days, null);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_grant_product2')}</label>
          <div className="chip-list">
            {products.map((p) => (
              <div
                key={p.id}
                className={`chip ${productIds.includes(p.id) ? 'valid' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => toggleProduct(p.id)}
              >
                {productIds.includes(p.id) ? '✓ ' : ''}{p.name}
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('field_grant_days2')}</label>
          <input type="number" value={days} onChange={(e) => { setDays(e.target.value); setExactDate(''); }} placeholder="30" />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {[30, 90, 365].map((d) => (
              <button key={d} type="button" className={`quick-day-btn ${String(d) === days ? 'active' : ''}`} onClick={() => { setDays(String(d)); setExactDate(''); }}>{d}{t('days_unit')}</button>
            ))}
          </div>
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>{t('field_exact_date')}</label>
          <input value={exactDate} onChange={(e) => { setExactDate(e.target.value); setDays(''); }} placeholder="261220" maxLength={6} />
          <div className="upload-hint">{t('exact_date_hint')}</div>
        </div>
      </div>
      <button className="btn btn-amber" onClick={handleSubmit}>{t('confirm_grant_btn2')}</button>
    </div>
  );
}
