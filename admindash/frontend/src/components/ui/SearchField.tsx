import { useTranslation } from '../../hooks/useTranslation.ts';
import './SearchField.css';

interface SearchFieldProps {
  id: string;
  value: string;
  placeholder: string;
  /** Fires on every keystroke. */
  onChange: (value: string) => void;
  /** Fires on submit, and whenever the field is emptied. */
  onCommit: (value: string) => void;
}

/**
 * One search box in place of a column-per-field filter panel.
 *
 * Emptying the field commits immediately, so the full list comes back without
 * pressing Enter — otherwise a cleared box leaves the list filtered by a term
 * that is no longer on screen.
 */
export default function SearchField({
  id,
  value,
  placeholder,
  onChange,
  onCommit,
}: SearchFieldProps) {
  const { t } = useTranslation();

  function handleChange(next: string) {
    onChange(next);
    if (next.trim() === '' && value.trim() !== '') onCommit('');
  }

  return (
    <form
      className="search-field"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onCommit(value);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {placeholder}
      </label>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-field-clear"
          onClick={() => onCommit('')}
          aria-label={t('students.clearSearch')}
        >
          &times;
        </button>
      )}
    </form>
  );
}
