import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardStore, type WidgetKind } from "../../store/dashboard";
import { OrgStatusCard } from "./OrgStatusCard";
import { RecentSoqlCard } from "./RecentSoqlCard";
import { RecentActivityCard } from "./RecentActivityCard";
import { NewsCard } from "./NewsCard";
import { QuickActionsPanel } from "./QuickActionsPanel";
import { AddWidgetPopover } from "./AddWidgetPopover";
import { WidgetFrame } from "./WidgetFrame";
import { GreetingCard } from "./GreetingCard";
import { TodoCard } from "./TodoCard";

const WIDGET_RENDERERS: Record<WidgetKind, () => JSX.Element> = {
  greeting: GreetingCard,
  orgStatus: OrgStatusCard,
  quickActions: QuickActionsPanel,
  recentSoql: RecentSoqlCard,
  recentActivity: RecentActivityCard,
  news: NewsCard,
  todo: TodoCard,
};

const GridLayout = WidthProvider(ReactGridLayout);
const ROW_HEIGHT = 60;

function EditLayoutIcon({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8.2 3.1 3.1L13 4.7" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" />
      <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" />
      <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" />
      <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function ResetLayoutIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.1 5.2A5.5 5.5 0 1 1 2.7 10" />
      <path d="M3.1 2.4v2.8h2.8" />
    </svg>
  );
}

function AddWidgetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
      <path d="M8 5v6M5 8h6" />
    </svg>
  );
}

export function HomeDashboard() {
  const { t } = useTranslation();
  const widgets = useDashboardStore((s) => s.widgets);
  const editing = useDashboardStore((s) => s.editing);
  const setEditing = useDashboardStore((s) => s.setEditing);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const updateWidgetLayouts = useDashboardStore((s) => s.updateWidgetLayouts);
  const resetLayout = useDashboardStore((s) => s.resetLayout);
  const [addingWidget, setAddingWidget] = useState(false);

  const layout = useMemo<Layout[]>(
    () =>
      widgets.map((w) => ({
        i: w.id,
        x: w.layout.x,
        y: w.layout.y,
        w: w.layout.w,
        h: w.layout.h,
        static: !editing,
      })),
    [editing, widgets],
  );

  const onLayoutChange = useCallback(
    (next: Layout[]) => {
      if (!editing) return;
      const currentById = new Map(
        widgets.map((widget) => [widget.id, widget.layout]),
      );
      const changed = next.flatMap((item) => {
        const current = currentById.get(item.i);
        if (
          !current ||
          (current.x === item.x &&
            current.y === item.y &&
            current.w === item.w &&
            current.h === item.h)
        ) {
          return [];
        }
        return [
          {
            id: item.i,
            layout: { x: item.x, y: item.y, w: item.w, h: item.h },
          },
        ];
      });
      if (changed.length > 0) updateWidgetLayouts(changed);
    },
    [editing, updateWidgetLayouts, widgets],
  );

  return (
    <section className="module module-home" aria-label={t("modules.home")}>
      <div className="home-toolbar">
        <button
          type="button"
          className={`btn btn-sm home-toolbar__button ${editing ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setEditing(!editing)}
        >
          <EditLayoutIcon done={editing} />
          {editing ? t("dashboard.layout.done") : t("dashboard.layout.edit")}
        </button>
        {editing && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost home-toolbar__button home-toolbar__add"
              onClick={() => setAddingWidget(true)}
            >
              <AddWidgetIcon />
              {t("dashboard.layout.add")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost home-toolbar__button home-toolbar__reset"
              onClick={resetLayout}
              title={t("dashboard.layout.reset")}
            >
              <ResetLayoutIcon />
              {t("dashboard.layout.reset")}
            </button>
            <span className="home-toolbar__hint">
              {t("dashboard.layout.hint")}
            </span>
          </>
        )}
      </div>
      <div className={`home-grid-host ${editing ? "is-editing" : ""}`}>
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={ROW_HEIGHT}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          isBounded={false}
          compactType="vertical"
          preventCollision={false}
          draggableCancel=".widget-frame__remove, .home-card__header-actions, .org-status-actions, .quick-action__manage-tools, .news-source-filters, .todo-card__composer, .todo-card__list"
          onLayoutChange={onLayoutChange}
        >
          {widgets.map((w) => {
            const Renderer = WIDGET_RENDERERS[w.kind];
            return (
              <div key={w.id} className="rgl-cell">
                <WidgetFrame
                  id={w.id}
                  editing={editing}
                  onRemove={() => removeWidget(w.id)}
                >
                  <Renderer />
                </WidgetFrame>
              </div>
            );
          })}
        </GridLayout>
      </div>
      {addingWidget && (
        <AddWidgetPopover
          onPick={(kind) => {
            useDashboardStore.getState().addWidget(kind);
            setAddingWidget(false);
          }}
          onClose={() => setAddingWidget(false)}
        />
      )}
    </section>
  );
}
