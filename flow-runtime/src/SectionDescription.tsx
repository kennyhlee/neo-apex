// flow-runtime/src/SectionDescription.tsx
//
// THE ONLY module in this package permitted to import `markdown-to-jsx`.
// `src/__tests__/SectionDescription.test.tsx` fails if a second file does.
//
// markdown-to-jsx is NOT safe with default options -- it parses raw HTML.
// Every option below is load-bearing; do not simplify this call.
import Markdown from 'markdown-to-jsx';

/** Positive allowlist. An unlisted scheme is not rendered as a link at all. */
const ALLOWED_SCHEMES = ['http://', 'https://', 'mailto:'];

/**
 * Replaces markdown-to-jsx's built-in sanitizer, which is a DENY-list
 * (`javascript:`/`vbscript:`/non-image `data:`) and deliberately permits
 * `data:image/svg+xml` -- a URL the library's own docs note can execute
 * script if opened as a top-level navigation. An allowlist closes that.
 *
 * Returning null makes markdown-to-jsx drop the attribute, so the anchor
 * degrades to plain text rather than becoming a live bad link.
 */
function sanitizer(value: string, _tag: string, _attr: string): string | null {
  const v = value.trim().toLowerCase();
  return ALLOWED_SCHEMES.some((s) => v.startsWith(s)) ? value : null;
}

const OPTIONS = {
  // Raw HTML renders as literal text instead of elements.
  disableParsingRawHTML: true,
  sanitizer,
  // Restrict output to inline emphasis + links. Headings, images, lists,
  // code blocks and tables are dropped: a section description is one short
  // orienting paragraph, not a document.
  overrides: {
    a: {
      props: { target: '_blank', rel: 'noopener noreferrer' },
    },
    h1: { component: 'p' },
    h2: { component: 'p' },
    h3: { component: 'p' },
    h4: { component: 'p' },
    h5: { component: 'p' },
    h6: { component: 'p' },
    img: { component: () => null },
    ul: { component: 'p' },
    ol: { component: 'p' },
    li: { component: 'span' },
    pre: { component: 'p' },
    code: { component: 'span' },
    table: { component: () => null },
  },
} as const;

/**
 * DEVIATION from the plan's OPTIONS-only design, documented per the task's
 * BLOCKED/deviate instructions:
 *
 * `disableParsingRawHTML: true` (kept above, still load-bearing) stops
 * markdown-to-jsx from transcribing raw HTML into live React elements/props
 * -- that's the actual injection boundary. But on this installed version
 * (9.10.2), disabling raw-HTML parsing does NOT drop the raw markup; it
 * demotes it to a plain text AST node, so the literal source characters
 * (tag names, attribute names, attribute values -- e.g. `onerror="alert(1)"`)
 * are still rendered as visible text content. That's inert (no execution,
 * no live attribute), but it lets an admin-authored description show a
 * parent confusing/alarming tag soup verbatim, which is its own kind of
 * phishing-adjacent surface for a family-facing form. There is no
 * documented markdown-to-jsx option that drops rejected raw HTML instead of
 * echoing it as text, so this strips anything shaped like an HTML/XML tag
 * from the input before it ever reaches the compiler. This runs in addition
 * to, not instead of, `disableParsingRawHTML`.
 */
function stripRawHtml(markdown: string): string {
  return markdown.replace(/<\/?[a-zA-Z!][^>]*>/g, '');
}

export interface SectionDescriptionProps {
  markdown: string | undefined;
}

/** A section's authored description. Renders nothing when blank. */
export function SectionDescription({ markdown }: SectionDescriptionProps) {
  const text = (markdown ?? '').trim();
  if (text === '') return null;
  return (
    <div className="fr-section-desc">
      <Markdown options={OPTIONS}>{stripRawHtml(text)}</Markdown>
    </div>
  );
}
