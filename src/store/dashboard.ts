import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModuleId } from "./ui";

export type QuickActionKind = "module" | "url" | "app";

export interface QuickAction {
  /** Stable client-side id for keying / drag-drop. */
  uid: string;
  kind: QuickActionKind;
  /** User-facing label (literal). Mutually exclusive with `labelKey`. */
  label: string;
  /** i18n key used to localize the label (e.g. seed actions). Wins over `label`. */
  labelKey?: string;
  /** Icon emoji or single character — rendered as-is. */
  icon: string;
  /** For kind === "module": target ModuleId. */
  moduleId?: ModuleId;
  /** For kind === "url": URL to open in the system browser. */
  /** For kind === "app": executable path or .app bundle. */
  target?: string;
  /** For kind === "app": optional CLI args string. */
  args?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

/** Logical widget kinds — each maps to a renderer. */
export type WidgetKind =
  | "greeting"
  | "orgStatus"
  | "recentSoql"
  | "recentActivity"
  | "news"
  | "todo"
  | "quickActions";

/** A placed widget instance on the 12×12 grid. */
export interface WidgetInstance {
  /** Unique instance id (multiple instances of the same kind are allowed). */
  id: string;
  kind: WidgetKind;
  /** Grid coords: 12-col wide, layout flows top-to-bottom. */
  layout: { x: number; y: number; w: number; h: number };
}

export type NewsSourceKind = "se-api" | "rss";

export interface NewsSource {
  id: string;
  label: string;
  url: string;
  kind: NewsSourceKind;
  enabled: boolean;
}

interface DashboardState {
  quickActions: QuickAction[];
  widgets: WidgetInstance[];
  newsSources: NewsSource[];
  todos: TodoItem[];
  /** When true, grid is editable (drag/resize/delete/add enabled). */
  editing: boolean;

  addQuickAction: (action: Omit<QuickAction, "uid">) => void;
  updateQuickAction: (
    uid: string,
    patch: Partial<Omit<QuickAction, "uid">>,
  ) => void;
  removeQuickAction: (uid: string) => void;
  reorderQuickActions: (from: number, to: number) => void;

  addWidget: (kind: WidgetKind, layout?: WidgetInstance["layout"]) => string;
  removeWidget: (id: string) => void;
  updateWidgetLayouts: (
    updates: Array<{ id: string; layout: WidgetInstance["layout"] }>,
  ) => void;
  resetLayout: () => void;
  setEditing: (editing: boolean) => void;

  addNewsSource: (source: Omit<NewsSource, "id">) => void;
  updateNewsSource: (
    id: string,
    patch: Partial<Omit<NewsSource, "id">>,
  ) => void;
  removeNewsSource: (id: string) => void;

  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
}

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    uid: "seed-soql",
    kind: "module",
    moduleId: "soql",
    labelKey: "dashboard.quickActions.seeds.soql",
    label: "",
    icon: "🔍",
  },
  {
    uid: "seed-metadata",
    kind: "module",
    moduleId: "metadata",
    labelKey: "dashboard.quickActions.seeds.metadata",
    label: "",
    icon: "🗂",
  },
  {
    uid: "seed-logs",
    kind: "module",
    moduleId: "logs",
    labelKey: "dashboard.quickActions.seeds.logs",
    label: "",
    icon: "📜",
  },
  {
    uid: "seed-help",
    kind: "url",
    target: "https://help.salesforce.com/",
    labelKey: "dashboard.quickActions.seeds.help",
    label: "",
    icon: "❓",
  },
  {
    uid: "seed-docs",
    kind: "url",
    target: "https://developer.salesforce.com/docs/",
    labelKey: "dashboard.quickActions.seeds.docs",
    label: "",
    icon: "📚",
  },
];

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-greeting", kind: "greeting", layout: { x: 0, y: 0, w: 8, h: 2 } },
  { id: "w-news", kind: "news", layout: { x: 8, y: 0, w: 4, h: 7 } },
  { id: "w-orgstatus", kind: "orgStatus", layout: { x: 0, y: 2, w: 4, h: 3 } },
  {
    id: "w-quickactions",
    kind: "quickActions",
    layout: { x: 4, y: 2, w: 4, h: 3 },
  },
  { id: "w-todo", kind: "todo", layout: { x: 0, y: 5, w: 4, h: 5 } },
  {
    id: "w-recentactivity",
    kind: "recentActivity",
    layout: { x: 4, y: 5, w: 4, h: 5 },
  },
  { id: "w-recentsql", kind: "recentSoql", layout: { x: 8, y: 7, w: 4, h: 3 } },
];

