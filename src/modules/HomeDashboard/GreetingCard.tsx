import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { greetingPeriodForHour } from "./greetingTime";

export function GreetingCard() {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const locale = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const formatters = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      date: new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    }),
    [locale],
  );

  const period = greetingPeriodForHour(now.getHours());

  return (
    <div className={`home-card home-card--greeting is-${period}`}>
      <div className="greeting-card__copy">
        <p className="greeting-card__date">{formatters.date.format(now)}</p>
        <h2>{t(`dashboard.greeting.${period}`)}</h2>
        <p className="greeting-card__subtitle">
          {t("dashboard.greeting.subtitle")}
        </p>
      </div>
      <time className="greeting-card__time" dateTime={now.toISOString()}>
        {formatters.time.format(now)}
      </time>
      <span className="greeting-card__orb" aria-hidden />
    </div>
  );
}
