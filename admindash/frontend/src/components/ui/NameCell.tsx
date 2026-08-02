import type { ReactNode } from 'react';
import EntityTile from './EntityTile.tsx';
import './NameCell.css';

interface NameCellProps {
  name: string;
  initials: string;
  /** What a colleague would say next: "Goes by Ama · age 10", "Mon, Wed · 4:00pm". */
  secondary?: ReactNode;
}

/**
 * The primary cell in a list: identity tile, the name, and one line of the
 * context that makes the row recognisable. Shared by students and programs so
 * the two lists read as the same product.
 */
export default function NameCell({ name, initials, secondary }: NameCellProps) {
  return (
    <div className="name-cell">
      <EntityTile initials={initials} seed={name} />
      <span className="name-cell-info">
        <span className="name-cell-title">{name}</span>
        {secondary ? <span className="name-cell-secondary">{secondary}</span> : null}
      </span>
    </div>
  );
}
