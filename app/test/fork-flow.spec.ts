import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { DEPLOYMENT } from "../src/chain/config";
import { creditLineAbi, platformAbi, tokenAbi } from "../src/chain/abi";

const FORK = "http://127.0.0.1:19547";
const PUBLIC = "https://sepolia-rollup.arbitrum.io/rpc";
const OWNER: Address = "0xc37f3cC9C57F647212894a262F27fA21A371a752";
const INVESTOR: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const factoryAbi = parseAbi([
  "function createPlatform(uint8 kind,string name,uint64 interval,uint256 nav,address issuer,uint256 limit,uint16 reserveBps) returns(address)",
  "event PlatformCreated(address indexed fund,address indexed issuer,uint8 kind,string name)",
]);

test("investor deposit, quoted exit and settlement use genuine local-fork receipts", async ({ page }) => {
  test.skip(process.env.LOCKGATE_FORK_TEST !== "1", "Opt in to isolated local fork verification.");
  test.setTimeout(180_000);
  page.on("pageerror", (error) => {
    throw new Error(`Fork browser runtime error: ${error.message}`);
  });
  expect(new URL(FORK).hostname).toBe("127.0.0.1");
  expect(
    await fetch(FORK, { signal: AbortSignal.timeout(1000) })
      .then(() => true)
      .catch(() => false),
  ).toBe(false);
  const anvil = spawn(
    "anvil",
    ["--fork-url", PUBLIC, "--host", "127.0.0.1", "--port", "19547", "--chain-id", "421614", "--silent"],
    { stdio: "ignore" },
  );
  let closing = false;
  const rpc = async (method: string, params: unknown[] = []) => {
    if (new URL(FORK).hostname !== "127.0.0.1") throw new Error("Fork writes must stay on loopback.");
    const response = await fetch(FORK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const data = await response.json();
    if (data.error) throw new Error(`${method}: ${data.error.message}`);
    return data.result;
  };
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(FORK) });
  const owner = createWalletClient({ account: OWNER, chain: arbitrumSepolia, transport: http(FORK) });
  try {
    await expect
      .poll(
        async () => {
          if (anvil.exitCode !== null) throw new Error("Owned fork process exited before startup.");
          return rpc("eth_chainId").catch(() => null);
        },
        { timeout: 30_000 },
      )
      .toBe("0x66eee");
    expect(await client.getCode({ address: DEPLOYMENT.creditLine })).not.toBe("0x");
    await rpc("anvil_impersonateAccount", [OWNER]);
    await rpc("anvil_setBalance", [OWNER, "0x56bc75e2d63100000"]);
    const confirmed = async (hash: Hash) => {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const trace = await rpc("debug_traceTransaction", [hash, {}]);
        throw new Error(
          `Local fork transaction reverted: gas=${receipt.gasUsed}; return=${trace.returnValue}; tail=${JSON.stringify(trace.structLogs?.slice(-3))}`,
        );
      }
      return receipt;
    };
    const balance = () =>
      client.readContract({ address: DEPLOYMENT.usdg, abi: tokenAbi, functionName: "balanceOf", args: [INVESTOR] });
    const ownerBalance = await client.readContract({
      address: DEPLOYMENT.usdg,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [OWNER],
    });
    if (ownerBalance < 3_000_000n)
      await confirmed(
        await owner.writeContract({
          gas: 3_000_000n,
          address: DEPLOYMENT.creditLine,
          abi: creditLineAbi,
          functionName: "withdrawCapital",
          args: [3_000_000n],
        }),
      );
    await confirmed(
      await owner.writeContract({
        gas: 3_000_000n,
        address: DEPLOYMENT.usdg,
        abi: parseAbi(["function transfer(address,uint256) returns(bool)"]),
        functionName: "transfer",
        args: [INVESTOR, 2_000_000n],
      }),
    );
    const created = await confirmed(
      await owner.writeContract({
        gas: 3_000_000n,
        address: DEPLOYMENT.factory,
        abi: factoryAbi,
        functionName: "createPlatform",
        args: [1, "Fork investor verification", 600n, 1_000_000n, INVESTOR, 100_000_000n, 750],
      }),
    );
    const event = created.logs.find((log) => log.address.toLowerCase() === DEPLOYMENT.factory.toLowerCase());
    expect(event).toBeDefined();
    const platform = decodeEventLog({ abi: factoryAbi, data: event!.data, topics: event!.topics }).args.fund;
    await confirmed(
      await owner.writeContract({
        gas: 3_000_000n,
        address: DEPLOYMENT.usdg,
        abi: tokenAbi,
        functionName: "approve",
        args: [DEPLOYMENT.creditLine, 1_000_000n],
      }),
    );
    await confirmed(
      await owner.writeContract({
        gas: 3_000_000n,
        address: DEPLOYMENT.creditLine,
        abi: creditLineAbi,
        functionName: "postReserve",
        args: [platform, 1_000_000n],
      }),
    );
    const before = await balance();
    const block = await client.getBlock();
    await page.clock.setFixedTime(Number(block.timestamp) * 1000);
    const sends: Hash[] = [];
    await page.route(PUBLIC, async (route) => {
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      for (const call of calls) expect(call.method).not.toMatch(/sendTransaction|sendRawTransaction/);
      try {
        await route.fulfill({ response: await route.fetch({ url: FORK }) });
      } catch (error) {
        if (!closing) throw error;
      }
    });
    await page.exposeFunction("localForkRpc", async (method: string, params: unknown[]) => {
      if (method === "eth_sendTransaction") {
        const transaction = params[0] as { from?: string; gas?: string };
        expect(transaction.from?.toLowerCase()).toBe(INVESTOR.toLowerCase());
        const hash = (await rpc(method, [{ ...transaction, gas: transaction.gas ?? "0x2dc6c0" }])) as Hash;
        sends.push(hash);
        return hash;
      }
      if (/sendRawTransaction|sign/.test(method)) throw new Error("Only unlocked local fork transactions are supported.");
      return rpc(method, params);
    });
    await page.addInitScript(
      ({ investor }) => {
        Object.assign(window, {
          ethereum: {
            request: ({ method, params = [] }: { method: string; params?: unknown[] }) => {
              if (method === "eth_requestAccounts" || method === "eth_accounts") return Promise.resolve([investor]);
              return (
                window as unknown as { localForkRpc: (method: string, params: unknown[]) => Promise<unknown> }
              ).localForkRpc(method, params);
            },
            on: () => {},
            removeListener: () => {},
          },
        });
      },
      { investor: INVESTOR },
    );
    await page.goto(`/#/platform/${platform}`);
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Fund a position amount" })).toBeVisible();
    const fund = page.locator(".funding-form").filter({ has: page.getByRole("textbox", { name: "Fund a position amount" }) });
    await fund.getByRole("textbox").fill("2");
    await fund.getByRole("button", { name: "Review", exact: true }).click();
    const confirm = async () => {
      await page.getByRole("dialog").getByRole("button", { name: "Confirm in wallet" }).click();
      await expect(page.getByRole("heading", { name: "Transaction confirmed", exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Done", exact: true }).click();
    };
    await confirm();
    const share = await client.readContract({ address: platform, abi: platformAbi, functionName: "share" });
    expect(await client.readContract({ address: share, abi: tokenAbi, functionName: "balanceOf", args: [INVESTOR] })).toBe(
      2n * 10n ** 18n,
    );
    expect(await balance()).toBe(before - 2_000_000n);
    await page.goto(`/#/exit/${platform}`);
    await page.getByRole("textbox", { name: "Shares to exit" }).fill("0.5");
    await expect(page.getByRole("button", { name: "Review early exit" })).toBeEnabled();
    const quote = await client.readContract({
      address: platform,
      abi: platformAbi,
      functionName: "quoteExit",
      args: [5n * 10n ** 17n],
    });
    expect(quote[3]).toBe(true);
    const beforeExit = await balance();
    const capitalBeforeExit = await client.readContract({
      address: DEPLOYMENT.creditLine,
      abi: creditLineAbi,
      functionName: "capital",
    });
    await page.getByRole("button", { name: "Review early exit" }).click();
    await confirm();
    const exitReceipt = await confirmed(sends.at(-1)!);
    const advanced = parseEventLogs({ abi: platformAbi, eventName: "ExitAdvanced", logs: exitReceipt.logs })[0];
    expect(advanced.args.usdgOut).toBeGreaterThanOrEqual(quote[2]);
    expect(await balance()).toBe(beforeExit + advanced.args.usdgOut);
    expect(await client.readContract({ address: share, abi: tokenAbi, functionName: "balanceOf", args: [INVESTOR] })).toBe(
      15n * 10n ** 17n,
    );
    expect(await client.readContract({ address: platform, abi: platformAbi, functionName: "lockgateOwed" })).toBe(500_000n);
    await rpc("evm_increaseTime", [601]);
    await rpc("evm_mine");
    const settledBlock = await client.getBlock();
    await page.clock.setFixedTime(Number(settledBlock.timestamp) * 1000);
    await page.goto(`/#/platform/${platform}`);
    await page.getByRole("button", { name: "Process window", exact: true }).click();
    await confirm();
    expect(await client.readContract({ address: platform, abi: platformAbi, functionName: "lockgateOwed" })).toBe(0n);
    const request = await client.readContract({ address: platform, abi: platformAbi, functionName: "getRequest", args: [1n] });
    expect(request.status).toBe(1); // Advanced is retained as history after its escrowed shares are burned.
    expect(request.shares).toBe(0n);
    const repaid = await client.readContract({
      address: DEPLOYMENT.creditLine,
      abi: creditLineAbi,
      functionName: "getAdvance",
      args: [request.advanceId],
    });
    expect(repaid.status).toBe(1);
    expect(
      await client.readContract({
        address: DEPLOYMENT.creditLine,
        abi: creditLineAbi,
        functionName: "remainingOf",
        args: [request.advanceId],
      }),
    ).toBe(0n);
    expect(await client.readContract({ address: DEPLOYMENT.creditLine, abi: creditLineAbi, functionName: "capital" })).toBe(
      capitalBeforeExit + advanced.args.fee,
    );
    expect(sends.length).toBeGreaterThanOrEqual(4);
    for (const hash of sends) await confirmed(hash);
    await page.getByRole("link", { name: "Activity", exact: true }).first().click();
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: `#${request.advanceId}`, exact: true }) });
    await expect(row.getByRole("cell", { name: "Repaid", exact: true })).toBeVisible();
  } finally {
    closing = true;
    await page.close();
    if (anvil.exitCode === null && anvil.signalCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill("SIGTERM");
      await exited;
    }
  }
});
