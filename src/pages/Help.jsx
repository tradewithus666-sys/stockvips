import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../lib/LangContext';
import { fetchHelpContent } from '../lib/api';
import { linkifyHtml } from '../lib/format';

export default function Help() {
  const nav = useNavigate();
  const { t } = useLang();
  const [customBody, setCustomBody] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHelpContent()
      .then((data) => setCustomBody(data?.body?.trim() ? data.body : null))
      .finally(() => setLoading(false));
  }, []);

  const steps = [
    ['help_step1_title', 'help_step1_desc'],
    ['help_step2_title', 'help_step2_desc'],
    ['help_step3_title', 'help_step3_desc'],
    ['help_step4_title', 'help_step4_desc'],
    ['help_step5_title', 'help_step5_desc'],
  ];

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav(-1)}>{t('detail_back')}</button>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 20 }}>{t('help_title')}</h1>

      {customBody ? (
        <div className="form-panel">
          <div className="body-text rte-render" dangerouslySetInnerHTML={{ __html: linkifyHtml(customBody) }} />
        </div>
      ) : (
        <>
          {steps.map(([titleKey, descKey], i) => (
            <div className="form-panel" key={titleKey}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{i + 1}. {t(titleKey)}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7 }}>{t(descKey)}</div>
            </div>
          ))}
          <div className="form-panel">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{steps.length + 1}. {t('help_step6_title')}</div>
            <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7, marginBottom: 14 }}>{t('help_step6_desc')}</div>
          </div>
        </>
      )}

      <div className="form-panel">
        <button
          className="btn btn-amber"
          onClick={() => window.open(import.meta.env.VITE_TELEGRAM_SUPPORT_URL, '_blank', 'noopener')}
        >
          🔵 {t('help_contact_support_btn')}
        </button>
      </div>
    </div>
  );
}
