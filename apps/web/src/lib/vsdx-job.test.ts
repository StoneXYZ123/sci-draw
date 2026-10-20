import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { user } from "@/db/schema";
import { getDb } from "@/db";
import { getBalance } from "@/lib/credits";
import { readResultObject, resultKeyForUser } from "@/lib/storage";
import { storeReadyUpload } from "@/lib/uploads";
import { processVsdxJob, readVsdxJob, startVsdxJob } from "@/lib/vsdx-job";

const userIds: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("configured VSDX jobs", () => {
  after(async () => {
    if (!process.env.DATABASE_URL || userIds.length === 0) {
      return;
    }
    await getDb().delete(user).where(inArray(user.id, userIds));
  });

  it("charges 20 credits and stores a vsdx package when the provider is mock", async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
    const previous = process.env.CONVERT_VSDX_PROVIDER;
    process.env.CONVERT_VSDX_PROVIDER = "mock";
    const id = randomUUID();
    userIds.push(id);
    try {
      await getDb().insert(user).values({
        id,
        name: "VSDX test",
        email: `${id}@vsdx.test`,
        emailVerified: false,
        creditsBalance: 0,
      });
      const objectKey = await storeReadyUpload({
        userId: id,
        purpose: "convert-source",
        filename: "dot.png",
        contentType: "image/png",
        bytes: png,
      });
      const started = await startVsdxJob({
        userId: id,
        batchId: `vsdx-test-${id}`,
        request: { objectKey, filename: "dot.png", inputHash: "dot" },
      });
      assert.equal(started.row.status, "pending");
      assert.equal(await getBalance(id), 0);
      await processVsdxJob(started.row.id);
      const view = await readVsdxJob(id, started.row.id);
      assert.equal(view?.status, "completed");
      assert.equal(view?.creditsConsumed, 20);
      assert.equal(typeof view?.vsdxUrl, "string");
      const key = resultKeyForUser(view?.vsdxUrl ?? "", id);
      assert.ok(key);
      const bytes = await readResultObject(key);
      assert.ok(bytes);
      assert.equal(bytes[0], 0x50);
      assert.equal(bytes[1], 0x4b);
      const [row] = await getDb().select({ creditsBalance: user.creditsBalance }).from(user).where(eq(user.id, id)).limit(1);
      assert.equal(row?.creditsBalance, 0);
    } finally {
      if (previous === undefined) {
        delete process.env.CONVERT_VSDX_PROVIDER;
      } else {
        process.env.CONVERT_VSDX_PROVIDER = previous;
      }
    }
  });
});
