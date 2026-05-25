// Public API surface for Lumen. UI imports only from `@/lib/api`.
// Swap implementations behind these names to wire a real backend.
export * as auth from "./auth";
export * as admin from "./admin";
export * as adminModels from "./admin-models";
export * as canvases from "./canvases";
export * as generate from "./generate";
export * as history from "./history";
export * as sessions from "./sessions";
export * as subjects from "./subjects";

export type ApiError = {
  code: "INVALID_CREDENTIALS" | "USERNAME_TAKEN" | "ACCOUNT_PENDING" | "ACCOUNT_DISABLED" | "NOT_FOUND" | "UPSTREAM_ERROR";
  message: string;
};

export class LumenApiError extends Error {
  code: ApiError["code"];
  constructor(code: ApiError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const fakeLatency = (min = 250, max = 650) =>
  sleep(min + Math.random() * (max - min));
