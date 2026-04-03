import { useEffect, useState } from "react";
import type { User } from "./types/models";
import { getCurrentUser, getStoredToken, clearToken } from "./api/client";
import "./index.css";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setAuthChecked(true); return; }
    getCurrentUser()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Loading...</div>;
  }

  if (!user) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Login page coming soon</div>;
  }

  return <div>Welcome, {user.name}</div>;
}
