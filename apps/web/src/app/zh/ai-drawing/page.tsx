import { AiDrawingStudio } from "@/components/ai-drawing-studio";

type Mode = "prompt" | "sketch" | "replicate";

function initialMode(value: string | undefined): Mode {
  if (value === "sketch" || value === "replicate") {
    return value;
  }
  return "prompt";
}

export default async function ZhAiDrawingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const params = await searchParams;
  return <AiDrawingStudio locale="zh" initialMode={initialMode(params.mode)} />;
}
