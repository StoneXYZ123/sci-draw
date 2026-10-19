import { ensureSignupBonus, getBalance, listLedger } from "@/lib/credits";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ user: null, ledger: [] });
  }
  await ensureSignupBonus(sessionUser.id);
  const [creditsBalance, ledger] = await Promise.all([getBalance(sessionUser.id), listLedger(sessionUser.id)]);
  return jsonNoStore({
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      creditsBalance,
    },
    ledger: ledger.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
}
