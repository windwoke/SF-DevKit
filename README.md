# SF DevKit

Salesforce 开发者桌面工具（Tauri + React + Rust）。

## 快速开始

1. 安装依赖
   - Node.js 20+
   - Rust stable
   - Salesforce CLI (`sf`)
2. 安装包

```bash
npm install
```

3. 启动开发

```bash
npm run tauri dev
```

## 已实现范围

- Phase 1 启动版：
  - Tauri 项目骨架
  - SQLite 初始化（`org_auth`）
  - CLI Runner
  - Org 管理 Commands（同步/切换/登出/登录）
  - 前端模块路由 + Org 管理基础页面

## 设计文档

- `SF-DevKit-Design.md`
- `IMPLEMENTATION-PLAN.md`
