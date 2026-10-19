# sci-draw

科研插图工作台的 P0–P1：邮箱注册登录、积分账本、prompt / sketch / replicate 出图，以及对话列表。

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
- 源图：`POST /api/storage/direct-upload`，`purpose` 固定为 `ai-drawing-source`，流程是 presign → PUT → complete。有 R2 时 PUT 到预签名地址；没有 R2 时 PUT 到带签名的 `/api/storage/local-upload`。只接受 PNG / JPEG / WebP，最大 5 MB。源图不走公开的结果图地址
- 页面：`/ai-drawing` 与 `/zh/ai-drawing`，可用 `?mode=sketch` 或 `?mode=replicate`。左侧列出已完成的对话，可打开或删除

任务在进程内于 202 返回之后执行，轮询时如果仍是 `pending` 也会再次拉起。P1 没有接入 Inngest，本地和 CI 都不需要队列进程。

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

打开 <http://localhost:3000/ai-drawing>。注册后余额应为 20。提交一次 2K、张数 1 的 prompt 后余额变为 15，左侧出现这条对话。草图和复刻需要先选一张本地图片，再写补充说明。

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
packages/credits         2K=5、4K=10
packages/providers       ImageProvider（gemini | mock）
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
```

## 之后不做在这一版里的事

| 阶段 | 内容 |
|------|------|
| P2 | SVG / PPTX 转换、`/convert`、光栅导出；VSDX 仍可只留队列占位 |
| P3 | SciVis 上传、SSE、Python 沙箱 |
| P4 | Public API、证书、支付 |

OAuth、像素级复刻现有产品界面，都不在范围内。
