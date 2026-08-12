// workflow-forms/src/SectionDescription.tsx
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

/**
 * Ordered lists render as `<div>` (see overrides below -- a block element,
 * because its `li` children now render as `<div>` too, see `li`'s comment),
 * but markdown-to-jsx still attaches the list's `start` prop (its first
 * item number) before the override ever sees it. `start` is a real HTML
 * attribute name, so even on a `<div>` it would render as inert but
 * meaningless attribute noise (`<div start="1">`) on an element sitting
 * inside a live form. Drop it the same way `HeadingAsParagraph` drops a
 * heading's `id`.
 */
function OrderedListAsDiv({
  start: _start,
  ...rest
}: ComponentPropsWithoutRef<'div'> & { start?: number }) {
  return <div {...rest} />;
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
  // Restrict output to inline emphasis + links, plus flattened lists (see
  // `li` below). Headings, images, blockquotes, thematic breaks, code
  // blocks and tables are dropped: a section description is one short
  // orienting paragraph, not a document.
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
    // 'div', not 'p': `li` (below) now renders each item as a `<div>` --
    // a block element -- and a `<p>` cannot validly contain block children
    // (React warns "In HTML, <div> cannot be a descendant of <p>"). Same
    // p-in-p-avoidance reasoning `blockquote` already uses below, just for
    // div-in-p instead.
    ul: { component: 'div' },
    ol: { component: OrderedListAsDiv },
    // 'div', not 'span': a bulleted/numbered list ("what to bring", "who
    // counts as an emergency contact") is exactly the kind of thing a
    // school actually types into a description. `span` ran every item
    // together with no separator at all (`- one\n- two\n- three` ->
    // "onetwothree", unreadable, with no warning to the admin who wrote
    // it). `div` is a block element, so each item lands on its own line --
    // lists render FLATTENED (no bullet/number glyphs, each item its own
    // line) rather than dropped, consistent with the "one short orienting
    // paragraph" intent above. No security implication: `stripRawHtml` and
    // `sanitizer` are untouched by this override.
    li: { component: 'div' },
    pre: { component: 'p' },
    code: { component: 'span' },
    table: { component: () => null },
    // 'div', not 'p': a blockquote's content is itself already wrapped in a
    // <p> by the parser, so overriding to 'p' here would nest <p> inside
    // <p> -- invalid HTML that React (correctly) warns about.
    blockquote: { component: 'div' },
    hr: { component: () => null },
    // Footnotes (`text[^1]` / `[^1]: note`) are GFM, not part of the
    // "inline emphasis + links only" surface this component allows -- but
    // there is no single `footnote`/`footnoteReference` override key that
    // suppresses them (verified empirically: markdown-to-jsx 9.10.2 renders
    // the reference marker via the plain `sup` tag inside an `a`, and the
    // definition via a `footer` landmark wrapping a `div`, not via any
    // RuleType-named override). Nulling those two real tag overrides is
    // what actually removes both: the reference marker (`<sup>1</sup>`,
    // inside an `<a>` already left href-less by `sanitizer` since "#1"
    // matches no allowed scheme) and the `<footer><div id="">...</div>
    // </footer>` block, so no footnote landmark or dead anchor reaches a
    // parent-facing form.
    sup: { component: () => null },
    footer: { component: () => null },
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
 * only to prevent ugly leakage. Two earlier designs got the tradeoff wrong
 * in opposite directions:
 *
 *   1. "Strip anything shaped like `<...>`" deleted real content: CommonMark
 *      autolinks (`<https://x>`), placeholder copy (`<first> <last>`), and
 *      a heading-name allowlist even ate word placeholders like
 *      `<form name>` or `<title of your book>` because a bare tag NAME
 *      match was treated as sufficient.
 *   2. Gating on tag name plus "runs to end of line if unclosed" fixed the
 *      onerror-leak case but introduced silent truncation of ordinary
 *      copy: `a<b` (a real tag name, "b", immediately after `<`) rendered
 *      as just `a`.
 *
 * The actual signal that something is markup -- as opposed to a stray `<`
 * that happens to be followed by a real tag name -- is not "starts with a
 * tag name" but "starts with a tag name AND has attribute-like content
 * after it". A name alone (`<title of your book>`, `<form name>`) is
 * exactly what a school types as a fill-in-the-blank placeholder and must
 * survive. A name followed by `=` (an attribute) or by an immediate `>` or
 * `/>` (a real empty/self-closing tag) is what the library's own raw-HTML
 * grammar would recognize as a tag, closed or not:
 *
 * - Matches only a fixed allowlist of real HTML tag names (plus HTML
 *   comments), not arbitrary `<...>` -- so autolinks, placeholders, and
 *   comparisons that don't spell a tag name at all (`<https:...>`,
 *   `a < b`, `ages < 5`) never enter the tag-shaped branches to begin with.
 * - Within that allowlist, only strips when the name is immediately
 *   followed by a real delimiter (`(?=[\s/>])`) AND either (a) closes
 *   immediately (`<b>`, `<br/>`, `</b>`) or (b) contains a literal `=`
 *   before its terminator (`<img src=x ...>`, unclosed or not). A bare
 *   name with plain words after it (`<title of your book>`, `<form
 *   name>`, `<section 2>`) matches neither shape and survives -- this is
 *   what fixes `a<b` (no `=`, no immediate close -> untouched) without
 *   reintroducing the placeholder-deletion problem from design #1.
 * - The `=`-bearing branch's terminator is `(?:>|$)`, not just `>` --
 *   closed and never-closed attribute-bearing tags share ONE pattern, so
 *   `<img src=x onerror=alert(1)>` and the same string with no trailing
 *   `>` both match, without a separate end-of-line-only rule. `< img
 *   src=x onerror=alert(1)>` (space between `<` and the name) also
 *   matches via the same branch, because the boundary check is about the
 *   character after the tag name, not before it.
 * - Matches HTML comments (`<!-- ... -->`) as a single non-greedy unit
 *   across embedded `>` characters, so `<!-- note: x > y -->` doesn't leak
 *   its tail as body text.
 * - Iterates to a fixed point so that stripping an inner tag can't
 *   synthesize a new, well-formed outer tag from leftover fragments (e.g.
 *   `<<b>b>hi<</b>/b>` fully collapses to `hi` instead of reassembling into
 *   a live-looking `<b>hi</b>`).
 *
 * Known accepted tradeoff: because the `=`-bearing branch's terminator can
 * be end-of-line, a genuinely unclosed attribute-bearing tag mid-sentence
 * (no `>` anywhere on that line) consumes the rest of that same line, not
 * just the tag itself. This only reaches beyond the injected fragment when
 * an admin's real prose shares an unbroken line with unclosed tag-shaped
 * text with no line break in between -- an unusual authoring accident, not
 * a realistic paragraph. Prose on earlier or later lines is untouched.
 */
