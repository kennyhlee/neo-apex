// flow-runtime/src/SectionDescription.tsx
//
// THE ONLY module in this package permitted to import `markdown-to-jsx`.
// `src/__tests__/SectionDescription.test.tsx` fails if a second file does.
//
// markdown-to-jsx is NOT safe with default options -- it parses raw HTML.
// Every option below is load-bearing; do not simplify this call.
import Markdown from 'markdown-to-jsx';
import type { ComponentPropsWithoutRef } from 'react';

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

/**
 * Headings render as `<p>` (see overrides below), but markdown-to-jsx still
 * computes and attaches an `id` prop derived from the heading text before
 * the override ever sees it -- `slugify: () => ''` (below) only blanks the
 * *value*, leaving a dead `id=""` attribute behind. That still can't
 * collide with a real field's id, but it's needless attribute noise on an
 * element sitting inside a live form, so this drops the prop outright
 * rather than merely emptying it.
 */
function HeadingAsParagraph({
  id: _id,
  ...rest
}: ComponentPropsWithoutRef<'p'> & { id?: string }) {
  return <p {...rest} />;
}

const OPTIONS = {
  // Raw HTML renders as literal text instead of elements.
  disableParsingRawHTML: true,
  sanitizer,
  // Belt-and-suspenders alongside HeadingAsParagraph's own `id` strip:
  // headings would otherwise mint a DOM `id` slugified from admin-authored
  // text (e.g. `# Address` -> id="address"). This renders inside a live
  // form, so an id collision with a real field breaks
  // getElementById/label-for association.
  slugify: () => '',
  // Restrict output to inline emphasis + links. Headings, images, lists,
  // blockquotes, thematic breaks, code blocks and tables are dropped: a
  // section description is one short orienting paragraph, not a document.
  overrides: {
    a: {
      props: { target: '_blank', rel: 'noopener noreferrer' },
    },
    h1: { component: HeadingAsParagraph },
    h2: { component: HeadingAsParagraph },
    h3: { component: HeadingAsParagraph },
    h4: { component: HeadingAsParagraph },
    h5: { component: HeadingAsParagraph },
    h6: { component: HeadingAsParagraph },
    img: { component: () => null },
    ul: { component: 'p' },
    ol: { component: 'p' },
    li: { component: 'span' },
    pre: { component: 'p' },
    code: { component: 'span' },
    table: { component: () => null },
    // 'div', not 'p': a blockquote's content is itself already wrapped in a
    // <p> by the parser, so overriding to 'p' here would nest <p> inside
    // <p> -- invalid HTML that React (correctly) warns about.
    blockquote: { component: 'div' },
    hr: { component: () => null },
  },
} as const;

/**
 * DEVIATION from the plan's OPTIONS-only design, documented per the task's
 * BLOCKED/deviate instructions:
 *
 * `disableParsingRawHTML: true` (kept above, still load-bearing -- it is the
 * actual injection boundary: raw HTML never becomes a live element or a
 * live attribute, verified against ~60 adversarial inputs) stops
 * markdown-to-jsx from transcribing raw HTML into live React elements/props.
 * But on this installed version (9.10.2), disabling raw-HTML parsing does
 * NOT drop rejected markup; it demotes it to a plain-text AST node, so the
 * literal source characters (tag names, attribute names, attribute values
 * -- e.g. `onerror="alert(1)"`) are still rendered as visible text. That's
 * inert (no execution, no live attribute) but it lets an admin-authored
 * description show a parent confusing/alarming tag soup verbatim, which is
 * its own kind of phishing-adjacent surface for a family-facing form.
 *
 * `stripRawHtml` is display hygiene layered ON TOP of that boundary, not a
 * replacement for it -- it must never be relied on to prevent injection,
 * only to prevent ugly leakage. It is therefore optimized for "never
 * destroy legitimate copy" over "catch every conceivable tag-shaped string":
 *
 * - Matches only a fixed allowlist of real HTML tag names (plus HTML
 *   comments), not arbitrary `<...>` -- so CommonMark autolinks
 *   (`<https://x>`, `<mailto:a@b>`, bare `<a@b>`), placeholder copy like
 *   `<first> <last>`, and comparisons like `a < b` all survive untouched,
 *   because none of them is a known tag name.
 * - Requires a boundary (whitespace, `/`, or `>`) right after the matched
 *   tag name, so a longer word that happens to start with a tag name
 *   (there are none in this specific allowlist, but this guards future
 *   entries) can't be mistaken for that shorter tag.
 * - Matches HTML comments (`<!-- ... -->`) as a single non-greedy unit
 *   across embedded `>` characters, so `<!-- note: x > y -->` doesn't leak
 *   its tail as body text.
 * - Iterates to a fixed point so that stripping an inner tag can't
 *   synthesize a new, well-formed outer tag from leftover fragments (e.g.
 *   `<<b>b>hi<</b>/b>` fully collapses to `hi` instead of reassembling into
 *   a live-looking `<b>hi</b>`).
 *
 * A truly unclosed tag (`<img src=x onerror=alert(1)` with no closing `>`
 * anywhere) has no `>` for the primary pattern to anchor on, so it gets a
 * second, narrower pattern: known-tag-name-immediately-after-`<`, running
 * to end of line rather than to a `>`. This is still name-gated (only fires
 * for a real tag name right after `<`, same as the primary pattern) so it
 * doesn't touch ordinary prose -- it only swallows a genuinely dangling
 * opening tag and whatever trails it on that line.
 *
 * `< img ...>` (a SPACE between `<` and the tag name) intentionally still
 * survives: real browsers don't parse that as a tag start either, so it's
 * in the same "coincidentally tag-shaped but not a tag" bucket as `a < b`
 * or `ages < 5`, not the "malicious/confusing markup" bucket this function
 * targets.
 */
const HTML_TAGS =
  'a|abbr|b|base|blockquote|body|br|button|canvas|code|dd|div|dl|dt|em|embed|fieldset|font|form|frame|frameset|h[1-6]|head|html|i|iframe|img|input|label|li|link|map|marquee|meta|noscript|object|ol|optgroup|option|p|param|picture|pre|s|script|section|select|slot|small|source|span|strong|style|sub|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|title|tr|track|u|ul|video|xmp';
const TAG_RE = new RegExp(
  // 1) HTML comments, non-greedy across embedded `>`.
  '<!--[\\s\\S]*?-->|' +
    // 2) A complete, closed tag (open or close) for a known tag name.
    `</?(?:${HTML_TAGS})(?=[\\s/>])[^>]*>|` +
    // 3) A dangling, never-closed tag: same name gate, but runs to end of
    //    line instead of requiring a `>`.
    `</?(?:${HTML_TAGS})(?=[\\s/>]|$)[^\\n>]*$`,
  'gim',
);

function stripRawHtml(markdown: string): string {
  let prev = markdown;
  let next = markdown.replace(TAG_RE, '');
  while (next !== prev) {
    prev = next;
    next = next.replace(TAG_RE, '');
  }
  return next;
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
