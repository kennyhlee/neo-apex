import { useState, useEffect } from "react";
import type { User, OnboardingStatus, EntityModelDefinition } from "../types/models";
import { getTenantModel, getTenantProfile, updateTenantProfile, markOnboardingStep, useDefaultModel, getExchangeCode, getOnboardingStatus } from "../api/client";
import DynamicEntityForm from "../components/DynamicEntityForm";
import "./OnboardingPage.css";

interface Props {
  user: User;
  onboarding: OnboardingStatus;
  papermiteUrl: string;
  onComplete: () => void;
  onLogout: () => void;
}

export default function OnboardingPage({ user, onboarding, papermiteUrl, onComplete, onLogout }: Props) {
  const [status, setStatus] = useState(onboarding);
  const [model, setModel] = useState<EntityModelDefinition | null>(null);
  const [tenantData, setTenantData] = useState<Record<string, unknown>>({});
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const firstIncomplete = status.steps.findIndex(s => !s.completed);
    setActiveStep(firstIncomplete >= 0 ? firstIncomplete : status.steps.length - 1);
  }, [status]);

  useEffect(() => {
    if (activeStep === 1 && status.steps[0].completed) {
      getTenantModel(user.tenant_id).then(setModel).catch(() => {});
      getTenantProfile(user.tenant_id).then(setTenantData).catch(() => {});
    }
  }, [activeStep, status, user.tenant_id]);

  // Listen for return from Papermite
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("model_setup") === "complete") {
      markOnboardingStep(user.tenant_id, "model_setup").then(s => {
        setStatus(s);
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [user.tenant_id]);

  const handleModelSetup = async () => {
    const code = await getExchangeCode();
    const returnUrl = `${window.location.origin}?model_setup=complete`;
    window.location.href = `${papermiteUrl}/upload?tenant_id=${user.tenant_id}&code=${encodeURIComponent(code)}&return_url=${encodeURIComponent(returnUrl)}`;
  };

  const handleUseDefault = async () => {
    try {
      await useDefaultModel(user.tenant_id);
      const updatedStatus = await getOnboardingStatus(user.tenant_id);
      setStatus(updatedStatus);
    } catch (err) {
      console.error("useDefaultModel failed:", err);
    }
  };

  const handleTenantSave = async (data: Record<string, unknown>) => {
    await updateTenantProfile(user.tenant_id, data);
    const updatedStatus = await markOnboardingStep(user.tenant_id, "tenant_details");
    setStatus(updatedStatus);
    if (updatedStatus.is_complete) onComplete();
  };

  return (
    <div className="onboard">
      <div className="onboard__header">
        <h1 className="onboard__brand">Launchpad</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)" }}>
          <span>{user.tenant_name}</span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--tint-blue-bg)", border: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--tint-blue-text)" }}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <button
            className="onboard__logout"
            onClick={onLogout}
            title="Sign out"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "none", borderRadius: "50%", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="onboard__content">
        <h2 className="onboard__title">Welcome! Let's get you set up.</h2>
        <div className="onboard__stepper">
          {status.steps.map((step, i) => (
            <div key={step.id} className={`onboard__step ${i === activeStep ? "onboard__step--active" : ""} ${step.completed ? "onboard__step--done" : ""}`}>
              <div className="onboard__step-num">{step.completed ? "\u2713" : i + 1}</div>
              <span className="onboard__step-label">{step.label}</span>
            </div>
          ))}
        </div>
        {activeStep === 0 && (
          <div className="onboard__card">
            <h3>Set Up Your Data Model</h3>
            <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>
              Choose how to set up the data model for your organization.
            </p>
            {status.steps[0].completed ? (
              <>
                <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 16 }}>Model setup complete!</div>
                <button className="auth-submit" onClick={() => setActiveStep(1)}>Next</button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button className="auth-submit" onClick={handleModelSetup}>
                  Upload Document
                </button>
                <button className="auth-submit" onClick={handleUseDefault}
                  style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}>
                  Use Default Model
                </button>
                <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
                  You can customize the model later from Tenant Settings.
                </p>
              </div>
            )}
          </div>
        )}
        {activeStep === 1 && (
          <div className="onboard__card">
            <h3>Tenant Details</h3>
            <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>
              Enter your organization's details.
            </p>
            {!status.steps[0].completed ? (
              <div>
                <p style={{ color: "var(--danger)" }}>Please complete model setup first.</p>
                <button className="auth-link" onClick={() => setActiveStep(0)}>Go back to model setup</button>
              </div>
            ) : model ? (
              <DynamicEntityForm model={model} initialData={tenantData} immutableFields={["name", "tenant_id"]} onSave={handleTenantSave} />
            ) : (
              <p>Loading model definition...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
