import assert from "node:assert/strict";
import test from "node:test";
import { aiDrawingCredits, convertCredits } from "./index";

test("2K times one costs 5 credits", () => {
  assert.equal(aiDrawingCredits("2K", 1), 5);
});

test("4K times four costs 40 credits", () => {
  assert.equal(aiDrawingCredits("4K", 4), 40);
});

test("convert prices match the published table", () => {
  assert.equal(convertCredits({ kind: "svg", mode: "text-only" }), 10);
  assert.equal(convertCredits({ kind: "svg", mode: "full" }), 15);
  assert.equal(convertCredits({ kind: "pptx" }), 10);
  assert.equal(convertCredits({ kind: "vsdx" }), 20);
  assert.equal(convertCredits({ kind: "raster", dpi: 300 }), 5);
  assert.equal(convertCredits({ kind: "raster", dpi: 600 }), 10);
  assert.equal(convertCredits({ kind: "raster", dpi: 1000 }), 15);
});
