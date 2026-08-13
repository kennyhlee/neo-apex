// The lineage lifecycle rendered as a ladder rather than a menu.
//
// `active --deprecate-> deprecated --archive-> archived`, reversed by
// `reactivate` / `unarchive`. The old `⋯` overflow menu could only list the
// actions legal RIGHT NOW, so on an active lineage "Archive" was not greyed
// out — it was absent, and nothing communicated that archiving existed or that
// deprecating is the window in which mid-flight work drains. A ladder renders
// all three rungs always, marks the current one, and shows an illegal move
// greyed WITH ITS REASON. A menu can only hide; a ladder can explain.
//
// `blockedReasonKey` mirrors the backend's own gates so the UI never fires an
// action the backend will refuse: `archive_definition` 409s `not_deprecated`
// from anything but `deprecated`, and there is no archived -> active edge at
// all (unarchive lands on `deprecated`).
import { isArchived } from '../types/designer.ts';
import type { LineageStatus } from '../types/designer.ts';

export type RungKey = 'active' | 'deprecated' | 'archived';
export type RungAction = 'deprecate' | 'reactivate' | 'archive' | 'unarchive';

export interface LadderRung {
  key: RungKey;
  /** The lineage is here now. Renders as a marker, never as a button. */
  current: boolean;
  /** The action that moves the lineage TO this rung. Null on the current rung. */
  action: RungAction | null;
  /** i18n key explaining why `action` is unavailable. Null when it is legal. */
  blockedReasonKey: string | null;
}

const ORDER: RungKey[] = ['active', 'deprecated', 'archived'];

/** Ladder position, collapsing the legacy `retired` alias onto `archived`. */
function positionOf(status: LineageStatus): RungKey {
  if (isArchived(status)) return 'archived';
  return status === 'deprecated' ? 'deprecated' : 'active';
}

export function lifecycleLadder(status: LineageStatus): LadderRung[] {
  const at = positionOf(status);

  return ORDER.map((key) => {
    if (key === at) return { key, current: true, action: null, blockedReasonKey: null };

    if (at === 'active') {
      if (key === 'deprecated') {
        return { key, current: false, action: 'deprecate', blockedReasonKey: null };
      }
      return {
        key,
        current: false,
        action: 'archive',
        blockedReasonKey: 'definitions.ladder.archiveNeedsDeprecated',
      };
    }

    if (at === 'deprecated') {
      return {
        key,
        current: false,
        action: key === 'active' ? 'reactivate' : 'archive',
        blockedReasonKey: null,
      };
    }

    // at === 'archived'
    if (key === 'deprecated') {
      return { key, current: false, action: 'unarchive', blockedReasonKey: null };
    }
    return {
      key,
      current: false,
      action: 'reactivate',
      blockedReasonKey: 'definitions.ladder.reactivateNeedsUnarchive',
    };
  });
}
