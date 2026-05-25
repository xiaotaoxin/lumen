# Lumen 架构文档

> 把"为什么这么写"沉淀下来，避免下次又要从代码反推。
> 配套阅读：[README](../README.md)、[CLAUDE.md](../CLAUDE.md)、[PRD](./PRD.md)

---

## 0. 一图看懂

```
┌──────────────────────────────────────────────────────────────────────┐
│                         浏览器（Next.js 16 SPA-like）                 │
│                                                                      │
│  ┌────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│  │   Pages (RSC + │    │ Components       │    │ Stores (Zustand) │ │
│  │   client)      │───▶│  workspace/*     │◀──▶│  auth-store      │ │
│  │   /app, /admin │    │  canvas/*        │    │  sessions-store  │ │
│  └────────┬───────┘    │  layout/*  ui/*  │    │  catalog-store   │ │
│           │            └────────┬─────────┘    └──────────────────┘ │
│           │                     │                                    │
│           ▼                     ▼                                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              lib/api/*  ← 后端契约层（边界）                   │   │
│  │   auth · generate · history · sessions · subjects · canvases │   │
│  │   · admin · admin-models · index (errors)                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                  ┌───────────┴────────────┐                          │
│                  │                        │                          │
│                  ▼                        ▼                          │
│  ┌──────────────────────────┐    ┌────────────────────────────┐     │
│  │    lib/storage.ts        │    │   lib/mock-assets.ts       │     │
│  │  localStorage 包装       │    │  程序生成 SVG / 海报         │     │
│  │  + 错误广播              │    └────────────────────────────┘     │
│  └──────────┬───────────────┘                                       │
│             │                                                        │
│             ▼                                                        │
│   ┌─────────────────────┐                                           │
│   │  Browser localStorage│ ← 持久化层（演示阶段，约 5MB 配额）         │
│   └─────────────────────┘                                           │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              │ 真接入时只换这一层 ↓
                              ▼
                  ┌─────────────────────────┐
                  │  Real backend (planned) │
                  │  Auth.js + Prisma + OSS │
                  │  HTTP / SSE             │
                  └─────────────────────────┘
```

**关键边界**：`lib/api/*` 是 UI 与持久化之间的唯一接缝。UI 永远调它，**不直接读 localStorage**。

---

## 1. 模块依赖

```
app/* ──────────► components/* ─┐
                                 ▼
                    components/ui/* (无业务，可独立替换)
                                 │
                                 │
app/* + components/* ──► lib/store/*  ──► lib/api/* ──► lib/storage.ts
                                            │              │
                                            ▼              ▼
                                       lib/types.ts   lib/live-jobs.ts (跨挂载/跨 tab 的活跃任务注册表)
                                       lib/catalog.ts (内置数据)
                                       lib/mock-assets.ts
                                       lib/auth-helpers.ts
                                       lib/seed.ts
                                       lib/last-tab-route.ts (Tab URL 记忆)
                                       lib/providers/*       (真 provider adapter 层)
                                       lib/director/*        (导演台 + 媒体工具元数据)
                                       lib/panorama.ts       (单图→360° 多 provider 级联)
                                       lib/ai-horde.ts       (国内匿名 img2img 直连)
                                       lib/pollinations.ts   (国内秒级文生图直连)
                                       lib/hf-direct.ts      (HF Gradio 浏览器直连)
```

**禁止反向依赖**：
- `lib/*` 不准 import `components/*` 或 `app/*`
- `components/ui/*` 不准 import `lib/api/*`（保持纯展示）

---

## 2. 数据流：典型场景

### 2.1 登录
```
User 在 /login 提交表单
  → useForm + zod 校验
  → authApi.login(username, password)
       → storage.get(KEYS.users) 读用户列表
       → verifyPassword 比较
       → storage.set(KEYS.session, { id, username, role })
       → 返回 SessionUser
  → useAuthStore.setUser(session)
  → router.replace(next || /app/text-to-image)
```

