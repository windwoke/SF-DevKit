import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { tauriApi, type MetadataComponentMeta, type MetadataTypeMeta } from "../../lib/tauri";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";
import { GROUP_ORDER } from "./constants";
import { filterMetadataComponents } from "./metadataComponentFilter";
import { normalizeMetadataSearchQuery, resolveTreeGroup, typeMatchesMetadataSearch } from "./metadataTypeSearch";

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

/** 列表项稳定 key：顶层用 xml_name；子类型用「父::子」避免与其它组冲突。 */
function metadataTypeRowKey(item: MetadataTypeMeta): string {
  return item.parent_xml_name ? `${item.parent_xml_name}::${item.xml_name}` : item.xml_name;
}

/**
 * 组内顺序：顶层类型按 xml_name 排序；每个父类型后紧跟其所有子类型（按 xml_name）；
 * 父类型未出现在当前列表时（例如被搜索筛掉）的子类型排在末尾，按父名、再子名排序。
 */
function sortTypesWithinGroup(items: MetadataTypeMeta[]): MetadataTypeMeta[] {
  if (items.length <= 1) return items;
  const tops = items.filter((i) => !i.parent_xml_name).sort((a, b) => a.xml_name.localeCompare(b.xml_name));
  const children = items.filter((i) => i.parent_xml_name);

  const out: MetadataTypeMeta[] = [];
  const placed = new Set<string>();

  const mark = (c: MetadataTypeMeta) => `${c.parent_xml_name}\0${c.xml_name}`;

  for (const t of tops) {
    out.push(t);
    const subs = children
      .filter((c) => c.parent_xml_name === t.xml_name)
      .sort((a, b) => a.xml_name.localeCompare(b.xml_name));
    for (const s of subs) {
      out.push(s);
      placed.add(mark(s));
    }
  }

  const orphans = children
    .filter((c) => !placed.has(mark(c)))
    .sort((a, b) => {
      const pa = a.parent_xml_name ?? "";
      const pb = b.parent_xml_name ?? "";
      if (pa !== pb) return pa.localeCompare(pb);
      return a.xml_name.localeCompare(b.xml_name);
    });
  out.push(...orphans);
  return out;
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M21 21v-5h-5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetadataTree() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentOrg } = useOrgStore();
  const { searchQuery, setSearchQuery, selectedCount } = useMetadataStore();
  const [manualTreeSync, setManualTreeSync] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    setManualTreeSync(true);
    try {
      const types = await tauriApi.listMetadataTypes({ orgId: currentOrg, forceRefresh: true });
      queryClient.setQueryData(["metadata-types", currentOrg], types);
    } catch (e) {
      console.error("[MetadataTree] refresh: listMetadataTypes failed", { orgId: currentOrg, e });
    } finally {
      setManualTreeSync(false);
    }
  }, [currentOrg, queryClient]);
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

  const treeRefreshing = typesQuery.isFetching || manualTreeSync;

  const grouped = useMemo(() => {
    const query = normalizeMetadataSearchQuery(searchQuery);
    const map = new Map<string, MetadataTypeMeta[]>();
    for (const item of typesQuery.data ?? []) {
      if (!typeMatchesMetadataSearch(item, query)) continue;
      const group = resolveTreeGroup(item.group_name);
      const list = map.get(group) ?? [];
      list.push(item);
      map.set(group, list);
    }
    for (const [group, list] of map) {
      map.set(group, sortTypesWithinGroup(list));
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
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("metadataBrowser.tree.searchPlaceholder")}
            title={t("metadataBrowser.tree.searchTitle")}
            aria-label={t("metadataBrowser.tree.searchTitle")}
          />
          <span className="metadata-selected-chip">{t("metadataBrowser.tree.selectedChip", { count: selectedCount() })}</span>
          <button
            type="button"
            onClick={refresh}
            title={t("metadataBrowser.tree.refreshTitle")}
            aria-label={t("metadataBrowser.tree.refreshTitle")}
            disabled={!currentOrg || treeRefreshing}
          >
            {treeRefreshing ? t("metadataBrowser.tree.refreshing") : t("metadataBrowser.tree.refresh")}
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
                <TypeRow key={metadataTypeRowKey(type)} item={type} />
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
  const queryClient = useQueryClient();
  const { currentOrg } = useOrgStore();
  const { expandedTypes, toggleExpand, getTypeSelectionState, toggleType, selection, toggleComponent } = useMetadataStore();
  const isExpanded = expandedTypes.includes(item.xml_name);
  const [childQuery, setChildQuery] = useState("");
  const [membersSyncing, setMembersSyncing] = useState(false);

  const refreshMembers = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      if (!currentOrg) return;
      setMembersSyncing(true);
      try {
        const fresh = await tauriApi.listMetadataComponents({
          orgId: currentOrg,
          metadataType: item.xml_name,
          forceRefresh: true,
        });
        queryClient.setQueryData(["metadata-components", currentOrg, item.xml_name], fresh);
      } catch (err) {
        console.error("[MetadataTree] refreshMembers failed", {
          orgId: currentOrg,
          metadataType: item.xml_name,
          err,
        });
      } finally {
        setMembersSyncing(false);
      }
    },
    [currentOrg, item.xml_name, queryClient],
  );

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

  const sortedComponents = useMemo(() => {
    const data = compQuery.data ?? [];
    if (data.length <= 1) return data;
    // 去重：sf CLI 可能返回重复的 full_name，React key 冲突会导致子项被重复渲染
    const seen = new Set<string>();
    const deduped: MetadataComponentMeta[] = [];
    for (const item of data) {
      if (!seen.has(item.full_name)) {
        seen.add(item.full_name);
        deduped.push(item);
      }
    }
    return deduped.sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base", numeric: true }),
    );
  }, [compQuery.data]);

  const members = sortedComponents.map((c) => c.full_name);
  const selectionState = getTypeSelectionState(item.xml_name, members);
  const filtered = filterMetadataComponents(sortedComponents, childQuery);
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
        <span className="metadata-type-name">
          {item.xml_name}
          {item.parent_xml_name ? (
            <span className="metadata-type-parent"> · {item.parent_xml_name}</span>
          ) : null}
        </span>
        <span className="metadata-count">
          {compQuery.isFetching ? "…" : hasLoadedMembers ? `${selectedLabel}/${totalLabel}` : ""}
        </span>
      </div>
      {isExpanded ? (
        <div className="metadata-component-list">
          <div className="metadata-type-tools">
            <div className="metadata-type-tools-bar">
              <div className="metadata-type-search-row">
                <input
                  type="search"
                  value={childQuery}
                  onChange={(e) => setChildQuery(e.target.value)}
                  placeholder={t("metadataBrowser.tree.childSearchPlaceholder")}
                />
              </div>
              <button
                type="button"
                className="metadata-type-members-sync"
                onClick={refreshMembers}
                disabled={membersSyncing || compQuery.isFetching}
                title={t("metadataBrowser.tree.refreshMembersTitle")}
                aria-label={t("metadataBrowser.tree.refreshMembersTitle")}
              >
                <IconRefresh />
              </button>
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