const ADDED_NEWS_SOURCES_V5: NewsSource[] = [
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

const DEFAULT_NEWS_SOURCES: NewsSource[] = [
  {
    id: "seed-sfse",
    label: "Salesforce Stack Exchange",
    url: "https://api.stackexchange.com/2.3/questions?site=salesforce&order=desc&sort=activity&pagesize=5&filter=withbody",
    kind: "se-api",
    enabled: true,
  },
  ...ADDED_NEWS_SOURCES_V5,
];

export function appendMissingNewsSources(
  current: NewsSource[],
  additions: NewsSource[],
): NewsSource[] {
  const normalizeUrl = (url: string) =>
    url.trim().replace(/\/+$/, "").toLowerCase();
  const knownUrls = new Set(current.map((source) => normalizeUrl(source.url)));
  const missing = additions.filter(
    (source) => !knownUrls.has(normalizeUrl(source.url)),
  );
  return missing.length > 0 ? [...current, ...missing] : current;
}

function nextUid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function prependTodo(todos: TodoItem[], text: string): TodoItem[] {
  const normalized = text.trim();
  if (!normalized) return todos;
  return [
    { id: nextUid("todo"), text: normalized, completed: false },
    ...todos,
  ];
}

export function toggleTodoItem(todos: TodoItem[], id: string): TodoItem[] {
  return todos.map((todo) =>
    todo.id === id ? { ...todo, completed: !todo.completed } : todo,
  );
}

export function removeTodoItem(todos: TodoItem[], id: string): TodoItem[] {
  return todos.filter((todo) => todo.id !== id);
}

/** Find an empty slot in the 12×12 grid for a new widget of given size. */
function findFreeSlot(
  widgets: WidgetInstance[],
  w: number,
  h: number,
): WidgetInstance["layout"] {
  const cols = 12;
  // Brute-force scan top-to-bottom, left-to-right.
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const collides = widgets.some((wid) => {
        const l = wid.layout;
        return !(
          x + w <= l.x ||
          x >= l.x + l.w ||
          y + h <= l.y ||
          y >= l.y + l.h
        );
      });
      if (!collides) return { x, y, w, h };
    }
  }
  // Fallback — append at bottom of grid.
  const maxY = widgets.reduce(
    (m, wid) => Math.max(m, wid.layout.y + wid.layout.h),
    0,
  );
  return { x: 0, y: maxY, w, h };
}

