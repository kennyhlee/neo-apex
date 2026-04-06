import type { User, OnboardingStatus } from "../types/models";
import { LAUNCHPAD_API_URL } from "../config";

const BASE_URL = LAUNCHPAD_API_URL;
const TOKEN_KEY = "neoapex_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

export async function getCurrentUser(): Promise<User> {
  const res = await authFetch(`${BASE_URL}/me`);
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Login failed");
  }
  return res.json();
}

export async function register(name: string, email: string, password: string, tenant_name: string, tenant_id: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, tenant_name, tenant_id }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Registration failed");
  }
  return res.json();
}

export async function getOnboardingStatus(tenantId: string): Promise<OnboardingStatus> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/onboarding-status`);
  if (!res.ok) throw new Error("Failed to fetch onboarding status");
  return res.json();
}

export async function getTenantModel(tenantId: string): Promise<import("../types/models").EntityModelDefinition | null> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model`);
  if (!res.ok) throw new Error("Failed to fetch model");
  const data = await res.json();
  if (!data) return null;
  // Response may be the model directly or keyed by entity type
  if (data.base_fields) return data;
  const key = Object.keys(data).find(k => k.toLowerCase() === "tenant");
  return key ? data[key] : null;
}

export async function getTenantProfile(tenantId: string): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}`);
  if (!res.ok) throw new Error("Failed to fetch tenant profile");
  return res.json();
}

export async function updateTenantProfile(tenantId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update tenant profile");
  return res.json();
}

export async function listUsers(tenantId: string): Promise<Array<{ user_id: string; name: string; email: string; role: string; created_at: string }>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function createUser(tenantId: string, data: { name: string; email: string; password: string; role: string }): Promise<unknown> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "Failed to create user"); }
  return res.json();
}

export async function updateUser(tenantId: string, userId: string, data: { name?: string; role?: string }): Promise<unknown> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "Failed to update user"); }
  return res.json();
}

export async function deleteUser(tenantId: string, userId: string): Promise<void> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users/${userId}`, { method: "DELETE" });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "Failed to delete user"); }
}

export async function markOnboardingStep(tenantId: string, stepId: string): Promise<import("../types/models").OnboardingStatus> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/onboarding-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, completed: true }),
  });
  if (!res.ok) throw new Error("Failed to update onboarding status");
  return res.json();
}

export async function checkEmail(email: string): Promise<{ status: string; admin_email_hint: string | null }> {
  const res = await fetch(`${BASE_URL}/register/check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Failed to check email");
  return res.json();
}

export async function suggestTenantIds(email: string, tenantName: string): Promise<{ suggestions: string[] }> {
  const res = await fetch(`${BASE_URL}/register/suggest-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tenant_name: tenantName }),
  });
  if (!res.ok) throw new Error("Failed to suggest IDs");
  return res.json();
}

export async function useDefaultModel(tenantId: string): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model/use-default`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to apply default model");
  return res.json();
}

export async function getTenantModelInfo(tenantId: string): Promise<{ model_definition: Record<string, unknown>; version: number; change_id: string; created_at: string; updated_at: string } | null> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model/info`);
  if (!res.ok) throw new Error("Failed to fetch model info");
  return res.json();
}
