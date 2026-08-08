-- 把 BOT_TOKEN 换成你在 @BotFather 申请的 Bot Token
-- 把 CHAT_ID 换成你的 Telegram 群组 chat_id（下方步骤有教怎么拿）
create or replace function public.notify_telegram_article(p_article_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_article record;
  v_product record;
  v_resp extensions.http_response;
  BOT_TOKEN text := '8532446508:AAEZbwCjkFScYyTdGYt5MI0xnUgFJvsA2Hc';
  CHAT_ID text := '-1004440631437';
  SITE_URL text := 'https://stockvip.netlify.app';
  v_text text;
  v_link text;
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;

  select * into v_article from public.articles where id = p_article_id;
  if v_article is null then return jsonb_build_object('ok', false, 'error', 'article_not_found'); end if;
  select * into v_product from public.products where id = v_article.product_id;

  v_link := SITE_URL || '/article/' || v_article.id;
  v_text := format(
    '📢 <a href="%s">[%s] [%s] 已发布</a>',
    v_link,
    replace(replace(replace(coalesce(v_product.name, '未知频道'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    replace(replace(replace(v_article.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
  );

  select * into v_resp from extensions.http_post(
    format('https://api.telegram.org/bot%s/sendMessage', BOT_TOKEN),
    jsonb_build_object('chat_id', CHAT_ID, 'text', v_text, 'parse_mode', 'HTML')::text,
    'application/json'
  );

  return jsonb_build_object('ok', true, 'status', v_resp.status);
end;
$$;