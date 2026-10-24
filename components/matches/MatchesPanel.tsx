"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/shell/Avatar";
import { NODE_COLOR_VAR, type NodeType } from "@/lib/types";
import styles from "./matches.module.css";

type Facet = "Organization" | "Skill" | "Topic" | "Location";

type SharedGround = {
  type: Facet;
  label: string;
  viewerNodeId: string;
  theirNodeId: string;
};

type PersonMatch = {
  slug: string;
  name: string;
  headline: string;
  avatar_url: string;
  role: string;
  score: number;
  shared: SharedGround[];
};

const CHIP_COUNT = 3;

type LoadStatus = "idle" | "loading" | "ready" | "error";

type LoadedMatches = {
  viewer: string | null;
  status: LoadStatus;
  matches: PersonMatch[];
  reason: string | null;
};

/**
 * Common-ground ranking for the signed-in viewer.
 * Mount inside the people pane. `onHighlight` receives node ids from the viewer's graph.
 */
export function MatchesPanel({
  viewer,
  onSelect,
  onHighlight,
}: {
  viewer: string | null;
  onSelect: (slug: string) => void;
  onHighlight?: (nodeIds: string[]) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedMatches>({ viewer: null, status: "idle", matches: [], reason: null });

  useEffect(() => {
    if (!viewer) return;
    const ctrl = new AbortController();
    let live = true;

    void (async () => {
      try {
        const response = await fetch(`/api/matches?viewer=${encodeURIComponent(viewer)}&limit=8`, {
          signal: ctrl.signal,
        });
        const body = (await response.json()) as {
          matches?: PersonMatch[];
          reason?: string;
          error?: string;
        };
        if (!live) return;
        if (!response.ok) {
          setLoaded({
            viewer,
            status: "error",
            matches: [],
            reason: body.reason || body.error || "Could not load matches.",
          });
          return;
        }
        const rows = Array.isArray(body.matches) ? body.matches : [];
        setLoaded({
          viewer,
          status: "ready",
          matches: rows,
          reason: rows.length === 0 ? body.reason || "No shared ground yet." : null,
        });
      } catch (error) {
        if (!live || ctrl.signal.aborted) return;
        setLoaded({
          viewer,
          status: "error",
          matches: [],
          reason: error instanceof Error ? error.message : "Could not load matches.",
        });
      }
    })();

    return () => {
      live = false;
      ctrl.abort();
    };
  }, [viewer]);

  const current = loaded.viewer === viewer ? loaded : null;
  const status = !viewer ? "idle" : current?.status ?? "loading";
  const matches = current?.matches ?? [];
  const reason = current?.reason ?? null;
  const top = matches[0]?.score || 1;

  return (
    <section className={styles.panel} aria-label="Best matches for you" data-matches={status}>
      <p className="block-label">Best matches for you</p>
      {!viewer ? <p className="pane-copy">Pick who you are to see matches.</p> : null}
      {viewer && status === "loading" ? <p className="pane-copy">Looking for common ground…</p> : null}
      {viewer && status === "error" ? <p className="error-line">{reason}</p> : null}
      {viewer && status === "ready" && matches.length === 0 ? <p className="pane-copy">{reason}</p> : null}
      {matches.map((match) => {
        const chips = match.shared.slice(0, CHIP_COUNT);
        const ids = chips.map((item) => item.viewerNodeId);
        const width = Math.max(12, Math.round((match.score / top) * 100));
        return (
          <div className="person" key={match.slug}>
            <button
              type="button"
              className="person-hit"
              aria-label={ariaLabel(match, chips)}
              onClick={() => onSelect(match.slug)}
              onMouseEnter={() => onHighlight?.(ids)}
              onMouseLeave={() => onHighlight?.([])}
              onFocus={() => onHighlight?.(ids)}
              onBlur={() => onHighlight?.([])}
            >
              <Avatar name={match.name} url={match.avatar_url} />
              <span className="meta">
                <span className="topline">
                  <span className="name">{match.name}</span>
                  <span className={styles.bar} title={`Score ${match.score}`}>
                    <span className={styles.fill} style={{ width: `${width}%` }} />
                  </span>
                </span>
                {chips.length > 0 ? (
                  <span className="sources" style={{ flexWrap: "wrap" }}>
                    {chips.map((item) => (
                      <span
                        className="chip"
                        key={`${item.type}:${item.viewerNodeId}`}
                        title={item.type}
                        style={chipStyle(item.type)}
                        onMouseEnter={(event) => {
                          event.stopPropagation();
                          onHighlight?.([item.viewerNodeId]);
                        }}
                        onMouseLeave={(event) => {
                          event.stopPropagation();
                          onHighlight?.(ids);
                        }}
                      >
                        {item.label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
        );
      })}
    </section>
  );
}

function ariaLabel(match: PersonMatch, chips: SharedGround[]): string {
  const shared = chips.map((item) => item.label).join(", ");
  const detail = shared ? `, shares ${shared}` : "";
  return `${match.name}, match score ${match.score.toFixed(1)}${detail}`;
}

function chipStyle(type: Facet): { color: string; background: string; maxWidth: string } {
  const token = NODE_COLOR_VAR[type as NodeType];
  return {
    maxWidth: "100%",
    color: `var(${token})`,
    background: `color-mix(in srgb, var(${token}) 16%, transparent)`,
  };
}
