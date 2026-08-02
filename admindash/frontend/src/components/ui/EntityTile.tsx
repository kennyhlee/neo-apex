import { tileTintFor } from '../../utils/tone.ts';
import './EntityTile.css';

interface EntityTileProps {
  /** One or two characters. Two initials read as a person or a thing; one reads as a filing code. */
  initials: string;
  /** What the tint is derived from — usually the full name, so it stays stable. */
  seed: string;
}

/**
 * The identity tile in a name cell. Colour is a stable hash of the seed, so a
 * record always reads the same when scanning; it encodes nothing else.
 */
export default function EntityTile({ initials, seed }: EntityTileProps) {
  return (
    <span className={`entity-tile entity-tile--${tileTintFor(seed)}`} aria-hidden="true">
      {initials}
    </span>
  );
}
