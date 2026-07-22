import { useState, useEffect } from "react";
import type { User, EntityModelDefinition } from "../types/models";
import { getTenantModel, getTenantProfile, updateTenantProfile, getTenantModelInfo, getTenantModelEntities, getExchangeCode, syncDefaultModel } from "../api/client";
import { PAPERMITE_FRONTEND_URL } from "../config";
import DynamicEntityForm from "../components/DynamicEntityForm";

interface Props { user: User; }

const btnPrimary: React.CSSProperties = { padding: "8px 16px", fontSize: 14, background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)" };
const btnSecondary: React.CSSProperties = { padding: "8px 16px", fontSize: 14, background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)" };
const card: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-lg)", padding: 32, boxShadow: "var(--shadow-card)", maxWidth: 600 };

type ModelEntity = { base_fields: { name: string }[]; custom_fields: { name: string }[] };
type ModelDefinition = Record<string, ModelEntity>;

export default function TenantSettingsPage({ user }: Props) {
  const [model, setModel] = useState<EntityModelDefinition | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [modelInfo, setModelInfo] = useState<{ version: number; change_id: string; created_at: string; updated_at: string } | null>(null);
  const [modelDefinition, setModelDefinition] = useState<ModelDefinition | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const isAdmin = user.role === "admin";

  useEffect(() => {
    getTenantModel(user.tenant_id).then(setModel);
    getTenantProfile(user.tenant_id).then(setData);
    getTenantModelInfo(user.tenant_id).then(info => {
      if (info) {
        setModelInfo({ version: info.version, change_id: info.change_id, created_at: info.created_at, updated_at: info.updated_at });
      }
    }).catch(() => {});
    getTenantModelEntities(user.tenant_id).then(setModelDefinition).catch(() => {});
  }, [user.tenant_id]);

  const handleEditModel = async () => {
    const code = await getExchangeCode();
    const returnUrl = `${window.location.origin}/settings/tenant`;
    window.location.href = `${PAPERMITE_FRONTEND_URL}/?tenant_id=${user.tenant_id}&code=${encodeURIComponent(code)}&return_url=${encodeURIComponent(returnUrl)}`;
  };

  const handleSyncDefaults = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const { added } = await syncDefaultModel(user.tenant_id);
      const info = await getTenantModelInfo(user.tenant_id);
      if (info) {
        setModelInfo({ version: info.version, change_id: info.change_id, created_at: info.created_at, updated_at: info.updated_at });
      }
      setModelDefinition(await getTenantModelEntities(user.tenant_id));
      setSyncMessage(added.length ? `Added: ${added.join(", ")}` : "Model already up to date.");
    } catch {
      setSyncMessage("Failed to sync default entities.");
    } finally {
      setSyncing(false);
    }
  };

  if (!model) return <p>Loading...</p>;

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 24 }}>Tenant Settings</h2>

      <div style={card}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 20px" }}>Tenant Info</h3>
        <div className="auth-field" style={{ marginBottom: 20 }}>
          <label className="auth-label">Tenant ID</label>
          <div style={{ padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", fontSize: 15, fontFamily: "monospace" }}>
            {user.tenant_id}
          </div>
        </div>
        <DynamicEntityForm
          model={model}
          initialData={data}
          readOnly={!editing}
          immutableFields={["name", "tenant_id"]}
          onSave={async (updated) => {
            await updateTenantProfile(user.tenant_id, updated);
            setData(updated);
            setSaved(true);
            setEditing(false);
            setTimeout(() => setSaved(false), 2000);
          }}
        />
        {saved && <p style={{ color: "var(--success)", marginTop: 12 }}>Saved!</p>}
        {isAdmin && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            {editing ? (
              <button onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
            ) : (
              <button onClick={() => setEditing(true)} style={btnPrimary}>Edit</button>
            )}
          </div>
        )}
      </div>

      {modelInfo && (
        <div style={{ ...card, marginTop: 32 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 16px" }}>Data Model</h3>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 14 }}>
            <span style={{ color: "var(--text-secondary)" }}>Version</span>
            <span style={{ color: "var(--text-primary)" }}>{modelInfo.version}</span>
            <span style={{ color: "var(--text-secondary)" }}>Change ID</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: 13 }}>{modelInfo.change_id || "—"}</span>
            <span style={{ color: "var(--text-secondary)" }}>Created</span>
            <span style={{ color: "var(--text-primary)" }}>{new Date(modelInfo.created_at).toLocaleString()}</span>
            <span style={{ color: "var(--text-secondary)" }}>Updated</span>
            <span style={{ color: "var(--text-primary)" }}>{new Date(modelInfo.updated_at).toLocaleString()}</span>
          </div>
          {modelDefinition && Object.keys(modelDefinition).length > 0 && (
            <div style={{ marginTop: 20 }}>
              <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Entities</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {Object.keys(modelDefinition).sort().map(entityType => {
                  const entity = modelDefinition[entityType] || { base_fields: [], custom_fields: [] };
                  const base = entity.base_fields || [];
                  const custom = entity.custom_fields || [];
                  const fieldCount = base.length + custom.length;
                  const fieldNames = [...base, ...custom].map(f => f.name).join(", ");
                  return (
                    <div key={entityType} style={{ padding: "10px 12px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                        <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 14 }}>{entityType}</span>
                        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fieldCount} fields</span>
                      </div>
                      {fieldNames && <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>{fieldNames}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {isAdmin && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={handleSyncDefaults} disabled={syncing} style={{ ...btnSecondary, opacity: syncing ? 0.6 : 1, cursor: syncing ? "default" : "pointer" }}>
                {syncing ? "Syncing…" : "Sync default entities"}
              </button>
              <button onClick={handleEditModel} style={btnPrimary}>Edit Model</button>
            </div>
          )}
          {syncMessage && <p style={{ color: "var(--text-secondary)", marginTop: 12, fontSize: 14 }}>{syncMessage}</p>}
        </div>
      )}
    </div>
  );
}
