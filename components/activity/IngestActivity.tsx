"use client";

import { useEffect, useState } from "react";
import type { IngestRun, SourceRow } from "@/components/shell/model";

/** Pipeline steps grouped into phases a person watching can follow. */
const PHASES: { title: string; sources: string[] }[] = [
  { title: "Finding their accounts", sources: ["queue", "seed", "luma", "resolve"] },
  {
    title: "Reading the web",
    sources: ["linkedin", "x", "youtube", "serp", "website", "github", "research", "instagram", "threads", "bluesky", "reddit", "crunchbase", "packages"],
  },
  { title: "Saving to FalkorDB", sources: ["graph", "room"] },
];

const NAMES: Record<string, string> = {
  queue: "Queued", seed: "People list", luma: "Luma profile", resolve: "Finding their accounts", website: "Personal website", github: "GitHub",
  linkedin: "LinkedIn", x: "X", youtube: "YouTube", instagram: "Instagram", threads: "Threads", bluesky: "Bluesky",
  reddit: "Reddit", crunchbase: "Crunchbase", packages: "npm and PyPI", serp: "Google search", research: "Research agent",
  graph: "Saving to FalkorDB", room: "Linking into the room graph",
};

const BUSY = new Set(["pending", "fetching", "extracting", "writing"]);

function elapsed(fromIso: string | undefined, now: number): string {
  if (!fromIso) return "0:00";
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusWord(row: SourceRow): string {
  if (row.status === "fetching") return "Fetching…";
  if (row.status === "extracting") return "Turning pages into facts…";
  if (row.status === "writing") return "Writing…";
  if (row.status === "pending") return "Queued";
  if (row.status === "error") return "Failed, skipped";
  return "";
}

/** A live, narrated view of one person's ingest: phases, what each source returned, and facts appearing. */
export function IngestActivity({ name, run }: { name: string; run: IngestRun }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.running]);

  const first = name.split(" ")[0] || name;
  const rows = run.sources;
  const real = rows.filter((row) => PHASES[1].sources.includes(row.source));
  const tried = real.filter((row) => row.status !== "skipped");
  // A source counts as done once its fetch finishes; extraction afterwards must not move the counter backwards.
  const settled = tried.filter((row) => row.status !== "pending" && row.status !== "fetching");
  const fetched = real.reduce((sum, row) => sum + (row.fetched ?? 0), 0);
  const facts = real.reduce((sum, row) => sum + (row.facts ?? 0), 0);
  const skipped = real.filter((row) => row.status === "skipped").map((row) => NAMES[row.source] ?? row.source);
  const progress = tried.length ? settled.length / tried.length : 0;

  return (
    <section aria-label={`Building ${first}'s graph`} aria-live="polite" style={{ marginTop: 8 }}>
      <style>{`
        @keyframes ld-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes ld-spin { to { transform: rotate(360deg); } }
        .ld-chip { animation: ld-in 360ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .ld-chip { animation: none; } .ld-spin { animation: none !important; } }
      `}</style>
      <div style={{ padding: "14px 16px", border: "1px solid var(--line)", borderRadius: 18, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Building {first}&apos;s graph</p>
          <span style={{ font: "500 14px var(--mono)", color: "var(--muted)" }}>{elapsed(run.startedAt, now)}</span>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
          <Counter value={`${settled.length}/${tried.length || "…"}`} label="sources done" />
          <Counter value={String(fetched)} label="items fetched" />
          <Counter value={String(facts)} label="facts so far" />
        </div>
        <div style={{ height: 4, marginTop: 12, borderRadius: 999, background: "var(--soft)", overflow: "hidden" }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "var(--blue)", transition: "width 400ms ease" }} />
        </div>
      </div>

      {PHASES.map((phase) => {
        const started = rows.some((row) => row.source !== "queue");
        const list = rows.filter(
          (row) =>
            phase.sources.includes(row.source) &&
            row.status !== "skipped" &&
            row.source !== "seed" &&
            !(row.source === "queue" && started),
        );
        if (!list.length) return null;
        return (
          <div key={phase.title} style={{ marginTop: 16 }}>
            <p className="block-label" style={{ margin: "0 0 8px" }}>{phase.title}</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {list.map((row) => (
                <Line key={row.source} row={row} />
              ))}
            </ul>
          </div>
        );
      })}

      {skipped.length ? (
        <p style={{ margin: "14px 0 0", fontSize: 13.5, color: "var(--muted)" }}>No account found: {skipped.join(", ")}</p>
      ) : null}
      {run.error ? <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--red)" }}>{run.error}</p> : null}
    </section>
  );
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{value}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function Line({ row }: { row: SourceRow }) {
  const busy = BUSY.has(row.status);
  const failed = row.status === "error";
  const bright = (row.product ?? "").startsWith("Bright Data");
  const sentence = row.detail || statusWord(row) || row.message || "";
  return (
    <li style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 10 }}>
      <span aria-hidden="true" style={{ marginTop: 3, width: 14, height: 14, display: "grid", placeItems: "center" }}>
        {busy ? (
          <span
            className="ld-spin"
            style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--line)", borderTopColor: "var(--blue)", animation: "ld-spin 0.9s linear infinite" }}
          />
        ) : (
          <span style={{ fontSize: 13, color: failed ? "var(--red)" : "var(--green)" }}>{failed ? "!" : "✓"}</span>
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{row.label || NAMES[row.source] || row.source}</span>
          {row.product ? (
            <span
              style={{
                fontSize: 11.5, padding: "0 7px", borderRadius: 999,
                color: bright ? "var(--blue)" : "var(--muted)", background: bright ? "var(--blue-bg)" : "var(--soft)",
              }}
            >
              {row.product}
            </span>
          ) : null}
        </div>
        {sentence ? (
          <p style={{ margin: "2px 0 0", fontSize: 14, color: failed ? "var(--red)" : "var(--muted)" }}>{sentence}</p>
        ) : null}
        {row.items?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {row.items.map((item, index) => (
              <span
                key={`${row.status}:${item}`}
                className="chip ld-chip"
                style={{ maxWidth: "100%", animationDelay: `${index * 90}ms` }}
                title={item}
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
