"use client";

import { useEffect, useState } from "react";

import styles from "./SourcesPanel.module.css";

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

  return (
    <section className={styles.panel} aria-label="Where this graph came from">
      <h2 className={styles.title}>Where this graph came from</h2>
      {state.kind === "loading" ? <p className={styles.note}>Loading sources…</p> : null}
      {state.kind === "empty" ? <p className={styles.note}>No sources recorded yet.</p> : null}
      {state.kind === "error" ? <p className={styles.note}>Couldn&apos;t load sources.</p> : null}
      {state.kind === "ready" ? <ProductList products={state.summary.products} /> : null}
    </section>
  );
}

function ProductList({ products }: { products: SourceProduct[] }) {
  const aria = products.map((item) => `${item.product} ${item.count}`).join(", ");
  return (
    <>
      <div className={styles.bar} role="img" aria-label={aria}>
        {products.map((item) => (
          <span
            key={item.product}
            className={styles.seg}
            style={{ flexGrow: item.count, background: colorFor(item.product) }}
            title={`${item.product}: ${item.count}`}
          />
        ))}
      </div>
      <ul className={styles.list}>
        {products.map((item) => (
          <li key={item.product} className={styles.row}>
            <i className={styles.swatch} style={{ background: colorFor(item.product) }} />
            <span className={styles.name}>{item.product}</span>
            {item.provider === "Bright Data" ? <span className={styles.tag}>Bright Data</span> : null}
            <span className={styles.count}>{item.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function colorFor(product: string): string {
  return PRODUCT_COLOR[product] ?? "var(--muted)";
}

function isSummary(value: unknown): value is SourceSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as SourceSummary;
  return typeof row.slug === "string" && typeof row.total === "number" && Array.isArray(row.products);
}
