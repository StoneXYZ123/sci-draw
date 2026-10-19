import assert from "node:assert/strict";
import test from "node:test";
import { GenerateBodyError, parseGenerateBody } from "./index";

test("parseGenerateBody accepts the live prompt payload", () => {
  const body = parseGenerateBody({
    prompt: "A kinase cascade",
    templateId: "none",
    styleId: "none",
    aspectRatio: "4:3",
    resolution: "2K",
    batchCount: 1,
    batchId: "optimistic-batch-1",
    mode: "prompt",
    textLanguage: "zh",
  });
  assert.equal(body.mode, "prompt");
  assert.equal(body.prompt, "A kinase cascade");
  assert.equal(body.aspectRatio, "4:3");
});

test("parseGenerateBody drops temporary conversation ids", () => {
  const body = parseGenerateBody({
    prompt: "cell",
    batchId: "optimistic-batch-2",
    conversationId: "temp-conv-1",
  });
  assert.equal(body.conversationId, undefined);
  assert.equal(body.resolution, "2K");
  assert.equal(body.batchCount, 1);
});

test("parseGenerateBody rejects sketch mode", () => {
  assert.throws(
    () => parseGenerateBody({ prompt: "x", batchId: "b", mode: "sketch" }),
    (error: unknown) => error instanceof GenerateBodyError && error.errorCode === "MODE_NOT_AVAILABLE",
  );
});
