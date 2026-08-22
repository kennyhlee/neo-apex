// The tokenizer is where the mangling bug lived, so it carries the coverage
// and is pure so admindash's copy can be tested the same way without a DOM.
//
// The bug: `Markdown` split the whole message on blank lines BEFORE looking
// at any block, so a drawing containing a blank line was already three
// unrelated paragraphs by the time rendering started — and with no fence
// branch at all, each of those rendered in the proportional font, collapsing
// every run of spaces. Both halves are asserted here.
import { describe, expect, it } from 'vitest';
import { splitFences } from '../markdownFences.ts';

const text = (body: string) => ({ code: false, body });
const code = (body: string) => ({ code: true, body });

describe('splitFences', () => {
  it('leaves prose alone', () => {
    expect(splitFences('hello\n\nworld')).toEqual([text('hello\n\nworld')]);
  });

  it('returns nothing for an empty message', () => {
    expect(splitFences('')).toEqual([]);
  });

  // The whole point. A blank line inside a fence must NOT end the block.
  it('keeps a blank line inside a fence', () => {
    expect(splitFences('```\na\n\nb\n```')).toEqual([code('a\n\nb')]);
  });

  // The other half: indentation is what box drawing is made of.
  it('preserves leading whitespace exactly', () => {
    const drawing = '┌────┐\n│    │\n└──┬─┘\n   │\n   ▼';
    expect(splitFences('```\n' + drawing + '\n```')).toEqual([code(drawing)]);
  });

  it('separates prose before and after a fence', () => {
    expect(splitFences('before\n```\nx\n```\nafter')).toEqual([
      text('before'),
      code('x'),
      text('after'),
    ]);
  });

  it('ignores a language tag', () => {
    expect(splitFences('```json\n{}\n```')).toEqual([code('{}')]);
  });

  it('accepts tilde fences', () => {
    expect(splitFences('~~~\nx\n~~~')).toEqual([code('x')]);
  });

  it('treats the other marker as literal content', () => {
    expect(splitFences('~~~\n```\n~~~')).toEqual([code('```')]);
  });

  it('needs a closing fence at least as long as the opener', () => {
    // The 3-backtick line is content; the 4-backtick line closes.
    expect(splitFences('````\n```\n````')).toEqual([code('```')]);
  });

  it('handles an empty fence', () => {
    expect(splitFences('```\n```')).toEqual([code('')]);
  });

  // Streaming is exactly this case: the assistant appends tokens as they
  // arrive, so for most of a reply's life the closing fence has not been
  // sent yet. If an unterminated fence fell back to prose, the drawing would
  // render mangled on every frame and then snap into place at the end.
  it('treats an unterminated fence as code, for streaming', () => {
    expect(splitFences('prose\n```\nhalf a dia')).toEqual([text('prose'), code('half a dia')]);
  });

  it('does not invent a segment for the text before a fence when there is none', () => {
    expect(splitFences('```\nx\n```')).toEqual([code('x')]);
  });

  it('handles several fences in one message', () => {
    expect(splitFences('a\n```\n1\n```\nb\n```\n2\n```')).toEqual([
      text('a'),
      code('1'),
      text('b'),
      code('2'),
    ]);
  });

  it('tolerates indented fence markers', () => {
    expect(splitFences('  ```\nx\n  ```')).toEqual([code('x')]);
  });

  // Every line is either a fence marker or lands in exactly one segment —
  // nothing is silently dropped. Counted in lines rather than characters so
  // the oracle stays independent of the tokenizer: a character-level version
  // has to decide which markers were structural, which is the very thing
  // under test (and gets `~~~ / ``` / ~~~` wrong, where the inner marker is
  // content).
  it('accounts for every line of input', () => {
    const cases: Array<[string, number]> = [
      ['plain', 0],
      ['```\na\n\nb\n```', 2],
      ['x\n```y\nz\n```\nw', 2],
      ['```\nunterminated', 1],
      ['~~~\n```\n~~~', 2],
      ['a\n```\n1\n```\nb\n```\n2\n```', 4],
    ];
    for (const [message, markerLines] of cases) {
      const emitted = splitFences(message)
        .map((s) => s.body.split('\n').length)
        .reduce((a, b) => a + b, 0);
      expect(emitted).toBe(message.split('\n').length - markerLines);
    }
  });
});