### 2.2 文生图 — 完整链路
```
User 在 CenterComposer 输入 + 按发送（Enter）
  → page.submit()
      ① 找/新建 sessionId（lazy: 第一句话才 createSync）
      ② gen.generateImage({ userId, sessionId, modelId, prompt: buildFinalPrompt(), params })
           - buildFinalPrompt() 把 @Subject 展开成 @Name (描述)
           - runAdapter() 入口 registerJob(id, gen, cancel) → 模块级 live-jobs 注册
           - 真 provider（dashscope-image / openai-image / replicate-image …）or mock
                       + 每个 progress 事件 → onProgress 回调 + publishProgress(id, pct)
                       + 完成 → persistGeneration(final) + publishFinal(id, final)
      ③ 在 stream 末尾追加占位 Generation
      ④ bumpSessions() — 通知侧栏刷新
  → 进度回调 onProgress(pct, gen)
      → setProgressMap + setStream（更新该条状态）
  → 完成 promise.then(final)
      → setStream 把该条替换成 final
      → bumpSessions() 再次
      → 侧栏拉新 historyApi.listMine（含这条）
```

**跨组件挂载的进度保留**：当用户切换到画布 / 创作 / 视频 等不同路由时，原页面 unmount 但 live-jobs Map 仍保留 lastPct + cancel 句柄。重新挂载页面时：
1. 会话加载 effect 用 `getLiveJob(id)` 优先填 progressMap / stream
2. `useEffect(deps: [stream id 列表])` 对 running 条目调 `subscribeJob(id, cb)` 订阅未来更新
3. `cb` 把 lastPct / lastGen / finalGen 同步到 React state

### 2.3 反向同步（侧栏 → 页面 stream）
```
侧栏点删除某条 generation
  → historyApi.remove(id)
  → useSessionsStore.bump()  ← 唯一的"变更广播"
       
所有订阅者：
  - ConversationSidebar 自己 reload
  - text-to-image / image-to-video 页面订阅 sessionsReloadKey
       → 重新拉 historyApi.listMine
       → 用 Map 做"还在的留下，不在的剔除"
       → setStream 同步
```

这个 bump-pattern 解决了同一份 storage 多消费方"谁改了别人都看不到"的问题。

### 2.4 画布持久化
```
任何节点 / 边 / 视口变化
  → setNodes / setEdges
  → useEffect 触发 queueSave()
  → debounce 600ms → canvasesApi.saveSync(id, { nodes, edges, viewport, coverUrl })
  → storage.set(KEYS.canvases, [...])
```

debounce 防止拖动节点时每帧写 storage（爆 IO）。

**初始化竞态守门**（`loadedRef`）：异步 `canvasesApi.get` 完成前，`queueSave` / cleanup 都不会写盘 —— 否则初始 `nodes=[]` 时排定的 save 会在加载完后被 cleanup 错误触发，反向把刚加载的内容写成空。

**flush-on-unmount**：useEffect cleanup + `visibilitychange` + `beforeunload` 三处都会立即同步落盘 —— 防止用户在 600ms 防抖窗口内切 tab 导致改动永久丢失。

**配额防护**：
- `fromFlowNode` 序列化时把 panorama 节点中 >600KB 的 dataURL 字段（`imageUrls` / `panoramaUrl`）剥离；4 面预览 `panoramaFaces` 永不持久化（加载后用 `panoramaUrl` 现切）
- panorama 节点上传图自动调 `downscaleToDataUrl(file, 1280, 0.85)` 下采样到 200-400KB，避免触阈值
- 启动时 `SeedBootstrap` 检查 `lumen:canvases` > 4MB 触发 `pruneHeavyFields()` 自动瘦身；写入失败 toast 带"一键瘦身 / 强力瘦身"按钮（后者调 `nukeAllNodeAssets()` 清空所有节点的图片产物）

### 2.5 媒体处理任务（腾讯云 MPS）
```
管理员配置 → /admin/media-processing 写入 lumen:mediaProcessingConfig
                                          │
                                          ▼
工具页 /app/tools/[id]
  → 上传文件 → POST /api/cos-sign 拿 V4 PUT 预签名 URL
  → 浏览器 XHR 直传 COS 私有桶（带进度）
  → 浏览器 → POST /api/proxy/tencent-mps （X-Lumen-API-Key + X-TC-Action 头）
            ├ 服务端 TC3-HMAC-SHA256 V3 签名 → mps.tencentcloudapi.com
            ↓
  ProcessMedia 拿 TaskId
  → 5s 轮询 DescribeTaskDetail
       Status: WAITING → PROCESSING → FINISH
  → extractOutputUrls() 解析 WorkflowTask / ProcessMediaTask 输出
  → POST /api/cos-get-sign 给输出 URL 签 GET 预签名（私有桶播放用）
  → <video/img/audio src="...">  + 一键下载（fetch + createObjectURL）
```

