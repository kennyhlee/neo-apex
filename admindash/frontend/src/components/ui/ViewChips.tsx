import { useTranslation } from '../../hooks/useTranslation.ts';
import { toneFor } from '../../utils/tone.ts';
import './ViewChips.css';

export interface ViewOption {
  value: string;
  label: string;
  /** Overrides the status-derived tone — used for pipeline stages, where
   *  position in the funnel carries the meaning, not the label. */
  tone?: string;
}

interface ViewChipsProps {
  options: ViewOption[];
  /** Empty string means "all". */
  active: string;
  onPick: (value: string) => void;
  /** value -> count. Null while loading; a missing key hides that chip. */
  counts: Record<string, number> | null;
  /** Total for the "all" chip. */
  total: number;
  allLabel: string;
  ariaLabel: string;
  /** Advanced-filter panel toggle. */
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

/**
 * Saved views as a chip row — the everyday filter.
 *
 * Each chip carries its status tone, so the row reads as the same palette as
 * the Status column beside it. The full column-per-field panel is still one
 * click away rather than permanently occupying the top of the page.
 */
export default function ViewChips({
  options,
  active,
  onPick,
  counts,
  total,
  allLabel,
  ariaLabel,
  showAdvanced,
  onToggleAdvanced,
}: ViewChipsProps) {
  const { t } = useTranslation();

  return (
    <div className="view-chips" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`view-chip${active === '' ? ' is-active' : ''}`}
        aria-pressed={active === ''}
        onClick={() => onPick('')}
      >
        {allLabel}
        <span>{total}</span>
      </button>

      {options.map((opt) => {
        const n = counts?.[opt.value];
        // Once counts are known, a view with nothing in it is noise.
        if (counts && !n) return null;
        return (
          <button
            key={opt.value}
            type="button"
            className={`view-chip view-chip--${opt.tone ?? toneFor(opt.value)}${
              active === opt.value ? ' is-active' : ''
            }`}
            aria-pressed={active === opt.value}
            onClick={() => onPick(opt.value)}
          >
            {opt.label}
            {n != null && <span>{n}</span>}
          </button>
        );
      })}

      <button
        type="button"
        className={`view-chip view-chip-more${showAdvanced ? ' is-active' : ''}`}
        aria-expanded={showAdvanced}
        onClick={onToggleAdvanced}
      >
        {showAdvanced ? t('students.fewerFilters') : t('students.moreFilters')}
      </button>
    </div>
  );
}
