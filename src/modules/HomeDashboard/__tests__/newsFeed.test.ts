import { describe, it, expect } from "vitest";
import {
  mergeNewsItemsBySource,
  parseSeQuestions,
  parseRss,
  parseFeed,
  type NewsItem,
} from "../newsFeed";

describe("parseSeQuestions", () => {
  it("parses a valid StackExchange questions payload", () => {
    const body = JSON.stringify({
      items: [
        {
          title: "How to bulkify a trigger?",
          link: "https://salesforce.stackexchange.com/q/1",
          creation_date: 1784628411,
          answer_count: 2,
          score: 5,
          tags: ["apex", "trigger"],
        },
        {
          title: "Files Connect &amp; SharePoint",
          link: "https://salesforce.stackexchange.com/q/2",
          creation_date: 1784628400,
          answer_count: 0,
          score: 0,
          tags: ["files-connect"],
        },
      ],
    });
    const items = parseSeQuestions(body);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("How to bulkify a trigger?");
    expect(items[0].answerCount).toBe(2);
    expect(items[0].score).toBe(5);
    expect(items[0].published).toBe(1784628411);
    // HTML entities should be decoded.
    expect(items[1].title).toBe("Files Connect & SharePoint");
    expect(items[1].answerCount).toBe(0);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseSeQuestions("not json")).toEqual([]);
    expect(parseSeQuestions("")).toEqual([]);
  });

  it("returns empty array when items field is missing", () => {
    expect(parseSeQuestions(JSON.stringify({}))).toEqual([]);
    expect(parseSeQuestions(JSON.stringify({ items: "not-an-array" }))).toEqual(
      [],
    );
  });

  it("tolerates missing fields on individual questions", () => {
    const body = JSON.stringify({
      items: [{ title: "Partial" }, { link: "https://example.com/q" }, {}],
    });
    const items = parseSeQuestions(body);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe("Partial");
    expect(items[0].published).toBeNull();
    expect(items[1].answerCount).toBe(0);
  });
});

describe("parseRss", () => {
  it("parses RSS 2.0 items", () => {
    const xml = `
      <rss><channel>
        <title>Blog</title>
        <item>
          <title>Post A</title>
          <link>https://example.com/a</link>
          <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        </item>
        <item>
          <title><![CDATA[Post B]]></title>
          <link>https://example.com/b</link>
        </item>
      </channel></rss>
    `;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Post A");
    expect(items[0].link).toBe("https://example.com/a");
    expect(items[0].published).toBeGreaterThan(0);
    expect(items[0].answerCount).toBe(0);
    expect(items[1].title).toBe("Post B");
    expect(items[1].published).toBeNull();
  });

  it("parses Atom entries", () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom A</title>
          <link href="https://example.com/atom-a" />
          <updated>2024-02-01T00:00:00Z</updated>
        </entry>
      </feed>
    `;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom A");
    expect(items[0].link).toBe("https://example.com/atom-a");
    expect(items[0].published).toBeGreaterThan(0);
  });

  it("decodes entities", () => {
    const xml = `
      <rss><channel>
        <item><title>A &amp; B &lt;tag&gt;</title><link>x</link></item>
      </channel></rss>
    `;
    expect(parseRss(xml)[0].title).toBe("A & B <tag>");
  });

  it("decodes entities in link URLs", () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Article</title>
          <link>https://example.com/article/9be3?utm_source=rss&amp;utm_medium=feed&amp;utm_campaign=resources&amp;entry=rss_article_item</link>
        </item>
      </channel></rss>
    `;
    const link = parseRss(xml)[0].link;
    expect(link).toBe("https://example.com/article/9be3?utm_source=rss&utm_medium=feed&utm_campaign=resources&entry=rss_article_item");
    expect(link).not.toContain("&amp;");
  });

  it("decodes entities in Atom href URLs", () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom</title>
          <link href="https://example.com/a?x=1&amp;y=2" />
        </entry>
      </feed>
    `;
    expect(parseRss(xml)[0].link).toBe("https://example.com/a?x=1&y=2");
  });

  it("returns empty for malformed input", () => {
    expect(parseRss("not xml")).toEqual([]);
    expect(parseRss("")).toEqual([]);
  });
});

describe("parseFeed dispatcher", () => {
  it("routes se-api to JSON parser", () => {
    const body = JSON.stringify({
      items: [{ title: "Q", link: "u", score: 1 }],
    });
    expect(parseFeed(body, "se-api")).toHaveLength(1);
  });

  it("routes rss to XML parser", () => {
    const xml =
      "<rss><channel><item><title>x</title><link>u</link></item></channel></rss>";
    expect(parseFeed(xml, "rss")).toHaveLength(1);
  });

  it("returns empty for unknown kind", () => {
    expect(parseFeed("anything", "unknown" as never)).toEqual([]);
  });
});

describe("mergeNewsItemsBySource", () => {
  const item = (
    sourceId: string,
    title: string,
    published: number,
  ): NewsItem => ({
    sourceId,
    title,
    published,
    link: `${sourceId}/${title}`,
    answerCount: 0,
    score: 0,
  });

  it("keeps every non-empty source represented before taking another round", () => {
    const merged = mergeNewsItemsBySource(
      [
        [item("fast", "a", 100), item("fast", "b", 99), item("fast", "c", 98)],
        [item("slow", "x", 50), item("slow", "y", 40)],
      ],
      4,
    );

    expect(merged.map((entry) => entry.sourceId)).toEqual([
      "fast",
      "slow",
      "fast",
      "slow",
    ]);
  });

  it("fills remaining slots from sources that still have items", () => {
    const merged = mergeNewsItemsBySource(
      [[item("one", "a", 10)], [item("two", "b", 9), item("two", "c", 8)]],
      3,
    );
    expect(merged).toHaveLength(3);
  });

  it("deduplicates the same link across sources", () => {
    const duplicate = item("two", "same", 9);
    duplicate.link = "shared";
    const first = item("one", "same", 10);
    first.link = "shared";
    expect(mergeNewsItemsBySource([[first], [duplicate]], 8)).toHaveLength(1);
  });
});
