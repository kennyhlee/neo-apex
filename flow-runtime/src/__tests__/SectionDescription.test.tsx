import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SectionDescription } from '../SectionDescription';

function html(markdown: string): string {
  return render(<SectionDescription markdown={markdown} />).container.innerHTML;
}

describe('SectionDescription rendering', () => {
  it('renders nothing for blank input', () => {
    expect(html('')).toBe('');
    expect(html('   ')).toBe('');
  });

  it('renders bold and italic', () => {
    expect(html('Tell us about your **child**.')).toContain('<strong>child</strong>');
    expect(html('Tell us about your *child*.')).toContain('<em>child</em>');
  });

  it('renders an allowed link with safe rel/target', () => {
    const out = html('[handbook](https://school.example.com/h.pdf)');
    expect(out).toContain('href="https://school.example.com/h.pdf"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('allows http and mailto', () => {
    expect(html('[a](http://x.example.com)')).toContain('href="http://x.example.com"');
    expect(html('[b](mailto:office@x.example.com)')).toContain('href="mailto:office@x.example.com"');
  });

  it('renders CommonMark autolinks as live anchors instead of deleting them', () => {
    // These are exactly what a school office types, and the naive
    // "strip anything shaped like <...>" first pass silently deleted them.
    expect(html('See <https://school.example.com> for details.')).toContain(
      'href="https://school.example.com"',
    );
    expect(html('Email <mailto:office@school.example.com> anytime.')).toContain(
      'href="mailto:office@school.example.com"',
    );
    expect(html('Email <office@school.example.com> anytime.')).toContain(
      'href="mailto:office@school.example.com"',
    );
  });

  it('leaves ordinary angle-bracket copy that is not a real tag untouched', () => {
    expect(html('Use format <first> <last> on the form.')).toContain(
      'Use format &lt;first&gt; &lt;last&gt; on the form.',
    );
    expect(html('Compare: a < b.')).toContain('Compare: a &lt; b.');
  });

  it('leaves a bare tag name with no attribute-like content after it untouched', () => {
    // A tag NAME alone (no `=`, no immediate close) is exactly what a
    // school writes as a fill-in-the-blank placeholder, not markup.
    expect(html('Write a title like <title of your book> here.')).toContain(
      '&lt;title of your book&gt;',
    );
    // "b" is a real tag name, but with nothing after it that looks like
    // markup, `a<b` must survive rather than being truncated to `a`.
    expect(html('Compare using a<b notation.')).toContain('a&lt;b notation');
  });

  it('renders survivable content, not just an absence of stripped markup', () => {
    // Positive/survival checks, not just `not.toContain`: a mutation that
    // makes an override or the stripper swallow everything must fail these,
    // even though it could still pass every `not.toContain` assertion above.
    expect(html('> Please read carefully.')).toContain('Please read carefully');
    expect(html('# Address')).toContain('Address');
    expect(
      html(
        'Please read the attached handbook.\n<img src=x onerror=alert(1)\nContact the office with questions.',
      ),
    ).toContain('Please read the attached handbook.');
    expect(
      html(
        'Please read the attached handbook.\n<img src=x onerror=alert(1)\nContact the office with questions.',
      ),
    ).toContain('Contact the office with questions.');
    expect(html('See <https://school.example.com> for details.')).toContain('for details');
  });
});

describe('SectionDescription safety', () => {
  it('renders raw HTML as literal text, not elements', () => {
    const out = html('<img src=x onerror="alert(1)"> and <b>bold</b>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<b>');
  });

  it('drops disallowed link schemes rather than rendering an anchor', () => {
    for (const bad of [
      '[x](javascript:alert(1))',
      '[x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
      '[x](vbscript:msgbox(1))',
      '[x](ftp://files.example.com/a)',
    ]) {
      const out = html(bad);
      // The real property is "no live link", so assert on href rather than
      // on the tag: an <a> with no href is inert, an <a href="javascript:">
      // is not.
      expect(out, bad).not.toContain('href');
      expect(out, bad).toContain('x');   // link TEXT survives as plain text
    }
  });

  it('is case-insensitive about schemes', () => {
    expect(html('[x](JaVaScRiPt:alert(1))')).not.toContain('href');
  });

  it('drops headings and images', () => {
    const out = html('# Heading\n\n![img](https://x.example.com/a.png)');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<img');
  });

  it('flattens lists to one item per line rather than dropping them or running items together', () => {
    // `- one\n- two\n- three` used to render as the unreadable concatenation
    // "onetwothree" (li -> span, no separator) -- exactly the bug this
    // guards against. Assert the negative explicitly: a test that only
    // checked the items were present would pass in both the broken and the
    // fixed world.
    const out = html('- one\n- two\n- three');
    expect(out).not.toContain('<ul');
    expect(out).not.toContain('<li');
    expect(out).not.toContain('onetwothree');
    expect(out).toContain('<div>one</div>');
    expect(out).toContain('<div>two</div>');
    expect(out).toContain('<div>three</div>');
  });

  it('never mints a heading id, even though headings render as <p>', () => {
    // A heading-derived id (e.g. # Address -> id="address") can collide
    // with a real form field's id in the surrounding page and break
    // getElementById / <label for> association.
    const out = html('# Address');
    expect(out).not.toContain('id=');
  });

  it('drops blockquotes and thematic breaks (spec: inline emphasis + links only)', () => {
    expect(html('> Please read carefully.')).not.toContain('<blockquote');
    expect(html('Above\n\n---\n\nBelow')).not.toContain('<hr');
  });

  it('does not leak an attribute name from a truly unclosed tag', () => {
    // No closing `>` anywhere in the input -- disableParsingRawHTML alone
    // renders this as inert but VISIBLE text, which is confusing/
    // phishing-adjacent copy on a parent-facing form.
    const out = html('<img src=x onerror=alert(1)');
    expect(out).not.toContain('onerror');
  });

  it('does not leak an HTML comment body, even one containing ">"', () => {
    const out = html('Fees <!-- internal: fee > $50, do not show --> apply.');
    expect(out).not.toContain('internal');
    expect(out).not.toContain('$50');
    expect(out).toContain('Fees');
    expect(out).toContain('apply');
  });

  it('never emits a stray start="" attribute, and keeps ordered-list items on separate lines', () => {
    const out = html('1. one\n2. two');
    expect(out).not.toContain('start=');
    // Items land as their own <div> (li -> div), not run together the way
    // span-based items used to.
    expect(out).toContain('<div>one</div>');
    expect(out).toContain('<div>two</div>');
    expect(out).not.toContain('onetwo');
  });

  it('drops footnote markers and definitions rather than leaking a landmark and a dead anchor', () => {
    const out = html('text[^1]\n\n[^1]: note');
    expect(out).not.toContain('<footer');
    expect(out).not.toContain('<sup');
    expect(out).not.toContain('note');
    expect(out).toContain('text');
  });
});

// --- structural guards: these are the enforcement mechanism, not decoration.
//
// `__tests__` is EXCLUDED from the walk on purpose: this very file contains
// the literal strings being searched for, so including it would make both
// guards match themselves and fail no matter what the source does.
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      out.push(...sourceFiles(join(dir, e.name)));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

describe('markdown containment', () => {
  const files = sourceFiles(join(__dirname, '..'));

  it('walks a non-trivial set of source files', () => {
    // Guards the guards: an empty list would make both checks below pass
    // vacuously if the walk ever broke.
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports markdown-to-jsx in exactly one file', () => {
    const importers = files.filter((f) => readFileSync(f, 'utf8').includes('markdown-to-jsx'));
    expect(importers.map((f) => f.split('/').pop())).toEqual(['SectionDescription.tsx']);
  });

  it('never uses dangerouslySetInnerHTML anywhere in src', () => {
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'),
    );
    expect(offenders).toEqual([]);
  });
});
