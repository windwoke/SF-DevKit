import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import en from "../../../i18n/locales/en-US.json";
import zh from "../../../i18n/locales/zh-CN.json";
import type { EnvironmentReport } from "../../../lib/tauri";
import { EnvironmentCard } from "../EnvironmentCard";

function renderReport(report: EnvironmentReport, language: "en-US" | "zh-CN" = "en-US") {
  const client = new QueryClient();
  client.setQueryData(["environment"], report);
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    initAsync: false,
    resources: { "en-US": { translation: en }, "zh-CN": { translation: zh } },
  });
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}><EnvironmentCard /></QueryClientProvider>
    </I18nextProvider>,
  );
  client.clear();
  return html;
}

const ready: EnvironmentReport = {
  checked_at: "2026-10-19T03:00:00Z",
  search_path: "/custom/node/bin:/usr/bin",
  checks: [
    { id: "node", status: "ok", version: "v24.18.0", path: "/custom/node/bin/node", issue: null, detail: null },
    { id: "salesforceCli", status: "ok", version: "@salesforce/cli/2.0.0", path: "/custom/node/bin/sf", issue: null, detail: null },
    { id: "storage", status: "ok", version: null, path: "/data/SF DevKit", issue: null, detail: null },
  ],
};

describe("environment check presentation", () => {
  it("shows readiness, actual versions, executable paths and recheck", () => {
    const html = renderReport(ready);
    expect(html).toContain("Prerequisites are ready");
    expect(html).toContain("v24.18.0");
    expect(html).toContain("/custom/node/bin/node");
    expect(html).toContain("Recheck");
  });

  it("shows runtime failures and installation guidance in Chinese", () => {
    const html = renderReport({ ...ready, checks: [
      { ...ready.checks[0], status: "error", issue: "missing", path: null, version: null },
      { ...ready.checks[1], status: "error", issue: "launchFailed", detail: "env: node: No such file or directory" },
    ] }, "zh-CN");
    expect(html).toContain("有 2 项前置条件需要处理");
    expect(html).toContain("获取 Node.js");
    expect(html).toContain("env: node: No such file or directory");
    expect(html).not.toContain("基本前置环境已就绪");
  });

  it("does not block a working standalone CLI when external Node is unavailable", () => {
    const html = renderReport({ ...ready, checks: [
      { ...ready.checks[0], status: "warning", issue: "cliAvailable", path: null, version: null },
      ready.checks[1], ready.checks[2],
    ] });
    expect(html).toContain("CLI is ready · review Node setup");
    expect(html).not.toContain("prerequisite needs attention");
  });
});
