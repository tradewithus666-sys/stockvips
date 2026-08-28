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

/* ---------- 操作教学内容（管理员可自行编辑） ---------- */
export async function fetchHelpContent() {
  const { data, error } = await supabase.from('help_content').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateHelpContent(body) {
  const { data, error } = await supabase.from('help_content').update({ body, updated_at: new Date().toISOString() }).eq('id', 1).select().single();
  if (error) throw error;
  return data;
}

/* ---------- Telegram 频道同步（支援多个来源频道） ---------- */
export async function fetchTelegramSyncConfigs() {
  const { data, error } = await supabase.from('telegram_sync_configs').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTelegramSyncConfig(payload) {
  const { data, error } = await supabase.from('telegram_sync_configs').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateTelegramSyncConfig(id, payload) {
  const { data, error } = await supabase.from('telegram_sync_configs').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTelegramSyncConfig(id) {
  const { error } = await supabase.from('telegram_sync_configs').delete().eq('id', id);
  if (error) throw error;
}

export async function triggerTelegramSync() {
  const { data, error } = await supabase.rpc('admin_trigger_telegram_sync');
  if (error) throw error;
  return data;
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

  // 【本次新增】後台手動授予會籍，換算成「等同銷量」累加進商品的 sold 欄位，
  // 例如給 3 個月（約 90 天）就算銷量 +3，給 1 年（約 365 天）就算銷量 +12。
  // 不管是用「天數」還是「確切到期日」授予的，都統一換算成「距今天數」再除以 30、四捨五入；
  // 沒有到期日（永久）或天數是 0 這種情況，不計入銷量（沒有明確的「等同月數」可以換算）。
  let equivalentDays = null;
  if (days) {
    equivalentDays = Number(days);
  } else if (exactDate) {
    const diffMs = new Date(exactDate).getTime() - Date.now();
    equivalentDays = diffMs > 0 ? diffMs / 86400000 : 0;
  }
  if (equivalentDays && equivalentDays > 0) {
    const soldIncrement = Math.max(1, Math.round(equivalentDays / 30));
    try {
      await supabase.rpc('increment_product_sold', { p_product_id: productId, p_amount: soldIncrement });
    } catch {
      // 銷量計數失敗不該讓整個授予會籍動作失敗，靜默忽略即可
    }
  }

  return data;
}

// 后台手动开通权限后，寄信通知该会员（告诉他开通了哪个频道、时长多久）
export async function notifyPermissionGranted(memberId, productId, expiresAt) {
  const { data, error } = await supabase.rpc('notify_permission_granted', {
    p_member_id: memberId,
    p_product_id: productId,
    p_expires_at: expiresAt,
  });
  if (error) throw error;
  return data;
}

// 管理员编辑商品内容（例如共享帐号的详情）后，寄信通知目前持有有效权限的所有会员
export async function notifyProductContentUpdated(productId) {
  const { data, error } = await supabase.rpc('notify_product_content_updated', { p_product_id: productId });
  if (error) throw error;
  return data;
}

// 新商品发布时，广播给「全体会员」（不限于已订阅的人）
export async function notifyAllMembersNewProduct(productId) {
  const { data, error } = await supabase.rpc('notify_all_members_new_product', { p_product_id: productId });
  if (error) throw error;
  return data;
}

export async function notifyTelegramNewProduct(productId) {
  const { data, error } = await supabase.rpc('notify_telegram_new_product', { p_product_id: productId });
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

/* ---------- 文章更新 Email 通知（寄给已开启通知的订阅会员） ---------- */
export async function notifyArticleByEmail(productId, articleId, preview) {
  const { data, error } = await supabase.rpc('notify_subscribers_by_email', {
    p_product_id: productId,
    p_article_id: articleId,
    p_preview: preview ?? '',
    p_manual: true, // 人手在後台發布文章觸發的通知，標題用「📢 [頻道名稱][標題] 已发布」格式
  });
  if (error) throw error;
  return data;
}

export async function toggleEmailNotify({ productId, enabled }) {
  // 【本次修复】改成呼叫专门的函式（用登入者本人的 auth.uid()，不再靠前端传的 memberId），
  // 避免直接开放 permissions 表给前端做原始 UPDATE——之前如果 RLS 没开放会员更新自己那笔资料，
  // Supabase 会「安静地更新 0 笔、但不报错」，前端误以为成功，刷新后又打回原状。
  const { data, error } = await supabase.rpc('toggle_my_email_notify', {
    p_product_id: productId,
    p_enabled: enabled,
  });
  if (error) throw error;
  if (data?.status === 'not_found') throw new Error('找不到对应的权限记录');
  return data;
}

/* ---------- 文章已读标记 ---------- */
export async function fetchReadArticleIds(memberId) {
  const { data, error } = await supabase.from('article_reads').select('article_id').eq('member_id', memberId);
  if (error) throw error;
  return data.map((r) => r.article_id);
}

export async function markArticleRead(memberId, articleId) {
  const { error } = await supabase
    .from('article_reads')
    .upsert({ member_id: memberId, article_id: articleId, read_at: new Date().toISOString() }, { onConflict: 'member_id,article_id' });
  if (error) throw error;
}

/* ---------- 文章收藏 ---------- */
export async function fetchFavoriteArticleIds(memberId) {
  const { data, error } = await supabase.from('article_favorites').select('article_id').eq('member_id', memberId);
  if (error) throw error;
  return data.map((r) => r.article_id);
}

export async function toggleFavoriteArticle({ memberId, articleId, isFavorite }) {
  if (isFavorite) {
    const { error } = await supabase.from('article_favorites').insert({ member_id: memberId, article_id: articleId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('article_favorites').delete().eq('member_id', memberId).eq('article_id', articleId);
    if (error) throw error;
  }
}

export async function fetchMyFavoriteArticles(memberId) {
  const { data, error } = await supabase
    .from('article_favorites')
    .select('created_at, articles(*, products(name))')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((r) => r.articles).filter(Boolean);
}

/* ---------- 邀请连结（分享连结自动开通权限） ---------- */
export async function fetchInviteLinks() {
  const { data, error } = await supabase.from('invite_links').select('*, products(name)').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createInviteLink({ productId, days, maxUses, label }) {
  const code = crypto.randomUUID().slice(0, 8);
  const { data, error } = await supabase
    .from('invite_links')
    .insert({ code, product_id: productId, days: days || null, max_uses: maxUses || null, label })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function toggleInviteLink(id, enabled) {
  const { error } = await supabase.from('invite_links').update({ enabled }).eq('id', id);
  if (error) throw error;
}

// 这个是给未登入的访客也能看的（邀请连结落地页要显示「你将获得 XX 权限」），
// 呼叫的是走 security definer 的 RPC，不受一般 RLS 限制
export async function fetchInvitePublic(code) {
  const { data, error } = await supabase.rpc('fetch_invite_link_public', { p_code: code });
  if (error) throw error;
  return data;
}

export async function redeemInviteLink(code) {
  const { data, error } = await supabase.rpc('redeem_invite_link', { p_code: code });
  if (error) throw error;
  return data;
}

/* ---------- 会员 Telegram 绑定 ---------- */
export async function generateTelegramBindToken() {
  const { data, error } = await supabase.rpc('generate_telegram_bind_token');
  if (error) throw error;
  return data;
}

export async function fetchMyTelegramBinding() {
  const { data, error } = await supabase.rpc('fetch_my_telegram_binding');
  if (error) throw error;
  return data;
}

export async function unbindTelegramAccount() {
  const { data, error } = await supabase.rpc('unbind_telegram_account');
  if (error) throw error;
  return data;
}

export async function adminBindTelegramAccount({ memberId, telegramUserId, telegramUsername }) {
  const { data, error } = await supabase.rpc('admin_bind_telegram_account', {
    p_member_id: memberId,
    p_telegram_user_id: telegramUserId,
    p_telegram_username: telegramUsername || null,
  });
  if (error) throw error;
  return data;
}

export async function generateChannelInviteLink(productId) {
  const { data, error } = await supabase.rpc('generate_channel_invite_link', { p_product_id: productId });
  if (error) throw error;
  return data;
}

export async function fetchProductsWithTelegramChannel() {
  const { data, error } = await supabase.rpc('fetch_products_with_telegram_channel');
  if (error) throw error;
  return data || [];
}

/* ---------- 一键新增/删除 Telegram 频道 ---------- */
export async function registerTelegramChannel({ label, botToken, sourceChatId, targetProductId, targetCategoryId }) {
  const { data, error } = await supabase.rpc('register_telegram_channel', {
    p_label: label,
    p_bot_token: botToken,
    p_source_chat_id: sourceChatId,
    p_target_product_id: targetProductId,
    p_target_category_id: targetCategoryId || null,
  });
  if (error) throw error;
  return data;
}

export async function deregisterTelegramChannel(configId) {
  const { data, error } = await supabase.rpc('deregister_telegram_channel', { p_config_id: configId });
  if (error) throw error;
  return data;
}

/* ---------- 後台數據圖表 ---------- */
export async function fetchStatsDailySignups(days = 30) {
  const { data, error } = await supabase.rpc('admin_stats_daily_signups', { p_days: days });
  if (error) throw error;
  return data;
}

export async function fetchStatsCumulativeMembers(days = 30) {
  const { data, error } = await supabase.rpc('admin_stats_cumulative_members', { p_days: days });
  if (error) throw error;
  return data;
}

export async function fetchStatsDau(days = 30) {
  const { data, error } = await supabase.rpc('admin_stats_dau', { p_days: days });
  if (error) throw error;
  return data;
}

export async function fetchStatsArticleEngagement(limit = 20) {
  const { data, error } = await supabase.rpc('admin_stats_article_engagement', { p_limit: limit });
  if (error) throw error;
  return data;
}

export async function fetchStatsProductSubscribers() {
  const { data, error } = await supabase.rpc('admin_stats_product_subscribers');
  if (error) throw error;
  return data;
}

export async function fetchStatsExpiringSoon() {
  const { data, error } = await supabase.rpc('admin_stats_expiring_soon');
  if (error) throw error;
  return data;
}

export async function fetchLoginLogs(memberId, limit = 30) {
  const { data, error } = await supabase.rpc('admin_fetch_login_logs', { p_member_id: memberId, p_limit: limit });
  if (error) throw error;
  return data;
}