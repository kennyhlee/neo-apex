import { describe, it, expect } from 'vitest';
import {
  parseMachineStates,
  instancesByState,
  instanceSql,
  pinnedDefinitionSql,
  asNumber,
  type MachineStateView,
  type InstanceRow,
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
