# SF DevKit 浅色模式规范与 Agent 交接

状态：v1，已确认，可进入全模块迁移  
确认日期：2026-07-22  
参考实现：`codex/light-theme-sample` 分支的 SOQL 页面

## 1. 目标与范围

SF DevKit 的浅色模式应保持桌面开发工具的高信息密度和清晰层级，不采用营销页式的大面积留白、玻璃拟态或装饰性渐变。

本规范确定以下内容：

- 浅色模式的基础颜色、语义颜色和表面层级。
- 应用外壳、表单、按钮、表格、编辑器、日志和状态反馈的用色规则。
- 主题切换、持久化和 Monaco 联动方式。
- 其余模块的迁移顺序、Agent 边界和验收标准。

当前参考实现只覆盖应用外壳和 SOQL 页面。其他模块仍包含深色硬编码，不应被视为已适配。

## 2. 设计原则

### 2.1 视觉方向

- 基调：冷中性灰，不使用暖米色或纯白铺满整个窗口。
- 强调色：全局只使用一套蓝色强调体系。
- 信息层级：优先依靠背景层级、文字颜色和 1px 边框，不依赖大阴影。
- 状态色：绿色仅表示成功或可执行动作，红色仅表示错误或危险动作。
- 密度：保持现有控件尺寸和页面结构，不因浅色模式增加大面积空白。
- 字体：继续使用 Geist Sans；代码、ID、路径和数值继续使用等宽字体。

### 2.2 形状与材质

- 普通控件圆角：8px。
- 页面容器圆角：8-10px。
- 浮层圆角：12px。
- 胶囊圆角只用于标签，不用于普通按钮。
- 阴影只用于设置面板、弹窗等浮层；普通页面卡片使用边框或背景层级。
- 不使用外发光、霓虹渐变、玻璃拟态或纯黑阴影。

## 3. 主题机制

### 3.1 状态与挂载点

- 主题类型：`"dark" | "light"`。
- Zustand 字段：`settings-store.themeMode`。
- DOM 挂载点：`document.documentElement.dataset.theme`。
- 同步设置 `document.documentElement.style.colorScheme`，保证原生表单和滚动条与主题一致。
- 使用 `useLayoutEffect` 应用主题，减少首次渲染闪烁。
- 主题选择必须持久化，刷新后保持用户选择。

暂不实现 `system` 模式。若后续增加，必须明确系统主题变化时的监听和手动选择优先级。

### 3.2 语义令牌

组件只能消费语义令牌，不应直接根据 `themeMode` 选择颜色。浅色模式当前基线如下：

| 令牌 | 浅色值 | 用途 |
| --- | --- | --- |
| `--canvas` | `#F3F5F8` | 应用主画布 |
| `--surface-1` | `#FFFFFF` | 一级工作面、浮层、普通按钮 |
| `--surface-2` | `#F8FAFC` | 工具条、次级容器、隔行底色 |
| `--surface-3` | `#EEF2F7` | hover、三级表面 |
| `--border` | `#D7DEE8` | 容器和分区边框 |
| `--border-input` | `#C6D0DD` | 输入框和交互控件边框 |
| `--bg-input` | `#FFFFFF` | 输入框背景，迁移期兼容令牌 |
| `--bg-surface` | `#F7F9FC` | 次级背景，迁移期兼容令牌 |
| `--text-primary` | `#172033` | 标题、正文和关键数据 |
| `--text-secondary` | `#47566D` | 次级正文、按钮文字 |
| `--text-muted` | `#68758C` | 辅助信息、占位提示、小字 |
| `--accent` | `#2563EB` | focus ring、选中边框 |
| `--accent-soft` | `#EAF1FF` | 选中背景、蓝色弱提示 |
| `--accent-text` | `#174EA6` | 浅蓝背景上的文字和图标 |
| `--success` | `#167453` | 成功边框、强调 |
| `--success-soft` | `#E8F6EF` | 成功或执行动作背景 |
| `--success-text` | `#0E6245` | 成功背景上的文字和图标 |
| `--danger` | `#C7424F` | 错误边框、危险强调 |
| `--danger-soft` | `#FFF0F1` | 错误或危险背景 |
| `--danger-text` | `#A52C3A` | 错误背景上的文字和图标 |

`--text-primary`、`--text-secondary` 和修正后的 `--text-muted` 在白色表面上的对比度分别约为 16.27:1、7.45:1 和 4.65:1。

### 3.3 兼容令牌处理

`--bg-input` 和 `--bg-surface` 是当前代码已有命名。迁移期间保留，避免一次性修改过大；全部模块完成后，由集成人决定是否统一重命名为 `--surface-*`，不要由单个模块 Agent 私自删除。

## 4. 组件规范

### 4.1 应用外壳

