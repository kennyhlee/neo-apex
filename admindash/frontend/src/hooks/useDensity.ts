import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'admindash_density';

export type Density = 'comfortable' | 'compact';

function getInitialDensity(): Density {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'compact' ? 'compact' : 'comfortable';
}

let globalDensity: Density = getInitialDensity();
const listeners = new Set<() => void>();

/** Applied on module load so the first paint is already at the right density. */
function apply(density: Density) {
  document.documentElement.dataset.density = density;
}
apply(globalDensity);

/**
 * Interface density, persisted per browser.
 *
 * `comfortable` is the default and serves teachers and front-desk staff.
 * `compact` is the registrar's grid — 34px rows, tabular numerals, tighter
 * controls. Both read from the same components; only the density tokens in
 * theme.css differ, so there is no second component set to maintain.
 */
export function useDensity() {
  const [density, setState] = useState<Density>(globalDensity);

  useEffect(() => {
    const handler = () => setState(globalDensity);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const setDensity = useCallback((next: Density) => {
    globalDensity = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    listeners.forEach((fn) => fn());
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(globalDensity === 'compact' ? 'comfortable' : 'compact');
  }, [setDensity]);

  return { density, setDensity, toggleDensity };
}

export default useDensity;
