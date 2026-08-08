-- ============================================================
-- Telegram 频道消息自动转发成会员频道文章：
-- 用轮询 Telegram Bot API 的 getUpdates 方法（长轮询取新消息），
-- Bot 必须是来源频道的「管理员」才能收到频道贴文（channel_post）。
-- ============================================================

create table if not exists public.telegram_sync_config (
  id int primary key default 1,
  bot_token text,
  source_chat_id text,
  target_product_id uuid references public.products(id) on delete set null,
  target_category_id uuid references public.article_categories(id) on delete set null,
  last_update_id bigint,
  enabled boolean not null default false,
  constraint telegram_sync_config_singleton check (id = 1)
);
insert into public.telegram_sync_config (id) values (1) on conflict (id) do nothing;

alter table public.telegram_sync_config enable row level security;
drop policy if exists "telegram config admin only" on public.telegram_sync_config;
create policy "telegram config admin only" on public.telegram_sync_config for all using (public.is_admin());

create or replace function public.sync_telegram_messages()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_config record;
  v_resp extensions.http_response;
  v_updates jsonb;
  v_update jsonb;
  v_post jsonb;
  v_photos jsonb;
  v_best_photo jsonb;
  v_file_resp extensions.http_response;
  v_file_path text;
  v_content text;
  v_title text;
  v_blocks jsonb;
  v_newest_update_id bigint;
  v_count int := 0;
begin
  select * into v_config from public.telegram_sync_config where id = 1;
  if v_config is null or not v_config.enabled or v_config.bot_token is null
     or v_config.source_chat_id is null or v_config.target_product_id is null then
    return jsonb_build_object('status', 'not_configured');
  end if;

  select * into v_resp from extensions.http_get(
    format(
      'https://api.telegram.org/bot%s/getUpdates?timeout=0&allowed_updates=%s%s',
      v_config.bot_token,
      '["channel_post"]',
      case when v_config.last_update_id is not null then '&offset=' || (v_config.last_update_id + 1) else '' end
    )
  );

  v_updates := (v_resp.content::jsonb)->'result';
  if v_updates is null or jsonb_typeof(v_updates) != 'array' then
    return jsonb_build_object('status', 'telegram_error', 'detail', v_resp.content::jsonb);
  end if;

  for v_update in select * from jsonb_array_elements(v_updates) order by (value->>'update_id')::bigint asc
  loop
    v_newest_update_id := (v_update->>'update_id')::bigint;
    v_post := v_update->'channel_post';
    if v_post is null then continue; end if;

    if (v_post->'chat'->>'id') is distinct from v_config.source_chat_id then continue; end if;

    v_content := coalesce(v_post->>'text', v_post->>'caption', '');
    v_photos := v_post->'photo';

    if v_content = '' and v_photos is null then continue; end if;

    v_title := left(coalesce(nullif(v_content, ''), 'Telegram 更新'), 40);
    v_blocks := '[]'::jsonb;
    if v_content != '' then
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('type', 'text', 'value', v_content));
    end if;

    if v_photos is not null and jsonb_typeof(v_photos) = 'array' and jsonb_array_length(v_photos) > 0 then
      v_best_photo := v_photos->(jsonb_array_length(v_photos) - 1);
      select * into v_file_resp from extensions.http_get(
        format('https://api.telegram.org/bot%s/getFile?file_id=%s', v_config.bot_token, v_best_photo->>'file_id')
      );
      v_file_path := ((v_file_resp.content::jsonb)->'result'->>'file_path');
      if v_file_path is not null then
        v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
          'type', 'image',
          'value', format('https://api.telegram.org/file/bot%s/%s', v_config.bot_token, v_file_path)
        ));
      end if;
    end if;

    insert into public.articles (product_id, category_id, title, summary, blocks)
    values (v_config.target_product_id, v_config.target_category_id, v_title, '', v_blocks);

    v_count := v_count + 1;
  end loop;

  if v_newest_update_id is not null then
    update public.telegram_sync_config set last_update_id = v_newest_update_id where id = 1;
  end if;

  return jsonb_build_object('status', 'ok', 'synced', v_count);
end;
$$;

create or replace function public.admin_trigger_telegram_sync()
returns jsonb
language plpgsql
security definer
as $$
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;
  return public.sync_telegram_messages();
end;
$$;

revoke execute on function public.sync_telegram_messages() from public, anon, authenticated;

-- 给免费外部排程服务（cron-job.org）用的密钥端点，做法跟 Discord 那份一致
-- 把 'change-this-to-your-own-secret-2' 换成你自己的密钥（建议跟 Discord 那组不同）
create or replace function public.cron_sync_telegram_messages(p_secret text)
returns jsonb
language plpgsql
security definer
as $$
declare
  SYNC_SECRET text := 'Sv2026TelegramSync!k7';
begin
  if p_secret is null or p_secret != SYNC_SECRET then
    raise exception '密钥不正确';
  end if;
  return public.sync_telegram_messages();
end;
$$;
grant execute on function public.cron_sync_telegram_messages(text) to anon;
