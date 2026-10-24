import Link from "next/link";
import { PrivacyToggle } from "./privacy";
import { ThemeToggle } from "./ThemeToggle";
import { ViewerPicker } from "./ViewerPicker";
import type { PersonListItem } from "./model";

export function Header({
  people,
  viewerSlug,
  onViewer,
}: {
  people: PersonListItem[] | null;
  viewerSlug: string | null;
  onViewer: (slug: string) => void;
}) {
  return (
    <header className="top">
      <Link className="brand" href="/">
        <span>luckdragon</span>
        <span className="brand-sub">Patch the Conference</span>
      </Link>
      <ViewerPicker people={people} viewerSlug={viewerSlug} onChange={onViewer} />
      <div className="end">
        <PrivacyToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
