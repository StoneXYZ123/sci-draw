import { LEDGER_REASONS } from "@sci-draw/credits";
import Stripe from "stripe";
import { grantCredits } from "@/lib/credits";
import { appUrl } from "@/lib/storage";

export const CREDIT_PACKS = [
  { id: "credits_100", credits: 100, env: "STRIPE_PRICE_100", amountEnv: "STRIPE_AMOUNT_CENTS_100", defaultAmountCents: 500 },
  { id: "credits_500", credits: 500, env: "STRIPE_PRICE_500", amountEnv: "STRIPE_AMOUNT_CENTS_500", defaultAmountCents: 2000 },
  { id: "credits_2000", credits: 2000, env: "STRIPE_PRICE_2000", amountEnv: "STRIPE_AMOUNT_CENTS_2000", defaultAmountCents: 8000 },
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

export function expectedAmountCents(packId: CreditPackId): number {
  const pack = CREDIT_PACKS.find((item) => item.id === packId);
  if (!pack) {
    throw new BillingConfigError();
  }
  const raw = process.env[pack.amountEnv]?.trim();
  if (!raw) {
    return pack.defaultAmountCents;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BillingConfigError();
  }
  return parsed;
}

export function listCreditPacks(): { packs: Array<{ id: CreditPackId; credits: number }> } {
  return {
    packs: CREDIT_PACKS.map((pack) => ({
      id: pack.id,
      credits: pack.credits,
    })),
  };
}

export function checkoutMetadata(userId: string, packId: CreditPackId): { userId: string; pack: CreditPackId; credits: string; expectedAmountTotal: string } {
  const credits = creditsForPack(packId);
  if (!credits) {
    throw new BillingConfigError();
  }
  return {
    userId,
    pack: packId,
    credits: String(credits),
    expectedAmountTotal: String(expectedAmountCents(packId)),
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
  const metadata = checkoutMetadata(input.userId, input.packId);
  const session = await stripeClient().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: input.userId,
      success_url: `${appUrl()}/billing?checkout=success`,
      cancel_url: `${appUrl()}/billing?checkout=cancel`,
      line_items: [{ price, quantity: 1 }],
      metadata,
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

function paidAmountMatches(session: Stripe.Checkout.Session): boolean {
  // Missing expectedAmountTotal is ignored in every environment, including production.
  // A cheaper Price bound to a pack must not grant that pack's credits.
  const raw = session.metadata?.expectedAmountTotal;
  if (raw === undefined || raw === "") {
    return false;
  }
  const expected = Number(raw);
  return Number.isSafeInteger(expected) && expected > 0 && session.amount_total === expected;
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
  if (!paidAmountMatches(session)) {
    console.warn("stripe checkout ignored: amount_total does not match expectedAmountTotal", {
      sessionId: session.id,
      expectedAmountTotal: session.metadata?.expectedAmountTotal ?? null,
      amountTotal: session.amount_total,
    });
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
