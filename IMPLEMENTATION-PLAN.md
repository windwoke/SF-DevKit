# SF DevKit 实施计划（启动版）

## 当前状态

- 已根据 `SF-DevKit-Design.md` 建立 Tauri + React + SQLite 工程骨架。
- 已实现 Phase 1 的核心链路：Org 同步、设置默认 Org、登出、Web 登录入口。
- 已实现前端模块路由和 Org 管理基础 UI。

## 本轮完成（2026-05-06）

1. 工程初始化
   - 创建 `src-tauri` Rust 后端结构。
   - 创建 `src` React 前端结构。
2. 后端核心
   - `db/init.rs`：SQLite 初始化与 `org_auth` 建表。
   - `cli/runner.rs`：`sf/sfdx` 命令执行器。
   - `auth/manager.rs`：Org 同步/切换/登出/登录逻辑。
   - `commands/org.rs`：Tauri commands 暴露。
3. 前端核心
   - `App.tsx` + `Sidebar` + `TopBar`：基础布局与模块路由。
   - `OrgManager/OrgList.tsx`：Org 列表与操作按钮。
   - Zustand + React Query 状态管理接入。

## 下一步（优先级）

1. 增补 DB 表
   - 增加 `schema_objects`、`schema_fields`、`query_history`、`metadata_index`、`app_settings`。
2. 可靠性增强
   - 命令错误映射（区分 CLI 不存在、认证失败、网络失败）。
   - Org 切换后的全局事件通知。
3. UI 增强
   - 登录对话框、空状态、错误提示标准化。
   - 顶部 Org Selector（全局切换）。
4. Phase 2 预备
   - 增加 Schema Cache 服务接口与命令。
