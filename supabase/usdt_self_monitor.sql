-- ============================================================
-- 改用免费的 BSC 公共 RPC 节点自己查链上资料，完全不依赖 Etherscan/BscScan 的付费 API。
-- 直接呼叫 BSC 官方公开节点的 JSON-RPC 接口（eth_getLogs），免费、不用申请任何 API Key。
-- ============================================================

-- 十六进制字串转 numeric（支援任意长度，避免 uint256 金额超出 bigint 范围）
create or replace function public.hex_to_numeric(hex text)
returns numeric
language plpgsql
immutable
as $$
declare
  t text := lower(regexp_replace(hex, '^0x', ''));
  result numeric := 0;
  c text;
  i int;
begin
  if t = '' then return 0; end if;
  for i in 1..length(t) loop
    c := substr(t, i, 1);
    result := result * 16 + ('x' || c)::bit(4)::int;
  end loop;
  return result;
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
  RPC_URL text := 'https://bsc-dataseed.binance.org/';
  v_to_topic text;
  v_latest_hex text;
  v_latest_block bigint;
  v_from_block bigint;
  v_from_hex text;
  v_amount numeric;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;

  -- 1. 拿目前最新区块高度
  select * into v_resp from extensions.http_post(
    RPC_URL,
    '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    'application/json'
  );
  v_latest_hex := (v_resp.content::jsonb)->>'result';
  v_latest_block := ('x' || lpad(regexp_replace(v_latest_hex, '^0x', ''), 16, '0'))::bit(64)::bigint;

  -- 2. 往前抓约 15 分钟的区块范围（BSC 约 3 秒一个块，15 分钟约 300 个块，比订单 10 分钟有效期多留余裕）
  v_from_block := greatest(v_latest_block - 300, 0);
  v_from_hex := '0x' || to_hex(v_from_block);

  -- 3. 组好收款地址的 topic（32 bytes，前面补 0）
  v_to_topic := '0x' || lpad(lower(regexp_replace(v_intent.address, '^0x', '')), 64, '0');

  -- 4. 查 USDT-BEP20 合约在这段区块范围内、转到这个收款地址的 Transfer 事件
  select * into v_resp from extensions.http_post(
    RPC_URL,
    jsonb_build_object(
      'jsonrpc', '2.0', 'id', 1, 'method', 'eth_getLogs',
      'params', jsonb_build_array(jsonb_build_object(
        'fromBlock', v_from_hex,
        'toBlock', 'latest',
        'address', USDT_CONTRACT,
        'topics', jsonb_build_array(TRANSFER_TOPIC, null, v_to_topic)
      ))
    )::text,
    'application/json'
  );
  v_body := v_resp.content::jsonb;

  for v_log in select * from jsonb_array_elements(coalesce(v_body->'result', '[]'::jsonb))
  loop
    v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
    if v_amount >= v_intent.amount * 0.99 then
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
      return jsonb_build_object('status', 'paid');
    end if;
  end loop;

  return jsonb_build_object('status', 'pending');
end;
$$;
