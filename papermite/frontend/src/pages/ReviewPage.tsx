import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { EntityResult, ExtractionResult } from "../types/models";
import { getDraft, saveDraft } from "../db/indexedDb";
import EntityCard from "../components/EntityCard";
import "./ReviewPage.css";

/** Compare field_mappings to detect changes (ignores values, checks structure + required). */
function hasChanges(original: ExtractionResult, current: ExtractionResult): boolean {
  if (original.entities.length !== current.entities.length) return true;
  for (let i = 0; i < original.entities.length; i++) {
    const origEntity = original.entities[i];
    const currEntity = current.entities[i];
    if (origEntity.entity_type !== currEntity.entity_type) return true;
    if (origEntity.field_mappings.length !== currEntity.field_mappings.length) return true;
    for (let j = 0; j < origEntity.field_mappings.length; j++) {
      const om = origEntity.field_mappings[j];
      const cm = currEntity.field_mappings[j];
      if (om.field_name !== cm.field_name) return true;
      if (om.source !== cm.source) return true;
      if (om.required !== cm.required) return true;
      if (om.field_type !== cm.field_type) return true;
      if (JSON.stringify(om.options ?? []) !== JSON.stringify(cm.options ?? [])) return true;
      if ((om.multiple ?? false) !== (cm.multiple ?? false)) return true;
    }
  }
  return false;
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [showSource, setShowSource] = useState(false);
  const originalRef = useRef<ExtractionResult | null>(null);

  const isEditMode = extraction?.extraction_id.startsWith("edit-") ?? false;
  const changed = extraction && originalRef.current
    ? hasChanges(originalRef.current, extraction)
    : !isEditMode;

  useEffect(() => {
    if (id) {
      getDraft(id).then((draft) => {
        if (draft) {
          setExtraction(draft);
          if (!originalRef.current) {
            originalRef.current = JSON.parse(JSON.stringify(draft));
          }
        } else {
          navigate("/");
        }
      });
    }
  }, [id, navigate]);

  const handleEntityUpdate = (index: number, updated: EntityResult) => {
    if (!extraction) return;
    const newEntities = [...extraction.entities];
    newEntities[index] = updated;
    const newExtraction = { ...extraction, entities: newEntities };
    setExtraction(newExtraction);
    saveDraft(newExtraction);
  };

  const handleFinalize = () => {
    if (extraction) {
      navigate(`/finalize/${extraction.extraction_id}`);
    }
  };

  if (!extraction) {
    return (
      <div className="review-loading">
        <div className="spinner spinner--lg" />
      </div>
    );
  }

  const baseCount = extraction.entities.reduce(
    (sum, e) => sum + e.field_mappings.filter((m) => m.source === "base_model").length,
    0
  );
  const customCount = extraction.entities.reduce(
    (sum, e) => sum + e.field_mappings.filter((m) => m.source === "custom_field").length,
    0
  );

  return (
    <div className={`review ${showSource ? "review--with-source" : ""}`}>
      <div className="review__main">
        <div className="page-header">
          <div className="page-header__eyebrow">
            {isEditMode ? "Edit Model" : "Step 2 of 3"}
          </div>
          <h1 className="page-header__title">
            {isEditMode ? "Edit Model Definition" : "Review Extraction"}
          </h1>
          <p className="page-header__desc">
            {isEditMode
              ? "Modify fields, toggle required status, or add custom fields. Finalize when ready."
              : "Review the extracted entities. Edit values, add or remove custom fields, then finalize."}
          </p>
        </div>

        <div className="review__stats">
          <div className="review__stat">
            <span className="review__stat-value">
              {extraction.entities.length}
            </span>
            <span className="review__stat-label">Entities</span>
          </div>
          <div className="review__stat">
            <span className="review__stat-value">{baseCount}</span>
            <span className="review__stat-label">Base Fields</span>
          </div>
          <div className="review__stat">
            <span className="review__stat-value">{customCount}</span>
            <span className="review__stat-label">Custom Fields</span>
          </div>
          <div className="review__stat">
            <span className="review__stat-label-mono">
              {extraction.filename}
            </span>
          </div>
        </div>

        <div className="review__toolbar">
          <button className="btn btn--sm" onClick={() => navigate(-1)}>
            &larr; Back
          </button>
          <div className="review__toolbar-right">
            {!isEditMode && (
              <button
                className={`btn btn--sm ${showSource ? "btn--primary" : ""}`}
                onClick={() => setShowSource(!showSource)}
              >
                {showSource ? "Hide" : "Show"} Source
              </button>
            )}
            <button
              className="btn btn--primary"
              onClick={handleFinalize}
              disabled={isEditMode && !changed}
              title={isEditMode && !changed ? "No changes detected" : undefined}
            >
              Finalize Model &rarr;
            </button>
          </div>
        </div>

        {isEditMode && !changed && (
          <div className="review__no-changes">
            No changes detected. Modify fields to enable finalization.
          </div>
        )}

        <div className="review__entities">
          {extraction.entities.map((entity, idx) => (
            <EntityCard
              key={`${entity.entity_type}-${idx}`}
              entity={entity}
              index={idx}
              onUpdate={handleEntityUpdate}
            />
          ))}
        </div>
      </div>

      {showSource && !isEditMode && (
        <div className="review__source">
          <div className="review__source-header">
            <span>Source Document</span>
            <button
              className="btn btn--sm"
              onClick={() => setShowSource(false)}
            >
              &times;
            </button>
          </div>
          <pre className="review__source-text">{extraction.raw_text}</pre>
        </div>
      )}
    </div>
  );
}
