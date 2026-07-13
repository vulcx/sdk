import type { SDKConfig, QuoteRequest, QuoteResponse, SwapRequest, SwapResponse, InstructionsRequest, InstructionsResponse } from "./types";
export declare class VulcxSDK {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeout;
    private readonly retries;
    constructor(config: SDKConfig);
    quote(params: QuoteRequest): Promise<QuoteResponse>;
    swap(params: SwapRequest): Promise<SwapResponse>;
    instructions(params: InstructionsRequest): Promise<InstructionsResponse>;
    private request;
}
