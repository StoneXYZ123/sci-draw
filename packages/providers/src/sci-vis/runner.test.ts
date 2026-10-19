import assert from "node:assert/strict";
import test from "node:test";
import { pythonFromModelText } from "./llm";
import { renderSciVisChart, resolveSciVisSandbox } from "./runner";
import { buildChartScript } from "./script";
import { parseTable, tableToCsv } from "./table";
import { SciVisEngineError } from "./types";

const csv = "group,value\nA,1\nB,3\nC,2\n";

test("unknown sci-vis sandbox is rejected", () => {
  assert.throws(() => resolveSciVisSandbox({ SCIVIS_SANDBOX: "vendor" }), /not available/);
});

test("sandbox falls back to local without credentials", () => {
  assert.equal(resolveSciVisSandbox({}), "local");
  assert.equal(resolveSciVisSandbox({ E2B_API_KEY: "key" }), "e2b");
  assert.equal(resolveSciVisSandbox({ SCIVIS_SANDBOX: "local", E2B_API_KEY: "key" }), "local");
});

test("chart script names matplotlib and the selected chart", () => {
  const script = buildChartScript({
    chartTypes: ["violin"],
    journalStyle: "nature",
    figureWidth: "double",
    colorPalette: "colorblind",
    multiChartLayout: "single",
    followUpInstruction: "use a log axis",
  });
  assert.match(script, /import matplotlib/);
  assert.match(script, /seaborn/);
  assert.match(script, /CHART = 'violin'/);
  assert.match(script, /use a log axis/);
  assert.match(script, /chart.png/);
});

test("table parser keeps a numeric column and rejects labels only", () => {
  const table = parseTable("group\tvalue\nA\t2\n", "groups.tsv");
  assert.equal(table.headers[1], "value");
  assert.match(tableToCsv(table), /group,value/);
  assert.throws(() => parseTable("group\nA\n", "labels.csv"), /numeric/);
});

test("model text must stay a matplotlib script for data.csv", () => {
  assert.equal(pythonFromModelText("print('no')"), null);
  const accepted = pythonFromModelText("```python\nimport matplotlib\nopen('data.csv')\nopen('chart.png','wb')\n```");
  assert.ok(accepted?.includes("matplotlib"));
  assert.equal(pythonFromModelText("import matplotlib\nimport subprocess\ndata.csv chart.png"), null);
});

test("local runner returns the script and a png without matplotlib", async () => {
  const result = await renderSciVisChart({
    csv,
    chartTypes: ["bar"],
    journalStyle: "none",
    figureWidth: "single",
    colorPalette: "default",
    multiChartLayout: "single",
    sandbox: "local",
  });
  assert.match(result.code, /matplotlib/);
  assert.equal(result.png[0], 0x89);
  assert.equal(result.png[1], 0x50);
  assert.ok(result.engine === "mock" || result.engine === "python");
  assert.equal(result.sandbox, "local");
});

test("supplied code on the local runner is refused", async () => {
  await assert.rejects(
    () =>
      renderSciVisChart({
        csv,
        chartTypes: ["line"],
        journalStyle: "none",
        figureWidth: "single",
        colorPalette: "default",
        multiChartLayout: "single",
        sandbox: "local",
        currentCode: "import matplotlib\nprint('data.csv chart.png')",
      }),
    (error: unknown) => error instanceof SciVisEngineError && error.errorCode === "SANDBOX_REQUIRED",
  );
});
