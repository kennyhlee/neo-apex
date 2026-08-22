// Fenced-code tokenizing for the chat message renderer.
//
// Its own module, and pure, for two reasons: this is where the mangling bug
// lived, so it deserves tests that do not need a DOM; and apexflow ships a
// byte-identical copy of `Markdown.tsx` that needs the same fix, so the part
// worth getting right is shared by construction rather than by discipline.
//
// THE BUG THIS EXISTS TO FIX: `Markdown` split the whole message on blank
// lines before inspecting any block, and had no fence branch at all. A
// diagram containing a blank line was therefore several unrelated
// paragraphs, each rendered in the proportional font, where every run of
// spaces collapses to one. Fences must be lifted out BEFORE that split.

/** A fence line: three or more backticks or tildes, plus an optional info
 * string. Leading whitespace is tolerated because models emit it. */
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`~]*)\s*$/;

export interface FenceSegment {
  /** True for the inside of a fenced block, which renders verbatim. */
  code: boolean;
  body: string;
}

/**
 * Split a message into fenced-code segments and everything else, in order.
 *
 * A fence closes only on a marker of the SAME character and at least the
 * same length, so a ``` inside a ~~~ block — or inside a longer ```` one —
 * is content rather than a terminator.
 *
 * An UNTERMINATED fence yields a code segment rather than falling back to
 * prose. That is not an edge case here: chat replies stream in token by
 * token, so for most of a reply's life the closing fence has not arrived.
 * Falling back would render the drawing mangled on every frame and then snap
 * into place at the end.
 */
export function splitFences(text: string): FenceSegment[] {
  const out: FenceSegment[] = [];
  const prose: string[] = [];
  const code: string[] = [];
  let opener: string | null = null;

  const flushProse = () => {
    if (prose.length > 0) {
      out.push({ code: false, body: prose.join('\n') });
      prose.length = 0;
    }
  };

  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line);
    if (opener === null) {
      if (marker) {
        flushProse();
        opener = marker[1];
      } else {
        prose.push(line);
      }
      continue;
    }
    if (marker && marker[1][0] === opener[0] && marker[1].length >= opener.length) {
      out.push({ code: true, body: code.join('\n') });
      code.length = 0;
      opener = null;
    } else {
      code.push(line);
    }
  }

  if (opener !== null) out.push({ code: true, body: code.join('\n') });
  else flushProse();

  // A message that is only whitespace contributes nothing to render.
  return out.filter((s) => s.code || s.body.trim() !== '');
}
