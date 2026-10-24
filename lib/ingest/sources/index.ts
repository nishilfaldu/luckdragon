import { bluesky } from "@/lib/ingest/sources/bluesky";
import { crunchbase } from "@/lib/ingest/sources/crunchbase";
import { github } from "@/lib/ingest/sources/github";
import { instagram } from "@/lib/ingest/sources/instagram";
import { linkedin } from "@/lib/ingest/sources/linkedin";
import { luma } from "@/lib/ingest/sources/luma";
import { packages } from "@/lib/ingest/sources/packages";
import { reddit } from "@/lib/ingest/sources/reddit";
import { serp } from "@/lib/ingest/sources/serp";
import { threads } from "@/lib/ingest/sources/threads";
import type { SourceAdapter } from "@/lib/ingest/sources/types";
import { website } from "@/lib/ingest/sources/website";
import { x } from "@/lib/ingest/sources/x";
import { youtube } from "@/lib/ingest/sources/youtube";

export const SOURCE_ADAPTERS: SourceAdapter[] = [
  luma,
  website,
  github,
  linkedin,
  x,
  youtube,
  instagram,
  threads,
  bluesky,
  reddit,
  crunchbase,
  packages,
  serp,
];
