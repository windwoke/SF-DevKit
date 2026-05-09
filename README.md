# SF DevKit

[▶ Watch Demo](https://github.com/windwoke/SF-DevKit/releases/tag/v0.1.0-beta)

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

### Log Viewer

- Lists recent **Apex debug logs** for the current org (refreshed on an interval); optional **user filter** on list and fetch.
- **Trace flags**: trace yourself, another user (search), or an **ApexClass** (search); choose log preset (standard / verbose) and trace duration (e.g. 30 minutes or 1 day); see active targets with countdown and stop controls.
- **Log detail**: download a log (output folder + optional **open in VS Code**), or download from the list row; downloaded files strip **ANSI** escape sequences for clean text.

## Tech stack

- **UI**: React 18, Vite, Zustand, TanStack Query, Monaco Editor (`@monaco-editor/react`)
- **Desktop**: Tauri 2, `rfd` for export save dialogs
- **Backend**: Rust (`tokio`, `sqlx` + SQLite for local auth / cache state), Tauri commands for org sync, schema describe, SOQL execution, metadata list/retrieve, Apex logs and trace flags, etc.

## Design documents

- `SF-DevKit-Design.md` — product / architecture overview  
- `IMPLEMENTATION-PLAN.md` — phased delivery plan  
- `SOQL-Completion-Design.md` — SOQL completion context and rules  
- `Metadata-Browser-Design.md`, `PackageXml-Completion-Design.md` — metadata UI and `package.xml` completion  
- `LogViewer-Simple-Design.md` — Log Viewer behaviour and CLI integration notes

## License

Private project (`"private": true` in `package.json`). Adjust licensing here if you open-source the repository.
