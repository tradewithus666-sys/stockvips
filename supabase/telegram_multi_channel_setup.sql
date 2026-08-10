-- ============================================================
-- StockVIP Migration：Telegram 多频道同步（各自独立 Bot）
-- 建立日期：2026-08-09
-- 用途：支援多个 Telegram 来源频道，各自转发到不同的网站频道文章，
--       并各自推播「已发布」通知到各自指定的 Telegram 通知群组。
-- 使用方式：整份贴到 Supabase SQL Editor 一次执行完
-- 可安全重複执行（create or replace / if not exists）
-- ============================================================

-- ---------- 1. 多频道配置表 ----------
-- 每一行代表一条「Telegram 来源频道 -> 网站商品/频道」的转发线路，
-- 因为 Telegram getUpdates 的进度是跟着 Bot 走的，所以每条线路请用独立的 Bot，
-- 不要多条线路共用同一个 Bot，不然进度会互相冲掉、导致漏消息。
create table if not exists public.telegram_channel_configs (
  id uuid primary key default gen_random_uuid(),
  label text,                          -- 方便你自己辨识，例如「频道A」
  enabled boolean not null default true,
  bot_token text not null,             -- 这条线路专属的 Bot Token
  source_chat_id text not null,        -- 从哪个 Telegram 频道读取内容（负数）
  target_product_id uuid not null references public.products(id) on delete cascade,
  target_category_id uuid,
  notify_target_chat_id text,          -- 更新要推播去哪个 Telegram 群组（负数；留空 = 不推播）
  last_update_id bigint,
  current_article_id uuid,
  current_article_date date
);

alter table public.telegram_channel_configs enable row level security;

drop policy if exists "telegram configs admin only" on public.telegram_channel_configs;
create policy "telegram configs admin only" on public.telegram_channel_configs
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 把你原本 telegram_sync_config 里设定好的那一组，搬进新表当作第一笔（如果 telegram_sync_config 存在的话）
-- 注意：旧表 telegram_sync_config 没有 notify_target_chat_id 这个栏位，这里先不搬，之后自己另外 update 补上
insert into public.telegram_channel_configs
  (label, enabled, bot_token, source_chat_id, target_product_id, target_category_id, last_update_id, current_article_id, current_article_date)
select
  '既有频道', enabled, bot_token, source_chat_id, target_product_id, target_category_id, last_update_id, current_article_id, current_article_date
from public.telegram_sync_config where id = 1
on conflict do nothing;

-- ---------- 2. 同步单一频道的核心函式 ----------
create or replace function public.sync_one_telegram_channel(p_config_id uuid)
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
  v_content_block jsonb;
  v_time_header jsonb;
  v_current_article_id uuid;
  v_current_article_date date;
  v_msg_time text;
  v_last_time text;
  v_divider jsonb := jsonb_build_array(jsonb_build_object('type', 'text', 'value', '──────────────────'));
  v_article_exists boolean;
  v_hk_date date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_notify_queue jsonb := '[]'::jsonb;
  v_product record;
  v_link text;
  v_notify_text text;
  v_notify_resp extensions.http_response;
  SITE_URL text := 'https://tradewithus888.com';
  i int;
