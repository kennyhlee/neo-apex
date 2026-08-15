// Every body in this file was COPIED OFF THE LIVE ROUTES (apexflow-backend
// against tenant `acme`), not written from memory. The first version of this
// suite invented `{errors: [...]}` where the API actually sends
// `{"detail": {"errors": [...]}}`, so it asserted a shape that never occurs —
// green, and blind to the regression it was supposed to catch. If a shape here
// needs changing, re-curl the route; do not adjust it to match the code.
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

  // 404 — `HTTPException(404, "workflow_definition not found")` (definitions.py:98).
  it('returns a string detail', () => {
    const err = new ApiError(404, { detail: 'workflow_definition not found' });
    expect(errorDetail(err)).toBe('workflow_definition not found');
  });

  describe('prose bodies — shown to the operator', () => {
    // The case the helper exists for. POST .../definitions with
    // `machine: {states: "nope"}` → definitions.py:480.
    it('returns a parse_error', () => {
      const err = new ApiError(422, {
        detail: {
          parse_error:
            '2 validation errors for MachineDef\nstates\n  Input should be a valid list',
        },
      });
      expect(errorDetail(err)).toContain('2 validation errors for MachineDef');
    });

    // POST .../definitions with `name` omitted — FastAPI request validation.
    // `msg` is the sentence; `type`/`loc`/`input` are noise.
    it('takes msg from a request-validation entry, not every string in it', () => {
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
          { type: 'missing', loc: ['body', 'name'], msg: 'Field required' },
          { type: 'dict_type', loc: ['body', 'machine'], msg: 'Input should be a valid dictionary' },
        ],
      });
      expect(errorDetail(err)).toBe('Field required; Input should be a valid dictionary');
    });
  });

  describe('machine-code bodies — caller keeps its translated fallback', () => {
    // These are the regression. Joining a dict's values renders
    // "not_draft; published" — an untranslated wire value in both locales —
    // where DefinitionsPage had `definitions.deleteFailed` ready to show.

    // `delete` on a published row (definitions.py:399). Verified on the wire:
    // POST .../definitions/a52576caf12e/actions {"action":"delete"} → 409.
    it('yields null for the delete 409', () => {
      const err = new ApiError(409, { detail: { reason: 'not_draft', status: 'published' } });
      expect(errorDetail(err)).toBeNull();
    });

    // `archive` on an active lineage (definitions.py:330). Verified on the wire.
    it('yields null for the archive 409', () => {
      const err = new ApiError(409, {
        detail: { reason: 'not_deprecated', lineage_status: 'active' },
      });
      expect(errorDetail(err)).toBeNull();
    });

    // `save` on a non-draft (definitions.py:265) and `new_draft` against a
    // lineage that already has one (definitions.py:534,547).
    it('yields null for the other reason-carrying 409s', () => {
      expect(errorDetail(new ApiError(409, { detail: { reason: 'not_draft', status: 'superseded' } }))).toBeNull();
      expect(errorDetail(new ApiError(409, { detail: { reason: 'not_published', status: 'draft' } }))).toBeNull();
      expect(errorDetail(new ApiError(409, { detail: { reason: 'draft_exists', entity_id: 'abc123' } }))).toBeNull();
      expect(errorDetail(new ApiError(409, { detail: { reason: 'lineage_archived', lineage_status: 'archived' } }))).toBeNull();
    });

    // Publish 409 (definitions.py:135). Its strings ARE prose, but the publish
    // dialog renders the list itself — so this helper stays out of the way and
    // the toast keeps its translated copy, as it did before the extraction.
    it('yields null for the publish 409 even though its errors are sentences', () => {
      const err = new ApiError(409, {
        detail: { errors: ["transition 'submit_signup' effect 'commit_sections' param must be a non-empty list"] },
      });
      expect(errorDetail(err)).toBeNull();
    });
  });

  it('yields null when there is nothing to unwrap', () => {
    expect(errorDetail(new ApiError(422, { detail: { parse_error: '   ' } }))).toBeNull();
    expect(errorDetail(new ApiError(500, undefined))).toBeNull();
    expect(errorDetail(new ApiError(500, {}))).toBeNull();
  });
});