### 2.6 单图 → 360° 全景（panorama 节点）

国内零钱 + 无代理优先 → AIHorde / Pollinations 主路径，HF 作为有梯子时的备援。多 provider 级联：

```
mode="horde" (默认 国内):
  浏览器 → POST aihorde.net/api/v2/generate/async (apikey "0000000000")
        → 5s 轮询 /check/{id}（队列位置 + 预计剩余时间）
        → done → /status/{id} → R2 URL
  匿名严格限：≤1024×1024 + ≤50 步 + 普通采样器 + 不开 hires_fix

mode="pollinations" (快速):
  浏览器 → GET image.pollinations.ai/prompt/{prompt}?width=1024&height=512
  纯文生图（不保留原图），5-15s

mode="hf-rewrite" (需梯子):
  浏览器 → CLIP-Interrogator-2 (image→caption)
        → DiT360 (caption→真360°全景, CVPR 2026)
        ↘ Z-Image-Turbo (DiT360 失败时兜底)

mode="hf-outpaint" (需梯子):
  浏览器 → FLUX.1-Fill-dev (img2img 横向外扩)
        ↘ diffusers-image-outpaint (FLUX 失败时兜底)
```

各 provider 都通过浏览器侧 fetch（`lib/hf-direct.ts` / `lib/ai-horde.ts` / `lib/pollinations.ts`），避免 Node.js 不读 Windows 系统代理的国内连不通问题。

拿到 panoramaUrl 后：
1. `extractCubeFaces()`（`lib/panorama.ts`）—— canvas 像素级反投影出 4 个 90° FOV 方向图（前/右/后/左）
2. 节点上 4 张缩略图 + 进入全景按钮
3. 进入全景 = `window.open(/panorama-view?k=<localStorage 键>, '_blank')`，在不带 AppShell 的全屏路由打开

---

## 3. 关键技术取舍

### 3.1 为什么是 Mock 后端 + lib/api 边界？

**问题**：演示阶段没后端，但希望真接入时 UI 零改动。

**方案**：所有读写走 `lib/api/*`，函数签名是后端 API 的影子。
- 现在：内部读写 localStorage
- 未来：内部 fetch → /api/...

**收益**：UI 组件不需要"后端就绪"才能写。前端可以完整闭环走通流程，再单独把 `lib/api/*` 内部换成真 HTTP。

### 3.2 为什么用 Zustand 而不是 Context / Redux？

| 选项 | 优 | 劣 |
| --- | --- | --- |
| Context | 内置、无依赖 | 任何 setState 都重渲整个 provider 子树 |
| Redux | 完整、devtools | 模板代码多；项目规模不需要 |
| **Zustand** | 选择性订阅、无 boilerplate、~3KB | 略小众但 React 19 兼容良好 |

我们用了 3 个 store：
- `auth-store`：当前 session（hydrate / setUser / logout）
- `sessions-store`：跨组件的"刷新信号" reloadKey
- `catalog-store`：自定义模型列表（被 useImageModels / useVideoModels 订阅）

### 3.3 为什么 catalog 拆成 const + reactive hook？

**Const**（`BUILT_IN_MODELS`）：编译时已知，零开销，给 mock generate 这种**非 React** 上下文用。

**Hook**（`useImageModels` / `useVideoModels`）：合并 const + 已启用的自定义模型，给 React UI 用。当管理员在 `/admin/models` 加自定义模型 → catalog-store reload → 所有用 hook 的 UI 立刻拿到新列表。

**好处**：管理员加模型 → 用户侧零延迟看见，不需要刷新页面。

### 3.4 为什么 session 是 lazy 创建？

```
User 第一次点开 /app/text-to-image
  → URL 没 ?s=
  → 不创建 session
  → 用户写 prompt + 发送
  → 发送瞬间才 sessionsApi.createSync()
  → 写回 URL ?s=<id>
```

**理由**：用户可能开页面溜达一圈不发任何东西就走了，没必要污染 session 列表。Lazy 之后 session 数量 ≈ 真实创作次数。

### 3.5 为什么画布做成两种？

**节点流**（连线工作流）和**自由画布**（灵感板）是两个**不同的 mental model**：
- 节点流：「我要走一个流程：A → B → C」
- 自由画布：「我要把一堆东西摆在一起看」

