import { describe, it, expect } from 'vitest';
import { ITEM_STATUSES } from '@neoapex/flow-runtime';
import {
  parseMachineStates,
  instancesByState,
  instanceSql,
  pinnedDefinitionSql,
  asNumber,
  itemsSql,
  documentsSql,
  activitySql,
  actionButtonsFor,
  itemActionVisibility,
  settledSection,
  usableModels,
  asBool,
  asItemStatus,
  toItemView,
  toDocumentView,
  type MachineStateView,
  filterInstances,
  type InstanceRow,
  type LineageInstance,
} from '../workflowData.ts';

describe('parseMachineStates', () => {
  it('parses an already-parsed machine object', () => {
    const machine = {
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' },
        { state_id: 'review', name: 'Review', kind: 'active' },
        { state_id: 'done', name: 'Done', kind: 'terminal' },
      ],
      transitions: [],
    };
    expect(parseMachineStates(machine)).toEqual([
      { state_id: 'draft', name: 'Draft', kind: 'initial' },
      { state_id: 'review', name: 'Review', kind: 'active' },
      { state_id: 'done', name: 'Done', kind: 'terminal' },
    ]);
  });

  it('parses a JSON-encoded machine string (DataCore wire shape)', () => {
    const machineJson = JSON.stringify({
      states: [{ state_id: 'draft', name: 'Draft', kind: 'initial' }],
      transitions: [],
    });
    expect(parseMachineStates(machineJson)).toEqual([
      { state_id: 'draft', name: 'Draft', kind: 'initial' },
    ]);
  });

  it('preserves declaration order', () => {
    const machine = {
      states: [
        { state_id: 'c', name: 'C', kind: 'terminal' },
        { state_id: 'a', name: 'A', kind: 'initial' },
        { state_id: 'b', name: 'B', kind: 'active' },
      ],
      transitions: [],
    };
    expect(parseMachineStates(machine).map((s) => s.state_id)).toEqual(['c', 'a', 'b']);
  });

  it('returns [] for garbage input: invalid JSON string', () => {
    expect(parseMachineStates('not json')).toEqual([]);
  });

  it('returns [] for garbage input: null/undefined/number', () => {
    expect(parseMachineStates(null)).toEqual([]);
    expect(parseMachineStates(undefined)).toEqual([]);
    expect(parseMachineStates(42)).toEqual([]);
  });

  it('returns [] when states is missing or not an array', () => {
    expect(parseMachineStates({})).toEqual([]);
    expect(parseMachineStates({ states: 'nope' })).toEqual([]);
  });

  it('skips malformed entries inside a states array', () => {
    const machine = {
      states: [
        { state_id: 'draft', name: 'Draft', kind: 'initial' },
        null,
        'garbage',
        { name: 'Missing id', kind: 'active' },
      ],
      transitions: [],
    };
    expect(parseMachineStates(machine)).toEqual([
      { state_id: 'draft', name: 'Draft', kind: 'initial' },
    ]);
  });
});

describe('instancesByState', () => {
  const states: MachineStateView[] = [
    { state_id: 'draft', name: 'Draft', kind: 'initial' },
    { state_id: 'review', name: 'Review', kind: 'active' },
    { state_id: 'done', name: 'Done', kind: 'terminal' },
  ];

  function row(entity_id: string, state: string): InstanceRow {
    return { entity_id, state };
  }

  it('groups rows into columns matching declared state order', () => {
    const rows = [row('1', 'draft'), row('2', 'review'), row('3', 'draft')];
    const { columns, orphans } = instancesByState(states, rows);
    expect(columns.map((c) => c.state.state_id)).toEqual(['draft', 'review', 'done']);
    expect(columns[0].rows.map((r) => r.entity_id)).toEqual(['1', '3']);
    expect(columns[1].rows.map((r) => r.entity_id)).toEqual(['2']);
    expect(columns[2].rows).toEqual([]);
    expect(orphans).toEqual([]);
  });

  it('buckets instances whose state is not declared into orphans', () => {
    const rows = [row('1', 'draft'), row('2', 'renamed_state'), row('3', '')];
    const { columns, orphans } = instancesByState(states, rows);
    expect(columns[0].rows.map((r) => r.entity_id)).toEqual(['1']);
    expect(orphans.map((r) => r.entity_id)).toEqual(['2', '3']);
  });

  it('returns empty columns for every declared state when there are no rows', () => {
    const { columns, orphans } = instancesByState(states, []);
    expect(columns).toHaveLength(3);
    expect(columns.every((c) => c.rows.length === 0)).toBe(true);
    expect(orphans).toEqual([]);
  });
});

describe('instanceSql', () => {
  it('builds the exact SELECT for a lineage, including _status = active', () => {
    expect(instanceSql('enroll-2026')).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_instance' AND _status = 'active' AND definition_id = 'enroll-2026' ORDER BY _created_at DESC",
    );
  });

  it('escapes a single quote in the definition id', () => {
    expect(instanceSql("o'brien")).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_instance' AND _status = 'active' AND definition_id = 'o''brien' ORDER BY _created_at DESC",
    );
  });
});

