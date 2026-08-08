import { useNavigate } from 'react-router-dom';
import { useLang } from '../lib/LangContext';

export default function Help() {
  const nav = useNavigate();
  const { t } = useLang();

  const steps = [
    ['help_step1_title', 'help_step1_desc'],
    ['help_step2_title', 'help_step2_desc'],
    ['help_step3_title', 'help_step3_desc'],
    ['help_step4_title', 'help_step4_desc'],
    ['help_step5_title', 'help_step5_desc'],
  ];

  return (
    <div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav(-1)}>{t('detail_back')}</button>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 20 }}>{t('help_title')}</h1>
      {steps.map(([titleKey, descKey], i) => (
        <div className="form-panel" key={titleKey}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{i + 1}. {t(titleKey)}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7 }}>{t(descKey)}</div>
        </div>
      ))}

      <div className="form-panel">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{steps.length + 1}. {t('help_step6_title')}</div>
        <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7, marginBottom: 14 }}>{t('help_step6_desc')}</div>
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
