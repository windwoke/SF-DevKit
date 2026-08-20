import { useMutation } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { tauriApi } from "../../lib/tauri";
import { fullClassName } from "./filters";
import type { ApexTestClass, ApexTestRunResult } from "./types";

/**
 * Run + poll orchestration for the Apex Test Runner. Extracted from
 * index.tsx so the page component stays presentational:
 * - submit (`--wait 0`) → pending result with Test Run ID
 * - background polling via streamed Tauri events until completed
 * - manual "fetch latest result" escape hatch
 */
export function useApexTestRun(
  currentOrg: string | null,
  selectedClasses: ApexTestClass[],
  errors: { noOrg: string; noSelection: string },
) {
  const [runResult, setRunResult] = useState<ApexTestRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<Date | null>(null);
  /** Non-null while a submitted run is being polled in the background. */
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);

  const unlistenRef = useRef<null | (() => void)>(null);

  // Tear down the event listener on unmount; reset on org switch (a result
  // from another org is meaningless for the new target).
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  useEffect(() => {
    setRunResult(null);
    setRunError(null);
    setPollingRunId(null);
  }, [currentOrg]);

  // After submission succeeds with a pending run, start background polling
  // and listen for streamed events until completion.
  const startPolling = useCallback(async (orgId: string, testRunId: string) => {
    setPollingRunId(testRunId);
    const eventId = `apex-test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    unlistenRef.current?.();
    const unlisten = await listen<{
      event_type: "polling" | "completed" | "failed";
      data: string;
    }>(eventId, ({ payload }) => {
      if (payload.event_type === "completed") {
        try {
          setRunResult(JSON.parse(payload.data) as ApexTestRunResult);
        } catch {
          /* malformed event — next manual fetch will recover */
        }
        setPollingRunId(null);
      } else if (payload.event_type === "failed") {
        setRunError(payload.data);
        setPollingRunId(null);
      }
      // "polling" is a heartbeat only — nothing to display.
    });
    unlistenRef.current = unlisten;

    try {
      await tauriApi.pollApexTestResult({ orgId, testRunId, eventId });
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setPollingRunId(null);
    }
  }, []);

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error(errors.noOrg);
      if (selectedClasses.length === 0) throw new Error(errors.noSelection);
      const classNames = [
        ...new Set(
          selectedClasses.map((c) => fullClassName(c.namespace_prefix, c.name)),
        ),
      ];
      setRunStartedAt(new Date());
      setRunError(null);
      setRunResult(null);
      return tauriApi.runApexTests({ orgId: currentOrg, classNames });
    },
    onSuccess: (data) => {
      setRunError(null);
      setRunResult(data);
      if (data.status === "pending" && currentOrg) {
        // --wait 0: jobId already in hand — show it and poll in background.
        void startPolling(currentOrg, data.test_run_id);
      }
    },
    onError: (e) => {
      setRunError(e instanceof Error ? e.message : String(e));
    },
  });

  const fetchResultMutation = useMutation({
    mutationFn: async () => {
      const id = pollingRunId ?? runResult?.test_run_id;
      if (!currentOrg || !id) throw new Error("no pending run");
      return tauriApi.getApexTestResult({ orgId: currentOrg, testRunId: id });
    },
    onSuccess: (data) => {
      setRunError(null);
      setRunResult(data);
      if (data.status === "completed") setPollingRunId(null);
    },
    onError: (e) => {
      setRunError(e instanceof Error ? e.message : String(e));
    },
  });

  const submitting = runMutation.isPending;
  const pending = runResult?.status === "pending";
  const waiting = pending || (pollingRunId !== null && !!runResult);
  const busy = submitting || fetchResultMutation.isPending;

  return {
    runResult,
    runError,
    runStartedAt,
    pollingRunId,
    submitting,
    waiting,
    busy,
    runMutation,
    fetchResultMutation,
  };
}

/** Shared toggle helper for expandable row sets (results + coverage). */
export function useToggleSet() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return { expanded, toggle };
}
