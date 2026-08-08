import { supabase } from '../supabaseClient';

/* ---------- 商品 ---------- */
export async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchProductById(id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createProduct(payload) {
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, payload) {
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// 拖曳排序：一次传入 [{id, sort_order}, ...] 批次更新
export async function reorderProducts(items) {
  const updates = items.map((item, idx) =>
    supabase.from('products').update({ sort_order: idx }).eq('id', item.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

/* ---------- 文章 ---------- */
export async function fetchArticlesByProduct(productId) {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('product_id', productId)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createArticle(payload) {
  const { data, error } = await supabase.from('articles').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateArticle(id, payload) {
  const { data, error } = await supabase.from('articles').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteArticle(id) {
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) throw error;
}

export async function notifyTelegramArticle(articleId) {
  const { data, error } = await supabase.rpc('notify_telegram_article', { p_article_id: articleId });
  if (error) throw error;
  return data;
}

/* ---------- 文章分类 ---------- */
export async function fetchCategoriesByProduct(productId) {
  const { data, error } = await supabase
    .from('article_categories')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCategory({ productId, name }) {
  const { data, error } = await supabase
    .from('article_categories')
    .insert({ product_id: productId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('article_categories').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- 会员中心公告 ---------- */
export async function fetchActiveAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchAllAnnouncements() {
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createAnnouncement(content) {
  const { data, error } = await supabase.from('announcements').insert({ content }).select().single();
  if (error) throw error;
  return data;
}

export async function updateAnnouncement(id, payload) {
  const { data, error } = await supabase.from('announcements').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- 会员权限／购买 ---------- */
export async function fetchMyPermissions(memberId) {
  const { data, error } = await supabase
    .from('permissions')
    .select('*, products(*)')
    .eq('member_id', memberId);
  if (error) throw error;
  return data;
}

export async function fetchMyPurchases(memberId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*, products(*)')
    .eq('member_id', memberId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data;
}

// 用余额购买／续费：呼叫 Postgres function 做「扣款 + 开通权限」的原子操作，
// 避免像原本前端直接改 balance 那样，在并发情况下扣款跟开通对不上。
export async function purchaseWithBalance({ productId, duration, price, variant }) {
  const { data, error } = await supabase.rpc('purchase_with_balance', {
    p_product_id: productId,
    p_duration: duration,
    p_price: price,
    p_variant: variant || null,
  });
  if (error) throw error;
  return data;
}

/* ---------- 管理员操作 ---------- */
export async function fetchAllMembers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, permissions(*, products(*))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function grantPermission({ memberId, productId, days, exactDate }) {
  const expiresAt = exactDate ? exactDate : (days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null);
  const { data, error } = await supabase
    .from('permissions')
    .upsert({ member_id: memberId, product_id: productId, expires_at: expiresAt }, { onConflict: 'member_id,product_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokePermission({ memberId, productId }) {
  const { error } = await supabase
    .from('permissions')
    .delete()
    .eq('member_id', memberId)
    .eq('product_id', productId);
  if (error) throw error;
}

export async function adjustMemberBalance({ memberId, amount }) {
  const { data, error } = await supabase.rpc('admin_adjust_balance', {
    p_member_id: memberId,
    p_amount: amount,
  });
  if (error) throw error;
  return data;
}

export async function createPaymentIntent({ productId, duration, amount, address }) {
  const { data, error } = await supabase.rpc('create_payment_intent', {
    p_product_id: productId,
    p_duration: duration,
    p_amount: amount,
    p_address: address,
  });
  if (error) throw error;
  return data;
}

export async function createRechargeIntent({ amount, address, creditAmount }) {
  const { data, error } = await supabase.rpc('create_recharge_intent', {
    p_amount: amount,
    p_address: address,
    p_credit_amount: creditAmount || null,
  });
  if (error) throw error;
  return data;
}

export async function checkPaymentIntent(intentId) {
  const { data, error } = await supabase.rpc('check_and_complete_usdt_payment', { p_intent_id: intentId });
  if (error) throw error;
  return data;
}

export async function verifyUsdtTx(intentId, txHash) {
  const { data, error } = await supabase.rpc('verify_usdt_tx', { p_intent_id: intentId, p_tx_hash: txHash });
  if (error) throw error;
  return data;
}

export async function fetchPaymentIntent(intentId) {
  const { data, error } = await supabase.from('payment_intents').select('*, products(name)').eq('id', intentId).single();
  if (error) throw error;
  return data;
}
