import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ExtractionResult,
  FinalizePreviewResponse,
  FinalizeCommitResponse,
  ModelDefinition,
  TestUser,
} from "../types/models";
import { getDraft, deleteDraft } from "../db/indexedDb";
import { previewFinalize, commitFinalize } from "../api/client";
import "./FinalizedPage.css";

interface Props {
  user: TestUser;
}

const COLLAPSED_LINES = 5;
const MAX_LINES = 20;

/** Generate a realistic sample value based on field definition. */
function sampleValue(field: { name: string; type: string; options?: string[]; multiple?: boolean }): string {
  const { name, type, options, multiple } = field;
  const n = name.toLowerCase();

  // Selection type — use actual options or show placeholder
  if (type === "selection") {
    if (options && options.length > 0) {
      if (multiple) return options.slice(0, 2).join(", ");
      return options[0];
    }
    return "Option A";
  }

  // Type-driven samples first
  if (type === "bool") return "true";
  if (type === "number") {
    if (n.includes("age")) return "8";
    if (n.includes("grade")) return "3";
    if (n.includes("fee") || n.includes("amount") || n.includes("cost")) return "125.00";
    if (n.includes("capacity") || n.includes("count") || n.includes("size")) return "30";
    return "42";
  }
  if (type === "date") {
    if (n === "dob" || n.includes("birth")) return "2018-03-15";
    if (n.includes("start")) return "2026-09-01";
    if (n.includes("end")) return "2026-06-15";
    return "2026-03-18";
  }
  if (type === "datetime") {
    if (n.includes("created") || n.includes("submitted")) return "2026-03-18T09:30:00Z";
    return "2026-03-18T14:00:00Z";
  }
  if (type === "email") return "maria.j@example.com";
  if (type === "phone") return "(555) 123-4567";

  // Name-driven samples for str type
  if (n === "tenant_id") return "acme-school";
  if (n === "student_id") return "STU-20260012";
  if (n === "family_id") return "FAM-00215";
  if (n === "program_id") return "PRG-SUMMER-26";
  if (n === "application_id") return "APP-2026-0087";
  if (n === "contact_id") return "CON-00291";
  if (n === "school_id") return "SCH-001";
  if (n.endsWith("_id") || n === "id") return "ID-00012";

  if (n === "first_name") return "Maria";
  if (n === "last_name") return "Johnson";
  if (n === "middle_name") return "Rose";
  if (n === "preferred_name") return "Mia";
  if (n === "display_name") return "Acme Afterschool";
  if (n === "name" || n === "program_name") return "Summer Enrichment 2026";
  if (n === "entity_type") return "student";
  if (n === "email" || n === "contact_email") return "maria.j@example.com";
  if (n === "phone" || n === "contact_phone") return "(555) 123-4567";
  if (n === "school_year") return "2025-2026";
  if (n === "gender") return "Female";
  if (n === "grade_level" || n === "grade") return "3rd";
  if (n === "relationship") return "Mother";
  if (n === "family_name") return "Smith Household";
  if (n === "role") return "guardian";
  if (n === "organization") return "Springfield Pediatrics";
  if (n === "primary_email") return "smith@example.com";
  if (n === "primary_phone") return "(555) 234-5678";
  if (n === "primary_address") return "123 Oak St, Springfield, IL 62704";
  if (n === "mailing_address") return "PO Box 456, Springfield, IL 62705";
  if (n === "medical_conditions") return "Seasonal allergies";
  if (n === "status") return "active";

  return "Sample text";
}