const HTML_TAGS =
  'a|abbr|b|base|blockquote|body|br|button|canvas|code|dd|div|dl|dt|em|embed|fieldset|font|form|frame|frameset|h[1-6]|head|html|i|iframe|img|input|label|li|link|map|marquee|meta|noscript|object|ol|optgroup|option|p|param|picture|pre|s|script|section|select|slot|small|source|span|strong|style|sub|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|title|tr|track|u|ul|video|xmp';
// Optional whitespace/slash around the tag name so `</b>` (closing) and
// `< img ...>` (stray leading space, still attribute-bearing) both qualify
// as the SAME tag-name match; what decides whether it's actually stripped
// is the shape that follows (see TAG_RE below), not this prefix.
const OPEN = `<\\s*\\/?\\s*(?:${HTML_TAGS})`;
const TAG_RE = new RegExp(
  // 1) HTML comments, non-greedy across embedded `>`.
  '<!--[\\s\\S]*?-->|' +
    // 2) Immediate close, no attributes: <b>, <br/>, <br />, </b>.
    `${OPEN}(?=[\\s/>])\\s*\\/?>|` +
    // 3) Attribute-bearing (has a literal `=` before its terminator),
    //    closed or not: <img src=x>, <img src=x onerror=alert(1) (no >).
    `${OPEN}(?=[\\s/>])[^\\n>]*=[^\\n>]*(?:>|$)`,
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
