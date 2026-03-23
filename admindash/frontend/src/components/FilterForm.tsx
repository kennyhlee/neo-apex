import { type FormEvent, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './FilterForm.css';

interface FilterFormProps {
  children: ReactNode;
  onSearch: () => void;
  onReset: () => void;
}

export default function FilterForm({
  children,
  onSearch,
  onReset,
}: FilterFormProps) {
  const { t } = useTranslation();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSearch();
  }

  return (
    <form className="filter-card" onSubmit={handleSubmit}>
      <div className="filter-grid">{children}</div>
      <div className="filter-actions">
        <button
          type="button"
          className="filter-btn filter-btn-secondary"
          onClick={onReset}
        >
          {t('students.reset')}
        </button>
        <button type="submit" className="filter-btn filter-btn-primary">
          {t('students.search')}
        </button>
      </div>
    </form>
  );
}
