import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tauriApi, type MetadataComponentMeta, type MetadataTypeMeta } from "../../lib/tauri";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";
import { GROUP_ORDER } from "./constants";

async function loadMetadataTypesWithFallback(orgId: string) {
  try {
    return await tauriApi.listMetadataTypes({ orgId, forceRefresh: false });
  } catch (firstError) {
    console.warn("[MetadataTree] listMetadataTypes cache read failed, retrying force refresh", {
      orgId,
      firstError,
    });
    return tauriApi.listMetadataTypes({ orgId, forceRefresh: true });
  }
}

async function loadMetadataComponentsWithFallback(orgId: string, metadataType: string) {
  try {
    return await tauriApi.listMetadataComponents({ orgId, metadataType, forceRefresh: false });
  } catch (firstError) {
    console.warn("[MetadataTree] listMetadataComponents cache read failed, retrying force refresh", {
      orgId,
      metadataType,
      firstError,
    });
    return tauriApi.listMetadataComponents({ orgId, metadataType, forceRefresh: true });
  }
}

export function MetadataTree() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentOrg } = useOrgStore();
  const { searchQuery, setSearchQuery, selectedCount } = useMetadataStore();
  const refresh = () => {
    if (!currentOrg) return;
    queryClient.invalidateQueries({ queryKey: ["metadata-types", currentOrg] });
    queryClient.invalidateQueries({ queryKey: ["metadata-components", currentOrg] });
  };
  const typesQuery = useQuery({
    queryKey: ["metadata-types", currentOrg],
    queryFn: async () => {
      console.log("[MetadataTree] listMetadataTypes:start", { orgId: currentOrg });
      const data = await loadMetadataTypesWithFallback(currentOrg!);
      console.log("[MetadataTree] listMetadataTypes:success", { count: data.length, orgId: currentOrg });
      return data;
    },
    enabled: !!currentOrg,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  const grouped = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const map = new Map<string, MetadataTypeMeta[]>();
    for (const item of typesQuery.data ?? []) {
      if (query && !item.xml_name.toLowerCase().includes(query)) continue;
      const list = map.get(item.group_name) ?? [];
      list.push(item);
      map.set(item.group_name, list);
    }
    return map;
  }, [typesQuery.data, searchQuery]);

  if (!currentOrg) return <div className="empty-state">{t("metadataBrowser.tree.pickOrg")}</div>;
  if (typesQuery.isLoading) return <div className="empty-state">{t("metadataBrowser.tree.loadingTypes")}</div>;
  if (typesQuery.isError) {
    const msg = (typesQuery.error as Error).message;
    console.error("[MetadataTree] listMetadataTypes:error", {
      orgId: currentOrg,
      message: msg,
      fullError: typesQuery.error,
    });
    return <div className="empty-state error">{t("metadataBrowser.tree.loadError", { message: msg })}</div>;
  }

  return (
    <section className="metadata-pane metadata-tree-pane">
      <header className="metadata-pane-header">
        <h3>{t("metadataBrowser.tree.paneTitle")}</h3>
        <div className="metadata-tree-tools">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("metadataBrowser.tree.searchPlaceholder")}
          />
          <span className="metadata-selected-chip">{t("metadataBrowser.tree.selectedChip", { count: selectedCount() })}</span>
          <button type="button" onClick={refresh}>
            {t("metadataBrowser.tree.refresh")}
          </button>
        </div>
      </header>
      <div className="metadata-tree-body">
        {GROUP_ORDER.map((group) => {
          const groupTypes = grouped.get(group);
          if (!groupTypes?.length) return null;
          return (
            <div className="metadata-group" key={group}>
              <div className="metadata-group-title">{group}</div>
              {groupTypes.map((type) => (
                <TypeRow key={type.xml_name} item={type} />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TypeRow({ item }: { item: MetadataTypeMeta }) {
  const { t } = useTranslation();
  const { currentOrg } = useOrgStore();
  const { expandedTypes, toggleExpand, getTypeSelectionState, toggleType, selection, toggleComponent } = useMetadataStore();
  const isExpanded = expandedTypes.includes(item.xml_name);
  const [childQuery, setChildQuery] = useState("");
  const compQuery = useQuery({
    queryKey: ["metadata-components", currentOrg, item.xml_name],
    queryFn: async () => {
      console.log("[MetadataTree] listMetadataComponents:start", {
        orgId: currentOrg,
        metadataType: item.xml_name,
      });
      const data = await loadMetadataComponentsWithFallback(currentOrg!, item.xml_name);
      console.log("[MetadataTree] listMetadataComponents:success", {
        orgId: currentOrg,
        metadataType: item.xml_name,
        count: data.length,
      });
      return data;
    },
    enabled: !!currentOrg && isExpanded,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  if (compQuery.isError) {
    console.error("[MetadataTree] listMetadataComponents:error", {
      orgId: currentOrg,
      metadataType: item.xml_name,
      message: (compQuery.error as Error).message,
      fullError: compQuery.error,
    });
  }

  const members = (compQuery.data ?? []).map((c) => c.full_name);
  const selectionState = getTypeSelectionState(item.xml_name, members);
  const filtered = filterComponents(compQuery.data ?? [], childQuery);
  const filteredNames = filtered.map((item) => item.full_name);
  const selectedSet = new Set(selection[item.xml_name] ?? []);
  const hasLoadedMembers = !!compQuery.data;
  const totalLabel = hasLoadedMembers ? members.length.toString() : "";
  const selectedLabel = selectedSet.size.toString();
  const allFilteredSelected = filteredNames.length > 0 && filteredNames.every((name) => selectedSet.has(name));
  const hasAnyFilteredSelected = filteredNames.some((name) => selectedSet.has(name));

  const handleSelectFiltered = () => {
    for (const name of filteredNames) {
      if (!selectedSet.has(name)) {
        toggleComponent(item.xml_name, name);
      }
    }
  };

  const handleUnselectFiltered = () => {
    for (const name of filteredNames) {
      if (selectedSet.has(name)) {
        toggleComponent(item.xml_name, name);
      }
    }
  };

  return (
    <div className="metadata-type-block">
      <div className="metadata-type-row" onClick={() => toggleExpand(item.xml_name)}>
        <button type="button" className={`metadata-caret ${isExpanded ? "expanded" : ""}`} aria-label={t("metadataBrowser.tree.toggleExpandAria")} />
        <input
          type="checkbox"
          checked={selectionState === "all"}
          ref={(el) => {
            if (el) el.indeterminate = selectionState === "partial";
          }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleType(item.xml_name, members)}
        />
        <span className="metadata-type-name">{item.xml_name}</span>
        <span className="metadata-count">
          {compQuery.isFetching ? "…" : hasLoadedMembers ? `${selectedLabel}/${totalLabel}` : ""}
        </span>
      </div>
      {isExpanded ? (
        <div className="metadata-component-list">
          <div className="metadata-type-tools">
            <div className="metadata-type-search-row">
              <input
                type="search"
                value={childQuery}
                onChange={(e) => setChildQuery(e.target.value)}
                placeholder={t("metadataBrowser.tree.childSearchPlaceholder")}
              />
            </div>
            {childQuery.trim() ? (
              <div className="metadata-type-action-row">
                <button type="button" onClick={handleSelectFiltered} disabled={filteredNames.length === 0 || allFilteredSelected}>
                  {t("metadataBrowser.tree.selectAllFiltered")}
                </button>
                <button type="button" onClick={handleUnselectFiltered} disabled={filteredNames.length === 0 || !hasAnyFilteredSelected}>
                  {t("metadataBrowser.tree.unselectAllFiltered")}
                </button>
              </div>
            ) : null}
          </div>
          {compQuery.isLoading ? <div className="metadata-muted">{t("metadataBrowser.tree.loadingComponents")}</div> : null}
          {filtered.map((component) => (
            <ComponentRow key={component.full_name} metadataType={item.xml_name} item={component} />
          ))}
          {!compQuery.isLoading && filtered.length === 0 ? (
            <div className="metadata-muted">{t("metadataBrowser.tree.noMatchingComponents")}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComponentRow({ metadataType, item }: { metadataType: string; item: MetadataComponentMeta }) {
  const { selection, toggleComponent } = useMetadataStore();
  const selected = (selection[metadataType] ?? []).includes(item.full_name);

  return (
    <div className="metadata-component-row" onClick={() => toggleComponent(metadataType, item.full_name)}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggleComponent(metadataType, item.full_name)}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="metadata-component-name" title={item.full_name}>
        {item.full_name}
      </span>
    </div>
  );
}

function filterComponents(items: MetadataComponentMeta[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => item.full_name.toLowerCase().includes(normalized));
}
