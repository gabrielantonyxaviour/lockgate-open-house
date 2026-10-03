import { Select } from "../ui/Select";
import { useState } from "react";
import { z } from "zod";
import type { Platform } from "../chain/model";
import { useApp } from "../ui/context";
import { Panel } from "../ui/primitives";
import { parseAmount } from "../chain/amounts";
import { errorMessage, checkedAddress } from "../chain/client";
export function IssuerControls({ platform, permitted }: { platform: Platform; permitted: boolean }) {
  const { review } = useApp();
  const [nav, setNav] = useState("");
  const [address, setAddress] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [error, setError] = useState("");
  return (
    <div className="stack control-stack">
      <label className="field">
        Update NAV · USDG per share
        <input inputMode="decimal" placeholder="1.000000" value={nav} onChange={(e) => setNav(e.target.value)} />
      </label>
      <button
        className="button secondary"
        disabled={!permitted}
        onClick={() => {
          try {
            parseAmount(nav);
            setError("");
            review(
              { kind: "setNav", platform: platform.address, amount: nav },
              "Update platform NAV",
              "Change the issuer NAV used to value new requests. This is a permissioned issuer action.",
            );
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Review NAV update
      </button>
      <button
        className="button secondary"
        disabled={!permitted}
        onClick={() =>
          review(
            { kind: "setGated", platform: platform.address, gated: !platform.gated },
            platform.gated ? "Remove platform gate" : "Gate platform",
            platform.gated
              ? "Allow requests subject to all other contract checks."
              : "Stop new redemption requests and early exits for this platform.",
          )
        }
      >
        {platform.gated ? "Remove gate" : "Gate new requests"}
      </button>
      <hr className="divider" />
      <label className="field">
        Wallet eligibility
        <input placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="field">
        Eligibility
        <Select
          label="Eligibility"
          value={String(allowed)}
          onValueChange={(value) => setAllowed(value === "true")}
          options={[
            { value: "true", label: "Allowed" },
            { value: "false", label: "Blocked" },
          ]}
        />
      </label>
      <button
        className="button secondary"
        disabled={!permitted}
        onClick={() => {
          try {
            const account = checkedAddress(address);
            setError("");
            review(
              { kind: "setAllowlist", platform: platform.address, account, allowed },
              "Update wallet eligibility",
              `${allowed ? "Allow" : "Block"} this wallet under the platform’s share-token rules. This does not constitute identity or legal verification.`,
            );
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Review eligibility change
      </button>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
export function OperatorControls({ permitted }: { permitted: boolean }) {
  const { snapshot, review } = useApp();
  const [util, setUtil] = useState(String(snapshot?.creditLine.maxUtilizationBps ?? 8000));
  const [conc, setConc] = useState(String(snapshot?.creditLine.maxConcentrationBps ?? 10000));
  const [grace, setGrace] = useState(String(snapshot?.creditLine.grace ?? 60));
  const [selected, setSelected] = useState(snapshot?.platforms[0]?.address || "");
  const [limit, setLimit] = useState("");
  const [reserve, setReserve] = useState("750");
  const [risk, setRisk] = useState("0");
  const [error, setError] = useState("");
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const bps = (v: string) => z.coerce.number().int().min(0).max(10000).parse(v);
  return (
    <div className="stack">
      <div className="grid-two">
        <Panel title="Risk caps">
          <div className="stack">
            <div className="fields">
              <label className="field">
                Utilization cap · bps
                <input type="number" min="0" max="10000" value={util} onChange={(e) => setUtil(e.target.value)} />
              </label>
              <label className="field">
                Concentration cap · bps
                <input type="number" min="0" max="10000" value={conc} onChange={(e) => setConc(e.target.value)} />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={!permitted}
              onClick={() =>
                attempt(() =>
                  review(
                    { kind: "setCaps", maxUtilizationBps: bps(util), maxConcentrationBps: bps(conc) },
                    "Update risk caps",
                    `Utilization ${util} bps; concentration ${conc} bps. These caps limit future funding, not existing exposure.`,
                  ),
                )
              }
            >
              Review cap changes
            </button>
            <label className="field">
              Grace for new advances · seconds
              <input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </label>
            <button
              className="button secondary"
              disabled={!permitted}
              onClick={() =>
                attempt(() => {
                  const seconds = BigInt(
                    z
                      .string()
                      .regex(/^\d{1,10}$/)
                      .parse(grace),
                  );
                  review(
                    { kind: "setGrace", seconds },
                    "Update repayment grace",
                    `${grace} seconds for new advances. Existing advances retain their captured grace.`,
                  );
                })
              }
            >
              Review grace update
            </button>
          </div>
        </Panel>
        <Panel title="Platform credit terms">
          <div className="stack">
            <label className="field">
              Platform
              <Select
                label="Platform"
                value={selected}
                onValueChange={setSelected}
                options={snapshot?.platforms.map((p) => ({ value: p.address, label: p.name })) ?? []}
              />
            </label>
            <label className="field">
              New limit · USDG
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="1000.00" />
            </label>
            <div className="fields">
              <label className="field">
                Reserve requirement · bps
                <input type="number" value={reserve} onChange={(e) => setReserve(e.target.value)} />
              </label>
              <label className="field">
                Risk premium · bps
                <input type="number" value={risk} onChange={(e) => setRisk(e.target.value)} />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={!permitted || !selected}
              onClick={() =>
                attempt(() => {
                  parseAmount(limit);
                  review(
                    {
                      kind: "setSourceTerms",
                      platform: checkedAddress(selected),
                      amount: limit,
                      reserveBps: bps(reserve),
                      riskBps: bps(risk),
                    },
                    "Update platform terms",
                    `Limit ${limit} USDG, reserve requirement ${reserve} bps, risk premium ${risk} bps.`,
                  );
                })
              }
            >
              Review platform terms
            </button>
          </div>
        </Panel>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