begin
  select * into v_config from public.telegram_channel_configs where id = p_config_id;
  if v_config is null or not v_config.enabled then
    return jsonb_build_object('status', 'not_configured', 'config_id', p_config_id);
  end if;

  v_current_article_id := v_config.current_article_id;
  v_current_article_date := v_config.current_article_date;

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
    return jsonb_build_object('status', 'telegram_error', 'config_id', p_config_id, 'detail', v_resp.content::jsonb);
  end if;

  select * into v_product from public.products where id = v_config.target_product_id;

  for v_update in select * from jsonb_array_elements(v_updates) order by (value->>'update_id')::bigint asc
  loop
    v_newest_update_id := (v_update->>'update_id')::bigint;
    begin
      v_post := v_update->'channel_post';
      if v_post is null then continue; end if;
      if (v_post->'chat'->>'id') is distinct from v_config.source_chat_id then continue; end if;

      v_content := coalesce(v_post->>'text', v_post->>'caption', '');
      v_photos := v_post->'photo';
      if v_content = '' and v_photos is null then continue; end if;

      v_msg_time := to_char(to_timestamp((v_post->>'date')::bigint) at time zone 'Asia/Hong_Kong', 'HH24:MI');
      v_time_header := jsonb_build_object('type', 'text', 'value', '🕐 ' || v_msg_time);

      v_content_block := '[]'::jsonb;
      if v_content != '' then
        v_content_block := v_content_block || jsonb_build_array(jsonb_build_object('type', 'text', 'value', v_content));
      end if;

      if v_photos is not null and jsonb_typeof(v_photos) = 'array' and jsonb_array_length(v_photos) > 0 then
        begin
          v_best_photo := v_photos->(jsonb_array_length(v_photos) - 1);
          select * into v_file_resp from extensions.http_get(
            format('https://api.telegram.org/bot%s/getFile?file_id=%s', v_config.bot_token, v_best_photo->>'file_id')
          );
          v_file_path := ((v_file_resp.content::jsonb)->'result'->>'file_path');
          if v_file_path is not null then
            v_content_block := v_content_block || jsonb_build_array(jsonb_build_object(
              'type', 'image',
              'value', format('https://api.telegram.org/file/bot%s/%s', v_config.bot_token, v_file_path)
            ));
          end if;
        exception when others then null;
        end;
      end if;

      if v_current_article_id is not null then
        select exists(select 1 from public.articles where id = v_current_article_id) into v_article_exists;
        if not v_article_exists then v_current_article_id := null; end if;
      end if;

      -- 同一天：判断阵列最尾端的时间标头是否跟这则消息同一分钟，是的话合并、不加分隔线
      if v_current_article_id is not null and v_current_article_date = v_hk_date then
        select blocks into v_blocks from public.articles where id = v_current_article_id;
        if v_blocks is null then
          v_current_article_id := null;
        else
          v_last_time := null;
          for i in reverse jsonb_array_length(v_blocks)..1 loop
            if (v_blocks->(i-1)->>'type') = 'text' and (v_blocks->(i-1)->>'value') like '🕐 %' then
              v_last_time := substring(v_blocks->(i-1)->>'value' from 3); -- 🕐+空格＝2字元，第3字元起才是时间
              exit;
            end if;
          end loop;

          if v_last_time = v_msg_time then
            v_blocks := v_blocks || v_content_block;
          else
            if jsonb_array_length(v_blocks) > 0 then
              v_blocks := v_blocks || v_divider || jsonb_build_array(v_time_header) || v_content_block;
            else
              v_blocks := jsonb_build_array(v_time_header) || v_content_block;
            end if;
          end if;
          update public.articles set blocks = v_blocks where id = v_current_article_id;
        end if;
      end if;

      if v_current_article_id is null or v_current_article_date != v_hk_date then
        v_title := to_char(v_hk_date, 'YYYY-MM-DD') || ' 频道更新';
        insert into public.articles (product_id, category_id, title, summary, blocks)
        values (
          v_config.target_product_id, v_config.target_category_id, v_title, '',
          jsonb_build_array(v_time_header) || v_content_block
        )
        returning id into v_current_article_id;
        v_current_article_date := v_hk_date;
      end if;

      -- 每一则处理成功的消息都排队推播（不限制只有当天第一则）
      v_notify_queue := v_notify_queue || jsonb_build_object(
        'article_id', v_current_article_id,
        'first_line', split_part(v_content, E'\n', 1)
      );

      v_count := v_count + 1;
    exception when others then null;
    end;
  end loop;

  if v_current_article_id is not null then
    select exists(select 1 from public.articles where id = v_current_article_id) into v_article_exists;
    if not v_article_exists then v_current_article_id := null; end if;
  end if;

  if v_newest_update_id is not null then
    update public.telegram_channel_configs
      set last_update_id = v_newest_update_id, current_article_id = v_current_article_id, current_article_date = v_current_article_date
      where id = p_config_id;
  else
    update public.telegram_channel_configs
      set current_article_id = v_current_article_id, current_article_date = v_current_article_date
      where id = p_config_id;
  end if;

  -- 資料都確定寫成功了，這時候才推播 Telegram 通知（不可逆動作延後，避免資料回滾但通知已發出）
  if v_config.notify_target_chat_id is not null and v_product is not null then
    for v_update in select * from jsonb_array_elements(v_notify_queue)
    loop
      begin
        v_link := SITE_URL || '/article/' || (v_update->>'article_id');
        v_notify_text := format(
          '[%s][實時更新]已發佈' || E'\n' || '<a href="%s">%s</a>',
          v_product.name, v_link,
          coalesce(nullif(trim(v_update->>'first_line'), ''), v_product.name)
        );
        select * into v_notify_resp from extensions.http((
          'POST', 'https://api.telegram.org/bot' || v_config.bot_token || '/sendMessage',
          ARRAY[]::extensions.http_header[],
          'application/json',
          jsonb_build_object(
            'chat_id', v_config.notify_target_chat_id,
            'text', v_notify_text, 'parse_mode', 'HTML', 'disable_web_page_preview', false
          )::text
        )::extensions.http_request);
      exception when others then null;
      end;
    end loop;
  end if;

  return jsonb_build_object('status', 'ok', 'config_id', p_config_id, 'label', v_config.label, 'synced', v_count);
