import assert from "node:assert/strict";
import test from "node:test";
import { encodeDiagramPng } from "../image/png";
import { createConvertProvider, resolveConvertProviderId } from "./factory";

const sample = encodeDiagramPng({ width: 48, height: 36, label: "CELL" });

test("unknown convert provider is rejected", () => {
  assert.equal(resolveConvertProviderId({ CONVERT_PROVIDER: "opensource" }), "opensource");
  assert.equal(resolveConvertProviderId({}), "opensource");
  assert.throws(() => createConvertProvider({ CONVERT_PROVIDER: "vendor" }), /not available/);
});

test("text-only svg is an editable text layer", async () => {
  const file = await createConvertProvider({}).toSvg({
    bytes: sample,
    mimeType: "image/png",
    mode: "text-only",
  });
  const svg = Buffer.from(file.bytes).toString("utf8");
  assert.equal(file.extension, "svg");
  assert.match(svg, /<svg/);
  assert.match(svg, /<text/);
});

test("full svg traces the bitmap", async () => {
  const file = await createConvertProvider({}).toSvg({
    bytes: sample,
    mimeType: "image/png",
    mode: "full",
  });
  const svg = Buffer.from(file.bytes).toString("utf8");
  assert.match(svg, /<svg/);
  assert.match(svg, /<path/);
});

test("pptx is a zip package and png keeps the signature", async () => {
  const provider = createConvertProvider({});
  const pptx = await provider.toPptx({ bytes: sample, mimeType: "image/png" });
  assert.equal(pptx.bytes[0], 0x50);
  assert.equal(pptx.bytes[1], 0x4b);
  const png = await provider.toRaster({ bytes: sample, mimeType: "image/png", format: "png", dpi: 300 });
  assert.equal(png.bytes[0], 0x89);
  assert.equal(String.fromCharCode(...png.bytes.slice(1, 4)), "PNG");
});
