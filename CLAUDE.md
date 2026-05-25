@AGENTS.md

# Lumen — 项目约定与坑点速查

> 本文给 Claude Code agent 用（也给任何新接手的人看）。读完一次，可以避免我们已经踩过的坑。

---

## 一、项目定位

- **前端单仓 + Mock 后端** 的图像/视频/画布创作工作台
- 演示阶段，**所有 API 调用走浏览器 mock**；真后端边界由 `lib/api/*` 隔离
- 同步 README 看完整路由地图与功能列表

---

## 二、技术栈版本（重要）

| 库 | 版本 | 注意事项 |
| --- | --- | --- |
| Next.js | **16** | App Router；`params` / `searchParams` 是 **Promise**，必须 `await`；`useSearchParams()` 必须包 `<Suspense>`；`PageProps<'/path'>` / `LayoutProps<'/path'>` 是全局泛型，不需要 import |
| React | **19** | 严格的 `react-hooks/set-state-in-effect` 规则 —— `useEffect(() => setX(true), [])` 会被报错，详见下面 |
| Tailwind | **v4** | `@theme inline { ... }` 语法；`@custom-variant dark (&:where(.dark, .dark *))`；任意变体如 `[&_.foo]:bar`；当 xyflow / Radix 用动态 class 时 Tailwind 任意变体可能特异性不够（见画布 cursor 坑） |
| TypeScript | 5+ strict | 严格模式；CanvasNodeData 必须有 `Record<string, unknown>` 索引签名（xyflow 要求） |
| @xyflow/react | **12** | `params` / `searchParams` API 改了；`onConnectEnd` 第二个参数是 `connectionState` 含 `isValid` |

---

## 三、命令速查

```bash
# 起 dev server
cd /d/lumen
npx next dev --port 3007         # 端口 3000 通常被占；session 默认用 3007

# 类型检查（无错才算改完）
npx tsc --noEmit

# Lint（warnings 可接受，errors 必须 0）
npx eslint . --ext .ts,.tsx

# 生产构建（在大改后跑一次更稳）
npm run build
```

**永远在每次实质修改后跑 `tsc --noEmit`** —— 这个项目类型推得很严，一处错容易牵连多处。

---

## 四、文件组织约定

- `lib/api/*` 是**后端契约层**。UI 永远调它，不直接读 `localStorage`。
  - 写新功能 → 先在这层定义函数签名，再写 UI 调用
  - 接真后端时只换这层内部实现
- `lib/store/*` 是 Zustand stores，仅用于跨组件 reactive 状态（auth / sessions / catalog）
- `lib/types.ts` 是单一真理来源 —— 所有领域类型都在这里定义
- `lib/catalog.ts` 提供 reactive hook（`useImageModels` / `useVideoModels`）—— **新代码不要再用 `IMAGE_MODELS` / `VIDEO_MODELS` const**，只在非 React 上下文（如 mock generate）用。注意 `BUILT_IN_MODELS` 现在是**空数组**，所有模型都通过 `/admin/models` 配置；想恢复 mock 演示卡片再往数组里加即可
- `components/ui/*` 只放无业务的设计系统原子
- `components/workspace/*` 跨页复用的业务组件
- `components/canvas/*` 画布相关全部在这

---

## 五、设计原则（不要违背）

1. **不抄袭、不像素复刻** 任何商业产品（即梦 / TapNow / LibTV / Liblib / Krea / Magnific 等）
   - 借鉴产品**功能类别和信息架构**可以，但配色 / 字体 / Logo / 文案 / 组件细节必须自创
   - 用户曾明确要求"像素级复刻"，要**婉拒并提出借鉴 + 自创品牌**的折中方案
2. **不用 glassmorphism**（毛玻璃）
3. **编辑型排版**：标题用衬线 Fraunces，正文用 Inter
4. **暗色优先**，但浅色必须完整支持
5. **动效克制**：仅用于状态转换 / 进度 / 对齐吸附
6. 所有对外文案 / Toast / 错误信息默认**中文**

---

## 六、踩过的坑（按出现频率排）

