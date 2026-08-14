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
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { Button } from './ui/Button.tsx';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error. Pass the current location so
   * navigating away recovers, instead of leaving a sticky error panel that
   * outlives the route that produced it. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/** The visible panel. Split out as a function component so it can use
 * hooks — the boundary itself cannot, being a class. */
function ErrorPanel({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const { t } = useTranslation();
  const details = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\n${componentStack ?? ''}`;

  return (
    <div className="error-boundary" role="alert">
      <h2 className="error-boundary-title">{t('errorBoundary.title')}</h2>
      <p className="error-boundary-body">{t('errorBoundary.body')}</p>

      <pre className="error-boundary-message">{error.message || error.name}</pre>

      {componentStack ? (
        <details className="error-boundary-details">
          <summary>{t('errorBoundary.showStack')}</summary>
          <pre>{componentStack}</pre>
        </details>
      ) : null}

      <div className="error-boundary-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(details)}
        >
          {t('errorBoundary.copy')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
          {t('errorBoundary.reload')}
        </Button>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept: the console is still where a developer looks first, and this
    // preserves the stack React would otherwise swallow once caught.
    console.error('Unhandled render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null });
    }
  }

  render() {
    if (this.state.error) {
      return <ErrorPanel error={this.state.error} componentStack={this.state.componentStack} />;
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
