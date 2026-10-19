import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";

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
  while (Date.now() - started < 60_000) {
    const response = await fetch(`${baseUrl}/api/ai-drawing/tasks/${id}`, { headers: { cookie, origin: baseUrl } });
    const body = await readJson(response);
    if (body.status === "completed" || body.status === "failed") {
      return { response, body };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Task ${id} did not finish`);
}

async function generate(cookie, batchId) {
  const response = await fetch(`${baseUrl}/api/ai-drawing/generate`, {
    method: "POST",
    headers: jsonHeaders(cookie),
    body: JSON.stringify({
      prompt: "A simple labeled cell membrane",
      templateId: "none",
      styleId: "none",
      aspectRatio: "4:3",
      resolution: "2K",
      batchCount: 1,
      batchId,
      mode: "prompt",
      textLanguage: "en",
    }),
  });
  return { response, body: await readJson(response) };
}

async function main() {
  await waitForServer();
  const email = `p0-${Date.now()}@example.com`;
  const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name: "P0 Tester", email, password: "password123" }),
  });
  const signUpBody = await readJson(signUp);
  assert(signUp.ok, `sign-up failed ${signUp.status} ${JSON.stringify(signUpBody)}`);
  const cookie = cookieHeader(signUp);
  assert(cookie.includes("="), "sign-up did not set a session cookie");

  const session = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie, origin: baseUrl } });
  const sessionBody = await readJson(session);
  assert(session.ok && sessionBody?.user?.email === email, `get-session mismatch ${JSON.stringify(sessionBody)}`);

  const capabilities = await fetch(`${baseUrl}/api/ai-drawing/capabilities`);
  const capabilityBody = await readJson(capabilities);
  assert(capabilities.status === 200, "capabilities status");
  assert(capabilityBody.resolutions?.includes("2K"), "capabilities missing 2K");

  const anonymous = await fetch(`${baseUrl}/api/ai-drawing/generate`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ prompt: "x", batchId: "optimistic-batch-anon", mode: "prompt" }),
  });
  assert(anonymous.status === 401, `anonymous generate expected 401, got ${anonymous.status}`);

  const first = await generate(cookie, "optimistic-batch-smoke-1");
  assert(first.response.status === 202, `generate expected 202, got ${first.response.status} ${JSON.stringify(first.body)}`);
  assert(first.body.status === "pending", `generate status ${first.body.status}`);
  assert(/^[a-f0-9]{64}$/.test(first.body.id), "task id is not 64 hex");

  const done = await pollTask(first.body.id, cookie);
  assert(done.body.status === "completed", `task failed ${JSON.stringify(done.body)}`);
  const imageUrl = done.body.result?.data?.results?.[0]?.imageUrl;
  assert(typeof imageUrl === "string", "missing image url");
  assert.equal(done.body.result.data.totalCreditsConsumed, 5);
  const image = await fetch(imageUrl);
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert(image.ok, `image fetch ${image.status}`);
  const isPng = bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  assert(isPng || isJpeg, "result image is not a png or jpeg");

  const replay = await generate(cookie, "optimistic-batch-smoke-1");
  assert.equal(replay.response.status, 202);
  assert.equal(replay.body.id, first.body.id);

  for (const suffix of ["2", "3", "4"]) {
    const next = await generate(cookie, `optimistic-batch-smoke-${suffix}`);
    assert.equal(next.response.status, 202);
    const finished = await pollTask(next.body.id, cookie);
    assert.equal(finished.body.status, "completed");
  }

  const me = await fetch(`${baseUrl}/api/me`, { headers: { cookie, origin: baseUrl } });
  const meBody = await readJson(me);
  assert.equal(meBody.user.creditsBalance, 0);
  const reasons = meBody.ledger.map((entry) => entry.reason);
  assert.ok(reasons.includes("signup_bonus"));
  assert.ok(reasons.includes("ai_drawing.reserve"));
  assert.ok(reasons.includes("ai_drawing.consume"));

  const broke = await generate(cookie, "optimistic-batch-smoke-broke");
  assert.equal(broke.response.status, 402);
  assert.equal(broke.body.errorCode, "INSUFFICIENT_CREDITS");
  console.log("p0 smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
