/**
 * News source parsers. Two kinds supported:
 *  - `se-api`: StackExchange `/questions` JSON. Reliable, CORS-friendly.
 *  - `rss`:    RSS 2.0 / Atom XML. Works for feeds that don't 403 user-agents
 *              (Heroku blog, The Verge, GitHub Atom all OK; Salesforce.com
 *              corporate feeds return 403 — fall back to SE if you need
 *              Salesforce-flavored content).
 */

export type FeedKind = "se-api" | "rss";

export interface NewsItem {
  title: string;
  link: string;
  /** Unix seconds, null if unknown. */
  published: number | null;
  /** SE only — answer count. RSS items report 0. */
  answerCount: number;
  /** SE only — upvote score. RSS items report 0. */
  score: number;
  /** Which source this came from (set by the caller). */
  sourceLabel?: string;
  sourceId?: string;
}

interface SeQuestion {
  title: string;
  link: string;
  creation_date: number;
  answer_count: number;
  score: number;
  tags: string[];
}

interface SeResponse {
  items: SeQuestion[];
}

export function parseFeed(body: string, kind: FeedKind): NewsItem[] {
  if (kind === "se-api") return parseSeQuestions(body);
  if (kind === "rss") return parseRss(body);
  return [];
}

/**
 * Merge feeds by taking one item from each source per round. Sources with the
 * freshest first item go first, so no active source can fill the entire card.
 */
export function mergeNewsItemsBySource(
  sources: NewsItem[][],
  limit: number,
): NewsItem[] {
  if (limit <= 0) return [];

  const queues = sources
    .filter((items) => items.length > 0)
    .map((items) => [...items].sort(byPublishedDesc))
    .sort((a, b) => byPublishedDesc(a[0], b[0]));
  const merged: NewsItem[] = [];
  const seen = new Set<string>();

  for (let index = 0; merged.length < limit; index += 1) {
    let addedThisRound = false;
    for (const queue of queues) {
      const item = queue[index];
      if (!item) continue;
      const key = item.link || `${item.sourceId ?? ""}:${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      addedThisRound = true;
      if (merged.length === limit) break;
    }
    if (!addedThisRound && queues.every((queue) => index >= queue.length - 1))
      break;
  }

  return merged;
}

function byPublishedDesc(a: NewsItem, b: NewsItem): number {
  return (b.published ?? 0) - (a.published ?? 0);
}

/** Parse StackExchange `/questions` JSON. */
export function parseSeQuestions(json: string): NewsItem[] {
  let parsed: SeResponse;
  try {
    parsed = JSON.parse(json) as SeResponse;
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((q) => ({
    title: decodeEntities(q.title ?? ""),
    link: q.link ?? "",
    published: typeof q.creation_date === "number" ? q.creation_date : null,
    answerCount: q.answer_count ?? 0,
    score: q.score ?? 0,
  }));
}

/** Parse RSS 2.0 / Atom XML. */
export function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item[\s>]/g;
  const entryRe = /<entry[\s>]/g;
  const isAtom =
    (xml.match(entryRe)?.length ?? 0) > (xml.match(itemRe)?.length ?? 0);
  const blockRe = isAtom
    ? /<entry[\s\S]*?<\/entry>/g
    : /<item[\s\S]*?<\/item>/g;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[0];
    const title = pickText(block, "title") ?? "";
    let link = "";
    if (isAtom) {
      const lm = block.match(/<link[^>]*href="([^"]+)"/);
      link = lm ? lm[1] : "";
    } else {
      link = pickText(block, "link") ?? "";
    }
    const pubStr =
      pickText(block, "pubDate") ??
      pickText(block, "published") ??
      pickText(block, "updated") ??
      null;
    const published = pubStr ? parseRssDate(pubStr) : null;
    if (title || link) {
      items.push({
        title: decodeEntities(stripCdata(title)),
        link: link.trim(),
        published,
        answerCount: 0,
        score: 0,
      });
    }
  }
  return items;
}

function pickText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseRssDate(input: string): number | null {
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function decodeEntities(s: string): string {
  if (typeof document !== "undefined") {
    const el = document.createElement("textarea");
    el.innerHTML = s;
    return el.value;
  }
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
