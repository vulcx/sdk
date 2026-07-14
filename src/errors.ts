export class VulcxError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "VulcxError";
  }
}

export class RateLimitError extends VulcxError {
  constructor(body?: unknown) {
    super("Rate limit exceeded", 429, body);
    this.name = "RateLimitError";
  }
}

export class NoRouteError extends VulcxError {
  constructor(body?: unknown) {
    super("No route found", 404, body);
    this.name = "NoRouteError";
  }
}

export class BadRequestError extends VulcxError {
  constructor(message: string, body?: unknown) {
    super(message, 400, body);
    this.name = "BadRequestError";
  }
}

export class AuthError extends VulcxError {
  constructor(body?: unknown) {
    super("Invalid or missing API key", 401, body);
    this.name = "AuthError";
  }
}

export class ServerError extends VulcxError {
  constructor(message: string, body?: unknown) {
    super(message, 500, body);
    this.name = "ServerError";
  }
}

/** The firm quote's TTL elapsed before redemption (410). Re-quote and retry. */
export class QuoteExpiredError extends VulcxError {
  constructor(body?: unknown) {
    super("Quote expired: request a fresh quote", 410, body);
    this.name = "QuoteExpiredError";
  }
}

/** The quoted route no longer exists (409, pool removed). Re-quote and retry. */
export class QuoteStaleError extends VulcxError {
  constructor(body?: unknown) {
    super("Quoted route is no longer available: request a fresh quote", 409, body);
    this.name = "QuoteStaleError";
  }
}
