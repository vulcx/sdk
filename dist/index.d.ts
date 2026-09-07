type SwapMode = "ExactIn" | "ExactOut";
type PriceImpactSeverity = "none" | "low" | "moderate" | "high" | "extreme";
interface SDKConfig {
    /**
     * Optional. Sent as `Authorization: Bearer <apiKey>` when provided.
     *
     * Without one, requests are served anonymously under a small per-IP rate
     * limit; a key raises you to the published per-key budget. The
     * `/api/v1/stream` WebSocket always requires a key.
     */
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    retries?: number;
}
interface QuoteRequest {
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
}
interface RouteInfo {
    poolAddress: string;
    poolType: string;
    percent: number;
    inputMint: string;
    outputMint: string;
}
interface QuoteResponse {
    inputMint: string;
    outputMint: string;
    amountIn: string;
    amountOut: string;
    priceImpactBps: number;
    priceImpactPercent: string;
    priceImpactSeverity: PriceImpactSeverity;
    priceImpactWarning: string;
    feeBps: number;
    routes: RouteInfo[];
    routePath: string[];
    hopCount: number;
    otherAmountThreshold: string;
    /**
     * Firm-quote commitment ID. Pass it as `quoteId` to swap() or
     * instructions() within `validForMs` to have this exact route replayed at
     * this price (min-out anchors to this quote, not a fresh one). Absent when
     * the quote can't be pinned (e.g. split routes).
     */
    quoteId?: string;
    /** How long `quoteId` stays redeemable, in milliseconds. */
    validForMs?: number;
    /**
     * How long `quoteId` stays redeemable with `firm: true`, in milliseconds.
     * Firm redemption collapses slippage to the server's firm margin around
     * this exact price — price-or-fail.
     */
    firmForMs?: number;
    /**
     * Base58 Ed25519 signature over the canonical `vulcx-quote-v1` message —
     * present when the server signs its quotes. Verification key at
     * GET /.well-known/vulcx-quote-signer. Lets third parties prove what price
     * was quoted, independent of trusting this SDK or the transport.
     */
    quoteSignature?: string;
    /** Absolute expiry (unix ms) embedded in the signed message. */
    quoteExpiresAtMs?: number;
    /**
     * The chain slot the pool state behind this quote was current to.
     */
    contextSlot?: number;
    /**
     * How long ago, in milliseconds, any market-data update last reached the
     * engine.
     *
     * Check it. Pool state is held in memory and the feed does not backfill
     * after a reconnect, so a dropped feed leaves the engine pricing off frozen
     * reserves — and its internal staleness penalty scales with price impact,
     * which means a low-impact trade is penalised by exactly zero and the
     * response is otherwise identical to a fresh one. This field is the
     * difference. Treat a value materially above a second or two as a reason to
     * distrust the price, not merely to log it.
     */
    dataAgeMs?: number;
}
interface SwapRequest {
    userWallet: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
    skipSimulation?: boolean;
    /**
     * Optional firm-quote ID from quote(). Pair, amount, and swapMode must
     * match the original quote. Throws QuoteExpiredError (410) past its TTL and
     * QuoteStaleError (409) if the quoted route vanished — re-quote and retry.
     */
    quoteId?: string;
    /**
     * Firm (Tier 2) redemption — requires quoteId, and only within the quote's
     * firmForMs window. Slippage collapses to the server's firm margin around
     * the quoted price (slippageBps is ignored); if the route drifted past that
     * margin the request throws QuoteStaleError instead of executing at a worse
     * price. Best paired with session-key signing — the window is sub-second.
     */
    firm?: boolean;
    /**
     * Optional referrer wallet (base58) — the wallet that collects
     * `integratorFeeBps`, paid on-chain in the output token.
     *
     * On its own it earns NOTHING. There is no automatic referral share: the
     * fee is whatever you set in `integratorFeeBps`, and a referrer without one
     * is simply a wallet nobody pays.
     */
    referrer?: string;
    /**
     * Your own fee, in basis points of the output, which you keep IN FULL.
     *
     * It is not a share of Vulcx's fee — the two are independent and ADD, and
     * the user pays their sum. That sum may not exceed 100 bps.
     *
     * Requires `referrer`: a fee with nobody to pay it to is rejected rather
     * than quietly redirected to Vulcx.
     */
    integratorFeeBps?: number;
}
interface SimulationResult {
    success: boolean;
    computeUnitsConsumed: number;
    logs: string[];
    slippageExceeded: boolean;
    insufficientFunds: boolean;
    /** Absent on a successful simulation (the server omits it when empty). */
    error?: string;
    /** Absent when the server did not compute it. */
    computeUnitsTotal?: number;
    /** Present only when the simulation failed for missing accounts. */
    accountsNeeded?: string[];
}
interface SwapResponse {
    transaction: string;
    lastValidBlockHeight: number;
    amountIn: string;
    amountOut: string;
    minAmountOut?: string;
    maxAmountIn?: string;
    /**
     * The DEX pool trading fee across every hop — the LP fee the pools take,
     * NOT Vulcx's. Vulcx's own cut is platformFeeAmount.
     */
    feeAmount: string;
    /** Vulcx's fee rate in bps: the global protocol rate, or your negotiated override. */
    platformFeeBps: number;
    /** platformFeeBps applied to amountOut, in output token units. */
    platformFeeAmount: string;
    /**
     * Your fee rate in bps — yours in full, not a share of platformFeeBps.
     * Echoes what you requested, so you can reconcile against what was charged.
     */
    integratorFeeBps: number;
    /** integratorFeeBps applied to amountOut, paid on-chain to `referrer`. */
    integratorFeeAmount: string;
    simulation?: SimulationResult;
    computeUnitsEstimate: number;
    route: string[];
    hopCount: number;
    pools: string[];
    isSplitRoute: boolean;
    splitPercents?: number[];
}
interface InstructionsRequest {
    userWallet: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
    /** Optional firm-quote ID from quote() — see SwapRequest.quoteId. */
    quoteId?: string;
    /** Firm (Tier 2) redemption — see SwapRequest.firm. */
    firm?: boolean;
    /** Optional referrer wallet (base58) — see SwapRequest.referrer. */
    referrer?: string;
    /** Your own fee in bps, kept in full — see SwapRequest.integratorFeeBps. */
    integratorFeeBps?: number;
    /**
     * Optional Fogo session account (base58). When set, the response contains a
     * single session-shaped route instruction: the session account is the
     * signing authority (userWallet's ATAs still hold the funds) and no
     * ATA-create or SOL-wrap instructions are emitted — check the response's
     * requiredTokenAccounts. Send it via the Fogo Sessions SDK (session key
     * signs, paymaster pays). Session routes are currently Valiant-V1-only.
     */
    sessionAccount?: string;
}
interface RawAccountMeta {
    publicKey: string;
    isSigner: boolean;
    isWritable: boolean;
}
interface RawInstruction {
    programId: string;
    accounts: RawAccountMeta[];
    data: string;
}
interface InstructionsResponse {
    instructions: RawInstruction[];
    addressLookupTableAddresses: string[];
    amountIn: string;
    amountOut: string;
    otherAmountThreshold: string;
    /**
     * The DEX pool trading fee across every hop — the LP fee the pools take,
     * NOT Vulcx's. Vulcx's own cut is platformFeeAmount.
     */
    feeAmount: string;
    /** Vulcx's fee rate in bps: the global protocol rate, or your negotiated override. */
    platformFeeBps: number;
    /** platformFeeBps applied to amountOut, in output token units. */
    platformFeeAmount: string;
    /**
     * Your fee rate in bps — yours in full, not a share of platformFeeBps.
     * Echoes what you requested, so you can reconcile against what was charged.
     */
    integratorFeeBps: number;
    /** integratorFeeBps applied to amountOut, paid on-chain to `referrer`. */
    integratorFeeAmount: string;
    hopCount: number;
    route: string[];
    pools: string[];
    /**
     * Session mode only: the user's ATAs the route touches, ordered
     * [inputMint, ...intermediates, outputMint]. They must exist (and the input
     * ATA hold amountIn) before the session transaction is sent.
     */
    requiredTokenAccounts?: string[];
}

