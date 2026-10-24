"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { NODE_COLOR_VAR, type GraphNode, type NodeType } from "@/lib/types";
import { displayLabel, type GraphPayload } from "./model";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number };
type SimLink = { source: string | SimNode; target: string | SimNode; type: string };

type GraphApi = {
  centerAt: (x?: number, y?: number, durationMs?: number) => void;
  zoom: (scale?: number, durationMs?: number) => number | void;
  zoomToFit: (durationMs?: number, padding?: number, nodeFilter?: (node: SimNode) => boolean) => void;
  d3Force: (name: string, force?: object | null) => object | undefined;
  d3ReheatSimulation: () => void;
};

export function ForceGraph({
  graph,
  highlightIds,
  focusId,
  centerId,
  centerNonce,
  onHover,
  onFocus,
}: {
  graph: GraphPayload;
  highlightIds: string[];
  focusId: string | null;
  centerId: string | null;
  centerNonce: number;
  onHover: (node: GraphNode | null) => void;
  onFocus: (node: GraphNode | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GraphApi | undefined>(undefined);
  const engineOn = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const graphData = useMemo(() => toGraphData(graph), [graph]);
  const dataRef = useRef(graphData);
  const sizeRef = useRef(size);
  const fontRef = useRef("sans-serif");
  const viewRef = useRef({
    highlight: highlightIds,
    focusId,
    hoverId: null as string | null,
    rootId: graph.root.id,
  });

  useEffect(() => {
    dataRef.current = graphData;
    viewRef.current.highlight = highlightIds;
    viewRef.current.focusId = focusId;
    viewRef.current.rootId = graph.root.id;
  }, [graphData, highlightIds, focusId, graph.root.id]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const signature = graphData.nodes.map((node) => node.id).join("|");

  const fit = useCallback((duration = 0) => {
    const api = apiRef.current;
    const { width, height } = sizeRef.current;
    if (!api || width < 80 || height < 80) return;
    const placed = dataRef.current.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (placed.length === 0) return;
    const padding = fitPadding(width, height);
    api.zoomToFit(duration, padding, (node) => Number.isFinite(node.x) && Number.isFinite(node.y));
  }, []);

  useEffect(() => {
    fontRef.current = getComputedStyle(document.body).fontFamily || "sans-serif";
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tuned = useRef({ api: undefined as GraphApi | undefined, signature: "" });
  const attach = useCallback(
    (instance: ForceGraphMethods | null) => {
      const api = (instance ?? undefined) as GraphApi | undefined;
      apiRef.current = api;
      if (!api) return;
      if (tuned.current.api === api && tuned.current.signature === signature) return;
      tuned.current = { api, signature };
      engineOn.current = true;
      tuneForces(api);
    },
    [signature],
  );

  useEffect(() => {
    if (size.width < 80 || size.height < 80) return;
    const timer = window.setTimeout(() => {
      if (engineOn.current) return;
      fit(0);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [size.width, size.height, fit]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (!engineOn.current) fit(0);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!centerId || !centerNonce) return;
    let frames = 0;
    let raf = 0;
    const step = () => {
      const api = apiRef.current;
      const node = dataRef.current.nodes.find((item) => item.id === centerId);
      if (api && node && typeof node.x === "number" && typeof node.y === "number") {
        // Center only: the fitted zoom keeps the rest of the graph in view, and the ring marks the node.
        api.centerAt(node.x, node.y, 400);
        return;
      }
      frames += 1;
      if (frames < 40) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [centerId, centerNonce]);

  const paint = useCallback((obj: object, ctx: CanvasRenderingContext2D) => {
    paintNode(obj as SimNode, ctx, viewRef.current);
  }, []);

  const paintPointer = useCallback((obj: object, color: string, ctx: CanvasRenderingContext2D) => {
    const node = obj as SimNode;
    if (typeof node.x !== "number" || typeof node.y !== "number") return;
    const radius = node.id === viewRef.current.rootId ? 13 : 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  function hover(node: GraphNode | null) {
    viewRef.current.hoverId = node?.id ?? null;
    onHover(node);
  }

  return (
    <div ref={frame} className="graph-frame">
      {size.width > 0 && size.height > 0 ? (
        <ForceGraph2D
          ref={attach as unknown as MutableRefObject<ForceGraphMethods | undefined>}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={() => ""}
          nodeRelSize={1}
          nodeColor={(node: object) => colorFor((node as SimNode).type)}
          nodeCanvasObject={paint}
          nodeCanvasObjectMode={() => "after"}
          nodePointerAreaPaint={paintPointer}
          linkColor={linkColor}
          linkWidth={1}
          autoPauseRedraw={false}
          minZoom={0.08}
          maxZoom={8}
          d3AlphaDecay={0.045}
          d3VelocityDecay={0.45}
          warmupTicks={40}
          cooldownTicks={120}
          onEngineTick={() => {
            engineOn.current = true;
          }}
          onEngineStop={() => {
            engineOn.current = false;
            fit(0);
          }}
          onRenderFramePost={(ctx, globalScale) => {
            drawLabels(ctx, globalScale, dataRef.current.nodes, viewRef.current, fontRef.current);
          }}
          onNodeHover={(node) => hover(asGraphNode(node))}
          onNodeClick={(node) => {
            const item = asGraphNode(node);
            if (!item) return;
            onFocus(item);
          }}
          onBackgroundClick={() => {
            viewRef.current.hoverId = null;
            onFocus(null);
          }}
          showPointerCursor
        />
      ) : null}
    </div>
  );
}

function asGraphNode(node: { id?: string | number; type?: NodeType; label?: string; props?: Record<string, unknown> } | null): GraphNode | null {
  if (!node || typeof node.id !== "string" || typeof node.label !== "string" || !node.type) return null;
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    props: node.props ?? {},
    source_url: "source_url" in node && typeof node.source_url === "string" ? node.source_url : undefined,
    fetched_at: "fetched_at" in node && typeof node.fetched_at === "string" ? node.fetched_at : undefined,
    confidence: "confidence" in node && typeof node.confidence === "number" ? node.confidence : undefined,
  };
}

function linkColor(): string {
  return cssVar("--faint", "#a6a6a6");
}

function toGraphData(graph: GraphPayload): { nodes: SimNode[]; links: SimLink[] } {
  const map = new Map<string, GraphNode>();
  map.set(graph.root.id, graph.root);
  for (const node of graph.nodes) map.set(node.id, node);
  const nodes: SimNode[] = [...map.values()].map((node) => ({ ...node }));
  placeNodes(nodes, graph.root.id);
  nodes.sort((a, b) => (a.id === graph.root.id ? -1 : b.id === graph.root.id ? 1 : a.id.localeCompare(b.id)));
  const ids = new Set(nodes.map((node) => node.id));
  const links = graph.links
    .filter((link) => ids.has(link.source) && ids.has(link.target))
    .map((link) => ({ source: link.source, target: link.target, type: link.type }));
  return { nodes, links };
}

const LINK_DISTANCE: Record<string, number> = {
  HAS_ACCOUNT: 88,
  WORKS_AT: 150,
  WORKED_AT: 160,
  STUDIED_AT: 160,
  AUTHORED: 130,
  POSTED_ON: 52,
  ABOUT: 64,
  USES: 48,
  HAS_SKILL: 96,
  INTERESTED_IN: 190,
  BASED_IN: 140,
};

const RING_RADIUS: Record<string, number> = {
  Account: 78,
  Organization: 118,
  Location: 118,
  Skill: 158,
  Topic: 198,
  Repo: 238,
  Package: 238,
  Post: 278,
  Video: 278,
  Article: 318,
};

function ringRadius(type: string): number {
  return RING_RADIUS[type] ?? 198;
}

function placeNodes(nodes: SimNode[], rootId: string): void {
  const groups = new Map<string, SimNode[]>();
  for (const node of nodes) {
    if (node.id === rootId) {
      node.x = 0;
      node.y = 0;
      node.fx = 0;
      node.fy = 0;
      continue;
    }
    const list = groups.get(node.type) ?? [];
    list.push(node);
    groups.set(node.type, list);
  }
  const types = [...groups.keys()].sort((a, b) => ringRadius(a) - ringRadius(b) || a.localeCompare(b));
  types.forEach((type, ring) => {
    const list = groups.get(type) ?? [];
    const radius = ringRadius(type);
    list.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(list.length, 1) - Math.PI / 2 + ring * 0.4;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
    });
  });
}

function fitPadding(width: number, height: number): number {
  const room = Math.min(width, height);
  const pad = Math.round(Math.min(64, Math.max(36, room * 0.12)));
  return Math.min(pad, Math.max(16, Math.floor((room - 96) / 2)));
}

function tuneForces(api: GraphApi): void {
  const link = api.d3Force("link") as
    | { distance?: (fn: (link: SimLink) => number) => void; strength?: (value: number) => void }
    | undefined;
  link?.distance?.((item) => LINK_DISTANCE[item.type] ?? 90);
  link?.strength?.(0.2);
  const charge = api.d3Force("charge") as
    | { strength?: (value: number) => void; distanceMax?: (value: number) => void }
    | undefined;
  charge?.strength?.(-18);
  charge?.distanceMax?.(90);
  api.d3Force(
    "collide",
    collideForce((node) => (node.type === "Person" ? 26 : 13)),
  );
  api.d3Force("radial", holdRing(0.85));
  api.d3ReheatSimulation();
}

function holdRing(strength: number) {
  let nodes: SimNode[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      if (node.x == null || node.y == null || node.fx != null) continue;
      const target = node.type === "Person" ? 0 : ringRadius(node.type);
      const dist = Math.hypot(node.x, node.y);
      const gap = dist - target;
      if (dist < 1) {
        const angle = hashAngle(node.id);
        node.x = Math.cos(angle) * target;
        node.y = Math.sin(angle) * target;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      const pull = (gap / dist) * strength * alpha;
      node.vx = (node.vx ?? 0) - node.x * pull;
      node.vy = (node.vy ?? 0) - node.y * pull;
    }
  };
  force.initialize = (list: SimNode[]) => {
    nodes = list;
  };
  return force;
}

function collideForce(radius: (node: SimNode) => number) {
  let nodes: SimNode[] = [];
  const force = (alpha: number) => {
    const push = Math.min(1, 0.25 + alpha * 6);
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (!a || a.x == null || a.y == null) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (!b || b.x == null || b.y == null) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const min = radius(a) + radius(b);
        if (dist === 0) {
          dx = 0.4;
          dy = (j - i) * 0.2;
          dist = Math.hypot(dx, dy);
        }
        if (dist >= min) continue;
        const shift = ((min - dist) / dist) * 0.5 * push;
        const mx = dx * shift;
        const my = dy * shift;
        if (a.fx == null) a.x -= mx;
        if (a.fy == null) a.y -= my;
        if (b.fx == null) b.x += mx;
        if (b.fy == null) b.y += my;
      }
    }
  };
  force.initialize = (list: SimNode[]) => {
    nodes = list;
  };
  return force;
}

function paintNode(
  node: SimNode,
  ctx: CanvasRenderingContext2D,
  view: { highlight: string[]; focusId: string | null; hoverId: string | null; rootId: string },
) {
  if (typeof node.x !== "number" || typeof node.y !== "number") return;
  const root = node.id === view.rootId;
  const hot = view.highlight.includes(node.id);
  const focused = view.focusId === node.id;
  const hovered = view.hoverId === node.id;
  const radius = (root ? 9 : 4.5) + (hovered ? 1.2 : 0);
  const color = colorFor(node.type);
  const { x, y } = node;

  ctx.save();
  if (hot) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (focused) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = cssVar("--blue", "#2f6fe4");
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = cssVar("--bg", "#ffffff");
  ctx.stroke();
  ctx.restore();
}

type LabelBox = { left: number; top: number; right: number; bottom: number };

function drawLabels(
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  nodes: SimNode[],
  view: { highlight: string[]; focusId: string | null; hoverId: string | null; rootId: string },
  fontFamily: string,
): void {
  const ranked = nodes
    .filter((node) => typeof node.x === "number" && typeof node.y === "number")
    .sort((a, b) => labelRank(a, view) - labelRank(b, view) || a.id.localeCompare(b.id));
  const placed: LabelBox[] = [];
  const fontSize = 12 / globalScale;
  ctx.save();
  ctx.font = `500 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const node of ranked) {
    const rank = labelRank(node, view);
    const forced = rank <= 1;
    if (!forced && !showLabel(node, view, globalScale, rank)) continue;
    const text = shortLabel(node.label, globalScale);
    const width = ctx.measureText(text).width;
    const height = fontSize * 1.25;
    const radius = (node.id === view.rootId ? 9 : 4.5) + 2 / globalScale;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const spots = [
      { x, y: y + radius },
      { x, y: y - radius - height },
      { x: x + radius + width / 2, y: y - height / 2 },
      { x: x - radius - width / 2, y: y - height / 2 },
    ];
    let chosen: { x: number; y: number } | null = null;
    let box: LabelBox | null = null;
    for (const spot of spots) {
      const next = {
        left: spot.x - width / 2 - 3 / globalScale,
        top: spot.y,
        right: spot.x + width / 2 + 3 / globalScale,
        bottom: spot.y + height,
      };
      if (placed.some((item) => overlaps(item, next))) continue;
      chosen = spot;
      box = next;
      break;
    }
    if (!chosen || !box) {
      if (!forced) continue;
      chosen = spots[0];
      box = {
        left: chosen.x - width / 2,
        top: chosen.y,
        right: chosen.x + width / 2,
        bottom: chosen.y + height,
      };
    }
    placed.push(box);
    ctx.lineWidth = 3 / globalScale;
    ctx.strokeStyle = cssVar("--bg", "#ffffff");
    ctx.strokeText(text, chosen.x, chosen.y);
    ctx.fillStyle = cssVar("--fg", "#1f1f1f");
    ctx.fillText(text, chosen.x, chosen.y);
  }
  ctx.restore();
}

function labelRank(
  node: SimNode,
  view: { highlight: string[]; focusId: string | null; hoverId: string | null; rootId: string },
): number {
  if (node.id === view.hoverId || node.id === view.focusId) return 0;
  if (view.highlight.includes(node.id)) return 1;
  if (node.id === view.rootId) return 2;
  if (node.type === "Organization" || node.type === "Account" || node.type === "Location") return 3;
  if (node.type === "Topic" || node.type === "Skill") return 4;
  return 5;
}

function showLabel(
  node: SimNode,
  view: { rootId: string },
  globalScale: number,
  rank: number,
): boolean {
  if (node.id === view.rootId || rank <= 3) return true;
  if (rank === 4) return globalScale >= 1.6;
  return globalScale >= 2.4;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function hashAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return (hash % 360) * (Math.PI / 180);
}

function shortLabel(label: string, scale: number): string {
  const text = displayLabel(label);
  const max = scale >= 2.2 ? 34 : scale >= 1.05 ? 20 : 14;
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const space = slice.lastIndexOf(" ");
  const cut = space >= 10 ? slice.slice(0, space).trimEnd() : slice.trimEnd();
  return `${cut}…`;
}

function colorFor(type: NodeType): string {
  return cssVar(NODE_COLOR_VAR[type], "#6b6b6b");
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
