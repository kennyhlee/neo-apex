import type { User } from "../types/models";

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
