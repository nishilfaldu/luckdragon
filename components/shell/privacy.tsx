"use client";

import { useSyncExternalStore } from "react";

/**
 * Platform-wide "drop protected traits" setting (on by default). Graph, matches, plan, and chat
 * requests read it, and components re-fetch when it changes. Remembered per browser.
 */
const STORAGE_KEY = "luckdragon-drop-protected";
const listeners = new Set<() => void>();
let drop: boolean | null = null;

export function getDropProtected(): boolean {
  if (drop === null) {
    try {
      drop = window.localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      drop = true;
    }
  }
  return drop;
}

export function setDropProtected(next: boolean): void {
  drop = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Private windows can refuse storage; the setting still applies for this tab.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDropProtected(): boolean {
  return useSyncExternalStore(subscribe, getDropProtected, () => true);
}

/** Query-string suffix for API calls: empty when dropping (the server default). */
export function protectedParam(separator: "?" | "&"): string {
  return getDropProtected() ? "" : `${separator}protected=allow`;
}

export function PrivacyToggle() {
  const on = useDropProtected();
  return (
    <label
      title="Health, religion, politics, ethnicity or nationality, sexual orientation, family, and age are left out of graphs, matches, and answers"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, color: "var(--muted)", cursor: "pointer", marginRight: 12 }}
    >
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(event) => setDropProtected(event.target.checked)}
        style={{ accentColor: "var(--green)", width: 15, height: 15, margin: 0 }}
      />
      {on ? "Protected traits dropped" : "Protected traits allowed"}
    </label>
  );
}
