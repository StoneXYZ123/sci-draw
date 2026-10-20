# sci-draw

科研插图工作台的 P0–P4：邮箱注册登录、积分账本、prompt / sketch / replicate 出图、对话列表、SVG / PPTX 转换、表格作图、可编辑表格导出、`sd_` API key 的公开接口、可选的 VSDX 提供方，以及 Stripe 测试模式买积分。

界面和文案是重新写的，不使用 sci-draw.com 的标识、插画或页面结构。

## 这个版本做什么

- Next.js App Router + TypeScript，pnpm workspace，Turborepo
- better-auth 邮箱密码：`POST /api/auth/sign-up/email`、`POST /api/auth/sign-in/email`、`GET /api/auth/get-session`
- Postgres + Drizzle：`user`、`session`、`account`、`verification`、`credit_ledger`、`conversation`、`message`、`job`、`upload_object`
- 新用户赠送积分（默认 **20**，可用 `CREDITS_SIGNUP_BONUS` 调整）
- AI Drawing：
  - `POST /api/ai-drawing/generate` → **202** `{ id, status: "pending" }`
  - `GET /api/ai-drawing/tasks/{id}` 轮询到 `completed` 或 `failed`
  - `GET /api/ai-drawing/capabilities`
  - `GET /api/ai-drawing/conversations?limit=&offset=` 列出历史；`GET` / `DELETE /api/ai-drawing/conversations/{id}` 读取或删除。页面上的删除走 server action `deleteConversationAction`，与 DELETE 共用同一函数
- 模式：`prompt`（字段 `prompt`）、`sketch` 与 `replicate`（字段 `supplementaryPrompt` + `uploadedImageObjectKey`）。`custom` 仍返回 400
- 页面可选 `templateId` / `styleId`（`none` 表示不附加说明）和 `batchCount` 1 或 2。模板和风格只在发给模型的文本后追加一句短提示，不改写入对话的用户原文
- 2K 单价 5 积分，4K 单价 10，按 `batchCount` 相乘。入口先预留，成功再记一条消耗，失败则回滚。源图未就绪时直接 400，不预留积分
- `ImageProvider`：配置了 `GEMINI_API_KEY` 时走 Gemini Flash Image（默认模型 `gemini-3.1-flash-image`），sketch / replicate 会把源图作为 `inlineData` 一并送出；没有密钥时用 mock，返回一张本地占位 PNG
- 结果图：R2 环境变量齐全时上传到桶并返回 `CDN_PUBLIC_BASE` 上的 URL；否则写到本地，经 `/api/media/image-results/...` 提供
- 源图：`POST /api/storage/direct-upload`，`purpose` 为 `ai-drawing-source`（出图）或 `convert-source`（转换），流程是 presign → PUT → complete。有 R2 时 PUT 到预签名地址；没有 R2 时 PUT 到带签名的 `/api/storage/local-upload`。只接受 PNG / JPEG / WebP，最大 5 MB。源图不走公开的结果图地址
- 页面：`/ai-drawing` 与 `/zh/ai-drawing`，可用 `?mode=sketch` 或 `?mode=replicate`。左侧列出已完成的对话，可打开或删除。结果图上可以转成 SVG 或 PPTX
- 表格作图：`/sci-vis` 与 `/zh/sci-vis`
  - `POST /api/sci-vis/upload`，`purpose` 为 `sci-vis-data`，流程仍是 presign → PUT → complete。CSV / TSV / TXT / XLSX / XLS，最大 5 MB
  - `POST /api/sci-vis/stream` 用 SSE（`data: {json}`）。顺序是 `status`、`session_ready`、`progress`、`preview`、`result`（`code`、`imageUrl`、`formats`、`engine`、`creditsConsumed`）、`complete`。失败时发 `failed` 并退回预留积分
  - 这一版实际作图的是 CSV、TSV、TXT。XLSX / XLS 可以上传，发起 stream 时返回 400，不扣积分
  - `POST /api/sci-vis/export-xlsx` 对当前用户已完成的 generation 生成可编辑 xlsx（数据表 + 图表参数表），扣 **10** 积分。可选 `Idempotency-Key`：同一把钥匙返回同一次导出；不带钥匙则每次各扣一次。匿名 **401**，别人的 generation **404**，余额不足 **402**
  - 沙箱：有 `E2B_API_KEY` 时用 E2B；有 Modal 的 token 和 `SCIVIS_MODAL_ENDPOINT` 时用 Modal；否则在本机跑 matplotlib / seaborn。本机没有这些库时仍返回同一份脚本和一张占位图，`engine` 为 `mock`
  - 调用方提交的 `currentCode` 只在 E2B 或 Modal 里执行。本机路径返回 `failed`，`errorCode` 为 `SANDBOX_REQUIRED`，积分退回。沙箱超时或脚本非 0 退出同样退回，不另收重试费
  - 远程沙箱并且配置了 `GEMINI_API_KEY` 时，可以用 Gemini 改写脚本再执行。没有密钥时用内置模板
