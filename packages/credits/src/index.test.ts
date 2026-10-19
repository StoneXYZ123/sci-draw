import assert from "node:assert/strict";
import test from "node:test";
import { aiDrawingCredits } from "./index";

test("2K times one costs 5 credits", () => {
  assert.equal(aiDrawingCredits("2K", 1), 5);
});

test("4K times four costs 40 credits", () => {
  assert.equal(aiDrawingCredits("4K", 4), 40);
});