- TopBar 使用 `--surface-1`，底部 1px `--border`。
- Sidebar 使用比画布略深的冷灰背景，普通图标无独立卡片底色。
- 当前导航项使用 `--accent-soft`、`--accent-text` 和浅蓝边框。
- 主内容区域使用 `--canvas`。
- 细颗粒纹理允许保留，但浅色模式透明度不得高于当前样例的 `0.012`。

### 4.2 按钮与表单

- 普通按钮：白色表面、输入边框、次级文字。
- hover：`--surface-3` 或 `--surface-2`，同时提高边框和文字对比度。
- active：保留现有轻微按压反馈。
- focus：统一使用 2px `--accent` 外轮廓，不能只靠颜色变化。
- disabled：保留结构和边框，通过透明度弱化；文字仍应可辨识。
- 输入框标签必须独立存在，placeholder 不代替标签。

### 4.3 页面容器

- 一级工作区域使用白色或 `--surface-1`。
- 工具条、筛选区和次级面板使用 `--surface-2`。
- hover 或临时选中使用 `--surface-3` 或 `--accent-soft`。
- 不通过多层阴影制造卡片；层级优先使用背景差和 1px 边框。

### 4.4 数据表格

- 表头：`#EDF1F6`，正文使用 `--text-primary`。
- 奇数行：`#FFFFFF`；偶数行：`#F8FAFC`。
- hover 行：`--accent-soft`。
- 固定行号列：`#F0F3F7`，文字使用 `--text-muted`。
- 网格线：`#E0E5ED`。
- 数值继续使用 tabular numbers；行号、ID 和技术字段可使用等宽字体。

### 4.5 Monaco 编辑器

- 浅色主题名称固定为 `sfdevkit-light`。
- 编辑器背景：`#FBFCFE`。
- 前景：`#172033`。
- 行号：`#68758C`；当前行号：`#3B465A`。
- 光标：`#2563EB`。
- 选区：`#CFE0FF`；非活动选区：`#E4ECFA`。
- 当前行：`#F3F6FA`。
- 缩进线：`#E2E7EF`；活动缩进线：`#B9C2D0`。
- SOQL tokenizer 的语义颜色要在真实查询中复核，不允许只切换为 Monaco 内置 `vs` 后结束迁移。

### 4.6 状态与反馈

- 成功、错误和普通信息必须有文字或图标语义，不能只靠颜色。
- 错误卡使用 danger 三令牌，不使用大面积高饱和红色。
- 执行查询按钮使用 success 三令牌，表示主要执行动作。
- 加载动画必须遵守 `prefers-reduced-motion`。
- 空状态使用虚线边框和弱表面，不额外增加插画或装饰图标。

### 4.7 Org 类型标签

Org 类型标签允许保留各自的语义颜色，但只能用于标签本身：

- Production：蓝色。
- Sandbox：低饱和黄色。
- Scratch：绿色。
- Developer：紫色。
- Alibaba：红色。

这些颜色不是页面强调色，不能扩散到按钮、标题或大面积背景。

## 5. 当前参考实现

已完成：

- 语义令牌的深色和浅色定义。
- 设置面板中的浅色/深色切换及持久化。
- `data-theme` 和 `color-scheme` 同步。
- 应用 TopBar、Sidebar、设置浮层和通用控件的浅色样式。
- SOQL 历史区、Monaco、工具条、结果区、表格、日志、错误态和空状态。
- 中英文主题设置文案。
- reduced-motion 对 SOQL 持续动画的降级。

样例分支为了方便验收，把默认模块暂时改为 `soql`。合并到正式分支前必须将 `src/store/ui.ts` 的默认模块恢复为 `home`。

当前浅色覆盖集中追加在 `src/styles.css` 末尾，这是为了隔离样例风险，不代表最终推荐结构。

## 6. 后续迁移计划

### 阶段 A：样式结构整理

由一名集成人负责，其他 Agent 暂停修改 `src/styles.css`：

1. 保留 `src/styles.css` 中的全局令牌、reset、应用外壳和通用控件。
2. 将模块样式逐步拆到模块目录，例如 `src/modules/OrgManager/styles.css`。
3. 每个模块样式文件同时包含默认样式和 `[data-theme="light"]` 覆盖。
4. 在模块入口显式引入自己的样式文件。
5. 拆分只做机械移动，不在同一提交中改变视觉。

如果暂不拆文件，则必须指定唯一的样式集成人。其他 Agent 只提交组件和建议色值，由集成人统一修改 `styles.css`，避免并行冲突。

### 阶段 B：模块迁移顺序

建议按以下顺序迁移，每个工作包独立验收：