- 转换（`CONVERT_PROVIDER=opensource`，这是默认值）：
  - `POST /api/convert-to-svg` 同步，`mode` 为 `text-only` 或 `full`，返回 `svgUrl` 与 `creditsConsumed`
  - `POST /api/convert-to-pptx` 同步，返回 `pptxUrl`
  - `POST /api/convert-format` 给 `/convert` 页使用：`objectKey`、`filename`、`format`（svg / pptx / png / pdf / tiff）、可选 `mode` 与 `dpi`，返回 `downloadUrl`
  - `GET /api/download-image?url=` 只代理当前用户自己的结果文件，并带下载头
  - `POST /api/convert-to-vsdx`：未配置 `CONVERT_VSDX_PROVIDER`（或 `cloudconvert` 但没有 `CLOUDCONVERT_API_KEY`）时仍写入一条失败任务并返回 **202**，`POST /api/convert-to-vsdx/complete` 返回 **501** `NOT_IMPLEMENTED`，不扣积分。设为 `mock` 时在进程内写出一个 VSDX 压缩包并扣 **20**；设为 `cloudconvert` 且有密钥时把图交给 CloudConvert，成功后 `complete` 返回 `vsdxUrl`。失败会回滚预留。这一步用和出图相同的进程内 `after()`，没有另接 Inngest：单进程里轮询即可结束，多实例持久队列仍不在这一版
- 源图用途增加 `convert-source`，仍然走 presign → PUT → complete。没有 R2 时落到本地签名地址
- 路径描摹用 potrace 的 JavaScript 移植（GPL-2.0）。`text-only` 是文字层占位，这一版没有接 OCR。PPTX 用 pptxgenjs。PNG / TIFF 用 sharp，PDF 把 sharp 产出的 PNG 包进单页 PDF

积分：

| 操作 | 积分 |
|------|------|
| 绘图 2K / 4K，再乘张数 | 5 / 10 |
| SVG text-only / full | 10 / 15 |
| PPTX | 10 |
| VSDX（未配置提供方时不扣；配置后扣） | 20 |
| PNG、PDF、TIFF，300 / 600 / 1000 DPI | 5 / 10 / 15 |
| SciVis 作图 / 接着改 | 10 / 10 |
| SciVis 表格导出 | 10 |
| 购买积分（Stripe `purchase.stripe`） | 100 / 500 / 2000 |

转换和表格作图都是先预留再确认，失败回滚。转换账本是 `convert.reserve`、`convert.consume`、`convert.rollback`。表格作图是 `sci_vis.reserve`、`sci_vis.consume`、`sci_vis.rollback`。

出图、公开 API 的异步任务，以及已配置的 VSDX，都在进程内通过 `after()` 执行。限制见下文「已知限制」。

## Public API

登录后打开 `/settings/api-keys` 创建钥匙。明文只在创建响应里出现一次，库里只存 SHA-256。请求带 `Authorization: Bearer sd_…`，不接受浏览器会话。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/credits` | `{ "balance": n }` |
| POST | `/api/v1/images/generations` | JSON：`prompt`、`aspect_ratio`、`resolution`、`count`（1–4）。2K 为 5×count，4K 为 10×count |
| POST | `/api/v1/images/edits` | multipart：`image` + `prompt`，按草图编辑计价 |
| POST | `/api/v1/images/conversions` | multipart：`image`、`format`、`vector_mode`、`dpi`。`Prefer: wait` 会在这次请求里等短任务结束。`vsdx` 在提供方未配置时返回 **501**，不扣费 |
| POST | `/api/v1/charts/generations` | multipart CSV。成功结果只有图片 URL，**没有** `code` |
| GET | `/api/v1/jobs/{job_id}` | `queued` / `processing` / `succeeded` / `failed` / `canceled` |

字段是 snake_case。可选请求头 `Idempotency-Key`（8–200 位）避免同一把钥匙重复扣费。无效钥匙 **401**，余额不足 **402** `error_code: INSUFFICIENT_CREDITS`。形状见 `docs/openapi.yaml`。

公开出图不写入对话列表。Web 出图仍然会。

## 购买积分

`/billing` 列出 100、500、2000 三档。`POST /api/billing/checkout` 创建 Stripe Checkout Session。`POST /api/billing/webhook` 校验 `Stripe-Signature`，在 `checkout.session.completed` 且已支付时按价目入账。`ref_id` 是 Checkout Session id，`reason` 是 `purchase.stripe`，重复事件不会加第二次。密钥未配置时结账返回 **503**，不会改余额。

## VSDX

`CONVERT_VSDX_PROVIDER` 为空时保持上面的不扣费占位，方便没有厂商账号的环境。`mock` 生成的包能走通下载和扣费，不保证每一版 Visio 都能打开。`cloudconvert` 才是交给外部转换器的路径；没有 `CLOUDCONVERT_API_KEY` 时仍走不扣费占位。没有引入 Inngest：转换和轮询都留在当前进程的 `after()` 里，和出图任务同一限制。

## 本地启动

需要 Node.js 22 和 Postgres 16。

```bash
docker compose up -d
cp .env.example apps/web/.env
# 编辑 apps/web/.env，至少填入 BETTER_AUTH_SECRET（openssl rand -base64 32）
pnpm install
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000/ai-drawing>。注册后余额应为 20。提交一次 2K、张数 1 的 prompt 后余额变为 15，左侧出现这条对话。草图和复刻需要先选一张本地图片，再写补充说明。独立转换页在 <http://localhost:3000/convert>。表格作图在 <http://localhost:3000/sci-vis>。