declare class VulcxSDK {
    private readonly apiKey?;
    private readonly baseUrl;
    private readonly timeout;
    private readonly retries;
    constructor(config?: SDKConfig);
    quote(params: QuoteRequest): Promise<QuoteResponse>;
    swap(params: SwapRequest): Promise<SwapResponse>;
    instructions(params: InstructionsRequest): Promise<InstructionsResponse>;
    private request;
}

declare class VulcxError extends Error {
    readonly statusCode: number;
    readonly body?: unknown | undefined;
    constructor(message: string, statusCode: number, body?: unknown | undefined);
}
declare class RateLimitError extends VulcxError {
    constructor(body?: unknown);
}
declare class NoRouteError extends VulcxError {
    constructor(body?: unknown);
}
declare class BadRequestError extends VulcxError {
    constructor(message: string, body?: unknown);
}
declare class AuthError extends VulcxError {
    constructor(body?: unknown);
}
declare class ServerError extends VulcxError {
    constructor(message: string, body?: unknown);
}
/** The firm quote's TTL elapsed before redemption (410). Re-quote and retry. */
declare class QuoteExpiredError extends VulcxError {
    constructor(body?: unknown);
}
/** The quoted route no longer exists (409, pool removed). Re-quote and retry. */
declare class QuoteStaleError extends VulcxError {
    constructor(body?: unknown);
}

export { AuthError, BadRequestError, NoRouteError, QuoteExpiredError, QuoteStaleError, RateLimitError, ServerError, VulcxError, VulcxSDK };
export type { InstructionsRequest, InstructionsResponse, PriceImpactSeverity, QuoteRequest, QuoteResponse, RawAccountMeta, RawInstruction, RouteInfo, SDKConfig, SimulationResult, SwapMode, SwapRequest, SwapResponse };