function migrateWidgets(
  widgets: WidgetInstance[] | undefined,
  persistedVersion: number,
): WidgetInstance[] {
  let migrated = Array.isArray(widgets)
    ? widgets.some((widget) => widget.kind === "greeting")
      ? widgets
      : [
          {
            id: "w-greeting",
            kind: "greeting" as const,
            layout: { x: 0, y: 0, w: 12, h: 2 },
          },
          ...widgets.map((widget) => ({
            ...widget,
            layout: { ...widget.layout, y: widget.layout.y + 2 },
          })),
        ]
    : DEFAULT_WIDGETS;

  if (
    persistedVersion < 6 &&
    !migrated.some((widget) => widget.kind === "todo")
  ) {
    migrated = [
      ...migrated,
      {
        id: "w-todo",
        kind: "todo",
        layout: findFreeSlot(migrated, 4, 4),
      },
    ];
  }
  return migrated;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      quickActions: DEFAULT_QUICK_ACTIONS,
      widgets: DEFAULT_WIDGETS,
      newsSources: DEFAULT_NEWS_SOURCES,
      todos: [],
      editing: false,

      addQuickAction: (action) =>
        set((state) => ({
          quickActions: [
            ...state.quickActions,
            { ...action, labelKey: undefined, uid: nextUid("qa") },
          ],
        })),
      updateQuickAction: (uid, patch) =>
        set((state) => ({
          quickActions: state.quickActions.map((qa) =>
            qa.uid === uid ? { ...qa, ...patch } : qa,
          ),
        })),
      removeQuickAction: (uid) =>
        set((state) => ({
          quickActions: state.quickActions.filter((qa) => qa.uid !== uid),
        })),
      reorderQuickActions: (from, to) =>
        set((state) => {
          if (from === to) return state;
          const next = [...state.quickActions];
          const [moved] = next.splice(from, 1);
          if (!moved) return state;
          next.splice(to, 0, moved);
          return { quickActions: next };
        }),

      addWidget: (kind, layout) => {
        const fallback: Record<WidgetKind, WidgetInstance["layout"]> = {
          greeting: { w: 8, h: 2, x: 0, y: 0 },
          orgStatus: { w: 4, h: 3, x: 0, y: 0 },
          quickActions: { w: 4, h: 3, x: 0, y: 0 },
          recentSoql: { w: 4, h: 3, x: 0, y: 0 },
          recentActivity: { w: 4, h: 5, x: 0, y: 0 },
          news: { w: 4, h: 7, x: 0, y: 0 },
          todo: { w: 4, h: 5, x: 0, y: 0 },
        };
        const desired = layout ?? fallback[kind];
        const id = nextUid("w");
        set((state) => {
          const placed = findFreeSlot(state.widgets, desired.w, desired.h);
          return {
            widgets: [...state.widgets, { id, kind, layout: placed }],
          };
        });
        return id;
      },
      removeWidget: (id) =>
        set((state) => ({
          widgets: state.widgets.filter((w) => w.id !== id),
        })),
      updateWidgetLayouts: (updates) =>
        set((state) => {
          const layoutsById = new Map(
            updates.map((update) => [update.id, update.layout]),
          );
          return {
            widgets: state.widgets.map((widget) => {
              const layout = layoutsById.get(widget.id);
              return layout ? { ...widget, layout } : widget;
            }),
          };
        }),
      resetLayout: () => set({ widgets: DEFAULT_WIDGETS }),
      setEditing: (editing) => set({ editing }),

      addNewsSource: (source) =>
        set((state) => ({
          newsSources: [...state.newsSources, { ...source, id: nextUid("ns") }],
        })),
      updateNewsSource: (id, patch) =>
        set((state) => ({
          newsSources: state.newsSources.map((ns) =>
            ns.id === id ? { ...ns, ...patch } : ns,
          ),
        })),
      removeNewsSource: (id) =>
        set((state) => ({
          newsSources: state.newsSources.filter((ns) => ns.id !== id),
        })),

      addTodo: (text) => {
        set((state) => ({ todos: prependTodo(state.todos, text) }));
      },
      toggleTodo: (id) =>
        set((state) => ({
          todos: toggleTodoItem(state.todos, id),
        })),
      removeTodo: (id) =>
        set((state) => ({
          todos: removeTodoItem(state.todos, id),
        })),
    }),
    {
      name: "dashboard-store",
      version: 6,
      partialize: (state) => ({
        quickActions: state.quickActions,
        widgets: state.widgets,
        newsSources: state.newsSources,
        todos: state.todos,
      }),
      migrate: (
        persisted: unknown,
        persistedVersion: number,
      ): Partial<DashboardState> => {
        const state = (persisted ?? {}) as Partial<DashboardState>;
        const persistedNewsSources =
          Array.isArray(state.newsSources) && state.newsSources.length > 0
            ? state.newsSources
            : DEFAULT_NEWS_SOURCES;
        return {
          quickActions:
            Array.isArray(state.quickActions) && state.quickActions.length > 0
              ? state.quickActions
              : DEFAULT_QUICK_ACTIONS,
          widgets: migrateWidgets(state.widgets, persistedVersion),
          newsSources:
            persistedVersion < 5
              ? appendMissingNewsSources(
                  persistedNewsSources,
                  ADDED_NEWS_SOURCES_V5,
                )
              : persistedNewsSources,
          todos: Array.isArray(state.todos) ? state.todos : [],
        };
      },
    },
  ),
);