1. HomeDashboard：卡片、快捷动作、待办、新闻和空状态。
2. OrgManager：Org 卡片、登录弹窗、类型标签和表单。
3. MetadataBrowser：树、三栏布局、package.xml 编辑器、检索日志。
4. Deployer：配置表单、diff、历史、确认弹窗和日志。
5. LogViewer：过滤器、列表、详情和状态反馈。
6. ApexRunner：编辑器、执行工具条、结果和日志。

MetadataBrowser 和 ApexRunner 中如使用 Monaco，必须复用同一主题状态和与编辑内容匹配的浅色 Monaco 主题，不要各自创建不一致的白色编辑器。

### 阶段 C：收口

1. 搜索并处理所有硬编码深色值。
2. 删除不再需要的模块级临时覆盖。
3. 恢复默认首页。
4. 在深色和浅色下回归全部模块。
5. 完成键盘、缩放、窗口尺寸和 reduced-motion 检查。

## 7. Agent 工作约束

每个执行 Agent 必须遵守：

- 不修改本规范中的基础令牌值；如发现问题，记录证据并交给集成人决策。
- 不改变模块信息架构、导航名称或业务行为。
- 不引入新的 UI 框架、图标库或主题依赖。
- 不复制一套独立主题 Store，统一使用 `useSettingsStore`。
- 不在 React 组件中写 `themeMode === "light" ? colorA : colorB`；Monaco 等第三方主题 API 除外。
- 不用 `!important` 解决普通优先级问题；sticky 表格既有规则除外。
- 不删除深色样式，浅色迁移必须保持双主题可用。
- 不把 Org 标签色当作全局强调色。
- 不顺便重构业务逻辑或改写文案。
- 修改用户可见文字时同步更新 `zh-CN` 和 `en-US`。
- 保留并检查 loading、empty、error、disabled、hover、active 和 focus 状态。

## 8. 单模块验收清单

每个模块完成前逐项确认：

- [ ] 浅色模式没有残留的大面积深色背景。
- [ ] 深色模式与迁移前视觉和交互一致。
- [ ] 标题、正文、辅助文字、placeholder 和 disabled 文字可读。
- [ ] 所有输入框、下拉框、按钮都有 hover、focus 和 disabled 状态。
- [ ] focus 不只依靠颜色，键盘可以清楚定位。
- [ ] 表格表头、隔行、hover、sticky 行列在滚动时层级正确。
- [ ] success、danger 和 Org 类型标签没有颜色语义串用。
- [ ] Monaco 或代码区域的背景、行号、选区、光标和语法颜色清晰。
- [ ] loading、empty 和 error 状态在两种主题下都已检查。
- [ ] 200% 缩放和窄窗口下没有内容遮挡或按钮文字换行。
- [ ] `prefers-reduced-motion` 下没有不必要的循环动画。
- [ ] `npm run build` 通过。
- [ ] `npm test` 全部通过。
- [ ] 浏览器或 Tauri 实际渲染无控制台错误。

## 9. 全局完成标准

以下条件全部满足后，浅色模式才可视为完成：

- 所有功能模块完成双主题适配。
- `rg` 检查确认剩余硬编码颜色都有明确的语义理由。
- 主题切换后无需刷新，所有已挂载模块立即同步更新。
- 刷新和重启应用后主题保持。
- 所有 Monaco 实例同步主题。
- 深色模式没有回归。
- 构建通过，全部测试通过。
- macOS Tauri 窗口至少进行一次浅色和深色人工检查。

## 10. 可直接交给执行 Agent 的任务模板

```text
请按照 docs/light-theme-spec-and-handoff.md，为 <模块名> 完成浅色模式适配。

你的文件所有权：<列出模块目录和样式文件>。
不要修改其他 Agent 负责的文件，不要回退他人的改动；如果共享样式存在冲突，把需要的令牌或全局改动报告给样式集成人。

要求：
1. 保持现有业务行为、布局、深色模式和中英文文案不变。
2. 统一使用现有 settings-store 主题状态和语义令牌。
3. 覆盖 loading、empty、error、disabled、hover、active、focus 和数据展示状态。
4. 如模块包含 Monaco，同步适配编辑器主题。
5. 完成后运行 npm run build、npm test，并实际检查两种主题。
6. 交付时列出修改文件、视觉决策、验证结果和仍需集成人处理的共享项。
```

## 11. 关键文件

- `src/styles.css`：主题令牌、当前外壳和 SOQL 浅色参考实现。
- `src/store/settings.ts`：主题状态和持久化。
- `src/App.tsx`：主题挂载到根元素。
- `src/components/Layout/Sidebar.tsx`：主题切换控件。
- `src/modules/SoqlEditor/SoqlMonacoEditor.tsx`：Monaco 浅色参考主题。
- `src/store/ui.ts`：样例分支的默认页面临时调整。

