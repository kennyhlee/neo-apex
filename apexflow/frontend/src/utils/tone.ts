/**
 * Ported from admindash/frontend/src/utils/tone.ts (interface map §1f).
 * Trimmed to StatusBadge's needs (stage/tile helpers dropped — not used
 * outside admindash's Leads pipeline).
 */
import { toToneKey } from './listValue.ts';

export type Tone = 'ok' | 'attn' | 'info' | 'risk' | 'away' | 'neutral';

const TONE_BY_STATUS: Record<string, Tone> = {
  // Present and in good standing
  active: 'ok',
  published: 'ok',
  current: 'ok',
  open: 'ok',
  confirmed: 'ok',
  approved: 'ok',

  // Needs a person to do something
  draft: 'attn',
  pending: 'attn',
  stale: 'attn',
  pending_items: 'attn',

  // Informational, no action implied
  superseded: 'info',
  scheduled: 'info',
  paused: 'info',
  completed: 'info',
  closed: 'info',

  // Gone, or gone wrong
  broken: 'risk',
  retired: 'risk',
  rejected: 'risk',
  expired: 'risk',
  deprecated: 'risk',
};

/**
 * Tones used for values the map doesn't know, so distinct values still read
 * as distinct. Deliberately excludes `ok` and `risk` — guessing "good" or
 * "bad" for an unrecognised status would be worse than saying nothing.
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
