"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Avatar } from "./Avatar";
import {
  isHttpUrl,
  sourceLabel,
  sourceLabels,
  type IngestRun,
  type PersonListItem,
  type SourceRow,
} from "./model";

export function PeoplePane({
  people,
  note,
  viewerSlug,
  selectedSlug,
  ingest,
  onSelect,
  onIngest,
  onAdd,
  onRetry,
}: {
  people: PersonListItem[] | null;
  note: string | null;
  viewerSlug: string | null;
  selectedSlug: string | null;
  ingest: Record<string, IngestRun>;
  onSelect: (slug: string) => void;
  onIngest: (slug: string) => void;
  onAdd: (url: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");

  const viewer = people?.find((person) => person.slug === viewerSlug) ?? null;
  const rest = (people ?? [])
    .filter((person) => person.slug !== viewerSlug && matches(person, query))
    .slice()
    .sort(comparePeople);
  const viewerMatches = viewer ? matches(viewer, query) : false;
  const nothingMatches = Boolean(people && query.trim() && !viewerMatches && rest.length === 0);

  return (
    <section className="pane pane-people" aria-label="People" data-pane="people">
      <div className="people-scroll">
        <p className="eyebrow">People</p>
        {!people ? (
          <>
            <p className="sr-only">Loading people…</p>
            <PeopleSkeleton />
          </>
        ) : null}
        {people ? (
          <input
            className="search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search people"
            autoComplete="off"
          />
        ) : null}
        {note ? (
          <p className="note">
            {note}{" "}
            <button type="button" className="text-btn" onClick={onRetry}>
              Retry
            </button>
          </p>
        ) : null}
        {people && people.length === 0 ? <p className="pane-copy">No one here yet.</p> : null}
        {viewer && viewerMatches ? (
          <div className="you-block">
            <p className="block-label">You</p>
            <PersonRow
              person={viewer}
              selected={viewer.slug === selectedSlug}
              run={ingest[viewer.slug]}
              onSelect={onSelect}
              onIngest={onIngest}
            />
          </div>
        ) : null}
        {!viewer && people && people.length > 0 ? <p className="note">Choose who you are with I am…</p> : null}
        <div className="rows">
          {rest.map((person) => (
            <PersonRow
              key={person.slug}
              person={person}
              selected={person.slug === selectedSlug}
              run={ingest[person.slug]}
              onSelect={onSelect}
              onIngest={onIngest}
            />
          ))}
        </div>
        {nothingMatches ? <p className="pane-copy">No one matches.</p> : null}
      </div>
      <div className="people-foot">
        <AddPerson onAdd={onAdd} />
      </div>
    </section>
  );
}

function PersonRow({
  person,
  selected,
  run,
  onSelect,
  onIngest,
}: {
  person: PersonListItem;
  selected: boolean;
  run: IngestRun | undefined;
  onSelect: (slug: string) => void;
  onIngest: (slug: string) => void;
}) {
  const canIngest = person.status === "none" && !run?.running;
  const sources = sourceLabels(person);
  const shownSources = sources.slice(0, 3);
  const hiddenSources = sources.length - shownSources.length;
  const ingesting = person.status === "ingesting" || Boolean(run?.running);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div ref={row} className={personClass(selected, ingesting)}>
      <div className={canIngest ? "person-main with-ingest" : "person-main"}>
        <button
          type="button"
          className="person-hit"
          aria-current={selected ? "true" : undefined}
          aria-label={personLabel(person)}
          onClick={() => onSelect(person.slug)}
        >
          <Avatar name={person.name} url={person.avatar_url} />
          <span className="meta">
            <span className="topline">
              <span className={`status-dot ${ingesting ? "ingesting" : person.status}`} title={statusTitle(person.status)} aria-hidden="true" />
              <span className="name">{person.name}</span>
              <RoleTag role={person.role} />
              {ingesting ? <span className="live">Ingesting</span> : null}
              {person.status === "ready" || person.nodeCount > 0 ? (
                <span className="count">{person.nodeCount} nodes</span>
              ) : null}
            </span>
            {person.headline ? <span className="headline">{person.headline}</span> : null}
            {shownSources.length > 0 ? (
              <span className="sources">
                {shownSources.map((source) => (
                  <span className="chip" key={source}>
                    {source}
                  </span>
                ))}
                {hiddenSources > 0 ? <span className="chip">+{hiddenSources}</span> : null}
              </span>
            ) : null}
          </span>
        </button>
        {canIngest ? (
          <button type="button" className="pill sm ingest-btn" onClick={() => onIngest(person.slug)}>
            Ingest
          </button>
        ) : null}
      </div>
      {run ? <IngestProgress run={run} /> : null}
    </div>
  );
}

function IngestProgress({ run }: { run: IngestRun }) {
  return (
    <div className="ingest" aria-live="polite">
      {run.sources.map((source) => (
        <div className={`ingest-row ${source.status}`} key={source.source}>
          <span className={`status-dot ${source.status}`} />
          <span>{sourceLabel(source.source)}</span>
          <span className="state" title={source.message}>
            {sourceState(source)}
          </span>
        </div>
      ))}
      {run.sources.length === 0 && run.running ? <p className="pane-copy">Starting…</p> : null}
      {run.error ? <p className="error-line">{run.error}</p> : null}
    </div>
  );
}

function AddPerson({ onAdd }: { onAdd: (url: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = url.trim();
    if (!isHttpUrl(value)) {
      setError("Paste a full Luma URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(value);
      setUrl("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="pill line wide" onClick={() => setOpen(true)}>
        + Add person
      </button>
    );
  }

  return (
    <form className="add-form" onSubmit={(event) => void submit(event)}>
      <input
        className="search"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://luma.com/user/…"
        aria-label="Luma profile URL"
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setError(null);
          }
        }}
      />
      <div className="add-actions">
        <button type="submit" className="pill sm" disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          className="pill sm line"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
      {error ? <p className="error-line">{error}</p> : null}
    </form>
  );
}

function RoleTag({ role }: { role: string }) {
  const kind = role.toLowerCase();
  if (kind !== "host" && kind !== "judge") return null;
  return <span className={`tag ${kind}`}>{kind === "host" ? "Host" : "Judge"}</span>;
}

function sourceState(row: SourceRow): string {
  if (row.status === "pending") return "Pending";
  if (row.status === "fetching") return "Fetching";
  if (row.status === "extracting") return "Extracting";
  if (row.status === "writing") return "Writing";
  if (row.status === "skipped") return "Skipped";
  if (row.status === "error") return row.message || "Error";
  if (typeof row.count === "number") return row.count === 1 ? "1 item" : `${row.count} items`;
  return "Done";
}

function PeopleSkeleton() {
  return (
    <div className="skel-list" aria-hidden="true">
      {["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
        <div className="skel-row" key={key}>
          <span className="skel skel-avatar" />
          <span className="skel-copy">
            <span className="skel skel-line" />
            <span className="skel skel-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

function personClass(selected: boolean, ingesting: boolean): string {
  const names = ["person"];
  if (selected) names.push("selected");
  if (ingesting) names.push("ingesting");
  return names.join(" ");
}

function personLabel(person: PersonListItem): string {
  const bits = [person.name, statusTitle(person.status)];
  if (person.nodeCount > 0) bits.push(`${person.nodeCount} nodes`);
  return bits.join(", ");
}

function comparePeople(a: PersonListItem, b: PersonListItem): number {
  return statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name);
}

function statusRank(status: PersonListItem["status"]): number {
  if (status === "ready") return 0;
  if (status === "ingesting") return 1;
  return 2;
}

function statusTitle(status: PersonListItem["status"]): string {
  if (status === "ready") return "Ready";
  if (status === "ingesting") return "Ingesting";
  return "Not ingested";
}

function matches(person: PersonListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) ||
    person.headline.toLowerCase().includes(needle) ||
    person.slug.includes(needle)
  );
}
