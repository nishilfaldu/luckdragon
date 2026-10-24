"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/shell/Avatar";
import { NODE_COLOR_VAR, type NodeType } from "@/lib/types";

type Facet = "Organization" | "Skill" | "Topic" | "Location";

type SharedGround = {
  type: Facet;
  label: string;
  viewerNodeId: string;
  theirNodeId: string;
};

type WhyNow = {
  nodeId: string;
  type: string;
  label: string;
  date: string;
  sharedLabel?: string;
  url?: string;
};

type PlanRow = {
  slug: string;
  name: string;
  headline: string;
  avatar_url: string;
  role: string;
  shared: SharedGround[];
  whyNow: WhyNow | null;
  opener: string;
};

type LoadStatus = "idle" | "loading" | "ready" | "error";

type Loaded = {
  viewer: string | null;
  status: LoadStatus;
  plans: PlanRow[];
  reason: string | null;
};

/**
 * "Your plan for the room" for the middle pane when nobody is selected.
 * Rows call `onSelect` with the other person's slug.
 */
export function RoomPlan({
  viewer,
  onSelect,
}: {
  viewer: string | null;
  onSelect: (slug: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ viewer: null, status: "idle", plans: [], reason: null });

  useEffect(() => {
    if (!viewer) return;
    const ctrl = new AbortController();
    let live = true;

    void (async () => {
      try {
        const response = await fetch(`/api/plan?viewer=${encodeURIComponent(viewer)}&limit=6`, {
          signal: ctrl.signal,
        });
        const body = (await response.json()) as {
          plans?: PlanRow[];
          reason?: string;
          error?: string;
        };
        if (!live) return;
        if (!response.ok) {
          setLoaded({
            viewer,
            status: "error",
            plans: [],
            reason: body.reason || body.error || "Could not load a plan.",
          });
          return;
        }
        const rows = Array.isArray(body.plans) ? body.plans : [];
        setLoaded({
          viewer,
          status: "ready",
          plans: rows,
          reason: rows.length === 0 ? body.reason || "No shared ground yet." : null,
        });
      } catch (error) {
        if (!live || ctrl.signal.aborted) return;
        setLoaded({
          viewer,
          status: "error",
          plans: [],
          reason: error instanceof Error ? error.message : "Could not load a plan.",
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
  const plans = current?.plans ?? [];
  const reason = current?.reason ?? null;

  return (
    <section className="rp-plan" aria-label="Your plan for the room" data-plan={status}>
      <p className="block-label">Your plan for the room</p>
      {!viewer ? <p className="pane-copy">Pick who you are to plan the room.</p> : null}
      {viewer && status === "loading" ? <p className="pane-copy">Building your plan for the room…</p> : null}
      {viewer && status === "error" ? <p className="error-line">{reason}</p> : null}
      {viewer && status === "ready" && plans.length === 0 ? <p className="pane-copy">{reason}</p> : null}
      {plans.length > 0 ? (
        <div className="rp-table">
          {plans.map((row) => {
            const why = whyText(row.whyNow);
            return (
              <button
                type="button"
                className="rp-row"
                key={row.slug}
                onClick={() => onSelect(row.slug)}
              >
                <span className="rp-who">
                  <Avatar name={row.name} url={row.avatar_url} />
                  <span className="meta">
                    <span className="topline">
                      <span className="name">{row.name}</span>
                      <RoleTag role={row.role} />
                    </span>
                  </span>
                </span>
                <span className="rp-why" title={why}>
                  {why}
                </span>
                <span className="rp-chips">
                  {row.shared.slice(0, 3).map((item) => (
                    <span className="chip" key={`${item.type}:${item.viewerNodeId}`} title={item.type} style={chipStyle(item.type)}>
                      {item.label}
                    </span>
                  ))}
                </span>
                <span className="rp-opener" title={row.opener}>
                  {row.opener}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function whyText(item: WhyNow | null): string {
  if (!item) return "No dated item yet";
  return `${formatDay(item.date)} · ${item.label}`;
}

function RoleTag({ role }: { role: string }) {
  const kind = role.toLowerCase();
  if (kind === "judge" || kind === "host") {
    return <span className={`tag ${kind}`}>{kind === "host" ? "Host" : "Judge"}</span>;
  }
  if (!role || kind === "viewer") return null;
  return (
    <span className="tag" style={{ color: "var(--muted)", background: "var(--soft)" }}>
      {kind === "guest" ? "Guest" : role}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value.trim();
  return `${month} ${Number(match[3])}`;
}

function chipStyle(type: Facet): { color: string; background: string; maxWidth: string } {
  const token = NODE_COLOR_VAR[type as NodeType];
  return {
    maxWidth: "100%",
    color: `var(${token})`,
    background: `color-mix(in srgb, var(${token}) 16%, transparent)`,
  };
}
