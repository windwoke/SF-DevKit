import { describe, expect, it } from "vitest";
import {
  appendMissingNewsSources,
  migrateWidgets,
  prependTodo,
  removeTodoItem,
  toggleTodoItem,
  useDashboardStore,
  type NewsSource,
  type WidgetInstance,
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

describe("environment widget migration", () => {
  const existing: WidgetInstance[] = [
    { id: "greeting", kind: "greeting", layout: { x: 0, y: 0, w: 12, h: 2 } },
    { id: "custom-org", kind: "orgStatus", layout: { x: 0, y: 2, w: 4, h: 4 } },
  ];

  it("adds the environment card without moving existing widgets or overlapping them", () => {
    const migrated = migrateWidgets(existing, 6);
    expect(migrated.slice(0, existing.length)).toEqual(existing);
    const added = migrated.find((widget) => widget.kind === "environment")!;
    expect(added).toBeDefined();
    for (const widget of existing) {
      const a = added.layout;
      const b = widget.layout;
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(migrateWidgets(migrated, 6)).toEqual(migrated);
  });

  it("respects removal after the upgrade", () => {
    expect(migrateWidgets(existing, 7)).toEqual(existing);
  });

  it("uses the original activity position and puts activity below every other card by default", () => {
    const widgets = useDashboardStore.getInitialState().widgets;
    expect(migrateWidgets(undefined, 7)).toEqual(widgets);
    expect(widgets.find((widget) => widget.kind === "environment")?.layout).toEqual({ x: 4, y: 5, w: 4, h: 5 });
    const activity = widgets.find((widget) => widget.kind === "recentActivity")!;
    expect(activity.layout.y).toBeGreaterThanOrEqual(Math.max(
      ...widgets.filter((widget) => widget.id !== activity.id).map((widget) => widget.layout.y + widget.layout.h),
    ));
  });

  it.each([6, 7])("migrates version %i while preserving unrelated card positions", (version) => {
    const activity: WidgetInstance = { id: "activity", kind: "recentActivity", layout: { x: 4, y: 2, w: 4, h: 5 } };
    const previous: WidgetInstance[] = [
      ...existing,
      activity,
      ...(version === 7 ? [{ id: "env", kind: "environment" as const, layout: { x: 0, y: 8, w: 8, h: 5 } }] : []),
    ];
    const migrated = migrateWidgets(previous, version);
    expect(migrated.find((widget) => widget.kind === "environment")?.layout).toEqual(activity.layout);
    const moved = migrated.find((widget) => widget.id === activity.id)!;
    expect(moved.layout.y).toBeGreaterThanOrEqual(Math.max(
      ...migrated.filter((widget) => widget.kind !== "recentActivity").map((widget) => widget.layout.y + widget.layout.h),
    ));
    expect(migrated.filter((widget) => existing.some((old) => old.id === widget.id))).toEqual(existing);
    expect(migrated.filter((widget) => widget.kind === "environment")).toHaveLength(1);
    expect(migrateWidgets(migrated, 8)).toEqual(migrated);
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
