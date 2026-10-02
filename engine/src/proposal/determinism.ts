import { canonicalJson } from "../audit/canonical.js";
import { EngineError } from "../errors.js";
import { buildProposal, type BuiltProposal } from "./build.js";

const EPOCH = 1_700_000_000;
const MAX_SEED = 2_147_483_647;

/** The same seed is always the same wall-clock second. */
export function wallFromSeed(seed: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new EngineError("param", "proposal seed must be an integer from 0 to 2147483647");
  }
  return EPOCH + seed;
}

/** Canonical bytes of the signed proposal and the decision to sign it. */
export function proposalFingerprint(built: BuiltProposal): string {
  return canonicalJson({
    digest: built.digest,
    calldata: built.calldata,
    submittable: built.submittable,
    blocks: built.blocks,
    message: built.message,
    partnerDigest: built.partner.digest,
    partnerCalldata: built.partner.submitCalldata,
    feeBps: built.quote.feeBps,
    dueAt: built.quote.dueAt,
  });
}

type ProposalArgs = Parameters<typeof buildProposal>[0];

/** Build twice from one seed. Throw if the fingerprints differ. */
export function guardProposal(args: ProposalArgs & { seed: number }): BuiltProposal {
  const { seed, ...rest } = args;
  const wall = wallFromSeed(seed);
  const first = buildProposal({ ...rest, wall });
  const second = buildProposal({ ...rest, wall });
  if (proposalFingerprint(first) !== proposalFingerprint(second)) {
    throw new EngineError("invariant", "proposal changed for the same inputs and seed");
  }
  return first;
}