end;
$$;

-- ---------- 3. 一次跑完所有已启用的频道 ----------
create or replace function public.sync_all_telegram_channels()
returns jsonb
language plpgsql security definer as $$
declare
  v_cfg record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  for v_cfg in select id from public.telegram_channel_configs where enabled = true
  loop
    begin
      v_result := public.sync_one_telegram_channel(v_cfg.id);
    exception when others then
      v_result := jsonb_build_object('status', 'error', 'config_id', v_cfg.id, 'detail', sqlerrm);
    end;
    v_results := v_results || v_result;
  end loop;
  return jsonb_build_object('status', 'ok', 'channels', v_results);
end;
$$;

-- ---------- 4. 对外的 cron 入口（沿用原本的名字，cron-job.org 那边网址/密钥不用改） ----------
create or replace function public.cron_sync_telegram_messages(p_secret text)
returns jsonb
language plpgsql security definer as $$
begin
  if p_secret is null or p_secret != 'Sv2026TelegramSync!k7' then -- 换成你自己的 SYNC_SECRET
    raise exception '密钥不正确';
  end if;
  return public.sync_all_telegram_channels();
end;
$$;

-- ============================================================
-- 以下是操作参考，不是要执行的部分：
--
-- 【既有频道】如果也要发 Telegram 通知，补一次（旧表没有这个栏位，上面搬资料时没带到）：
-- update public.telegram_channel_configs
-- set notify_target_chat_id = '通知群组chat_id(负数)'
-- where label = '既有频道';
--
-- 新增一个频道：
-- insert into public.telegram_channel_configs
--   (label, bot_token, source_chat_id, target_product_id, notify_target_chat_id)
-- values
--   ('频道B', '新Bot的Token', '来源频道chat_id(负数)', '对应的product_id', '通知群组chat_id(负数)');
--
-- 测试单一频道：
-- select public.sync_one_telegram_channel('该行的id');
--
-- 测试全部频道：
-- select public.sync_all_telegram_channels();
--
-- 查看目前所有频道设定：
-- select id, label, enabled, source_chat_id, target_product_id, notify_target_chat_id
-- from public.telegram_channel_configs order by label;
-- ============================================================
