import assert from "node:assert/strict";
import test from "node:test";
import { creditsForPack, isCreditPackId } from "./billing";

test("credit packs map to fixed amounts", () => {
  assert.equal(creditsForPack("credits_100"), 100);
  assert.equal(creditsForPack("credits_500"), 500);
  assert.equal(creditsForPack("credits_2000"), 2000);
  assert.equal(creditsForPack("credits_1"), null);
  assert.equal(isCreditPackId("credits_100"), true);
  assert.equal(isCreditPackId("signup"), false);
});
