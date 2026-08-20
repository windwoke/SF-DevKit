import { useTranslation } from "react-i18next";
import { classKey, fullClassName } from "./filters";
import type { ApexTestClass } from "./types";

interface TestClassPickerProps {
  classes: ApexTestClass[];
  /** Pre-filtered by the parent (same search text) — reused for the
   *  select-visible action so the filter logic lives in filters.ts only. */
  visibleClasses: ApexTestClass[];
  selectedKeys: Set<string>;
  search: string;
  onSearchChange: (value: string) => void;
  onToggle: (key: string) => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  disabled: boolean;
  /** "retrieve" groups rows into package vs. org sections. */
  sourceMode: "org" | "retrieve";
}

export function TestClassPicker({
  visibleClasses,
  selectedKeys,
  search,
  onSearchChange,
  onToggle,
  onSelectVisible,
  onClearSelection,
  disabled,
  sourceMode,
}: TestClassPickerProps) {
  const { t } = useTranslation();
  const visible = visibleClasses;
  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selectedKeys.has(classKey(c)));

  const renderRow = (cls: ApexTestClass) => {
    const key = classKey(cls);
    return (
      <label key={key} className={`apex-test-class-row ${selectedKeys.has(key) ? "selected" : ""}`}>
        <input
          type="checkbox"
          checked={selectedKeys.has(key)}
          onChange={() => onToggle(key)}
          disabled={disabled}
        />
        <span className="apex-test-class-name" title={cls.file_path ?? undefined}>
          {fullClassName(cls.namespace_prefix, cls.name)}
        </span>
      </label>
    );
  };

  const renderList = () => {
    if (visible.length === 0) {
      return <div className="apex-test-empty">{t("apexTestRunner.empty.noClasses")}</div>;
    }
    if (sourceMode !== "retrieve") return visible.map(renderRow);
    // Retrieve mode: package rows first, then current-org extras.
    const pkg = visible.filter((c) => c.source === "retrieve");
    const org = visible.filter((c) => c.source === "org");
    return (
      <>
        {pkg.length > 0 ? (
          <div className="apex-test-picker-group">{t("apexTestRunner.picker.packageTests")}</div>
        ) : null}
        {pkg.map(renderRow)}
        {org.length > 0 ? (
          <div className="apex-test-picker-group">{t("apexTestRunner.picker.orgTests")}</div>
        ) : null}
        {org.map(renderRow)}
      </>
    );
  };

  return (
    <div className="apex-test-picker">
      <div className="apex-test-picker-search">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("apexTestRunner.searchClasses")}
          disabled={disabled}
        />
      </div>
      <div className="apex-test-picker-list" role="listbox" aria-multiselectable>
        {renderList()}
      </div>
      <div className="apex-test-picker-footer">
        <span className="apex-test-muted">
          {t("apexTestRunner.selectedCount", { count: selectedKeys.size })}
        </span>
        <div className="apex-test-picker-actions">
          <button
            type="button"
            onClick={onSelectVisible}
            disabled={disabled || visible.length === 0 || allVisibleSelected}
          >
            {t("apexTestRunner.selectVisible")}
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={disabled || selectedKeys.size === 0}
          >
            {t("apexTestRunner.clearSelection")}
          </button>
        </div>
      </div>
    </div>
  );
}
