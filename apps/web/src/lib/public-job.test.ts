import assert from "node:assert/strict";
import test from "node:test";
import { filesFromResult, toPublicJob, toPublicStatus } from "./public-job";

test("job statuses map to the public vocabulary", () => {
  assert.equal(toPublicStatus("pending"), "queued");
  assert.equal(toPublicStatus("running"), "processing");
  assert.equal(toPublicStatus("completed"), "succeeded");
  assert.equal(toPublicStatus("failed"), "failed");
  assert.equal(toPublicStatus("canceled"), "canceled");
  assert.equal(toPublicStatus("mystery"), "failed");
});

test("public chart view drops python code", () => {
  const view = toPublicJob({
    id: "a".repeat(64),
    type: "public_chart",
    status: "completed",
    request: { chartType: "line" },
    result: {
      files: [{ url: "https://example.test/chart.png", format: "png" }],
      code: "import matplotlib",
      engine: "mock",
    },
    errorCode: null,
    errorMessage: null,
    creditsReserved: 10,
    creditsConsumed: 10,
  });
  assert.equal(view.status, "succeeded");
  assert.equal(view.type, "chart.generation");
  assert.deepEqual(view.result?.files, [{ url: "https://example.test/chart.png", format: "png" }]);
  assert.equal(JSON.stringify(view).includes("matplotlib"), false);
  assert.equal(JSON.stringify(view).includes('"code"'), false);
});

test("drawing results become file urls", () => {
  const files = filesFromResult({
    success: true,
    data: { results: [{ imageUrl: "https://example.test/a.png", batchIndex: 0 }] },
    code: "secret",
  });
  assert.deepEqual(files, [{ url: "https://example.test/a.png", format: "png" }]);
});
