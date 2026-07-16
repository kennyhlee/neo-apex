import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TestUser, TenantModel } from "../types/models";
import {
  getAvailableModels,
  getActiveModel,
  uploadDocuments,
  mergeExtractionResults,
  modelToExtraction,
} from "../api/client";
import { saveDraft } from "../db/indexedDb";
import TenantInfo from "../components/TenantInfo";
import FileUploader from "../components/FileUploader";
import ModelSelector from "../components/ModelSelector";
import "../components/TenantInfo.css";
import "../components/ModelSelector.css";
import "./UploadPage.css";

interface Props {
  user: TestUser;
}

export default function UploadPage({ user }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("return_url");
  const tenantIdParam = searchParams.get("tenant_id");
  const isAppend = searchParams.get("mode") === "append";
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingModel, setExistingModel] = useState<TenantModel | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    getAvailableModels().then((cfg) => {
      setModels(cfg.models);
      setSelectedModel(cfg.default);
    });
    getActiveModel(user.tenant_id).then(setExistingModel).catch(() => {});
  }, [user.tenant_id]);

  const doUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setShowConfirm(false);
    try {
      const extracted = await uploadDocuments(
        tenantIdParam || user.tenant_id,
        files,
        selectedModel
      );
      // Append mode merges the new extraction into the existing model so the
      // review reflects existing fields ∪ newly-discovered ones.
      const result =
        isAppend && existingModel
          ? mergeExtractionResults(modelToExtraction(existingModel), extracted)
          : extracted;
      await saveDraft(result);
      const forwardParams = new URLSearchParams();
      if (returnUrl) forwardParams.set("return_url", returnUrl);
      const qs = forwardParams.toString();
      navigate(`/review/${result.extraction_id}${qs ? `?${qs}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = () => {
    if (files.length === 0) return;
    // Append merges into the existing model (no replace prompt). A plain upload
    // over an existing model still confirms the replace.
    if (existingModel && !isAppend) {
      setShowConfirm(true);
    } else {
      doUpload();
    }
  };

  return (
    <div className="upload-page">
      <div className="page-header">
        <div className="page-header__eyebrow">Step 1 of 3</div>
        <h1 className="page-header__title">
          {isAppend ? "Add Documents to Model" : "Upload Documents"}
        </h1>
        <p className="page-header__desc">
          {isAppend
            ? "Upload one or more additional documents. The AI extracts them and merges any newly-discovered fields into your existing model for review."
            : "Upload one or more afterschool policy or application templates. The AI will extract entities and map them to the data model."}
        </p>
      </div>

      <TenantInfo user={user} compact />

      {existingModel && (
        <div className="upload-page__existing-model">
          <div className="upload-page__existing-model-icon">
            <svg
              width="16"
              height="16"
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
          <div className="upload-page__existing-model-text">
            <span className="upload-page__existing-model-label">
              {isAppend ? "Merging into active model" : "Active model exists"}
            </span>
            <span className="upload-page__existing-model-detail">
              Source: <code>{existingModel.source_filename}</code> &middot;
              Created:{" "}
              {new Date(existingModel.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      <div className="upload-page__form">
        <FileUploader onFilesChange={setFiles} disabled={loading} />

        <div className="upload-page__options">
          <ModelSelector
            models={models}
            selected={selectedModel}
            onChange={setSelectedModel}
          />

          <div className="upload-page__buttons">
            <button
              className="btn"
              onClick={() => navigate("/")}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="btn btn--primary"
              onClick={handleUpload}
              disabled={files.length === 0 || loading}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Extracting...
                </>
              ) : (
                "Extract Entities"
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="upload-page__error">
            <span className="upload-page__error-icon">!</span>
            {error}
          </div>
        )}
      </div>

      {loading && (
        <div className="upload-page__progress">
          <div className="upload-page__progress-bar">
            <div className="upload-page__progress-fill" />
          </div>
          <p className="upload-page__progress-text">
            Parsing document and extracting entities...
          </p>
        </div>
      )}

      {showConfirm && (
        <div className="upload-page__overlay">
          <div className="upload-page__confirm card">
            <h3 className="upload-page__confirm-title">
              Replace Existing Model?
            </h3>
            <p className="upload-page__confirm-text">
              An existing model definition will be archived and replaced with a
              new version extracted from your uploaded document.
            </p>
            {existingModel && (
              <div className="upload-page__confirm-detail">
                <span>
                  Current: <code>{existingModel.source_filename}</code>
                </span>
                <span>
                  Created:{" "}
                  {new Date(existingModel.created_at).toLocaleDateString()}
                </span>
              </div>
            )}
            <div className="upload-page__confirm-actions">
              <button
                className="btn"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button className="btn btn--primary" onClick={doUpload}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
