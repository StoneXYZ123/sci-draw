import { getBalance } from "@/lib/credits";
import { jsonNoStore } from "@/lib/http";
import { mapPublicError, requireApiUser } from "@/lib/public-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { userId } = await requireApiUser(request);
    return jsonNoStore({ balance: await getBalance(userId) });
  } catch (error) {
    return mapPublicError(error);
  }
}
