import type { Address } from "viem";
import { deploy, deployer, fail, investor, platform, read, reverts, send, usd } from "./chain.js";
import { engineQuote } from "./engine.js";

type Books = {
  cash: bigint;
  drawn: bigint;
  seniorPrincipal: bigint;
  juniorPrincipal: bigint;
  recovery: boolean;
};

export async function runStage3(now: number, stage1Line: Address) {
  const token = await deploy("MockUSDG", [deployer.address]);
  const book = await deploy("ReceivablesBook", []);
  const facility = await deploy("CreditFacility", [{
    governor: deployer.address,
    borrower: platform.address,
    asset: token,
    book,
    oracle: "0x0000000000000000000000000000000000000000",
    minPriceE8: 0,
    maxOracleAge: 0,
    advanceRateBps: 8_000,
    maxLateBps: 2_000,
    minJuniorBps: 1_000,
    seniorAprBps: 800,
    juniorAprBps: 1_500,
  }]);

  await send("CreditFacility", facility, "approveLender", [deployer.address, true], deployer);
  await send("MockUSDG", token, "mint", [deployer.address, usd(600_000n)], deployer);
  await send("MockUSDG", token, "approve", [facility, usd(600_000n)], deployer);
  await send("CreditFacility", facility, "deposit", [0, usd(500_000n)], deployer);
  await send("CreditFacility", facility, "deposit", [1, usd(100_000n)], deployer);

  await send("ReceivablesBook", book, "set", [0n, 0n], deployer);
  if (!(await reverts("CreditFacility", facility, "draw", [1n], platform))) {
    fail("covenant", "a draw against an empty borrowing base succeeded");
  }
  if (!(await reverts("CreditFacility", facility, "draw", [1n], deployer))) {
    fail("keys", "the governor drew the facility");
  }
  if (!(await reverts("CreditFacility", facility, "draw", [1n], investor))) {
    fail("keys", "a stranger drew the facility");
  }

  await send("ReceivablesBook", book, "set", [usd(1_000_000n), 0n], deployer);
  const room = await read<bigint>("CreditFacility", facility, "availableDraw");
  if (room !== usd(600_000n)) fail("base", `available draw was ${room}`);
  await send("CreditFacility", facility, "draw", [usd(200_000n)], platform);

  await send("ReceivablesBook", book, "set", [0n, 0n], deployer);
  await send("CreditFacility", facility, "poke", [], deployer);
  const mid = await read<Books>("CreditFacility", facility, "accounting");
  if (!mid.recovery || mid.juniorPrincipal !== 0n || mid.seniorPrincipal !== usd(500_000n) || mid.drawn !== usd(100_000n)) {
    fail("waterfall", "junior cash was not subordinated before senior principal");
  }
  if (!(await reverts("CreditFacility", facility, "redeem", [1, 1n], deployer))) {
    fail("waterfall", "junior redeemed while senior was still drawn");
  }

  await send("CreditFacility", facility, "recognizeLoss", [], deployer);
  const after = await read<Books>("CreditFacility", facility, "accounting");
  const cash = await read<bigint>("MockUSDG", token, "balanceOf", [facility]);
  if (after.seniorPrincipal !== usd(400_000n) || after.drawn !== 0n || after.juniorPrincipal !== 0n) {
    fail("waterfall", "loss did not stop at junior before writing down senior");
  }
  if (cash !== after.cash) fail("solvency", "facility token balance left the accounting cash");

  const engine = await engineQuote(now, usd(10_000n));
  const bookRead = await bookMatches(stage1Line);
  return {
    availableDraw: room.toString(),
    seniorAfterLoss: after.seniorPrincipal.toString(),
    juniorAfterLoss: after.juniorPrincipal.toString(),
    cash: cash.toString(),
    engineFeeBps: engine.feeBps,
    engineAvailable: engine.available,
    creditLineBookMatches: bookRead,
  };
}

async function bookMatches(line: Address): Promise<true> {
  const adapter = await deploy("CreditLineBook", [line]);
  const eligible = await read<bigint>("CreditLineBook", adapter, "eligibleOutstanding");
  const late = await read<bigint>("CreditLineBook", adapter, "lateOutstanding");
  const onLine = await read<bigint>("LockgateCreditLine", line, "eligibleOutstanding");
  const onLate = await read<bigint>("LockgateCreditLine", line, "lateOutstanding");
  const exposure = await read<bigint>("LockgateCreditLine", line, "totalExposure");
  if (eligible !== onLine || late !== onLate || eligible + late !== exposure) {
    fail("book", "CreditLineBook did not match the stage-1 line");
  }
  return true;
}
