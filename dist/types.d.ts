export type SwapMode = "ExactIn" | "ExactOut";
export type PriceImpactSeverity = "none" | "low" | "moderate" | "high" | "extreme";
export interface SDKConfig {
    apiKey: string;
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
export interface RouteInfo {
    poolAddress: string;
    poolType: string;
    percent: number;
    inputMint: string;
    outputMint: string;
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
}
export interface SimulationResult {
    success: boolean;
    computeUnitsConsumed: number;
    computeUnitsTotal: number;
    logs: string[];
    error: string;
    slippageExceeded: boolean;
    insufficientFunds: boolean;
    accountsNeeded: string[];
}
export interface SwapResponse {
    transaction: string;
    lastValidBlockHeight: number;
    amountIn: string;
    amountOut: string;
    minAmountOut?: string;
    maxAmountIn?: string;
    feeAmount: string;
    simulation?: SimulationResult;
    computeUnitsEstimate: number;
    route: string[];
    hopCount: number;
    pools: string[];
    isSplitRoute: boolean;
    splitPercents?: number[];
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
    feeAmount: string;
    hopCount: number;
    route: string[];
    pools: string[];
}
export interface APIErrorBody {
    error: string;
}
