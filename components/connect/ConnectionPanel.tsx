"use client";

import { TraceLine } from "@/components/shell/TraceModal";
import { useDropProtected } from "@/components/shell/privacy";
import { Fragment, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  connectUrl,
  connectView,
  firstName,
  formatDay,
  missingConnectRoute,
  parseConnect,
  safeUrl,
  sampleConnect,
  type ConnectResponse,
  type ConnectShared,
  type ConnectWhyNow,
  type PathNode,
  type PathRole,
} from "./model";

export type ConnectionPanelProps = {
  viewer: { slug: string; name: string };
  person: { slug: string; name: string };
  onCite: (cite: { slug: string; nodeId: string }) => void;
  onShowGraphs: () => void;
};

type Load = {
  key: string;
  status: "ready" | "error";
  data: ConnectResponse | null;
  message: string | null;
  sample: boolean;
};

/**
 * "How you connect" evidence column: the shortest path, intro paths,
 * shared facts, and why now. Fills the right column and scrolls.
 */
export function ConnectionPanel({ viewer, person, onCite, onShowGraphs }: ConnectionPanelProps) {
  const drop = useDropProtected();
  const [loaded, setLoaded] = useState<Load | null>(null);
  const viewerSlug = viewer.slug;
  const viewerName = viewer.name;
  const personSlug = person.slug;
  const personName = person.name;
  const key = `${viewerSlug}\n${personSlug}\n${drop ? "1" : "0"}`;

  useEffect(() => {
    if (!viewerSlug || !personSlug) return;
    const ctrl = new AbortController();
    let live = true;

    void (async () => {
      try {
        const response = await fetch(connectUrl(viewerSlug, personSlug, drop), {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!live) return;
        if (missingConnectRoute(response.status, response.headers.get("content-type"))) {
          setLoaded({ key, status: "ready", data: null, message: null, sample: true });
          return;
        }
        if (!response.ok) {
          setLoaded({ key, status: "error", data: null, message: await readError(response), sample: false });
          return;
        }
        const data = parseConnect(await response.json());
        if (!live) return;
        setLoaded({ key, status: "ready", data, message: null, sample: false });
      } catch (error) {
        if (!live || ctrl.signal.aborted) return;
        setLoaded({
          key,
          status: "error",
          data: null,
          message: error instanceof Error && error.message ? error.message : "Couldn't load how you connect.",
          sample: false,
        });
      }
    })();

    return () => {
      live = false;
      ctrl.abort();
    };
  }, [key, viewerSlug, personSlug, drop]);

  const current = loaded?.key === key ? loaded : null;
  const status = !viewerSlug || !personSlug ? "idle" : current?.status ?? "loading";
  const data =
    current?.status !== "ready"
      ? null
      : current.sample
        ? sampleConnect({ slug: viewerSlug, name: viewerName }, { slug: personSlug, name: personName })
        : current.data;
  const themName = person.name.trim() || data?.personName || "";
  const view = data ? connectView(data, themName) : null;
  const legendName = firstName(themName || data?.personName || "") || "Them";

  return (
    <section
      aria-label="How you connect"
      aria-busy={status === "loading"}
      data-connect={status}
      data-sample={current?.sample ? "true" : "false"}
      style={panelStyle}
    >
      <style>{CN_CSS}</style>
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow" style={{ marginBottom: 6 }}>How you connect</p>
          <p style={legendStyle}>
            <LegendSwatch color="var(--blue)" label="You" />
            <LegendSwatch color="var(--amber)" label={legendName} />
          </p>
        </div>
        <button type="button" className="pill sm line" onClick={onShowGraphs} style={{ flex: "none" }}>
          Show full graphs
        </button>
      </header>

      {!viewerSlug ? <p className="pane-copy" style={{ marginTop: 16 }}>Pick who you are to see how you connect.</p> : null}
      {viewerSlug && !personSlug ? <p className="pane-copy" style={{ marginTop: 16 }}>Pick a person to see how you connect.</p> : null}
      {status === "loading" ? <p className="pane-copy" style={{ marginTop: 16 }}>Finding how you connect…</p> : null}
      {status === "error" ? (
        <p className="error-line" style={{ marginTop: 16 }}>{current?.message || "Couldn't load how you connect."}</p>
      ) : null}

      {view && current?.sample ? (
        <p className="pane-copy" style={{ marginTop: 14 }}>
          Sample view. Live facts show up once this connection is ready.
        </p>
      ) : null}

      {view && !view.empty ? (
        <>
          {view.direct.length > 0 ? <PathBlock caption="Direct" nodes={view.direct} /> : null}
          {view.intros.map((intro) => (
            <PathBlock key={intro.id} caption={intro.caption} nodes={intro.nodes} />
          ))}
          {view.shared.length > 0 ? (
            <section aria-label="What you share" style={{ marginTop: 18 }}>
              <p className="block-label" style={sectionLabel}>What you share</p>
              {view.shared.map((row) => (
                <ShareRow key={`${row.kind}:${row.mine}:${row.theirs}:${row.label}`} row={row} viewer={viewer} person={person} onCite={onCite} />
              ))}
            </section>
          ) : null}
          {view.whyNow.length > 0 ? (
            <section aria-label="Why now" style={{ marginTop: 18 }}>
              <p className="block-label" style={sectionLabel}>Why now</p>
              {view.whyNow.map((item) => (
                <WhyRow key={`${item.item}:${item.date}:${item.label}`} item={item} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {view?.empty ? <p className="pane-copy" style={{ marginTop: 16 }}>No shared ground found in public work yet</p> : null}

      {data && data.traces.length > 0 ? (
        <div style={{ marginTop: "auto", paddingTop: 14 }}>
          <TraceLine tools={traceTools(data.traces)} citedNodes={0} />
        </div>
      ) : null}
    </section>
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; reason?: unknown; message?: unknown };
    const message = [body.error, body.reason, body.message].find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message.trim();
  } catch {
    /* HTML or empty */
  }
  return "Couldn't load how you connect.";
}

const ROOM_TRACES = new Set(["shared_facets", "why_now", "intro_paths", "two_hop_people"]);

/** TraceModal titles are keyed as room.<name>. The API sends the short name. */
function traceTools(traces: ConnectResponse["traces"]) {
  return traces.map((trace, index) => ({
    id: String(index),
    input: {},
    ...trace,
    name: trace.name.startsWith("room.") || !ROOM_TRACES.has(trace.name) ? trace.name : `room.${trace.name}`,
  }));
}

function PathBlock({ caption, nodes }: { caption: string; nodes: PathNode[] }) {
  const crowded = nodes.length > 4;
  return (
    <div style={{ marginTop: 16 }}>
      <p className="block-label" style={sectionLabel}>{caption}</p>
      <div
        role="img"
        aria-label={`${caption}. ${nodes.map((node) => node.title).join(" — ")}`}
        style={{
          display: "flex",
          // Long intro paths wrap whole pills onto a second line instead of squeezing words.
          flexWrap: crowded ? "wrap" : "nowrap",
          alignItems: "center",
          gap: "8px 0",
          width: "100%",
        }}
      >
        {nodes.map((node, index) => (
          <Fragment key={`${node.role}:${node.title}:${index}`}>
            {index > 0 ? <Connector /> : null}
            <PathPill node={node} crowded={crowded} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 12px",
        width: 12,
        height: 2,
        margin: "0 3px",
        borderRadius: 999,
        background: "var(--faint)",
        alignSelf: "center",
      }}
    />
  );
}

function PathPill({ node, crowded }: { node: PathNode; crowded: boolean }) {
  return (
    <span title={node.title} style={pillChrome(node.role, crowded)}>
      <span style={clampStyle}>{node.label}</span>
    </span>
  );
}

function pillChrome(role: PathRole, crowded: boolean): CSSProperties {
  const palette: CSSProperties =
    role === "you"
      ? { background: "var(--blue-bg)", color: "var(--blue)" }
      : role === "them"
        ? { background: "var(--amber-bg)", color: "var(--amber)" }
        : role === "mutual"
          ? { background: "var(--soft)", color: "var(--fg)" }
          : { background: "var(--well)", color: "var(--fg)", boxShadow: "inset 0 0 0 1px var(--line)" };
  return {
    flex: crowded ? "0 1 auto" : role === "facet" ? "1.35 1 0" : "1 1 0",
    minWidth: 0,
    maxWidth: crowded ? 200 : 168,
    whiteSpace: crowded ? "nowrap" : undefined,
    padding: crowded ? "4px 6px" : "6px 10px",
    borderRadius: role === "facet" ? 10 : 999,
    fontSize: crowded ? 13 : 14.5,
    fontWeight: 600,
    lineHeight: 1.25,
    textAlign: "center",
    ...palette,
  };
}

function ShareRow({
  row,
  viewer,
  person,
  onCite,
}: {
  row: ConnectShared;
  viewer: { slug: string; name: string };
  person: { slug: string; name: string };
  onCite: (cite: { slug: string; nodeId: string }) => void;
}) {
  const theirName = firstName(person.name);
  return (
    <div style={shareRowStyle}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={shareLabelStyle} title={row.label}>{row.label}</span>
        {row.kind ? <span style={{ flex: "none", color: "var(--muted)", fontSize: 13 }}>{row.kind}</span> : null}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2, flex: "none" }}>
        <CiteDot
          color="var(--blue)"
          label={`Highlight ${row.label} in your facts`}
          nodeId={row.mine}
          onCite={() => onCite({ slug: viewer.slug, nodeId: row.mine })}
        />
        <CiteDot
          color="var(--amber)"
          label={`Highlight ${row.label} in ${theirName ? `${theirName}'s` : "their"} facts`}
          nodeId={row.theirs}
          onCite={() => onCite({ slug: person.slug, nodeId: row.theirs })}
        />
      </span>
    </div>
  );
}

function CiteDot({ color, label, nodeId, onCite }: { color: string; label: string; nodeId: string; onCite: () => void }) {
  return (
    <button
      type="button"
      className="cn-dot"
      aria-label={label}
      title={label}
      disabled={!nodeId}
      onMouseEnter={onCite}
      onFocus={onCite}
      style={dotButtonStyle}
    >
      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: color, display: "block" }} />
    </button>
  );
}

function WhyRow({ item }: { item: ConnectWhyNow }) {
  const href = safeUrl(item.url);
  const when = formatDay(item.date);
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        {when ? (
          <span style={{ flex: "none", font: "13px/1.4 var(--mono)", color: "var(--muted)" }}>{when}</span>
        ) : null}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" style={whyLinkStyle}>
            {item.label}
          </a>
        ) : (
          <span style={whyTextStyle}>{item.label}</span>
        )}
      </div>
      {item.via ? <p style={viaStyle}>via {item.via}</p> : null}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span aria-hidden="true" style={{ color, fontSize: 12, lineHeight: 1 }}>●</span>
      <span>{label}</span>
    </span>
  );
}

const panelStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  padding: "16px 16px 20px",
  background: "var(--bg)",
  color: "var(--fg)",
  fontFamily: "var(--sans)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
};

const legendStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13.5,
  fontWeight: 600,
  color: "var(--fg)",
};

const sectionLabel: CSSProperties = { margin: "0 0 8px" };

const shareRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  minHeight: 36,
  padding: "4px 0",
  borderTop: "1px solid var(--line)",
};

const shareLabelStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 15.5,
  fontWeight: 600,
};

const dotButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: 0,
  borderRadius: 999,
  background: "transparent",
  cursor: "pointer",
};

const clampStyle: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "normal",
  textOverflow: "ellipsis",
  textAlign: "center",
  width: "100%",
};

const whyLinkStyle: CSSProperties = {
  minWidth: 0,
  color: "var(--fg)",
  fontWeight: 600,
  fontSize: 15,
  lineHeight: 1.35,
  textDecoration: "underline",
  textDecorationColor: "var(--line)",
  textUnderlineOffset: 2,
};

const whyTextStyle: CSSProperties = {
  minWidth: 0,
  color: "var(--fg)",
  fontWeight: 600,
  fontSize: 15,
  lineHeight: 1.35,
};

const viaStyle: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 13,
  color: "var(--muted)",
};

const CN_CSS = `
.cn-dot:hover span, .cn-dot:focus-visible span { box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg) 18%, transparent); }
.cn-dot:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.cn-dot:disabled { cursor: default; opacity: 0.4; }
`;