硬塞一个画布会两边都妥协。共用 xyflow + storage schema（CanvasDoc.kind 区分），但编辑器组件是两个独立文件，节点类型也不同（`upload`/`text` 共用，但配的渲染组件不一样：节点流的 ImageNode 有 handles，自由画布的 FreeformImageNode 没有 handles 且支持四角缩放）。

### 3.6 为什么参考图 base64 持久化要剥离？

**问题**：用户上传一张 5MB 图 → base64 后 ~6.7MB → 单条 generation 直接超 localStorage 配额。

**解决**：`leanForStorage()` 在 `persistGeneration` 之前把 `imageParams.references` / `videoParams.referenceImageUrl` 替换成占位 `"ref:omitted"`。
- 内存中 stream / current 仍有完整 base64（用户继续编辑能看到缩略图）
- 持久化只留计数标记
- 真接后端时 references 字段是 OSS URL，问题自动消失

---

## 4. 持久化层

### 4.1 Storage keys
```
lumen:users                User[]            账号 + 密码哈希
lumen:applications         RegistrationApp[] 注册申请
lumen:session              SessionUser       当前登录态
lumen:generations          Generation[]      所有生成记录
lumen:sessions             Session[]         对话会话
lumen:subjects             Subject[]         主体库
lumen:canvases             CanvasDoc[]       画布（含 panorama 节点的 panoramaUrl，但不含 panoramaFaces / >600KB dataURL）
lumen:customModels         ModelInfo[]       管理员自定义模型
lumen:directorStages       DirectorStageDoc[] 3D 构图导演台
lumen:mediaProcessingConfig 腾讯云 MPS 配置（SecretId/SecretKey/Region/COS Bucket）
lumen:mediaProcessingTasks  MPS 任务记录
lumen:seeded:v3            boolean           首次 seed 标记
lumen:last-tab-route:*     string            每个 tab（create/video/canvas/tools）上次访问的完整 URL
panorama-<ts>-<rand>       string            临时跨标签页传值（/panorama-view 读完即删）
```

### 4.2 配额管理
- 浏览器 localStorage 通常 ≤ 5MB
- `storage.set` 失败时 broadcast → SeedBootstrap 订阅 → toast「本地存储已满」
- 主要爆点：参考图 base64、视频 dataURL、过多生成 SVG
- **缓解**：`leanForStorage` 剥离参考图；视频用 OSS-style 引用而非 inline；定期用户可手动清理

### 4.3 跨标签同步
- `window.addEventListener("storage", ...)` 监听其它标签的写入
- SeedBootstrap 监听 `lumen:customModels` → reload catalog store
- 未来可扩展更多 key

---

## 5. UI 架构

### 5.1 三层 AppShell
```
<AppShell>             ← <html><body><ThemeProvider>...
  <IconRail />         ← 68px 极窄左栏
  <ConversationSidebar/> ← 256px 中间（画布页隐藏）
  <main>{children}</main>
</AppShell>
```

`AppShell` 用 `usePathname` 检测路由，在 `/app/canvas/*` 下不渲染 ConversationSidebar，让画布全宽。

### 5.2 路由分组
- `app/(public)` 隐式 — 着陆 / 登录 / 注册
- `app/app/layout.tsx` — 用户工作台 layout，AuthGuard
- `app/admin/layout.tsx` — 管理后台 layout，AuthGuard requireAdmin

### 5.3 组件分层
| 层 | 例子 | 规则 |
| --- | --- | --- |
| **UI 原子** | Button / Card / Dialog / Select | 无业务，跨项目可复用 |
| **业务复合** | CenterComposer / SubjectManager / PromptDisplay | 包含业务逻辑，但不知道路由 |
| **页面** | TextToImagePage / CanvasEditor | 知道路由 + 调 `lib/api/*` + 拼装组件 |

---

## 6. 画布架构（最复杂的部分）

### 6.1 共享数据
```ts
CanvasDoc {
  kind: "flow" | "freeform"
  nodes: CanvasNode[]
  edges: CanvasEdge[]    // freeform 永远是空
  viewport: { x, y, zoom }
}

CanvasNode {
  id, type, position
  data: CanvasNodeData  // 必须 extends Record<string, unknown>（xyflow 要求）
}

CanvasNodeData {
  kind: "image" | "video" | "text" | "upload" | "media-video" | "director-stage" | "panorama"
  prompt, modelId, status
  imageUrls?, videoUrl?, videoPosterUrl?, ...
  directorStageId?      // director-stage 节点关联的 DirectorStageDoc id
  panoramaUrl?          // panorama 节点的 360° equirect 输出 URL
  panoramaFaces?        // 4 面预览（不持久化，加载后重切）
}
```