### 1. localStorage 配额爆掉（最常见）
- 配额只有 ~5MB，参考图 base64 序列化后单张可达几 MB
- `lib/api/generate.ts` 的 `leanForStorage()` 持久化前自动剥离 `imageParams.references` / `videoParams.referenceImageUrl`
- `components/canvas/canvas-editor.tsx` 的 `fromFlowNode()` 在持久化前剥离重 dataURL 字段（含 panorama 节点的 `panoramaUrl`）
- 上传图自动下采样：`lib/panorama-presets.ts` 的 `downscaleImageToDataUrl(file, 2048, 0.88)` 把原始 5-15MB 相机图压到 200-400KB
- `storage.set` 失败会通过 `onStorageError` 广播 + toast，toast 上有"一键瘦身"按钮（调 `pruneHeavyFields`），还过不去就用"强力瘦身"（`nukeAllNodeAssets`）
- 启动时 `SeedBootstrap` 检查 `lumen:canvases` 是否 > 4MB；是则自动调 `pruneHeavyFields` 释放空间
- **新加任何会持久化大字段的功能时，记得评估配额影响**
- Stage-2 起：API Key 不再是 localStorage 配额风险（已迁服务端 SQLite + AES-GCM）

### 2. xyflow v12 — 拖线到空白处加节点
- `onConnectStart(_, { nodeId })` 记下源
- `onConnectEnd(event, connectionState)` —— 用 **`connectionState.isValid`** 判断（`null` / `false` 都算"丢空白"，`true` = 已连有效 handle）
- 同一 mouseup 也会触发 `onPaneClick` —— **必须**用 `skipNextPaneClick` ref 拦截，否则刚 set 进去的 panel 立刻被清

### 3. xyflow v12 — 节点 data 必须有索引签名
```ts
export interface CanvasNodeData extends Record<string, unknown> {
  // 真实字段...
}
```
否则 `<ReactFlow nodes={...}>` 报类型不匹配。

### 4. xyflow — pane cursor 默认是 grab
我们在自由画布要"按住空格才出现抓手"，所以加了 `app/globals.css` 的 `.canvas-default-cursor` / `.canvas-pan-cursor` 全覆盖（包括 `.draggable / .dragging / .selection` 子状态）。Tailwind 任意变体特异性不够，**必须**用 globals.css `!important`。

### 5. Radix Select 不接受 `value=""`
空字符串保留给"清空选择 / 显示 placeholder"。需要"无 / none" 选项时用 sentinel：
```tsx
<Select
  value={form.badge || "__none__"}
  onValueChange={(v) => patch("badge", v === "__none__" ? "" : v)}
>
  <SelectItem value="__none__">（无）</SelectItem>
  ...
</Select>
```

### 6. Next 16 — `useSearchParams()` 必须包 Suspense
否则 build 时报 prerender error。模式：
```tsx
export default function Page() {
  return (
    <Suspense fallback={<...>}>
      <PageInner />
    </Suspense>
  );
}
function PageInner() {
  const search = useSearchParams();
  // ...
}
```

### 7. React 19 — `set-state-in-effect` 严格规则
ESLint 报：「Calling setState synchronously within an effect can trigger cascading renders」。

❌ 错：
```tsx
React.useEffect(() => {
  if (!user) return;
  setLoading(true);             // 同步 setState — 报错
  fetchData().then(setData);
}, [user]);
```

✅ 对（用 .then 模式 + key bump pattern）：
```tsx
const [reloadKey, setReloadKey] = React.useState(0);
const reload = React.useCallback(() => setReloadKey(k => k + 1), []);
React.useEffect(() => {
  let cancelled = false;
  fetchData().then(d => { if (!cancelled) { setData(d); setLoading(false); } });
  return () => { cancelled = true; };
}, [user, reloadKey]);
```

### 8. 反向同步（sidebar → page）
当一个组件写数据后，订阅同一 store 的其它组件需要感知变化。用 `useSessionsStore` 的 `bump()` + 别处 `reloadKey` 订阅模式。
**画布 / 工作台页都订阅了 `sessionsReloadKey`**，删除时记得调 `bump()`。

### 9. 模型选择器要 reactive
`IMAGE_MODELS` / `VIDEO_MODELS` const **不会**在管理员加自定义模型时刷新。
**所有 React 组件**用 `useImageModels()` / `useVideoModels()` hook。
**非 React**（如 mock generate.ts 的 findModel）才直接读 const。

