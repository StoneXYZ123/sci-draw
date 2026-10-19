import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

async function signup(label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 45_000) {
    const email = `p2-${label}-${Date.now()}@example.com`;
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name: "P2 Tester", email, password: "password123" }),
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

async function pollTask(id, cookie) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const response = await fetch(`${baseUrl}/api/ai-drawing/tasks/${id}`, { headers: { cookie, origin: baseUrl } });
    const body = await readJson(response);
    if (body.status === "completed" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Task ${id} did not finish`);
}

async function upload(cookie) {
  const presign = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      action: "presign",
      purpose: "convert-source",
      filename: "dot.png",
      contentType: "image/png",
      size: png.byteLength,
    }),
  });
  const presignBody = await readJson(presign);
  assert.equal(presign.status, 200, JSON.stringify(presignBody));
  assert.match(presignBody.objectKey, /^convert-source\/[^/]+\/[0-9a-f-]{36}\.png$/);
  const put = await fetch(presignBody.uploadUrl, {
    method: "PUT",
    headers: presignBody.headers,
    body: png,
  });
  assert.equal(put.status, 200, await put.text());
  const complete = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ action: "complete", purpose: "convert-source", objectKey: presignBody.objectKey }),
  });
  const completeBody = await readJson(complete);
  assert.equal(complete.status, 200, JSON.stringify(completeBody));
  return presignBody.objectKey;
}

async function main() {
  await waitForServer();
  const anonymousSvg = await fetch(`${baseUrl}/api/convert-to-svg`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ imageUrl: `${baseUrl}/api/media/image-results/u/a/b.png`, mode: "full" }),
  });
  assert.equal(anonymousSvg.status, 401);
  const anonymousFormat = await fetch(`${baseUrl}/api/convert-format`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ objectKey: "convert-source/u/x.png", filename: "a.png", format: "svg" }),
  });
  assert.equal(anonymousFormat.status, 401);

  const svgUser = await signup("svg");
  assert.equal(await balance(svgUser), 20);
  const vsdx = await fetch(`${baseUrl}/api/convert-to-vsdx`, {
    method: "POST",
    headers: jsonHeaders(svgUser),
    body: JSON.stringify({}),
  });
  const vsdxBody = await readJson(vsdx);
  assert.equal(vsdx.status, 202, JSON.stringify(vsdxBody));
  assert.equal(vsdxBody.errorCode, "NOT_IMPLEMENTED");
  assert.equal(await balance(svgUser), 20);
  const polled = await fetch(`${baseUrl}/api/convert-to-vsdx?jobId=${vsdxBody.jobId}`, { headers: { cookie: svgUser, origin: baseUrl } });
  const polledBody = await readJson(polled);
  assert.equal(polled.status, 200);
  assert.equal(polledBody.status, "failed");
  assert.equal(polledBody.errorCode, "NOT_IMPLEMENTED");
  const completed = await fetch(`${baseUrl}/api/convert-to-vsdx/complete`, {
    method: "POST",
    headers: jsonHeaders(svgUser),
    body: JSON.stringify({ jobId: vsdxBody.jobId }),
  });
  const completedBody = await readJson(completed);
  assert.equal(completed.status, 501);
  assert.equal(completedBody.errorCode, "NOT_IMPLEMENTED");
  assert.equal(await balance(svgUser), 20);

  const generated = await fetch(`${baseUrl}/api/ai-drawing/generate`, {
    method: "POST",
    headers: jsonHeaders(svgUser),
    body: JSON.stringify({
      prompt: "A labeled cell",
      templateId: "none",
      styleId: "none",
      aspectRatio: "4:3",
      resolution: "2K",
      batchCount: 1,
      batchId: `optimistic-batch-p2-${Date.now()}`,
      mode: "prompt",
      textLanguage: "en",
    }),
  });
  const generatedBody = await readJson(generated);
  assert.equal(generated.status, 202, JSON.stringify(generatedBody));
  const done = await pollTask(generatedBody.id, svgUser);
  assert.equal(done.status, "completed", JSON.stringify(done));
  const imageUrl = done.result.data.results[0].imageUrl;
  assert.equal(typeof imageUrl, "string");
  assert.equal(await balance(svgUser), 15);

  const svg = await fetch(`${baseUrl}/api/convert-to-svg`, {
    method: "POST",
    headers: jsonHeaders(svgUser),
    body: JSON.stringify({ imageUrl, mode: "full", messageId: "m1", conversationId: done.result.data.conversationId }),
  });
  const svgBody = await readJson(svg);
  assert.equal(svg.status, 200, JSON.stringify(svgBody));
  assert.equal(svgBody.creditsConsumed, 15);
  assert.equal(await balance(svgUser), 0);
  const svgFile = await fetch(svgBody.svgUrl);
  const svgText = await svgFile.text();
  assert.equal(svgFile.status, 200);
  assert.match(svgText, /<svg/);
  assert.match(svgText, /<path/);
  const download = await fetch(`${baseUrl}/api/download-image?url=${encodeURIComponent(svgBody.svgUrl)}`, {
    headers: { cookie: svgUser, origin: baseUrl },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(await download.text(), /<svg/);
  const broke = await fetch(`${baseUrl}/api/convert-to-pptx`, {
    method: "POST",
    headers: jsonHeaders(svgUser),
    body: JSON.stringify({ imageUrl }),
  });
  const brokeBody = await readJson(broke);
  assert.equal(broke.status, 402);
  assert.equal(brokeBody.errorCode, "INSUFFICIENT_CREDITS");

  const bench = await signup("bench");
  const objectKey = await upload(bench);
  const textSvg = await fetch(`${baseUrl}/api/convert-format`, {
    method: "POST",
    headers: jsonHeaders(bench),
    body: JSON.stringify({ objectKey, filename: "dot.png", format: "svg", mode: "text-only" }),
  });
  const textBody = await readJson(textSvg);
  assert.equal(textSvg.status, 200, JSON.stringify(textBody));
  assert.equal(textBody.creditsConsumed, 10);
  const textFile = await (await fetch(textBody.downloadUrl)).text();
  assert.match(textFile, /<text/);
  assert.equal(await balance(bench), 10);
  const pptx = await fetch(`${baseUrl}/api/convert-format`, {
    method: "POST",
    headers: jsonHeaders(bench),
    body: JSON.stringify({ objectKey, filename: "dot.png", format: "pptx" }),
  });
  const pptxBody = await readJson(pptx);
  assert.equal(pptx.status, 200, JSON.stringify(pptxBody));
  assert.equal(pptxBody.creditsConsumed, 10);
  const pptxBytes = new Uint8Array(await (await fetch(pptxBody.downloadUrl)).arrayBuffer());
  assert.equal(pptxBytes[0], 0x50);
  assert.equal(pptxBytes[1], 0x4b);
  assert.equal(await balance(bench), 0);

  const raster = await signup("png");
  const rasterKey = await upload(raster);
  const pngOut = await fetch(`${baseUrl}/api/convert-format`, {
    method: "POST",
    headers: jsonHeaders(raster),
    body: JSON.stringify({ objectKey: rasterKey, filename: "dot.png", format: "png", dpi: 300 }),
  });
  const pngBody = await readJson(pngOut);
  assert.equal(pngOut.status, 200, JSON.stringify(pngBody));
  assert.equal(pngBody.creditsConsumed, 5);
  const pngBytes = new Uint8Array(await (await fetch(pngBody.downloadUrl)).arrayBuffer());
  assert.equal(pngBytes[0], 0x89);
  assert.equal(await balance(raster), 15);
  console.log("p2 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
