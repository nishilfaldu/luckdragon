"use client";

import { IngestActivity } from "@/components/activity/IngestActivity";
import type { IngestRun } from "./model";
import { Avatar } from "./Avatar";
import { ChatPane } from "./ChatPane";
import { YouThemLegend } from "./YouThemLegend";
import type { ChatThread, Citation, GraphState, PersonListItem } from "./model";

export function PersonView({
  ingest,
  person,
  viewer,
  onBack,
  thread,
  graphs,
  activeCite,
  prefill,
  onCiteHover,
  onCiteClick,
  onSend,
  onRetry,
}: {
  ingest?: IngestRun;
  person: PersonListItem;
  viewer: PersonListItem | null;
  onBack: () => void;
  thread: ChatThread | null;
  graphs: Record<string, GraphState>;
  activeCite: Citation | null;
  prefill: { nonce: number; text: string } | null;
  onCiteHover: (cite: Citation | null) => void;
  onCiteClick: (cite: Citation) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
}) {
  const self = Boolean(viewer && viewer.slug === person.slug);
  return (
    <div className="w3-person">
      <div className="w3-sheet">
        <header className="w3-head">
          <button type="button" className="w3-back" onClick={onBack}>
            ← Who to meet
          </button>
          <div className="w3-id">
            <Avatar name={person.name} url={person.avatar_url} />
            <div className="w3-id-copy">
              <div className="topline">
                <h1>{self ? "You" : person.name}</h1>
                <RoleTag role={person.role} />
              </div>
              {self ? <p className="w3-self-name">{person.name}</p> : null}
              {person.headline ? <p className="w3-headline">{person.headline}</p> : null}
            </div>
          </div>
        </header>
        <YouThemLegend />
        {ingest?.running ? <IngestActivity name={person.name} run={ingest} /> : null}
        {ingest?.running ? null : <ChatPane
          person={person}
          viewer={viewer}
          thread={thread}
          graphs={graphs}
          activeCite={activeCite}
          prefill={prefill}
          onCiteHover={onCiteHover}
          onCiteClick={onCiteClick}
          onSend={onSend}
          onRetry={onRetry}
        />}
      </div>
    </div>
  );
}

function RoleTag({ role }: { role: string }) {
  const kind = role.toLowerCase();
  if (kind !== "host" && kind !== "judge") return null;
  return <span className={`tag ${kind}`}>{kind === "host" ? "Host" : "Judge"}</span>;
}
