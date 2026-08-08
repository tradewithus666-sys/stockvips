-- ============================================================
-- 改用 1rpc.io/bnb 这个免费节点（确认过可以用 eth_getLogs，但单次查询上限 50 个区块）。
-- 做法：每笔订单记住「已经扫描到哪个区块」，每次轮询只往前扫一小段（正常情况下 10 秒轮询、
-- BSC 约 3 秒一个块，只会新增 3~4 个区块，远低于 50 的上限），持续往前推进，不会漏掉也不会超限。
-- ============================================================

alter table public.payment_intents add column if not exists last_scanned_block bigint;

-- 建立订单时，先记录当下的区块高度，之后从这里开始往前扫
create or replace function public.create_payment_intent(p_product_id uuid, p_duration text, p_amount numeric, p_address text)
returns public.payment_intents
language plpgsql
security definer
as $$
declare
  v_row public.payment_intents;
  v_resp extensions.http_response;
  v_block_hex text;
  v_block bigint;
begin
  select * into v_resp from extensions.http_post(
    'https://1rpc.io/bnb',
    '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    'application/json'
  );
  v_block_hex := (v_resp.content::jsonb)->>'result';
  v_block := case when v_block_hex is not null
    then ('x' || lpad(regexp_replace(v_block_hex, '^0x', ''), 16, '0'))::bit(64)::bigint
    else null end;

  insert into public.payment_intents (member_id, product_id, duration, amount, address, last_scanned_block)
  values (auth.uid(), p_product_id, p_duration, p_amount, p_address, v_block)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_recharge_intent(p_amount numeric, p_address text)
returns public.payment_intents
language plpgsql
security definer
as $$
declare
  v_row public.payment_intents;
  v_resp extensions.http_response;
  v_block_hex text;
  v_block bigint;
begin
  select * into v_resp from extensions.http_post(
    'https://1rpc.io/bnb',
    '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    'application/json'
  );
  v_block_hex := (v_resp.content::jsonb)->>'result';
  v_block := case when v_block_hex is not null
    then ('x' || lpad(regexp_replace(v_block_hex, '^0x', ''), 16, '0'))::bit(64)::bigint
    else null end;

  insert into public.payment_intents (member_id, product_id, duration, amount, address, kind, last_scanned_block)
  values (auth.uid(), null, 'recharge', p_amount, p_address, 'recharge', v_block)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.check_and_complete_usdt_payment(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents;
  v_product record;
  v_resp extensions.http_response;
  v_body jsonb;
  v_log jsonb;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
  USDT_CONTRACT text := '0x55d398326f99059fF775485246999027B3197955';
  TRANSFER_TOPIC text := '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  RPC_URL text := 'https://1rpc.io/bnb';
  v_to_topic text;
  v_latest_hex text;
  v_latest_block bigint;
  v_from_block bigint;
  v_amount numeric;
  v_found boolean := false;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_resp from extensions.http_post(
    RPC_URL,
    '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    'application/json'
  );
  v_latest_hex := (v_resp.content::jsonb)->>'result';
  if v_latest_hex is null then
    return jsonb_build_object('status', 'pending', 'note', 'rpc_unavailable');
  end if;
  v_latest_block := ('x' || lpad(regexp_replace(v_latest_hex, '^0x', ''), 16, '0'))::bit(64)::bigint;

  -- 上限卡在 45 个区块内（节点限制 50），下限用「上次扫到哪」接续，避免漏段或超限
  v_from_block := greatest(coalesce(v_intent.last_scanned_block, v_latest_block - 45), v_latest_block - 45);
  if v_from_block > v_latest_block then v_from_block := v_latest_block; end if;

  v_to_topic := '0x' || lpad(lower(regexp_replace(v_intent.address, '^0x', '')), 64, '0');

  select * into v_resp from extensions.http_post(
    RPC_URL,
    jsonb_build_object(
      'jsonrpc', '2.0', 'id', 1, 'method', 'eth_getLogs',
      'params', jsonb_build_array(jsonb_build_object(
        'fromBlock', '0x' || to_hex(v_from_block),
        'toBlock', '0x' || to_hex(v_latest_block),
        'address', USDT_CONTRACT,
        'topics', jsonb_build_array(TRANSFER_TOPIC, null, v_to_topic)
      ))
    )::text,
    'application/json'
  );
  v_body := v_resp.content::jsonb;

  -- 不管这次有没有找到，都把扫描进度往前推进，下次从这里接着扫
  update public.payment_intents set last_scanned_block = v_latest_block + 1 where id = p_intent_id;

  if not (v_body ? 'error') and (v_body ? 'result') then
    for v_log in select * from jsonb_array_elements(coalesce(v_body->'result', '[]'::jsonb))
    loop
      v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
      if v_amount >= v_intent.amount * 0.99 then
        v_found := true;
        if v_intent.kind = 'recharge' then
          update public.profiles set balance = balance + v_intent.amount where id = v_intent.member_id;
          insert into public.wallet_tx (member_id, amount, status, tx_hash) values (v_intent.member_id, v_intent.amount, 'success', v_log->>'transactionHash');
        else
          select * into v_product from public.products where id = v_intent.product_id;
          v_days := case v_intent.duration when 'month' then 30 when 'quarter' then 90 when 'year' then 365 else null end;
          select expires_at into v_existing_expiry from public.permissions
            where member_id = v_intent.member_id and product_id = v_intent.product_id;
          if v_product.type = 'course' or v_days is null then
            v_new_expiry := null;
          else
            v_new_expiry := greatest(coalesce(v_existing_expiry, current_date), current_date) + v_days;
          end if;
          insert into public.permissions (member_id, product_id, expires_at)
            values (v_intent.member_id, v_intent.product_id, v_new_expiry)
            on conflict (member_id, product_id) do update set expires_at = excluded.expires_at;
          insert into public.purchases (member_id, product_id, duration, price)
            values (v_intent.member_id, v_intent.product_id, v_intent.duration, v_intent.amount);
          update public.products set sold = sold + 1 where id = v_intent.product_id;
        end if;
        update public.payment_intents set status = 'paid', tx_hash = v_log->>'transactionHash' where id = p_intent_id;
        exit;
      end if;
    end loop;
  end if;

  if v_found then
    return jsonb_build_object('status', 'paid');
  end if;
  return jsonb_build_object('status', 'pending');
end;
$$;
