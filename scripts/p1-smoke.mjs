import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function jsonHeaders(cookie) {
  const headers = {
    "content-type": "application/json",
    origin: baseUrl,
  };
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

async function pollTask(id, cookie) {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const response = await fetch(`${baseUrl}/api/ai-drawing/tasks/${id}`, { headers: { cookie, origin: baseUrl } });
    const body = await readJson(response);
    if (body.status === "completed" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Task ${id} did not finish`);
}

async function balance(cookie) {
  const response = await fetch(`${baseUrl}/api/me`, { headers: { cookie, origin: baseUrl } });
  const body = await readJson(response);
  assert.equal(response.status, 200);
  return body.user.creditsBalance;
}

async function generate(cookie, payload) {
  const response = await fetch(`${baseUrl}/api/ai-drawing/generate`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify(payload),
  });
  return { response, body: await readJson(response) };
}

async function uploadPng(cookie) {
  const presign = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      action: "presign",
      purpose: "ai-drawing-source",
      filename: "dot.png",
      contentType: "image/png",
      size: png.byteLength,
    }),
  });
  const presignBody = await readJson(presign);
  assert.equal(presign.status, 200, JSON.stringify(presignBody));
  assert.match(presignBody.objectKey, /^ai-drawing-source\/[^/]+\/[0-9a-f-]{36}\.png$/);
  const put = await fetch(presignBody.uploadUrl, {
    method: "PUT",
    headers: presignBody.headers,
    body: png,
  });
  assert.equal(put.status, 200, await put.text());
  const complete = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      action: "complete",
      purpose: "ai-drawing-source",
      objectKey: presignBody.objectKey,
    }),
  });
  const completeBody = await readJson(complete);
  assert.equal(complete.status, 200, JSON.stringify(completeBody));
  assert.equal(completeBody.status, "ready");
  const again = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      action: "complete",
      purpose: "ai-drawing-source",
      objectKey: presignBody.objectKey,
    }),
  });
  assert.equal(again.status, 200);
  return presignBody.objectKey;
}

async function main() {
  await waitForServer();
  const anonymousList = await fetch(`${baseUrl}/api/ai-drawing/conversations`);
  assert.equal(anonymousList.status, 401);
  const anonymousUpload = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      action: "presign",
      purpose: "ai-drawing-source",
      filename: "dot.png",
      contentType: "image/png",
    }),
  });
  assert.equal(anonymousUpload.status, 401);

  const email = `p1-${Date.now()}@example.com`;
  const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name: "P1 Tester", email, password: "password123" }),
  });
  const signUpBody = await readJson(signUp);
  assert(signUp.ok, `sign-up failed ${signUp.status} ${JSON.stringify(signUpBody)}`);
  const cookie = cookieHeader(signUp);
  assert.equal(await balance(cookie), 20);

  const prompt = await generate(cookie, {
    prompt: "A labeled leaf cross section",
    templateId: "none",
    styleId: "none",
    aspectRatio: "4:3",
    resolution: "2K",
    batchCount: 1,
    batchId: `optimistic-batch-p1-prompt-${Date.now()}`,
    mode: "prompt",
    textLanguage: "en",
  });
  assert.equal(prompt.response.status, 202, JSON.stringify(prompt.body));
  const promptDone = await pollTask(prompt.body.id, cookie);
  assert.equal(promptDone.status, "completed", JSON.stringify(promptDone));
  assert.equal(promptDone.result.data.totalCreditsConsumed, 5);
  assert.equal(await balance(cookie), 15);

  const listed = await fetch(`${baseUrl}/api/ai-drawing/conversations?limit=20&offset=0`, {
    headers: { cookie, origin: baseUrl },
  });
  const listedBody = await readJson(listed);
  assert.equal(listed.status, 200);
  assert.equal(listedBody.conversations.length, 1);
  assert.equal(listedBody.conversations[0].mode, "prompt");
  assert.equal(listedBody.conversations[0].messageCount, 2);
  const promptId = listedBody.conversations[0].id;

  const tooBig = await fetch(`${baseUrl}/api/storage/direct-upload`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      action: "presign",
      purpose: "ai-drawing-source",
      filename: "big.png",
      contentType: "image/png",
      size: 6 * 1024 * 1024,
    }),
  });
  assert.equal(tooBig.status, 400);

  const missingSource = await generate(cookie, {
    supplementaryPrompt: "finish the sketch",
    batchId: `optimistic-batch-p1-missing-${Date.now()}`,
    mode: "sketch",
    batchCount: 1,
  });
  assert.equal(missingSource.response.status, 400);
  assert.equal(await balance(cookie), 15);

  const objectKey = await uploadPng(cookie);
  const sketchNote = "Finish this sketch as a cell diagram";
  const sketch = await generate(cookie, {
    supplementaryPrompt: sketchNote,
    uploadedImageObjectKey: objectKey,
    templateId: "experimental-workflow",
    styleId: "schematic-diagram",
    aspectRatio: "4:3",
    resolution: "2K",
    batchCount: 2,
    batchId: `optimistic-batch-p1-sketch-${Date.now()}`,
    mode: "sketch",
    textLanguage: "en",
  });
  assert.equal(sketch.response.status, 202, JSON.stringify(sketch.body));
  const sketchDone = await pollTask(sketch.body.id, cookie);
  assert.equal(sketchDone.status, "completed", JSON.stringify(sketchDone));
  assert.equal(sketchDone.result.data.results.length, 2);
  assert.equal(sketchDone.result.data.totalCreditsConsumed, 10);
  assert.equal(sketchDone.result.data.isNewConversation, true);
  assert.equal(sketchDone.result.data.userMessage.content, sketchNote);
  const sketchMeta = JSON.parse(sketchDone.result.data.userMessage.metadata);
  assert.equal(sketchMeta.mode, "sketch");
  assert.equal(sketchMeta.uploadedImageObjectKey, objectKey);
  assert.equal(sketchMeta.templateId, "experimental-workflow");
  assert.equal(await balance(cookie), 5);
  const sketchId = sketchDone.result.data.conversationId;

  const replicate = await generate(cookie, {
    supplementaryPrompt: "Redraw the reference as a cleaner diagram",
    uploadedImageObjectKey: objectKey,
    templateId: "none",
    styleId: "none",
    aspectRatio: "4:3",
    resolution: "2K",
    batchCount: 1,
    batchId: `optimistic-batch-p1-replicate-${Date.now()}`,
    mode: "replicate",
    textLanguage: "en",
  });
  assert.equal(replicate.response.status, 202, JSON.stringify(replicate.body));
  const replicateDone = await pollTask(replicate.body.id, cookie);
  assert.equal(replicateDone.status, "completed", JSON.stringify(replicateDone));
  assert.equal(replicateDone.result.data.results.length, 1);
  assert.equal(await balance(cookie), 0);

  const after = await fetch(`${baseUrl}/api/ai-drawing/conversations?limit=20&offset=0`, {
    headers: { cookie, origin: baseUrl },
  });
  const afterBody = await readJson(after);
  assert.equal(afterBody.conversations.length, 3);
  const modes = afterBody.conversations.map((item) => item.mode).sort();
  assert.deepEqual(modes, ["prompt", "replicate", "sketch"]);

  const detail = await fetch(`${baseUrl}/api/ai-drawing/conversations/${sketchId}`, {
    headers: { cookie, origin: baseUrl },
  });
  const detailBody = await readJson(detail);
  assert.equal(detail.status, 200);
  assert.equal(detailBody.conversation.mode, "sketch");
  assert.equal(detailBody.conversation.messageCount, 3);
  assert.deepEqual(
    detailBody.messages.map((item) => item.role),
    ["user", "assistant", "assistant"],
  );
  assert.equal(detailBody.messages[0].content, sketchNote);

  const removed = await fetch(`${baseUrl}/api/ai-drawing/conversations/${promptId}`, {
    method: "DELETE",
    headers: { cookie, origin: baseUrl },
  });
  assert.equal(removed.status, 200);
  const remaining = await fetch(`${baseUrl}/api/ai-drawing/conversations?limit=20&offset=0`, {
    headers: { cookie, origin: baseUrl },
  });
  const remainingBody = await readJson(remaining);
  assert.equal(remainingBody.conversations.length, 2);
  assert.equal(remainingBody.conversations.some((item) => item.id === promptId), false);
  const gone = await fetch(`${baseUrl}/api/ai-drawing/conversations/${promptId}`, {
    headers: { cookie, origin: baseUrl },
  });
  assert.equal(gone.status, 404);

  const broke = await generate(cookie, {
    prompt: "one more figure",
    batchId: `optimistic-batch-p1-broke-${Date.now()}`,
    mode: "prompt",
  });
  assert.equal(broke.response.status, 402);
  assert.equal(broke.body.errorCode, "INSUFFICIENT_CREDITS");
  console.log("p1 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