### 6.2 节点流 vs 自由画布
| 维度 | 节点流 | 自由画布 |
| --- | --- | --- |
| Editor 组件 | `canvas-editor.tsx` | `freeform-canvas-editor.tsx` |
| 节点类型 | image / video / text / upload | upload / media-video / text |
| Handle 连接点 | 有，触发生成 | 无 |
| Edges | 用户拖线 / 模板预连 | 永远空 |
| 节点形态 | 圆角 + status badge + inline 编辑 | 直角 + 4 角缩放 |
| 选择手势 | xyflow 默认（lasso 不开启） | `selectionOnDrag` lasso |
| 输入 | 双击空白 / 左栏 + / 拖线到空白 | 上传 / 拖入 / 粘贴 |
| 对齐辅助 | 无 | 实时参考线 + 6px 吸附 |

### 6.3 共享机制
- 都用 xyflow + ReactFlowProvider
- 都支持空格键切换抓手（`useSpaceToPan` hook）
- 都用 `canvas-router.tsx` 按 `doc.kind` 分发
- 都 debounce 600ms 持久化

### 6.4 对齐参考线 + 吸附（自由画布）
```
onNodeDrag(event, draggedNode):
  for each other node:
    比较被拖节点的 [Left, Center, Right] vs 其它节点的 [Left, Center, Right]  → 6px 内 → 加竖向 guide + 计算 dx
    比较被拖节点的 [Top, Middle, Bottom] vs 其它节点的 [Top, Middle, Bottom]  → 6px 内 → 加横向 guide + 计算 dy
  
  setGuides(activeGuides)
  if 有最小 dx/dy:
    setNodes 把节点位置覆盖成吸附后的坐标
```

guides 用 SVG overlay 渲染（屏幕坐标，从 flow 坐标 `flowToScreenPosition` 转换）。

---

## 7. 边界与扩展点

