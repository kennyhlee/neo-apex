import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/designer.ts';
import { errorDetail } from '../apiError.ts';

describe('errorDetail', () => {
  it('returns null for anything that is not an ApiError', () => {
    expect(errorDetail(new Error('Failed to fetch'))).toBeNull();
    expect(errorDetail('boom')).toBeNull();
    expect(errorDetail(undefined)).toBeNull();
  });

  it('returns a string body verbatim', () => {
    expect(errorDetail(new ApiError(500, 'upstream exploded'))).toBe('upstream exploded');
  });

  it('returns a string detail', () => {
    expect(errorDetail(new ApiError(409, { detail: 'not a draft' }))).toBe('not a draft');
  });

  // The case the whole helper exists for: create/save 422s put a DICT on
  // `detail`, which the original page-local helper dropped — leaving the
  // operator with a bare "HTTP 422". Body copied from a live
  // POST /api/workflows/acme/definitions with `machine: {states: "nope"}`.
  it('flattens a dict detail', () => {
    const err = new ApiError(422, {
      detail: { parse_error: '2 validation errors for MachineDef\nstates\n  Input should be a valid list' },
    });
    expect(errorDetail(err)).toContain('2 validation errors for MachineDef');
  });

  // FastAPI request-validation shape, also copied from the live route (POST
  // with `name` omitted). `msg` is the sentence; `type`/`loc`/`input` are noise.
  it('takes msg from a request-validation entry rather than joining every string', () => {
    const err = new ApiError(422, {
      detail: [
        {
          type: 'missing',
          loc: ['body', 'name'],
          msg: 'Field required',
          input: { machine: {}, steps: [] },
        },
      ],
    });
    expect(errorDetail(err)).toBe('Field required');
  });

  it('joins multiple validation entries', () => {
    const err = new ApiError(422, {
      detail: [
        { loc: ['body', 'name'], msg: 'Field required' },
        { loc: ['body', 'machine'], msg: 'Input should be a valid dictionary' },
      ],
    });
    expect(errorDetail(err)).toBe('Field required; Input should be a valid dictionary');
  });

  it('yields null when the body carries no detail at all', () => {
    // Publish 409 and archive 409 — both rendered by their own call sites, so
    // they must keep falling through to the caller's fallback copy.
    expect(errorDetail(new ApiError(409, { errors: ['bad transition'] }))).toBeNull();
    expect(errorDetail(new ApiError(409, { open_instances: 3 }))).toBeNull();
  });

  it('yields null when the detail holds no strings', () => {
    expect(errorDetail(new ApiError(422, { detail: { count: 3 } }))).toBeNull();
    expect(errorDetail(new ApiError(422, { detail: '   ' }))).toBeNull();
    expect(errorDetail(new ApiError(500, undefined))).toBeNull();
  });
});
