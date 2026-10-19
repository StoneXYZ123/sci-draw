import { ASPECT_RATIOS, RESOLUTIONS } from "@sci-draw/schemas";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";

export function GET() {
  return jsonNoStore({
    aspectRatios: [...ASPECT_RATIOS],
    resolutions: [...RESOLUTIONS],
  });
}
