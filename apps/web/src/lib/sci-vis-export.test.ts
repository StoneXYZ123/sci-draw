import assert from "node:assert/strict";
import test from "node:test";
import { buildSciVisWorkbook } from "./sci-vis-export";

test("spreadsheet export writes an xlsx zip with data", async () => {
  const bytes = await buildSciVisWorkbook({
    filename: "groups.csv",
    csvText: "group,value\nA,1\nB,3\n",
    meta: {
      filename: "groups.csv",
      chartTypes: "line",
      journalStyle: "nature",
      figureWidth: "single",
      colorPalette: "colorblind",
      multiChartLayout: "single",
      engine: "mock",
      imageUrl: "https://example.test/chart.png",
    },
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.byteLength > 200);
});
