# sci-draw

科研插图工作台的 P0–P3：邮箱注册登录、积分账本、prompt / sketch / replicate 出图、对话列表、SVG / PPTX 转换，以及表格作图。

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
  - `POST /api/sci-vis/export-xlsx` 是占位，返回 **501** `NOT_IMPLEMENTED`，不扣积分
  - 沙箱：有 `E2B_API_KEY` 时用 E2B；有 Modal 的 token 和 `SCIVIS_MODAL_ENDPOINT` 时用 Modal；否则在本机跑 matplotlib / seaborn。本机没有这些库时仍返回同一份脚本和一张占位图，`engine` 为 `mock`
  - 调用方提交的 `currentCode` 只在 E2B 或 Modal 里执行。本机路径返回 `failed`，`errorCode` 为 `SANDBOX_REQUIRED`，积分退回。沙箱超时或脚本非 0 退出同样退回，不另收重试费
  - 远程沙箱并且配置了 `GEMINI_API_KEY` 时，可以用 Gemini 改写脚本再执行。没有密钥时用内置模板
- 转换（`CONVERT_PROVIDER=opensource`，这是默认值）：
  - `POST /api/convert-to-svg` 同步，`mode` 为 `text-only` 或 `full`，返回 `svgUrl` 与 `creditsConsumed`
  - `POST /api/convert-to-pptx` 同步，返回 `pptxUrl`
  - `POST /api/convert-format` 给 `/convert` 页使用：`objectKey`、`filename`、`format`（svg / pptx / png / pdf / tiff）、可选 `mode` 与 `dpi`，返回 `downloadUrl`
  - `GET /api/download-image?url=` 只代理当前用户自己的结果文件，并带下载头
  - `POST /api/convert-to-vsdx` 写入一条失败任务并返回 **202**；`GET ?jobId=` 轮询；`POST /api/convert-to-vsdx/complete` 返回 **501** `NOT_IMPLEMENTED`。这条路径不扣积分
- 源图用途增加 `convert-source`，仍然走 presign → PUT → complete。没有 R2 时落到本地签名地址
- 路径描摹用 potrace 的 JavaScript 移植（GPL-2.0）。`text-only` 是文字层占位，这一版没有接 OCR。PPTX 用 pptxgenjs。PNG / TIFF 用 sharp，PDF 把 sharp 产出的 PNG 包进单页 PDF

积分：

| 操作 | 积分 |
|------|------|
| 绘图 2K / 4K，再乘张数 | 5 / 10 |
| SVG text-only / full | 10 / 15 |
| PPTX | 10 |
| VSDX（未实现，不扣） | 表价 20 |
| PNG、PDF、TIFF，300 / 600 / 1000 DPI | 5 / 10 / 15 |
| SciVis 作图 / 接着改 | 10 / 10 |
| SciVis 表格导出（未实现，不扣） | 表价 10 |

转换和表格作图都是先预留再确认，失败回滚。转换账本是 `convert.reserve`、`convert.consume`、`convert.rollback`。表格作图是 `sci_vis.reserve`、`sci_vis.consume`、`sci_vis.rollback`。

任务在进程内执行。这一版没有接入 Inngest，VSDX 也只是进程内的占位记录。

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

`scripts/p3-smoke.mjs` 检查匿名 401、XLSX 上传后 stream 为 400 且不扣费、CSV 走 SSE 得到代码和 PNG、本机拒绝 `currentCode` 并退回积分、接着改再扣 10、表格导出 501，以及余额为 0 时的 402。

## 之后不做在这一版里的事

| 阶段 | 内容 |
|------|------|
| P4 | Public API、VSDX 真实现、SciVis 表格导出、支付 |

OAuth、像素级复刻现有产品界面，都不在范围内。