describe('pinnedDefinitionSql', () => {
  it('builds the exact SELECT for a pinned lineage version, including _status = active', () => {
    expect(pinnedDefinitionSql('enroll-2026', 3)).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_definition' AND _status = 'active' AND definition_id = 'enroll-2026' AND version = '3'",
    );
  });

  it('compares version as a string (DataCore flattens numerics to strings)', () => {
    expect(pinnedDefinitionSql('enroll-2026', '3')).toBe(
      pinnedDefinitionSql('enroll-2026', 3),
    );
  });

  it('escapes a single quote in the definition id', () => {
    expect(pinnedDefinitionSql("o'brien", 1)).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_definition' AND _status = 'active' AND definition_id = 'o''brien' AND version = '1'",
    );
  });
});

describe('asNumber', () => {
  it('passes through a finite number', () => {
    expect(asNumber(5)).toBe(5);
  });

  it('coerces a numeric string (DataCore flattens numerics to strings)', () => {
    expect(asNumber('5')).toBe(5);
  });

  it('falls back to 0 for NaN/garbage', () => {
    expect(asNumber('not a number')).toBe(0);
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber(null)).toBe(0);
  });

  it('falls back to a supplied default', () => {
    expect(asNumber('garbage', -1)).toBe(-1);
  });
});

describe('itemsSql', () => {
  it('builds the exact SELECT for an instance, including _status = active', () => {
    expect(itemsSql('inst-1')).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_item' AND _status = 'active' AND instance_id = 'inst-1'",
    );
  });

  it('escapes a single quote in the instance id', () => {
    expect(itemsSql("o'brien")).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_item' AND _status = 'active' AND instance_id = 'o''brien'",
    );
  });
});

describe('documentsSql', () => {
  it('builds the exact SELECT keyed on application_id (DataCore\'s fixed field name)', () => {
    expect(documentsSql('inst-1')).toBe(
      "SELECT * FROM data WHERE entity_type = 'document' AND _status = 'active' AND application_id = 'inst-1'",
    );
  });

  it('escapes a single quote in the instance id', () => {
    expect(documentsSql("o'brien")).toBe(
      "SELECT * FROM data WHERE entity_type = 'document' AND _status = 'active' AND application_id = 'o''brien'",
    );
  });
});

describe('activitySql', () => {
  it('builds the exact SELECT ordered by "at" ascending, with at quoted (DuckDB reserved keyword)', () => {
    expect(activitySql('inst-1')).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_activity' AND _status = 'active' AND instance_id = 'inst-1' ORDER BY \"at\" ASC",
    );
  });

  it('escapes a single quote in the instance id', () => {
    expect(activitySql("o'brien")).toBe(
      "SELECT * FROM data WHERE entity_type = 'workflow_activity' AND _status = 'active' AND instance_id = 'o''brien' ORDER BY \"at\" ASC",
    );
  });
});

describe('actionButtonsFor', () => {
  it('strips the five item built-ins out of the allowed list', () => {
    expect(actionButtonsFor([
      'save_draft', 'complete_item', 'verify_item', 'reject_item', 'waive_item',
      'submit', 'cancel_instance',
    ])).toEqual(['submit', 'cancel_instance']);
  });

  it('preserves order and passes through an empty list', () => {
    expect(actionButtonsFor([])).toEqual([]);
    expect(actionButtonsFor(['approve', 'reject'])).toEqual(['approve', 'reject']);
  });
});

describe('itemActionVisibility', () => {
  it('shows verify only for submitted', () => {
    expect(itemActionVisibility('submitted').verify).toBe(true);
    for (const s of ITEM_STATUSES.filter((v) => v !== 'submitted')) {
      expect(itemActionVisibility(s).verify).toBe(false);
    }
  });

  it('shows waive unless already verified', () => {
    expect(itemActionVisibility('verified').waive).toBe(false);
    for (const s of ITEM_STATUSES.filter((v) => v !== 'verified')) {
      expect(itemActionVisibility(s).waive).toBe(true);
    }
  });

  it('always shows reject', () => {
    for (const s of ITEM_STATUSES) {
      expect(itemActionVisibility(s).reject).toBe(true);
    }
  });
});

describe('asItemStatus', () => {
  it('passes every generated status through unchanged', () => {
    for (const s of ITEM_STATUSES) {
      expect(asItemStatus(s)).toBe(s);
    }
  });

  it('falls back to not_started for a value outside the vocabulary', () => {
    // `in_progress` was dropped from the vocabulary (Plan 1 follow-up #23)
    expect(asItemStatus('in_progress')).toBe('not_started');
    expect(asItemStatus(undefined)).toBe('not_started');
  });
});

