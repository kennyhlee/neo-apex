import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TestUser, TenantModel } from "../types/models";
import {
  getAvailableModels,
  getActiveModel,
  uploadDocument,
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
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
    if (!file) return;
    setLoading(true);
    setError(null);
    setShowConfirm(false);
    try {
      const result = await uploadDocument(user.tenant_id, file, selectedModel);
      await saveDraft(result);
      navigate(`/review/${result.extraction_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    if (existingModel) {
      setShowConfirm(true);
    } else {
      doUpload();
    }
  };

  return (
    <div className="upload-page">
      <div className="page-header">
        <div className="page-header__eyebrow">Step 1 of 3</div>
        <h1 className="page-header__title">Upload Document</h1>
        <p className="page-header__desc">
          Upload your afterschool policy or application template. The AI will
          extract entities and map them to the data model.
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
              Active model exists
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
        <FileUploader onFileSelect={setFile} disabled={loading} />

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
              disabled={!file || loading}
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