### 7.1 接真后端的 7 个改造点
1. `lib/api/auth.ts` 全替换 → POST /api/auth/*，session 走 cookie
2. `lib/api/generate.ts` 全替换 → POST /api/generate/*，长任务走 SSE
3. `lib/api/history.ts` `sessions.ts` `subjects.ts` `canvases.ts` → RESTful CRUD
4. `lib/api/admin*.ts` → 同上
5. 参考图 / 上传图 base64 → OSS 直传：拿临时签名 → PUT 直传 → 通知后端
6. `lib/storage.ts` 改成 IndexedDB（更大配额）或纯远程
7. `SeedBootstrap` 仅保留 hydrate（seed 由后端做）

UI / Stores / Components 完全不动。

### 7.2 接真模型 API 的扩展点（已落地）
- `lib/providers/*` 目录已建立，每家一个 adapter；`registry.ts` 做 `(providerType, kind) → adapter` 查找；未实现的真 provider 自动回退到 mock
- 已实现的 adapter：`mock-image` / `mock-video` / `openai-image` / `replicate-image` / `dashscope-image`（wan2.6+/wan2.7+/qwen-image 走 sync multimodal-generation；wanx2.1/wan2.5- 走 async）/ `dashscope-video`（wan2.5+ 异步任务）
- `lib/api/generate.ts` 的 `runAdapter()` 把 adapter 的 `AsyncIterable<AdapterEvent>` 翻译成 progress 回调 + final Generation；同时 publish 到 `live-jobs` 模块
- Admin `/admin/models` 已支持选 ProviderType + Bundle 模式（一次配置图像+视频两条）+ Model ID 预设下拉 + 测试调用

加新 provider 的最小改动：
1. 写 `lib/providers/<your>.ts`（实现 `testCall` + `generate`）
2. 在 `registry.ts` 注册
3. （需要时）在 `app/api/proxy/<your>/[...path]/route.ts` 加 proxy
4. 在 `app/admin/models/page.tsx` 的 `MODEL_ID_PRESETS` 加预设（可选，否则用户用"自定义…"手填）

### 7.3 内置模型目录现状
- `BUILT_IN_MODELS = []` —— 当前全部交由管理员通过 `/admin/models` 配置
- 想恢复 mock 演示卡片只需往该数组里加 ModelInfo 即可
- 自定义模型存 `lumen:customModels`，启用后 reactive hook（`useImageModels` / `useVideoModels`）立刻反映到 UI

---

## 8. 性能与可维护性

### 8.1 关键性能保护
- **Storage 写防抖**：画布 600ms
- **xyflow 节点 callbacks**：用 `useMemo` 包 `nodesWithCallbacks`，避免每次 setNodes 都重新创建函数
- **Catalog hooks `useMemo`**：避免每次渲染重算 merge 列表
- **session reloadKey**：跨组件刷新通过单一计数器，避免事件总线

### 8.2 测试缺失（当前）
- 没有单元测试 / 集成测试
- 现阶段靠 `tsc --noEmit` + `eslint` + 路由 200 smoke test 保证
- 接真后端时建议引入 Vitest（store / api 单测）+ Playwright（关键流程）

### 8.3 lint 红线
- 0 errors
- warnings 主要是 `<img>` 提示（mock 数据 URI 用 next/image 反而更复杂，已接受）
- React 19 严格的 `set-state-in-effect` 必须遵守，模式见 CLAUDE.md §六

---

## 9. 安全考虑（演示阶段坦诚）

| 项 | 状态 |
| --- | --- |
| 密码哈希 | mock 用 djb2，**不安全**；真后端用 argon2id |
| Session | localStorage 明文存，**不安全**；真后端用 httpOnly cookie |
| API Key（自定义模型）| 当前不真发送；真接入时浏览器直连方案（A/B/C 三档）见 PRD |
| CSRF | 无；真后端用 SameSite cookie |
| XSS | 依赖 React 自动转义；不写 dangerouslySetInnerHTML |
| 输入校验 | 前端用 zod；真后端要在服务端再校一遍 |

---

## 10. 文件路径速查

| 想找什么 | 看这里 |
| --- | --- |
| 新增 API 函数 | `lib/api/*.ts` |
| 新增数据类型 | `lib/types.ts` |
| 新增 storage key | `lib/storage.ts` 的 `KEYS` 常量 |
| 改主题颜色 | `app/globals.css`（oklch tokens） |
| 改导航 | `components/layout/icon-rail.tsx` 或 `app-sidebar.tsx` |
| 改画布节点视觉 | `components/canvas/nodes/*.tsx` |
| 加 mock 模型 | `lib/catalog.ts` 的 `BUILT_IN_MODELS`（默认空） |
| 加新真 provider | `lib/providers/<name>.ts` + `registry.ts` 注册 + 可选 proxy |
| 改 dashscope 路由（wan vs qwen） | `lib/providers/dashscope-image.ts` 的 `isNewGen()` / `isQwenImage()` |
| 改 Model ID 预设下拉 | `app/admin/models/page.tsx` 的 `MODEL_ID_PRESETS` |
| 跨组件保留任务进度 | `lib/live-jobs.ts` —— `registerJob` / `publishProgress` / `subscribeJob` |
| Tab 路由记忆 | `lib/last-tab-route.ts` + `components/layout/icon-rail.tsx` |
| Enter 键发送约定 | `components/workspace/*-composer.tsx` / `components/canvas/nodes/*-node.tsx` |
| 加新页面 | `app/<route>/page.tsx`，跟着现有路由组放 |
| 加新 MPS 工具 | `lib/director/media-tools.ts` 添加 `MediaToolMeta` + `buildProcessMediaPayload` 加 case |
| 改 MPS 模板预设中文化 | `app/app/tools/[id]/page.tsx` 的 `PRESET_TEMPLATE_LABELS` / `parsePresetName` |
| 改 panorama 默认参数 | `lib/panorama.ts` 的 `generatePanoramaFromImage` 各 mode 分支；`lib/ai-horde.ts` 默认 1024×512 / 25 步 / denoise 0.45 |
| 改 panorama 投影模式 | `components/canvas/panorama-viewer.tsx` 的 GLSL `FRAGMENT_SHADER` + `PROJECTION_MODES` |
| localStorage 配额清理 | `lib/api/canvases.ts` 的 `pruneHeavyFields` / `nukeAllNodeAssets`；`window.__lumenPrune()` / `window.__lumenNuke()` 控制台调试 |

---

**最后**：架构是为产品服务的。下一次重大决策（接真模型 / 接真后端）发生时，记得回来更新本文。
