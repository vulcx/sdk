export declare class VulcxError extends Error {
    readonly statusCode: number;
    readonly body?: unknown | undefined;
    constructor(message: string, statusCode: number, body?: unknown | undefined);
}
export declare class RateLimitError extends VulcxError {
    constructor(body?: unknown);
}
export declare class NoRouteError extends VulcxError {
    constructor(body?: unknown);
}
export declare class BadRequestError extends VulcxError {
    constructor(message: string, body?: unknown);
}
export declare class AuthError extends VulcxError {
    constructor(body?: unknown);
}
export declare class ServerError extends VulcxError {
    constructor(message: string, body?: unknown);
}
