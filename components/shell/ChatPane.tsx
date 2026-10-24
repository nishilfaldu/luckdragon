"use client";

import { SourcesPanel } from "@/components/sources/SourcesPanel";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Markdown } from "./markdown";
import { displayLabel, findNode, type ChatThread, type Citation, type GraphState, type PersonListItem, type ToolCall, type UiMessage } from "./model";

const EMPTY_MESSAGES: UiMessage[] = [];

export function ChatPane({
  person,
  viewer,
  thread,
  graphs,
  activeCite,
  prefill,
  onCiteHover,
  onCiteClick,
  onSend,
  onRetry,
  dropProtected,
  onToggleProtected,
}: {
  person: PersonListItem | null;
  viewer: PersonListItem | null;
  thread: ChatThread | null;
  graphs: Record<string, GraphState>;
  activeCite: Citation | null;
  prefill: { nonce: number; text: string } | null;
  onCiteHover: (cite: Citation | null) => void;
  onCiteClick: (cite: Citation) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  dropProtected: boolean;
  onToggleProtected: (next: boolean) => void;
}) {
  const personSlug = person?.slug ?? "";
  const prefillNonce = prefill?.nonce ?? 0;
  const [draftScope, setDraftScope] = useState({ slug: personSlug, nonce: prefillNonce });
  const [draft, setDraft] = useState("");
  if (draftScope.slug !== personSlug || draftScope.nonce !== prefillNonce) {
    const keepPrefill = draftScope.slug === personSlug && prefill != null;
    setDraftScope({ slug: personSlug, nonce: prefillNonce });
    setDraft(keepPrefill ? prefill.text : "");
  }
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streaming = thread?.streaming ?? false;
  const messages = thread?.messages ?? EMPTY_MESSAGES;

  useEffect(() => {
    if (!prefill) return;
    const field = inputRef.current;
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }, [prefill]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [draft]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const brief = !messages.some((message) => message.role === "user");
    const pinTop = brief && !streaming;
    el.dataset.pin = pinTop ? "top" : "follow";
    el.scrollTop = pinTop ? 0 : el.scrollHeight;
  }, [messages, streaming]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || streaming || !person || !viewer) return;
    setDraft("");
    onSend(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  if (!person) {
    return (
      <section className="pane pane-chat" aria-label="Chat" data-pane="chat">
        <div className="center-note">
          <div>
            <p className="eyebrow">Chat</p>
            <p className="pane-copy">Ask about the person you picked.</p>
          </div>
        </div>
      </section>
    );
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const failedBrief = Boolean(thread?.error && !streaming && !messages.some((message) => message.role === "user"));
  const personReady = graphs[person.slug]?.status === "ready";
  const viewerReady = viewer ? graphs[viewer.slug]?.status === "ready" : false;

  return (
    <section className="pane pane-chat" aria-label="Chat" data-pane="chat">
      <div className="chat-scroll" ref={scroller}>
        <p className="eyebrow">{person.name}</p>
        <label
          className="protected-toggle"
          title="Health, religion, politics, ethnicity or nationality, sexual orientation, family, and age"
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 2px", fontSize: 14, color: "var(--muted)", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            role="switch"
            checked={dropProtected}
            onChange={(event) => onToggleProtected(event.target.checked)}
            style={{ accentColor: "var(--green)", width: 15, height: 15, margin: 0 }}
          />
          {dropProtected ? "Protected traits dropped" : "Protected traits allowed"}
        </label>
        <details className="how sources-how" style={{ margin: "4px 0 14px" }}>
          <summary>Where this graph came from</summary>
          <SourcesPanel slug={person.slug} />
        </details>
        {!viewer ? <p className="pane-copy">Choose who you are to get a brief.</p> : null}
        {viewer && !thread && (!personReady || !viewerReady) ? (
          <p className="pane-copy">
            {graphs[person.slug]?.status === "error" ? "This graph isn't ready yet." : "Waiting for the graph…"}
          </p>
        ) : null}
        {viewer && !thread && personReady && viewerReady ? <BriefSkeleton label="Writing the brief…" /> : null}
        <div className="thread">
          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div className="bubble" key={message.id}>
                  {message.content}
                </div>
              );
            }
            const waiting = streaming && message.id === lastAssistant?.id && !message.content;
            const brief = !messages.some((item) => item.role === "user");
            return (
              <div className="msg" key={message.id}>
                {message.content ? (
                  <Markdown
                    text={message.content}
                    cite={(slug, nodeId, key) => {
                      const node = findNode(graphs[slug], nodeId);
                      if (!node) return <span key={key}>{nodeId}</span>;
                      const label = displayLabel(node.label);
                      const tone = slug === viewer?.slug ? "you" : slug === person.slug ? "them" : "other";
                      const on = activeCite?.slug === slug && activeCite.nodeId === nodeId;
                      const who = slug === viewer?.slug ? "Your graph" : slug === person.slug ? `${person.name}'s graph` : slug;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={on ? `cite ${tone} on` : `cite ${tone}`}
                          title={`${label} · ${who}`}
                          data-cite={`${slug}:${nodeId}`}
                          onMouseEnter={() => onCiteHover({ slug, nodeId })}
                          onMouseLeave={() => onCiteHover(null)}
                          onFocus={() => onCiteHover({ slug, nodeId })}
                          onBlur={() => onCiteHover(null)}
                          onClick={() => onCiteClick({ slug, nodeId })}
                        >
                          <span>{label}</span>
                        </button>
                      );
                    }}
                  />
                ) : null}
                {waiting ? <BriefSkeleton label={brief ? "Writing the brief…" : "Writing…"} /> : null}
                {message.tools.length > 0 ? (
                  <details className="how">
                    <summary>How I know this</summary>
                    {message.tools.map((tool) => (
                      <ToolNote key={tool.id} tool={tool} />
                    ))}
                  </details>
                ) : null}
                {message.id === lastAssistant?.id && message.suggestions.length > 0 && !streaming ? (
                  <div className="suggestions">
                    {message.suggestions.map((item) => (
                      <button key={item} type="button" className="pill line sm" onClick={() => onSend(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {failedBrief ? (
          <button type="button" className="text-btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
      <form className="chat-foot" onSubmit={submit}>
        <div className="composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={viewer ? "Ask about them" : "Choose who you are first"}
            aria-label="Message"
            disabled={!viewer || streaming}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="send" type="submit" aria-label="Send" disabled={!viewer || streaming || !draft.trim()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

function BriefSkeleton({ label }: { label: string }) {
  return (
    <div className="brief-skel">
      <p className="sr-only">{label}</p>
      <span className="skel skel-line" />
      <span className="skel skel-line" />
      <span className="skel skel-line short" />
    </div>
  );
}

function ToolNote({ tool }: { tool: ToolCall }) {
  const cypher = tool.cypher ?? queryOf(tool.input);
  const bits = [
    tool.name,
    tool.rowCount != null ? `${tool.rowCount} rows` : null,
    tool.ms != null ? `${tool.ms} ms` : null,
  ].filter((bit): bit is string => Boolean(bit));
  return (
    <div className="tool">
      <div className="meta">
        {bits.map((bit) => (
          <span className="chip" key={bit}>
            {bit}
          </span>
        ))}
      </div>
      {cypher ? <pre>{cypher}</pre> : null}
    </div>
  );
}

function queryOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || !("query" in input)) return undefined;
  const query = (input as { query?: unknown }).query;
  return typeof query === "string" ? query : undefined;
}
