import { createOpenSourceConvertProvider } from "./opensource";
import type { ConvertProvider } from "./types";

export type ConvertProviderEnv = {
  CONVERT_PROVIDER?: string;
};

export type ConvertProviderId = "opensource" | "unconfigured";

export function resolveConvertProviderId(env: ConvertProviderEnv): ConvertProviderId {
  const requested = (env.CONVERT_PROVIDER ?? "opensource").trim().toLowerCase();
  if (requested === "opensource" || requested === "") {
    return "opensource";
  }
  return "unconfigured";
}

export function createConvertProvider(env: ConvertProviderEnv): ConvertProvider {
  const id = resolveConvertProviderId(env);
  switch (id) {
    case "opensource":
      return createOpenSourceConvertProvider();
    case "unconfigured": {
      const requested = env.CONVERT_PROVIDER ?? "";
      throw new Error(`Convert provider "${requested}" is not available in this release`);
    }
    default: {
      const neverId: never = id;
      throw new Error(`Unhandled convert provider ${neverId}`);
    }
  }
}
