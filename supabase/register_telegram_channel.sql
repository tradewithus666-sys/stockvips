-- ============================================================
-- 一键新增/删除 Telegram 频道：把「新增资料库设定」+「注册 webhook」
-- 这两个步骤包成一个函式，後台按一次就自动做完，不用再手动组网址、贴 SQL。
-- ============================================================

-- 把这个换成你 Netlify 环境变数 TELEGRAM_WEBHOOK_SECRET 实际的值，两边要一致
create or replace function public.register_telegram_channel(
  p_label text,
  p_bot_token text,
  p_source_chat_id text,
  p_target_product_id uuid,
  p_target_category_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_config_id uuid;
  v_webhook_url text;
  v_resp extensions.http_response;
  v_body jsonb;
  WEBHOOK_SECRET text := 'Nf2026WebhookX9secure';
  SITE_URL text := 'https://tradewithus888.com';
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;

  insert into public.telegram_sync_configs (label, bot_token, source_chat_id, target_product_id, target_category_id, enabled)
  values (p_label, p_bot_token, p_source_chat_id, p_target_product_id, p_target_category_id, true)
  returning id into v_config_id;

  v_webhook_url := SITE_URL || '/.netlify/functions/telegram-webhook/' || v_config_id::text;

  select * into v_resp from extensions.http_get(
    format(
      'https://api.telegram.org/bot%s/setWebhook?url=%s&secret_token=%s&allowed_updates=%s',
      p_bot_token,
      v_webhook_url,
      WEBHOOK_SECRET,
      extensions.urlencode('["message","channel_post","edited_channel_post","edited_message"]')
    )
  );
  v_body := v_resp.content::jsonb;

  if not (v_body->>'ok')::boolean then
    -- webhook 注册失败的话，把刚新增的资料库设定也一并撤销，避免留下一笔半成品资料
    delete from public.telegram_sync_configs where id = v_config_id;
    return jsonb_build_object('status', 'webhook_failed', 'detail', v_body);
  end if;

  return jsonb_build_object('status', 'ok', 'config_id', v_config_id);
end;
$$;

-- 一键删除：先解除 webhook 注册，再删掉资料库设定
create or replace function public.deregister_telegram_channel(p_config_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_config record;
  v_resp extensions.http_response;
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;

  select * into v_config from public.telegram_sync_configs where id = p_config_id;
  if v_config is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_config.bot_token is not null then
    begin
      select * into v_resp from extensions.http_get(
        format('https://api.telegram.org/bot%s/deleteWebhook', v_config.bot_token)
      );
    exception when others then
      -- 就算解除 webhook 失败（例如 Bot Token 已经失效），也不要卡住，照样把资料库设定删掉
      null;
    end;
  end if;

  delete from public.telegram_sync_configs where id = p_config_id;

  return jsonb_build_object('status', 'ok');
end;
$$;
