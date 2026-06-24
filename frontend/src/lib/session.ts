"use client";
import { useEffect, useState } from "react";
import type { AuthRes } from "./api";

const KEY = "naukri.session";

export function saveSession(s: AuthRes) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function clearSession() {
  localStorage.removeItem(KEY);
}
export function readSession(): AuthRes | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthRes) : null;
  } catch {
    return null;
  }
}

// Hook: returns the current session (or null) once mounted.
export function useSession() {
  const [session, setSession] = useState<AuthRes | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(readSession());
    setReady(true);
  }, []);
  return {
    session,
    ready,
    setSession: (s: AuthRes | null) => {
      if (s) saveSession(s);
      else clearSession();
      setSession(s);
    },
  };
}
