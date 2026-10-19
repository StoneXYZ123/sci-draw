import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { ensureSignupBonus } from "@/lib/credits";

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const trustedOrigins = Array.from(new Set([baseURL, "http://localhost:3000", "http://127.0.0.1:3000"]));
  return betterAuth({
    appName: "sci-draw",
    baseURL,
    trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        creditsBalance: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await ensureSignupBonus(created.id);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}

export const auth = {
  handler(request: Request) {
    return getAuth().handler(request);
  },
  get api() {
    return getAuth().api;
  },
};
