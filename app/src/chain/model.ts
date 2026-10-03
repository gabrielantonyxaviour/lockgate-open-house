import type { Address, Hash } from 'viem';
import type { Facility, FacilityAction } from './facility-model';
export type { Facility, FacilityAccounting, FacilityAction } from './facility-model';
export type RequestStatus = 'Queued' | 'Advanced' | 'Paid' | 'Cancelled';
export interface RedemptionRequest { id: bigint; owner: Address; shares: bigint; navValue: bigint; requestedAt: bigint; status: RequestStatus; advanceId: bigint }
export interface Settlement { cashBalance: bigint; repayFirst: bigint; queuePayable: bigint; queueShortfall: bigint }
export interface Platform { address: Address; name: string; share: Address; issuer: Address; nav: bigint; cash: bigint; nextWindow: bigint; windowInterval: bigint; gated: boolean; queueLength: bigint; queuedValue: bigint; limit: bigint; exposure: bigint; reserve: bigint; holding: bigint; blocked: boolean; requests: RedemptionRequest[]; queue?: RedemptionRequest[]; registered?: boolean; reserveBps?: number; riskBps?: number; settlement: Settlement }
export interface Advance { id: bigint; source: Address; to: Address; principal: bigint; fee: bigint; drawnAt: bigint; dueAt: bigint; status: 'Active' | 'Repaid' | 'Late'; remaining: bigint; recovered: bigint; grace: bigint }
export interface CreditLine { owner: Address; capital: bigint; outstanding: bigint; totalExposure: bigint; earnedFees: bigint; lateOutstanding: bigint; utilizationBps: number; paused: boolean; maxUtilizationBps?: number; maxConcentrationBps?: number; grace?: bigint; advances: Advance[] }
export interface Mandate { partner: Address; signer: Address; minFeeBps: number; maxTenor: bigint; concentrationBps: number; expiry: bigint }
export interface PartnerVault { address: Address; name: string; owner: Address; idle: bigint; reserveCash: bigint; outstandingPrincipal: bigint; totalAssets: bigint; paused: boolean; mandate: Mandate; approvedPlatforms: Address[]; advanceCount: bigint; proposals: ProposalReference[]; advances?: PartnerAdvance[]; platformTerms?: VaultPlatformTerms[] }
export interface VaultPlatformTerms { platform: Address; approved: boolean; limit: bigint; reserveBps: number; checkGate: boolean; maxNavAge: bigint; exposure: bigint; reserve: bigint }
export interface PartnerAdvance { id: bigint; platform: Address; recipient: Address; navValue: bigint; fee: bigint; principal: bigint; principalRemaining: bigint; feeRemaining: bigint; owed: bigint; fundedAt: bigint; dueAt: bigint; requestId: bigint; exitRef: Hash; status: number; grace?: bigint }
export interface ProposalReference { nonce: bigint; digest: Hash; used: boolean }
export interface Snapshot { mode: 'live' | 'preview'; blockNumber: bigint; observedAt: number; account?: Address; usdgBalance: bigint; nativeBalance?: bigint; facility?: Facility; roles: { operator: boolean; issuerPlatforms: Address[]; partnerVaults: Address[] }; platforms: Platform[]; creditLine: CreditLine; vaults: PartnerVault[]; warnings: string[] }
export interface ExitQuote { navValue: bigint; fee: bigint; usdgOut: bigint; available: boolean; reason: string; blockNumber: bigint; quotedAt: number }
export type Action = FacilityAction
 | { kind: 'createPlatform'; platformKind: 1|2|3; name: string; interval: bigint; shareNav: string; issuer: Address; limit: string; reserveBps: number }
 | { kind: 'deposit' | 'depositCash' | 'requestRedeem'; platform: Address; amount: string }
 | { kind: 'exitNow'; platform: Address; amount: string; minUsdgOut: bigint; quotedAt: number }
 | { kind: 'exitEarly'; platform: Address; requestId: bigint; minUsdgOut: bigint; quotedAt: number }
 | { kind: 'cancel'; platform: Address; requestId: bigint }
 | { kind: 'processWindow'; platform: Address }
 | { kind: 'setNav'; platform: Address; amount: string }
 | { kind: 'setGated'; platform: Address; gated: boolean }
 | { kind: 'setAllowlist'; platform: Address; account: Address; allowed: boolean }
 | { kind: 'registerSource'; platform: Address; amount: string; reserveBps: number }
 | { kind: 'vaultSetPlatform'; vault: Address; platform: Address; approved: boolean; amount: string; reserveBps: number; checkGate: boolean; maxNavAge: bigint }
 | { kind: 'setSourceTerms'; platform: Address; amount: string; reserveBps: number; riskBps: number }
 | { kind: 'setCaps'; maxUtilizationBps: number; maxConcentrationBps: number }
 | { kind: 'setGrace'; seconds: bigint }
 | { kind: 'vaultSetPaused'; vault: Address; paused: boolean }
 | { kind: 'vaultSetMandate'; vault: Address; minFeeBps: number; maxTenor: bigint; concentrationBps: number; expiry: bigint }
 | { kind: 'depositCapital' | 'withdrawCapital'; amount: string }
 | { kind: 'pause' | 'unpause' }
 | { kind: 'postReserve'; platform: Address; amount: string }
 | { kind: 'markLate'; advanceId: bigint }
 | { kind: 'vaultPostReserve'; vault: Address; platform: Address; amount: string }
 | { kind: 'vaultRepay'; vault: Address; advanceId: bigint }
 | { kind: 'vaultMarkLate'; vault: Address; advanceId: bigint }
 | { kind: 'vaultDeposit' | 'vaultWithdraw'; vault: Address; amount: string };
export interface TransactionState { phase: 'checking' | 'approval' | 'confirming' | 'pending' | 'success' | 'error'; hash?: Hash; confirmationUnknown?: boolean; createdPlatform?: Address; message: string }
export type OnTransactionState = (state: TransactionState) => void;
