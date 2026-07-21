import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Curated emoji grid — intentionally small. Covers the common quick-action
 * metaphors (search, edit, build, navigate, monitor, docs). Users can always
 * type a literal character via the dialog's text input if they want something
 * off-grid.
 */
const CATEGORIES: Record<string, string[]> = {
  common: ["•", "🔍", "🗂", "📜", "⚡", "🚀", "⭐", "📌"],
  tools: ["🛠", "🔧", "⚙️", "🔨", "📐", "📊", "📈", "📉"],
  dev: ["💻", "🖥", "📱", "🌐", "🔗", "📁", "📂", "📝"],
  symbols: ["★", "☆", "✓", "➤", "⮕", "‣", "❯", "→"],
};

interface Props {
  value: string;
  onChange: (emoji: string) => void;
}

export function EmojiPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<keyof typeof CATEGORIES>("common");

  return (
    <div className="emoji-picker" role="listbox">
      <div className="emoji-picker__tabs">
        {(Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>).map((cat) => (
          <button
            key={cat}
            type="button"
            className={`emoji-picker__tab ${active === cat ? "is-active" : ""}`}
            onClick={() => setActive(cat)}
          >
            {t(`dashboard.quickActions.dialog.iconCat.${cat}`)}
          </button>
        ))}
      </div>
      <div className="emoji-picker__grid">
        {CATEGORIES[active].map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={`emoji-picker__cell ${value === emoji ? "is-selected" : ""}`}
            onClick={() => onChange(emoji)}
            title={emoji}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
