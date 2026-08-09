-- ============================================================
-- StockVIP Migration：商品内容更新 Email 通知
-- 建立日期：2026-08-09
-- 用途：管理员在后台编辑商品（课程／订阅／共享帐号）内容后，
--       可选择寄信通知目前持有该商品有效权限的所有会员。
-- 使用方式：Supabase Dashboard -> SQL Editor -> 贴上整份执行
-- 可安全重複执行（create or replace），不会破坏既有资料
-- ============================================================

create or replace function public.notify_product_content_updated(p_product_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_is_admin boolean;
  v_config record; v_product record; v_member record; v_resp extensions.http_response;
  SITE_URL text := 'https://tradewithus888.com';
  v_link text; v_subject text; v_html text; v_text text; v_preview text;
  v_sent int := 0; v_failed int := 0;
begin
  -- 权限检查：只有管理员能呼叫这个函式，避免一般会员偷呼叫乱寄信
  select (role = 'admin') into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception '没有管理员权限';
  end if;

  select * into v_config from public.telegram_sync_config where id = 1;
  if v_config.resend_api_key is null or v_config.resend_api_key = '' then
    return jsonb_build_object('status', 'not_configured');
  end if;

  select * into v_product from public.products where id = p_product_id;
  if v_product is null then return jsonb_build_object('status', 'product_not_found'); end if;

  -- 简单去掉 HTML 标签，取前 200 字当预览
  v_preview := left(regexp_replace(coalesce(v_product.body, ''), '<[^>]*>', ' ', 'g'), 200);
  v_link := SITE_URL || '/product/' || p_product_id;
  v_subject := '[StockVip][' || v_product.name || '] 內容已更新';
  v_html := format(
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto">' ||
    '<h2 style="color:#111">%s 內容已更新</h2>' ||
    '<p style="color:#555;white-space:pre-wrap">%s</p>' ||
    '<a href="%s" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#F2A93B;color:#14100a;text-decoration:none;border-radius:8px;font-weight:700">查看完整內容 →</a>' ||
    '<p style="color:#999;font-size:12px;margin-top:30px">你收到這封信是因為你持有「%s」的有效權限。</p>' ||
    '</div>',
    v_product.name, v_preview, v_link, v_product.name
  );
  v_text := v_product.name || ' 內容已更新' || E'\n\n' || v_preview || E'\n\n查看：' || v_link;

  for v_member in
    select p.email
    from public.permissions pm
    join public.profiles p on p.id = pm.member_id
    where pm.product_id = p_product_id
      and (pm.expires_at is null or pm.expires_at >= current_date)
  loop
    begin
      select * into v_resp from extensions.http((
        'POST', 'https://api.resend.com/emails',
        ARRAY[extensions.http_header('Authorization', 'Bearer ' || v_config.resend_api_key)],
        'application/json',
        jsonb_build_object(
          'from', coalesce(v_config.notify_from_name,'StockVIP') || ' <' || coalesce(v_config.notify_from_email,'onboarding@resend.dev') || '>',
          'to', jsonb_build_array(v_member.email), 'subject', v_subject, 'html', v_html, 'text', v_text
        )::text
      )::extensions.http_request);
      if v_resp.status between 200 and 299 then v_sent := v_sent + 1; else v_failed := v_failed + 1; end if;
    exception when others then v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('status', 'ok', 'sent', v_sent, 'failed', v_failed);
end;
$$;
