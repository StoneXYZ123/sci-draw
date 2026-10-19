import assert from "node:assert/strict";
import test from "node:test";
import { readImageSize } from "./dimensions";
import { resolveImageProviderId } from "./factory";
import { createMockImageProvider } from "./mock";

test("missing gemini key selects the mock provider", () => {
  assert.equal(resolveImageProviderId({ IMAGE_PROVIDER: "gemini" }), "mock");
  assert.equal(resolveImageProviderId({ IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: "key" }), "gemini");
});

test("mock provider returns a png with readable dimensions", async () => {
  const image = await createMockImageProvider().generate({
    prompt: "mitochondria",
    aspectRatio: "4:3",
    resolution: "2K",
  });
  assert.equal(image.mimeType, "image/png");
  const size = readImageSize(image.bytes);
  assert.deepEqual(size, { width: image.width, height: image.height });
  assert.ok(image.width > image.height);
});