### 10. **代理 gzip 双解码 bug**（吃过一次）
真接入 provider（OpenAI / Replicate / DashScope）的同源代理 `app/api/proxy/*/[...path]/route.ts` 转发上游响应时，**必须**从 `respHeaders` 里同时剥掉 `content-encoding` 和 `content-length`：
- Node 的 `fetch()` 自动解压上游 gzip body
- 如果转发时仍带 `Content-Encoding: gzip` 头，浏览器会把已解压的明文当 gzip 再解一次 → `TypeError: Failed to fetch`
- 表现：UI 报"Failed to fetch"、耗时极短（~0.4s），Network 面板能看到响应头但 body 拉不出来

```ts
// proxy route.ts 模板
const respHeaders = new Headers();
upstream.headers.forEach((value, key) => {
  const lower = key.toLowerCase();
  if (HOP_BY_HOP.has(lower)) return;
  if (lower === "content-length" || lower === "content-encoding") return;
  respHeaders.set(key, value);
});
```

加新 provider 的 proxy 时**直接抄这个模板**。

### 11. 不要把 npx playwright install 当作小操作
- 国内代理下经常 ECONNRESET
- 用 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`，或干脆用本机已装的浏览器（`--browser msedge`）

### 12. 画布 debounced save 必须 flush-on-unmount
- `canvas-editor.tsx` 的 `queueSave` 是 600ms 防抖
- 用户在 600ms 窗口内切 tab → 组件卸载 → 定时器抛弃 → **改动永久丢失**
- 修法：useEffect cleanup 必须 flush；同时监听 `visibilitychange` + `beforeunload`
- **关键**：cleanup 里 flush 前要检查 `loadedRef.current`。否则初始 `nodes=[]` 时排定的 save 会在异步加载完后被 cleanup 错误触发，反向把刚加载的内容写成空数组（已踩过这个坑）

### 13. HF Space 国内可达性 / Node fetch 不读 Windows 系统代理
- Next.js 服务端 `fetch` 默认**不**自动跟随 Windows 系统代理（VPN）
- 国内用户即便开了 Clash/V2Ray，Node 进程仍是"fetch failed"
- **修法**：HF Space 调用全搬到浏览器侧 (`lib/hf-direct.ts`)。浏览器走 Windows 网络栈，自动用上系统代理
- 不能搬的（如腾讯云 TC3 签名）必须服务端做的，给用户清晰报错让其配 HTTPS_PROXY

### 14. AIHorde 匿名 kudos 限制
- 匿名 apikey `0000000000` 严格限：`width × height ≤ 1024×1024` + `steps ≤ 50` + 不能用"贵采样器"（k_heun, dpmpp_sde, dpm_2*）
- `hires_fix=true` 会让有效步数翻倍 → 触发 kudos 限制 → HTTP 403
- **匿名安全配置**：1024×512 + 25 步 + k_dpmpp_2m + hires_fix=false
- AIHorde img2img 的 `denoising_strength` 默认不能太高（0.7+ 会基本"重画"原图，把家拍出"遭贼现场"），推荐 0.45 保留主体仅做扩展

---

## 七、写新功能的标准流程

1. **先确认是否需要 storage**（爆配额风险）
2. **先在 `lib/types.ts` 加类型**
3. **`lib/api/*` 加 mock 实现**（带 `fakeLatency()`）
4. **如需 reactive 跨组件 → 加 store；否则用 props / hook**
5. **写组件**（先 dumb，再带 callback）
6. **`tsc --noEmit` + smoke test 路由 200**
7. **更新 CLAUDE.md / PRD.md** 如果引入了新模式

---

## 八、不要做的事

- ❌ 不要在文件顶部写大段 ASCII art / 装饰性注释
- ❌ 不要写多段长 docstring；一行注释 + 命名清晰即可
- ❌ 不要写 `// removed` 这种墓碑注释
- ❌ 不要为了"未来可能需要"加抽象层（参考已删除的 `prompt-composer.tsx` / `reference-uploader.tsx` —— 当时是过早抽象）
- ❌ 不要在 lint warning 里钻 `// eslint-disable-next-line` —— 90% 是代码本身可以重构
- ❌ 不要 `git commit` 除非用户显式说"提交"
- ❌ 不要 `git push --force` / `git reset --hard` / `rm -rf` 重要目录除非用户显式批准
- ❌ 不要在 production 代码里直接调 `IMAGE_MODELS`（除了 mock generate）
- ❌ 不要把 API key 真发送到上游（mock 阶段一律走 mock，等 adapter 层正式做）

---

## 九、常用 seed 重置（用户文档里也有）

```js
Object.keys(localStorage).filter(k => k.startsWith("lumen:")).forEach(k => localStorage.removeItem(k));
location.reload();
```

---

## 十、Provider 适配器层（B 路真接入第 1 步已落地）

- **`lib/providers/base.ts`** —— `ProviderAdapter` 接口 + `AdapterError` + 友好文案映射
- **`lib/providers/registry.ts`** —— `(providerType, kind) → adapter` 查找；未实现的真 provider 自动回退到 mock，所以"加 provider"是单文件改动
- **`lib/providers/mock-image.ts` / `mock-video.ts`** —— 把原 `generate.ts` 的 mock 逻辑搬过来，成为默认实现
- **`lib/providers/openai-image.ts`** —— 第一个真 provider；走 `/api/proxy/openai/*`，**绝不**直接调 `api.openai.com`
- **`app/api/proxy/openai/[...path]/route.ts`** —— 浏览器以 `X-Lumen-API-Key` 头送 Key，proxy 改写成 `Authorization: Bearer …` 转发上游
- **`lib/providers/replicate-image.ts`** —— Replicate 适配器（一个 adapter 解锁 Flux 1.1 全家、SDXL、Recraft、Ideogram 等数百模型）。模型 ID 三种写法：`owner/name`（official models 走 `/v1/models/{owner}/{name}/predictions`） / `owner/name:<version>` / 裸 `<64-hex>`（后两种走 `/v1/predictions` 带 `version`）。异步轮询：先用 `Prefer: wait=30` 头让短任务同步返回，未完成再每 1.5s 轮询；最长 5 分钟超时；`req.signal.aborted` 时调 `/cancel` 上游
- **`app/api/proxy/replicate/[...path]/route.ts`** —— 同 OpenAI proxy 模式，但 `Authorization: Token …`（**Replicate 用 Token 不是 Bearer**）
- **`lib/providers/dashscope-image.ts`** —— 阿里云百炼·通义万相图像。
  - **双 API 路径自动分流**：`isNewGen()` 判断 modelId
    - **新 sync**（`wan2.6+` / `wan2.7+` / `qwen-image*`）：`POST /api/v1/services/aigc/multimodal-generation/generation` 单次返回；body 用 chat-style messages
    - **老 async**（`wanx2.1-*` / `wan2.5-*`）：必带 `X-DashScope-Async: enable`，再轮询 `/api/v1/tasks/{id}`
  - **size 归一化** `normalizeNewGenSize()`：`"1K"`/`"2K"`/`"4K"` → 像素串；`"1024x1024"` / `"1024×1024"` → `"1024*1024"`；qwen-image 严格只接受 `width*height` 像素
  - **wan vs qwen 参数差异**：`isQwenImage()` 判断；qwen-image 不支持 `thinking_mode` / `watermark` / `color_palette`，UI 隐藏 + adapter 跳过
  - **响应解析双格式兼容**：wan 返回 `content: [{ type: "image", image: "url" }]`；qwen 返回 `content: [{ image: "url" }]`（**没有 `type` 字段**）；解析器只看 `item.image` 是字符串即可
  - testCall 没有公开 ping 端点，用查询不存在的 task_id 反推鉴权（401 = 无效 / 4xx 不含 InvalidApiKey = 通过）
- **`app/api/proxy/dashscope/[...path]/route.ts`** —— `Authorization: Bearer …`，转发 `X-DashScope-Async` 等百炼自定义头
- **`lib/providers/dashscope-video.ts`** —— 通义万相视频。
  - 推荐 `wan2.7-t2v-2026-04-25`（2-15 秒、720P/1080P、原生音频）/ `wan2.7-i2v-2026-04-25`；wan2.6 系列仍可用；`isNewGen()` 用 `wan2.[5-9]` 范围
  - 异步任务模式 + 同源 dashscope proxy，端点 `/api/v1/services/aigc/video-generation/video-synthesis`，输出 `output.video_url`（单条 mp4 URL）
  - **resolution 归一化** `normalizeNewGenResolution()`：UI 历史值 `"720p"` 小写 / `"1280*720"` 老格式 → 都映射到 `"720P"` / `"1080P"`（百炼 wan2.5+ 字面量校验）
  - **i2v 限制已解除**：wan2.7-i2v 直接接受 base64 首帧，不再需要公网 URL

### Capability Spec — UI 按模型能力动态渲染

`lib/types.ts` 的 `ImageParamSpec` / `VideoParamSpec` / `ExtraParam` 是真模型能力的声明书；adapter 在 `describeImageParams(modelId)` / `describeVideoParams(modelId)` 里返回。`lib/providers/capabilities.ts` 提供 `DEFAULT_*_SPEC`（对齐重构前的 UI）+ `resolveImageSpec(model)` / `resolveVideoSpec(model)`，找不到 describe* 就回 default，**零回归**。

UI（`center-composer.tsx` / `video-composer.tsx`）的高级参数 popover 完全 spec 驱动：
- `spec.size.mode === "enum"` → 渲染 select；其他 mode 当前未渲染
- `spec.maxBatch <= 1` → 隐藏 batch 选择器
- `!spec.supportsNegativePrompt` → 隐藏负向提示词
- `!spec.supportsReferenceImages` → 隐藏上传按钮
- `spec.extras` → 走 `<ExtrasPanel>` + `<ExtraField>`，按 type（select/number/text/boolean）渲染；值进 `params.extras` 由 adapter 透传上游

切模型时 `app/app/text-to-image/page.tsx` / `image-to-video/page.tsx` 用 React 19 prev-prop-during-render 模式调 `snapImageParamsToSpec` / `snapVideoParamsToSpec` snap 不兼容值；`extras` 永远 reset 到新 spec 的 `defaultExtras()`（不同模型 schema 不同）。

**加新真 provider 时记得写 `describeImageParams` / `describeVideoParams`**，按 modelId 分支返回 spec —— 这是 UI 自动适配该模型的开关，否则 UI 一律退化为 DEFAULT 全开。
- **`lib/api/generate.ts`** —— `runAdapter()` 包装：取 adapter → 跑 async generator → progress 回调 + final 落 Generation；老的 `generateImage` / `generateVideo` 签名不变

加新 provider 的最小改动：
1. 写 `lib/providers/<your>.ts`（实现 `testCall` + `generate`）
2. 在 `registry.ts` 注册
3. （需要时）在 `app/api/proxy/<your>/[...path]/route.ts` 加 proxy

加完之后管理员页 `/admin/models` 的 ProviderType 下拉就能选；测试调用按钮直接打 `adapter.testCall()`。

> **Stage-2 已落地**（2026-05）：API Key 已迁服务端 SQLite (`lumen.db`) + AES-256-GCM 加密。客户端 ModelInfo 不再持有明文 apiKey，只有 `hasApiKey: boolean`。Adapter 调 proxy 用 `X-Lumen-Model-Id` 头，server 反查 db 解密 → 转发上游。明文 key 永不离开服务端进程内存。详见 §十六。

## 十一、跨组件挂载 / 跨 tab 的状态保留

### 11.1 `lib/live-jobs.ts` — in-flight 任务的模块级注册表

**问题**：`/app/text-to-image` 和 `/app/image-to-video` 是不同路由，从视频会话切到图像会话时图像页面整个 unmount，连带 React 组件的 `cancelMap`（useRef 存的 AbortController）一起丢；切回来重挂载，`progressMap` 是空的，UI 显示 0%。但 dashscope adapter 的 generator 还活着、还在轮询，进度白白浪费。

**方案**：把 `(lastPct, lastGen, cancel, done?, finalGen?)` 存到模块级 `Map<id, LiveJob>`。模块单例不随 React 组件挂载销毁。

**生命周期**（`lib/api/generate.ts` 的 `runAdapter()`）：
1. 入口 `registerJob(id, gen, cancel)`
2. 每个 `progress` 事件 `publishProgress(id, pct, gen)`
3. `final / failed` 时 `publishFinal(id, finalGen)`，30 秒后清理

**页面消费**（image-to-video / text-to-image）：
- 会话加载完成后，对 list 中每条 `g`：
  - `getLiveJob(g.id)` 优先用模块单例的 `lastPct` 和 `lastGen` 填 `progressMap` / `stream`
  - 不存在则按 storage 状态填
- 一个 `useEffect(deps: stream id 列表)` 对每条 running 调 `subscribeJob(id, cb)`，订阅未来更新；返回退订函数

**取消按钮**也经过升级：
1. `cancelMap.current.get(id)?.()` —— 同标签页内的 in-flight job
2. `cancelLiveJob(id)` —— 跨组件挂载的注册表
3. `historyApi.update(failed)` —— **强制写盘 failed**，处理"发起任务的标签页已关闭"的僵尸条目

### 11.2 `lib/last-tab-route.ts` — Tab 路由记忆

每个一级 tab（创作 / 视频 / 画布）记住自己上次访问的完整 URL（含 `?s=` 会话）。在 `icon-rail.tsx`：
- effect 1：当前 tab 内的 URL 变化 → 写 localStorage `lumen:last-tab-route:<key>`
- effect 2：路由变化时刷新 tab 链接的 `href`（优先用记住的 URL）

**特例**：active tab 上点自己仍然回基础路径（"重置回 tab 主页"）；其他 tab 的链接才走记忆的 URL。

### 11.3 不覆盖的场景

- **多标签页同时跑同一会话**：每个 tab 的 live-jobs Map 是独立的；A tab 跑、B tab 看，B 显示 0%。要解决得加 BroadcastChannel + localStorage event 同步
- **整页 F5 刷新**：模块单例随 JS 上下文销毁，cancelMap 也丢了。要解决得做服务端任务持久化（task_id 存数据库 + 重连轮询）

---

## 十二、Enter 发送约定

`Enter` 发送 / `Shift+Enter` 换行，且必须用 `e.nativeEvent.isComposing` 兜底中文输入法 composition：

```ts
if (
  e.key === "Enter"
  && !e.shiftKey
  && !e.nativeEvent.isComposing
) {
  e.preventDefault();
  onSubmit();
}
```

涉及的文件：`components/workspace/center-composer.tsx` / `video-composer.tsx` / `components/canvas/nodes/image-node.tsx` / `video-node.tsx`。新加输入框时记得套这套规则。

---

## 十三、媒体处理工具（腾讯云 MPS 接入）

`/app/tools` 是独立于"创作三件套"之外的**真实云服务工具集**，复用管理员配置的腾讯云 SecretId/SecretKey。

- **`/admin/media-processing`** —— 配置 SecretId / SecretKey / Region / COS Bucket。同一套密钥被工具页 + 画布的 panorama 节点共用
- **`app/api/proxy/tencent-mps/route.ts`** —— TC3-HMAC-SHA256 签名 proxy。浏览器以 `X-Lumen-API-Key: <secretId>:<secretKey>` 头送密钥，proxy 服务端做完整 V3 签名后转发到 `mps.tencentcloudapi.com`
- **`app/api/cos-sign/route.ts` / `app/api/cos-get-sign/route.ts`** —— COS V4 签名（HMAC-SHA1 链）。前者签 PUT 直传 URL，后者签 GET 预览 URL（私有桶播放用）
- **`lib/api/media-processing.ts`** —— 封装 `callMps<T>()` / `describeTaskDetail` / `extractOutputUrls` / `signGetUrl` / `listTemplates`（按 TemplateKind 拉账号下模板列表）
- **`lib/director/media-tools.ts`** —— 10 个工具元数据（`MediaToolMeta[]`）+ `buildProcessMediaPayload()` 按 `toolId` 构造 ProcessMedia payload
  - 转码类（`MediaProcessTask.TranscodeTaskSet`）：极速高清转码 / 音视频增强 / 添加数字水印 / 截图转动图
  - AI 类（顶级字段，**不**在 `MediaProcessTask` 里）：智能擦除 (`SmartEraseTask`) / 智能字幕 (`SmartSubtitlesTask`) / AI 配音 (`AiAnalysisTask` Definition=32) / 智能拆条 / 精彩集锦 (`AiAnalysisTask`) / 媒体质检 (`AiQualityControlTask`)
- **任务流**：浏览器 → POST /api/proxy/tencent-mps（ProcessMedia） → 拿 `TaskId` → 5s 轮询 `DescribeTaskDetail` → `Status=FINISH` → `extractOutputUrls()` 解析 `WorkflowTask` 或 `ProcessMediaTask` 包装下的输出 → 私有桶 GET 签名 → 节点内 `<video/img>` 播放 + 一键下载

**踩过的坑**：
- 用 `WorkflowTask` 包装的响应（不是 `ProcessMediaTask`）—— `extractOutputUrls` 必须两个都查
- DescribeTranscodeTemplates 默认只返 Custom 模板，不带 Preset；增强模板（`327001-327004` 等）用 `Definitions: [...]` 显式查询，避免列表为空
- AI 配音的 `ExtendedParameter` 必须传**字符串化的 JSON**（不是对象）

## 十四、画布全景管线（已删除）

2026-05-08 全部回滚 —— 扩图节点（outpaint）/ 全景场景节点（panorama）/ 全景工作流模板 + 相关 provider adapters / 投影数学 / 沉浸预览 viewer / admin/outpaint 设置页 / sidebar 入口 全部移除。

回滚原因：免费 provider（HF Space `fffiloni/diffusers-image-outpaint`）协议不稳，付费 provider（Replicate flux-fill-pro）成本高，方案对 lumen 当前阶段不合适。后续如重做需重新设计 provider 选型。

被删除的文件清单（如需恢复，参照 git 历史）：
- `lib/panorama-projection.ts` / `lib/panorama-presets.ts`
- `lib/api/outpaint.ts` / `lib/api/outpaint-settings.ts`
- `lib/providers/hf-outpaint.ts` / `lib/providers/replicate-outpaint.ts`
- `components/canvas/nodes/outpaint-node.tsx` / `components/canvas/nodes/panorama-node.tsx`
- `components/canvas/panorama-viewer.tsx`
- `app/panorama-view/page.tsx` / `app/admin/outpaint/page.tsx`

## 十五、当前未完成的大块工作

- **更多真 provider** —— Stability / fal / ComfyUI / Generic-HTTP，按 §十 末尾的 3 步加
- **真后端**（Auth.js + Prisma + OSS 直传）—— 方案已沉淀，未启动；stage-2 加密层已就位（详见 §十六）可直接迁
- **跨标签页 / 跨刷新的进度保留** —— BroadcastChannel + 服务端 task_id 持久化
- **inpaint / 涂抹编辑** —— 需要真模型，目前占位
- **撤销 / 重做** —— xyflow 自带删除选中，未做手动 undo stack
- **全景管线**（如重做）—— 见 §十四 删除原因；重做需先解决 provider 稳定性

详见 `docs/PRD.md`。

---

## 十六、Stage-2 API Key 服务端加密（2026-05 已落地）

API Key 已从 localStorage 完全迁到服务端 SQLite + AES-256-GCM 加密。客户端永远拿不到明文。

**新增文件**：
- **`lib/server/db.ts`** —— `better-sqlite3` 单例（dev 热重启用 `globalThis` 缓存）+ schema migrations。表 `models` 含 `api_key_encrypted` 字段，表 `cloned_voices` 存 CosyVoice 复刻音色
- **`lib/server/master-key.ts`** —— 主密钥读取：优先 `process.env.LUMEN_MASTER_KEY`（生产）→ fallback `<root>/.lumen-master.key`（dev 自动生成 32 字节 hex）。文件已加 .gitignore
- **`lib/server/crypto.ts`** —— AES-256-GCM 加 / 解密。输出格式 `base64(iv(12B) || tag(16B) || ciphertext)`
- **`lib/server/models-store.ts`** —— `listModels` / `getModel` / `createModel` / `updateModel` / `deleteModel` / `setEnabled` / `bulkUpdateCredentials` + `resolvePlaintextApiKey(modelId)`（仅 proxy 路由调用）
- **`lib/server/proxy-auth.ts`** —— `resolveProxyAuth(req)`：优先 `X-Lumen-Model-Id` 头反查 db 解密 → 否则 fallback `X-Lumen-API-Key` 明文（仅草稿态）
- **`lib/providers/proxy-headers.ts`** —— `setProxyAuthHeader(headers, init)` 客户端 helper，让 8 个 adapter 统一注入鉴权头
- **`app/api/admin/models/route.ts`** + `[id]/route.ts` + `bulk-credentials/route.ts` —— 真 CRUD 端点

**API 路由变更**：所有 7 个 proxy 路由（dashscope / openai / replicate / minimax / ark / volcengine / tencent-mps）都改用 `resolveProxyAuth(req)`，HOP_BY_HOP 同时屏蔽 `x-lumen-api-key` 和 `x-lumen-model-id` 不让转发上游。

**ModelInfo 类型变化**：`apiKey?: string`（仅草稿态有值；GET 回来恒为 undefined），新增 `hasApiKey?: boolean`。`isReadyForUse(m)` 用 `hasApiKey` 判断而不是 `apiKey`。

**SeedBootstrap 启动迁移**：检测 localStorage `lumen:customModels` 残留 → 自动 POST 到 /api/admin/models 加密上迁 → 清掉旧数据 + toast 提示。

**Provider 家族重构**：admin/models 页 UI 已改成「家族优先」布局。新 ProviderType：`bailian-tongyi` / `bailian-qwen` / `bailian-thirdparty`（含 11 个 qwen-image SKU）。即梦 image+video 合并为「即梦 AI」家族；豆包 Seedream+Seedance 合并为「豆包」。`dashscope-image` / `dashscope-video` 标记 [已废弃] 但保留兼容老配置。

**rollback**：`backup/admin-models-page.legacy.tsx.bak` 是改造前的备份。

---

## 十七、音频工作站 `/app/audio`（4 tab）

路由从 `/app/voice` 改名 `/app/audio`，侧栏「配音」→「音频」。4 个 tab 用 `<div hidden={tab!==key}>` 切换（始终挂载，切 tab 不丢已生成结果）。

**Tab 1 · 配音**（`tts-panel.tsx` + `clone-voice-dialog.tsx`）：
- CosyVoice 2 文本→语音
- 86 个内置音色（`lib/voice-presets.ts`）+ 试听按钮（缓存到 ref）+ 搜索框 + 8 语种 chip 筛选
- 5 个模型版本下拉（v3.5-plus / v3-flash / v2 等）
- 速率滑块 0.5x ~ 2.0x
- 「我的复刻音色」区：点「+ 新建」打开对话框 → 粘贴公网 wav URL → 服务端调阿里 voice-enrollment API → 拿 voice_id 存 db
- 端到端：浏览器 → POST `/api/voice/synthesize` → 服务端 WebSocket 中继到 dashscope wss → 收完整 audio mp3 → 返回 audio/mpeg

**Tab 2 · 字幕**（`asr-panel.tsx`）：
- Qwen3-ASR 语音转文字
- 双入口切换：「上传文件 · 短音频」走同步 multimodal-generation 接受 base64 dataURL（≤ 25MB，输出纯文本）；「公网 URL · 带时间戳」走异步 transcription 接受 https URL（任意长度，输出 SRT + 纯文本）
- 路由 `/api/voice/asr` 自动分流
- 6 种语言可选 + 自动检测（52 语种 + 22 中文方言）

**Tab 3 · 分离**（`separate-panel.tsx`）：
- Demucs 4 轨人声 / 鼓 / 贝斯 / 其它
- 浏览器直连 HuggingFace Space（用 `lib/hf-direct.ts`，避开 Node 国内拦截）
- 3 个备选 Space 切换下拉（拥堵时换一个）+ 3 次自动重试（指数退避 1.5s/3s/6s）

**Tab 4 · 降噪**（`denoise-panel.tsx`）：
- DeepFilterNet 3 浏览器本地降噪（npm 包 `deepfilternet3-noise-filter`）
- 走 OfflineAudioContext + AudioWorkletNode 离线渲染整个文件
- 数据零外传 · 首次需下载 ~10MB wasm 模型

**服务端 API**：
- `app/api/voice/synthesize/route.ts` —— TTS WebSocket 中继
- `app/api/voice/asr/route.ts` —— ASR 双路径（同步 / 异步轮询）
- `app/api/voice/clones/route.ts` + `[id]/route.ts` —— 复刻音色 CRUD
- 全部复用 `resolveBailianApiKey()`（自动从 db 找 bailian-* 家族任一已配 Key）—— 用户无需单独为音频工作站配 Key

---

## 十八、admin/media-processing（腾讯云 MPS）现状

- **AI 配音工具已下线**（参考音色 JSON Schema 用腾讯音色库 VoiceId 内测限制 + 字幕 JSON 链路冗长）。`MediaProcessingToolId` 联合类型注释已说明改用 `/app/audio` 配音 tab 的 CosyVoice 2
- 其它 9 个工具保留：极速高清转码 / 音视频增强 / 智能擦除 / 智能字幕 / 智能拆条 / 精彩集锦 / 添加数字水印 / 媒体质检 / 截图转动图
