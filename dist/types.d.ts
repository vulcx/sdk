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
}
export interface SwapRequest {
    userWallet: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
    skipSimulation?: boolean;
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
