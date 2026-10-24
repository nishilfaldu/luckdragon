/**
 * Dataset ids from docs.brightdata.com/scrapers.json (also listed in PLAN.md).
 * Input fields match the per-scraper input_schema.
 */

import type { ScrapeRequest } from "@/lib/ingest/brightdata/client";
import { windowDates } from "@/lib/ingest/items";

export const DATASETS = {
  linkedinProfile: "gd_l1viktl72bvl7bjuj0",
  linkedinPeopleSearch: "gd_m8d03he47z8nwb5xc",
  linkedinPosts: "gd_lyy3tktm25m4avu764",
  linkedinCompany: "gd_l1vikfnt1wgvvqz95w",
  xProfile: "gd_lwxmeb2u1cniijd7t4",
  xPosts: "gd_lwxkxvnf1cynvib9co",
  youtubeChannel: "gd_lk538t2k2p1k3oos71",
  youtubeVideos: "gd_lk56epmy2i5g7lzu0k",
  githubRepo: "gd_lyrexgxc24b3d4imjt",
  instagramProfile: "gd_l1vikfch901nx3by4",
  instagramPosts: "gd_lk5ns7kz21pck8jpis",
  threadsProfile: "gd_mde7jg3ld2h3hnnf2",
  threadsPosts: "gd_md75myxy14rihbjksa",
  blueskyPosts: "gd_m6hn4r5s27zfhc7w4",
  redditProfile: "gd_mgnh0p8w16o65lmhp",
  redditPosts: "gd_lvz8ah06191smkebj4",
  crunchbaseCompany: "gd_l1vijqt9jfj7olije",
  npm: "gd_mk57m0301khq4jmsul",
  pypi: "gd_mk57kc3t1wwgmnepp9",
} as const;

export type DatasetId = (typeof DATASETS)[keyof typeof DATASETS];

const dates = () => windowDates();

export function linkedinProfileInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.linkedinProfile, input: [{ url }] };
}

export function linkedinPeopleSearchInput(url: string, firstName: string, lastName: string): ScrapeRequest {
  return {
    datasetId: DATASETS.linkedinPeopleSearch,
    input: [{ url, first_name: firstName, last_name: lastName }],
    limit: 5,
  };
}

export function linkedinPostsInput(profileUrl: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.linkedinPosts,
    discoverBy: "profile_url",
    input: [{ url: profileUrl, start_date: start, end_date: end, only_authored_posts: true }],
    limit: 20,
  };
}

export function linkedinCompanyInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.linkedinCompany, input: [{ url }] };
}

export function xProfileInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.xProfile, input: [{ url, max_number_of_posts: 20 }] };
}

export function xPostsInput(profileUrl: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.xPosts,
    discoverBy: "profile_url",
    input: [{ url: profileUrl, num_of_posts: 20, start_date: start, end_date: end }],
    limit: 20,
  };
}

export function xDiscoverByUsername(userName: string): ScrapeRequest {
  return { datasetId: DATASETS.xProfile, discoverBy: "user_name", input: [{ user_name: userName }], limit: 3 };
}

export function youtubeChannelInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.youtubeChannel, input: [{ url }] };
}

export function youtubeVideosByUrl(url: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.youtubeVideos,
    discoverBy: "url",
    input: [{ url, num_of_posts: 20, start_date: start, end_date: end }],
    limit: 20,
  };
}

export function youtubeVideosByKeyword(keyword: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.youtubeVideos,
    discoverBy: "keyword",
    input: [{ keyword, num_of_posts: "20", start_date: start, end_date: end, include_shorts: false }],
    limit: 10,
  };
}

export function githubSearchInput(searchUrl: string): ScrapeRequest {
  return { datasetId: DATASETS.githubRepo, discoverBy: "search_url", input: [{ url: searchUrl }], limit: 20 };
}

export function instagramProfileInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.instagramProfile, input: [{ url }] };
}

