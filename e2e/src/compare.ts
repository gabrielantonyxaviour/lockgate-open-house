import { encodeFunctionData, type Address } from "viem";
import { mulDivCeil, mulDivRoundHalfUp } from "../../engine/src/money.ts";
import { quoteExit } from "../../engine/src/quote.ts";
import { feeFromBps, quoteFee } from "../../sim/src/pricing.ts";
import { DEMO_TIME_SCALE } from "../../sim/src/params.ts";
import {
  artifact,
  deploy,
  deployer,
  fail,
  harbour,
  lockgate,
  platform,
  proposerKey,
  publicClient,
  read,
  send,
  usd,
  RPC,
} from "./chain.js";
import { classify, type CompareSheet } from "./diverge.js";
import { enginePropose, engineQuote, stageQuoteBody, type VaultMandate } from "./engine.js";

const NAV = usd(10_000n);
const DEPOSIT = usd(80_000n);
const ROUND_NAV = 1_000_001n;
const SECONDS = 600;

export async function runCompare(): Promise<CompareSheet> {
  const chainId = await publicClient.getChainId();
  if (chainId !== 31_337) fail("chain", `refusing chain ${chainId}`);
  process.env.LOCKGATE_PROPOSER_KEY = proposerKey;

  const pricing = await deploy("PricingEngine", [deployer.address]);
  const chain = await chainQuote(pricing, 0);
  const chainFull = await chainQuote(pricing, 10_000);
  const sim = simQuote(0, 0);
  const simAged = simQuote(3_600, 0);
  const simFull = simQuote(0, 10_000);
  if (!sim.available || !simAged.available || !simFull.available) fail("sim", "sim refused the 600s window");

  const token = await deploy("MockUSDG", [deployer.address]);
  const vault = await vaultFor(token);
  const opened = await publicClient.getBlock();
  await openVault(token, vault, Number(opened.timestamp));
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);
  const quoted = quoteExit(stageQuoteBody(now, NAV).input, stageQuoteBody(now, NAV).params);
  const fullBody = stageQuoteBody(now, NAV);
  fullBody.input.utilizationBps = 10_000;
  const quotedFull = quoteExit(fullBody.input, fullBody.params);
  const idleBefore = await read<bigint>("PartnerVault", vault, "idle");
  const proposal = await enginePropose({
    now,
    nav: NAV,
    vault,
    platform: platform.address,
    nonce: 1n,
    signEnv: "LOCKGATE_PROPOSER_KEY",
    rpc: RPC,
    mandate: await vaultMandate(vault),
  });
  if (!proposal.submittable || !proposal.signature) {
    fail("engine", proposal.blocks.map((item) => `${item.code}: ${item.reason}`).join("; "));
  }
  const cli = await engineQuote(now, NAV);
  if (cli.fee !== proposal.fee || cli.feeBps !== proposal.feeBps) {
    fail("engine", `cli fee ${cli.fee} bps ${cli.feeBps} disagreed with the signed proposal`);
  }
  await send("PartnerVault", vault, "execute", [proposal.message, proposal.signature, "0x"], harbour);
  const advance = await read<unknown>("PartnerVault", vault, "getAdvance", [1n]);
  const idleAfterFund = await read<bigint>("PartnerVault", vault, "idle");
  await send("MockUSDG", token, "mint", [platform.address, proposal.fee], deployer);
  await send("MockUSDG", token, "approve", [vault, proposal.message.navValue], platform);
  await send("PartnerVault", vault, "repay", [1n], platform);

  const bps = chain.bps;
  return {
    block: Number(block.number),
    now,
    nav: NAV,
    seconds: SECONDS,
    timeScale: DEMO_TIME_SCALE,
    sim: {
      bps: sim.bps,
      rawBps: sim.rawBps,
      agedBps: simAged.bps,
      fee: BigInt(feeFromBps(Number(NAV), sim.bps)),
    },
    engine: {
      bps: quoted.feeBps,
      fee: quoted.fee,
      payout: quoted.payout,
      pricedSeconds: quoted.pricedSeconds,
      apr: quoted.apr.total,
      riskBps: quoted.risk.bps,
    },
    chain: { bps: chain.bps, fee: chain.fee, reason: chain.reason },
    funded: {
      vaultFee: BigInt(cell(advance, "fee", 3)),
      vaultPayout: BigInt(cell(advance, "principal", 4)),
      idleBefore,
      idleAfterFund,
      idleAfterRepay: await read<bigint>("PartnerVault", vault, "idle"),
      lockgate: await read<bigint>("MockUSDG", token, "balanceOf", [lockgate.address]),
    },
    rounding: {
      nav: ROUND_NAV,
      bps,
      sim: BigInt(feeFromBps(Number(ROUND_NAV), bps)),
      engineHalfUp: mulDivRoundHalfUp(ROUND_NAV, BigInt(bps), 10_000n),
      engineCeil: mulDivCeil(ROUND_NAV, BigInt(bps), 10_000n),
      chain: await read<bigint>("PricingEngine", pricing, "feeFromBps", [ROUND_NAV, bps]),
    },
    fullUtil: { sim: simFull.bps, engine: quotedFull.feeBps, chain: chainFull.bps },
  };
}

