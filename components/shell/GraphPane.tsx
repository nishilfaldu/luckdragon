"use client";

import { useMemo, useState } from "react";
import { NODE_COLOR_VAR, NODE_TYPES, type GraphNode, type NodeType } from "@/lib/types";
import { ForceGraph } from "./ForceGraph";
import { findNode, type Citation, type FocusTarget, type GraphState, type PersonListItem } from "./model";
import { SourcesPanel } from "@/components/sources/SourcesPanel";
import { NodeCard } from "./NodeCard";

export function GraphPane({
  viewer,
  person,
  graphs,
  citations,
  hoverCite,
  centerNonce,
  focus,
  onFocus,
  onAsk,
  onRetry,
}: {
  viewer: PersonListItem | null;
  person: PersonListItem | null;
  graphs: Record<string, GraphState>;
  citations: Citation[];
  hoverCite: Citation | null;
  centerNonce: number;
  focus: FocusTarget | null;
  onFocus: (focus: FocusTarget | null) => void;
  onAsk: (node: GraphNode) => void;
  onRetry: (slug: string) => void;
}) {
  const compare = Boolean(viewer && person && viewer.slug !== person.slug);
  const types = useMemo(() => legendTypes(viewer, person, graphs, compare), [viewer, person, graphs, compare]);
  if (!person) return null;

  return (
    <section className="pane pane-graph" aria-label="Graph" data-pane="graph">
      <div className={compare ? "graph-stage compare" : "graph-stage"}>
        {compare && viewer ? (
          <GraphColumn
            key={`${viewer.slug}:layout`}
            title="You"
            tone="you"
            person={viewer}
            state={graphs[viewer.slug]}
            citations={citations}
            hoverCite={hoverCite}
            centerNonce={centerNonce}
            focus={focus}
            onFocus={onFocus}
            onAsk={onAsk}
            onRetry={onRetry}
          />
        ) : null}
        <GraphColumn
          key={`${person.slug}:layout`}
          title={person.slug === viewer?.slug ? "You" : person.name}
          tone={person.slug === viewer?.slug ? "you" : "them"}
          person={person}
          state={graphs[person.slug]}
          citations={citations}
          hoverCite={hoverCite}
          centerNonce={centerNonce}
          focus={focus}
          onFocus={onFocus}
          onAsk={onAsk}
          onRetry={onRetry}
        />
      </div>
      {types.length > 0 ? (
        <div className="legend">
          {types.map((type) => (
            <span className="key" key={type}>
              <i className="swatch" style={{ background: `var(${NODE_COLOR_VAR[type]})` }} />
              {type}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GraphColumn({
  title,
  tone,
  person,
  state,
  citations,
  hoverCite,
  centerNonce,
  focus,
  onFocus,
  onAsk,
  onRetry,
}: {
  title: string;
  tone: "you" | "them";
  person: PersonListItem;
  state: GraphState | undefined;
  citations: Citation[];
  hoverCite: Citation | null;
  centerNonce: number;
  focus: FocusTarget | null;
  onFocus: (focus: FocusTarget | null) => void;
  onAsk: (node: GraphNode) => void;
  onRetry: (slug: string) => void;
}) {
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [pointer, setPointer] = useState({ x: 24, y: 24, width: 320, height: 480 });
  const focused = focus?.slug === person.slug ? findNode(state, focus.id) ?? null : null;
  const highlightIds = idsFor(person.slug, citations, hoverCite, focused?.id ?? null);
  const hoverId = hoverCite?.slug === person.slug ? hoverCite.nodeId : null;
  const centerId = hoverId ?? focused?.id ?? null;

  return (
    <div
      className="graph-col"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointer({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        });
      }}
    >
      <p className={`graph-label ${tone}`}>{title}</p>
      {state?.status === "ready" ? (
        <button
          type="button"
          className="pill sm"
          aria-expanded={showSources}
          onClick={() => setShowSources((open) => !open)}
          style={{ position: "absolute", zIndex: 3, top: 12, right: 14, fontSize: 12.5, color: "var(--muted)" }}
        >
          {showSources ? "Hide sources" : "Data sources"}
        </button>
      ) : null}
      {showSources && state?.status === "ready" ? (
        <div
          style={{
            position: "absolute", zIndex: 5, top: 46, right: 12, width: "min(320px, calc(100% - 24px))",
            maxHeight: "calc(100% - 100px)", overflow: "auto", padding: "12px 14px",
            border: "1px solid var(--line)", borderRadius: 18, background: "var(--surface)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.06)",
          }}
        >
          <p style={{ margin: 0, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
            Data sources
          </p>
          <SourcesPanel slug={person.slug} />
        </div>
      ) : null}
      {!state || state.status === "loading" ? (
        <div className="center-note">
          <p className="sr-only">Loading the graph…</p>
          <GraphSkeleton />
        </div>
      ) : null}
      {state?.status === "error" ? (
        <div className="center-note">
          <div>
            <p className="pane-copy">{state.message}</p>
            <button type="button" className="text-btn" onClick={() => onRetry(person.slug)}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
      {state?.status === "ready" ? (
        <ForceGraph
          graph={state.data}
          highlightIds={highlightIds}
          focusId={focused?.id ?? null}
          centerId={centerId}
          centerNonce={centerId ? centerNonce : 0}
          onHover={setHovered}
          onFocus={(node) => {
            if (!node) {
              if (focus?.slug === person.slug) onFocus(null);
              return;
            }
            onFocus({ slug: person.slug, id: node.id });
          }}
        />
      ) : null}
      {focused ? <NodeCard node={focused} pinned onAsk={onAsk} /> : null}
      {hovered && hovered.id !== focused?.id ? (
        <NodeCard node={hovered} style={placeCard(pointer)} />
      ) : null}
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div className="graph-skel" aria-hidden="true">
      <span className="skel skel-node lg" />
      <span className="skel skel-node" />
      <span className="skel skel-node sm" />
      <span className="skel skel-node" />
    </div>
  );
}

function idsFor(slug: string, citations: Citation[], hoverCite: Citation | null, focusId: string | null): string[] {
  const ids = new Set<string>();
  for (const cite of citations) {
    if (cite.slug === slug) ids.add(cite.nodeId);
  }
  if (hoverCite?.slug === slug) ids.add(hoverCite.nodeId);
  if (focusId) ids.add(focusId);
  return [...ids];
}

function legendTypes(
  viewer: PersonListItem | null,
  person: PersonListItem | null,
  graphs: Record<string, GraphState>,
  compare: boolean,
): NodeType[] {
  const slugs = [person?.slug, compare ? viewer?.slug : null].filter((slug): slug is string => Boolean(slug));
  const present = new Set<NodeType>();
  for (const slug of slugs) {
    const state = graphs[slug];
    if (!state || state.status !== "ready") continue;
    const nodes = state.data.nodes.length > 0 ? state.data.nodes : [state.data.root];
    for (const node of nodes) present.add(node.type);
  }
  return NODE_TYPES.filter((type) => present.has(type));
}

function placeCard(pointer: { x: number; y: number; width: number; height: number }): { left: number; top: number } {
  const cardW = 240;
  const cardH = 200;
  let left = pointer.x + 14;
  let top = pointer.y + 14;
  if (left + cardW > pointer.width - 8) left = pointer.x - cardW - 14;
  if (top + cardH > pointer.height - 8) top = Math.max(36, pointer.y - cardH - 8);
  return { left: Math.max(8, left), top: Math.max(36, top) };
}
