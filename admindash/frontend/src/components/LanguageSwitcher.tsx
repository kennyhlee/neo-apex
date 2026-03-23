import { useTranslation } from '../hooks/useTranslation.ts';
import type { Locale } from '../i18n/translations.ts';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '0.85rem',
        padding: '0.3rem 0.5rem',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-input)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
      }}
    >
      <option value="en-US">English</option>
      <option value="zh-CN">中文</option>
    </select>
  );
}
