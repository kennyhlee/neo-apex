// Catches render errors below it and shows them, instead of letting React
// unmount the whole root.
//
// Why this exists: there was no boundary anywhere in this app, so ANY throw
// during render produced a blank white page with no in-app indication of
// what happened. A duplicate-React bug (fixed in 7861f80) hid behind that
// for an entire debugging session — the error was in the browser console the
// whole time and nothing surfaced it.
//
// Deliberately a CLASS component: `getDerivedStateFromError` has no hook
// equivalent, and React offers no functional error-boundary API.
//
// It renders the error text on purpose. This is an internal staff tool
// behind auth, and the message IS the diagnosis. FamilyHub's copy of this
// component deliberately does NOT — its users are parents.
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { Button } from './ui/Button.tsx';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error. Pass `location.key`, not
   * `location.pathname` — `key` is unique per history entry, so it changes
   * on any navigation, including `replace` and query-only changes, where
   * `pathname` would stay put and leave a sticky error panel that outlives
   * the route that produced it (a sibling app, admindash, drives real view
   * state through the query string, which is exactly the case `pathname`
   * misses). */
  resetKey?: string;
}

interface ErrorBoundaryState {
  /** Whether a render error is currently caught. Tracked separately from
   * `error` on purpose: `error` can legitimately be `null`/`undefined`/`0`/`''`
   * — JS lets you `throw` any value, not just an `Error` — and gating
   * `render()` on `error`'s truthiness would fall through to re-rendering
   * `children` for exactly those throws, remounting the still-broken
   * subtree every commit. `hasError` is set unconditionally in
   * `getDerivedStateFromError`, so it stays true regardless of what was
   * thrown. Don't "simplify" this back to a truthiness check on `error`. */
  hasError: boolean;
  /** The raw thrown value. Not necessarily an `Error` — React's own typing
   * here is effectively `any`. Normalize at the point of display, not here. */
  error: unknown;
  componentStack: string | null;
}

/** True when `value` looks like a real `Error` (has the shape we render
 * specially). Narrows an `unknown` thrown value so the panel never touches
 * `.message`/`.stack` on a non-Error. Render errors from React are always
 * real `Error`s, but `throw` accepts anything. */
function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

/** The visible panel. Split out as a function component so it can use
 * hooks — the boundary itself cannot, being a class. */
function ErrorPanel({ error, componentStack }: { error: unknown; componentStack: string | null }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus onto the panel when it mounts. `role="alert"` announces it to
  // screen readers, but a sighted keyboard user has no other way to reach a
  // panel that just replaced the entire routed content area.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const displayMessage = isErrorLike(error) ? error.message || error.name : String(error);
  const details = isErrorLike(error)
    ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\n${componentStack ?? ''}`
    : `${displayMessage}\n\n${componentStack ?? ''}`;

  const handleCopy = () => {
    const result = navigator.clipboard?.writeText(details);
    if (!result) {
      // No Clipboard API (e.g. insecure context) — nothing to await.
      setCopyState('failed');
      return;
    }
    result
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'));
  };

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyLabel =
    copyState === 'copied'
      ? t('errorBoundary.copied')
      : copyState === 'failed'
        ? t('errorBoundary.copyFailed')
        : t('errorBoundary.copy');

  return (
    <div className="error-boundary" role="alert" tabIndex={-1} ref={panelRef}>
      <h2 className="error-boundary-title">{t('errorBoundary.title')}</h2>
      <p className="error-boundary-body">{t('errorBoundary.body')}</p>

      <pre className="error-boundary-message">{displayMessage}</pre>

      {componentStack ? (
        <details className="error-boundary-details">
          <summary>{t('errorBoundary.showStack')}</summary>
          <pre>{componentStack}</pre>
        </details>
      ) : null}

      <div className="error-boundary-actions">
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          {copyLabel}
        </Button>
        <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    // `hasError` is set unconditionally — see the state field's comment for
    // why this can't be inferred from `error` itself.
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Kept: the console is still where a developer looks first, and this
    // preserves the stack React would otherwise swallow once caught.
    console.error('Unhandled render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, componentStack: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPanel error={this.state.error} componentStack={this.state.componentStack} />;
    }
    return this.props.children;
  }
}

/** `ErrorBoundary` wired to the router, so navigating away clears the error.
 * Must be rendered INSIDE the router — `useLocation` throws otherwise. */
export function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.key}>{children}</ErrorBoundary>;
}
