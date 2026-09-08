export type SwapMode = "ExactIn" | "ExactOut";
export type PriceImpactSeverity = "none" | "low" | "moderate" | "high" | "extreme";
export interface SDKConfig {
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
export interface QuoteRequest {
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
}
/**
 * One pool hop inside a multi-hop split leg — see `RouteInfo.hops`.
 *
 * It carries no `percent`: the percentage belongs to the leg, not to the hops
 * inside it.
 */
export interface RouteHopInfo {
    poolAddress: string;
    /** Wire value. `Vortex` is the venue Valiant; `Flux` is Fluxbeam. */
    poolType: string;
    inputMint: string;
    outputMint: string;
}
/**
 * One leg of the route — one entry per PARALLEL leg, not per hop.
 *
 * `percent` is a property of the leg, so `routes[].percent` sums to 100 across
 * the array. A leg that is itself multi-hop reports its pools in `hops`; its
 * own `poolAddress`/`poolType` then describe the first hop only, and
 * `inputMint`/`outputMint` span the whole leg.
 */
export interface RouteInfo {
    poolAddress: string;
    poolType: string;
    percent: number;
    inputMint: string;
    outputMint: string;
    /**
     * Per-pool breakdown, present only when this leg routes through more than
     * one pool. Absent for the common single-hop leg, where `poolAddress` and
     * `poolType` already describe it fully — so do not treat an absent `hops` as
     * an error, and do not count it for `hopCount`.
     */
    hops?: RouteHopInfo[];
}
export interface QuoteResponse {
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
     * True when the trade was split across parallel legs. **Absent, not `false`,
     * on the ordinary single-leg quote** — the server omits it when unset, so
     * read it as `quote.isSplitRoute === true`.
     */
    isSplitRoute?: boolean;
    /**
     * Percentages across the parallel legs, summing to 100 — one byte per leg,
     * in the same order as `routes`.
     *
     * **It arrives base64-encoded, not as a JSON array.** The server serialises
     * it from a Go byte slice, so a 92/8 split is the string `"XAg="`. Decode
     * before use:
     *
     * ```ts
     * const pct = Array.from(
     *   typeof Buffer !== "undefined"
     *     ? Buffer.from(splitPercents, "base64")
     *     : Uint8Array.from(atob(splitPercents), (c) => c.charCodeAt(0)),
     * );
     * ```
     *
     * `routes[].percent` carries the same numbers already decoded, so prefer
     * that unless you specifically need this field. Absent unless
     * `isSplitRoute` is true.
     *
     * Established from the serialisation, not from a captured response: the
     * server field is `[]uint8`, which is Go's `[]byte`, and `encoding/json`
     * base64-encodes those. Marshalling the real struct with a 92/8 split emits
     * `{"splitPercents":"XAg="}`. FOGO/USDC would not split at any size on
     * 2026-09-08 — one pool holds the pair — so no live split was available to
     * photograph. The previous `number[]` typing was wrong either way: `.map()`
     * over it walks the characters of a base64 string.
     */
    splitPercents?: string;
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
     *
     * Always present — the server does not omit it at zero.
     */
    dataAgeMs: number;
}
export interface SwapRequest {
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
export interface SimulationResult {
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
export interface SwapResponse {
    transaction: string;
    lastValidBlockHeight: number;
    amountIn: string;
    amountOut: string;
    minAmountOut?: string;
    maxAmountIn?: string;
    /**
     * The DEX pool trading fee across every hop — the LP fee the pools take,
     * NOT Vulcx's. Vulcx's own cut is platformFeeAmount.
     *
     * **Denominated in the INPUT token: it is `feeBps` of `amountIn`.** Never
     * subtract it from `amountOut` — the two are in different units and the
     * result is meaningless. Measured on production 2026-09-08, 1 FOGO → USDC at
     * 30 bps: `amountOut` 7054 (USDC base units), `feeAmount` 3000000 (FOGO base
     * units, 30 bps of 1000000000) — 425x the entire output.
     *
     * What the user receives is `amountOut - platformFeeAmount -
     * integratorFeeAmount`, and only those two.
     */
    feeAmount: string;
    /** Vulcx's fee rate in bps: the global protocol rate, or your negotiated override. */
    platformFeeBps: number;
    /**
     * platformFeeBps applied to amountOut, in OUTPUT token units, deducted from
     * amountOut on chain. Unlike feeAmount, this one really is output-side.
     */
    platformFeeAmount: string;
    /**
     * Your fee rate in bps — yours in full, not a share of platformFeeBps.
     * Echoes what you requested, so you can reconcile against what was charged.
     */
    integratorFeeBps: number;
    /**
     * integratorFeeBps applied to amountOut, in OUTPUT token units, paid on-chain
     * to `referrer`. Output-side, like platformFeeAmount and unlike feeAmount.
     */
    integratorFeeAmount: string;
    simulation?: SimulationResult;
    computeUnitsEstimate: number;
    /**
     * The chain slot the pool state behind this build was current to. Omitted
     * when the engine has no slot yet.
     */
    contextSlot?: number;
    /**
     * How long ago, in milliseconds, any market-data update last reached the
     * engine — the same freshness signal as on QuoteResponse, for the build.
     *
     * Check it here too. A transaction built off a frozen feed is byte-shaped
     * like one built off a live feed, and `skipSimulation: true` removes the only
     * other thing that would have caught it. Always present; the server does not
     * omit it at zero.
     */
    dataAgeMs: number;
    route: string[];
    hopCount: number;
    pools: string[];
    /** Always present, `false` included — unlike the quote's, which is omitted. */
    isSplitRoute: boolean;
    /**
     * Base64-encoded byte array of the per-leg percentages — see
     * `QuoteResponse.splitPercents` for the decode. Absent unless `isSplitRoute`
     * is true.
     *
     * Not observed on the wire: on production 2026-09-08 every pair that quoted
     * as a split came back from /swap as `isSplitRoute: false` on a single pool,
     * so the builder collapses splits today. Typed from the handler struct
     * (`internal/http/swap_handler.go`), whose Go type is byte-for-byte the
     * quote's.
     */
    splitPercents?: string;
}
export interface InstructionsRequest {
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
export interface RawAccountMeta {
    publicKey: string;
    isSigner: boolean;
    isWritable: boolean;
}
export interface RawInstruction {
    programId: string;
    accounts: RawAccountMeta[];
    data: string;
}
export interface InstructionsResponse {
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
export interface APIErrorBody {
    /** The human sentence. Prose — the server may reword it. Do not match on it. */
    error: string;
    /**
     * The stable reason code (`NO_ROUTE`, `SIM_SLIPPAGE`, …), surfaced on
     * VulcxError.code. Absent on a server that predates codes.
     */
    code?: string;
}
