import { EngineError, isTransport } from "../errors.js";
import type { ContractReader } from "./reader.js";

/**
 * Each adapter read paces its own calls. The first `burst` calls start immediately.
 * Later calls wait `intervalMs`. A transport failure is retried with exponential
 * backoff. A decode error is not retried. Two reads do not share a bucket.
 */
export type ReadPolicy = {
  burst: number;
  intervalMs: number;
  attempts: number;
  backoffMs: number;
};

export const ADAPTER_POLICY: ReadPolicy = {
  burst: 32,
  intervalMs: 100,
  attempts: 3,
  backoffMs: 100,
};

export function withPolicy(reader: ContractReader, policy: ReadPolicy = ADAPTER_POLICY): ContractReader {
  const checked = checkPolicy(policy);
  const take = createLimiter(checked);
  return {
    async readContract(args) {
      let last: unknown;
      for (let attempt = 1; attempt <= checked.attempts; attempt++) {
        await take();
        try {
          return await reader.readContract(args);
        } catch (err) {
          last = err;
          if (!retryable(err) || attempt === checked.attempts) throw err;
          await wait(checked.backoffMs * 2 ** (attempt - 1));
        }
      }
      throw last;
    },
  };
}

function checkPolicy(policy: ReadPolicy): ReadPolicy {
  if (!Number.isInteger(policy.burst) || policy.burst < 1 || policy.burst > 256) {
    throw new EngineError("param", "adapter burst must be from 1 to 256");
  }
  if (!Number.isInteger(policy.intervalMs) || policy.intervalMs < 0 || policy.intervalMs > 60_000) {
    throw new EngineError("param", "adapter interval must be from 0 to 60000 ms");
  }
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1 || policy.attempts > 5) {
    throw new EngineError("param", "adapter attempts must be from 1 to 5");
  }
  if (!Number.isInteger(policy.backoffMs) || policy.backoffMs < 0 || policy.backoffMs > 60_000) {
    throw new EngineError("param", "adapter backoff must be from 0 to 60000 ms");
  }
  return policy;
}

function retryable(err: unknown): boolean {
  if (err instanceof EngineError) return false;
  if (isTransport(err)) return true;
  if (err && typeof err === "object" && (err as { status?: unknown }).status === 429) return true;
  return err instanceof Error && /too many requests|rate limit/i.test(err.message);
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createLimiter(policy: ReadPolicy): () => Promise<void> {
  let tokens = policy.burst;
  let updatedAt = Date.now();
  let tail = Promise.resolve();
  const acquire = async (): Promise<void> => {
    for (;;) {
      const now = Date.now();
      if (policy.intervalMs === 0) return;
      const gained = Math.floor((now - updatedAt) / policy.intervalMs);
      if (gained > 0) {
        tokens = Math.min(policy.burst, tokens + gained);
        updatedAt += gained * policy.intervalMs;
      }
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await wait(Math.max(1, policy.intervalMs - (now - updatedAt)));
    }
  };
  return () => {
    const run = tail.then(acquire);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
