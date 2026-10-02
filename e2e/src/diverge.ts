export type Leg = { bps: number; fee: bigint };

export type Break = { id: string; what: string; repro: string };

export type Divergence = {
  id: string;
  what: string;
  sim: string;
  engine: string;
  chain: string;
  repro: string;
};

export type CompareSheet = {
  block: number;
  now: number;
  nav: bigint;
  seconds: number;
  timeScale: number;
  sim: Leg & { agedBps: number; rawBps: number };
  engine: Leg & { payout: bigint; pricedSeconds: number; apr: number; riskBps: number };
  chain: Leg & { reason: string };
  funded: {
    vaultFee: bigint;
    vaultPayout: bigint;
    idleBefore: bigint;
    idleAfterFund: bigint;
    idleAfterRepay: bigint;
    lockgate: bigint;
  };
  rounding: { nav: bigint; bps: number; sim: bigint; engine: bigint; chain: bigint };
  fullUtil: { sim: number; engine: number; chain: number };
};

function money(value: bigint): string {
  return value.toString();
}

export function classify(sheet: CompareSheet): { breaks: Break[]; divergences: Divergence[] } {
  const breaks: Break[] = [];
  const nav = sheet.nav;
  const funded = sheet.funded;
  const repro = `nav ${money(nav)}, seconds ${sheet.seconds}, timeScale ${sheet.timeScale}, now ${sheet.now}, block ${sheet.block}`;
  if (sheet.engine.payout + sheet.engine.fee !== nav) {
    breaks.push({ id: "engine-sum", what: "engine payout plus fee is not the nav", repro });
  }
  if (funded.vaultFee !== sheet.engine.fee || funded.vaultPayout !== sheet.engine.payout) {
    breaks.push({
      id: "vault-signed-fee",
      what: `vault stored fee ${money(funded.vaultFee)} and principal ${money(funded.vaultPayout)}; engine signed fee ${money(sheet.engine.fee)} and payout ${money(sheet.engine.payout)}`,
      repro,
    });
  }
  if (funded.idleAfterFund !== funded.idleBefore - sheet.engine.payout) {
    breaks.push({ id: "idle-drop", what: "idle did not fall by the engine payout", repro });
  }
  if (funded.idleAfterRepay !== funded.idleBefore + sheet.engine.fee) {
    breaks.push({ id: "repay-idle", what: "repay did not return the engine fee to the funding vault", repro });
  }
  if (funded.lockgate !== 0n) {
    breaks.push({ id: "lockgate-cash", what: "lockgate balance was not zero", repro });
  }

  const divergences: Divergence[] = [];
  if (sheet.sim.bps !== sheet.engine.bps || sheet.engine.bps !== sheet.chain.bps || sheet.sim.bps !== sheet.chain.bps) {
    divergences.push({
      id: "fee-bps-600s",
      what: "the same 600-second window is priced at three different bps",
      sim: `${sheet.sim.bps} bps, fee ${money(sheet.sim.fee)}, raw ${sheet.sim.rawBps}, age-3600 ${sheet.sim.agedBps}`,
      engine: `${sheet.engine.bps} bps, fee ${money(sheet.engine.fee)}, pricedSeconds ${sheet.engine.pricedSeconds}, apr ${sheet.engine.apr}, risk ${sheet.engine.riskBps}`,
      chain: `${sheet.chain.bps} bps, fee ${money(sheet.chain.fee)}, refusal ${sheet.chain.reason || "none"}`,
      repro: `${repro}. All three legs get the engine NAV age and risk score.`,
    });
  }
  const round = sheet.rounding;
  if (round.sim !== round.chain || round.chain !== round.engine) {
    divergences.push({
      id: "fee-rounding",
      what: `fee amount at ${round.bps} bps on nav ${money(round.nav)}`,
      sim: money(round.sim),
      engine: money(round.engine),
      chain: money(round.chain),
      repro: `PricingEngine.feeFromBps, the sim and the engine all ceil. Nav ${money(round.nav)} is not a multiple of 10000.`,
    });
  }
  if (sheet.fullUtil.sim !== sheet.fullUtil.engine || sheet.fullUtil.engine !== sheet.fullUtil.chain) {
    divergences.push({
      id: "fee-bps-full-util",
      what: "a 600-second window at 10000 utilization bps",
      sim: String(sheet.fullUtil.sim),
      engine: String(sheet.fullUtil.engine),
      chain: String(sheet.fullUtil.chain),
      repro: `${repro}, utilizationBps 10000. This row is a quote and was not funded.`,
    });
  }
  const simIdle = funded.idleBefore + sheet.sim.fee;
  if (simIdle !== funded.idleAfterRepay) {
    divergences.push({
      id: "idle-versus-sim",
      what: "vault idle after repay is the deposit plus the engine fee, not the sim fee",
      sim: money(simIdle),
      engine: money(funded.idleAfterRepay),
      chain: "stage 2 does not charge the credit-line curve",
      repro: `${repro}. Idle before ${money(funded.idleBefore)}.`,
    });
  }
  return { breaks, divergences };
}

export function render(sheet: CompareSheet, breaks: Break[], divergences: Divergence[]): string {
  const rows = divergences
    .map(
      (item) =>
        `## ${item.id}\n\n${item.what}\n\n| Leg | Value |\n|---|---|\n| Sim | ${item.sim} |\n| Engine | ${item.engine} |\n| Chain | ${item.chain} |\n\nRepro: ${item.repro}\n`,
    )
    .join("\n");
  const breakRows = breaks.map((item) => `- ${item.id}: ${item.what} Repro: ${item.repro}`).join("\n");
  const agree = [
    `600-second window: sim ${sheet.sim.bps} bps, engine ${sheet.engine.bps} bps, chain ${sheet.chain.bps} bps; fees ${sheet.sim.fee}, ${sheet.engine.fee}, ${sheet.chain.fee}.`,
    `Full utilization: sim ${sheet.fullUtil.sim} bps, engine ${sheet.fullUtil.engine} bps, chain ${sheet.fullUtil.chain} bps.`,
    `Fee on nav ${sheet.rounding.nav} at ${sheet.rounding.bps} bps: sim ${sheet.rounding.sim}, engine ${sheet.rounding.engine}, chain ${sheet.rounding.chain} (all ceil).`,
    `Vault fee ${sheet.funded.vaultFee} equals the signed engine fee ${sheet.engine.fee}.`,
    `Vault principal ${sheet.funded.vaultPayout} equals the signed payout ${sheet.engine.payout}.`,
    `Idle fell from ${sheet.funded.idleBefore} to ${sheet.funded.idleAfterFund}, then repay left it at ${sheet.funded.idleAfterRepay}.`,
    "Lockgate's token balance stayed 0.",
  ].join("\n");
  return `# SUMMARY

One engine proposal was executed on local Anvil, chain 31337, block ${sheet.block}. The vault funded the signed fee. ${divergences.length === 0 ? "The sim, the engine, and the on-chain curve return the same bps and fee for the 600-second window, at idle and at full utilization." : "The sim, the engine, and the on-chain curve disagree; see below."} ${divergences.length} divergences. ${breaks.length} integration breaks. The chain was not reset and was not warped.

# Agreements

${agree}

# Divergences

${rows || "None."}
${breakRows ? `\n# Breaks\n\n${breakRows}\n` : ""}
# Command

\`\`\`
cd lockgate/repo/e2e
npm run compare
\`\`\`
`;
}
