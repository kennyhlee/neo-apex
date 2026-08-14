// Catches render errors below it and shows a plain apology, instead of
// letting React unmount the whole root.
//
// Why this exists: there was no boundary anywhere in this app, so ANY throw
// during render produced a blank white page with no in-app indication of
// what happened. A duplicate-React bug hid behind exactly this gap for an
// entire debugging session in a sibling app (apexflow) — the error was in
// the browser console the whole time and nothing surfaced it.
//
// Deliberately a CLASS component: `getDerivedStateFromError` has no hook
// equivalent, and React offers no functional error-boundary API.
//
// This app's users are parents, mid-registration or checking on their
// application. Unlike admindash/apexflow's copy of this component, it
// deliberately does NOT render the error message, stack, or a copy button —
// a stack trace is alarming and useless to a parent. It shows an apology and
// a "Try again" button only. `componentDidCatch`'s `console.error` is kept
// regardless: it costs the parent nothing, and it's how a developer
// diagnoses a report.
import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error. Pass the current location so
   * navigating away recovers, instead of leaving a sticky error panel that
   * outlives the route that produced it. */
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
   * here is effectively `any`. Kept for parity with the other apps' state
   * shape even though this variant never displays it. */
  error: unknown;
}

/** The visible panel. Split out as a function component so it can use
 * hooks — the boundary itself cannot, being a class. No error message, no
 * stack, no copy button: see the file header for why. */
function ErrorPanel() {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus onto the panel when it mounts. `role="alert"` announces it to
  // screen readers, but a sighted keyboard user has no other way to reach a
  // panel that just replaced the entire routed content area.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="error-boundary" role="alert" tabIndex={-1} ref={panelRef}>
      <h2 className="error-boundary-title">{t('errorBoundary.title')}</h2>
      <p className="error-boundary-body">{t('errorBoundary.body')}</p>
      <div className="error-boundary-actions">
        <button
          type="button"
          className="error-boundary-reload"
          onClick={() => window.location.reload()}
        >
          {t('errorBoundary.reload')}
        </button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    // `hasError` is set unconditionally — see the state field's comment for
    // why this can't be inferred from `error` itself.
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Kept even though nothing renders the stack: the console is still
    // where a developer looks first when a parent reports "the page broke".
    console.error('Unhandled render error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPanel />;
    }
    return this.props.children;
  }
}

/** `ErrorBoundary` wired to the router, so navigating away clears the error.
 * Must be rendered INSIDE the router — `useLocation` throws otherwise. */
export function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
