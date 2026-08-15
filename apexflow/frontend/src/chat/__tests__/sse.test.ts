// Frame-parser tests for the chat SSE transport.
//
// `parseSseChunks` is the whole reason the read loop in `streamChat` is two
// lines long: the byte-boundary logic — a frame arriving split across two
// network chunks, a `data:` line that isn't JSON, a frame with no `data:`
// line at all — is where an SSE client actually goes wrong, and none of it
// needs a fetch, a stream, or a DOM to exercise. apexflow's vitest runs in
// `environment: 'node'` with no jsdom, so pure helpers are the only thing
// testable here anyway (see src/editor/stage/__tests__ for the same style).
import { describe, expect, it } from 'vitest';
import { parseSseChunks } from '../../api/chat.ts';

/** Wire form of one SSE frame, exactly as `app/chat/stream.py:_sse` emits it. */
const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('parseSseChunks', () => {
  it('parses token, tool, proposal and done frames', () => {
    const buffer =
      frame({ type: 'token', text: 'Hello' }) +
      frame({ type: 'tool', name: 'list_templates' }) +
      frame({
        type: 'proposal',
        proposal: {
          action: 'patch',
          ops: [{ op: 'rename_stage', stage_id: 's1', name: 'Review' }],
          summary: ['Rename stage'],
        },
      }) +
      frame({ type: 'done' });

    const { events, rest } = parseSseChunks(buffer);

    expect(rest).toBe('');
    expect(events).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'tool', name: 'list_templates' },
      {
        type: 'proposal',
        proposal: {
          action: 'patch',
          ops: [{ op: 'rename_stage', stage_id: 's1', name: 'Review' }],
          summary: ['Rename stage'],
        },
      },
      { type: 'done' },
    ]);
  });

  it('holds an incomplete frame back as `rest` and completes it on the next chunk', () => {
    const whole = frame({ type: 'token', text: 'streamed' });
    // Split mid-JSON, the worst case: neither half parses on its own.
    const cut = whole.indexOf('str');

    const first = parseSseChunks(whole.slice(0, cut));
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(whole.slice(0, cut));

    const second = parseSseChunks(first.rest + whole.slice(cut));
    expect(second.events).toEqual([{ type: 'token', text: 'streamed' }]);
    expect(second.rest).toBe('');
  });

  it('keeps a trailing complete-looking frame as `rest` until its blank line arrives', () => {
    // No terminating `\n\n` yet — the frame is NOT emitted, because more
    // JSON could still be coming on the same line.
    const partial = 'data: {"type": "token", "text": "a"}';
    const { events, rest } = parseSseChunks(partial);
    expect(events).toEqual([]);
    expect(rest).toBe(partial);
  });

  it('ignores malformed JSON without dropping the frames around it', () => {
    const buffer =
      frame({ type: 'token', text: 'before' }) +
      'data: {"type": "token", "text": \n\n' + // truncated JSON
      frame({ type: 'token', text: 'after' });

    const { events } = parseSseChunks(buffer);

    expect(events).toEqual([
      { type: 'token', text: 'before' },
      { type: 'token', text: 'after' },
    ]);
  });

  it('ignores frames with no `data:` line', () => {
    const buffer = ': keep-alive comment\n\n' + frame({ type: 'done' });
    expect(parseSseChunks(buffer).events).toEqual([{ type: 'done' }]);
  });

  it('reads the `data:` line of a multi-line frame', () => {
    const buffer = `event: message\ndata: ${JSON.stringify({ type: 'done' })}\n\n`;
    expect(parseSseChunks(buffer).events).toEqual([{ type: 'done' }]);
  });

  it('returns no events for an empty buffer', () => {
    expect(parseSseChunks('')).toEqual({ events: [], rest: '' });
  });
});
