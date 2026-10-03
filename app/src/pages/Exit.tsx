import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import { formatUnits } from "viem";
import { useApp } from "../ui/context";
import { parseAmount } from "../chain/amounts";
import { quoteExit, quoteRequest, errorMessage } from "../chain/client";
import type { ExitQuote } from "../chain/model";
import { PageHead, Panel, Badge, money, date, Empty } from "../ui/primitives";
export default function Exit({ address, params }: { address: string; params: URLSearchParams }) {
  const { snapshot, account, connect, review, preview, loading, error: readError, refresh } = useApp();
  const platform = snapshot?.platforms.find((p) => p.address.toLowerCase() === address.toLowerCase());
  const requestId = params.get("request");
  const request = platform?.requests.find((r) => String(r.id) === requestId);
  const queued = params.get("mode") === "queue";
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ExitQuote | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let current = true;
    setQuote(null);
    setError("");
    if (!platform || queued) return;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const shares = request ? request.shares : parseAmount(amount, 18);
        if (!request && shares > platform.holding) throw new Error("Amount exceeds your available shares.");
        if (preview) {
          const navValue = (shares * platform.nav) / 10n ** 18n;
          const fee = navValue / 100n;
          if (current)
            setQuote({
              navValue,
              fee,
              usdgOut: navValue - fee,
              available: true,
              reason: "Illustrative preview",
              blockNumber: 0n,
              quotedAt: Date.now(),
            });
        } else {
          const result = request ? await quoteRequest(platform.address, request.id) : await quoteExit(platform.address, shares);
          if (current) setQuote(result);
        }
      } catch (e) {
        if (current && amount) setError(errorMessage(e));
      } finally {
        if (current) setBusy(false);
      }
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [amount, request, platform?.address, preview, queued, version]);
  if ((!platform || (requestId && !request)) && loading)
    return <div className="loading-state" role="status"><h1>{platform ? "Reading request…" : "Reading platform…"}</h1><p>Fetching the latest redemption data.</p></div>;
  if (!platform)
    return <Empty title="Platform unavailable"
      action={<button className="button secondary" onClick={() => void refresh()}>Refresh platform</button>}>
      {readError ? "The latest platform record could not be read. Try refreshing. " : "This address is not in the registered platform snapshot. "}
      <a className="inline-link" href="#/platforms">Return to platforms</a>
    </Empty>;
  if (requestId && !request)
    return (
      <Empty title="Request unavailable"
        action={<button className="button secondary" onClick={() => void refresh()}>Refresh request</button>}>
        {readError ? "The latest request could not be read. Try refreshing." : "This request does not belong to the connected wallet or is not in the loaded history."}
      </Empty>
    );
  const fresh = quote && now - quote.quotedAt <= 60_000;
  let shares = 0n;
  try {
    shares = request?.shares ?? parseAmount(amount, 18);
  } catch {
    /* Input validation is shown before submission. */
  }
  const valid = shares > 0n && (request || shares <= platform.holding);
  const waiting = quote?.navValue ?? (shares * platform.nav) / 10n ** 18n;
  const submit = () => {
    if (!account) {
      void connect();
      return;
    }
    if (preview) return;
    if (queued) {
      try {
        if (!valid) throw new Error("Enter a positive share amount within your balance.");
        review(
          { kind: "requestRedeem", platform: platform.address, amount },
          "Request redemption",
          "The platform escrows your selected shares and adds a redemption request. Settlement depends on available platform cash.",
        );
      } catch (e) {
        setError(errorMessage(e));
      }
    } else if (quote && fresh && quote.available) {
      review(
        request
          ? {
              kind: "exitEarly",
              platform: platform.address,
              requestId: request.id,
              minUsdgOut: quote.usdgOut,
              quotedAt: quote.quotedAt,
            }
          : { kind: "exitNow", platform: platform.address, amount, minUsdgOut: quote.usdgOut, quotedAt: quote.quotedAt },
        "Review your early exit",
        `You receive at least ${money(quote.usdgOut)} USDG after a ${money(quote.fee)} USDG fee. The platform borrows from Lockgate and owes ${money(quote.navValue)} USDG at settlement. The contract rejects a payout below this minimum.`,
      );
    }
  };
  return (
    <div className="stack">
      <PageHead
        eyebrow={`INVESTOR / ${queued ? "REDEMPTION REQUEST" : "EARLY EXIT"}`}
        title={queued ? "Keep your place in the queue." : "Your capital. Your timing."}
        description={
          queued
            ? "Submit a redemption request to the platform’s settlement queue."
            : "Compare waiting for platform settlement with receiving USDG today."
        }
      />
      <div className="exit-layout">
        <Panel title={request ? `Queued request #${request.id}` : platform.name} eyebrow="01 / CHOOSE YOUR AMOUNT">
          <div className="stack">
            {request ? (
              <div className="notice">
                {formatUnits(request.shares, 18)} shares already in escrow. This action exits the existing request.
              </div>
            ) : (
              <>
                <label className="field">
                  Shares to {queued ? "redeem" : "exit"}
                  <div className="amount-input">
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label="Shares to exit"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <span>shares</span>
                  </div>
                  <small>Available: {formatUnits(platform.holding, 18)} shares</small>
                </label>
                <button className="button text" onClick={() => setAmount(formatUnits(platform.holding, 18))}>
                  Use available balance
                </button>
              </>
            )}
            <dl className="key-values">
              <div>
                <dt>NAV per share</dt>
                <dd>{money(platform.nav)} USDG</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{platform.name}</dd>
              </div>
              <div>
                <dt>Next settlement</dt>
                <dd>{date(platform.nextWindow)}</dd>
              </div>
            </dl>
            {(platform.gated || platform.blocked) && (
              <div className="notice warn">
                {platform.gated ? "This platform is gated." : "Your wallet is blocked by this platform."}
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {quote && !quote.available && (
              <div className="notice warn" role="status">
                Exit unavailable: {quote.reason}.{" "}
                {quote.reason === "window due" && (
                  <a className="inline-link" href={`#/platform/${platform.address}`}>
                    Inspect and process the settlement window.
                  </a>
                )}
              </div>
            )}
            {preview && <div className="notice warn">Illustrative quote only. Return to chain data to transact.</div>}
          </div>
        </Panel>
        <div className="stack">
          <Panel className="quote-panel" eyebrow="02 / COMPARE YOUR OPTIONS">
            <div className="quote-option">
              <span>Wait for settlement</span>
              <strong>
                {money(waiting)} <small>USDG</small>
              </strong>
              <p>Queued NAV value. Actual payout depends on platform cash and settlement.</p>
              <Badge>{date(platform.nextWindow)}</Badge>
            </div>
            {!queued && (
              <div className="quote-option chosen">
                <div className="row between">
                  <span>Exit today</span>
                  <Badge tone={quote?.available ? "good" : "muted"}>
                    {busy
                      ? "Reading quote…"
                      : preview
                        ? "Illustrative"
                        : quote?.available
                          ? "Live contract quote"
                          : "Quote required"}
                  </Badge>
                </div>
                <strong>
                  {quote?.available ? money(quote.usdgOut) : "—"} <small>USDG</small>
                </strong>
                <p>Receive funds now. The platform repays Lockgate at settlement.</p>
                <dl className="key-values">
                  <div>
                    <dt>Exit fee</dt>
                    <dd>{quote ? `${money(quote.fee)} USDG` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Minimum received</dt>
                    <dd>{quote?.available ? `${money(quote.usdgOut)} USDG` : "—"}</dd>
                  </div>
                </dl>
              </div>
            )}
            <button
              className="button quote-cta"
              disabled={
                preview || busy || platform.gated || platform.blocked || !valid || (!queued && (!quote?.available || !fresh))
              }
              onClick={submit}
            >
              {preview ? "Preview only" : account ? (queued ? "Review redemption" : "Review early exit") : "Connect to continue"}{" "}
              <ArrowRight size={14} />
            </button>
            {!account && !preview && (
              <button className="button secondary quote-cta" onClick={connect}>
                Connect wallet
              </button>
            )}
            {!queued && (
              <div className="row between quote-foot">
                <span>
                  {quote
                    ? fresh
                      ? `Quote valid for ${Math.max(0, 60 - Math.floor((now - quote.quotedAt) / 1000))}s`
                      : "Quote expired"
                    : "Quote refreshes when amount changes"}
                </span>
                <button aria-label="Refresh exit quote" onClick={() => setVersion((v) => v + 1)}>
                  <RefreshCw size={12} />
                </button>
              </div>
            )}
          </Panel>
          <div className="quote-assurance">
            <ShieldCheck size={16} />
            <p>The review shows the exact minimum payout. A changed quote below that amount causes the transaction to revert.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
