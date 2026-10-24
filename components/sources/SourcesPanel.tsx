"use client";

import { useEffect, useState } from "react";

type SourceProvider = "Bright Data" | "GitHub API" | "LLM";

type SourceProduct = {
  product: string;
  provider: SourceProvider;
  count: number;
  sampleUrls: string[];
};

type SourceSummary = {
  slug: string;
  total: number;
  products: SourceProduct[];
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
      <p style={{ ...NOTE, marginBottom: 8 }}>
        {total} nodes. {share}% of fetched facts came through Bright Data.
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
