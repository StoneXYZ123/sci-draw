import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const csv = Buffer.from("group,value\nA,1\nB,3\nC,2\n", "utf8");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function jsonHeaders(cookie, extra) {
  const headers = { "content-type": "application/json", origin: baseUrl, ...extra };
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(`${baseUrl}/api/ai-drawing/capabilities`);
      if (response.ok) {
        return;
      }
    } catch {
      // server still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Server did not start");
}

function cookieHeader(response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseSse(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    const line = block.split("\n").find((item) => item.startsWith("data: "));
    if (!line) {
      continue;
    }
    events.push(JSON.parse(line.slice(6)));
  }
  return events;
}

async function signup(label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 45_000) {
    const email = `p4-${label}-${Date.now()}@example.com`;
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "P4 Tester", email, password: "password123" }),
    });
    const body = await readJson(response);
    if (response.status === 429) {
      last = body;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    assert(response.ok, `sign-up failed ${response.status} ${JSON.stringify(body)}`);
    return cookieHeader(response);
  }
  throw new Error(`sign-up stayed rate limited ${JSON.stringify(last)}`);
}

async function balance(cookie) {
  const response = await fetch(`${baseUrl}/api/me`, { headers: { cookie, origin: baseUrl } });
  const body = await readJson(response);
  return body.user.creditsBalance;
}

async function uploadCsv(cookie) {
  const presign = await fetch(`${baseUrl}/api/sci-vis/upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ action: "presign", filename: "groups.csv", contentType: "text/csv", size: csv.byteLength }),
  });
  const presignBody = await readJson(presign);
  assert.equal(presign.status, 200, JSON.stringify(presignBody));
  const put = await fetch(presignBody.uploadUrl, { method: "PUT", headers: presignBody.headers, body: csv });
  assert.equal(put.status, 200, await put.text());
  const complete = await fetch(`${baseUrl}/api/sci-vis/upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ action: "complete", objectKey: presignBody.objectKey }),
  });
  assert.equal(complete.status, 200, JSON.stringify(await readJson(complete)));
  return presignBody.objectKey;
}

async function chart(cookie) {
  const objectKey = await uploadCsv(cookie);
  const response = await fetch(`${baseUrl}/api/sci-vis/stream`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ data: { objectKey, filename: "groups.csv" }, chartTypes: ["line"] }),
  });
  const events = parseSse(await response.text());
  const result = events.find((event) => event.type === "result");
  assert.equal(response.status, 200, JSON.stringify(events));
  assert.equal(typeof result.generationId, "string");
  return result;
}

function bearer(secret) {
  return { authorization: `Bearer ${secret}` };
}

