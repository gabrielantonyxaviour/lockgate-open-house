import { isAddress } from "viem";
import { ALLOWED_CHAIN_IDS } from "../chains.js";
import type { Mandate } from "../domain.js";
import { EngineError } from "../errors.js";
import { creConfigSchema, migrateConfig, type CreConfig } from "../schema/config.js";
import { isRecord } from "../schema/version.js";
import { signableFindings } from "./signable.js";

export type CheckArea = "mandate" | "adapter" | "limit";

export type CheckFinding = {
  area: CheckArea;
  path: string;
  ok: boolean;
  code: string;
  message: string;
};

export type CheckReport = {
  ok: boolean;
  findings: CheckFinding[];
};

function finding(area: CheckArea, path: string, ok: boolean, code: string, message: string): CheckFinding {
  return { area, path, ok, code, message };
}

function finish(findings: CheckFinding[]): CheckReport {
  return { ok: findings.length > 0 && findings.every((item) => item.ok), findings };
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function limitFor(limits: Record<string, bigint>, platform: string): bigint | undefined {
  if (limits[platform] !== undefined) return limits[platform];
  for (const [key, value] of Object.entries(limits)) {
    if (same(key, platform)) return value;
  }
  return undefined;
}

function reserveRequired(exposureAfter: bigint, reserveBps: number): bigint {
  if (reserveBps <= 0 || exposureAfter === 0n) return 0n;
  return (exposureAfter * BigInt(reserveBps) + 9_999n) / 10_000n;
}

/** Read a config and report mandate, adapter, limit, and signing problems. A bad document still returns a report. */
export function checkConfig(raw: unknown): CheckReport {
  if (!isRecord(raw)) throw new EngineError("param", "config must be an object");
  let migrated: unknown;
  try {
    migrated = migrateConfig(raw);
  } catch (err) {
    if (!(err instanceof EngineError)) throw err;
    return finish([finding("mandate", "schemaVersion", false, "schema-version", err.message)]);
  }
  const parsed = creConfigSchema.safeParse(migrated);
  if (!parsed.success) {
    return finish(parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "input";
      return finding(areaFor(path, issue.message), path, false, "schema", issue.message);
    }));
  }
  return finish([
    ...mandateFindings(parsed.data),
    ...adapterFindings(parsed.data),
    ...limitFindings(parsed.data),
    ...signableFindings(parsed.data),
  ]);
}

function areaFor(path: string, message: string): CheckArea {
  if (/kasu|maple|usdai|adapter/i.test(`${path} ${message}`)) return "adapter";
  if (/limit|platformLimits|reserve|minFee|maxFee|concentration|bookAssets|exposure/i.test(path)) return "limit";
  return "mandate";
}

function mandateFindings(config: CreConfig): CheckFinding[] {
  const out: CheckFinding[] = [];
  if (ALLOWED_CHAIN_IDS.has(config.chainId)) {
    out.push(finding("mandate", "chainId", true, "chain", "chain id is one the engine will sign"));
  } else {
    out.push(finding("mandate", "chainId", false, "chain", "chain id is not one the engine will sign"));
  }
  config.vaults.forEach((vault, index) => {
    const path = `vaults.${index}.mandate`;
    const problems = vaultProblems(config, vault.mandate, path);
    if (problems.length === 0) {
      out.push(finding("mandate", path, true, "mandate", "mandate matches its platforms, tenor, and snapshot"));
    } else out.push(...problems);
  });
  config.requests.forEach((request, index) => {
    const path = `requests.${index}`;
    const approvers = config.vaults.filter((vault) =>
      vault.mandate.approvedPlatforms.some((item) => same(item, request.platform)),
    );
    if (approvers.length === 0) {
      out.push(finding("mandate", `${path}.platform`, false, "platform", "platform is not on a mandate"));
      return;
    }
    const payable = approvers.some((vault) => same(request.recipient, vault.mandate.payoutTo ?? request.platform));
    if (!payable) {
      out.push(finding("mandate", `${path}.recipient`, false, "recipient", "recipient is not the platform payout address"));
    }
    if (request.input.now !== config.now) {
      out.push(finding("mandate", `${path}.input.now`, false, "clock", "request clock does not match the config clock"));
    }
  });
  return out;
}

