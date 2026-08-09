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
  current_article_id uuid references public.articles(id) on delete set null,
  current_article_date date,
  constraint telegram_sync_config_singleton check (id = 1)
);
insert into public.telegram_sync_config (id) values (1) on conflict (id) do nothing;
alter table public.telegram_sync_config add column if not exists current_article_id uuid references public.articles(id) on delete set null;
alter table public.telegram_sync_config add column if not exists current_article_date date;

alter table public.telegram_sync_config enable row level security;
drop policy if exists "telegram config admin only" on public.telegram_sync_config;
create policy "telegram config admin only" on public.telegram_sync_config for all using (public.is_admin());

-- Telegram 同步是排程／anon 角色呼叫的，没有登入身份，不能直接用 notify_telegram_article()
-- （那个函式会检查 is_admin()）。这里另外做一个不检查身份、只给内部同步流程呼叫的版本。
create or replace function public.notify_telegram_new_message(p_article_id uuid, p_preview text)
returns void
language plpgsql
security definer
as $$
declare
  v_article record;
  v_product record;
  v_category_name text;
  v_resp extensions.http_response;
  BOT_TOKEN text := '8532446508:AAG6BO_MUmVOG6lm1E6U1wG9Bc6D_42RXWQ';
  CHAT_ID text := '-1003198568376';
  SITE_URL text := 'https://stockvip.netlify.app';
  v_text text;
  v_link text;
  v_label text;
