# sci-draw

科研插图工作台的 P0：邮箱注册登录、积分账本，以及仅 **prompt** 模式的文生图。

界面和文案是重新写的，不使用 sci-draw.com 的标识、插画或页面结构。

## 这个版本做什么

- Next.js App Router + TypeScript，pnpm workspace，Turborepo
- better-auth 邮箱密码：`POST /api/auth/sign-up/email`、`POST /api/auth/sign-in/email`、`GET /api/auth/get-session`
- Postgres + Drizzle：`user`、`session`、`account`、`verification`、`credit_ledger`、`conversation`、`message`、`job`
- 新用户赠送积分（默认 **20**，可用 `CREDITS_SIGNUP_BONUS` 调整）
- AI Drawing 只开放 prompt：
  - `POST /api/ai-drawing/generate` → **202** `{ id, status: "pending" }`
  - `GET /api/ai-drawing/tasks/{id}` 轮询到 `completed` 或 `failed`
  - `GET /api/ai-drawing/capabilities`
- 2K 单价 5 积分，4K 单价 10，按 `batchCount` 相乘。入口先预留，成功再记一条消耗，失败则回滚
- `ImageProvider`：配置了 `GEMINI_API_KEY` 时走 Gemini Flash Image（默认模型 `gemini-3.1-flash-image`）；没有密钥时用 mock，返回一张本地占位 PNG
- 对象存储：R2 环境变量齐全时上传到桶并返回 `CDN_PUBLIC_BASE` 上的 URL；否则把文件写到本地，经 `/api/media/image-results/...` 提供
- 页面：`/ai-drawing` 与 `/zh/ai-drawing`（提示词、2K、张数 1、比例 4:3）

任务在进程内于 202 返回之后执行，轮询时如果仍是 `pending` 也会再次拉起。这样本地和 CI 不需要 Inngest。队列服务留到后续阶段。

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

打开 <http://localhost:3000/ai-drawing>。注册后余额应为 20。提交一次 2K prompt 后余额变为 15，页面显示结果图。

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

脚本会注册、读 session、匿名生成得到 401、提交 prompt、轮询到图、确认积分从 20 扣到 0，并在下一次请求得到 402 `INSUFFICIENT_CREDITS`。

## 之后不做在这一版里的事

| 阶段 | 内容 |
|------|------|
| P1 | 对话列表、sketch / replicate、R2 源图直传、template/style 关键词、Inngest |
| P2 | SVG / PPTX 转换、`/convert`、光栅导出；VSDX 仍可只留队列占位 |
| P3 | SciVis 上传、SSE、Python 沙箱 |
| P4 | Public API、证书、支付 |

OAuth、像素级复刻现有产品界面，都不在范围内。
