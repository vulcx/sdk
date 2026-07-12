type SwapMode = "ExactIn" | "ExactOut";
type Chain = "solana" | "fogo";
type PriceImpactSeverity = "none" | "low" | "moderate" | "high" | "extreme";
interface SDKConfig {
    apiKey: string;
    chain?: Chain;
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
}
interface SwapRequest {
    userWallet: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
    skipSimulation?: boolean;
}
interface SimulationResult {
    success: boolean;
    computeUnitsConsumed: number;
    computeUnitsTotal: number;
    logs: string[];
    error: string;
    slippageExceeded: boolean;
    insufficientFunds: boolean;
    accountsNeeded: string[];
}
interface SwapResponse {
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
interface InstructionsRequest {
    userWallet: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    swapMode: SwapMode;
    slippageBps?: number;
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
    feeAmount: string;
    hopCount: number;
    route: string[];
    pools: string[];
}

declare class VulcxSDK {
    private readonly apiKey;
    private readonly chain;
    private readonly baseUrl;
    private readonly timeout;
    private readonly retries;
    constructor(config: SDKConfig);
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

export { AuthError, BadRequestError, NoRouteError, RateLimitError, ServerError, VulcxError, VulcxSDK };
export type { Chain, InstructionsRequest, InstructionsResponse, PriceImpactSeverity, QuoteRequest, QuoteResponse, RawAccountMeta, RawInstruction, RouteInfo, SDKConfig, SimulationResult, SwapMode, SwapRequest, SwapResponse };
