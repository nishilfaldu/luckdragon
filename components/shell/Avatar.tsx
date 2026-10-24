"use client";

import { useState } from "react";
import { initials } from "./model";

export function Avatar({ name, url }: { name: string; url?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ok = Boolean(url) && failedUrl !== url;

  return (
    <span className="avatar">
      {url && ok ? (
        // External attendee photos. next/image would need every host allowlisted.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
