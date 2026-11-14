import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useToast } from '../lib/ToastContext';

// 後台「群發電郵」分頁。
// 發送由 Netlify 背景函式 broadcast-background 執行（驗證管理員身份後分批寄出），
// 這裡只負責填寫內容、按發送、並顯示 broadcast_log 的進度與歷史。

const STATUS_LABEL = {
  sending: '發送中…',
  done: '已完成',
  partial: '部分失敗',
  failed: '失敗',
};

function fmtTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('zh-HK', { hour12: false }).replace(/\//g, '-');
}

export default function BroadcastTab() {
  const showToast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [counts, setCounts] = useState({ active: null, optout: null });
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadCounts = useCallback(async () => {
    const [a, o] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('email_broadcast_optout', false),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('email_broadcast_optout', true),
    ]);
    setCounts({ active: a.count ?? 0, optout: o.count ?? 0 });
  }, []);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase
      .from('broadcast_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    setLogs(data || []);
  }, []);

  useEffect(() => { loadCounts(); loadLogs(); }, [loadCounts, loadLogs]);

  const sending = logs.some((l) => l.status === 'sending');

  // 有發送中的紀錄時，每 4 秒更新一次進度
  useEffect(() => {
    if (!sending && !busy) return undefined;
    const timer = setInterval(loadLogs, 4000);
    return () => clearInterval(timer);
  }, [sending, busy, loadLogs]);

  async function submit(mode) {
    const s = subject.trim();
    const b = body.trim();
    if (!s || !b) { showToast('請先填寫標題和內容'); return; }
    if (mode === 'send') {
      const ok = window.confirm(
        `確定要發送給 ${counts.active ?? '?'} 位會員嗎？\n\n標題：${s}\n\n發出後無法撤回。建議先按「寄測試信給我」確認內容。`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('登入已過期，請重新登入');
      const res = await fetch('/.netlify/functions/broadcast-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mode, subject: s, body: b }),
      });
      if (res.status !== 202) throw new Error(`伺服器回應 ${res.status}，請確認 broadcast-background 已部署`);
      showToast(mode === 'test' ? '測試信發送中，稍後到你的信箱查看' : '已開始發送，進度見下方紀錄');
      setTimeout(loadLogs, 1500);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h3 style={{ marginTop: 0 }}>群發電郵</h3>
      <p style={{ opacity: 0.75, lineHeight: 1.6, marginTop: 4 }}>
        將發送給所有註冊會員的電郵信箱：
        <b> {counts.active ?? '…'} 位</b>
        {counts.optout > 0 && `（另有 ${counts.optout} 位已取消訂閱，不會收到）`}。
        每封信底部會自動加上「取消訂閱」連結。
      </p>

      <div className="form-panel" style={{ marginTop: 16 }}>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>郵件標題</label>
          <input maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>郵件內容（純文字，換行會保留，網址會自動變成連結）</label>
          <textarea
            style={{ minHeight: 220, lineHeight: 1.6 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={busy || sending} onClick={() => submit('test')}>
            寄測試信給我
          </button>
          <button className="btn btn-amber" disabled={busy || sending} onClick={() => submit('send')}>
            {sending ? '發送中…' : '發送給全體會員'}
          </button>
        </div>
      </div>

      <h4 style={{ marginTop: 32 }}>發送紀錄</h4>
      {logs.length === 0 && <p style={{ opacity: 0.6 }}>還沒有發送紀錄。</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {logs.map((l) => (
          <div
            key={l.id}
            style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <b style={{ wordBreak: 'break-all' }}>{l.mode === 'test' ? '[測試] ' : ''}{l.subject}</b>
              <span>{STATUS_LABEL[l.status] || l.status}</span>
            </div>
            <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
              {fmtTime(l.created_at)}　|　成功 {l.sent} / 共 {l.total}
              {l.failed > 0 && `　|　失敗 ${l.failed}`}
            </div>
            {l.error && <div style={{ color: '#E2574C', fontSize: 13, marginTop: 4 }}>{l.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
