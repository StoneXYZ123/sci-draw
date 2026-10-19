import type { SciVisChartType, SciVisJournal, SciVisLayout, SciVisPalette, SciVisWidth } from "@sci-draw/schemas";

function pythonString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[\r\n]/g, " ")}'`;
}

function pythonStringList(values: readonly string[]): string {
  return `[${values.map(pythonString).join(", ")}]`;
}

function note(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/#/g, "").trim().slice(0, 180);
  return cleaned.length > 0 ? cleaned : "none";
}

function palette(value: SciVisPalette): string[] {
  switch (value) {
    case "default":
      return ["#0e6e68", "#1c3036", "#c4552a", "#d4a017", "#4c6a8a"];
    case "colorblind":
      return ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9"];
    case "sequential":
      return ["#d6ebe9", "#7fbfb8", "#2a8f86", "#0e6e68", "#143e3c"];
    case "diverging":
      return ["#2166ac", "#67a9cf", "#f7f7f7", "#ef8a62", "#b2182b"];
    case "greyscale":
      return ["#222222", "#555555", "#888888", "#bbbbbb", "#444444"];
    default: {
      const neverPalette: never = value;
      throw new Error(`Unhandled palette ${String(neverPalette)}`);
    }
  }
}

function figureSize(value: SciVisWidth): string {
  switch (value) {
    case "single":
      return "(6.0, 4.0)";
    case "medium":
      return "(7.5, 4.6)";
    case "double":
      return "(10.0, 4.8)";
    default: {
      const neverWidth: never = value;
      throw new Error(`Unhandled width ${String(neverWidth)}`);
    }
  }
}

function fontSize(value: SciVisJournal): number {
  switch (value) {
    case "none":
      return 9;
    case "nature":
      return 7;
    case "cell":
      return 8;
    case "science":
      return 8;
    case "lancet":
      return 8;
    default: {
      const neverJournal: never = value;
      throw new Error(`Unhandled journal ${String(neverJournal)}`);
    }
  }
}

function assertChart(chart: SciVisChartType): SciVisChartType {
  switch (chart) {
    case "line":
    case "bar":
    case "scatter":
    case "box":
    case "histogram":
    case "heatmap":
    case "violin":
    case "volcano":
    case "survival":
    case "dose-response":
      return chart;
    default: {
      const neverChart: never = chart;
      throw new Error(`Unhandled chart ${String(neverChart)}`);
    }
  }
}

export function buildChartScript(input: {
  chartTypes: SciVisChartType[];
  journalStyle: SciVisJournal;
  figureWidth: SciVisWidth;
  colorPalette: SciVisPalette;
  multiChartLayout: SciVisLayout;
  followUpInstruction?: string;
  fileContext?: string;
}): string {
  const charts = input.chartTypes.map(assertChart);
  const primary = charts[0] ?? "line";
  return `"""Plot data.csv beside this file. matplotlib draws the chart; seaborn styles it when installed."""
# follow-up: ${note(input.followUpInstruction)}
# context: ${note(input.fileContext)}
import csv
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

try:
    import seaborn as sns
    sns.set_theme(style="whitegrid")
except Exception:
    sns = None

CHART = ${pythonString(primary)}
CHARTS = ${pythonStringList(charts)}
LAYOUT = ${pythonString(input.multiChartLayout)}
PALETTE = ${pythonStringList(palette(input.colorPalette))}
FIGSIZE = ${figureSize(input.figureWidth)}
plt.rcParams["axes.prop_cycle"] = plt.cycler(color=PALETTE)
plt.rcParams["font.size"] = ${fontSize(input.journalStyle)}


def numeric_columns(headers, table):
    found = []
    for name in headers:
        seen = False
        valid = True
        for row in table:
            text = (row.get(name) or "").strip()
            if not text:
                continue
            try:
                float(text)
            except ValueError:
                valid = False
                break
            seen = True
        if seen and valid:
            found.append(name)
    return found


def column_numbers(table, name):
    values = []
    for row in table:
        text = (row.get(name) or "").strip()
        values.append(float(text) if text else float("nan"))
    return values


with Path("data.csv").open(newline="", encoding="utf-8") as handle:
    table = list(csv.DictReader(handle))

headers = list(table[0].keys()) if table else []
numeric = numeric_columns(headers, table)
label_name = next((name for name in headers if name not in numeric), None)
if label_name:
    labels = [row.get(label_name) or str(index) for index, row in enumerate(table, start=1)]
else:
    labels = [str(index) for index in range(1, len(table) + 1)]

if not numeric:
    raise SystemExit("No numeric column")


def draw(ax, chart):
    series = numeric[0]
    ys = column_numbers(table, series)
    xs = list(range(len(table)))
    color = PALETTE[0]
    finite = [value for value in ys if value == value]
    if chart == "bar":
        ax.bar(xs, ys, color=color)
    elif chart in ("line", "dose-response"):
        ax.plot(xs, ys, color=color, marker="o")
    elif chart in ("scatter", "volcano"):
        ax.scatter(xs, ys, color=color)
    elif chart == "histogram":
        ax.hist(finite, bins=min(10, max(3, len(finite) or 1)), color=color)
    elif chart == "violin" and sns is not None:
        sns.violinplot(y=finite, ax=ax, color=color)
    elif chart in ("box", "violin"):
        ax.boxplot(finite if finite else [0])
    elif chart == "heatmap":
        matrix = [column_numbers(table, name) for name in numeric[:6]]
        ax.imshow(matrix, aspect="auto")
    elif chart == "survival":
        ax.step(xs, ys, where="post", color=color)
    else:
        ax.plot(xs, ys, color=color)
    if chart != "heatmap":
        ax.set_xticks(xs)
        ax.set_xticklabels(labels, rotation=30, ha="right")
        ax.set_ylabel(series)


charts = CHARTS if LAYOUT != "single" else [CHART]
count = max(1, len(charts))
if LAYOUT == "grid":
    columns = 2
    grid_rows = (count + columns - 1) // columns
    fig, axes = plt.subplots(grid_rows, columns, figsize=FIGSIZE, squeeze=False)
    flat = [axis for row in axes for axis in row]
else:
    fig, axes = plt.subplots(1, count, figsize=FIGSIZE, squeeze=False)
    flat = list(axes[0])

for index, chart in enumerate(charts):
    draw(flat[index], chart)
for extra in flat[len(charts) :]:
    extra.axis("off")

fig.tight_layout()
fig.savefig("chart.png", dpi=160)
fig.savefig("chart.pdf")
`;
}
