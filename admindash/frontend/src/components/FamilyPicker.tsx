import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { searchFamilies } from '../api/client.ts';
import type { Family, FamilyData, FamilySelection } from '../types/models.ts';
import './FamilyPicker.css';

interface FamilyPickerProps {
  tenant: string;
  value: FamilySelection | null;
  onChange: (v: FamilySelection | null) => void;
}

export default function FamilyPicker({ tenant, value, onChange }: FamilyPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Family[]>([]);
  const [open, setOpen] = useState(false);
  const [localDraft, setLocalDraft] = useState<FamilyData>({ family_name: '' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) { setResults([]); return; }
      searchFamilies(tenant, query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tenant]);

  // Derive draft from value when parent controls the new-family selection.
  const draft: FamilyData = value?.mode === 'new' ? value.data : localDraft;
  const creating = value?.mode === 'new';

  function pickExisting(fam: Family) {
    onChange({ mode: 'existing', familyId: fam.entity_id, label: fam.family_name });
    setOpen(false);
    setQuery('');
  }

  function startCreate() {
    const seed: FamilyData = { family_name: query.trim() };
    setLocalDraft(seed);
    onChange({ mode: 'new', data: seed });
    setOpen(false);
  }

  function updateDraft(patch: Partial<FamilyData>) {
    const next = { ...draft, ...patch };
    setLocalDraft(next);
    onChange({ mode: 'new', data: next });
  }

  function clear() {
    onChange(null);
    setLocalDraft({ family_name: '' });
    setQuery('');
  }

  // Selected existing family — show a chip.
  if (value?.mode === 'existing') {
    return (
      <div className="family-picker">
        <label className="family-picker-label">{t('familyPicker.label')}</label>
        <div className="family-picker-chip">
          <span>{value.label}</span>
          <button type="button" onClick={clear}>{t('familyPicker.clear')}</button>
        </div>
      </div>
    );
  }

  // Creating a new family — inline mini-form.
  if (creating) {
    return (
      <div className="family-picker">
        <label className="family-picker-label">
          {t('familyPicker.label')} · {t('familyPicker.creatingNew')}
          <button type="button" className="family-picker-link" onClick={clear}>{t('familyPicker.clear')}</button>
        </label>
        <div className="family-picker-newform">
          <input
            type="text" placeholder={t('familyPicker.newFamilyName')}
            value={draft.family_name}
            onChange={(e) => updateDraft({ family_name: e.target.value })}
          />
          <input
            type="email" placeholder={t('familyPicker.newEmail')}
            value={draft.primary_email ?? ''}
            onChange={(e) => updateDraft({ primary_email: e.target.value })}
          />
          <input
            type="tel" placeholder={t('familyPicker.newPhone')}
            value={draft.primary_phone ?? ''}
            onChange={(e) => updateDraft({ primary_phone: e.target.value })}
          />
          <input
            type="text" placeholder={t('familyPicker.newAddress')}
            value={draft.primary_address ?? ''}
            onChange={(e) => updateDraft({ primary_address: e.target.value })}
          />
        </div>
      </div>
    );
  }

  // Default — search combobox.
  return (
    <div className="family-picker">
      <label className="family-picker-label">{t('familyPicker.label')}</label>
      <input
        type="text"
        className="family-picker-search"
        placeholder={t('familyPicker.searchPlaceholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <ul className="family-picker-results">
          {results.map((fam) => (
            <li key={fam.entity_id}>
              <button type="button" onClick={() => pickExisting(fam)}>
                <strong>{fam.family_name}</strong>
                {fam.primary_email ? <span> · {fam.primary_email}</span> : null}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="family-picker-empty">{t('familyPicker.noResults')}</li>
          )}
          <li className="family-picker-create">
            <button type="button" onClick={startCreate}>{t('familyPicker.createNew')}</button>
          </li>
        </ul>
      )}
    </div>
  );
}
