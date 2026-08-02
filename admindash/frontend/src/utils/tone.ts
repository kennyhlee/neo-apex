import { toToneKey } from './listValue.ts';

/**
 * One tone vocabulary for the whole product.
 *
 * StatusBadge and the saved-view chips previously kept separate maps with
 * different member names, so a value could be green in the table and neutral
 * in the chip above it. Both now read from here.
 */
export type Tone = 'ok' | 'attn' | 'info' | 'risk' | 'away' | 'neutral';

const TONE_BY_STATUS: Record<string, Tone> = {
  // Present and in good standing
  active: 'ok',
  enrolled: 'ok',
  registered: 'ok',
  attending: 'ok',
  open: 'ok',
  confirmed: 'ok',
  approved: 'ok',

  // Needs a person to do something
  on_leave: 'attn',
  waitlisted: 'attn',
  pending: 'attn',
  applied: 'attn',
  incomplete: 'attn',
  full: 'attn',
  draft: 'attn',
  overdue: 'attn',

  // Informational, no action implied
  upcoming: 'info',
  scheduled: 'info',
  suspended: 'info',
  graduated: 'info',
  alumni: 'info',
  paused: 'info',
  completed: 'info',
  closed: 'info',
  archived: 'info',
  ended: 'info',

  // Gone, or gone wrong
  dropped: 'risk',
  dropped_out: 'risk',
  withdrawn: 'risk',
  inactive: 'risk',
  transferred: 'risk',
  cancelled: 'risk',
  canceled: 'risk',
  lost: 'risk',
  rejected: 'risk',
  expired: 'risk',
};

/**
 * Tones used for values the map doesn't know, so distinct values still read as
 * distinct. Deliberately excludes `ok` and `risk` — guessing "good" or "bad"
 * for an unrecognised status would be worse than saying nothing.
 */
const UNKNOWN_TONES: Tone[] = ['info', 'neutral', 'away'];

/** Stable positive hash, so the same input always picks the same slot. */
export function hashIndex(seed: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % buckets;
}

/** Resolve any status value — wrapped or plain — to a tone. */
export function toneFor(status: unknown): Tone {
  const key = toToneKey(status);
  if (!key) return 'neutral';
  return TONE_BY_STATUS[key] ?? UNKNOWN_TONES[hashIndex(key, UNKNOWN_TONES.length)];
}

/** Tints for identity tiles. Carries no meaning — it only aids recognition. */
export const TILE_TINTS = ['pine', 'slate', 'clay', 'plum', 'teal', 'moss'] as const;

export function tileTintFor(seed: string): string {
  return TILE_TINTS[hashIndex(seed, TILE_TINTS.length)];
}
