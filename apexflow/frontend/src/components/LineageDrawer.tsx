// One workflow lineage, whole.
//
// The list used to render a lineage as two rows — published and draft — with
// different action sets, so "the workflow" had no single place to act on. This
// drawer is that place: both versions listed together, the lineage-level facts
// once, and the lifecycle as a ladder.
//
// Chrome is the shared `Modal variant="drawer"`, which already existed here
// unused (`styles/modal.css`) and is what all six AdminDash drawers use. Open
// state is held by the caller rather than routed, matching them.
//
// Raises intent only: every confirm modal, API call, toast, and reload stays in
// DefinitionsPage, so destructive confirmation lives in exactly one place.
import { useTranslation } from '../hooks/useTranslation.ts';
import { isArchived } from '../types/designer.ts';
import type { DefinitionListEntry } from '../types/designer.ts';
import type { LineageRow } from '../utils/lineage.ts';
import { lifecycleLadder, type RungAction, type RungKey } from '../utils/lifecycleLadder.ts';
import { Modal } from './ui/Modal.tsx';
import { Button } from './ui/Button.tsx';
import StatusBadge from './StatusBadge.tsx';
import './LineageDrawer.css';

export interface LineageDrawerProps {
  row: LineageRow | null;
  onClose: () => void;
  onOpenEditor: (entityId: string) => void;
  onAction: (entityId: string, action: RungAction) => void;
  onDeleteDraft: (entry: DefinitionListEntry) => void;
  onNewDraft: (entityId: string) => void;
  busy?: boolean;
  /** True only while a `new_draft` call is actually in flight — narrower than
   * `busy`, which disables every button in the drawer during ANY mutation.
   * Drives the New version button's own loading label, not just whether it's
   * clickable, so a slow request reads as "working" rather than as a button
   * that stopped responding. */
  newDraftBusy?: boolean;
}

/** Label + hint i18n keys per rung, so the ladder reads as an explanation
 * rather than three bare verbs. */
const RUNG_TEXT: Record<RungKey, { label: string; hint: string }> = {
  active: { label: 'definitions.ladder.active', hint: 'definitions.ladder.activeHint' },
  deprecated: { label: 'definitions.ladder.deprecated', hint: 'definitions.ladder.deprecatedHint' },
  archived: { label: 'definitions.ladder.archived', hint: 'definitions.ladder.archivedHint' },
};

const ACTION_LABEL: Record<RungAction, string> = {
  deprecate: 'definitions.actions.deprecate',
  reactivate: 'definitions.actions.reactivate',
  archive: 'definitions.actions.retire',
  unarchive: 'definitions.actions.unarchive',
};

export default function LineageDrawer({
  row, onClose, onOpenEditor, onAction, onDeleteDraft, onNewDraft, busy = false, newDraftBusy = false,
}: LineageDrawerProps) {
  const { t } = useTranslation();
  if (!row) return null;

  /** `health` and `lineage_status` arrive as raw wire enums ("healthy",
   * "deprecated") which are not themselves user-facing copy. Same lookup
   * DefinitionsPage does, falling back to the raw value rather than to a
   * literal i18n key when a value isn't in the map. */
  const badgeLabel = (prefix: 'lineageStatus' | 'health', value: string): string => {
    const key = `definitions.${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  const archived = isArchived(row.lineage_status);
  // Every lifecycle action targets the published row — `_require_published_row`
  // 409s on anything else — so a never-published lineage has no ladder at all.
  const lifecycleTarget = row.published?.entity_id ?? null;
  const rungs = lifecycleLadder(row.lineage_status);

  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      title={row.name}
      subtitle={row.definition_id}
    >
      <div className="lineage-drawer">

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.versions')}</h3>

          {row.draft && (
            <div className="lineage-version-row">
              <StatusBadge
                status="draft"
                label={t('definitions.drawer.draftVersion').replace('{v}', String(row.draft.version))}
              />
              <div className="lineage-version-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDeleteDraft(row.draft!)}
                >
                  {t('definitions.actions.delete')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenEditor(row.draft!.entity_id)}
                >
                  {t('definitions.actions.open')}
                </Button>
              </div>
            </div>
          )}

          {row.published && (
            <div className="lineage-version-row">
              <span className="lineage-version-label">
                <StatusBadge
                  status="published"
                  label={t('definitions.drawer.publishedVersion')
                    .replace('{v}', String(row.published.version))}
                />
                <span className="lineage-version-note">{t('definitions.drawer.live')}</span>
              </span>
              <div className="lineage-version-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenEditor(row.published!.entity_id)}
                >
                  {t('definitions.actions.open')}
                </Button>
              </div>
            </div>
          )}

          {/* Hidden while a draft exists: discarding must be a deliberate act,
              not a side effect of clicking "New version". Hidden when archived
              because a copy would carry `archived` onto a fresh draft. */}
          {row.published && !row.draft && !archived && (
            <div className="lineage-drawer-newdraft">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                loading={newDraftBusy}
                loadingText={t('definitions.newDraftCreating')}
                onClick={() => onNewDraft(row.published!.entity_id)}
              >
                {t('definitions.actions.newDraft')}
              </Button>
            </div>
          )}
          {row.published && !row.draft && archived && (
            <p className="lineage-drawer-note">
              {t('definitions.drawer.newDraftBlockedArchived')}
            </p>
          )}
        </section>

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.facts')}</h3>
          <dl className="lineage-facts">
            <dt>{t('definitions.drawer.health')}</dt>
            <dd><StatusBadge status={row.health} label={badgeLabel('health', row.health)} /></dd>

            <dt>{t('definitions.drawer.channel')}</dt>
            <dd>
              {t(row.channel_access === 'family'
                ? 'definitions.channel.family'
                : 'definitions.channel.staffOnly')}
              {row.family_url ? (
                <a
                  className="lineage-family-link"
                  href={row.family_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t('definitions.channel.familyLinkLabel')}
                >
                  ↗
                </a>
              ) : null}
            </dd>

            {/* An archived lineage's in-flight work is frozen, not open —
                calling it "open" would misdescribe what those items are. */}
            <dt>
              {t(archived ? 'definitions.drawer.frozenItems' : 'definitions.drawer.openItems')}
            </dt>
            <dd>{row.open_instances}</dd>
          </dl>
        </section>

        <section className="lineage-drawer-section">
          <h3 className="lineage-drawer-heading">{t('definitions.drawer.lifecycle')}</h3>

          {lifecycleTarget === null ? (
            <p className="lineage-drawer-note">
              {t('definitions.drawer.lifecycleAfterPublish')}
            </p>
          ) : (
            <ol className="lineage-ladder">
              {rungs.map((rung) => (
                <li
                  key={rung.key}
                  className={[
                    'lineage-rung',
                    rung.current ? 'is-current' : '',
                    rung.blockedReasonKey ? 'is-blocked' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="lineage-rung-text">
                    <b>{t(RUNG_TEXT[rung.key].label)}</b>
                    <small>
                      {rung.blockedReasonKey
                        ? t(rung.blockedReasonKey)
                        : t(RUNG_TEXT[rung.key].hint)}
                    </small>
                  </span>
                  {rung.current ? (
                    <span className="lineage-rung-current">{t('definitions.ladder.current')}</span>
                  ) : (
                    <Button
                      variant={rung.key === 'archived' ? 'danger' : 'secondary'}
                      size="sm"
                      disabled={busy || rung.blockedReasonKey !== null}
                      onClick={() => onAction(lifecycleTarget, rung.action!)}
                    >
                      {t(ACTION_LABEL[rung.action!])}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

      </div>
    </Modal>
  );
}