export function compared(sheet: CompareSheet) {
  return classify(sheet);
}

async function chainQuote(pricing: Address, utilization: number) {
  const row = await read<unknown>("PricingEngine", pricing, "feeBps", [BigInt(SECONDS), 0n, false, 0, utilization]);
  const bps = Number(cell(row, "bps", 0));
  const available = Boolean(cell(row, "available", 1));
  if (!available) fail("quote", `chain refused ${utilization} util: ${String(cell(row, "reason", 2))}`);
  return {
    bps,
    reason: String(cell(row, "reason", 2) ?? ""),
    fee: await read<bigint>("PricingEngine", pricing, "feeFromBps", [NAV, bps]),
  };
}

function simQuote(navAgeSeconds: number, utilizationBps: number) {
  return quoteFee({
    secondsToWindow: SECONDS,
    navAgeSeconds,
    gated: false,
    exposureBps: 0,
    utilizationBps,
    riskBps: 10_000,
    timeScale: DEMO_TIME_SCALE,
  });
}

async function vaultFor(token: Address): Promise<Address> {
  const impl = await deploy("PartnerVault", []);
  const data = encodeFunctionData({
    abi: artifact("PartnerVault"),
    functionName: "initialize",
    args: [harbour.address, token, 86_400, 86_400],
  });
  return deploy("ERC1967Proxy", [impl, data]);
}

async function openVault(token: Address, vault: Address, now: number) {
  await send("PartnerVault", vault, "setProposer", [lockgate.address], harbour);
  await send("PartnerVault", vault, "setMandate", [25, 30 * 86_400, 10_000, BigInt(now + 365 * 86_400)], harbour);
  await send("PartnerVault", vault, "setPlatform", [platform.address, true, usd(100_000n), 0, false, 7 * 86_400], harbour);
  await send("MockUSDG", token, "mint", [harbour.address, DEPOSIT], deployer);
  await send("MockUSDG", token, "approve", [vault, DEPOSIT], harbour);
  await send("PartnerVault", vault, "deposit", [DEPOSIT], harbour);
}

async function vaultMandate(vault: Address): Promise<VaultMandate> {
  const mandate = await read<unknown>("PartnerVault", vault, "mandate");
  const config = await read<unknown>("PartnerVault", vault, "platformConfig", [platform.address]);
  return {
    partner: cell<Address>(mandate, "partner", 0),
    signer: cell<Address>(mandate, "signer", 1),
    minFeeBps: Number(cell(mandate, "minFeeBps", 2)),
    maxTenorSeconds: Number(cell(mandate, "maxTenor", 3)),
    concentrationCapBps: Number(cell(mandate, "concentrationBps", 4)),
    expiresAt: Number(cell(mandate, "expiry", 5)),
    idle: await read<bigint>("PartnerVault", vault, "idle"),
    totalAssets: await read<bigint>("PartnerVault", vault, "totalAssets"),
    limit: BigInt(cell(config, "limit", 1)),
    paused: await read<boolean>("PartnerVault", vault, "paused"),
    payoutTo: await read<Address>("PartnerVault", vault, "payoutTo", [platform.address]),
  };
}

function cell<T>(value: unknown, name: string, index: number): T {
  if (Array.isArray(value)) return value[index] as T;
  return (value as Record<string, T>)[name];
}
