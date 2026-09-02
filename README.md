# @vulcx/sdk

TypeScript client for [Vulcx](https://vulcx.xyz), the best-price swap router for Fogo.
Give it a token pair and an amount; it searches every pool on the chain — up to five
hops, splitting across pools when splitting wins — and hands back a transaction you
can sign. Works in Node.js, browsers, and any runtime with `fetch`.

## Install

```bash
npm install @vulcx/sdk
```

Or via CDN:

```html
<script src="https://unpkg.com/@vulcx/sdk/dist/index.umd.js"></script>
```

## Quick start — no key required

`quote`, `swap` and `instructions` all answer anonymous requests, so the first call
needs no setup at all:

```typescript
import { VulcxSDK } from "@vulcx/sdk";

const vulcx = new VulcxSDK();

const quote = await vulcx.quote({
  inputMint: "So11111111111111111111111111111111111111112", // FOGO
  outputMint: "uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG", // USDC on Fogo
  amount: "1000000000", // 1 FOGO (9 decimals)
  swapMode: "ExactIn",
  slippageBps: 50,
});

console.log(`Output: ${quote.amountOut}, Impact: ${quote.priceImpactPercent}%`);
```

Anonymous callers get a small per-IP budget. A key raises that to the published
100 cost units/second and is **required** for the WebSocket quote stream. Keys are
free during beta — [request one](https://vulcx.xyz/api-key/).

```typescript
const vulcx = new VulcxSDK({ apiKey: process.env.VULCX_KEY });
```

## Firm quotes — the price you saw is the price you commit

Every quote carries a `quoteId`. Hand it back and the engine replays that exact
route rather than re-routing against whatever the book looks like a moment later:

```typescript
const quote = await vulcx.quote({ /* … */ });

const swap = await vulcx.swap({
  userWallet: "9WzDX...",
  inputMint: quote.inputMint,
  outputMint: quote.outputMint,
  amount: quote.amountIn,
  swapMode: "ExactIn",
  quoteId: quote.quoteId, // replay this route, min-out anchored to this price
  firm: true,             // price-or-fail, within quote.firmForMs
});
```

With `firm: true`, slippage collapses to a fixed margin around the quoted price. If
the market moved past it you get a `QuoteStaleError` **before** a transaction is
built — not a signed transaction that reverts on chain.

`quote.validForMs` is how long `quoteId` stays redeemable; `quote.firmForMs` is the
shorter window in which `firm: true` is accepted.

## API

### `new VulcxSDK(config?)`

| Parameter | Type     | Default                   | Description |
| --------- | -------- | ------------------------- | ----------- |
| `apiKey`  | `string` | _optional_                | Raises you to the published per-key budget. Without one, requests are served anonymously at a much smaller per-IP limit. `/api/v1/stream` always requires one. |
| `baseUrl` | `string` | `"https://api.vulcx.xyz"` | Point this at your own instance if you self-host |
| `timeout` | `number` | `30000`                   | Request timeout in ms |
| `retries` | `number` | `2`                       | Retry count for 429/5xx |

### `sdk.quote(params): Promise<QuoteResponse>`

Best route and estimated output. Returns `amountIn`, `amountOut`, `priceImpactBps`,
`priceImpactPercent`, `priceImpactSeverity`, `hopCount`, a `routes` array, and the
firm-quote fields above.

### `sdk.swap(params): Promise<SwapResponse>`

A base64 unsigned transaction, plus `lastValidBlockHeight` and a `simulation` result.

```typescript
const swap = await vulcx.swap({
  userWallet: "9WzDX...",
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG",
  amount: "1000000000",
  swapMode: "ExactIn",
  slippageBps: 50,
});
```

Check `swap.simulation.success` before submitting — a failed simulation still comes
back with HTTP 200 and a transaction.

### `sdk.instructions(params): Promise<InstructionsResponse>`

Raw instructions plus `addressLookupTableAddresses`, for composing the swap into a
transaction of your own — adding a memo, creating accounts, batching.

## Errors

Every error extends `VulcxError`.

```typescript
import {
  VulcxSDK, NoRouteError, RateLimitError, AuthError,
  QuoteExpiredError, QuoteStaleError,
} from "@vulcx/sdk";

try {
  const quote = await vulcx.quote({ /* … */ });
} catch (err) {
  if (err instanceof NoRouteError)          console.log("No route for this pair or size");
  else if (err instanceof RateLimitError)   console.log("Backed off — retry shortly");
  else if (err instanceof AuthError)        console.log("Key is invalid or revoked");
  else if (err instanceof QuoteExpiredError) console.log("quoteId aged out — re-quote");
  else if (err instanceof QuoteStaleError)   console.log("Price drifted past the firm margin");
}
```

`QuoteExpiredError` and `QuoteStaleError` only appear when redeeming a `quoteId`.
Both mean the same recovery: fetch a fresh quote and retry.

## React

```tsx
import { VulcxSDK } from "@vulcx/sdk";
import { useEffect, useState } from "react";

const sdk = new VulcxSDK({ apiKey: process.env.NEXT_PUBLIC_VULCX_KEY });

function SwapPage() {
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    sdk
      .quote({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG",
        amount: "1000000000",
        swapMode: "ExactIn",
      })
      .then(setQuote);
  }, []);

  return <div>{quote && <p>Output: {quote.amountOut}</p>}</div>;
}
```

A browser-visible key is readable by anyone using the page. Provision a separate key
for client-side use and rotate it if it leaks.

## Links

- [Docs](https://docs.vulcx.xyz) · [SDK reference](https://docs.vulcx.xyz/sdk/quickstart)
- [Get an API key](https://vulcx.xyz/api-key/) — free during beta
- [Status](https://vulcx.xyz/status/)

MIT
