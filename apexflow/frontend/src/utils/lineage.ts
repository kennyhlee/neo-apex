// Collapses the per-VERSION definition list into one row per workflow.
//
// `listDefinitions` returns a row per definition version, so a lineage with a
// published v3 and a draft v4 arrives as two entries. Rendering them as two
// table rows was the root of three separate usability problems, but it was
// also displaying something that can be WRONG: `lineage_status` is a property
// of the LINEAGE, not of a version. It is denormalized onto every row, the
// authoritative copy lives on the published row (which is what the backend's
// `_require_published_row` enforces), and a draft's copy is written once at
// creation and never updated. Reading it off the published row here is the
// point, not an implementation detail.
//
// Deliberately NOT a reuse of admindash's `visibleWorkflows`
// (admindash/frontend/src/utils/workflowData.ts), despite being the same
// grouping: that function drops archived and never-published lineages because
// AdminDash is an operations surface where neither has work to process. This is
// the authoring surface — archived lineages are where Unarchive lives, and a
// never-published draft is where Delete lives. Same shape, opposite retention
// rule.
import type {
  ChannelAccess,
  DefinitionHealth,
  DefinitionListEntry,
  LineageStatus,
} from '../types/designer.ts';

export interface LineageRow {
  definition_id: string;
  name: string;
  /** The live version, or null for a lineage that has never been published. */
  published: DefinitionListEntry | null;
  /** The open draft, or null. At most one, per the backend's `new_draft` rule. */
  draft: DefinitionListEntry | null;
  lineage_status: LineageStatus;
  health: DefinitionHealth;
  channel_access: ChannelAccess;
  family_url?: string;
  /** Max across versions — an instance pins to the version it started on. */
  open_instances: number;
}

/** The row whose lineage-level fields are authoritative: the published one
 * where it exists, else the draft (a never-published lineage has no published
 * copy to read from). */
function representative(
  published: DefinitionListEntry | null,
  draft: DefinitionListEntry | null,
): DefinitionListEntry {
  return (published ?? draft)!;
}

export function collapseLineages(entries: DefinitionListEntry[]): LineageRow[] {
  const byLineage = new Map<string, DefinitionListEntry[]>();
  for (const entry of entries) {
    // Superseded rows are historical: they carry no live action, and their
    // lineage fields are frozen at the moment they were superseded.
    if (entry.status !== 'draft' && entry.status !== 'published') continue;
    const rows = byLineage.get(entry.definition_id) ?? [];
    rows.push(entry);
    byLineage.set(entry.definition_id, rows);
  }

  const out: LineageRow[] = [];
  for (const [definitionId, rows] of byLineage) {
    const published = rows.find((r) => r.status === 'published') ?? null;
    // Highest version wins if a pre-`new_draft` lineage still has two drafts.
    const draft = rows
      .filter((r) => r.status === 'draft')
      .sort((a, b) => b.version - a.version)[0] ?? null;

    const rep = representative(published, draft);
    out.push({
      definition_id: definitionId,
      name: rep.name,
      published,
      draft,
      lineage_status: rep.lineage_status,
      health: rep.health,
      channel_access: rep.channel_access,
      family_url: rep.family_url,
      open_instances: Math.max(...rows.map((r) => r.open_instances), 0),
    });
  }

  return out.sort(
    (a, b) => (a.name || '').localeCompare(b.name || '')
      || a.definition_id.localeCompare(b.definition_id),
  );
}

/** What the table's single `Open` button opens. The draft wins: on an
 * authoring surface that is the version being worked on. The drawer remains
 * the way to reach the other version, and lists both explicitly. */
export function primaryEntityId(row: LineageRow): string {
  return (row.draft ?? row.published)!.entity_id;
}
