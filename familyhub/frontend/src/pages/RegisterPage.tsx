import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FlowRenderer, defaultSchoolYear } from '@neoapex/flow-runtime';
import type { ApplicationItem, ApplicationSummary } from '@neoapex/flow-runtime';
import {
  completeItem,
  fetchApplication,
  fetchRegistrationBundle,
  saveDraft,
  startRegistration,
  submitApplication,
  uploadDocumentFile,
} from '../api/facade.ts';
import {
  entityData,
  entityId,
  type EntityRecord,
  type HubBundle,
  type RegistrationBundle,
} from '../types/registration.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './RegisterPage.css';

/**
 * `loading`   -- fetching the public config bundle, or (resume path) the
 *                application behind a `?token=`.
 * `email`     -- config bundle loaded, no token yet: capture the applicant's
 *                email and start a new application.
 * `running`   -- an application + token are in hand: mount FlowRenderer.
 * `notFound`  -- the tenant's config bundle 404s (bad URL, or the school
 *                simply isn't open for registration -- the backend does not
 *                distinguish the two, see bindings §"Config bundle route").
 * `invalidLink` -- a `?token=` was supplied but is unknown/expired/revoked.
 *                  Distinct from `notFound` because the *school* is fine
 *                  here -- only the parent's link is bad -- so a different,
 *                  more accurate message + "request a new link" CTA applies.
 */
type Phase = 'loading' | 'email' | 'running' | 'notFound' | 'invalidLink';

/**
 * DataCore stringifies every top-level field of a flattened row -- `"false"`
 * is truthy in JS. This coerces exactly those fields (never values already
 * inside a parsed JSON blob, which arrive as real JS types).
 */
function asBool(v: unknown): boolean {
  return String(v) === 'true';
}

/**
 * `HubBundle.application` / `StartResponse.application` are flattened
 * DataCore rows. `application_id` here is the ONE genuine display exception
 * to the identifier trap (bindings §1 discrepancy 3): it is the business id,
 * shown to the parent, and no block ever dispatches on it.
 */
function toApplicationSummary(row: EntityRecord): ApplicationSummary {
  const d = entityData(row);
  return {
    application_id: String(d.application_id ?? ''),
    school_year: String(d.school_year ?? ''),
    status: (d.status as ApplicationSummary['status']) ?? 'draft',
    channel_started: (d.channel_started as ApplicationSummary['channel_started']) ?? 'parent',
    // Stringly-typed top-level DataCore field -- coerce before any numeric use.
    config_version: Number(d.config_version ?? 1),
    applicant_email: typeof d.applicant_email === 'string' ? d.applicant_email : undefined,
  };
}

/**
 * IDENTIFIER TRAP: `item_id` below MUST be the row's DataCore `entity_id`,
 * never the business `item_id` field the row also carries -- every action
 * this page dispatches (`onCompleteItem`, `onUploadDocument`) sends this
 * value straight back to `completeItem`/`uploadDocumentFile`, which resolve
 * it against `entity_id` server-side (bindings §5). `blocking` is coerced
 * with `asBool` for the same reason `application.config_version` is coerced
 * with `Number` above -- it is a stringly-typed top-level field.
 */
function toApplicationItems(rows: EntityRecord[]): ApplicationItem[] {
  return rows.map((row) => {
    const d = entityData(row);
    return {
      // MUST go through entityId(): `d` is base_data for the envelope
      // shape, which has no entity_id in it (see entityId's note).
      item_id: entityId(row),
      application_id: String(d.application_id ?? ''),
      block_id: String(d.block_id ?? ''),
      kind: (d.kind as ApplicationItem['kind']) ?? 'form',
      title: String(d.title ?? ''),
      status: (d.status as ApplicationItem['status']) ?? 'not_started',
      blocking: asBool(d.blocking),
      due_at: typeof d.due_at === 'string' ? d.due_at : undefined,
      completed_by: typeof d.completed_by === 'string' ? d.completed_by : undefined,
      payload_ref: typeof d.payload_ref === 'string' ? d.payload_ref : undefined,
      due_days_after_approval:
        d.due_days_after_approval != null ? Number(d.due_days_after_approval) : undefined,
    };
  });
}

