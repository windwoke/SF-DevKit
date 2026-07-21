import { useTranslation } from "react-i18next";
import { useSoqlStore } from "../../store/soql";
import { useUiStore } from "../../store/ui";

export function RecentSoqlCard() {
  const { t } = useTranslation();
  const history = useSoqlStore((s) => s.history);
  const setDraft = useSoqlStore((s) => s.setDraft);
  const setActiveModule = useUiStore((s) => s.setActiveModule);

  const handleOpen = (query: string) => {
    setDraft(query);
    setActiveModule("soql");
  };

  return (
    <div className="home-card home-card--recent-soql">
      <div className="home-card__header">
        <h3>{t("dashboard.recentSoql.title")}</h3>
      </div>
      {history.length === 0 ? (
        <div className="home-card__empty">
          <p>{t("dashboard.recentSoql.empty")}</p>
        </div>
      ) : (
        <ul className="recent-list">
          {history.slice(0, 8).map((query, idx) => (
            <li key={idx}>
              <button
                className="recent-item recent-item--mono"
                onClick={() => handleOpen(query)}
                title={query}
              >
                <code>{query.replace(/\s+/g, " ").slice(0, 80)}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
