import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useDashboardStore } from "../../store/dashboard";

export function TodoCard() {
  const { t } = useTranslation();
  const todos = useDashboardStore((state) => state.todos);
  const addTodo = useDashboardStore((state) => state.addTodo);
  const toggleTodo = useDashboardStore((state) => state.toggleTodo);
  const removeTodo = useDashboardStore((state) => state.removeTodo);
  const [draft, setDraft] = useState("");

  const remaining = todos.filter((todo) => !todo.completed).length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) return;
    addTodo(draft);
    setDraft("");
  };

  return (
    <div className="home-card home-card--todo">
      <div className="home-card__header">
        <h3>{t("dashboard.todo.title")}</h3>
        <span className="todo-card__count">
          {t("dashboard.todo.remaining", { count: remaining })}
        </span>
      </div>

      <form className="todo-card__composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={120}
          placeholder={t("dashboard.todo.placeholder")}
          aria-label={t("dashboard.todo.placeholder")}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label={t("dashboard.todo.add")}
          title={t("dashboard.todo.add")}
        >
          +
        </button>
      </form>

      {todos.length === 0 ? (
        <div className="todo-card__empty">{t("dashboard.todo.empty")}</div>
      ) : (
        <ul className="todo-card__list">
          {todos.map((todo) => (
            <li key={todo.id} className={todo.completed ? "is-completed" : ""}>
              <label className="todo-card__item">
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                  aria-label={
                    todo.completed
                      ? t("dashboard.todo.markActive", { title: todo.text })
                      : t("dashboard.todo.markCompleted", { title: todo.text })
                  }
                />
                <span className="todo-card__check" aria-hidden="true" />
                <span className="todo-card__text" title={todo.text}>
                  {todo.text}
                </span>
              </label>
              <button
                type="button"
                className="todo-card__remove"
                onClick={() => removeTodo(todo.id)}
                aria-label={t("dashboard.todo.remove", { title: todo.text })}
                title={t("dashboard.todo.remove", { title: todo.text })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
