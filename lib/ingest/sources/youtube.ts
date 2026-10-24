import { scrape } from "@/lib/ingest/brightdata/client";
import { youtubeChannelInput, youtubeVideosByKeyword, youtubeVideosByUrl } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const youtube = remoteSource({
  id: "youtube",
  platform: "youtube",
  allowWithoutUrl: true,
  fallbackFocus: 'talks, podcasts, and YouTube videos by this person. Search for "<name> talk".',
  async bright(person, account) {
    const videos = account
      ? await scrape(youtubeVideosByUrl(account.url))
      : await scrape(youtubeVideosByKeyword(`${person.name} talk`));
    const channel = account ? await scrape(youtubeChannelInput(account.url)).catch(() => []) : [];
    return [
      ...recordsToItems("youtube", "profile", channel, { cap: 1 }),
      ...recordsToItems("youtube", "video", videos),
    ];
  },
});
