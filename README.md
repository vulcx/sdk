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

Anonymous callers get a small per-IP budget: **2 requests/second, burst 20**, and
a `/swap` build costs 5 of those units. A key raises that to the published 100
cost units/second, and is **required** for the WebSocket quote stream and
nothing else.

```typescript
const vulcx = new VulcxSDK({ apiKey: process.env.VULCX_KEY });
```

Keys are free during beta but not self-serve: there is no dashboard, and they
are issued by hand — [ask for one](https://vulcx.xyz/api-key/), which routes to
[t.me/vulcxsupport](https://t.me/vulcxsupport).

## Runnable examples

[`examples/`](./examples) has three self-contained programs and a cookbook of
the same calls as raw `curl`:

- [**node-quote-to-swap**](./examples/node-quote-to-swap) — quote → build →
  sign → submit → confirm, in one file, with the error handling an integration
  actually needs. Dry-runs by default.
- [**browser-wallet**](./examples/browser-wallet) — the browser signing flow.
  No wallet advertises a Fogo chain, so the wallet **signs only** and the page
  submits to `mainnet.fogo.io` itself.
- [**integrator-fee**](./examples/integrator-fee) — charging your own fee, and
  reconciling what you receive.

[`examples/README.md`](./examples/README.md) is the cookbook: every endpoint as
`curl`, and the full table of error `code` values with what to do about each.

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

The server simulates the transaction before returning it, and a simulation that
fails is an **error**, not a 200 you have to inspect. You get no transaction, and
the reason is typed:

```typescript
try {
  const swap = await vulcx.swap({ /* … */ });
  // Reaching here means the simulation passed. Sign and submit.
} catch (err) {
  if (err instanceof QuoteStaleError) {
    // 409 — the price moved between quoting and building. Re-quote and retry.
  } else if (err instanceof BadRequestError) {
    // 400 — insufficient funds. Retrying changes nothing.
  } else if (err instanceof VulcxError && err.statusCode === 422) {
    // The route cannot execute as shaped.
  }
}
```

The `SimulationResult` rides along on the thrown error's body at
`data.simulation`, with `insufficientFunds` and `slippageExceeded` set. The
error's `code` says the same thing more directly — `SIM_INSUFFICIENT` (400),
`SIM_SLIPPAGE` (409), `SIM_FAILED` (422) — so branch on either, never on
message text.

`skipSimulation: true` opts out entirely: nothing is simulated, so nothing
gates, and `swap.simulation` is absent. You are then responsible for whatever
the transaction does on chain.

### `sdk.instructions(params): Promise<InstructionsResponse>`

Raw instructions plus `addressLookupTableAddresses`, for composing the swap into a
transaction of your own — adding a memo, creating accounts, batching.

## Errors

Every error extends `VulcxError`, which carries `statusCode` and — the thing to
branch on — `code`, the API's stable reason string:

```typescript
catch (err) {
  if (err instanceof VulcxError) {
    switch (err.code) {
      case "SIM_INSUFFICIENT": /* wallet is short; retrying changes nothing */ break;
      case "SIM_SLIPPAGE":
      case "QUOTE_STALE":      /* the price moved; re-quote and retry */       break;
      case "POOL_DATA_MISSING":/* engine still loading; retry shortly */       break;
      default:                 /* fall back to err.statusCode */               break;
    }
  }
}
```

`code` is never renamed or reused once shipped; `message` is prose the server
may reword, so do not match on it. New codes get added — treat one you do not
recognise as its HTTP status class. It is `undefined` on a transport failure
with no response body. The full table is in
[the cookbook](./examples/README.md#error-codes).

The typed classes below cover a status each, which is enough when a status has
only one meaning. Several do not: `409` is both `QUOTE_STALE` and
`SIM_SLIPPAGE`, `404` is `NO_POOL`, `NO_ROUTE` or `POOL_DATA_MISSING`. That is
what `code` is for.

```typescript
import {
  VulcxSDK, VulcxError, NoRouteError, RateLimitError, AuthError,
  BadRequestError, QuoteExpiredError, QuoteStaleError,
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

`QuoteExpiredError` (410) only appears when redeeming a `quoteId`.
`QuoteStaleError` (409) has two causes: a redeemed route that drifted past the
firm margin, and a plain `swap()`/`instructions()` call — no `quoteId` involved —
whose simulation failed on slippage. Both mean the same recovery: fetch a fresh
quote and retry.

**Quotes expire in about three seconds** (`validForMs`), and the firm window
(`firmForMs`) is roughly 400 ms. Both are measured from when the quote was
minted, not from when you send it, so do not hold a `quoteId` across a user
interaction — a wallet popup will outlive it and `swap()` throws
`QuoteExpiredError`. Either build on the same tick you quote, re-quote when the
user clicks, or omit `quoteId` entirely and let the server re-quote at build
time under your `slippageBps`. The firm window is only reachable from machine
flows: session-key signing, bots, keepers.

Note also that this SDK retries 429s and 5xx with a one-second first backoff,
which on its own already exceeds `firmForMs` — so a firm redemption that hits
one transient 429 is guaranteed to land outside its window. `retries` is set
per client, not per call, so use a second instance for firm flows:

```typescript
const firm = new VulcxSDK({ apiKey: process.env.VULCX_KEY, retries: 0 });
```

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

A browser-visible key is readable by anyone using the page. Ask for an
**origin-locked** key for client-side use: the edge enforces the allowlist on
both the REST chain and the `/stream` handshake, which is the only thing making
a public key safe. An unlocked key in page source is a key you have given away.

## Links

- [Examples and cookbook](./examples) — start here
- [Docs](https://docs.vulcx.xyz) · [SDK reference](https://docs.vulcx.xyz/sdk/quickstart)
- [Ask for an API key](https://vulcx.xyz/api-key/) — free during beta, issued by hand
- [Status](https://vulcx.xyz/status/)

MIT
