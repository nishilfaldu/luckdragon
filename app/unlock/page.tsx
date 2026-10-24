import { Suspense, type CSSProperties } from "react";

export default function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  return (
    <main style={pageStyle}>
      <Suspense fallback={<UnlockForm invalid={false} />}>
        <UnlockBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function UnlockBody({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const query = await searchParams;
  const error = query.error;
  const invalid = error === "1" || (Array.isArray(error) && error.includes("1"));
  return <UnlockForm invalid={invalid} />;
}

function UnlockForm({ invalid }: { invalid: boolean }) {
  return (
    <form action="/unlock/submit" method="post" style={cardStyle}>
      <div>
        <h1 style={titleStyle}>luckdragon</h1>
        <p className="pane-copy">Enter the passcode to open the room.</p>
      </div>
      <label className="eyebrow" htmlFor="passcode">
        Passcode
      </label>
      <input
        id="passcode"
        className="search"
        type="password"
        name="passcode"
        autoFocus
        autoComplete="current-password"
        autoCapitalize="off"
        spellCheck={false}
        required
      />
      {invalid ? (
        <p className="error-line" role="alert">
          Wrong passcode.
        </p>
      ) : null}
      <button className="pill wide" type="submit">
        Unlock
      </button>
    </form>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
};

const cardStyle: CSSProperties = {
  width: "min(360px, 100%)",
  display: "grid",
  gap: 12,
  padding: 24,
  border: "1px solid var(--line)",
  borderRadius: 16,
  background: "var(--surface)",
};

const titleStyle: CSSProperties = {
  margin: "0 0 6px",
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "-0.03em",
};
