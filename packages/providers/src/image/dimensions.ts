const LOGICAL_2K: Record<string, { width: number; height: number }> = {
  "1:1": { width: 2048, height: 2048 },
  "16:9": { width: 2560, height: 1440 },
  "9:16": { width: 1440, height: 2560 },
  "4:3": { width: 2400, height: 1792 },
  "3:4": { width: 1792, height: 2400 },
  "3:2": { width: 2400, height: 1600 },
  "2:3": { width: 1600, height: 2400 },
  "5:4": { width: 2400, height: 1920 },
  "4:5": { width: 1920, height: 2400 },
  "21:9": { width: 2520, height: 1080 },
};

export function logicalImageSize(aspectRatio: string, resolution: "2K" | "4K"): { width: number; height: number } {
  const base = LOGICAL_2K[aspectRatio] ?? LOGICAL_2K["4:3"];
  if (!base) {
    return { width: 2400, height: 1792 };
  }
  if (resolution === "4K") {
    return { width: base.width * 2, height: base.height * 2 };
  }
  return base;
}

export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const buf = Buffer.from(bytes);
  if (buf.length >= 24 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        break;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segmentLength = buf.readUInt16BE(offset + 2);
      const isStartOfFrame =
        marker !== undefined &&
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isStartOfFrame) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      if (segmentLength < 2) {
        break;
      }
      offset += 2 + segmentLength;
    }
  }
  return null;
}
