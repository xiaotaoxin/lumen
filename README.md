# Lumen 流明

> 把想象点亮 — 一个面向创作者的图像 / 视频 / 画布 一体化生成工作台。

本仓库是 Lumen 的**前端单仓 + Mock 后端**版本，用于本地演示、设计走查与产品评审。所有数据流（账号、生成历史、模型调用、注册审核、统计指标、画布、主体、自定义模型）都在浏览器端用 Mock 实现，UI 与未来真后端的边界由 `lib/api/*` 隔离 —— 将来接真后端只改实现，UI 与组件零改动。

---

## 快速开始

```bash
npm install
npm run dev          # 默认 :3000；端口被占用时：next dev --port 3007
```

打开 [http://localhost:3000](http://localhost:3000)。

### 演示账号

首次访问会自动 seed 一批 demo 数据。

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `admin1234` |
| 普通用户 | `demo` | `user1234` |

注册新账号会进入「等待审核」状态。用管理员账号到 `/admin/registrations` 通过即可激活。

---

## 路由地图

### 公开
| 路由 | 说明 |
| --- | --- |
| `/` | 着陆页（Hero / 能力 / 工作流 / 模型 / FAQ） |
| `/login` `/register` | 登录 / 注册（注册后看到「等待审核」状态） |

### 用户工作台 `/app/*`
| 路由 | 说明 |
| --- | --- |
| `/app/text-to-image` | 文生图工作台（chat-stream 对话流） |
| `/app/image-to-video` | 图生视频工作台（chat-stream 对话流） |
| `/app/canvas` | 画布列表 + 类型选择 |
| `/app/canvas/[id]` | 画布编辑器（按 doc.kind 分发到节点流 / 自由画布） |
| `/app/tools` | 媒体处理工具网格（腾讯云 MPS 接入） |
| `/app/tools/[id]` | 单工具页（输入文件 + 参数 + 任务结果） |
| `/app/history` | 我的作品（按时间倒序，可按类型 / 模型 / 收藏过滤） |
| `/app/subjects` | 主体库（@-mention 引用的角色 / 场景） |
| `/app/account` | 账号设置（含主题切换） |

### 独立全屏页（无 AppShell）
| 路由 | 说明 |
| --- | --- |
| `/panorama-view` | 沉浸式 360° 全景查看器（新标签页打开，从 panorama 节点跳转） |

### 管理后台 `/admin/*`（角色 = admin 才可见）
| 路由 | 说明 |
| --- | --- |
| `/admin/registrations` | 注册审核队列 |
| `/admin/users` | 用户管理（角色 / 启停） |
| `/admin/models` | 模型配置（内置只读 + 自定义模型 CRUD） |
| `/admin/media-processing` | 腾讯云 MPS 配置（SecretId/SecretKey/Region/COS Bucket） |
| `/admin/analytics` | 数据看板（5 项指标） |

---

## 核心功能速览

- **三条创作主路径**
  - **文生图 / 图生视频**：chat-stream 对话流，多次发送累积；可改 prompt + 参数后重生；多图轮播；prompt 可悬停查看完整内容并复制 / 一键回填
  - **画布**：两种形态，按需选择
    - **节点流画布**：图像 / 视频 / 文本 / 上传图片 / 导演台 / **全景场景** 6 种节点，连线触发生成，支持 3 个模板（文生图 / 图生视频 / 文字生视频），节点支持内联编辑 + 选中态浮出变体工具栏
    - **自由画布**：上传 / 拖入 / 粘贴图片视频，自由摆放（4 角缩放、对齐参考线 + 自动吸附、多选、空格拖动平移）
  - **媒体处理工具**（腾讯云 MPS）：转码 / 音视频增强 / AI 配音 / 智能字幕 / 智能擦除 / 媒体质检 / 截图转动图等 10 项真接入；任务状态 5 秒轮询；输出私有桶预签名播放
- **@主体**（角色 / 场景库）—— 在 prompt 里 `@名字` 引用，提交时自动展开成完整描述发给模型
- **会话化对话流** —— 每段连续创作 = 一个 session，侧栏按"今天 / 昨天 / 7 天前 / 更早"分组
- **Tab 路由记忆** —— 创作 / 视频 / 画布 各自记住上次访问的会话；切走再切回直接落到原来的会话
- **跨组件挂载的进度保留** —— 切换 tab 后正在跑的任务进度不会重置回 0%（live-jobs 模块级注册表 + bus）
- **模型配置（管理员）** —— 全部由管理员添加；Provider Type 决定走哪个 adapter（dashscope-image / dashscope-video / openai-image / replicate-image / mock 等）；选 Provider 后 Model ID 字段自动变成预设下拉，含"自定义…"兜底；可一次性 Bundle 配置图像+视频两条
- **图像变体工具栏**（节点流画布）—— 选中已生成的图像节点，浮出 6 个变体动作（高清放大 / 多视角 / 重打光 / 九宫格 / 拓展画面 / 风格化）+ 5 个应用动作（存为主体 / 送到视频 / 镜像 / 下载 / 放大查看）；变体按钮按当前模型的 `capabilities` 条件渲染
- **全景场景节点**（节点流画布）—— 单图 → 360° 等距柱面全景的多 provider 级联管道（AIHorde img2img 主路径 国内匿名免费 → Pollinations 文生图 快速兜底 → HF DiT360/FLUX 需梯子的高质量备援）；自动切 4 个方向视图（前/右/后/左）；点"进入全景"在新标签页打开 `/panorama-view` 全屏沉浸查看器，支持 4 种投影模式（直线 / Pannini / 立体 / 小行星）+ 智能提取（4 张方向图 / 12 宫格）+ 任意比例视角截图
- **数据看板** —— 5 项指标（调用次数 + 消耗趋势、模型占比饼图、失败率、平均耗时、用户排行）

### 输入快捷键

- `Enter` 发送 / 生成
- `Shift+Enter` 换行
- 中文输入法 composition 中按 Enter 不会误触发发送（看 `e.nativeEvent.isComposing`）

---

## 技术栈

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **TypeScript 5** 严格模式
- **Tailwind CSS v4** + 自建设计 token（`app/globals.css`，oklch 色彩）
- **Radix UI** + shadcn 风格组件（`components/ui/*`）
- **@xyflow/react 12**（节点流 + 自由画布共用）
- **Zustand** 轻量 store；**zod** + **react-hook-form** 表单校验
- **Recharts** 图表，**Lucide** 图标，**next-themes** 主题，**Sonner** 通知

---

## 目录约定

```
app/                                 路由
  page.tsx                            着陆页
  login/  register/                   认证
  app/                                用户工作台 layout（AppShell）
    text-to-image/  image-to-video/
    canvas/  canvas/[id]/
    history/  subjects/  account/
  admin/                              管理员 layout（AuthGuard requireAdmin）
    registrations/  users/  models/  analytics/

components/
  ui/                                 设计系统原子（按钮、卡片、Dialog…）
  layout/                             AppShell / IconRail / ConversationSidebar
  brand/                              Logo
  workspace/                          通用业务组件（CenterComposer / VideoComposer / SubjectManager / PromptDisplay …）
  canvas/                             画布相关
    canvas-editor.tsx                 节点流编辑器
    freeform-canvas-editor.tsx        自由画布编辑器
    canvas-router.tsx                 按 doc.kind 分发
    add-node-panel.tsx                节点添加面板
    panorama-viewer.tsx               全屏 Three.js 着色器全景查看器（4 投影模式）
    nodes/
      image-node.tsx  video-node.tsx  text-node.tsx  upload-node.tsx
      director-stage-node.tsx         3D 构图导演台节点
      panorama-node.tsx               全景场景节点（单图→360°）
      freeform-image-node.tsx  freeform-video-node.tsx  freeform-text-node.tsx

lib/
  api/                                【后端契约层】所有外部交互入口
    auth.ts          登录 / 注册 / 审核状态
    generate.ts      文生图 / 图生视频
    history.ts       我的作品
    sessions.ts      对话会话
    subjects.ts      主体库
    canvases.ts      画布 CRUD + pruneHeavyFields/nukeAllNodeAssets（localStorage 配额清理）
    admin.ts         审核队列、用户、统计指标
    admin-models.ts  自定义模型 CRUD
    media-processing.ts  腾讯云 MPS：TC3 签名调用 + 任务轮询 + 模板列表
    director-stages.ts   3D 构图导演台 doc CRUD
    index.ts         统一导出 + 错误类型
  director/
    media-tools.ts                    10 个 MPS 工具元数据 + ProcessMedia payload 构造
  providers/                          真模型 adapter 层（详见 CLAUDE.md §十）
  panorama.ts                         单图→360° 多 provider 级联 + 等距柱面→立方体面提取
  ai-horde.ts                         AIHorde 浏览器直连（img2img · 国内匿名）
  pollinations.ts                     Pollinations.ai 文生图 GET URL（国内秒级）
  hf-direct.ts                        HuggingFace Space 浏览器直连 Gradio API
  store/                              Zustand stores
    auth-store.ts  sessions-store.ts  catalog-store.ts
  hooks/
    use-space-to-pan.ts               空格切换抓手模式
  types.ts                            领域类型
  catalog.ts                          内置模型 + reactive hooks
  storage.ts                          localStorage 包装 + 错误广播
  seed.ts                             首次访问 seed
  mock-assets.ts                      SVG 占位图生成（按 prompt 哈希着色）
  auth-helpers.ts                     mock 密码哈希
  utils.ts                            cn / format helpers
  last-tab-route.ts                   Tab URL 记忆
  live-jobs.ts                        跨组件挂载的 in-flight 任务注册表

app/globals.css                       Tailwind + 设计 token + 画布 cursor 样式
```

---

## 设计原则

- **编辑型排版**：标题用衬线字体（Fraunces），正文用 Inter，避免廉价极简感。
- **不用 glassmorphism**：背景靠 oklch 色彩 + aurora 渐变 + 颗粒纹理叠加。
- **暗色优先**：默认深色，浅色为完整支持。
- **动效克制**：仅用于状态转换、生成进度、对齐吸附，不做 warp / 速度感装饰。

---

## 常见操作

清空本地 seed 重来（首次启动会自动重新 seed）：

```js
// 浏览器控制台
Object.keys(localStorage)
  .filter(k => k.startsWith("lumen:"))
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

构建生产包并预览：

```bash
npm run build
npm run start
```

类型检查 / lint：

```bash
npx tsc --noEmit
npx eslint . --ext .ts,.tsx
```

---

## 已知限制

- 真接入的 provider 已支持的：OpenAI Image / Replicate / 阿里云百炼通义万相图像 + 视频 / 腾讯云 MPS（媒体处理工具）。其他 provider（Stability / ComfyUI / Generic HTTP）尚未实现，会自动 fallback 到 mock
- 上传文件以 base64 内联到 localStorage，单浏览器配额约 5MB —— 画布 panorama 节点上传图自动下采样到 1280px JPEG；启动时如发现 `lumen:canvases` > 4MB 自动瘦身（剥离 >50KB 的 dataURL 字段）；写入失败 toast 带"一键瘦身"和"强力瘦身"按钮
- panorama 节点的 AIHorde 路径在国内匿名直连（CORS `*`），但匿名队列 5-30 分钟；HF Space 路径需浏览器系统代理可达
- 进度保留只覆盖**单标签页内组件挂载切换**；多标签页同时跑、整页 F5 刷新仍会丢内存里的 in-flight 任务（解决方案需要 BroadcastChannel + 服务端任务持久化）
- **移动端未适配**，最低支持桌面宽度 1280px
- 没有真正的会话过期 / CSRF 保护（接真后端时配合 httpOnly cookie 实现）
- 自定义模型的 API Key 当前明文存 localStorage 并通过 `X-Lumen-API-Key` 头送给同源 proxy（DevTools 仍可见）；接真后端时改为加密存 DB

---

## 接入真后端的边界

把 `lib/api/*` 内部实现替换为真实 HTTP 调用即可：

| Mock 调用 | 替换建议 |
| --- | --- |
| `auth.login / register / logout` | POST `/api/auth/*`，session 用 httpOnly cookie |
| `auth.getSession` | GET `/api/me` |
| `generate.generateImage / generateVideo` | POST `/api/generate/{image,video}`，长任务走 SSE 或轮询 |
| `history.* / sessions.* / canvases.*` | RESTful CRUD |
| `admin.metrics` | GET `/api/admin/metrics`，建议聚合查询缓存 |
| 参考图 / 上传图（base64） | 客户端拿 OSS 临时签名直传，前端只回传 URL |
| `adminModels.*` | 后端代理 + API Key 加密落库 |

UI / 组件 / 类型 **零改动**。

---

## 文档

- [`CLAUDE.md`](./CLAUDE.md) — 项目约定 + 常见坑（给 Claude Code agent 用，也给新接手的人看）
- [`docs/PRD.md`](./docs/PRD.md) — 产品需求文档，已实现 / 未实现一览
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 架构设计、数据流、关键技术取舍

---

## 许可

未指定（个人 / 团队内部使用）。