function EntityTable({ entityType, def }: { entityType: string; def: ModelDefinition[string] }) {
  const allFields = [
    ...def.base_fields.map((f) => ({ ...f, source: "base" as const })),
    ...def.custom_fields.map((f) => ({ ...f, source: "custom" as const })),
  ];

  return (
    <div className="finalized__entity-table card">
      <div className="finalized__entity-table-header">
        <span className="finalized__entity-table-name">{entityType}</span>
        <span className="finalized__entity-table-count">
          {allFields.length} fields
        </span>
      </div>
      <div className="finalized__entity-table-scroll">
        <table>
          <thead>
            <tr>
              {allFields.map((f) => (
                <th key={f.name}>
                  <div className="finalized__col-header">
                    <code>{f.name}</code>
                    <div className="finalized__col-meta">
                      <span className="finalized__col-type">{f.type}</span>
                      <span className={`badge badge--${f.source === "base" ? "base" : "custom"}`}>
                        {f.source}
                      </span>
                      {f.required && (
                        <span className="finalized__col-req">req</span>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {allFields.map((f) => (
                <td key={f.name}>
                  <span className="finalized__sample-value">
                    {sampleValue(f)}
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FinalizedPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("return_url");
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [status, setStatus] = useState<
    "loading" | "previewing" | "preview" | "unchanged" | "committing" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FinalizePreviewResponse | null>(null);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const previewCalledRef = useRef(false);

  useEffect(() => {
    if (!id || previewCalledRef.current) return;
    previewCalledRef.current = true;
    getDraft(id).then((draft) => {
      if (!draft) {
        navigate("/");
        return;
      }
      setExtraction(draft);
      setStatus("previewing");

      previewFinalize(user.tenant_id, draft)
        .then((res) => {
          setPreview(res);
          if (res.status === "unchanged") {
            setStatus("unchanged");
          } else {
            setStatus("preview");
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Preview failed");
          setStatus("error");
        });
    });
  }, [id, user.tenant_id, navigate]);

  const handleConfirm = async () => {
    if (!extraction) return;
    setStatus("committing");
    try {
      await commitFinalize(user.tenant_id, extraction);
      if (id) deleteDraft(id);
      if (returnUrl) {
        window.location.href = returnUrl;
      } else {
        navigate("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalization failed");
      setStatus("error");
    }
  };

  const handleCancel = () => {
    if (id) deleteDraft(id);
    if (returnUrl) {
      window.location.href = returnUrl;
    } else {
      navigate("/");
    }
  };

  const handleDownload = () => {
    if (!preview) return;
    const downloadData = {
      tenant_id: preview.tenant_id,
      version: preview.version,
      model_definition: preview.model_definition,
      source_filename: preview.source_filename,
    };
    const blob = new Blob([JSON.stringify(downloadData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preview.tenant_id}_model_v${preview.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modelDef = preview?.model_definition;
  const jsonText = modelDef
    ? JSON.stringify(modelDef, null, 2)
    : JSON.stringify(extraction, null, 2);
  const jsonLines = jsonText.split("\n");
  const totalLines = jsonLines.length;
  const visibleLines = jsonExpanded
    ? jsonLines.slice(0, MAX_LINES).join("\n")
    : jsonLines.slice(0, COLLAPSED_LINES).join("\n");
  const canExpand = totalLines > COLLAPSED_LINES;
  const isFullyShown = jsonExpanded
    ? totalLines <= MAX_LINES
    : totalLines <= COLLAPSED_LINES;

  if (status === "loading" || status === "previewing") {
    return (
      <div className="finalized">
        <div className="finalized__loading">
          <div className="spinner spinner--lg" />
          <p className="finalized__loading-text">Preparing preview...</p>
        </div>
      </div>
    );
  }

  if (status === "committing") {
    return (
      <div className="finalized">
        <div className="finalized__loading">
          <div className="spinner spinner--lg" />
          <p className="finalized__loading-text">Saving model...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="finalized">
        <div className="page-header">
          <div className="page-header__eyebrow">Error</div>
          <h1 className="page-header__title">Finalization Failed</h1>
          <p className="page-header__desc">{error}</p>
        </div>
        <div className="finalized__actions">
          <button className="btn" onClick={() => navigate(-1)}>
            &larr; Back to Review
          </button>
        </div>
      </div>
    );
  }

  if (status === "unchanged") {
    return (
      <div className="finalized">
        <div className="finalized__unchanged">
          <div className="finalized__unchanged-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="page-header">
            <div className="page-header__eyebrow">No Changes Detected</div>
            <h1 className="page-header__title">Model Unchanged</h1>
            <p className="page-header__desc">
              The model definition is identical to the current active version (v{preview?.version}).
              No new version will be created.
            </p>
          </div>
        </div>

        {preview && (
          <div className="finalized__meta">
            <div className="finalized__meta-item">
              <span className="finalized__meta-label">Version</span>
              <span className="finalized__meta-version">v{preview.version}</span>
            </div>
            <div className="finalized__meta-item">
              <span className="finalized__meta-label">Active Since</span>
              <span>{preview.created_at ? new Date(preview.created_at).toLocaleString() : "—"}</span>
            </div>
            <div className="finalized__meta-item">
              <span className="finalized__meta-label">Source</span>
              <code>{preview.source_filename}</code>
            </div>
            <div className="finalized__meta-item">
              <span className="finalized__meta-label">Entity Types</span>
              <span>{preview.entity_count}</span>
            </div>
          </div>
        )}

        <div className="finalized__actions">
          <button className="btn" onClick={() => navigate("/")}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // status === "preview" — show proposed changes with confirm/cancel
  return (
    <div className="finalized">
      <div className="finalized__confirm-banner">
        <div className="finalized__confirm-icon">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 12 15 15" />
          </svg>
        </div>
        <div className="page-header">
          <div className="page-header__eyebrow">Step 3 of 3 — Confirm</div>
          <h1 className="page-header__title">Review & Confirm</h1>
          <p className="page-header__desc">
            This will save <strong>version {preview?.version}</strong> of the model
            definition with {preview?.entity_count} entity types for
            tenant <code>{user.tenant_id}</code>.
            Review below and confirm to save, or cancel to discard changes.
          </p>
        </div>
      </div>

      {preview && (
        <div className="finalized__meta">
          <div className="finalized__meta-item">
            <span className="finalized__meta-label">Version</span>
            <span className="finalized__meta-version">v{preview.version}</span>
          </div>
          <div className="finalized__meta-item">
            <span className="finalized__meta-label">Source</span>
            <code>{preview.source_filename}</code>
          </div>
          <div className="finalized__meta-item">
            <span className="finalized__meta-label">Entity Types</span>
            <span>
              {preview.model_definition
                ? Object.keys(preview.model_definition).join(", ")
                : "—"}
            </span>
          </div>
          <div className="finalized__meta-item">
            <span className="finalized__meta-label">Updated By</span>
            <span>{user.name}</span>
          </div>
        </div>
      )}

      {preview?.model_definition && (
        <div className="finalized__tables">
          <div className="finalized__tables-header">
            <span>Entity Summary</span>
          </div>
          <p className="finalized__tables-note">
            Sample data shown below is for preview purposes only and does not represent actual records.
          </p>
          {Object.entries(preview.model_definition).map(([entityType, def]) => (
            <EntityTable key={entityType} entityType={entityType} def={def} />
          ))}
        </div>
      )}

      <div className="finalized__preview card">
        <div className="finalized__preview-header">
          <span>Model Definition (JSON)</span>
          <div className="finalized__preview-actions">
            {canExpand && (
              <button
                className="btn btn--sm"
                onClick={() => setJsonExpanded(!jsonExpanded)}
              >
                {jsonExpanded ? "Collapse" : "Expand"}
              </button>
            )}
            <button className="btn btn--sm" onClick={handleDownload}>
              Download
            </button>
          </div>
        </div>
        <div className="finalized__preview-body">
          <pre className="finalized__preview-code">{visibleLines}</pre>
          {!isFullyShown && (
            <div className="finalized__preview-fade">
              <button
                className="finalized__preview-more"
                onClick={() => setJsonExpanded(!jsonExpanded)}
              >
                {jsonExpanded
                  ? `${totalLines - MAX_LINES} more lines — download for full`
                  : `${totalLines - COLLAPSED_LINES} more lines...`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="finalized__actions">
        <div className="finalized__actions-left">
          <button className="btn" onClick={() => navigate(-1)}>
            &larr; Back to Review
          </button>
          <button className="btn" onClick={handleCancel}>
            Cancel
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={handleConfirm}
        >
          Confirm & Save
        </button>
      </div>
    </div>
  );
}
