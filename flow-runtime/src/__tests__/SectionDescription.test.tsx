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

  it('drops headings, images, and lists', () => {
    const out = html('# Heading\n\n![img](https://x.example.com/a.png)\n\n- one\n- two');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<ul');
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
