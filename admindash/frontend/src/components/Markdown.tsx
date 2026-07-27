import type { ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer for chat messages. Produces React nodes
 * directly (never dangerouslySetInnerHTML), so untrusted model output cannot
 * inject HTML. Supports the subset LLMs commonly emit: paragraphs, single-line
 * breaks, unordered/ordered lists, ATX headings, and inline **bold**, *italic*,
 * `code`. Not a full CommonMark implementation — intentionally small.
 */

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlock(block: string, key: number): ReactNode {
  const lines = block.split('\n');

  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul key={key}>
        {lines.map((l, i) => (
          <li key={i}>{renderInline(l.replace(/^\s*[-*]\s+/, ''))}</li>
        ))}
      </ul>
    );
  }

  if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
    return (
      <ol key={key}>
        {lines.map((l, i) => (
          <li key={i}>{renderInline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
        ))}
      </ol>
    );
  }

  if (lines.length === 1) {
    const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (h) {
      const Tag = (['h3', 'h4', 'h5'][h[1].length - 1] ?? 'h5') as 'h3' | 'h4' | 'h5';
      return <Tag key={key}>{renderInline(h[2])}</Tag>;
    }
  }

  return (
    <p key={key}>
      {lines.map((l, i) => (
        <span key={i}>
          {renderInline(l)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== '');
  return <div className="markdown">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
