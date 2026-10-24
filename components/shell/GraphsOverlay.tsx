"use client";

import { useEffect, type ReactNode } from "react";
import { YouThemLegend } from "./YouThemLegend";

export function GraphsOverlay({
  open,
  compare,
  onClose,
  children,
}: {
  open: boolean;
  compare: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector('[aria-label="How I know this"]')) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="w3-scrim" onClick={onClose} />
      <div className="w3-overlay" role="dialog" aria-modal="true" aria-label="Full graphs">
        <div className="w3-overlay-bar">
          <div className="w3-overlay-lead">
            <p className="w3-overlay-title">Full graphs</p>
            {compare ? <YouThemLegend /> : null}
          </div>
          <button type="button" className="pill sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="w3-overlay-body">{children}</div>
      </div>
    </>
  );
}
