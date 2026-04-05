import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TestUser, TenantModel } from "../types/models";
import { getActiveModel, modelToExtraction } from "../api/client";
import { saveDraft } from "../db/indexedDb";
import TenantInfo from "../components/TenantInfo";
import "../components/TenantInfo.css";
import "./LandingPage.css";

interface Props {
  user: TestUser;
}

export default function LandingPage({ user }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const returnUrl = searchParams.get("return_url");
  const [model, setModel] = useState<TenantModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getActiveModel(user.tenant_id)
      .then(setModel)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user.tenant_id]);

  const forwardQs = returnUrl ? `?return_url=${encodeURIComponent(returnUrl)}` : "";

  const handleEditModel = async () => {
    if (!model) return;
    const extraction = modelToExtraction(model);
    await saveDraft(extraction);
    navigate(`/review/${extraction.extraction_id}${forwardQs}`);
  };

  if (loading) {
    return (
      <div className="landing">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "64px",
          }}
        >
          <div className="spinner spinner--lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="page-header">
        <div className="page-header__eyebrow">Admin Console</div>
        <h1 className="page-header__title">Model Setup</h1>
        <p className="page-header__desc">
          {model
            ? "Your tenant has an active data model. You can edit it manually or upload a new document to revise it."
            : "No data model defined yet. Upload a policy or application template document to get started."}
        </p>
      </div>

      <TenantInfo user={user} />

      {model && model.model_definition ? (
        <>
          <div className="landing__model card">
            <div className="landing__model-header">
              <div className="landing__model-status">
                <span className="landing__model-dot" />
                Active Model
                <span className="landing__model-version">v{model.version}</span>
              </div>
              <span className="landing__model-date">
                {new Date(model.created_at).toLocaleString()}
              </span>
            </div>
            <div className="landing__model-body">
              <div className="landing__model-detail">
                <span className="landing__model-label">Source</span>
                <code>{model.source_filename}</code>
              </div>
              <div className="landing__model-detail">
                <span className="landing__model-label">Updated By</span>
                <span>{model.created_by}</span>
              </div>
              <div className="landing__model-detail">
                <span className="landing__model-label">Entity Types</span>
                <span className="landing__model-entities">
                  {Object.keys(model.model_definition).map((type) => (
                    <span key={type} className="badge badge--base">
                      {type}
                    </span>
                  ))}
                </span>
              </div>
              <div className="landing__model-detail">
                <span className="landing__model-label">Fields</span>
                <span>
                  {Object.values(model.model_definition).reduce(
                    (sum, def) =>
                      sum + def.base_fields.length + def.custom_fields.length,
                    0
                  )}{" "}
                  total (
                  {Object.values(model.model_definition).reduce(
                    (sum, def) => sum + def.custom_fields.length,
                    0
                  )}{" "}
                  custom)
                </span>
              </div>
            </div>
          </div>

          <div className="landing__actions">
            <div
              className="landing__action-card card"
              onClick={handleEditModel}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && handleEditModel()}
            >
              <div className="landing__action-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <div className="landing__action-content">
                <h3 className="landing__action-title">Edit Model</h3>
                <p className="landing__action-desc">
                  Manually add, remove, or modify fields in the current model
                  definition.
                </p>
              </div>
              <div className="landing__action-arrow">&rarr;</div>
            </div>

            <div
              className="landing__action-card card"
              onClick={() => navigate(`/upload${forwardQs}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/upload${forwardQs}`)}
            >
              <div className="landing__action-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9 15 12 12 15 15" />
                </svg>
              </div>
              <div className="landing__action-content">
                <h3 className="landing__action-title">Upload New Document</h3>
                <p className="landing__action-desc">
                  Upload a revised document to re-extract and update the model.
                  The current version will be archived.
                </p>
              </div>
              <div className="landing__action-arrow">&rarr;</div>
            </div>
          </div>
        </>
      ) : (
        <div className="landing__actions">
          <div
            className="landing__action-card card"
            onClick={() => navigate(`/upload${forwardQs}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && navigate(`/upload${forwardQs}`)}
          >
            <div className="landing__action-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
            </div>
            <div className="landing__action-content">
              <h3 className="landing__action-title">Upload Document</h3>
              <p className="landing__action-desc">
                Upload a policy or application template to extract and define
                your tenant's data model.
              </p>
            </div>
            <div className="landing__action-arrow">&rarr;</div>
          </div>
        </div>
      )}

      <div className="landing__meta">
        <div className="landing__meta-item">
          <span className="landing__meta-label">Role</span>
          <span className="badge badge--base">{user.role}</span>
        </div>
        <div className="landing__meta-item">
          <span className="landing__meta-label">Status</span>
          <span className="landing__meta-value">
            {model ? "Model active" : "No model"}
          </span>
        </div>
      </div>
    </div>
  );
}
