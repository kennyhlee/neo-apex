import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTranslation } from '../hooks/useTranslation.ts';
import Button from '../components/ui/Button.tsx';
import { fetchStripeAccountId, fetchStripeConnectLink } from '../api/payments.ts';
import './PaymentsSettingsPage.css';

export default function PaymentsSettingsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const tenantId = user?.tenant_id ?? '';

  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const justConnected = params.get('stripe_connected') === '1';
  const callbackError = params.get('stripe_error');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      setAccountId(await fetchStripeAccountId(tenantId));
    } catch {
      setError(t('payments.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const onConnect = async () => {
    setRedirecting(true);
    setError(null);
    try {
      window.location.href = await fetchStripeConnectLink(tenantId);
    } catch {
      setError(t('payments.linkError'));
      setRedirecting(false);
    }
  };

  return (
    <main className="payments-settings">
      <h1>{t('payments.title')}</h1>
      <p className="payments-settings__intro">{t('payments.intro')}</p>

      {justConnected && (
        <div className="payments-settings__banner payments-settings__banner--ok" role="status">
          {t('payments.justConnected')}
        </div>
      )}
      {callbackError && (
        <div className="payments-settings__banner payments-settings__banner--error" role="alert">
          {t('payments.callbackError')}
        </div>
      )}
      {error && (
        <div className="payments-settings__banner payments-settings__banner--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="payments-settings__loading">{t('payments.loading')}</p>
      ) : accountId ? (
        <section className="payments-settings__card">
          <h2>{t('payments.connectedTitle')}</h2>
          <p>{t('payments.connectedBody')}</p>
          <p className="payments-settings__account">
            {t('payments.accountLabel')}: <code>{accountId}</code>
          </p>
        </section>
      ) : (
        <section className="payments-settings__card">
          <h2>{t('payments.notConnectedTitle')}</h2>
          <p>{t('payments.notConnectedBody')}</p>
          <Button variant="primary" onClick={onConnect} disabled={redirecting || !tenantId}>
            {redirecting ? t('payments.redirecting') : t('payments.connectButton')}
          </Button>
        </section>
      )}
    </main>
  );
}
