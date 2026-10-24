"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/shell/Avatar";
import { useDropProtected } from "@/components/shell/privacy";
import { TraceLine } from "@/components/shell/TraceModal";
import {
  EMPTY_LIST,
  EMPTY_VIEWER,
  INTRO,
  parseWhoResponse,
  roleLabel,
  sayLine,
  shareChips,
  visiblePeople,
  whoUrl,
  whyNowParts,
  type Trace,
  type WhoRow,
} from "./parse";

export type { Trace, WhoRow } from "./parse";

export type WhoToMeetProps = {
  /** Person slug for "you". Pass "" when nobody is picked; that skips the fetch. */
  viewer: string;
  /** Select this person so their brief opens. */
  onOpen: (slug: string) => void;
};

type Load =
  | { status: "ready"; viewer: string; drop: boolean; attempt: number; people: WhoRow[]; traces: Trace[]; reason?: string }
  | { status: "error"; viewer: string; drop: boolean; attempt: number; message: string };

/**
 * Landing view for the main column when nobody is selected.
 * Fills a `position: relative` parent (the graph pane) and scrolls inside it.
 */
export function WhoToMeet({ viewer, onOpen }: WhoToMeetProps) {
  const drop = useDropProtected();
  const slug = viewer.trim();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    if (!slug) return;
    const ctrl = new AbortController();
    let live = true;
    const requestAttempt = attempt;
    const requestDrop = drop;

    void (async () => {
      try {
        const response = await fetch(whoUrl(slug, requestDrop), {
          signal: ctrl.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body: unknown = await response.json().catch(() => null);
        if (!live) return;
        if (!response.ok) {
          setLoad({
            status: "error",
            viewer: slug,
            drop: requestDrop,
            attempt: requestAttempt,
            message: errorMessage(response.status, body),
          });
          return;
        }
        const parsed = parseWhoResponse(body);
        if (!parsed) {
          setLoad({
            status: "error",
            viewer: slug,
            drop: requestDrop,
            attempt: requestAttempt,
            message: "Couldn't load who to meet.",
          });
          return;
        }
        setLoad({
          status: "ready",
          viewer: slug,
          drop: requestDrop,
          attempt: requestAttempt,
          people: visiblePeople(parsed.people, slug),
          traces: parsed.traces,
          reason: parsed.reason,
        });
      } catch (error) {
        if (!live || ctrl.signal.aborted) return;
        setLoad({
          status: "error",
          viewer: slug,
          drop: requestDrop,
          attempt: requestAttempt,
          message: networkMessage(error),
        });
      }
    })();

    return () => {
      live = false;
      ctrl.abort();
    };
  }, [slug, drop, attempt]);

  const current = load && load.viewer === slug && load.drop === drop && load.attempt === attempt ? load : null;
  const status = !slug ? "empty" : current?.status ?? "loading";
  const people = current?.status === "ready" ? current.people : [];
  const traces = current?.status === "ready" ? current.traces : [];
  const emptyNote = current?.status === "ready" ? current.reason || EMPTY_LIST : EMPTY_LIST;

  return (
    <section aria-label="Who to meet" aria-busy={status === "loading"} data-who={status} style={FRAME}>
      <p className="eyebrow">WHO TO MEET</p>
      <p className="pane-copy">{INTRO}</p>
      <Legend />
      {status === "empty" ? <p className="pane-copy" style={{ marginTop: 16 }}>{EMPTY_VIEWER}</p> : null}
      {status === "loading" ? <Loading /> : null}
      {status === "error" && current?.status === "error" ? (
        <div style={{ marginTop: 16 }}>
          <p className="error-line" role="alert">{current.message}</p>
          <button type="button" className="pill sm" onClick={() => setAttempt((n) => n + 1)} style={{ marginTop: 12 }}>
            Retry
          </button>
        </div>
      ) : null}
      {status === "ready" && people.length === 0 ? (
        <p className="pane-copy" style={{ marginTop: 16 }}>{emptyNote}</p>
      ) : null}
      {status === "ready" && people.length > 0 ? (
        <ul style={LIST}>
          {people.map((person) => (
            <li key={person.slug} style={{ margin: 0, padding: 0 }}>
              <WhoMeetCard person={person} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : null}
      {status === "ready" && traces.length > 0 ? (
        <TraceLine
          tools={traces.map((trace, index) => ({ id: String(index), input: {}, ...trace }))}
          citedNodes={0}
        />
      ) : null}
    </section>
  );
}

export function WhoMeetCard({ person, onOpen }: { person: WhoRow; onOpen: (slug: string) => void }) {
  const [hot, setHot] = useState(false);
  const role = roleLabel(person.role);
  const why = whyNowParts(person.whyNow);
  const chips = shareChips(person.shared);
  const say = sayLine(person.opener);
  const whyTitle = person.whyNow?.via ? `${why.line} · ${person.whyNow.via}` : why.line;

  return (
    <button
      type="button"
      data-slug={person.slug}
      onClick={() => onOpen(person.slug)}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{ ...CARD, background: hot ? "var(--band)" : "transparent" }}
    >
      <span style={ROW_1}>
        <span aria-hidden="true">
          <Avatar name={person.name} url={person.avatar_url || undefined} />
        </span>
        <span style={IDENTITY}>
          <span style={{ ...NAME, maxWidth: person.headline ? "46%" : "100%" }} title={person.name}>
            {person.name}
          </span>
          {role ? <RoleTag role={role} /> : null}
          {person.headline ? (
            <span style={HEADLINE} title={person.headline}>
              {person.headline}
            </span>
          ) : null}
        </span>
        <span style={OPEN}>Open brief ›</span>
      </span>
      <span style={ROWS}>
        <span style={LINE}>
          <span style={KICKER}>Why now</span>
          <span style={VALUE}>
            <span style={{ ...ELLIPSIS, color: why.quiet ? "var(--muted)" : "var(--fg)" }} title={whyTitle}>
              {why.line}
            </span>
            {why.word ? <span style={TYPE_WORD}>{why.word}</span> : null}
          </span>
        </span>
        {chips.length > 0 ? (
          <span style={{ ...LINE, alignItems: "center" }}>
            <span style={KICKER}>You share</span>
            <span style={CHIPS}>
              {chips.map((chip, index) => (
                <span
                  className="chip"
                  key={`${chip.label}:${index}`}
                  title={chip.kind || undefined}
                  style={{ background: "var(--soft)", color: "var(--fg)" }}
                >
                  {chip.label}
                </span>
              ))}
            </span>
          </span>
        ) : null}
        {say ? (
          <span style={{ ...LINE, alignItems: "start" }}>
            <span style={KICKER}>Say</span>
            <span style={QUOTE} title={person.opener}>
              {say}
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RoleTag({ role }: { role: string }) {
  if (role === "Judge") return <span className="tag judge">Judge</span>;
  return (
    <span className="tag" style={{ color: "var(--muted)", background: "var(--soft)" }}>
      {role}
    </span>
  );
}

function Legend() {
  return (
    <p style={LEGEND}>
      <span style={LEGEND_ITEM}>
        <span aria-hidden="true" style={{ color: "var(--blue)" }}>●</span>
        <span>You</span>
      </span>
      <span style={LEGEND_ITEM}>
        <span aria-hidden="true" style={{ color: "var(--amber)" }}>●</span>
        <span>Them</span>
      </span>
    </p>
  );
}

function Loading() {
  return (
    <>
      <p className="sr-only">Loading who to meet</p>
      <div className="skel-list" aria-hidden="true" style={{ marginTop: 16 }}>
        {["a", "b", "c"].map((key) => (
          <div key={key} style={{ ...CARD, cursor: "default" }}>
            <div className="skel-row" style={{ padding: 0 }}>
              <span className="skel skel-avatar" />
              <span className="skel-copy">
                <span className="skel skel-line" />
                <span className="skel skel-line short" />
              </span>
            </div>
            <span className="skel skel-line" style={{ marginLeft: 46 }} />
            <span className="skel skel-line short" style={{ marginLeft: 46 }} />
          </div>
        ))}
      </div>
    </>
  );
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const raw = body as { error?: unknown; message?: unknown; reason?: unknown };
    for (const value of [raw.error, raw.message, raw.reason]) {
      if (typeof value === "string" && value.trim()) return clip(value.trim());
    }
  }
  if (status === 404) return "Who to meet isn't ready yet.";
  return "Couldn't load who to meet.";
}

function networkMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (/failed to fetch|load failed|networkerror/i.test(error.message)) return "Couldn't load who to meet.";
    return clip(error.message);
  }
  return "Couldn't load who to meet.";
}

function clip(value: string): string {
  return value.length > 180 ? `${value.slice(0, 179)}…` : value;
}

const FRAME: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "auto",
  padding: "20px 22px 28px",
  textAlign: "left",
  background: "var(--bg)",
  color: "var(--fg)",
};

const LEGEND: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  margin: "12px 0 0",
  fontSize: 13.5,
  color: "var(--muted)",
};

const LEGEND_ITEM: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const LIST: CSSProperties = {
  listStyle: "none",
  margin: "16px 0 0",
  padding: 0,
  display: "grid",
  gap: 10,
};

const CARD: CSSProperties = {
  display: "grid",
  gap: 8,
  width: "100%",
  margin: 0,
  padding: "12px 14px",
  border: "1px solid var(--line)",
  borderRadius: 16,
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const ROW_1: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "36px minmax(0, 1fr) auto",
  gap: 10,
  alignItems: "center",
  minWidth: 0,
};

const IDENTITY: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const NAME: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 16.5,
  fontWeight: 600,
  letterSpacing: "-0.01em",
};

const HEADLINE: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--muted)",
  fontSize: 14.5,
};

const OPEN: CSSProperties = {
  flex: "none",
  fontSize: 13.5,
  fontWeight: 500,
  color: "var(--muted)",
  whiteSpace: "nowrap",
};

const ROWS: CSSProperties = {
  display: "grid",
  gap: 8,
  paddingLeft: 46,
  minWidth: 0,
};

const LINE: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  minWidth: 0,
};

const KICKER: CSSProperties = {
  flex: "none",
  width: 96,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--muted)",
  whiteSpace: "nowrap",
};

const VALUE: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  minWidth: 0,
  flex: 1,
};

const ELLIPSIS: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 14.5,
};

const TYPE_WORD: CSSProperties = {
  flex: "none",
  font: "12.5px var(--mono)",
  color: "var(--faint)",
};

const CHIPS: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  minWidth: 0,
};

const QUOTE: CSSProperties = {
  minWidth: 0,
  fontSize: 15.5,
  lineHeight: 1.4,
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
};
