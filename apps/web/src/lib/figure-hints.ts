const TEMPLATE_HINTS: Record<string, string> = {
  "toc-abstract": "Arrange this as a compact graphical abstract with a left-to-right reading order.",
  "journal-cover": "Compose this as a journal cover figure with a single focal subject.",
  "experimental-workflow": "Lay the content out as a stepwise experimental workflow.",
  "mechanism-illustration": "Show the mechanism as a small number of labeled stages.",
  "signaling-pathway": "Draw a signaling pathway with arrows between named nodes.",
  "system-architecture": "Draw a system diagram with boxes and connectors.",
  "comparison-analysis": "Place two or more conditions side by side for comparison.",
};

const STYLE_HINTS: Record<string, string> = {
  "flat-illustration": "Use flat shapes and a limited palette.",
  "isometric-3d": "Use a simple isometric view.",
  "photorealistic": "Render materials with photographic detail.",
  "schematic-diagram": "Use a clean schematic line style.",
  "artistic-abstract": "Keep the composition abstract and spare.",
  "scientific-illustration": "Use a textbook scientific illustration style.",
};

export function figureHints(templateId: string, styleId: string): string[] {
  const hints: string[] = [];
  const template = TEMPLATE_HINTS[templateId];
  if (template) {
    hints.push(template);
  }
  const style = STYLE_HINTS[styleId];
  if (style) {
    hints.push(style);
  }
  return hints;
}

export function modeInstruction(mode: "prompt" | "sketch" | "replicate"): string | null {
  switch (mode) {
    case "prompt":
      return null;
    case "sketch":
      return "Turn the attached sketch into a finished figure and keep its layout.";
    case "replicate":
      return "Use the attached image as a visual reference for a new figure.";
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

export function buildModelPrompt(input: {
  mode: "prompt" | "sketch" | "replicate";
  text: string;
  templateId: string;
  styleId: string;
  batchIndex: number;
  batchCount: number;
}): string {
  const parts = [input.text, ...figureHints(input.templateId, input.styleId)];
  const instruction = modeInstruction(input.mode);
  if (instruction) {
    parts.push(instruction);
  }
  if (input.batchIndex > 0) {
    parts.push(`Draw a distinct variation ${input.batchIndex + 1} of ${input.batchCount}.`);
  }
  return parts.join("\n\n");
}
