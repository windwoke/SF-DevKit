# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```sh
npm run tauri dev     # Full desktop app (Vite + Tauri)
npm run dev           # Web-only Vite dev (no Tauri shell)
npm run build         # tsc typecheck + Vite production build
npm test              # Vitest unit tests (single test: npx vitest run src/modules/SoqlEditor/__tests__/contextParser.test.ts)
npm run tauri build   # Full desktop production build
```

## Tech Stack

- **Desktop shell**: Tauri 2 (Rust backend)
- **Frontend**: React 18, TypeScript, Vite, Zustand, TanStack Query, Monaco Editor
- **Backend (Rust)**: tokio, sqlx + SQLite, serde, reqwest, tauri-plugin-shell
- **i18n**: react-i18next with zh-CN / en-US
- **CLI bridge**: All Salesforce data flows through the `sf` CLI (shelled out from Rust via tokio::process::Command)

## Architecture

### Frontend — React SPA (`src/`)

```
src/
  main.tsx                   # Entry: QueryClientProvider + App
  App.tsx                    # Shell layout: TopBar + Sidebar + active module
  components/Layout/         # Sidebar, TopBar (app chrome)
  modules/                   # Feature modules, each a full-page view
    OrgManager/              # Org list, login/logout, set default
    SoqlEditor/              # SOQL editor with Monaco custom language, completion, results table
    MetadataBrowser/         # Metadata tree, package.xml editor, retrieve runner
    LogViewer/               # Apex log list, trace flags, log download
    ComingSoon/              # Placeholder for future modules (Apex Debug, Deployer)
  store/                     # Zustand stores
    ui.ts                    #   active module routing
    org.ts                   #   current org + org list
    soql.ts                  #   SOQL draft + history
    metadata.ts              #   metadata selection tree state
  i18n/                      # i18next setup + locale JSON files
  lib/                       # Utilities
    tauri.ts                 #   Typed Tauri invoke wrapper API
    locale.ts                #   Date locale helpers
    orgTypeLabel.ts          #   Org type display labels
```

State management split: **Zustand** for client-only UI state (active module, SOQL draft, metadata tree selection). **TanStack Query** for server/data-fetching state (org list, schema cache, logs, etc.) — query keys are invalidated after mutations.

### Backend — Rust Tauri commands (`src-tauri/src/`)

```
src-tauri/src/
  main.rs               # fn main -> calls lib::run()
  lib.rs                # Tauri builder setup, registers all ~30 invoke handlers
  cli/runner.rs         # Async sf/sfdx CLI process runner (tokio::process::Command, JSON mode)
  auth/manager.rs       # Org auth: sync/list/set-default/login-web/logout/open-org, linked project paths
  schema/cache.rs       # Schema cache: objects/fields/child-relationships/picklist values (SQLite + sf describe)
  commands/             # Thin Tauri command functions -> delegate to modules above
    org.rs, schema.rs, soql.rs, metadata.rs, log_viewer.rs, export.rs
  db/
    init.rs             # SQLite schema DDL + migrations (~12 tables)
    models.rs           # Shared Rust structs (OrgAuth, ObjectMeta, FieldMeta, ChildRelationship)
  metadata/
    service.rs          # Metadata type listing + component listing via sf CLI
    retrieve.rs         # Async retrieve runner with Tauri events for streaming CLI output
    package_xml.rs      # package.xml generator
    groups.rs           # Metadata type -> group mapping
  log_viewer/
    service.rs          # Apex log listing/download, trace flag management, user/class search
```

### Key design decisions

- **No direct API calls to Salesforce**. All org data (describe, query, metadata, logs) goes through `sf` CLI with `--json` flag. Rust parses JSON output.
- **SQLite cache**. Schema objects, fields, child relationships, picklist values, metadata types/components, retrieve history, trace targets are cached in SQLite per org. Cache TTL varies: 24h for schema/metadata types, 10 min for metadata components.
- **Tauri events for streaming**. The retrieve runner emits Tauri events (`start`, `stdout`, `stderr`, `exit`) so the frontend can show real-time CLI output.
- **Monaco custom SOQL language**. Registered programmatically (no language extension files) — custom tokenizer (Monarch), language configuration, and completion provider with context-aware parsing. Completion handles SELECT fields, FROM objects, relationship traversal, WHERE operators/values/picklists, subqueries, ORDER BY, TYPEOF, HAVING, GROUP BY, LIMIT/OFFSET.
- **Completion caching in frontend**. `soqlCompletion.ts` has its own in-memory cache with TTL (5-10 min) separate from TanStack Query, since completions fire on every keystroke.
- **i18n as default language**. The app defaults to `zh-CN` for users with Chinese system locale, `en-US` otherwise. `<select>` for language is in the sidebar settings panel. All user-facing strings come from `src/i18n/locales/`.

### Test files

- `src/modules/SoqlEditor/__tests__/contextParser.test.ts` — SOQL completion context parser tests
- `src/modules/SoqlEditor/soqlFormat.test.ts` — SOQL formatter tests

Tests use Vitest. Run with `npm test` or `npx vitest`.
