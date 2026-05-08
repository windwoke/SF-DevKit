import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { downloadDir, join } from "@tauri-apps/api/path";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrgStore } from "../../store/org";
import { type TraceTarget, useLogStore } from "./store";

interface ApexLog {
  id: string;
  application: string;
  duration_millis: number;
  location: string;
  log_user_name: string;
  operation: string;
  request: string;
  size: number;
  start_time: string;
  status: string;
}

interface SfUser {
  id: string;
  name: string;
  username: string;
}

interface ApexClassItem {
  id: string;
  name: string;
  last_modified_date?: string | null;
  last_modified_by_name?: string | null;
}

interface ActiveTrace {
  trace_flag_id: string;
  expires_at: string;
}

export function LogViewer() {
  const { currentOrg } = useOrgStore();
  const { userFilter, selectedLogId, setSelectedLogId, downloadConfig, setDownloadConfig } = useLogStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    if (downloadConfig.outputDir) return;
    (async () => {
      try {
        const base = await downloadDir();
        const output = await join(base, "sf-logs");
        if (!cancelled) setDownloadConfig({ outputDir: output });
      } catch {
        // fallback to manual picker
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [downloadConfig.outputDir, setDownloadConfig]);

  const { data: logs = [], isFetching } = useQuery({
    queryKey: ["apex-logs", currentOrg, userFilter],
    queryFn: () =>
      invoke<ApexLog[]>("list_apex_logs", {
        orgId: currentOrg,
        limit: 50,
        userFilter: userFilter.trim() ? userFilter.trim() : null,
      }),
    enabled: Boolean(currentOrg),
    refetchInterval: 10_000,
  });

  const selectedLog = useMemo(
    () => logs.find((log) => log.id === selectedLogId) ?? null,
    [logs, selectedLogId],
  );

  return (
    <section className="module log-viewer-module">
      <div className="module-header log-viewer-header">
        <h2>Log Viewer</h2>
        {!currentOrg ? <span className="soql-hint">未选择 Org，请先在 Org 管理中设置默认。</span> : null}
      </div>

      <TraceBar
        orgId={currentOrg}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["apex-logs"] })}
      />

      <div className="log-viewer-layout">
        <LogList logs={logs} isFetching={isFetching} selectedId={selectedLogId} onSelect={setSelectedLogId} />
        <LogDetail log={selectedLog} orgId={currentOrg} />
      </div>
    </section>
  );
}

