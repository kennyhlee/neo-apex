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

  const reload = () => listUsers(user.tenant_id).then(setUsers);
  useEffect(() => { reload(); }, [user.tenant_id]);

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

  const handleRoleChange = async (userId: string, role: string) => {
    try { await updateUser(user.tenant_id, userId, { role }); reload(); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    try { await deleteUser(user.tenant_id, userId); reload(); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed"); }
  };

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
              <td>
                <select value={u.role} onChange={e => handleRoleChange(u.user_id, e.target.value)} className="um-role-select">
                  <option value="admin">admin</option><option value="staff">staff</option>
                  <option value="teacher">teacher</option><option value="parent">parent</option>
                </select>
              </td>
              <td><button className="um-delete" onClick={() => handleDelete(u.user_id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
