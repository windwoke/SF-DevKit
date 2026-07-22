import { describe, expect, it } from "vitest";
import {
  appendMissingNewsSources,
  prependTodo,
  removeTodoItem,
  toggleTodoItem,
  type NewsSource,
} from "./dashboard";

const additions: NewsSource[] = [
  {
    id: "seed-salesforce-developer-blog",
    label: "Salesforce Developers Blog",
    url: "https://developer.salesforce.com/blogs/feed",
    kind: "rss",
    enabled: true,
  },
  {
    id: "seed-radar-ai",
    label: "Radar AI 资讯",
    url: "https://radarai.top/feed.xml",
    kind: "rss",
    enabled: true,
  },
];

describe("appendMissingNewsSources", () => {
  it("appends newly introduced default sources", () => {
    const current: NewsSource[] = [
      {
        id: "seed-sfse",
        label: "Salesforce Stack Exchange",
        url: "https://api.stackexchange.com/questions",
        kind: "se-api",
        enabled: true,
      },
    ];

    expect(appendMissingNewsSources(current, additions)).toEqual([
      ...current,
      ...additions,
    ]);
  });

  it("does not duplicate a source already added with a trailing slash", () => {
    const current: NewsSource[] = [
      { ...additions[0], id: "user-source", url: `${additions[0].url}/` },
    ];

    const merged = appendMissingNewsSources(current, additions);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]).toEqual(additions[1]);
  });
});

describe("dashboard todos", () => {
  it("adds a trimmed todo and ignores empty input", () => {
    const todos = prependTodo([], "  Review deployment  ");

    expect(prependTodo(todos, "   ")).toMatchObject([
      { text: "Review deployment", completed: false },
    ]);
  });

  it("toggles and removes a todo", () => {
    const [todo] = prependTodo([], "Run tests");

    const toggled = toggleTodoItem([todo], todo.id);
    expect(toggled[0].completed).toBe(true);

    expect(removeTodoItem(toggled, todo.id)).toEqual([]);
  });
});
