import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  artifact,
  deployer,
  deploy,
  fail,
  harbour,
  keppel,
  lockgate,
  platform,
  proposerKey,
  publicClient,
  read,
  reverts,
  RPC,
  send,
  usd,
} from "./chain.js";
import { enginePropose, type EngineProposal, type VaultMandate } from "./engine.js";

const NAV = usd(10_000n);
const DEPOSIT = usd(80_000n);

export async function runStage2(now: number) {
  process.env.LOCKGATE_PROPOSER_KEY = proposerKey;
  const token = await deploy("MockUSDG", [deployer.address]);
  const router = await deploy("PartnerRouter", []);
  const harbourVault = await vaultFor(token, harbour.address);
  const keppelVault = await vaultFor(token, keppel.address);

  await fund(token, harbourVault, harbour, router, now);
  await fund(token, keppelVault, keppel, router, now);
  const harbourIdle = await read<bigint>("PartnerVault", harbourVault, "idle");
  const keppelIdle = await read<bigint>("PartnerVault", keppelVault, "idle");

  const first = await propose(harbourVault, 1n);
  await send("PartnerVault", harbourVault, "execute", [first.message, first.signature, "0x"], harbour);
  const second = await propose(keppelVault, 1n);
  await send("PartnerVault", keppelVault, "submitProposal", [second.message, second.signature], lockgate);
  if (await read<bigint>("PartnerVault", keppelVault, "idle") !== keppelIdle) {
    fail("mandate", "filing the engine signature moved partner cash");
  }
  if (!(await reverts("PartnerVault", keppelVault, "approve", [second.message], lockgate))) {
    fail("keys", "lockgate approved a partner advance");
  }
  await send("PartnerVault", keppelVault, "approve", [second.message], keppel);

  const harbourAfter = await read<bigint>("PartnerVault", harbourVault, "idle");
  const keppelAfter = await read<bigint>("PartnerVault", keppelVault, "idle");
  if (harbourAfter !== harbourIdle - first.payout) fail("mandate", "harbour did not pay only the engine payout");
  if (keppelAfter !== keppelIdle - second.payout) fail("mandate", "keppel did not pay only the engine payout");
  if (await read<bigint>("MockUSDG", token, "balanceOf", [lockgate.address]) !== 0n) {
    fail("keys", "lockgate received partner USDG");
  }

  const replay = await reverts("PartnerVault", harbourVault, "execute", [first.message, first.signature, "0x"], harbour);
  if (!replay) fail("replay", "the same engine signature executed twice");
  const badSig = flip(first.signature as Hex);
  const rejected = await reverts("PartnerVault", harbourVault, "execute", [first.message, badSig, "0x"], harbour);
  if (!rejected) fail("sig", "a broken signature was accepted");
  const lockgateMoved = await reverts("PartnerVault", harbourVault, "withdraw", [usd(1n), lockgate.address], lockgate);
  if (!lockgateMoved) fail("keys", "lockgate withdrew partner funds");

  await send("MockUSDG", token, "mint", [platform.address, first.fee], deployer);
  await send("MockUSDG", token, "approve", [router, first.message.navValue], platform);
  await send("PartnerRouter", router, "relayRepay", [first.message.quoteId, 0n], platform);

  const harbourRepaid = await read<bigint>("PartnerVault", harbourVault, "idle");
  const keppelUntouched = await read<bigint>("PartnerVault", keppelVault, "idle");
  const routerBal = await read<bigint>("MockUSDG", token, "balanceOf", [router]);
  if (harbourRepaid !== harbourIdle + first.fee) fail("repay", "repayment did not return to the funding vault");
  if (keppelUntouched !== keppelAfter) fail("repay", "repayment landed in the other partner vault");
  if (routerBal !== 0n) fail("router", "router kept partner USDG");
  if (await read<bigint>("PartnerVault", harbourVault, "outstandingPrincipal") !== 0n) {
    fail("repay", "harbour advance stayed open");
  }

  return {
    source: "engine/src/cli.ts propose --rpc",
    engineSignatureAccepted: true,
    harbourFeeBps: first.feeBps,
    keppelFeeBps: second.feeBps,
    harbourRepaid: harbourRepaid.toString(),
    keppelOutstanding: (await read<bigint>("PartnerVault", keppelVault, "outstandingPrincipal")).toString(),
    routerBalance: routerBal.toString(),
    lockgateBalance: "0",
  };
}

async function vaultFor(token: Address, owner: Address): Promise<Address> {
  const impl = await deploy("PartnerVault", []);
  const data = encodeFunctionData({
    abi: artifact("PartnerVault"),
    functionName: "initialize",
    args: [owner, token, 86_400, 86_400],
  });
  return deploy("ERC1967Proxy", [impl, data]);
}

async function fund(token: Address, vault: Address, partner: typeof harbour, router: Address, now: number) {
  await send("MockUSDG", token, "mint", [partner.address, DEPOSIT], deployer);
  await send("PartnerVault", vault, "setProposer", [lockgate.address], partner);
  await send("PartnerVault", vault, "setMandate", [25, 30 * 86_400, 10_000, BigInt(now + 365 * 86_400)], partner);
  await send("PartnerVault", vault, "setPlatform", [platform.address, true, usd(100_000n), 0, false, 7 * 86_400], partner);
  await send("PartnerVault", vault, "setRouter", [router], partner);
  await send("MockUSDG", token, "approve", [vault, DEPOSIT], partner);
  await send("PartnerVault", vault, "deposit", [DEPOSIT], partner);
  await send("PartnerRouter", router, "register", [vault], partner);
}

async function propose(vault: Address, nonce: bigint): Promise<EngineProposal> {
  const block = await publicClient.getBlock();
  const built = await enginePropose({
    now: Number(block.timestamp),
    nav: NAV,
    vault,
    platform: platform.address,
    nonce,
    signEnv: "LOCKGATE_PROPOSER_KEY",
    rpc: RPC,
    mandate: await vaultMandate(vault),
  });
  if (!built.submittable || !built.signature) {
    fail("engine", `proposal blocked: ${built.blocks.map((item) => `${item.code}: ${item.reason}`).join("; ")}`);
  }
  if (built.feeBps < 25 || built.feeBps > 1500) fail("fee", `engine fee ${built.feeBps} is outside 25-1500`);
  return built;
}

async function vaultMandate(vault: Address): Promise<VaultMandate> {
  const mandate = await read<unknown>("PartnerVault", vault, "mandate");
  const config = await read<unknown>("PartnerVault", vault, "platformConfig", [platform.address]);
  const payoutTo = await read<Address>("PartnerVault", vault, "payoutTo", [platform.address]);
  const paused = await read<boolean>("PartnerVault", vault, "paused");
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
    paused,
    payoutTo,
  };
}

function cell<T>(value: unknown, name: string, index: number): T {
  if (Array.isArray(value)) return value[index] as T;
  return (value as Record<string, T>)[name];
}

function flip(signature: Hex): Hex {
  const byte = signature.slice(4, 6) === "00" ? "01" : "00";
  return `0x${byte}${signature.slice(4)}` as Hex;
}
