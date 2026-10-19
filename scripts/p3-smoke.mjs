import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const csv = Buffer.from("group,value\nA,1\nB,3\nC,2\n", "utf8");
const xlsx = Buffer.from("not a workbook", "utf8");

function jsonHeaders(cookie) {
  const headers = { "content-type": "application/json", origin: baseUrl };
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
    const email = `p3-${label}-${Date.now()}@example.com`;
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "P3 Tester", email, password: "password123" }),
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

async function upload(cookie, filename, contentType, bytes) {
  const presign = await fetch(`${baseUrl}/api/sci-vis/upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ action: "presign", filename, contentType, size: bytes.byteLength }),
  });
  const presignBody = await readJson(presign);
  assert.equal(presign.status, 200, JSON.stringify(presignBody));
  assert.match(presignBody.objectKey, new RegExp(`^sci-vis-data\\/[^/]+\\/[0-9a-f-]{36}\\.${filename.split(".").pop()}$`));
  const put = await fetch(presignBody.uploadUrl, {
    method: "PUT",
    headers: presignBody.headers,
    body: bytes,
  });
  assert.equal(put.status, 200, await put.text());
  const complete = await fetch(`${baseUrl}/api/sci-vis/upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ action: "complete", objectKey: presignBody.objectKey }),
  });
  const completeBody = await readJson(complete);
  assert.equal(complete.status, 200, JSON.stringify(completeBody));
  return presignBody.objectKey;
}

async function stream(cookie, body) {
  const response = await fetch(`${baseUrl}/api/sci-vis/stream`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    return { response, events: [], body: await readJson(response) };
  }
  return { response, events: parseSse(await response.text()), body: null };
}

async function main() {
  await waitForServer();
  const anonymous = await fetch(`${baseUrl}/api/sci-vis/stream`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ data: { objectKey: "sci-vis-data/u/x.csv" }, chartTypes: ["line"] }),
  });
  assert.equal(anonymous.status, 401);
  const anonymousUpload = await fetch(`${baseUrl}/api/sci-vis/upload`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ action: "presign", filename: "a.csv", contentType: "text/csv", size: 4 }),
  });
  assert.equal(anonymousUpload.status, 401);

  const cookie = await signup("chart");
  assert.equal(await balance(cookie), 20);
  const sheetKey = await upload(cookie, "book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx);
  const sheet = await stream(cookie, { data: { objectKey: sheetKey, filename: "book.xlsx" }, chartTypes: ["bar"] });
  assert.equal(sheet.response.status, 400, JSON.stringify(sheet.body));
  assert.equal(await balance(cookie), 20);

  const objectKey = await upload(cookie, "groups.csv", "text/csv", csv);
  const charted = await stream(cookie, {
    data: { objectKey, filename: "groups.csv" },
    chartTypes: ["line"],
    journalStyle: "nature",
    colorPalette: "colorblind",
    figureWidth: "single",
    multiChartLayout: "single",
    fileContext: "two groups",
  });
  assert.equal(charted.response.status, 200, JSON.stringify(charted.body ?? charted.events));
  const types = charted.events.map((event) => event.type);
  assert.ok(types.indexOf("status") < types.indexOf("session_ready"));
  assert.ok(types.indexOf("session_ready") < types.indexOf("progress"));
  assert.ok(types.indexOf("progress") < types.indexOf("preview"));
  assert.ok(types.indexOf("preview") < types.indexOf("result"));
  assert.ok(types.indexOf("result") < types.indexOf("complete"));
  const result = charted.events.find((event) => event.type === "result");
  assert.equal(result.creditsConsumed, 10);
  assert.match(result.code, /matplotlib/);
  assert.equal(typeof result.imageUrl, "string");
  assert.equal(result.formats.png, result.imageUrl);
  assert.ok(result.engine === "mock" || result.engine === "python");
  const image = new Uint8Array(await (await fetch(result.imageUrl)).arrayBuffer());
  assert.equal(image[0], 0x89);
  assert.equal(await balance(cookie), 10);

  const refused = await stream(cookie, {
    data: { objectKey, filename: "groups.csv" },
    chartTypes: ["line"],
    currentCode: "print('no sandbox')",
    conversationId: result.conversationId,
  });
  assert.equal(refused.response.status, 200);
  const failed = refused.events.find((event) => event.type === "failed");
  assert.equal(failed.errorCode, "SANDBOX_REQUIRED");
  assert.equal(await balance(cookie), 10);

  const follow = await stream(cookie, {
    data: { objectKey, filename: "groups.csv" },
    chartTypes: ["bar"],
    followUpInstruction: "Use a bar chart",
    conversationId: result.conversationId,
    baseGenerationId: result.generationId,
  });
  assert.equal(follow.response.status, 200, JSON.stringify(follow.body ?? follow.events));
  const followResult = follow.events.find((event) => event.type === "result");
  assert.equal(followResult.creditsConsumed, 10);
  assert.match(followResult.code, /bar/);
  assert.equal(await balance(cookie), 0);

  const exported = await fetch(`${baseUrl}/api/sci-vis/export-xlsx`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ generationId: result.generationId }),
  });
  const exportedBody = await readJson(exported);
  assert.equal(exported.status, 501, JSON.stringify(exportedBody));
  assert.equal(exportedBody.errorCode, "NOT_IMPLEMENTED");
  assert.equal(await balance(cookie), 0);

  const broke = await stream(cookie, { data: { objectKey, filename: "groups.csv" }, chartTypes: ["line"] });
  assert.equal(broke.response.status, 402);
  assert.equal(broke.body.errorCode, "INSUFFICIENT_CREDITS");
  console.log("p3 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
