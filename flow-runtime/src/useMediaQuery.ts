// flow-runtime/src/useMediaQuery.ts
import { useEffect, useState } from 'react';

/**
 * Live viewport query. Subscribes rather than reading once at mount, so a
 * resize (or a rotated tablet) switches layout instead of stranding staff in
 * the wrong one.
 *
 * Guarded against `window.matchMedia` being absent (jsdom in tests does not
 * implement it) -- both the initial read and the effect no-op in that case
 * rather than throwing, so a component using this hook is testable without
 * every test having to stub the browser API first.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
