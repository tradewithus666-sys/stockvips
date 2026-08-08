-- ============================================================
-- 修补漏洞：同一笔链上转帐的交易哈希，可以被拿去在不同订单里重复兑换。
-- 做法：先在资料库层加一个唯一索引兜底（就算程式逻辑漏检查，资料库也会挡下来），
-- 再让验证函式在写入前明确检查这个哈希有没有被用过。
-- ============================================================

-- 资料库层保险：同一个 tx_hash 只能对应一笔 status='paid' 的订单
create unique index if not exists payment_intents_tx_hash_paid_unique
  on public.payment_intents (tx_hash)
  where status = 'paid' and tx_hash is not null;

create or replace function public.verify_usdt_tx(p_intent_id uuid, p_tx_hash text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents;
  v_product record;
  v_resp extensions.http_response;
  v_result jsonb;
  v_log jsonb;
  v_amount numeric;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
  USDT_CONTRACT text := '0x55d398326f99059fF775485246999027B3197955';
  TRANSFER_TOPIC text := '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  RPC_URL text := 'https://bsc-dataseed.binance.org/';
  v_to_topic text;
  v_already_used boolean;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if p_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    return jsonb_build_object('status', 'invalid_hash');
  end if;

  -- 关键：这个哈希是不是已经在别的订单（或曾经）被兑换成功过
  select exists(
    select 1 from public.payment_intents
    where tx_hash = p_tx_hash and status = 'paid'
  ) into v_already_used;
  if v_already_used then
    return jsonb_build_object('status', 'tx_already_used');
  end if;

  select * into v_resp from extensions.http_post(
    RPC_URL,
    jsonb_build_object('jsonrpc','2.0','id',1,'method','eth_getTransactionReceipt','params', jsonb_build_array(p_tx_hash))::text,
    'application/json'
  );
  v_result := (v_resp.content::jsonb)->'result';
  if v_result is null or v_result = 'null'::jsonb then
    return jsonb_build_object('status', 'tx_not_found');
  end if;
  if (v_result->>'status') != '0x1' then
    return jsonb_build_object('status', 'tx_failed');
  end if;

  v_to_topic := '0x' || lpad(lower(regexp_replace(v_intent.address, '^0x', '')), 64, '0');

  for v_log in select * from jsonb_array_elements(coalesce(v_result->'logs', '[]'::jsonb))
  loop
    if lower(v_log->>'address') = lower(USDT_CONTRACT)
       and (v_log->'topics'->>0) = TRANSFER_TOPIC
       and lower(v_log->'topics'->>2) = v_to_topic
    then
      v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
      if v_amount >= v_intent.amount * 0.99 then
        if v_intent.kind = 'recharge' then
          update public.profiles set balance = balance + v_intent.amount where id = v_intent.member_id;
          insert into public.wallet_tx (member_id, amount, status, tx_hash) values (v_intent.member_id, v_intent.amount, 'success', p_tx_hash);
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
        -- 这里若违反上面的唯一索引（极端并发情况下两笔请求同时通过检查），会直接抛错，
        -- 前端会看到错误提示，不会重复入帐——资料库这道防线比程式逻辑更可靠。
        update public.payment_intents set status = 'paid', tx_hash = p_tx_hash where id = p_intent_id;
        return jsonb_build_object('status', 'paid');
      else
        return jsonb_build_object('status', 'amount_mismatch', 'found', v_amount, 'expected', v_intent.amount);
      end if;
    end if;
  end loop;

  return jsonb_build_object('status', 'no_matching_transfer');
end;
$$;

-- 自动侦测的函式也要补同样的检查：避免同一笔转帐被两个不同订单同时判定成功
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

  update public.payment_intents set last_scanned_block = v_latest_block + 1 where id = p_intent_id;

  if not (v_body ? 'error') and (v_body ? 'result') then
    for v_log in select * from jsonb_array_elements(coalesce(v_body->'result', '[]'::jsonb))
    loop
      v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
      -- 关键新增：这个哈希是不是已经在别的订单被兑换成功过，避免同一笔转帐重复入帐
      if v_amount >= v_intent.amount * 0.99
         and not exists(select 1 from public.payment_intents where tx_hash = (v_log->>'transactionHash') and status = 'paid')
      then
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

