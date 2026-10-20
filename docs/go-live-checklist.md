# 上线前手工清单

这一版没有把真实 Stripe、CloudConvert 或 Visio 放进 CI。下面几项在真正收费或交给外部转换之前手工做一次。不要把 live key 或厂商密钥写进 CI。

1. **Stripe 测试 webhook。** 只用 `sk_test_` 和 `whsec_`。`stripe listen --forward-to localhost:3000/api/billing/webhook`，走一笔测试 Checkout。余额增加一次，账本只有一行 `purchase.stripe`，`ref_id` 是该 Checkout Session id。再投递同一事件，余额不变。
2. **金额不一致不入账。** 把某一档 Price 配成与 `STRIPE_AMOUNT_CENTS_*`（或默认 500 / 2000 / 8000 分）不同的金额，再付一笔测试款。Webhook 应忽略，不调用入账，余额不变。
3. **CloudConvert 与打开文件。** `CONVERT_VSDX_PROVIDER=cloudconvert` 且配置真实 `CLOUDCONVERT_API_KEY`。下载得到的 vsdx，在本机用 Visio 或 LibreOffice 打开。`mock` 只用于开发，不扣积分，也不当作已认证的 Visio 文件。
4. **撤销 API key。** 在 `/settings/api-keys` 撤销一把 `sd_` 钥匙后，`GET /api/v1/credits` 带这把钥匙应返回 **401**。
