import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { requestLink } from '../api/facade.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './RequestLinkPage.css';

/**
 * Request-link must reveal nothing about whether an email matched an
 * application. The facade's `requestLink` always resolves to `void` on any
 * 2xx (apexflow returns `{}` on both a hit and a miss, deferring its send to
 * a background task so the response is written identically either way) and
 * throws only on a genuine client-side network failure or a non-2xx from
 * the facade itself -- which is masked to a fixed 200 by the backend even
 * during an apexflow outage, per the facade's own doc comment.
 *
 * This page therefore has NO error branch for this call. `onSubmit`'s
 * `catch` deliberately does nothing but fall through to the same
 * confirmation `finally` sets for the success path -- resolving and
 * rejecting land on the identical screen, with no different message,
 * timing state, or resend affordance that could act as a second oracle.
 */
export default function RequestLinkPage() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const prefillTenant = searchParams.get('tenant') ?? '';

  const [tenantId, setTenantId] = useState(prefillTenant);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await requestLink(tenantId.trim(), email.trim());
    } catch {
      // Intentionally swallowed. Showing a different state here -- an error
      // message, a retry affordance, anything -- would tell whoever is
      // holding this form whether the email they typed matched a real
      // application. See the doc comment above.
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="request-link-page">
        <h1>{t('requestLink.title')}</h1>
        <p className="request-link-sent" role="status">
          {t('requestLink.sent')}
        </p>
      </div>
    );
  }

  return (
    <div className="request-link-page">
      <h1>{t('requestLink.title')}</h1>
      <p className="request-link-body">{t('requestLink.body')}</p>
      <form className="request-link-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {!prefillTenant && (
          <>
            <label htmlFor="rl-tenant">{t('requestLink.tenantLabel')}</label>
            <input
              id="rl-tenant"
              type="text"
              required
              disabled={submitting}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </>
        )}
        <label htmlFor="rl-email">{t('requestLink.emailLabel')}</label>
        <input
          id="rl-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={submitting}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          className="request-link-primary"
          disabled={submitting || !tenantId.trim() || !email.trim()}
        >
          {t('requestLink.send')}
        </button>
      </form>
    </div>
  );
}
