import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { LEDGER_REASONS } from "@sci-draw/credits";
import { eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { creditLedger, user } from "@/db/schema";
import { getDb } from "@/db";
import { applyCheckoutSession, checkoutMetadata, creditsForPack, expectedAmountCents, isCreditPackId, listCreditPacks } from "./billing";
import { getBalance } from "./credits";

const userIds: string[] = [];

function requireDatabase(): void {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
}

async function insertUser(): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await getDb().insert(user).values({
    id,
    name: "Billing test",
    email: `${id}@billing.test`,
    emailVerified: false,
    creditsBalance: 0,
  });
  return id;
}

function paidSession(userId: string, sessionId: string, amountTotal: number, metadata: Stripe.Metadata | null): Stripe.Checkout.Session {
  return {
    id: sessionId,
    mode: "payment",
    payment_status: "paid",
    amount_total: amountTotal,
    client_reference_id: userId,
    metadata,
  } as Stripe.Checkout.Session;
}

async function purchaseRows(sessionId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(creditLedger)
    .where(sql`${creditLedger.refId} = ${sessionId} and ${creditLedger.reason} = ${LEDGER_REASONS.purchaseStripe}`);
  return Number(row?.count ?? 0);
}

describe("credit pack catalog", () => {
  it("maps pack ids and hides Stripe configuration", () => {
    assert.equal(creditsForPack("credits_100"), 100);
    assert.equal(creditsForPack("credits_500"), 500);
    assert.equal(creditsForPack("credits_2000"), 2000);
    assert.equal(creditsForPack("credits_1"), null);
    assert.equal(isCreditPackId("credits_100"), true);
    assert.equal(isCreditPackId("signup"), false);
    const listed = listCreditPacks();
    assert.equal("configured" in listed, false);
    assert.deepEqual(
      listed.packs.map((pack) => pack.credits),
      [100, 500, 2000],
    );
    assert.equal(listed.packs.some((pack) => "available" in pack), false);
  });

  it("writes the expected amount into checkout metadata", () => {
    const previous = process.env.STRIPE_AMOUNT_CENTS_100;
    process.env.STRIPE_AMOUNT_CENTS_100 = "1234";
    try {
      assert.equal(expectedAmountCents("credits_100"), 1234);
      const metadata = checkoutMetadata("user_1", "credits_100");
      assert.equal(metadata.expectedAmountTotal, "1234");
      assert.equal(metadata.credits, "100");
      assert.equal(metadata.pack, "credits_100");
      assert.equal(metadata.userId, "user_1");
    } finally {
      if (previous === undefined) {
        delete process.env.STRIPE_AMOUNT_CENTS_100;
      } else {
        process.env.STRIPE_AMOUNT_CENTS_100 = previous;
      }
    }
  });
});

describe("checkout session grants", () => {
  after(async () => {
    if (!process.env.DATABASE_URL || userIds.length === 0) {
      return;
    }
    await getDb().delete(user).where(inArray(user.id, userIds));
  });

  it("grants credits when amount_total matches and ignores mismatches", async () => {
    requireDatabase();
    const userId = await insertUser();
    const cents = expectedAmountCents("credits_100");
    const matched = paidSession(userId, `cs_${userId}_ok`, cents, {
      userId,
      pack: "credits_100",
      credits: "100",
      expectedAmountTotal: String(cents),
    });
    assert.equal(await applyCheckoutSession(matched), "applied");
    assert.equal(await getBalance(userId), 100);
    assert.equal(await purchaseRows(matched.id), 1);

    const mismatched = paidSession(userId, `cs_${userId}_bad`, 50, {
      userId,
      pack: "credits_100",
      credits: "100",
      expectedAmountTotal: String(cents),
    });
    assert.equal(await applyCheckoutSession(mismatched), "ignored");
    assert.equal(await getBalance(userId), 100);
    assert.equal(await purchaseRows(mismatched.id), 0);

    const missing = paidSession(userId, `cs_${userId}_miss`, cents, {
      userId,
      pack: "credits_100",
      credits: "100",
    });
    assert.equal(await applyCheckoutSession(missing), "ignored");
    assert.equal(await purchaseRows(missing.id), 0);

    const unpaid = paidSession(userId, `cs_${userId}_unpaid`, cents, matched.metadata);
    unpaid.payment_status = "unpaid";
    assert.equal(await applyCheckoutSession(unpaid), "ignored");

    const badPack = paidSession(userId, `cs_${userId}_pack`, cents, {
      userId,
      pack: "credits_1",
      credits: "1",
      expectedAmountTotal: String(cents),
    });
    assert.equal(await applyCheckoutSession(badPack), "ignored");
    assert.equal(await getBalance(userId), 100);
  });

  it("treats a repeated session id as a duplicate grant", async () => {
    requireDatabase();
    const userId = await insertUser();
    const cents = expectedAmountCents("credits_500");
    const session = paidSession(userId, `cs_${userId}_dup`, cents, {
      userId,
      pack: "credits_500",
      credits: "500",
      expectedAmountTotal: String(cents),
    });
    const [first, second] = await Promise.all([applyCheckoutSession(session), applyCheckoutSession(session)]);
    assert.deepEqual([first, second].sort(), ["applied", "duplicate"]);
    assert.equal(await applyCheckoutSession(session), "duplicate");
    assert.equal(await getBalance(userId), 500);
    const [row] = await getDb().select({ creditsBalance: user.creditsBalance }).from(user).where(eq(user.id, userId)).limit(1);
    assert.equal(row?.creditsBalance, 500);
    assert.equal(await purchaseRows(session.id), 1);
  });
});
