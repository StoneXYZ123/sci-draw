import { LEDGER_REASONS } from "@sci-draw/credits";
import Stripe from "stripe";
import { grantCredits } from "@/lib/credits";
import { appUrl } from "@/lib/storage";

export const CREDIT_PACKS = [
  { id: "credits_100", credits: 100, env: "STRIPE_PRICE_100" },
  { id: "credits_500", credits: 500, env: "STRIPE_PRICE_500" },
  { id: "credits_2000", credits: 2000, env: "STRIPE_PRICE_2000" },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

export function creditsForPack(packId: string): number | null {
  const pack = CREDIT_PACKS.find((item) => item.id === packId);
  return pack ? pack.credits : null;
}

export function stripeSecret(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? "";
}

export function stripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
}

function priceIdFor(packId: CreditPackId): string {
  const pack = CREDIT_PACKS.find((item) => item.id === packId);
  if (!pack) {
    return "";
  }
  return process.env[pack.env]?.trim() ?? "";
}

export function listCreditPacks(): { configured: boolean; packs: Array<{ id: CreditPackId; credits: number; available: boolean }> } {
  const secret = stripeSecret();
  return {
    configured: Boolean(secret),
    packs: CREDIT_PACKS.map((pack) => ({
      id: pack.id,
      credits: pack.credits,
      available: Boolean(secret && priceIdFor(pack.id)),
    })),
  };
}

function stripeClient(): Stripe {
  return new Stripe(stripeSecret());
}

export function isCreditPackId(value: string): value is CreditPackId {
  return CREDIT_PACKS.some((pack) => pack.id === value);
}

export async function createCheckout(input: { userId: string; packId: CreditPackId; idempotencyKey?: string }): Promise<string> {
  const secret = stripeSecret();
  const price = priceIdFor(input.packId);
  if (!secret || !price) {
    throw new BillingConfigError();
  }
  const credits = creditsForPack(input.packId);
  if (!credits) {
    throw new BillingConfigError();
  }
  const session = await stripeClient().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: input.userId,
      success_url: `${appUrl()}/billing?checkout=success`,
      cancel_url: `${appUrl()}/billing?checkout=cancel`,
      line_items: [{ price, quantity: 1 }],
      metadata: {
        userId: input.userId,
        pack: input.packId,
        credits: String(credits),
      },
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
  if (!session.url) {
    throw new Error("Checkout did not return a URL");
  }
  return session.url;
}

export class BillingConfigError extends Error {
  readonly errorCode = "PAYMENTS_UNAVAILABLE" as const;

  constructor() {
    super("Payments are not configured");
    this.name = "BillingConfigError";
  }
}

export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = stripeWebhookSecret();
  if (!secret || !stripeSecret()) {
    throw new BillingConfigError();
  }
  return stripeClient().webhooks.constructEvent(rawBody, signature, secret);
}

export async function applyCheckoutSession(session: Stripe.Checkout.Session): Promise<"applied" | "duplicate" | "ignored"> {
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return "ignored";
  }
  const userId = session.metadata?.userId || session.client_reference_id || "";
  const pack = session.metadata?.pack ?? "";
  if (!userId || !isCreditPackId(pack)) {
    return "ignored";
  }
  if (session.client_reference_id && session.client_reference_id !== userId) {
    return "ignored";
  }
  const credits = creditsForPack(pack);
  if (!credits) {
    return "ignored";
  }
  if (session.metadata?.credits && session.metadata.credits !== String(credits)) {
    return "ignored";
  }
  if (!session.id) {
    return "ignored";
  }
  try {
    return await grantCredits(userId, credits, LEDGER_REASONS.purchaseStripe, session.id, "stripe_checkout");
  } catch (error) {
    if (error instanceof Error && error.message === "User not found") {
      return "ignored";
    }
    throw error;
  }
}
