import { Select } from "./Select";
import { useState } from "react";
import { z } from "zod";
import type { PartnerVault } from "../chain/model";
import { useApp } from "./context";
import { Panel } from "./primitives";
import { errorMessage, checkedAddress } from "../chain/client";
import { parseAmount } from "../chain/amounts";
export function VaultControls({ vault, permitted }: { vault: PartnerVault; permitted: boolean }) {
  const { review } = useApp();
  const [fee, setFee] = useState(String(vault.mandate.minFeeBps));
  const [tenor, setTenor] = useState(String(vault.mandate.maxTenor));
  const [conc, setConc] = useState(String(vault.mandate.concentrationBps));
  const [expiry, setExpiry] = useState(String(vault.mandate.expiry));
  const [platform, setPlatform] = useState(vault.approvedPlatforms[0] || "");
  const [limit, setLimit] = useState("");
  const [reserve, setReserve] = useState("750");
  const [age, setAge] = useState("86400");
  const [approved, setApproved] = useState(true);
  const [error, setError] = useState("");
  const run = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const bps = (s: string) => z.coerce.number().int().min(0).max(10000).parse(s);
  const seconds = (s: string) =>
    BigInt(
      z
        .string()
        .regex(/^\d{1,12}$/)
        .parse(s),
    );
  return (
    <Panel title="Partner controls">
      <div className="grid-two grid-equal">
        <div className="stack">
          <div className="fields">
            <label className="field">
              Fee floor · bps
              <input value={fee} onChange={(e) => setFee(e.target.value)} />
            </label>
            <label className="field">
              Maximum tenor · seconds
              <input value={tenor} onChange={(e) => setTenor(e.target.value)} />
            </label>
            <label className="field">
              Concentration cap · bps
              <input value={conc} onChange={(e) => setConc(e.target.value)} />
            </label>
            <label className="field">
              Expiry · Unix seconds
              <input value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
          </div>
          <button
            disabled={!permitted}
            className="button secondary"
            onClick={() =>
              run(() =>
                review(
                  {
                    kind: "vaultSetMandate",
                    vault: vault.address,
                    minFeeBps: bps(fee),
                    maxTenor: seconds(tenor),
                    concentrationBps: bps(conc),
                    expiry: seconds(expiry),
                  },
                  "Update partner mandate",
                  `Fee floor ${fee} bps, maximum tenor ${tenor}s, concentration ${conc} bps, expiry ${expiry}. These terms constrain new proposals.`,
                ),
              )
            }
          >
            Review mandate
          </button>
          <button
            disabled={!permitted}
            className="button secondary"
            onClick={() =>
              review(
                { kind: "vaultSetPaused", vault: vault.address, paused: !vault.paused },
                vault.paused ? "Unpause vault" : "Pause vault",
                "Update the partner vault funding gate. Existing advances remain owed.",
              )
            }
          >
            {vault.paused ? "Unpause vault" : "Pause vault"}
          </button>
        </div>
        <div className="stack">
          <label className="field">
            Platform address
            <input value={platform} placeholder="0x…" onChange={(e) => setPlatform(e.target.value as typeof platform)} />
          </label>
          <div className="fields">
            <label className="field">
              Limit · USDG
              <input value={limit} placeholder="1000.00" onChange={(e) => setLimit(e.target.value)} />
            </label>
            <label className="field">
              Reserve requirement · bps
              <input value={reserve} onChange={(e) => setReserve(e.target.value)} />
            </label>
          </div>
          <label className="field">
            Maximum NAV age · seconds
            <input value={age} onChange={(e) => setAge(e.target.value)} />
          </label>
          <label className="field">
            Platform permission
            <Select
              label="Platform permission"
              value={String(approved)}
              onValueChange={(value) => setApproved(value === "true")}
              options={[
                { value: "true", label: "Approved" },
                { value: "false", label: "Not approved" },
              ]}
            />
          </label>
          <button
            disabled={!permitted}
            className="button secondary"
            onClick={() =>
              run(() => {
                parseAmount(limit);
                review(
                  {
                    kind: "vaultSetPlatform",
                    vault: vault.address,
                    platform: checkedAddress(platform),
                    approved,
                    amount: limit,
                    reserveBps: bps(reserve),
                    checkGate: true,
                    maxNavAge: seconds(age),
                  },
                  "Update partner platform limits",
                  `Platform ${platform}; ${approved ? "approved" : "not approved"}; limit ${limit} USDG; reserve ${reserve} bps. NAV freshness and platform gating checks remain enabled.`,
                );
              })
            }
          >
            Review platform config
          </button>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </Panel>
  );
}
