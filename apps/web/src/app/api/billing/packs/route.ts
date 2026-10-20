import { listCreditPacks } from "@/lib/billing";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonNoStore(listCreditPacks());
}