/**
 * `draft_data` is a JSON-serialized string column (same shape as
 * `config.blocks` before `facade.ts` normalizes it, but this one is never
 * pre-parsed for us -- neither `HubBundle` nor `StartResponse` normalizes it,
 * since only `config` needs a typed shape). Values inside the parsed object
 * are real JS types already and must not be re-coerced.
 */
function parseDraft(applicationRow: EntityRecord): Record<string, unknown> {
  const raw = entityData(applicationRow).draft_data;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function RegisterPage() {
  // Task 10: route is now /w/:tenantId/:definitionId (spec §6), renamed
  // from /register/:tenantId -- see App.tsx.
  const { tenantId = '', definitionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useTranslation();

  const [phase, setPhase] = useState<Phase>('loading');
  const [bundle, setBundle] = useState<RegistrationBundle | null>(null);
  const [hub, setHub] = useState<HubBundle | null>(null);
  const [token, setToken] = useState<string>(searchParams.get('token') ?? '');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // Set the instant `onStart` has a token in hand -- before the resume
  // effect below can ever see the new `token` on a re-render. Guards that
  // effect from re-firing a second, wholly redundant `fetchApplication`
  // right after a successful start (see the effect's comment).
  const startedLocallyRef = useRef(false);

  // Load the public config bundle (school name, capacity state, blocks).
  // This is unauthenticated and pre-start -- it never needs a token. (Phase
  // starts at 'loading' via useState's initializer above; this effect only
  // ever moves it forward from there, so no synchronous reset is needed
  // inside the effect body itself.)
  useEffect(() => {
    let cancelled = false;
    fetchRegistrationBundle(tenantId, definitionId)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setPhase((prev) => (prev === 'running' ? prev : 'email'));
      })
      .catch(() => {
        if (!cancelled) setPhase('notFound');
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, definitionId]);

  // Resume path: `?token=` present -> load the application directly and
  // skip the email-capture phase entirely, once the config bundle is also
  // in hand (needed so a slow bundle fetch can't race the phase transition).
  // Guarded by `startedLocallyRef`: without it, `onStart` setting `token`
  // (previously '') makes both guards below pass on the very next render,
  // firing a second, wholly redundant `fetchApplication` right after a
  // successful start -- and that redundant fetch's own failure (a flaky
  // connection, a masked 502, a 429) would otherwise replace a
  // successfully-mounted FlowRenderer with "this link is invalid" seconds
  // after the application was created.
  useEffect(() => {
    if (!token || !bundle || startedLocallyRef.current) return;
    let cancelled = false;
    fetchApplication(token)
      .then((h) => {
        if (cancelled) return;
        setHub(h);
        setPhase('running');
      })
      .catch(() => {
        // Never downgrade a phase that is already `running` -- mirrors the
        // `prev === 'running' ? prev : ...` guard the sibling bundle-load
        // effect above already uses. Belt-and-suspenders alongside the
        // `startedLocallyRef` guard: this effect should not even re-fire
        // once running, but if it somehow did, its failure must still
        // never imply the link itself is bad.
        if (!cancelled) setPhase((prev) => (prev === 'running' ? prev : 'invalidLink'));
      });
    return () => {
      cancelled = true;
    };
  }, [token, bundle]);

  const refreshHub = useCallback(async () => {
    if (!token) return;
    try {
      setHub(await fetchApplication(token));
    } catch {
      // A post-action refresh failing is not evidence the action itself
      // failed -- swallow it here so `onCompleteItem`/`onUploadDocument`'s
      // own try/catch below (which reports "the action failed") never
      // fires for a refresh that merely blipped after the real action
      // already succeeded. Same root cause as HubPage's `load()`.
    }
  }, [token]);

  async function onStart(e: FormEvent) {
    e.preventDefault();
    if (!bundle || starting) return;
    const value = email.trim();
    if (value.length < 6 || !value.includes('@')) {
      setFormError(t('register.invalidEmail'));
      return;
    }
    setFormError(null);
    setStarting(true);
    try {
      const started = await startRegistration(tenantId, definitionId, value);
      // Must be set before `setToken` -- otherwise the resume effect's
      // guard is not yet in place on the very next render.
      startedLocallyRef.current = true;
      setToken(started.token);
      setLinkSent(true);
      // `started` already carries the fresh application + items -- reuse
      // them (and the config bundle already in hand) instead of an
      // immediate second round trip to `fetchApplication`. On a slow phone
      // connection that second request is exactly the kind of avoidable
      // wait this page should not impose.
      setHub({ application: started.application, items: started.items, config: bundle.config });
      setPhase('running');
    } catch {
      setFormError(t('register.startError'));
    } finally {
      setStarting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="register-page">
        <p className="register-status">{t('register.loading')}</p>
      </div>
    );
  }

  if (phase === 'notFound' || !bundle) {
    return (
      <div className="register-page">
        <p className="register-status" role="alert">
          {t('register.notFound')}
        </p>
      </div>
    );
  }

  if (phase === 'invalidLink') {
    return (
      <div className="register-page">
        <p className="register-status" role="alert">
          {t('hub.invalidLink')}
        </p>
        <Link className="register-link" to="/request-link">
          {t('hub.requestNewLink')}
        </Link>
      </div>
    );
  }

  if (phase === 'email') {
    return (
      <div className="register-page">
        <header className="register-header">
          <h1>{bundle.tenant.name}</h1>
          {/* Read-only: the school year is derived server-side from the same
              July-rollover rule familyhub-backend's `_school_year_for_date`
              uses for the capacity snapshot below, so showing an editable
              field here could only disagree with it. */}
          <p className="register-school-year">
            {t('register.schoolYear')}: {defaultSchoolYear()}
          </p>
          {bundle.capacity.full && (
            <p className="register-full-notice" role="status">
              {t('register.schoolFull')}
            </p>
          )}
        </header>
        <form className="register-email-form" onSubmit={(e) => void onStart(e)} noValidate>
          {formError && (
            <p className="register-error" role="alert">
              {formError}
            </p>
          )}
          <label htmlFor="applicant-email">{t('register.emailLabel')}</label>
          <input
            id="applicant-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            disabled={starting}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="register-help">{t('register.emailHelp')}</p>
          <button type="submit" className="register-primary" disabled={starting}>
            {starting ? t('register.starting') : t('register.start')}
          </button>
        </form>
      </div>
    );
  }

  // phase === 'running'
  return (
    <div className="register-page">
      <header className="register-header">
        <h1>{bundle.tenant.name}</h1>
        <p className="register-school-year">
          {t('register.schoolYear')}: {defaultSchoolYear()}
        </p>
        {linkSent && (
          <p className="register-link-sent" role="status">
            {t('register.linkSent')}
          </p>
        )}
      </header>
      {runtimeError && (
        <p className="register-error" role="alert">
          {runtimeError}
        </p>
      )}
      {hub && (
        <FlowRenderer
          config={hub.config}
          mode="parent"
          locale={locale}
          schoolName={bundle.tenant.name}
          application={toApplicationSummary(hub.application)}
          items={toApplicationItems(hub.items)}
          values={parseDraft(hub.application)}
          onSaveDraft={async (values) => {
            try {
              await saveDraft(token, values);
              setRuntimeError(null);
            } catch (err) {
              setRuntimeError(t('register.saveError'));
              throw err;
            }
          }}
          onCompleteItem={async (itemId) => {
            try {
              await completeItem(token, itemId);
              await refreshHub();
              setRuntimeError(null);
            } catch (err) {
              setRuntimeError(t('hub.completeItemError'));
              throw err;
            }
          }}
          onUploadDocument={async (_blockId, _doc, file, itemId) => {
            if (!itemId) {
              setRuntimeError(t('hub.uploadFailed'));
              return;
            }
            try {
              await uploadDocumentFile(token, itemId, file);
              await refreshHub();
              setRuntimeError(null);
            } catch {
              setRuntimeError(t('hub.uploadFailed'));
            }
          }}
          onCheckout={async () => {
            // Payments are not part of Plan 1 -- the checkout facade route
            // was removed along with enrollx (Task 12); apexflow has no
            // checkout surface. `onCheckout` is a required FlowRenderer
            // prop, so it stays wired but inert: a `payment` block can no
            // longer be configured, so this should never actually fire.
            setRuntimeError(t('hub.payError'));
          }}
          onSubmit={async () => {
            try {
              await submitApplication(token);
              navigate(`/application/${token}`);
            } catch (err) {
              setRuntimeError(t('hub.submitError'));
              throw err;
            }
          }}
        />
      )}
      <p className="register-hub-link">
        <Link className="register-link" to={`/application/${token}`}>
          {t('register.openHub')}
        </Link>
      </p>
    </div>
  );
}
