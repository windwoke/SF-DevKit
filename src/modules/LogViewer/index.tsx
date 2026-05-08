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
  const [classInput, setClassInput] = useState("");
  const [classResults, setClassResults] = useState<ApexClassItem[]>([]);
  const [searchingClass, setSearchingClass] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: currentUser } = useQuery({
    queryKey: ["log-current-user", orgId],
    queryFn: () => invoke<SfUser>("get_current_user", { orgId }),
    enabled: Boolean(orgId),
  });

  const scopedTargets = useMemo(
    () => targets.filter((it) => (it.orgId ?? orgId) === orgId),
    [targets, orgId],
  );
  const selfTarget = scopedTargets.find((it) => it.kind === "SELF") ?? null;
  const selfActive = Boolean(selfTarget?.isActive);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (classSearchTimer.current) clearTimeout(classSearchTimer.current);
    },
    [],
  );

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

  const toggleSelfTrace = async () => {
    if (!orgId || !currentUser) return;
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
  };

  const searchUsers = (text: string) => {
    setUserSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!orgId || text.trim().length < 2) {
      setUsers([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchingUsers(true);
        const result = await invoke<SfUser[]>("search_users", { orgId, keyword: text.trim() });
        setUsers(result);
      } finally {
        setSearchingUsers(false);
      }
    }, 250);
  };

  const addUserTrace = async (user: SfUser) => {
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
  };

  const searchApexClass = (text: string) => {
    setClassInput(text);
    if (classSearchTimer.current) clearTimeout(classSearchTimer.current);
    if (!orgId || text.trim().length < 2) {
      setClassResults([]);
      return;
    }
    classSearchTimer.current = setTimeout(async () => {
      try {
        setSearchingClass(true);
        const result = await invoke<ApexClassItem[]>("search_apex_classes", {
          orgId,
          keyword: text.trim(),
        });
        setClassResults(result);
      } finally {
        setSearchingClass(false);
      }
    }, 250);
  };

  const addClassTrace = async () => {
    if (!orgId || !classInput.trim()) return;
    const className = classInput.trim();
    const classId = await invoke<string | null>("find_apex_class_id", {
      orgId,
      className,
    });
    if (!classId) {
      window.alert(`找不到 ApexClass: ${className}`);
      return;
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
  };

  const addClassTraceByItem = async (item: ApexClassItem) => {
    if (!orgId) return;
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
  };

  const stopTraceTarget = async (target: TraceTarget) => {
    if (!orgId) return;
    if (target.traceFlagId) {
      await invoke("disable_trace", { orgId, traceFlagId: target.traceFlagId });
    }
    stopRenewTimer(target.id);
    removeTarget(target.id);
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
          追踪自己
        </button>

        <div className="trace-user-search">
          <input
            value={userSearch}
            placeholder="按用户追踪…"
            onChange={(e) => searchUsers(e.target.value)}
            disabled={!orgId}
          />
          {users.length > 0 ? (
            <div className="trace-user-dropdown">
              {users.map((user) => (
                <button key={user.id} type="button" onClick={() => void addUserTrace(user)}>
                  <span>{user.name}</span>
                  <small>{user.username}</small>
                </button>
              ))}
            </div>
          ) : null}
          {searchingUsers ? <div className="trace-searching">搜索中…</div> : null}
        </div>

        <div className="trace-class-input">
          <div className="trace-class-search">
            <input
              value={classInput}
              placeholder="按 ApexClass 追踪…"
              onChange={(e) => searchApexClass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addClassTrace();
              }}
              disabled={!orgId}
            />
            {classResults.length > 0 ? (
              <div className="trace-user-dropdown">
                {classResults.map((item) => (
                  <button key={item.id} type="button" onClick={() => void addClassTraceByItem(item)}>
                    <span>{item.name}</span>
                    <small>{item.id}</small>
                  </button>
                ))}
              </div>
            ) : null}
            {searchingClass ? <div className="trace-searching">搜索中…</div> : null}
          </div>
          <button
            type="button"
            onClick={() => void addClassTrace()}
            disabled={!orgId || !classInput.trim()}
            title="按输入文本直接追踪（精确匹配）"
          >
            追踪
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
          disabled={!orgId || latestSelfDownload.isPending}
        >
          {latestSelfDownload.isPending ? "下载中…" : "下载我的最新日志"}
        </button>
      </div>

      {scopedTargets.length > 0 ? (
        <div className="trace-target-row">
          {scopedTargets.map((target) => (
            <TraceTag key={target.id} target={target} onStop={() => void stopTraceTarget(target)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TraceTag({ target, onStop }: { target: TraceTarget; onStop: () => void }) {
  const remainSec = target.expiresAt
    ? Math.max(0, Math.floor((new Date(target.expiresAt).getTime() - Date.now()) / 1000))
    : 0;
  const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
  const ss = String(remainSec % 60).padStart(2, "0");
  return (
    <span className="trace-tag">
      <strong>{target.label}</strong>
      {target.isActive ? <em>{mm}:{ss}</em> : null}
      <button type="button" onClick={onStop} aria-label={`停止追踪 ${target.label}`}>
        ×
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
