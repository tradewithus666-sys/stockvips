import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { fetchProductById, fetchArticlesByProduct, purchaseWithBalance, createPaymentIntent } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt, usdtToHkd, linkifyHtml } from '../lib/format';

const DUR_MULT = { month: 1, quarter: 2.7, year: 9 };

function getDurationPrice(p, duration) {
  if (p.type === 'subscription') {
    if (duration === 'month') return p.price;
    if (duration === 'quarter') return p.price_quarter ?? Math.round(p.price * DUR_MULT.quarter);
    if (duration === 'year') return p.price_year ?? Math.round(p.price * DUR_MULT.year);
  }
  return Math.round(p.price * DUR_MULT[duration]);
}

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const showToast = useToast();
  const { t } = useLang();

  const TYPE_META = {
    course:       { label: t('type_course'),       icon: '🎓' },
    subscription: { label: t('type_subscription'), icon: '📡' },
    shared:       { label: t('type_shared'),        icon: '🔑' },
  };
  const DUR_LABEL = { month: t('dur_month'), quarter: t('dur_quarter'), year: t('dur_year') };

  const [product, setProduct] = useState(null);
  const [articles, setArticles] = useState([]);
  const [myPerm, setMyPerm] = useState(null);
  const [duration, setDuration] = useState('month');
  const [selectedOption, setSelectedOption] = useState(0);
  const [payMethod, setPayMethod] = useState('balance');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const p = await fetchProductById(id);
      if (!mounted) return;
      setProduct(p);
      if (p.type !== 'course') {
        const a = await fetchArticlesByProduct(id);
        if (mounted) setArticles(a);
      }
      if (user) {
        const { data } = await supabase
          .from('permissions')
          .select('*')
          .eq('member_id', user.id)
          .eq('product_id', id)
          .maybeSingle();
        if (mounted) setMyPerm(data);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [id, user]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!product) return <div className="empty">{t('product_not_found')}</div>;

  const meta = TYPE_META[product.type];
  const isCourse = product.type === 'course';
  const isChannel = product.type === 'subscription';
  const isOff = product.status === 'off';
  const owned = !!myPerm && (!myPerm.expires_at || new Date(myPerm.expires_at) >= new Date(new Date().toDateString()));
  const hasOptions = isCourse && product.options?.length > 0;
  const price = isCourse ? (hasOptions ? Number(product.options[selectedOption]?.price ?? 0) : product.price) : getDurationPrice(product, duration);
  const previewLocked = !owned && !isChannel;
  const ownedText = isCourse ? t('owned_course_text')
    : product.type === 'shared' ? t('owned_shared_text')
    : t('owned_subscription_text');

  async function handleBalancePurchase() {
    if (!user) { showToast(t('toast_login_first')); nav('/login'); return; }
    if ((profile?.balance ?? 0) < price) { showToast(t('balance_insufficient')); return; }
    setBusy(true);
    try {
      await purchaseWithBalance({
        productId: product.id,
        duration: isCourse ? 'lifetime' : duration,
        price,
        variant: hasOptions ? product.options[selectedOption]?.name : null,
      });
      showToast(t('toast_buy_success', product.name));
      await refreshProfile();
      const { data } = await supabase
        .from('permissions').select('*').eq('member_id', user.id).eq('product_id', id).maybeSingle();
      setMyPerm(data);
    } catch (err) {
      showToast(err.message || t('toast_purchase_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleUsdt() {
    if (!user) { showToast(t('toast_login_first')); nav('/login'); return; }
    try {
      const intent = await createPaymentIntent({
        productId: product.id,
        duration: isCourse ? 'lifetime' : duration,
        amount: price,
        address: import.meta.env.VITE_USDT_BEP20_ADDRESS,
      });
      nav(`/pay/${intent.id}`);
    } catch (err) {
      showToast(err.message);
    }
  }

  function handleTelegram() {
    if (!user) { showToast(t('toast_login_first')); nav('/login'); return; }
    window.open(import.meta.env.VITE_TELEGRAM_SUPPORT_URL, '_blank', 'noopener');
    showToast(t('toast_telegram_redirect'));
  }

  function submit() {
    if (payMethod === 'balance') handleBalancePurchase();
    else if (payMethod === 'usdt') handleUsdt();
    else handleTelegram();
  }

  return (
    <div>
      <div className="breadcrumb">{t('breadcrumb_home')} » <b>{meta.label}</b> » {product.name}</div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav('/')}>{t('detail_back')}</button>

      <div className="detail-grid">
        <div className="detail-cover">
          <span className="pill">{meta.icon} {meta.label}</span>
          {product.image
            ? <img className="detail-cover-img" src={product.image} alt="" />
            : <div className="badge-icon lg">🏅</div>}
          <div className="official">{t('official_badge')}</div>
          {((product.base_sold ?? 0) + (product.sold ?? 0)) > 0 && (
            <div className="stats">
              <div><b>{(product.base_sold ?? 0) + (product.sold ?? 0)}</b>{t('detail_sold')}</div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <h1 className="display">{product.name}</h1>
          <p className="desc">{product.description}</p>

          {owned && <div className="owned-banner">{ownedText}</div>}

          {(!owned || isChannel) && (
          <div className="purchase-box">
            {isOff ? (
              <div className="off-shelf-banner">{t('off_shelf_notice')}</div>
            ) : (
              <>
                {isCourse ? (
                  <>
                    {hasOptions && (
                      <div className="dur-grid" style={{ marginBottom: 14 }}>
                        {product.options.map((opt, idx) => (
                          <div
                            key={idx}
                            className={`dur-opt wide ${selectedOption === idx ? 'active' : ''}`}
                            onClick={() => setSelectedOption(idx)}
                          >
                            {opt.name} <small>${opt.price} USDT <span className="fx-hint">≈{usdtToHkd(opt.price)}</span></small>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="price-row"><b>${price}.00 USDT</b><span className="fx-hint">≈ {usdtToHkd(price)} HKD</span><span>{t('per_lifetime')}</span></div>
                    <div className="lifetime-badge">{t('lifetime_badge')}</div>
                  </>
                ) : (
                  <>
                    <div className="price-row">
                      <b>${price}.00 USDT</b> <span className="fx-hint">≈ {usdtToHkd(price)} HKD</span>
                      <span>／{DUR_LABEL[duration]}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontWeight: 600 }}>
                      {product.type === 'shared' ? t('optional_rent') : t('optional_sub')}
                    </div>
                    <div className="dur-grid">
                      {['month', 'quarter', 'year'].map((d) => (
                        <div
                          key={d}
                          className={`dur-opt ${d === 'year' ? 'wide' : ''} ${duration === d ? 'active' : ''}`}
                          onClick={() => setDuration(d)}
                        >
                          {DUR_LABEL[d]} <small>${getDurationPrice(product, d)} USDT <span className="fx-hint">≈{usdtToHkd(getDurationPrice(product, d))}</span></small>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ fontSize: 12, color: 'var(--muted)', margin: '16px 0 10px', fontWeight: 600 }}>{t('choose_payment')}</div>
                <div className="pay-method-list">
                  <div className={`pay-method-card ${payMethod === 'balance' ? 'active' : ''} ${(profile?.balance ?? 0) < price ? 'insufficient' : ''}`} onClick={() => setPayMethod('balance')}>
                    <div className="pmc-icon">💰</div>
                    <div className="pmc-body">
                      <div className="pmc-title">{t('pay_balance_title')}</div>
                      <div className="pmc-sub">{t('pay_balance_sub')}</div>
                    </div>
                    <div className={`pmc-balance ${(profile?.balance ?? 0) < price ? 'low' : ''}`}>${(profile?.balance ?? 0).toFixed(2)} USDT</div>
                  </div>
                  <div className={`pay-method-card ${payMethod === 'usdt' ? 'active' : ''}`} onClick={() => setPayMethod('usdt')}>
                    <div className="pmc-icon">💠</div>
                    <div className="pmc-body">
                      <div className="pmc-title">{t('pay_usdt_title')}</div>
                      <div className="pmc-sub">{t('pay_usdt_sub')}</div>
                    </div>
                  </div>
                  <div className={`pay-method-card ${payMethod === 'telegram' ? 'active' : ''}`} onClick={() => setPayMethod('telegram')}>
                    <div className="pmc-icon">🔵</div>
                    <div className="pmc-body">
                      <div className="pmc-title">{t('pay_telegram_title')}</div>
                      <div className="pmc-sub">{t('pay_telegram_sub')}</div>
                    </div>
                  </div>
                </div>

                {payMethod === 'usdt' && (
                  <div className="field" style={{ margin: '14px 0' }}>
                    <label>{t('usdt_address_label')}</label>
                    <input readOnly value={import.meta.env.VITE_USDT_BEP20_ADDRESS} onClick={(e) => e.target.select()} />
                  </div>
                )}

                {payMethod === 'balance' && (profile?.balance ?? 0) < price && (
                  <div className="balance-warning-box">
                    <span>{t('balance_insufficient')}</span>
                    <button className="btn btn-amber btn-sm" onClick={() => nav('/wallet')}>{t('go_top_up')}</button>
                  </div>
                )}

                <div className="detail-actions">
                  <button className="btn btn-amber" disabled={busy} onClick={submit}>
                    {busy ? t('processing') : payMethod === 'balance' ? t('buy_now_open') : payMethod === 'usdt' ? t('pay_usdt_btn') : t('pay_telegram_btn')}
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>
      </div>

      <div className="section-block">
        <div className="section-title">
          <h2>{isChannel ? t('channel_intro') : t('content_preview')}</h2>
          {hasOptions && <span className="tag">{product.options[selectedOption]?.name}</span>}
        </div>
        <div className={`reader ${previewLocked ? 'locked' : ''}`}>
          <h3 className="display">{product.name}{hasOptions ? ` · ${product.options[selectedOption]?.name}` : ''}</h3>
          <div className="body-text rte-render" dangerouslySetInnerHTML={{ __html: linkifyHtml((hasOptions ? product.options[selectedOption]?.body : product.body) || '') }} />
          {previewLocked && (
            <div className="lock-badge">
              <div className="icon">🔒</div>
              <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>{t('not_unlocked')}</div>
              {!isOff && <button className="btn btn-amber" onClick={submit}>{t('unlock_now')}</button>}
            </div>
          )}
        </div>
      </div>

      {!isCourse && (
        <div className="section-block">
          <div className="section-title"><h2>{t('latest_articles')}</h2></div>
          {articles.length === 0 && <div className="empty">{t('article_none')}</div>}
          {articles.slice(0, 3).map((a) => (
            <div
              key={a.id}
              className="article-item"
              onClick={() => owned ? nav(`/article/${a.id}`) : showToast(t('locked_read_prompt'))}
            >
              <div>
                <div className="ti"><span className="art-date">{formatPublishedAt(a)}</span>{owned ? '' : '🔒 '}{a.title}</div>
                <div className="sm">{a.summary}</div>
              </div>
            </div>
          ))}
          {articles.length > 0 && (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => nav(`/feed/${product.id}`)}>{t('view_all_articles')}</button>
          )}
        </div>
      )}
    </div>
  );
}
