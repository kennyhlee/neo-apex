// Every `var(--x)` in the app's CSS must name a custom property something
// actually defines.
//
// This exists because it caught a real one: `FlowCard.css` referenced
// `--border-default`, which does not exist — the compatibility block in
// theme.css defines `--border-primary`. An undefined custom property with no
// fallback resolves to nothing, so `border: 1px solid var(--border-default)`
// silently draws NO BORDER. Nothing fails, nothing warns, and the only
// symptom is a component that looks slightly wrong in a screenshot.
//
// The stylesheets are pulled in through Vite's `?raw` glob rather than
// `node:fs`. That keeps this test out of Node's type space: `tsconfig.app`
// includes `src`, so importing `node:fs` here would fail `tsc -b` (which
// `npm run build` runs) unless `@types/node` were added — and adding it
// would put Node globals into the whole app's types, where `setTimeout`
// quietly starts returning a `NodeJS.Timeout`.
import { describe, expect, it } from 'vitest';

// The two layers that DEFINE tokens, in cascade order (see theme.css's
// header): the shared suite layer, then this app's overrides.
import sharedTokens from '../../../../../ui-tokens/tokens.css?raw';
import themeTokens from '../theme.css?raw';

// Every stylesheet that CONSUMES them.
const stylesheets = import.meta.glob('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Names defined as `--x:` in the given sources. */
function definedNames(...sources: string[]): Set<string> {
  const names = new Set<string>();
  for (const css of sources) {
    for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1]);
  }
  return names;
}

/** `var(--x)` and `var(--x, fallback)`. A reference WITH a fallback is still
 * checked: a fallback is a deliberate default, not a licence to name a token
 * that does not exist, and `var(--typo, var(--also-typo))` is the shape that
 * hides this bug best. */
function referencedNames(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
}

const globallyDefined = definedNames(sharedTokens, themeTokens);

describe('CSS custom properties', () => {
  it('found the stylesheets at all', () => {
    expect(Object.keys(stylesheets).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(stylesheets))('%s references only tokens that exist', (_file, css) => {
    // A stylesheet may define its own and read them back — FlowView.css sets
    // `--flow-stroke` on its `who` classes for the rules beneath to use — so
    // local definitions count as available to that file.
    const available = new Set([...globallyDefined, ...definedNames(css)]);
    const missing = [...new Set(referencedNames(css))].filter((n) => !available.has(n));
    expect(missing).toEqual([]);
  });

  it('actually knows some tokens (the audit is not vacuous)', () => {
    expect(globallyDefined.has('--border-primary')).toBe(true);
    expect(globallyDefined.has('--accent')).toBe(true);
    // And the one that started this:
    expect(globallyDefined.has('--border-default')).toBe(false);
  });
});
