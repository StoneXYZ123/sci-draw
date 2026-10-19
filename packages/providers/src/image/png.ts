import { crc32, deflateSync } from "node:zlib";

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, checksum]);
}

function setPixel(raw: Buffer, width: number, x: number, y: number, height: number, rgb: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const index = y * (width * 3 + 1) + 1 + x * 3;
  raw[index] = rgb[0];
  raw[index + 1] = rgb[1];
  raw[index + 2] = rgb[2];
}

function drawText(
  raw: Buffer,
  width: number,
  height: number,
  text: string,
  originX: number,
  originY: number,
  scale: number,
  rgb: [number, number, number],
): void {
  let cursor = originX;
  for (const char of text.toUpperCase()) {
    const glyph = FONT[char] ?? FONT[" "];
    if (!glyph) {
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      const bits = glyph[row] ?? "";
      for (let col = 0; col < bits.length; col += 1) {
        if (bits[col] !== "1") {
          continue;
        }
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(raw, width, cursor + col * scale + dx, originY + row * scale + dy, height, rgb);
          }
        }
      }
    }
    cursor += 6 * scale;
  }
}

export function encodeDiagramPng(options: {
  width: number;
  height: number;
  label: string;
}): Buffer {
  const { width, height, label } = options;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    const band = Math.floor((y / height) * 6);
    const red = 232 - band * 8;
    const green = 226 - band * 6;
    const blue = 214 - band * 4;
    for (let x = 0; x < width; x += 1) {
      const index = rowStart + 1 + x * 3;
      raw[index] = red;
      raw[index + 1] = green;
      raw[index + 2] = blue;
    }
  }

  const margin = Math.max(12, Math.round(width * 0.06));
  const ink: [number, number, number] = [28, 48, 54];
  const accent: [number, number, number] = [14, 110, 104];
  for (let x = margin; x < width - margin; x += 1) {
    setPixel(raw, width, x, margin, height, ink);
    setPixel(raw, width, x, height - margin, height, ink);
  }
  for (let y = margin; y < height - margin; y += 1) {
    setPixel(raw, width, margin, y, height, ink);
    setPixel(raw, width, width - margin, y, height, ink);
  }

  const panelTop = Math.round(height * 0.28);
  const panelBottom = Math.round(height * 0.78);
  for (let y = panelTop; y < panelBottom; y += 8) {
    for (let x = margin * 2; x < width - margin * 2; x += 1) {
      setPixel(raw, width, x, y, height, accent);
    }
  }

  const scale = Math.max(2, Math.round(width / 220));
  drawText(raw, width, height, "PLACEHOLDER", margin + 8, margin + 8, scale, ink);
  drawText(raw, width, height, label.slice(0, 42), margin + 8, margin + 8 + scale * 10, scale, accent);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