function vaultProblems(config: CreConfig, mandate: Mandate, path: string): CheckFinding[] {
  const out: CheckFinding[] = [];
  const seen = new Set<string>();
  for (const platform of mandate.approvedPlatforms) {
    const key = platform.toLowerCase();
    if (seen.has(key)) {
      out.push(finding("mandate", `${path}.approvedPlatforms`, false, "duplicate-platform", "approved platform is listed twice"));
    }
    seen.add(key);
    if (limitFor(mandate.platformLimits, platform) === undefined) {
      out.push(finding("mandate", `${path}.platformLimits`, false, "platform-limit", "mandate has no limit for this platform"));
    }
  }
  for (const key of Object.keys(mandate.platformLimits)) {
    if (!isAddress(key)) {
      out.push(finding("mandate", `${path}.platformLimits`, false, "limit-key", "platform limit key is not an address"));
      continue;
    }
    if (!mandate.approvedPlatforms.some((item) => same(item, key))) {
      out.push(finding("mandate", `${path}.platformLimits`, false, "orphan-limit", "platform limit is not an approved platform"));
    }
  }
  if (mandate.paused) out.push(finding("mandate", `${path}.paused`, false, "paused", "vault is paused"));
  if (mandate.expiresAt <= config.now) {
    out.push(finding("mandate", `${path}.expiresAt`, false, "expired", "mandate has expired"));
  }
  if (mandate.maxTenorSeconds > config.params.maxTenorSeconds) {
    out.push(finding("mandate", `${path}.maxTenorSeconds`, false, "tenor", "mandate tenor is longer than the pricing tenor"));
  }
  if (mandate.idle === undefined || mandate.totalAssets === undefined) {
    out.push(finding("mandate", path, false, "snapshot", "idle cash and vault assets are required"));
  }
  return out;
}

function adapterFindings(config: CreConfig): CheckFinding[] {
  return config.requests.flatMap((request, index) => {
    const path = `requests.${index}`;
    if (request.kasu) return readFindings(path, "kasu", request.kasu.kind, request.input.kind, request.kasu.poolDecimals, request.kasu.truncated);
    if (request.maple) return readFindings(path, "maple", request.maple.kind, request.input.kind, 6, request.maple.truncated);
    if (request.usdai) return readFindings(path, "usdai", request.usdai.kind, request.input.kind, 6, false);
    return [finding("adapter", path, true, "none", "request has no adapter read")];
  });
}

function readFindings(
  path: string,
  name: string,
  readKind: string,
  inputKind: string,
  decimals: number | null,
  truncated: boolean,
): CheckFinding[] {
  const problems: CheckFinding[] = [];
  if (inputKind !== readKind) {
    problems.push(finding("adapter", `${path}.${name}`, false, "adapter-kind", "adapter kind does not match the request"));
  }
  if (name === "kasu" && decimals !== 6) {
    problems.push(finding("adapter", `${path}.kasu.poolDecimals`, false, "pool-decimals", "Kasu pool token must report 6 decimals"));
  }
  if (truncated) {
    problems.push(finding("adapter", `${path}.${name}.truncated`, false, "scan-truncated", "a partial queue scan cannot be signed"));
  }
  if (problems.length > 0) return problems;
  return [finding("adapter", `${path}.${name}`, true, "adapter", "adapter read matches the request")];
}

function limitFindings(config: CreConfig): CheckFinding[] {
  const out: CheckFinding[] = [];
  config.vaults.forEach((vault, index) => {
    if (vault.mandate.minFeeBps > config.params.maxFeeBps) {
      out.push(finding(
        "limit",
        `vaults.${index}.mandate.minFeeBps`,
        false,
        "mandate-min",
        "vault minimum fee is above the protocol maximum",
      ));
    }
  });
  config.requests.forEach((request, index) => {
    out.push(...requestLimits(config, request, `requests.${index}.input`));
  });
  return out;
}

function requestLimits(
  config: CreConfig,
  request: CreConfig["requests"][number],
  path: string,
): CheckFinding[] {
  const input = request.input;
  const problems: CheckFinding[] = [];
  if (input.reserveBps < 500 || input.reserveBps > 1_000) {
    problems.push(finding("limit", `${path}.reserveBps`, false, "reserve-policy", "platform reserve ratio must be 5% to 10%"));
  }
  const exposureAfter = input.exposure + input.navValue;
  if (exposureAfter > input.limit) {
    problems.push(finding("limit", `${path}.limit`, false, "limit", "advance would exceed the platform limit"));
  }
  const caps = config.vaults
    .filter((vault) => vault.mandate.approvedPlatforms.some((item) => same(item, request.platform)))
    .map((vault) => limitFor(vault.mandate.platformLimits, request.platform))
    .filter((value): value is bigint => value !== undefined);
  const cap = caps.reduce<bigint | undefined>((best, value) => (best === undefined || value > best ? value : best), undefined);
  if (cap !== undefined && exposureAfter > cap) {
    problems.push(finding("limit", path, false, "mandate-limit", "advance would exceed the mandate platform limit"));
  }
  if (cap !== undefined && input.limit > cap) {
    problems.push(finding("limit", path, false, "above-mandate", "quote limit is above the mandate platform limit"));
  }
  if (input.reserveBalance < reserveRequired(exposureAfter, input.reserveBps)) {
    problems.push(finding("limit", `${path}.reserveBalance`, false, "reserve", "posted reserve does not cover exposure after this advance"));
  }
  if (problems.length > 0) return problems;
  return [finding("limit", path, true, "limit", "exposure stays inside the quote limit and the mandate limit")];
}