不需要为源图上传增加新的环境变量。R2 相关变量留空时，源图和结果图都落在 `apps/web/.data`（或 `LOCAL_MEDIA_DIR`）。

没有 Docker 时，把 `DATABASE_URL` 指到任意 Postgres，再执行 `pnpm db:migrate`。

只跑 mock、不调用 Gemini：

```bash
IMAGE_PROVIDER=mock
```

`IMAGE_PROVIDER=gemini` 且 `GEMINI_API_KEY` 为空时，同样自动使用 mock。

## 目录

```
apps/web                 Next.js 应用、Drizzle schema、API
packages/schemas         generate / capabilities 的 zod
packages/credits         绘图与转换计价
packages/providers       ImageProvider、ConvertProvider
```

## 验收脚本

Postgres 已迁移、应用已在 `127.0.0.1:3000` 监听时：

```bash
node scripts/p0-smoke.mjs
```

`scripts/p0-smoke.mjs` 会注册、读 session、匿名生成得到 401、提交 prompt、轮询到图、确认积分从 20 扣到 0，并在下一次请求得到 402 `INSUFFICIENT_CREDITS`。

`scripts/p1-smoke.mjs` 在此之上检查对话列表、本地源图直传、sketch（张数 2）和 replicate，并确认积分仍按预留 / 消耗结算。

```bash
node scripts/p1-smoke.mjs
node scripts/p2-smoke.mjs
```

`scripts/p2-smoke.mjs` 检查匿名 401、VSDX 占位不扣费、已生成图片转 full SVG、`/convert` 用的 `convert-format`（text-only SVG、PPTX、300 DPI PNG），以及余额不足时的 402。

`scripts/p3-smoke.mjs` 检查匿名 401、XLSX 上传后 stream 为 400 且不扣费、CSV 走 SSE 得到代码和 PNG、本机拒绝 `currentCode` 并退回积分、接着改再扣 10。此时余额为 0，表格导出返回 **402**，再发起 stream 也是 402。

`scripts/p4-smoke.mjs` 检查有余额时的 xlsx 下载和扣 10、别人的 generation 为 404、API key、`/api/v1` 出图 / 转换 / 编辑 / 作图（作图响应没有 `code`）、未配置时的 VSDX 不扣费，以及未配置 Stripe 时的 503。

```bash
node scripts/p4-smoke.mjs
```

## 已知限制

- 出图任务由 `POST /api/ai-drawing/generate` 里的 Next.js `after()` 在当前进程执行。进程退出、重新部署或崩溃后，任务不会继续，也没有跨实例的持久队列。
- 轮询时，`running` 超过 6 分钟（`STALE_MS`）会走失败认领：只有 `UPDATE … WHERE status IN ('pending','running')` 抢到行，才会把任务标为 `failed` 并退回预留积分。成功路径先抢 `completed`（仅 `status = 'running'`），抢到之后才记消耗。SciVis 的 SSE 用同一套认领。
- 积分账本对 `(ref_id, reason)` 在 `ref_id IS NOT NULL` 时唯一，注册赠送另有 `reason = 'signup_bonus'` 的用户唯一索引。并发确认、回滚或赠送撞上 Postgres `23505` 时当作已经记过，不再改余额。
- 因此一次失败至多退一次，一次成功至多记一条消耗。购买入账使用同一条 `(ref_id, reason)` 唯一索引。这仍不是多实例、多地域的任务编排。
- VSDX 的 CloudConvert 轮询也在这一次 `after()` 里，上限大约 90 秒。进程退出后任务不会继续。没有接 Inngest：当前部署约定仍是单进程，单独加队列不会改变积分认领规则，也解决不了多实例。

## 之后不做在这一版里的事

OAuth、像素级复刻现有产品界面、MCP、出版证书，都不在范围内。多实例任务队列也还没有接。
