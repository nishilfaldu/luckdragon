"use client";

import { useState, useSyncExternalStore } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "./theme";

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System theme" },
  { id: "light", label: "Light theme" },
  { id: "dark", label: "Dark theme" },
];

function subscribeTheme() {
  return () => {};
}

function serverTheme(): ThemeChoice {
  return "system";
}

export function ThemeToggle() {
  const external = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const [chosen, setChosen] = useState<ThemeChoice | null>(null);
  const theme = chosen ?? external;

  function apply(choice: ThemeChoice) {
    applyTheme(choice);
    setChosen(choice);
  }

  return (
    <div className="themes" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          data-theme={option.id}
          aria-label={option.label}
          title={option.label.replace(" theme", "")}
          aria-pressed={theme === option.id}
          onClick={() => apply(option.id)}
        >
          {option.id === "system" ? <SystemIcon /> : null}
          {option.id === "light" ? <LightIcon /> : null}
          {option.id === "dark" ? <DarkIcon /> : null}
        </button>
      ))}
    </div>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13.5 9.8A6 6 0 0 1 6.2 2.5a6 6 0 1 0 7.3 7.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
