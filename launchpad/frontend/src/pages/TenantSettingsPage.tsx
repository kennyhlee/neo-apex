import { useState, useEffect } from "react";
import type { User, EntityModelDefinition } from "../types/models";
import { getTenantModel, getTenantProfile, updateTenantProfile } from "../api/client";
import DynamicEntityForm from "../components/DynamicEntityForm";

interface Props { user: User; }

export default function TenantSettingsPage({ user }: Props) {
  const [model, setModel] = useState<EntityModelDefinition | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getTenantModel(user.tenant_id).then(setModel);
    getTenantProfile(user.tenant_id).then(setData);
  }, [user.tenant_id]);

  if (!model) return <p>Loading...</p>;

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: "var(--text-primary)" }}>Tenant Settings</h2>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-lg)", padding: 32, boxShadow: "var(--shadow-card)", maxWidth: 600 }}>
        <DynamicEntityForm
          model={model}
          initialData={data}
          readOnly={user.role !== "admin"}
          immutableFields={["name", "tenant_id"]}
          onSave={async (updated) => {
            await updateTenantProfile(user.tenant_id, updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        />
        {saved && <p style={{ color: "var(--success)", marginTop: 12 }}>Saved!</p>}
      </div>
    </div>
  );
}
