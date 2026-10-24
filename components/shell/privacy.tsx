"use client";

import { useState, useSyncExternalStore } from "react";

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
  const [info, setInfo] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, marginRight: 12 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, color: "var(--muted)", cursor: "pointer" }}>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(event) => setDropProtected(event.target.checked)}
          style={{ accentColor: "var(--green)", width: 15, height: 15, margin: 0 }}
        />
        {on ? "Sensitive topics hidden" : "Sensitive topics shown"}
      </label>
      <button
        type="button"
        aria-label="What does this do?"
        aria-expanded={info}
        onClick={() => setInfo((open) => !open)}
        style={{
          width: 18, height: 18, padding: 0, borderRadius: "50%", border: "1px solid var(--line)",
          background: "transparent", color: "var(--muted)", font: "600 11px/1 var(--sans)", cursor: "pointer",
        }}
      >
        i
      </button>
      {info ? (
        <span
          role="dialog"
          aria-label="Sensitive topics"
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 30, width: 320, padding: "12px 14px",
            border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)",
            boxShadow: "0 12px 30px rgba(0, 0, 0, 0.12)", color: "var(--fg)", fontSize: 13.5, lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: 4 }}>{on ? "On: sensitive topics are left out" : "Off: everything public is used"}</strong>
          When on, luckdragon leaves out facts about health, religion, politics, ethnicity or nationality, sexual
          orientation, family, and age. They are hidden from the graphs, from Who to meet, and the AI never sees them
          when it writes a Brief or an answer.
          <span style={{ display: "block", marginTop: 6, color: "var(--muted)" }}>
            Matched by keywords on personal phrasing, so professional work like health tech or accessibility stays.
          </span>
        </span>
      ) : null}
    </span>
  );
}