describe('settledSection', () => {
  it('unwraps a fulfilled result with failed: false', () => {
    const result: PromiseSettledResult<string[]> = { status: 'fulfilled', value: ['a', 'b'] };
    expect(settledSection(result, [])).toEqual({ data: ['a', 'b'], failed: false });
  });

  it('falls back to the supplied value with failed: true on rejection', () => {
    const result: PromiseSettledResult<string[]> = {
      status: 'rejected',
      reason: new Error('boom'),
    };
    expect(settledSection(result, ['fallback'])).toEqual({ data: ['fallback'], failed: true });
  });

  it('an empty-array fallback stays independent per call (no shared-reference surprise)', () => {
    const rejected: PromiseSettledResult<string[]> = { status: 'rejected', reason: 'x' };
    const a = settledSection(rejected, []);
    const b = settledSection(rejected, []);
    expect(a.data).not.toBe(b.data);
  });
});

describe('usableModels', () => {
  it('drops null entries, keeps the rest', () => {
    const models = {
      student: { base_fields: [], custom_fields: [] },
      family: null,
    };
    expect(usableModels(models)).toEqual({
      student: { base_fields: [], custom_fields: [] },
    });
  });

  it('returns {} for an all-null or empty map', () => {
    expect(usableModels({ a: null, b: null })).toEqual({});
    expect(usableModels({})).toEqual({});
  });
});

describe('asBool', () => {
  it('treats real true and the string "true" as true', () => {
    expect(asBool(true)).toBe(true);
    expect(asBool('true')).toBe(true);
  });

  it('treats false, "false", and everything else as false', () => {
    expect(asBool(false)).toBe(false);
    expect(asBool('false')).toBe(false);
    expect(asBool(undefined)).toBe(false);
    expect(asBool(null)).toBe(false);
    expect(asBool('')).toBe(false);
    expect(asBool(0)).toBe(false);
  });
});

describe('toItemView', () => {
  it('maps a flattened workflow_item row, coercing blocking from its stringly-typed wire form', () => {
    expect(toItemView({
      entity_id: 'ITM-1', step_id: 'docs', kind: 'documents',
      title: 'Birth certificate', status: 'submitted', blocking: 'true',
    })).toEqual({
      entity_id: 'ITM-1', step_id: 'docs', kind: 'documents',
      title: 'Birth certificate', status: 'submitted', blocking: true,
    });
  });

  it('falls back to safe defaults for missing fields', () => {
    expect(toItemView({ entity_id: 'ITM-2' })).toEqual({
      entity_id: 'ITM-2', step_id: '', kind: 'form', title: '',
      status: 'not_started', blocking: false,
    });
  });
});

describe('toDocumentView', () => {
  it('maps a flattened document row', () => {
    expect(toDocumentView({
      document_id: 'DOC-1', entity_id: 'DOC-1', filename: 'cert.pdf', item_id: 'ITM-1',
    })).toEqual({ document_id: 'DOC-1', filename: 'cert.pdf', item_id: 'ITM-1' });
  });

  it('falls back to entity_id when document_id is absent, and leaves item_id undefined when absent', () => {
    expect(toDocumentView({ entity_id: 'DOC-2', filename: 'x.pdf' })).toEqual({
      document_id: 'DOC-2', filename: 'x.pdf', item_id: undefined,
    });
  });
});

describe('filterInstances', () => {
  const row = (over: Partial<LineageInstance>): LineageInstance => ({
    entity_id: 'wi-1', instance_id: 'WI-1', state: 'draft', definition_version: 1,
    channel_started: 'staff', applicant_email: '', opened_at: '', closed_at: '',
    archived_from_state: '', ...over,
  });

  const rows = [
    row({ entity_id: 'open', state: 'submitted', closed_at: '' }),
    row({ entity_id: 'closed', state: 'enrolled', closed_at: '2026-08-02T00:00:00Z' }),
    row({ entity_id: 'gone', state: 'abandoned', closed_at: '2026-08-02T00:00:00Z',
          archived_from_state: 'submitted' }),
  ];

  it('returns everything by default', () => {
    expect(filterInstances(rows, {})).toHaveLength(3);
  });

  it('open means no closed_at', () => {
    expect(filterInstances(rows, { openness: 'open' }).map((r) => r.entity_id))
      .toEqual(['open']);
  });

  it('closed includes abandoned items', () => {
    expect(filterInstances(rows, { openness: 'closed' }).map((r) => r.entity_id))
      .toEqual(['closed', 'gone']);
  });

  it('abandoned narrows to the archive fallout only', () => {
    expect(filterInstances(rows, { openness: 'abandoned' }).map((r) => r.entity_id))
      .toEqual(['gone']);
  });

  it('state filter composes with openness', () => {
    expect(filterInstances(rows, { state: 'enrolled', openness: 'closed' })
      .map((r) => r.entity_id)).toEqual(['closed']);
  });
});
