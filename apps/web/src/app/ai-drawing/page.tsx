import { AiDrawingStudio } from "@/components/ai-drawing-studio";

type Mode = "prompt" | "sketch" | "replicate";

function initialMode(value: string | undefined): Mode {
  if (value === "sketch" || value === "replicate") {
    return value;
  }
  return "prompt";
}

export default async function AiDrawingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const params = await searchParams;
  return <AiDrawingStudio locale="en" initialMode={initialMode(params.mode)} />;
}
