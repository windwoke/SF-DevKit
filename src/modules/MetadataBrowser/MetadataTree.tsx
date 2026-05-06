import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { tauriApi, type MetadataComponentMeta, type MetadataTypeMeta } from "../../lib/tauri";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";
import { GROUP_ORDER } from "./constants";

export function MetadataTree() {
  const { currentOrg } = useOrgStore();
  const { searchQuery } = useMetadataStore();
  const typesQuery = useQuery({
    queryKey: ["metadata-types", currentOrg],
    queryFn: () => tauriApi.listMetadataTypes({ orgId: currentOrg!, forceRefresh: false }),
    enabled: !!currentOrg,
    staleTime: 24 * 60 * 60 * 1000,
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

  if (!currentOrg) return <div className="empty-state">请先在 Org 管理中选择一个 Org。</div>;
  if (typesQuery.isLoading) return <div className="empty-state">正在加载 Metadata Types…</div>;
  if (typesQuery.isError) return <div className="empty-state error">加载失败：{(typesQuery.error as Error).message}</div>;

  return (
    <section className="metadata-pane metadata-tree-pane">
      <header className="metadata-pane-header">
        <h3>元数据树</h3>
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
  const { currentOrg } = useOrgStore();
  const { expandedTypes, toggleExpand, searchQuery, getTypeSelectionState, toggleType } = useMetadataStore();
  const isExpanded = expandedTypes.includes(item.xml_name);
  const compQuery = useQuery({
    queryKey: ["metadata-components", currentOrg, item.xml_name],
    queryFn: () => tauriApi.listMetadataComponents({ orgId: currentOrg!, metadataType: item.xml_name, forceRefresh: false }),
    enabled: !!currentOrg && isExpanded,
    staleTime: 10 * 60 * 1000,
  });

  const members = (compQuery.data ?? []).map((c) => c.full_name);
  const selectionState = getTypeSelectionState(item.xml_name, members);
  const filtered = filterComponents(compQuery.data ?? [], searchQuery);

  return (
    <div className="metadata-type-block">
      <div className="metadata-type-row" onClick={() => toggleExpand(item.xml_name)}>
        <button type="button" className={`metadata-caret ${isExpanded ? "expanded" : ""}`} aria-label="切换展开" />
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
        <span className="metadata-count">{compQuery.isFetching ? "…" : members.length || ""}</span>
      </div>
      {isExpanded ? (
        <div className="metadata-component-list">
          {compQuery.isLoading ? <div className="metadata-muted">加载中…</div> : null}
          {filtered.map((component) => (
            <ComponentRow key={component.full_name} metadataType={item.xml_name} item={component} />
          ))}
          {!compQuery.isLoading && filtered.length === 0 ? <div className="metadata-muted">无匹配组件</div> : null}
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
