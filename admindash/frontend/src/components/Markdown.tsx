import type { CSSProperties, ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer for chat messages. Produces React nodes
 * directly (never dangerouslySetInnerHTML), so untrusted model output cannot
 * inject HTML. Supports the subset LLMs commonly emit: paragraphs, single-line
 * breaks, unordered/ordered lists, ATX headings, GFM tables, and inline
 * **bold**, *italic*, `code`. Not a full CommonMark implementation — small.
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

type Align = 'left' | 'center' | 'right' | undefined;

/** Split a table row into trimmed cells, tolerating optional leading/trailing `|`. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** True if the line is a GFM separator row like `| --- | :--: | ---: |`. */
function isTableSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function parseAligns(sep: string): Align[] {
  return splitRow(sep).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return undefined;
  });
}

function alignStyle(a: Align): CSSProperties | undefined {
  return a ? { textAlign: a } : undefined;
}

function renderBlock(block: string, key: number): ReactNode {
  const lines = block.split('\n');

  // GFM table: header row, a |---|---| separator, then data rows.
  if (lines.length >= 2 && lines[0].includes('|') && isTableSeparator(lines[1])) {
    const aligns = parseAligns(lines[1]);
    const cols = aligns.length;
    let header = splitRow(lines[0]);
    // Models sometimes run prose straight into the header with no line break
    // ("…grade level.| A | B |"). The separator fixes the column count, so any
    // extra leading header cells are prose — peel them off and show above.
    let lead: string | null = null;
    if (header.length > cols) {
      lead = header.slice(0, header.length - cols).join(' | ').trim();
      header = header.slice(header.length - cols);
    }
    const rows = lines.slice(2).filter((l) => l.trim() !== '').map(splitRow);
    const table = (
      <table className="md-table">
        <thead>
          <tr>
            {header.map((c, i) => (
              <th key={i} style={alignStyle(aligns[i])}>{renderInline(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((c, i) => (
                <td key={i} style={alignStyle(aligns[i])}>{renderInline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
    if (lead) {
      return (
        <div key={key}>
          <p>{renderInline(lead)}</p>
          {table}
        </div>
      );
    }
    return <div key={key}>{table}</div>;
  }

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
