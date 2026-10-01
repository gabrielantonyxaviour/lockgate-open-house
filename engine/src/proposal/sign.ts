import { hashTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EngineError } from "../errors.js";
import { partnerTypes } from "./partner.js";
import type { PartnerFiling } from "./partner.js";
import { advanceTypes, type AdvanceMessage } from "./typed.js";
import type { BuiltProposal } from "./build.js";

export async function signBuiltProposal(built: BuiltProposal, privateKey: Hex): Promise<Hex> {
  if (!built.submittable) throw new EngineError("refused", "refusing to sign a proposal that fails its checks");
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: built.domain,
    types: advanceTypes,
    primaryType: "AdvanceProposal",
    message: built.message,
  });
}

export async function signPartnerFiling(filing: PartnerFiling, submittable: boolean, privateKey: Hex): Promise<Hex> {
  if (!submittable) throw new EngineError("refused", "refusing to sign a proposal that fails its checks");
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: filing.domain,
    types: partnerTypes,
    primaryType: "AdvanceProposal",
    message: filing.message,
  });
}

export function digestOf(built: BuiltProposal): Hex {
  return hashTypedData({
    domain: built.domain,
    types: advanceTypes,
    primaryType: "AdvanceProposal",
    message: built.message satisfies AdvanceMessage,
  });
}