async function pollJob(secret, id) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const response = await fetch(`${baseUrl}/api/v1/jobs/${id}`, { headers: bearer(secret) });
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    if (body.status === "succeeded" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Job ${id} did not finish`);
}

function assertNoCodeKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoCodeKey(item);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    assert.equal(Object.hasOwn(value, "code"), false);
    for (const item of Object.values(value)) {
      assertNoCodeKey(item);
    }
  }
}

async function createKey(cookie, name) {
  const response = await fetch(`${baseUrl}/api/api-keys`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.match(body.secret, /^sd_/);
  return body;
}

async function main() {
  await waitForServer();

  const anonymousExport = await fetch(`${baseUrl}/api/sci-vis/export-xlsx`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ generationId: "a".repeat(64) }),
  });
  assert.equal(anonymousExport.status, 401);

  const owner = await signup("xlsx");
  assert.equal(await balance(owner), 20);
  const charted = await chart(owner);
  assert.equal(await balance(owner), 10);
  const exported = await fetch(`${baseUrl}/api/sci-vis/export-xlsx`, {
    method: "POST",
    headers: jsonHeaders(owner),
    body: JSON.stringify({ generationId: charted.generationId }),
  });
  const exportedBody = await readJson(exported);
  assert.equal(exported.status, 200, JSON.stringify(exportedBody));
  assert.equal(exportedBody.creditsConsumed, 10);
  assert.equal(await balance(owner), 0);
  const sheet = new Uint8Array(await (await fetch(exportedBody.xlsxUrl)).arrayBuffer());
  assert.equal(sheet[0], 0x50);
  assert.equal(sheet[1], 0x4b);
  const stranger = await signup("other");
  const hidden = await fetch(`${baseUrl}/api/sci-vis/export-xlsx`, {
    method: "POST",
    headers: jsonHeaders(stranger),
    body: JSON.stringify({ generationId: charted.generationId }),
  });
  assert.equal(hidden.status, 404, JSON.stringify(await readJson(hidden)));

  const apiUser = await signup("api");
  const created = await createKey(apiUser, "smoke");
  const listed = await readJson(await fetch(`${baseUrl}/api/api-keys`, { headers: { cookie: apiUser, origin: baseUrl } }));
  assert.equal(JSON.stringify(listed).includes(created.secret), false);
  const sessionOnly = await fetch(`${baseUrl}/api/v1/credits`, { headers: { cookie: apiUser, origin: baseUrl } });
  assert.equal(sessionOnly.status, 401);
  const credits = await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(created.secret) });
  const creditsBody = await readJson(credits);
  assert.equal(credits.status, 200, JSON.stringify(creditsBody));
  assert.equal(creditsBody.balance, 20);
  const badKey = await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer("sd_not-a-real-key-value-000") });
  assert.equal(badKey.status, 401);

  const idempotencyKey = `p4-gen-${Date.now()}`;
  const generated = await fetch(`${baseUrl}/api/v1/images/generations`, {
    method: "POST",
    headers: { ...bearer(created.secret), "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ prompt: "A labeled cell", aspect_ratio: "1:1", resolution: "2K", count: 1 }),
  });
  const generatedBody = await readJson(generated);
  assert.equal(generated.status, 202, JSON.stringify(generatedBody));
  assert.equal(generatedBody.status, "queued");
  const replay = await fetch(`${baseUrl}/api/v1/images/generations`, {
    method: "POST",
    headers: { ...bearer(created.secret), "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ prompt: "A labeled cell", aspect_ratio: "1:1", resolution: "2K", count: 1 }),
  });
  const replayBody = await readJson(replay);
  assert.equal(replayBody.id, generatedBody.id);
  const done = await pollJob(created.secret, generatedBody.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done));
  assert.equal(done.type, "image.generation");
  assert.equal(typeof done.result.files[0].url, "string");
  const image = new Uint8Array(await (await fetch(done.result.files[0].url)).arrayBuffer());
  assert.equal(image[0], 0x89);
  const afterGen = await readJson(await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(created.secret) }));
  assert.equal(afterGen.balance, 15);

  const form = new FormData();
  form.set("image", new Blob([png], { type: "image/png" }), "dot.png");
  form.set("format", "png");
  form.set("dpi", "300");
  const converted = await fetch(`${baseUrl}/api/v1/images/conversions`, {
    method: "POST",
    headers: { ...bearer(created.secret), prefer: "wait" },
    body: form,
  });
  const convertedBody = await readJson(converted);
  assert.equal(converted.status, 200, JSON.stringify(convertedBody));
  assert.equal(convertedBody.status, "succeeded");
  assert.equal(convertedBody.result.files[0].format, "png");
  const afterConvert = await readJson(await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(created.secret) }));
  assert.equal(afterConvert.balance, 10);

  const edit = new FormData();
  edit.set("image", new Blob([png], { type: "image/png" }), "dot.png");
  edit.set("prompt", "Keep the mark and add a label");
  const edited = await fetch(`${baseUrl}/api/v1/images/edits`, {
    method: "POST",
    headers: bearer(created.secret),
    body: edit,
  });
  const editedBody = await readJson(edited);
  assert.equal(edited.status, 202, JSON.stringify(editedBody));
  assert.equal(editedBody.type, "image.edit");
  const editedDone = await pollJob(created.secret, editedBody.id);
  assert.equal(editedDone.status, "succeeded", JSON.stringify(editedDone));
  const afterEdit = await readJson(await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(created.secret) }));
  assert.equal(afterEdit.balance, 5);

  const broke = await fetch(`${baseUrl}/api/v1/charts/generations`, {
    method: "POST",
    headers: bearer(created.secret),
    body: (() => {
      const data = new FormData();
      data.set("data", new Blob([csv], { type: "text/csv" }), "groups.csv");
      data.set("chart_type", "bar");
      return data;
    })(),
  });
  const brokeBody = await readJson(broke);
  assert.equal(broke.status, 402, JSON.stringify(brokeBody));
  assert.equal(brokeBody.error_code, "INSUFFICIENT_CREDITS");

  const chartUser = await signup("chart-api");
  const chartKey = await createKey(chartUser, "charts");
  const chartForm = new FormData();
  chartForm.set("data", new Blob([csv], { type: "text/csv" }), "groups.csv");
  chartForm.set("chart_type", "line");
  const chartedApi = await fetch(`${baseUrl}/api/v1/charts/generations`, {
    method: "POST",
    headers: bearer(chartKey.secret),
    body: chartForm,
  });
  const chartedApiBody = await readJson(chartedApi);
  assert.equal(chartedApi.status, 202, JSON.stringify(chartedApiBody));
  const chartDone = await pollJob(chartKey.secret, chartedApiBody.id);
  assert.equal(chartDone.status, "succeeded", JSON.stringify(chartDone));
  assert.equal(chartDone.type, "chart.generation");
  assert.equal(chartDone.result.files[0].format, "png");
  assertNoCodeKey(chartDone);
  const chartBalance = await readJson(await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(chartKey.secret) }));
  assert.equal(chartBalance.balance, 10);

  const vsdxUser = await signup("vsdx");
  const vsdx = await fetch(`${baseUrl}/api/convert-to-vsdx`, {
    method: "POST",
    headers: jsonHeaders(vsdxUser),
    body: JSON.stringify({}),
  });
  const vsdxBody = await readJson(vsdx);
  assert.equal(vsdx.status, 202, JSON.stringify(vsdxBody));
  assert.equal(vsdxBody.errorCode, "NOT_IMPLEMENTED");
  assert.equal(await balance(vsdxUser), 20);

  const packs = await readJson(await fetch(`${baseUrl}/api/billing/packs`));
  assert.equal(packs.configured, false);
  assert.equal(packs.packs.length, 3);
  const checkout = await fetch(`${baseUrl}/api/billing/checkout`, {
    method: "POST",
    headers: jsonHeaders(apiUser),
    body: JSON.stringify({ pack: "credits_100" }),
  });
  const checkoutBody = await readJson(checkout);
  assert.equal(checkout.status, 503, JSON.stringify(checkoutBody));
  assert.equal(checkoutBody.errorCode, "PAYMENTS_UNAVAILABLE");
  const webhook = await fetch(`${baseUrl}/api/billing/webhook`, { method: "POST", headers: jsonHeaders(), body: "{}" });
  assert.equal(webhook.status, 400);

  const revoked = await fetch(`${baseUrl}/api/api-keys/${created.id}`, { method: "DELETE", headers: { cookie: apiUser, origin: baseUrl } });
  assert.equal(revoked.status, 200);
  const afterRevoke = await fetch(`${baseUrl}/api/v1/credits`, { headers: bearer(created.secret) });
  assert.equal(afterRevoke.status, 401);
  console.log("p4 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