export function instagramPostsInput(url: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.instagramPosts,
    discoverBy: "url",
    input: [{ url, num_of_posts: 20, start_date: start, end_date: end }],
    limit: 20,
  };
}

export function threadsProfileInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.threadsProfile, input: [{ url }] };
}

export function threadsPostsInput(profileUrl: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.threadsPosts,
    discoverBy: "profile",
    input: [{ profile_url: profileUrl, start_date: start, end_date: end }],
    limit: 20,
  };
}

export function blueskyPostsInput(profileUrl: string): ScrapeRequest {
  const { start, end } = dates();
  return {
    datasetId: DATASETS.blueskyPosts,
    discoverBy: "profile_url",
    input: [{ url: profileUrl, start_date: start, end_date: end, collect_reposts: false }],
    limit: 20,
  };
}

export function redditProfileInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.redditProfile, input: [{ url }] };
}

export function redditPostsInput(authorUrl: string): ScrapeRequest {
  return {
    datasetId: DATASETS.redditPosts,
    discoverBy: "author_url",
    input: [{ url: authorUrl, num_of_posts: 20 }],
    limit: 20,
  };
}

export function crunchbaseInput(url: string): ScrapeRequest {
  return { datasetId: DATASETS.crunchbaseCompany, input: [{ url }] };
}

export function npmInput(packageName: string): ScrapeRequest {
  return { datasetId: DATASETS.npm, input: [{ package_name: packageName }] };
}

export function pypiInput(packageName: string): ScrapeRequest {
  return { datasetId: DATASETS.pypi, input: [{ package_name: packageName }] };
}

/** One cheap input per dataset, for scripts/smoke-brightdata.ts. */
export function smokeRequests(): Array<{ name: string; request: ScrapeRequest }> {
  return [
    { name: "linkedin-profile", request: { ...linkedinProfileInput("https://www.linkedin.com/in/williamhgates"), limit: 1 } },
    {
      name: "linkedin-people-search",
      request: linkedinPeopleSearchInput(
        "https://www.linkedin.com/search/results/people/?keywords=William%20Gates",
        "William",
        "Gates",
      ),
    },
    { name: "linkedin-posts", request: { ...linkedinPostsInput("https://www.linkedin.com/in/williamhgates"), limit: 1 } },
    { name: "linkedin-company", request: linkedinCompanyInput("https://www.linkedin.com/company/microsoft") },
    { name: "x-profile", request: { ...xProfileInput("https://x.com/github"), limit: 1 } },
    { name: "x-posts", request: { ...xPostsInput("https://x.com/github"), limit: 1 } },
    { name: "youtube-channel", request: youtubeChannelInput("https://www.youtube.com/@YouTube") },
    { name: "youtube-videos", request: { ...youtubeVideosByKeyword("youtube"), limit: 1 } },
    {
      name: "github",
      request: githubSearchInput("https://github.com/search?q=user%3Agithub&type=repositories"),
    },
    { name: "instagram-profile", request: instagramProfileInput("https://www.instagram.com/instagram/") },
    { name: "instagram-posts", request: { ...instagramPostsInput("https://www.instagram.com/instagram/"), limit: 1 } },
    { name: "threads-profile", request: threadsProfileInput("https://www.threads.net/@instagram") },
    { name: "threads-posts", request: { ...threadsPostsInput("https://www.threads.net/@instagram"), limit: 1 } },
    { name: "bluesky", request: { ...blueskyPostsInput("https://bsky.app/profile/bsky.app"), limit: 1 } },
    { name: "reddit-profile", request: redditProfileInput("https://www.reddit.com/user/spez") },
    { name: "reddit-posts", request: { ...redditPostsInput("https://www.reddit.com/user/spez"), limit: 1 } },
    { name: "crunchbase", request: crunchbaseInput("https://www.crunchbase.com/organization/microsoft") },
    { name: "npm", request: npmInput("is-odd") },
    { name: "pypi", request: pypiInput("six") },
  ];
}