begin
  select * into v_article from public.articles where id = p_article_id;
  if v_article is null then return; end if;
  select * into v_product from public.products where id = v_article.product_id;
  if v_article.category_id is not null then
    select name into v_category_name from public.article_categories where id = v_article.category_id;
  end if;

  v_label := replace(replace(replace(coalesce(v_product.name, '未知频道'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  if v_category_name is not null then
    v_label := v_label || '][' || replace(replace(replace(v_category_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  end if;

  v_link := SITE_URL || '/article/' || v_article.id;
  v_text := format(
    '📢 <a href="%s">[%s] 有更新</a>%s',
    v_link,
    v_label,
    case when p_preview is not null and p_preview != '' then
      E'\n' || left(replace(replace(replace(p_preview, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), 20)
    else '' end
  );

  begin
    select * into v_resp from extensions.http_post(
      format('https://api.telegram.org/bot%s/sendMessage', BOT_TOKEN),
      jsonb_build_object('chat_id', CHAT_ID, 'text', v_text, 'parse_mode', 'HTML')::text,
      'application/json'
    );
  exception when others then
    -- 通知发送失败不该让同步本身失败，忽略即可
    null;
  end;
end;
$$;

-- ============================================================
-- 把 Telegram 图片改成「下载后重新上传到你自己的 Supabase Storage」，
-- 不再把带有 Bot Token 的 Telegram 网址直接存进公开文章里。
-- ============================================================

-- 移除之前那个不可靠的「重新托管图片」函式（实测会导致整个同步失败）
drop function if exists public.rehost_telegram_image(text, text);

-- ============================================================
-- 图片处理策略说明（老实记录一下这里的取舍）：
-- 原本想做「下载图片后重新上传到 Supabase Storage」来避免 Telegram 网址带着 Bot Token，
-- 但标准的 pgsql-http 扩充功能是针对文字／JSON API 设计的，没办法可靠处理二进位图片资料，
-- 实测下来会导致整个同步失败（这也是造成「文章存不进去、但通知一直重复发」的根本原因——
-- 上传那段程式码每次都出错，导致交易整个回滚，但发 Telegram 通知的动作已经真的发出去了，
-- 没办法被回滚，才会看到重复通知）。
--
-- 这里改回直接使用 Telegram 官方的图片网址（内含 Bot Token），先确保功能稳定可用。
-- 关于 Token 外泄风险的因应方式：
-- 1. 强烈建议改用「专门只负责读取来源频道、不身兼发通知」的独立 Bot，
--    这样就算这组 Token 外泄，最多只是这个頻道可以被讀取，不会牵连到你主要通知 Bot 的其他权限。
-- 2. 定期到 BotFather 撤销重生这组 Token（跟你刚才做的一样），让旧网址失效。
-- 3. 未来如果想做到真正安全的重新托管，需要用 Supabase Edge Function（支援完整二进位处理），
--    这个需要另外用 Supabase CLI 部署，跟我说一声我可以帮你写代码，但部署步骤要你自己在电脑上跑。
-- ============================================================

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
  v_new_block jsonb;
  v_current_article_id uuid;
  v_current_article_date date;
  v_msg_time text;
  v_divider jsonb := jsonb_build_array(jsonb_build_object('type', 'text', 'value', '──────────────────'));
begin
  select * into v_config from public.telegram_sync_config where id = 1;
  if v_config is null or not v_config.enabled or v_config.bot_token is null
     or v_config.source_chat_id is null or v_config.target_product_id is null then
    return jsonb_build_object('status', 'not_configured');
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
    return jsonb_build_object('status', 'telegram_error', 'detail', v_resp.content::jsonb);
  end if;

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

      -- 组这一则消息自己的区块（时间戳 + 文字 + 图片），之后要「附加」进当天的文章，不是各自开一篇
      v_msg_time := to_char(to_timestamp((v_post->>'date')::bigint) at time zone 'Asia/Hong_Kong', 'HH24:MI');
      v_new_block := jsonb_build_array(jsonb_build_object('type', 'text', 'value', '🕐 ' || v_msg_time));
      if v_content != '' then
        v_new_block := v_new_block || jsonb_build_array(jsonb_build_object('type', 'text', 'value', v_content));
      end if;

      if v_photos is not null and jsonb_typeof(v_photos) = 'array' and jsonb_array_length(v_photos) > 0 then
        begin
          v_best_photo := v_photos->(jsonb_array_length(v_photos) - 1);
          select * into v_file_resp from extensions.http_get(
            format('https://api.telegram.org/bot%s/getFile?file_id=%s', v_config.bot_token, v_best_photo->>'file_id')
          );
          v_file_path := ((v_file_resp.content::jsonb)->'result'->>'file_path');
          if v_file_path is not null then
            v_new_block := v_new_block || jsonb_build_array(jsonb_build_object(
              'type', 'image',
              'value', format('https://api.telegram.org/file/bot%s/%s', v_config.bot_token, v_file_path)
            ));
          end if;
        exception when others then
          -- 抓图失败（网路问题／Telegram 回传格式异常等）不要让这则消息处理中断，
          -- 这篇文章退回只发文字内容，图片部分跳过
          null;
        end;
      end if;

      -- 同一天的消息合并进同一篇文章：如果今天已经有开过文章（current_article_date = 今天），
      -- 就把新区块附加进那篇既有文章（中间插一条分隔线）；否则新开一篇当天的文章
      if v_current_article_id is not null and v_current_article_date = current_date then
        select blocks into v_blocks from public.articles where id = v_current_article_id;
        if v_blocks is null then
          -- 找不到那篇文章了（可能被手动删除），当作要重新开一篇
          v_current_article_id := null;
        else
          if jsonb_array_length(v_blocks) > 0 then
            update public.articles set blocks = v_new_block || v_divider || v_blocks where id = v_current_article_id;
          else
            update public.articles set blocks = v_new_block || v_blocks where id = v_current_article_id;
          end if;
        end if;
      end if;

      if v_current_article_id is null or v_current_article_date != current_date then
        v_title := to_char(current_date, 'YYYY-MM-DD') || ' 频道更新';
        insert into public.articles (product_id, category_id, title, summary, blocks)
        values (v_config.target_product_id, v_config.target_category_id, v_title, '', v_new_block)
        returning id into v_current_article_id;
        v_current_article_date := current_date;
      end if;

      perform public.notify_telegram_new_message(v_current_article_id, v_content);

      v_count := v_count + 1;
    exception when others then
      -- 就算这则消息整个处理失败，也不要让其他消息／已经成功的文章被一起复原，
      -- 跳过这一则，继续处理下一则
      null;
    end;
  end loop;

  if v_newest_update_id is not null then
    update public.telegram_sync_config
      set last_update_id = v_newest_update_id,
          current_article_id = v_current_article_id,
          current_article_date = v_current_article_date
      where id = 1;
  else
    update public.telegram_sync_config
      set current_article_id = v_current_article_id,
          current_article_date = v_current_article_date
      where id = 1;
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
