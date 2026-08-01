import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeSql, searchFamilies, getStudentsByFamily, createFamily, searchStudents } from '../client.ts';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', { getItem: () => 'tok' });
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

describe('escapeSql', () => {
  it("doubles single quotes", () => {
    expect(escapeSql("O'Brien")).toBe("O''Brien");
  });
});

describe('searchFamilies', () => {
  it('queries the family entity and escapes the search term', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 'f1', family_name: "O'Brien" }], total: 1 }));
    const res = await searchFamilies('t1', "O'Brien");
    expect(res).toHaveLength(1);
    expect(res[0].entity_id).toBe('f1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.table).toBe('entities');
    expect(body.sql).toContain("entity_type = 'family'");
    expect(body.sql).toContain("o''brien"); // escaped and lowercased
  });
});

describe('getStudentsByFamily', () => {
  it('filters students by family_id', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 's1' }], total: 1 }));
    const res = await getStudentsByFamily('t1', 'fam-9');
    expect(res).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sql).toContain("entity_type = 'student'");
    expect(body.sql).toContain("family_id = 'fam-9'");
  });
});

describe('createFamily', () => {
  it('POSTs to the family entity endpoint with base_data', async () => {
    fetchMock.mockReturnValue(ok({ entity_id: 'fam-new' }));
    const res = await createFamily('t1', { family_name: 'Nguyen', primary_email: 'a@b.com' });
    expect(res.entity_id).toBe('fam-new');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/entities/t1/family');
    const body = JSON.parse(init.body);
    expect(body.base_data.family_name).toBe('Nguyen');
  });
});

describe('searchStudents', () => {
  it('queries active students, escapes the term, matches name/id, respects limit', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 's1', first_name: "O'Ryan" }], total: 1 }));
    const res = await searchStudents('t1', "O'Ryan", 50);
    expect(res).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.table).toBe('entities');
    expect(body.sql).toContain("entity_type = 'student'");
    expect(body.sql).toContain("_status = 'active'");
    expect(body.sql).toContain("o''ryan");      // escaped + lowercased
    expect(body.sql).toContain('LIMIT 50');
  });
});
