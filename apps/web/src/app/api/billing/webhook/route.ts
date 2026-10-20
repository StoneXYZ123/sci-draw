import { applyCheckoutSession, BillingConfigError, constructStripeEvent } from "@/lib/billing";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonNoStore({ error: "Missing Stripe signature" }, 400);
  }
  const raw = await request.text();
  try {
    const event = constructStripeEvent(raw, signature);
    if (event.type === "checkout.session.completed") {
      await applyCheckoutSession(event.data.object);
    }
    return jsonNoStore({ received: true });
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonNoStore({ error: error.message, errorCode: error.errorCode }, 503);
    }
    const stripeError = error instanceof Error && error.message.toLowerCase().includes("signature");
    if (stripeError) {
      return jsonNoStore({ error: "Invalid Stripe signature" }, 400);
    }
    console.error("stripe webhook failed", error instanceof Error ? error.message : "unknown");
    return jsonNoStore({ error: "Could not record the payment" }, 500);
  }
}
