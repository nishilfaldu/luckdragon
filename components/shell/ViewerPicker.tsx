"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import type { PersonListItem } from "./model";

export function ViewerPicker({
  people,
  viewerSlug,
  onChange,
}: {
  people: PersonListItem[] | null;
  viewerSlug: string | null;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const viewer = people?.find((person) => person.slug === viewerSlug) ?? null;
  const needle = query.trim().toLowerCase();
  const options = (people ?? []).filter((person) => {
    if (!needle) return true;
    return person.name.toLowerCase().includes(needle) || person.headline.toLowerCase().includes(needle);
  });

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    function onPointer(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="picker" ref={wrap}>
      <button
        type="button"
        className="pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose who you are"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="who">{viewer ? `I am ${viewer.name}` : "I am…"}</span>
        <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="menu" role="listbox" aria-label="People">
          <input
            ref={field}
            className="search"
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search people"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {options.map((person) => (
            <button
              key={person.slug}
              type="button"
              role="option"
              aria-selected={person.slug === viewerSlug}
              className="menu-row"
              onClick={() => {
                onChange(person.slug);
                setOpen(false);
                setQuery("");
              }}
            >
              <Avatar name={person.name} url={person.avatar_url} />
              <span className="meta">
                <span className="name">{person.name}</span>
                {person.headline ? <span className="headline">{person.headline}</span> : null}
              </span>
            </button>
          ))}
          {options.length === 0 ? (
            <p className="menu-empty">{people ? "No one matches." : "Loading people…"}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
