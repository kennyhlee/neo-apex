import { useState, useEffect } from "react";
import type { User } from "../types/models";
import { listUsers, createUser, updateUser, deleteUser } from "../api/client";
import "./UserManagementPage.css";

interface Props { user: User; }
type UserRow = { user_id: string; name: string; email: string; role: string; created_at: string };

export default function UserManagementPage({ user }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "" });
  const [editError, setEditError] = useState("");

  const reload = () => listUsers(user.tenant_id).then(setUsers);
  useEffect(() => { reload(); }, [user.tenant_id]);

  const adminCount = users.filter(u => u.role === "admin").length;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await createUser(user.tenant_id, form);
      setForm({ name: "", email: "", password: "", role: "staff" });
      setShowAdd(false);
      reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    setEditError("");
    try {
      const fields: { name?: string; role?: string } = {};
      if (editForm.name !== editingUser.name) fields.name = editForm.name;
      if (editForm.role !== editingUser.role) fields.role = editForm.role;
      if (Object.keys(fields).length > 0) {
        await updateUser(user.tenant_id, editingUser.user_id, fields);
      }
      setEditingUser(null);
      reload();
    } catch (err) { setEditError(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    try { await deleteUser(user.tenant_id, userId); reload(); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed"); }
  };

  const isLastAdmin = (u: UserRow) => u.role === "admin" && adminCount <= 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>Users</h2>
        <button className="auth-submit" style={{ padding: "8px 16px", fontSize: 14 }} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "Add User"}
        </button>
      </div>
      {showAdd && (
        <form onSubmit={handleAdd} className="um-add-form">
          <input className="auth-input" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          <input className="auth-input" type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input className="auth-input" type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          <select className="auth-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="teacher">Teacher</option>
            <option value="parent">Parent</option>
          </select>
          <button type="submit" className="auth-submit" style={{ padding: "8px 16px", fontSize: 14 }}>Create</button>
          {error && <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
        </form>
      )}
      <table className="um-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.user_id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td style={{ display: "flex", gap: 8 }}>
                <button className="um-edit" onClick={() => { setEditingUser(u); setEditForm({ name: u.name, role: u.role }); setEditError(""); }}>Edit</button>
                <button className="um-delete" onClick={() => handleDelete(u.user_id)} disabled={isLastAdmin(u)}
                  style={isLastAdmin(u) ? { opacity: 0.4, cursor: "not-allowed" } : {}}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-lg)", padding: 32, width: 400, boxShadow: "var(--shadow-card)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: "var(--text-primary)" }}>Edit User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="auth-label">Name</label>
                <input className="auth-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="auth-label">Role</label>
                <select className="auth-input" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  disabled={isLastAdmin(editingUser) && editForm.role === "admin"}>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                  <option value="teacher">Teacher</option>
                  <option value="parent">Parent</option>
                </select>
                {isLastAdmin(editingUser) && <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>Cannot change role — this is the only admin.</p>}
              </div>
              {editError && <div style={{ color: "var(--danger)", fontSize: 13 }}>{editError}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setEditingUser(null)} style={{ padding: "8px 16px", fontSize: 14, background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
                  Cancel
                </button>
                <button onClick={handleEditSave} className="auth-submit" style={{ padding: "8px 16px", fontSize: 14 }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
