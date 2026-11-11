import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { TraceTarget } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let useLogStore: typeof import("./store").useLogStore;

beforeAll(async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  ({ useLogStore } = await import("./store"));
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  vi.mocked(invoke).mockClear();
  useLogStore.setState({ targets: [], downloadConfig: { ...useLogStore.getInitialState().downloadConfig } });
});

describe("saved trace duration migration", () => {
  it.each([[30, 120], [1440, 1440]])("migrates %i minutes to %i while preserving other settings and running traces", async (previousMinutes, expectedMinutes) => {
    const active = target("existing", "2026-11-11T00:30:00Z");
    const config = { outputDir: "/saved/logs", autoOpenVscode: false, preset: "verbose", durationMinutes: previousMinutes };
    localStorage.setItem("log-viewer-store", JSON.stringify({
      state: { targets: [active], downloadConfig: config }, version: 0,
    }));

    await useLogStore.persist.rehydrate();

    expect(useLogStore.getState().downloadConfig).toEqual({ ...config, durationMinutes: expectedMinutes });
    expect(useLogStore.getState().targets).toEqual([active]);
    expect(JSON.parse(localStorage.getItem("log-viewer-store")!).version).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  useLogStore.setState({ targets: [] });
  vi.useRealTimers();
});

function target(id: string, expiresAt: string | null, orgId = "one@example.com"): TraceTarget {
  return { id, orgId, kind: "SELF", label: id, entityId: `entity-${id}`,
    traceFlagId: `flag-${id}`, expiresAt, isActive: true };
}

describe("trace expiration without automatic renewal", () => {
  it("clears expired and invalid persisted traces across orgs after waking, preserving valid traces", async () => {
    const valid = target("valid", "2026-11-12T00:00:00Z");
    const expired = target("expired", "2026-11-11T00:30:00Z");
    const otherOrg = target("other-org", "2026-11-11T01:00:00Z", "two@example.com");
    const invalid = target("invalid", "invalid-date");
    const missing = target("missing", null);
    localStorage.setItem("log-viewer-store", JSON.stringify({
      state: { targets: [valid, expired, otherOrg, invalid, missing] }, version: 0,
    }));
    await useLogStore.persist.rehydrate();
    const hydratedValid = useLogStore.getState().targets[0];
    const config = useLogStore.getState().downloadConfig;

    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    useLogStore.getState().expireTraceTargets();

    expect(useLogStore.getState().targets[0]).toBe(hydratedValid);
    expect(hydratedValid).toEqual(valid);
    expect(useLogStore.getState().targets.slice(1)).toEqual(
      [expired, otherOrg, invalid, missing].map((item) => ({
        ...item, isActive: false, traceFlagId: null, expiresAt: null,
      })),
    );
    expect(useLogStore.getState().downloadConfig).toBe(config);
    expect(JSON.parse(localStorage.getItem("log-viewer-store")!).state.targets[1].isActive).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the original expiry until it is reached and allows manually enabling the trace again", async () => {
    const active = target("self", "2026-11-11T00:30:00Z");
    useLogStore.setState({ targets: [active] });

    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    useLogStore.getState().expireTraceTargets();
    expect(useLogStore.getState().targets[0]).toBe(active);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    useLogStore.getState().expireTraceTargets();
    expect(useLogStore.getState().targets[0]).toMatchObject({ isActive: false, traceFlagId: null, expiresAt: null });

    useLogStore.getState().updateTarget(active.id, {
      isActive: true, traceFlagId: "manually-created-flag", expiresAt: "2026-11-11T01:00:00Z",
    });
    useLogStore.getState().expireTraceTargets();
    expect(useLogStore.getState().targets[0]).toMatchObject({ isActive: true, traceFlagId: "manually-created-flag" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
