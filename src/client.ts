import type {
  SDKConfig,
  Chain,
  QuoteRequest,
  QuoteResponse,
  SwapRequest,
  SwapResponse,
  InstructionsRequest,
  InstructionsResponse,
} from "./types";
import {
  VulcxError,
  RateLimitError,
  NoRouteError,
  BadRequestError,
  AuthError,
  ServerError,
} from "./errors";

const DEFAULT_BASE_URL = "https://api.vulcx.xyz";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;

export class VulcxSDK {
  private readonly apiKey: string;
  private readonly chain: Chain;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(config: SDKConfig) {
    if (!config.apiKey) throw new Error("apiKey is required");
    this.apiKey = config.apiKey;
    this.chain = config.chain ?? "solana";
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retries = config.retries ?? DEFAULT_RETRIES;
  }

  async quote(params: QuoteRequest): Promise<QuoteResponse> {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      swapMode: params.swapMode,
    });
    if (params.slippageBps !== undefined) {
      qs.set("slippageBps", String(params.slippageBps));
    }
    return this.request<QuoteResponse>("GET", `/api/v1/quote?${qs}`);
  }

  async swap(params: SwapRequest): Promise<SwapResponse> {
    return this.request<SwapResponse>("POST", "/api/v1/swap", params);
  }

  async instructions(
    params: InstructionsRequest
  ): Promise<InstructionsResponse> {
    return this.request<InstructionsResponse>(
      "POST",
      "/api/v1/instructions",
      params
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${separator}chain=${this.chain}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          return (await res.json()) as T;
        }

        const errBody = await res.json().catch(() => ({}));
        const errMsg =
          (errBody as Record<string, string>)?.error ?? res.statusText;

        switch (res.status) {
          case 401:
          case 403:
            throw new AuthError(errBody);
          case 400:
            throw new BadRequestError(errMsg, errBody);
          case 404:
            throw new NoRouteError(errBody);
          case 429:
            lastError = new RateLimitError(errBody);
            continue;
          default:
            if (res.status >= 500) {
              lastError = new ServerError(errMsg, errBody);
              continue;
            }
            throw new VulcxError(errMsg, res.status, errBody);
        }
      } catch (err) {
        if (
          err instanceof AuthError ||
          err instanceof BadRequestError ||
          err instanceof NoRouteError ||
          err instanceof VulcxError
        ) {
          throw err;
        }
        lastError = err as Error;
      }
    }

    throw lastError ?? new Error("request failed");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
