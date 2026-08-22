// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Markdown } from '../Markdown.tsx';

afterEach(cleanup);

const DIAGRAM = ['┌──────────┐', '│ Draft    │', '└────┬─────┘', '     │ submit', '     ▼'].join(
  '\n',
);

describe('Markdown fenced blocks', () => {
  it('renders a fence as a single <pre>, not as paragraphs', () => {
    const { container } = render(<Markdown text={'```\n' + DIAGRAM + '\n```'} />);
    const pres = container.querySelectorAll('pre.md-pre');
    expect(pres).toHaveLength(1);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  // The original defect, asserted directly: a blank line inside the drawing
  // used to split it into unrelated paragraphs.
  it('keeps a diagram with blank lines in ONE block', () => {
    const withGap = '```\n' + DIAGRAM + '\n\n' + DIAGRAM + '\n```';
    const { container } = render(<Markdown text={withGap} />);
    expect(container.querySelectorAll('pre.md-pre')).toHaveLength(1);
    expect(container.querySelector('pre.md-pre')?.textContent).toContain('\n\n');
  });

  // The other half: runs of spaces used to collapse in the proportional font.
  it('preserves every space exactly', () => {
    const { container } = render(<Markdown text={'```\n' + DIAGRAM + '\n```'} />);
    expect(container.querySelector('pre.md-pre code')?.textContent).toBe(DIAGRAM);
  });

  it('does not apply inline markup inside a fence', () => {
    const { container } = render(<Markdown text={'```\n**not bold** and `not code`\n```'} />);
    expect(container.querySelectorAll('strong')).toHaveLength(0);
    expect(container.querySelector('pre.md-pre code')?.textContent).toBe(
      '**not bold** and `not code`',
    );
  });

  it('still renders prose around the fence', () => {
    const { container } = render(
      <Markdown text={'Here is the flow:\n\n```\n' + DIAGRAM + '\n```\n\nAsk me to change it.'} />,
    );
    expect(container.querySelectorAll('pre.md-pre')).toHaveLength(1);
    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['Here is the flow:', 'Ask me to change it.']);
  });

  it('renders a half-streamed fence as code', () => {
    const { container } = render(<Markdown text={'Here:\n```\n┌───┐\n│ Dr'} />);
    expect(container.querySelectorAll('pre.md-pre')).toHaveLength(1);
    expect(container.querySelector('pre.md-pre code')?.textContent).toBe('┌───┐\n│ Dr');
  });

  it('leaves ordinary markdown untouched', () => {
    const { container } = render(
      <Markdown text={'### Heading\n\n- one\n- two\n\nSome **bold** text.'} />,
    );
    // Headings are demoted two levels on purpose — an `###` inside a chat
    // bubble is an h5, so it does not outrank the page's own headings.
    expect(container.querySelector('h5')?.textContent).toBe('Heading');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelectorAll('pre')).toHaveLength(0);
  });

  it('still renders a 2-column table as a key/value list', () => {
    const { container } = render(<Markdown text={'| a | b |\n| --- | --- |\n| 1 | 2 |'} />);
    expect(container.querySelector('.md-kv')).toBeTruthy();
  });

  // Keys are drawn from ONE counter across both segment kinds. A per-map
  // index collides between the prose and code branches, and React answers a
  // duplicate key with a console warning rather than a thrown error — so
  // asserting on the rendered output alone cannot see it. Watch the warning.
  it('gives every rendered child a distinct key', () => {
    const warnings: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const { container } = render(<Markdown text={'a\n\nb\n\n```\nx\n```\n\nc\n\nd'} />);
      expect(container.querySelectorAll('p')).toHaveLength(4);
      expect(container.querySelectorAll('pre.md-pre')).toHaveLength(1);
    } finally {
      console.error = original;
    }
    const keyWarnings = warnings.filter((args) => String(args[0]).includes('key'));
    expect(keyWarnings).toEqual([]);
  });
});
