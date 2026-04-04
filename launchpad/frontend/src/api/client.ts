import type { User, OnboardingStatus } from "../types/models";

const BASE_URL = "http://localhost:8001/api";
const TOKEN_KEY = "launchpad_token";

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

export async function register(name: string, email: string, password: string, tenant_name: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, tenant_name }),
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
  // Model definition is keyed by entity type — look for "tenant" (case insensitive)
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

export async function markOnboardingStep(tenantId: string, stepId: string): Promise<import("../types/models").OnboardingStatus> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/onboarding-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, completed: true }),
  });
  if (!res.ok) throw new Error("Failed to update onboarding status");
  return res.json();
}
