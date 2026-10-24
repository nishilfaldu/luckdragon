"use client";

import { useEffect, useState } from "react";

type SourceProvider = "Bright Data" | "GitHub API" | "LLM";

type SourceProduct = {
  product: string;
  provider: SourceProvider;
  count: number;
  sampleUrls: string[];
};

type SourceOutcome = { source: string; status: "ok" | "failed" | "none"; count?: number; message?: string };

type SourceSummary = {
  slug: string;
  total: number;
  products: SourceProduct[];
  freshness?: { at: string; sources: SourceOutcome[] } | null;
};

type PanelState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "ready"; summary: SourceSummary };

const PRODUCT_COLOR: Record<string, string> = {
  "LinkedIn · Web Scraper API": "var(--node-account)",
  "X · Web Scraper API": "var(--node-post)",
  "YouTube · Web Scraper API": "var(--node-video)",
  "Bluesky · Web Scraper API": "var(--node-topic)",
  "Reddit · Web Scraper API": "var(--amber-dot)",
  "Instagram · Web Scraper API": "var(--node-organization)",
  "Threads · Web Scraper API": "var(--node-article)",
  "Crunchbase · Web Scraper API": "var(--unit)",
  "Packages · Web Scraper API": "var(--node-package)",
  "npm · Web Scraper API": "var(--node-package)",
  "PyPI · Web Scraper API": "var(--node-skill)",
  GitHub: "var(--node-repo)",
  "Luma · Web Unlocker": "var(--blue)",
  "Web · SERP + Web Unlocker": "var(--amber)",
  Derived: "var(--faint)",
  Seed: "var(--node-person)",
};

export function SourcesPanel({ slug }: { slug: string }) {
  const [scope, setScope] = useState(slug);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  if (scope !== slug) {
    setScope(slug);
    setState({ kind: "loading" });
  }

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/sources/${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (response.status === 404) {
          setState({ kind: "empty" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }
        const body: unknown = await response.json();
        if (cancelled) return;
        if (!isSummary(body) || body.total === 0 || body.products.length === 0) {
          setState({ kind: "empty" });
          return;
        }
        setState({ kind: "ready", summary: body });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        setState({ kind: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  // Inline styles keep the panel styled even when a CSS module fails to load.
  return (
    <section aria-label="Data sources" style={{ marginTop: 8 }}>
      {state.kind === "loading" ? <p style={NOTE}>Loading sources…</p> : null}
      {state.kind === "empty" ? <p style={NOTE}>No sources recorded yet.</p> : null}
      {state.kind === "error" ? <p style={NOTE}>Couldn&apos;t load sources.</p> : null}
      {state.kind === "ready" ? <ProductList summary={state.summary} /> : null}
    </section>
  );
}

const NOTE = { margin: 0, fontSize: 14, color: "var(--muted)" } as const;

/** Plain-language names for the summary's product keys. */
const DISPLAY: Record<string, string> = {
  Derived: "Extracted by AI (topics, skills)",
  Seed: "From the people list",
};

function ProductList({ summary }: { summary: SourceSummary }) {
  const { products, total } = summary;
  const bright = products.filter((item) => item.provider === "Bright Data").reduce((sum, item) => sum + item.count, 0);
  const fetched = products.filter((item) => item.product !== "Derived").reduce((sum, item) => sum + item.count, 0);
  const share = fetched ? Math.round((bright / fetched) * 100) : 0;
  return (
    <>
      {summary.freshness ? <Freshness freshness={summary.freshness} /> : null}
      <p style={{ ...NOTE, marginBottom: 8 }}>
        {total} facts. {share}% of the fetched ones came through Bright Data.
      </p>
      <div
        role="img"
        aria-label={products.map((item) => `${item.product} ${item.count}`).join(", ")}
        style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", gap: 2, marginBottom: 10 }}
      >
        {products.map((item) => (
          <span key={item.product} title={`${label(item.product)}: ${item.count}`} style={{ flexGrow: item.count, background: colorFor(item.product) }} />
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {products.map((item) => (
          <li key={item.product} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, lineHeight: 1.35 }}>
            <i style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: colorFor(item.product) }} />
            <span style={{ flex: 1, minWidth: 0, color: "var(--fg)" }}>{label(item.product)}</span>
            {item.provider === "Bright Data" ? (
              <span style={{ flex: "none", fontSize: 12, padding: "0 7px", borderRadius: 999, color: "var(--blue)", background: "var(--blue-bg)" }}>
                Bright Data
              </span>
            ) : null}
            <span style={{ flex: "none", minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
              {item.count}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function label(product: string): string {
  return DISPLAY[product] ?? product;
}

function colorFor(product: string): string {
  return PRODUCT_COLOR[product] ?? "var(--muted)";
}

function isSummary(value: unknown): value is SourceSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as SourceSummary;
  return typeof row.slug === "string" && typeof row.total === "number" && Array.isArray(row.products);
}

const SOURCE_NAME: Record<string, string> = {
  linkedin: "LinkedIn", x: "X", youtube: "YouTube", github: "GitHub", website: "Website", serp: "Web search",
  luma: "Luma", research: "Research agent", instagram: "Instagram", threads: "Threads", bluesky: "Bluesky",
  reddit: "Reddit", crunchbase: "Crunchbase", packages: "npm/PyPI", tiktok: "TikTok",
};

function sourceName(id: string): string {
  return SOURCE_NAME[id] ?? id;
}

/** When the graph was fetched and how each source did, so failures are visible rather than silent. */
function Freshness({ freshness }: { freshness: { at: string; sources: SourceOutcome[] } }) {
  const tried = freshness.sources.filter((item) => item.source !== "resolve" && item.status !== "none");
  const ok = tried.filter((item) => item.status === "ok");
  const failed = tried.filter((item) => item.status === "failed");
  const missing = freshness.sources.filter((item) => item.status === "none" && item.source !== "resolve");
  const when = new Date(freshness.at);
  const today = when.toDateString() === new Date().toDateString();
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div style={{ margin: "0 0 12px", paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
      <p style={{ margin: 0, fontSize: 14, color: "var(--fg)" }}>
        Fetched {today ? "today" : when.toLocaleDateString()} at {time} · {ok.length} of {tried.length} sources OK
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {ok.map((item) => (
          <span key={item.source} className="chip" style={{ maxWidth: "100%" }}>
            {sourceName(item.source)} {item.count ?? ""}
          </span>
        ))}
      </div>
      {failed.map((item) => (
        <p key={item.source} style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--red)" }}>
          {sourceName(item.source)} failed{item.message ? `: ${item.message.slice(0, 90)}` : ""}. Skipped; the other sources were kept.
        </p>
      ))}
      {missing.length ? (
        <p style={{ ...NOTE, marginTop: 8, fontSize: 13 }}>No account found: {missing.map((item) => sourceName(item.source)).join(", ")}</p>
      ) : null}
      <p style={{ ...NOTE, marginTop: 6, fontSize: 12.5 }}>
        Failed requests are retried once, then that source is skipped without stopping the rest.
      </p>
    </div>
  );
}