function TraceBar({ orgId, onRefresh }: { orgId: string | null; onRefresh: () => void }) {
  const {
    targets,
    addTarget,
    updateTarget,
    removeTarget,
    startRenewTimer,
    stopRenewTimer,
    ensureRenewTimers,
    downloadConfig,
    setDownloadConfig,
  } = useLogStore();
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<SfUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userInputFocused, setUserInputFocused] = useState(false);
  const [userActiveIndex, setUserActiveIndex] = useState(-1);
  const [classInput, setClassInput] = useState("");
  const [classResults, setClassResults] = useState<ApexClassItem[]>([]);
  const [searchingClass, setSearchingClass] = useState(false);
  const [classInputFocused, setClassInputFocused] = useState(false);
  const [classActiveIndex, setClassActiveIndex] = useState(-1);
  const [traceBusyKey, setTraceBusyKey] = useState<string | null>(null);
  const [traceFeedback, setTraceFeedback] = useState<string>("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSearchCache = useRef<Map<string, SfUser[]>>(new Map());
  const apexClassSearchCache = useRef<Map<string, ApexClassItem[]>>(new Map());

  const { data: currentUser } = useQuery({
    queryKey: ["log-current-user", orgId],
    queryFn: () => invoke<SfUser>("get_current_user", { orgId }),
    enabled: Boolean(orgId),
  });

  const scopedTargets = useMemo(
    () => targets.filter((it) => (it.orgId ?? orgId) === orgId),
    [targets, orgId],
  );
  const orderedTargets = useMemo(() => {
    const rank: Record<TraceTarget["kind"], number> = {
      SELF: 0,
      USER: 1,
      APEX_CLASS: 2,
    };
    return scopedTargets
      .map((target, idx) => ({ target, idx }))
      .sort((a, b) => rank[a.target.kind] - rank[b.target.kind] || a.idx - b.idx)
      .map((it) => it.target);
  }, [scopedTargets]);
  const selfTarget = scopedTargets.find((it) => it.kind === "SELF") ?? null;
  const selfActive = Boolean(selfTarget?.isActive);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (classSearchTimer.current) clearTimeout(classSearchTimer.current);
      if (userBlurTimer.current) clearTimeout(userBlurTimer.current);
      if (classBlurTimer.current) clearTimeout(classBlurTimer.current);
    },
    [],
  );

  useEffect(() => {
    userSearchCache.current.clear();
    apexClassSearchCache.current.clear();
    setUsers([]);
    setClassResults([]);
    setUserActiveIndex(-1);
    setClassActiveIndex(-1);
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    ensureRenewTimers(orgId);
  }, [orgId, scopedTargets, ensureRenewTimers]);

  const enableTraceFor = async (
    target: Omit<TraceTarget, "traceFlagId" | "expiresAt" | "isActive">,
    logType: "USER_DEBUG" | "CLASS_TRACING",
  ) => {
    if (!orgId) return;
    const debugLevelId = await invoke<string>("ensure_debug_level", {
      orgId,
      preset: downloadConfig.preset,
    });
    const active = await invoke<ActiveTrace>("enable_trace", {
      orgId,
      entityId: target.entityId,
      logType,
      debugLevelId,
      durationMinutes: downloadConfig.durationMinutes,
    });
    addTarget(target);
    updateTarget(target.id, {
      traceFlagId: active.trace_flag_id,
      expiresAt: active.expires_at,
      isActive: true,
    });
    startRenewTimer(orgId, target.id);
    onRefresh();
  };

  const runTraceAction = async (busyKey: string, action: () => Promise<void>) => {
    setTraceBusyKey(busyKey);
    setTraceFeedback("处理中，请稍候…");
    try {
      await action();
      setTraceFeedback("");
    } catch (e) {
      setTraceFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setTraceBusyKey(null);
    }
  };

  const toggleSelfTrace = async () => {
    if (!orgId || !currentUser) return;
    await runTraceAction("self", async () => {
      if (selfTarget?.traceFlagId) {
        await invoke("disable_trace", { orgId, traceFlagId: selfTarget.traceFlagId });
        stopRenewTimer(selfTarget.id);
        removeTarget(selfTarget.id);
        return;
      }
      const id = selfTarget?.id ?? crypto.randomUUID();
      await enableTraceFor(
        {
          id,
          orgId,
          kind: "SELF",
          label: currentUser.username,
          entityId: currentUser.id,
        },
        "USER_DEBUG",
      );
    });
  };

  const searchUsers = (text: string) => {
    setUserSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const keyword = text.trim().toLowerCase();
    const loadDefault = keyword.length === 0;
    if (!orgId) {
      setUsers([]);
      setUserActiveIndex(-1);
      return;
    }
    if (!loadDefault && keyword.length < 2) {
      setUsers([]);
      setUserActiveIndex(-1);
      return;
    }
    const cacheKey = loadDefault ? "__default__" : keyword;
    const cached = userSearchCache.current.get(cacheKey);
    if (cached) {
      setUsers(cached);
      setUserActiveIndex(cached.length > 0 ? 0 : -1);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchingUsers(true);
        const result = await invoke<SfUser[]>("search_users", { orgId, keyword: loadDefault ? "" : keyword });
        userSearchCache.current.set(cacheKey, result);
        setUsers(result);
        setUserActiveIndex(result.length > 0 ? 0 : -1);
      } finally {
        setSearchingUsers(false);
      }
    }, 380);
  };

  const handleUserFocus = () => {
    if (userBlurTimer.current) clearTimeout(userBlurTimer.current);
    setUserInputFocused(true);
    if (users.length === 0 && !searchingUsers) {
      searchUsers(userSearch);
    }
  };

  const handleUserBlur = () => {
    userBlurTimer.current = setTimeout(() => setUserInputFocused(false), 120);
  };

  const addUserTrace = async (user: SfUser) => {
    setUserInputFocused(false);
    setUserActiveIndex(-1);
    await runTraceAction(`user:${user.id}`, async () => {
      await enableTraceFor(
        {
          id: crypto.randomUUID(),
          orgId,
          kind: "USER",
          label: user.username,
          entityId: user.id,
        },
        "USER_DEBUG",
      );
      setUserSearch("");
      setUsers([]);
      setUserActiveIndex(-1);
    });
  };

  const handleUserKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!orgId) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setUserInputFocused(false);
      setUserActiveIndex(-1);
      return;
    }
    if (users.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setUserActiveIndex((prev) => (prev + 1) % users.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setUserActiveIndex((prev) => (prev <= 0 ? users.length - 1 : prev - 1));
      return;
    }
    if (e.key === "Enter") {
      const picked = users[userActiveIndex] ?? users[0];
      if (!picked) return;
      e.preventDefault();
      void addUserTrace(picked);
    }
  };

  const searchApexClass = (text: string) => {
    setClassInput(text);
    if (classSearchTimer.current) clearTimeout(classSearchTimer.current);
    const keyword = text.trim().toLowerCase();
    const loadDefault = keyword.length === 0;
    if (!orgId) {
      setClassResults([]);
      setClassActiveIndex(-1);
      return;
    }
    if (!loadDefault && keyword.length < 2) {
      setClassResults([]);
      setClassActiveIndex(-1);
      return;
    }
    const cacheKey = loadDefault ? "__default__" : keyword;
    const cached = apexClassSearchCache.current.get(cacheKey);
    if (cached) {
      setClassResults(cached);
      setClassActiveIndex(cached.length > 0 ? 0 : -1);
      return;
    }
    classSearchTimer.current = setTimeout(async () => {
      try {
        setSearchingClass(true);
        const result = await invoke<ApexClassItem[]>("search_apex_classes", {
          orgId,
          keyword: loadDefault ? "" : keyword,
        });
        apexClassSearchCache.current.set(cacheKey, result);
        setClassResults(result);
        setClassActiveIndex(result.length > 0 ? 0 : -1);
      } finally {
        setSearchingClass(false);
      }
    }, 380);
  };

  const handleClassFocus = () => {
    if (classBlurTimer.current) clearTimeout(classBlurTimer.current);
    setClassInputFocused(true);
    if (classResults.length === 0 && !searchingClass) {
      searchApexClass(classInput);
    }
  };

  const handleClassBlur = () => {
    classBlurTimer.current = setTimeout(() => setClassInputFocused(false), 120);
  };

  const addClassTrace = async () => {
    if (!orgId || !classInput.trim()) return;
    const className = classInput.trim();
    await runTraceAction("class:manual", async () => {
      const classId = await invoke<string | null>("find_apex_class_id", {
        orgId,
        className,
      });
      if (!classId) {
        throw new Error(`找不到 ApexClass: ${className}`);
      }
      await enableTraceFor(
        {
          id: crypto.randomUUID(),
          orgId,
          kind: "APEX_CLASS",
          label: className,
          entityId: classId,
        },
        "CLASS_TRACING",
      );
      setClassInput("");
      setClassResults([]);
      setClassActiveIndex(-1);
    });
  };

  const addClassTraceByItem = async (item: ApexClassItem) => {
    if (!orgId) return;
    setClassInputFocused(false);
    setClassActiveIndex(-1);
    await runTraceAction(`class:${item.id}`, async () => {
      await enableTraceFor(
        {
          id: crypto.randomUUID(),
          orgId,
          kind: "APEX_CLASS",
          label: item.name,
          entityId: item.id,
        },
        "CLASS_TRACING",
      );
      setClassInput("");
      setClassResults([]);
      setClassActiveIndex(-1);
    });
  };

  const handleClassKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!orgId) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setClassInputFocused(false);
      setClassActiveIndex(-1);
      return;
    }
    if (classResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setClassActiveIndex((prev) => (prev + 1) % classResults.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setClassActiveIndex((prev) => (prev <= 0 ? classResults.length - 1 : prev - 1));
        return;
      }
      if (e.key === "Enter") {
        const picked = classResults[classActiveIndex] ?? classResults[0];
        if (!picked) return;
        e.preventDefault();
        void addClassTraceByItem(picked);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void addClassTrace();
    }
  };

  const stopTraceTarget = async (target: TraceTarget) => {
    if (!orgId) return;
    await runTraceAction(`stop:${target.id}`, async () => {
      if (target.traceFlagId) {
        try {
          await invoke("disable_trace", { orgId, traceFlagId: target.traceFlagId });
        } catch {
          // Remote trace may already expire/deleted; always clear local state.
        }
      }
      stopRenewTimer(target.id);
      removeTarget(target.id);
    });
  };

  const latestSelfDownload = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("请先选择 Org");
      const path = await invoke<string | null>("download_latest_self_log", {
        orgId,
        currentUserName: currentUser?.username ?? "",
        outputDir: downloadConfig.outputDir,
      });
      if (!path) throw new Error("未找到可下载的日志");
      if (downloadConfig.autoOpenVscode) {
        await invoke("open_in_vscode", { filePath: path });
      } else {
        await invoke("reveal_log_file", { filePath: path });
      }
    },
    onSuccess: onRefresh,
  });

  return (
    <div className="log-trace-bar">
      <div className="log-trace-main-row">
        <button type="button" className={selfActive ? "trace-btn active" : "trace-btn"} onClick={() => void toggleSelfTrace()} disabled={!orgId || !currentUser}>
          <span className="trace-dot" />
          {traceBusyKey === "self" ? "处理中…" : "追踪自己"}
        </button>

        <div className="trace-user-search">
          <input
            value={userSearch}
            placeholder="按用户追踪…"
            onChange={(e) => searchUsers(e.target.value)}
            onFocus={handleUserFocus}
            onBlur={handleUserBlur}
            onKeyDown={handleUserKeyDown}
            disabled={!orgId}
          />
          {orgId && userInputFocused ? (
            <div className="trace-user-dropdown" onMouseDown={(e) => e.preventDefault()}>
              {searchingUsers ? (
                <div className="trace-dropdown-state">搜索中…</div>
              ) : users.length > 0 ? (
                users.map((user, idx) => (
                  <button
                    key={user.id}
                    type="button"
                    className={idx === userActiveIndex ? "active" : undefined}
                    onMouseEnter={() => setUserActiveIndex(idx)}
                    disabled={Boolean(traceBusyKey)}
                    onClick={() => void addUserTrace(user)}
                  >
                    <span>{user.name}</span>
                    <small>{user.username}</small>
                  </button>
                ))
              ) : userSearch.trim().length === 0 ? (
                <div className="trace-dropdown-state">暂无可选用户</div>
              ) : userSearch.trim().length < 2 ? (
                <div className="trace-dropdown-state">输入至少 2 个字符搜索用户</div>
              ) : (
                <div className="trace-dropdown-state">未找到匹配用户</div>
              )}
            </div>
          ) : null}
        </div>

        <div className="trace-class-input">
          <div className="trace-class-search">
            <input
              value={classInput}
              placeholder="按 ApexClass 追踪…"
              onChange={(e) => searchApexClass(e.target.value)}
              onFocus={handleClassFocus}
              onBlur={handleClassBlur}
              onKeyDown={handleClassKeyDown}
              disabled={!orgId}
            />
            {orgId && classInputFocused ? (
              <div className="trace-user-dropdown" onMouseDown={(e) => e.preventDefault()}>
                {searchingClass ? (
                  <div className="trace-dropdown-state">搜索中…</div>
                ) : classResults.length > 0 ? (
                  classResults.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      className={idx === classActiveIndex ? "active" : undefined}
                      onMouseEnter={() => setClassActiveIndex(idx)}
                      disabled={Boolean(traceBusyKey)}
                      onClick={() => void addClassTraceByItem(item)}
                    >
                      <span>{item.name}</span>
                      <small>{formatClassMeta(item)}</small>
                    </button>
                  ))
                ) : classInput.trim().length === 0 ? (
                  <div className="trace-dropdown-state">暂无可选 ApexClass</div>
                ) : classInput.trim().length < 2 ? (
                  <div className="trace-dropdown-state">输入至少 2 个字符搜索 ApexClass</div>
                ) : (
                  <div className="trace-dropdown-state">未找到匹配 ApexClass</div>
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void addClassTrace()}
            disabled={!orgId || !classInput.trim() || Boolean(traceBusyKey)}
            title="按输入文本直接追踪（精确匹配）"
          >
            {traceBusyKey === "class:manual" ? "处理中…" : "追踪"}
          </button>
        </div>

        <select
          value={downloadConfig.preset}
          onChange={(e) => setDownloadConfig({ preset: e.target.value as "standard" | "verbose" })}
        >
          <option value="standard">标准日志</option>
          <option value="verbose">详细日志</option>
        </select>

        <select
          value={downloadConfig.durationMinutes}
          onChange={(e) => setDownloadConfig({ durationMinutes: Number(e.target.value) })}
          title="追踪时长"
        >
          <option value={30}>追踪 30 分钟</option>
          <option value={1440}>追踪 1 天</option>
        </select>

        <button
          type="button"
          onClick={() => latestSelfDownload.mutate()}
          disabled={!orgId || latestSelfDownload.isPending || Boolean(traceBusyKey)}
        >
          {latestSelfDownload.isPending ? "下载中…" : "下载我的最新日志"}
        </button>
      </div>

      {traceFeedback ? <div className="trace-feedback">{traceFeedback}</div> : null}

      {orderedTargets.length > 0 ? (
        <div className="trace-target-row">
          {orderedTargets.map((target) => (
            <TraceTag
              key={target.id}
              target={target}
              busy={traceBusyKey === `stop:${target.id}`}
              onStop={() => void stopTraceTarget(target)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TraceTag({ target, onStop, busy }: { target: TraceTarget; onStop: () => void; busy: boolean }) {
  const remainSec = target.expiresAt
    ? Math.max(0, Math.floor((new Date(target.expiresAt).getTime() - Date.now()) / 1000))
    : 0;
  const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
  const ss = String(remainSec % 60).padStart(2, "0");
  const kindClass =
    target.kind === "APEX_CLASS" ? "trace-tag-apex" : target.kind === "USER" ? "trace-tag-user" : "trace-tag-self";

  return (
    <span className={`trace-tag ${kindClass}`}>
      <strong>{target.label}</strong>
      {target.isActive ? <em>{mm}:{ss}</em> : null}
      <button type="button" onClick={onStop} aria-label={`停止追踪 ${target.label}`}>
        {busy ? "…" : "×"}
      </button>
    </span>
  );
}

function LogList({
  logs,
  isFetching,
  selectedId,
  onSelect,
}: {
  logs: ApexLog[];
  isFetching: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { currentOrg } = useOrgStore();
  const { userFilter, setUserFilter, downloadConfig } = useLogStore();
  const [downloading, setDownloading] = useState<string | null>(null);

  const downloadOne = async (log: ApexLog) => {
    if (!currentOrg) return;
    setDownloading(log.id);
    try {
      const fileName = buildFileName(log);
      const filePath = await invoke<string>("download_apex_log", {
        orgId: currentOrg,
        logId: log.id,
        outputDir: downloadConfig.outputDir,
        fileName,
      });
      if (downloadConfig.autoOpenVscode) {
        await invoke("open_in_vscode", { filePath });
      } else {
        await invoke("reveal_log_file", { filePath });
      }
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="log-list">
      <div className="log-list-filter">
        <input
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          placeholder="过滤用户 / 操作…"
        />
      </div>
      <div className="log-list-table-head">
        <span>用户 / 操作</span>
        <span>大小</span>
        <span>时间</span>
        <span />
      </div>
      <div className="log-list-body">
        {logs.map((log) => (
          <div
            key={log.id}
            className={log.id === selectedId ? "log-row selected" : "log-row"}
            onClick={() => onSelect(log.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(log.id);
            }}
          >
            <div className="log-row-main">
              <span>{log.log_user_name.split("@")[0]}</span>
              <small>{log.operation || "-"}</small>
            </div>
            <span>{formatSize(log.size)}</span>
            <span>{toHHmm(log.start_time)}</span>
            <span>
              <button
                type="button"
                className="log-download-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadOne(log);
                }}
                disabled={downloading === log.id}
              >
                {downloading === log.id ? "…" : "↓"}
              </button>
            </span>
          </div>
        ))}
        {!isFetching && logs.length === 0 ? <div className="empty-state">暂无日志</div> : null}
      </div>
    </div>
  );
}

function LogDetail({ log, orgId }: { log: ApexLog | null; orgId: string | null }) {
  const { downloadConfig, setDownloadConfig } = useLogStore();
  const [error, setError] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const downloadMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !log) throw new Error("未选择日志");
      const filePath = await invoke<string>("download_apex_log", {
        orgId,
        logId: log.id,
        outputDir: downloadConfig.outputDir,
        fileName: buildFileName(log),
      });
      setLastPath(filePath);
      if (downloadConfig.autoOpenVscode) {
        await invoke("open_in_vscode", { filePath });
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const pickOutputDir = async () => {
    const selected = await invoke<string | null>("pick_log_output_directory");
    if (selected) setDownloadConfig({ outputDir: selected });
  };

  if (!log) {
    return (
      <aside className="log-detail">
        <div className="empty-state">选择一条日志后显示详情。</div>
      </aside>
    );
  }

  return (
    <aside className="log-detail">
      <h3>日志详情</h3>
      <dl>
        <dt>用户</dt>
        <dd>{log.log_user_name}</dd>
        <dt>时间</dt>
        <dd>{new Date(log.start_time).toLocaleString("zh-CN")}</dd>
        <dt>大小</dt>
        <dd>{formatSize(log.size)}</dd>
        <dt>操作</dt>
        <dd>{log.operation || "-"}</dd>
        <dt>请求</dt>
        <dd>{log.request || "-"}</dd>
        <dt>耗时</dt>
        <dd>{log.duration_millis.toLocaleString()} ms</dd>
        <dt>状态</dt>
        <dd>{log.status || "-"}</dd>
      </dl>

      <div className="log-detail-actions">
        <button type="button" onClick={() => downloadMutation.mutate()} disabled={downloadMutation.isPending}>
          {downloadMutation.isPending ? "下载中…" : "下载日志"}
        </button>
        <button
          type="button"
          onClick={() => lastPath && invoke("open_in_vscode", { filePath: lastPath })}
          disabled={!lastPath}
        >
          VSCode 打开
        </button>
      </div>

      <div className="log-download-settings">
        <h4>下载设置</h4>
        <button type="button" onClick={() => void pickOutputDir()}>
          {downloadConfig.outputDir ? `目录: ${downloadConfig.outputDir}` : "选择下载目录"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={downloadConfig.autoOpenVscode}
            onChange={(e) => setDownloadConfig({ autoOpenVscode: e.target.checked })}
          />
          下载后自动在 VSCode 打开
        </label>
      </div>

      {error ? (
        <div className="notice-banner notice-banner-error">
          {error}
          {lastPath ? (
            <button type="button" onClick={() => invoke("reveal_log_file", { filePath: lastPath })}>
              在 Finder 中显示文件
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function buildFileName(log: ApexLog): string {
  const date = new Date(log.start_time).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const user = log.log_user_name.split("@")[0] || "unknown";
  return `${user}_${log.id.slice(0, 8)}_${date}.log`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function toHHmm(dateText: string): string {
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatClassMeta(item: ApexClassItem): string {
  const who = item.last_modified_by_name?.trim() || "未知修改人";
  const raw = item.last_modified_date;
  if (!raw) return `最近修改: -- · ${who}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return `最近修改: -- · ${who}`;
  return `最近修改: ${d.toLocaleString("zh-CN")} · ${who}`;
}
