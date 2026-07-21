import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDashboardStore } from "../../store/dashboard";
import { tauriApi } from "../../lib/tauri";
import { mergeNewsItemsBySource, parseFeed, type NewsItem } from "./newsFeed";
import { ManageWidgetsDialog } from "./ManageWidgetsDialog";

async function openLink(url: string) {
  if (!url) return;
  try {
    await tauriApi.openExternal({ kind: "url", target: url });
  } catch (err) {
    console.warn("[news] openExternal failed", err);
  }
}

const MAX_ITEMS = 8;
const NEWS_QUERY_VERSION = 2;
const FAILED_SOURCE_RETRY_MS = 30_000;

function formatRel(unixSec: number | null): string {
  if (unixSec == null) return "";
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 0) return "now";
  if (diff < 60) return "now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

interface FetchedSource {
  id: string;
  label: string;
  items: NewsItem[];
  error: boolean;
}

export function NewsCard() {
  const { t } = useTranslation();
  const newsSources = useDashboardStore((s) => s.newsSources);
  const enabledSources = newsSources.filter((s) => s.enabled);
  const [managing, setManaging] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");

  const sourcesKey = enabledSources
    .map((s) => `${s.id}:${s.kind}:${s.url}`)
    .join("|");
  const { data, isLoading } = useQuery<FetchedSource[]>({
    queryKey: ["home", "news", NEWS_QUERY_VERSION, sourcesKey],
    queryFn: async () => {
      const results = await Promise.all(
        enabledSources.map(async (src) => {
          try {
            const body = await tauriApi.fetchFeed(src.url);
            const items = parseFeed(body, src.kind).map((item) => ({
              ...item,
              sourceLabel: src.label,
              sourceId: src.id,
            }));
            return { id: src.id, label: src.label, items, error: false };
          } catch (error) {
            console.warn("[news] feed fetch failed", src.label, src.url, error);
            return { id: src.id, label: src.label, items: [], error: true };
          }
        }),
      );
      return results;
    },
    enabled: enabledSources.length > 0,
    staleTime: 10 * 60 * 1000,
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.error)
        ? FAILED_SOURCE_RETRY_MS
        : false,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const availableSources = (data ?? []).filter(
    (source) => !source.error && source.items.length > 0,
  );
  const unavailableSources = (data ?? []).filter(
    (source) => source.error || source.items.length === 0,
  );
  const allItems = mergeNewsItemsBySource(
    availableSources.map((source) => source.items),
    MAX_ITEMS,
  );
  const activeFilter =
    sourceFilter === "all" ||
    enabledSources.some((source) => source.id === sourceFilter)
      ? sourceFilter
      : "all";
  const selectedSource =
    activeFilter === "all"
      ? null
      : ((data ?? []).find((source) => source.id === activeFilter) ?? null);
  const visibleItems =
    activeFilter === "all"
      ? allItems
      : mergeNewsItemsBySource([selectedSource?.items ?? []], MAX_ITEMS);

  const everySourceFailed =
    !!data && data.length > 0 && data.every((s) => s.error);

  return (
    <div className="home-card home-card--news">
      <div className="home-card__header">
        <h3>{t("dashboard.news.title")}</h3>
        <div className="home-card__header-actions">
          {enabledSources.length > 1 && (
            <span
              className={`news-source-count ${unavailableSources.length > 0 ? "has-issues" : ""}`}
              title={
                unavailableSources.length > 0
                  ? t("dashboard.news.unavailableSources", {
                      sources: unavailableSources
                        .map((source) => source.label)
                        .join("、"),
                    })
                  : undefined
              }
            >
              {data
                ? t("dashboard.news.sourceAvailability", {
                    available: availableSources.length,
                    total: enabledSources.length,
                  })
                : t("dashboard.news.sourceCount", {
                    count: enabledSources.length,
                  })}
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setManaging(true)}
            aria-label={t("dashboard.manage.sections.sources")}
            title={t("dashboard.manage.sections.sources")}
          >
            ⚙
          </button>
        </div>
      </div>
      {enabledSources.length > 1 && (
        <div
          className="news-source-filters"
          role="group"
          aria-label={t("dashboard.news.filterLabel")}
        >
          <button
            type="button"
            className={activeFilter === "all" ? "is-active" : ""}
            onClick={() => setSourceFilter("all")}
            aria-pressed={activeFilter === "all"}
          >
            {t("dashboard.news.allSources")}
          </button>
          {enabledSources.map((source) => (
            <button
              type="button"
              key={source.id}
              className={activeFilter === source.id ? "is-active" : ""}
              onClick={() => setSourceFilter(source.id)}
              aria-pressed={activeFilter === source.id}
              title={source.label}
            >
              {source.label}
            </button>
          ))}
        </div>
      )}
      {enabledSources.length === 0 ? (
        <div className="home-card__empty">
          <p>{t("dashboard.news.noSources")}</p>
        </div>
      ) : isLoading ? (
        <div className="home-card__empty">
          <p>{t("dashboard.news.fetching")}</p>
        </div>
      ) : activeFilter !== "all" && visibleItems.length === 0 ? (
        <div className="home-card__empty">
          <p>
            {t("dashboard.news.sourceEmpty", {
              source:
                enabledSources.find((source) => source.id === activeFilter)
                  ?.label ?? "",
            })}
          </p>
        </div>
      ) : everySourceFailed || visibleItems.length === 0 ? (
        <div className="home-card__empty">
          <p>{t("dashboard.news.error")}</p>
        </div>
      ) : (
        <ul className="news-list">
          {visibleItems.map((item, idx) => (
            <li key={(item.sourceId ?? "") + (item.link ?? "") + idx}>
              <button
                type="button"
                className="news-item-btn"
                onClick={() => openLink(item.link)}
                title={item.title}
              >
                <span className="news-item__title">{item.title}</span>
                <span className="news-item__meta">
                  {item.sourceLabel && (
                    <span className="news-item__source">
                      {item.sourceLabel}
                    </span>
                  )}
                  {item.published != null && (
                    <span>{formatRel(item.published)}</span>
                  )}
                  {item.score !== 0 && (
                    <span className="news-item__score">▲ {item.score}</span>
                  )}
                  {item.answerCount > 0 && (
                    <span className="news-item__answers">
                      {item.answerCount} ans
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {managing && <ManageWidgetsDialog onClose={() => setManaging(false)} />}
    </div>
  );
}
