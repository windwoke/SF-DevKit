# SF DevKit

[![SF DevKit 介绍](https://img.youtube.com/vi/bbsbVlp84l4/maxresdefault.jpg)](https://youtu.be/bbsbVlp84l4)

[⬇ Download](https://github.com/windwoke/SF-DevKit/releases/latest) — macOS (.dmg) & Linux (.AppImage)

A desktop toolkit for Salesforce developers. The app is built with **Tauri 2** (Rust backend + React + TypeScript frontend) and talks to your orgs via the **Salesforce CLI** (`sf`).

## Prerequisites

- **Node.js** 20+
- **Rust** (stable toolchain)
- **Salesforce CLI** (`sf`) installed and authenticated for the orgs you want to use

## Getting started

Install JavaScript dependencies:

```bash
npm install
```

Run the desktop app in development mode (starts Vite + Tauri):

```bash
npm run tauri dev
```

Other useful commands:

| Command | Description |
|--------|-------------|
| `npm run dev` | Web UI only (Vite), without Tauri shell |
| `npm run build` | Typecheck + production Vite bundle |
| `npm run tauri build` | Full desktop build |
| `npm test` | Run Vitest unit tests |

## Features

### Org management

- Sync orgs from the CLI, set a default org, log in / log out, and open an org in the browser.
- Org context is shared with the rest of the app (e.g. SOQL execution and schema-backed completion).

### SOQL editor

- **Monaco** editor with a custom SOQL language, tokenizer, and **context-aware completion** (objects, fields, relationships, subqueries, `WHERE` operators / picklist values where applicable).
- **Run query**: toolbar run button or **Cmd+Enter** (macOS) / **Ctrl+Enter** (Windows).
- **Format** SOQL: main clauses on separate lines; subqueries indented on their own lines.
- **Toolbar** (icons): format, copy query text, refresh schema cache, run.
- **Results**: summary strip, sortable table when records exist, raw JSON fallback; **Copy** as tab-separated text for **Excel**; **Export** via native save dialog (CSV when there is a table, JSON otherwise), with browser download fallback and short UI feedback on the buttons.

### Metadata browser

- Browse **metadata types** and **components** from the connected org; search and multi-select for retrieve.
- Edit or preview **`package.xml`** in Monaco (with diagnostics and completion when an org is selected).
- **Retrieve** to a chosen folder (extract or zip), stream CLI logs in the panel, cancel in flight, and reveal the output folder.

### Deployer

- **Deploy / Validate / Quick Deploy** to the target org with streaming CLI output.
- **Formatted result view**: success/failure banner with component count and duration; errors grouped by file with line:column.
- **Raw log toggle** to switch between formatted error view and full CLI output.
- **Two-column layout**: left side setup + streaming log, right side deploy history with prominent Target Org selector.
- **Confirmation dialog** before every deploy, validate, and quick deploy with deployment summary.
- **Target Org isolation**: deploy history and quick deploy records filtered by org.
- **Diff tool integration**: retrieve org metadata, compare with working directory in VS Code / Beyond Compare / custom diff tool.
- **Test class selection**: search test classes via `sf org list metadata` with 10-min SQLite cache; auto-scan local project for `@isTest` classes; filter toggle for test-only results.
- **Production guard**: prevents NoTestRun in production orgs.

### Log Viewer

- Lists recent **Apex debug logs** for the current org (refreshed on an interval); optional **user filter** on list and fetch.
- **Trace flags**: trace yourself, another user (search), or an **ApexClass** (search); choose log preset (standard / verbose) and trace duration (e.g. 30 minutes or 1 day); see active targets with countdown and stop controls.
- **Log detail**: download a log (output folder + optional **open in VS Code**), or download from the list row; downloaded files strip **ANSI** escape sequences for clean text.

### Apex Runner (coming soon)

- Run anonymous Apex with structured execution output. Code editing, execution logs, and reusable run history.

## Tech stack

- **UI**: React 18, Vite, Zustand, TanStack Query, Monaco Editor (`@monaco-editor/react`)
- **Desktop**: Tauri 2, `rfd` for export save dialogs
- **Backend**: Rust (`tokio`, `sqlx` + SQLite for local auth / cache state), Tauri commands for org sync, schema describe, SOQL execution, metadata list/retrieve, Apex logs and trace flags, etc.

## License

MIT
