import assert from "node:assert/strict";
import test from "node:test";
import { buildMockVsdx, cloudConvertTaskBody, convertImageToVsdx, resolveVsdxProviderMode, runCloudConvertVsdx, VsdxUnavailableError } from "./vsdx";

test("unset VSDX provider is unavailable", () => {
  assert.equal(resolveVsdxProviderMode({}), "unavailable");
  assert.equal(resolveVsdxProviderMode({ CONVERT_VSDX_PROVIDER: "cloudconvert" }), "unavailable");
  assert.equal(resolveVsdxProviderMode({ CONVERT_VSDX_PROVIDER: "cloudconvert", CLOUDCONVERT_API_KEY: "secret" }), "cloudconvert");
  assert.equal(resolveVsdxProviderMode({ CONVERT_VSDX_PROVIDER: "mock" }), "mock");
  assert.equal(resolveVsdxProviderMode({ CONVERT_VSDX_PROVIDER: "other" }), "unavailable");
});

test("mock VSDX is a zip package", () => {
  const bytes = buildMockVsdx("Cell <figure>");
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const text = Buffer.from(bytes).toString("utf8");
  assert.match(text, /\[Content_Types\]\.xml/);
  assert.match(text, /visio\/document\.xml/);
  assert.match(text, /Cell &lt;figure&gt;/);
});

test("cloudconvert body wires image to vsdx", () => {
  const body = cloudConvertTaskBody({ filename: "figure.png", fileBase64: "YQ==" });
  assert.equal(body.tasks["convert-file"].output_format, "vsdx");
  assert.deepEqual(body.tasks["convert-file"].input, ["import-file"]);
  assert.equal(body.tasks["import-file"].file, "YQ==");
});

test("cloudconvert client downloads the exported file", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = String(url);
    calls.push(`${init?.method ?? "GET"} ${href}`);
    if (href.endsWith("/v2/jobs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { tasks: { "convert-file": { output_format: string } } };
      assert.equal(body.tasks["convert-file"].output_format, "vsdx");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer test-key");
      return new Response(JSON.stringify({ data: { id: "job_1", status: "processing", tasks: [] } }), { status: 200 });
    }
    if (href.endsWith("/v2/jobs/job_1")) {
      return new Response(
        JSON.stringify({
          data: {
            id: "job_1",
            status: "finished",
            tasks: [{ name: "export-file", operation: "export/url", status: "finished", result: { files: [{ url: "https://files.example.test/out.vsdx" }] } }],
          },
        }),
        { status: 200 },
      );
    }
    if (href === "https://files.example.test/out.vsdx") {
      return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };
  const bytes = await runCloudConvertVsdx({
    bytes: Uint8Array.from([1, 2, 3]),
    filename: "figure.png",
    apiKey: "test-key",
    fetchImpl,
    sleepImpl: async () => undefined,
    maxAttempts: 2,
  });
  assert.equal(bytes[0], 0x50);
  assert.ok(calls.some((call) => call.startsWith("POST ")));
});

test("convertImageToVsdx refuses an unconfigured provider", async () => {
  await assert.rejects(
    () => convertImageToVsdx({ bytes: Uint8Array.from([1]), filename: "a.png", env: {} }),
    (error: unknown) => error instanceof VsdxUnavailableError && error.errorCode === "NOT_IMPLEMENTED",
  );
});
