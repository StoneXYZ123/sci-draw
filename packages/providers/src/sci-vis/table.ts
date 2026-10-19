export class TableParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableParseError";
  }
}

export type DataTable = {
  headers: string[];
  rows: string[][];
};

function sniffDelimiter(text: string, filename: string): "," | "\t" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsv")) {
    return "\t";
  }
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (lower.endsWith(".txt") && first.includes("\t") && !first.includes(",")) {
    return "\t";
  }
  return ",";
}

function parseLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTable(text: string, filename: string): DataTable {
  const delimiter = sniffDelimiter(text, filename);
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    throw new TableParseError("The table needs a header and at least one row");
  }
  const headers = parseLine(lines[0] ?? "", delimiter).map((header) => header.slice(0, 80));
  if (headers.length < 1 || headers.some((header) => header.length === 0)) {
    throw new TableParseError("The header row is empty");
  }
  if (headers.length > 24) {
    throw new TableParseError("Use 24 columns or fewer");
  }
  const rows: string[][] = [];
  for (const line of lines.slice(1, 2001)) {
    const cells = parseLine(line, delimiter).slice(0, headers.length);
    while (cells.length < headers.length) {
      cells.push("");
    }
    rows.push(cells.map((cell) => cell.slice(0, 200)));
  }
  if (rows.length < 1) {
    throw new TableParseError("The table needs a header and at least one row");
  }
  const numeric = headers.some((_, column) => rows.some((row) => /^-?\d+(\.\d+)?$/.test((row[column] ?? "").trim())));
  if (!numeric) {
    throw new TableParseError("Add at least one numeric column");
  }
  return { headers, rows };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function tableToCsv(table: DataTable): string {
  const lines = [table.headers.map(csvCell).join(",")];
  for (const row of table.rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
