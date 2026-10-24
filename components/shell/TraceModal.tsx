"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ToolCall } from "./model";

/** Plain-English titles and hop patterns for the queries the agent and the room graph run. */
const STEPS: Record<string, { title: string; pattern: string; graph: string }> = {
  "room.shared_facets": {
    title: "Shared topics, skills, employers, and places",
    pattern: "you → facet ← them",
    graph: "room graph",
  },
  "room.why_now": {
    title: "Their newest item about something you share",
    pattern: "you → facet ← their item ← them",
    graph: "room graph",
  },
  "room.intro_paths": {
    title: "Intro paths through a mutual person",
    pattern: "you → facet ← mutual → facet ← them",
    graph: "room graph",
  },
  "room.two_hop_people": {
    title: "Path through two other people",
    pattern: "you → facet ← person → facet ← person → facet ← them",
    graph: "room graph",
  },
  run_cypher: { title: "A query the agent wrote for your question", pattern: "", graph: "person graph" },
  get_node: { title: "Looked up one node and its source", pattern: "", graph: "person graph" },
  graph_summary: { title: "Summarized a person's graph", pattern: "", graph: "person graph" },
};

function stepOf(tool: ToolCall) {
  return STEPS[tool.name] ?? { title: tool.name, pattern: "", graph: "graph" };
}

function cypherOf(tool: ToolCall): string | undefined {
  if (tool.cypher) return tool.cypher;
  const input = tool.input as { query?: unknown } | null;
  return input && typeof input.query === "string" ? input.query : undefined;
}

function slugOf(tool: ToolCall): string | undefined {
  const input = tool.input as { person_slug?: unknown } | null;
  return input && typeof input.person_slug === "string" ? input.person_slug : undefined;
}

/** One quiet line under an answer, like "Thought for 5s": opens the full trace on demand. */
export function TraceLine({ tools, citedNodes }: { tools: ToolCall[]; citedNodes: number }) {
  const [open, setOpen] = useState(false);
  const rows = tools.reduce((sum, tool) => sum + (tool.rowCount ?? 0), 0);
  const ms = tools.reduce((sum, tool) => sum + (tool.ms ?? 0), 0);
  const parts = [
    `${tools.length} graph ${tools.length === 1 ? "query" : "queries"}`,
    `${rows} rows`,
    `${ms} ms`,
    citedNodes ? `${citedNodes} cited nodes` : null,
  ].filter(Boolean);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "3px 10px",
          border: "1px solid var(--line)", borderRadius: 999, background: "transparent",
          color: "var(--muted)", font: "500 13px/1.5 var(--sans)", cursor: "pointer",
        }}
      >
        <span aria-hidden="true">⌁</span>
        {parts.join(" · ")}
        <span aria-hidden="true">›</span>
      </button>
      {open ? <TraceModal tools={tools} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TraceModal({ tools, onClose }: { tools: ToolCall[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 24,
        background: "color-mix(in srgb, var(--bg) 55%, rgba(0, 0, 0, 0.35))",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How I know this"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(780px, 100%)", maxHeight: "82vh", overflow: "auto", padding: "22px 24px",
          border: "1px solid var(--line)", borderRadius: 20, background: "var(--surface)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.18)", color: "var(--fg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>How I know this</h2>
            <p style={{ margin: "4px 0 0", fontSize: 14.5, color: "var(--muted)" }}>
              {tools.length} read-only {tools.length === 1 ? "query" : "queries"} against FalkorDB. Each claim in the answer
              cites the nodes these returned.
            </p>
          </div>
          <button type="button" className="pill sm" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <ol style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 18 }}>
          {tools.map((tool, index) => (
            <Step key={tool.id} tool={tool} index={index + 1} />
          ))}
        </ol>
        <p style={{ margin: "18px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Queries run through GRAPH.RO_QUERY; writes, LOAD CSV, and write procedures are rejected.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function Step({ tool, index }: { tool: ToolCall; index: number }) {
  const step = stepOf(tool);
  const cypher = cypherOf(tool);
  const slug = slugOf(tool);
  const [copied, setCopied] = useState(false);
  const meta = [
    slug ? `person:${slug}` : step.graph,
    tool.rowCount != null ? `${tool.rowCount} rows` : null,
    tool.ms != null ? `${tool.ms} ms` : null,
  ].filter(Boolean);
  return (
    <li style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: 12 }}>
      <span
        style={{
          width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center",
          background: "var(--soft)", color: "var(--muted)", fontSize: 13, fontWeight: 600,
        }}
      >
        {index}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 600 }}>{step.title}</p>
        {step.pattern ? (
          <p style={{ margin: "3px 0 0", font: "13.5px/1.5 var(--mono)", color: "var(--blue)" }}>{step.pattern}</p>
        ) : null}
        <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)" }}>{meta.join(" · ")}</p>
        {cypher ? (
          <div style={{ position: "relative", marginTop: 8 }}>
            <pre
              style={{
                margin: 0, padding: "12px 14px", overflowX: "auto", font: "13.5px/1.6 var(--mono)",
                background: "var(--well)", border: "1px solid var(--line)", borderRadius: 14, whiteSpace: "pre-wrap",
              }}
            >
              {cypher}
            </pre>
            <button
              type="button"
              className="pill sm"
              onClick={() => {
                void navigator.clipboard?.writeText(cypher).then(() => setCopied(true));
              }}
              style={{ position: "absolute", top: 8, right: 8, fontSize: 12 }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
