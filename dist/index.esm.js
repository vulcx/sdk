class VulcxError extends Error {
    constructor(message, statusCode, body) {
        super(message);
        this.statusCode = statusCode;
        this.body = body;
        this.name = "VulcxError";
    }
}
class RateLimitError extends VulcxError {
    constructor(body) {
        super("Rate limit exceeded", 429, body);
        this.name = "RateLimitError";
    }
}
class NoRouteError extends VulcxError {
    constructor(body) {
        super("No route found", 404, body);
        this.name = "NoRouteError";
    }
}
class BadRequestError extends VulcxError {
    constructor(message, body) {
        super(message, 400, body);
        this.name = "BadRequestError";
    }
}
class AuthError extends VulcxError {
    constructor(body) {
        super("Invalid or missing API key", 401, body);
        this.name = "AuthError";
    }
}
class ServerError extends VulcxError {
    constructor(message, body) {
        super(message, 500, body);
        this.name = "ServerError";
    }
}
/** The firm quote's TTL elapsed before redemption (410). Re-quote and retry. */
class QuoteExpiredError extends VulcxError {
    constructor(body) {
        super("Quote expired: request a fresh quote", 410, body);
        this.name = "QuoteExpiredError";
    }
}
/** The quoted route no longer exists (409, pool removed). Re-quote and retry. */
class QuoteStaleError extends VulcxError {
    constructor(body) {
        super("Quoted route is no longer available: request a fresh quote", 409, body);
        this.name = "QuoteStaleError";
    }
}

const DEFAULT_BASE_URL = "https://api.vulcx.xyz";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;
class VulcxSDK {
    // A key is optional, not absent: without one the API serves you anonymously at
    // a much smaller per-IP rate limit, so `new VulcxSDK()` works for trying things
    // out. Pass `apiKey` for the published per-key budget -- and note the
    // `/api/v1/stream` WebSocket requires one regardless.
    constructor(config = {}) {
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
        this.retries = config.retries ?? DEFAULT_RETRIES;
    }
    async quote(params) {
        const qs = new URLSearchParams({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount,
            swapMode: params.swapMode,
        });
        if (params.slippageBps !== undefined) {
            qs.set("slippageBps", String(params.slippageBps));
        }
        return this.request("GET", `/api/v1/quote?${qs}`);
    }
    async swap(params) {
        return this.request("POST", "/api/v1/swap", params);
    }
    async instructions(params) {
        return this.request("POST", "/api/v1/instructions", params);
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            Accept: "application/json",
        };
        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        if (body) {
            headers["Content-Type"] = "application/json";
        }
        let lastError;
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
                    const parsed = (await res.json());
                    // API responses wrap the payload in {success, data}; hand back the
                    // payload the way the method signatures promise.
                    if (parsed && typeof parsed === "object" && "success" in parsed) {
                        if (!parsed.success) {
                            throw new VulcxError(parsed.error ?? "request failed", res.status, parsed);
                        }
                        return parsed.data;
                    }
                    return parsed;
                }
                const errBody = await res.json().catch(() => ({}));
                const errMsg = errBody?.error ?? res.statusText;
                switch (res.status) {
                    case 401:
                    case 403:
                        throw new AuthError(errBody);
                    case 400:
                        throw new BadRequestError(errMsg, errBody);
                    case 404:
                        throw new NoRouteError(errBody);
                    case 409:
                        // Firm quote's route vanished — retrying the same request can't
                        // succeed; the caller must re-quote.
                        throw new QuoteStaleError(errBody);
                    case 410:
                        throw new QuoteExpiredError(errBody);
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
            }
            catch (err) {
                if (err instanceof AuthError ||
                    err instanceof BadRequestError ||
                    err instanceof NoRouteError ||
                    err instanceof VulcxError) {
                    throw err;
                }
                lastError = err;
            }
        }
        throw lastError ?? new Error("request failed");
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export { AuthError, BadRequestError, NoRouteError, QuoteExpiredError, QuoteStaleError, RateLimitError, ServerError, VulcxError, VulcxSDK };
//# sourceMappingURL=index.esm.js.map
