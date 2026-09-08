# Vulcx cookbook — from curious to a first swap

Runnable examples, and the same calls as raw `curl` for anyone not using
TypeScript. Every endpoint is plain HTTP and JSON; nothing here needs the SDK.

| Example | What it shows |
|---|---|
| [`node-quote-to-swap/`](./node-quote-to-swap) | quote → build → sign → submit → confirm, with the error handling an integration actually needs |
| [`browser-wallet/`](./browser-wallet) | the browser signing flow: the wallet **signs only**, the page submits to Fogo itself |
| [`integrator-fee/`](./integrator-fee) | setting your own fee, and reconciling what you receive |

Start here — one command, no key, no wallet:

```bash
curl "https://api.vulcx.xyz/api/v1/quote?\
inputMint=So11111111111111111111111111111111111111112&\
outputMint=uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG&\
amount=1000000000&swapMode=ExactIn&slippageBps=50"
```

---

## Authentication

**An API key is not required.** Keyless requests are served on an anonymous
per-IP tier: **2 requests/second, burst 20**. A key raises you to the published
per-key budget (100 cost units/second, burst 200). One endpoint is different:

> `/api/v1/stream` (the WebSocket) **always** requires a key — a long-lived
> connection does not fit the per-request limiter model.

Requests are debited by what they cost the engine, not by how many you made:

| Request | Cost |
|---|---|
| `/quote`, `/price`, `/price/:mint` | 1 |
| `/pools/*`, `/cpi/route-accounts` | 3 |
| `/swap`, `/instructions` | 5 |

So one `/swap` build spends 5 of the anonymous burst of 20 — enough to try the
API, not enough to build a product on.

Send a key as a bearer token:

```bash
curl -H "Authorization: Bearer $VULCX_KEY" "https://api.vulcx.xyz/api/v1/quote?..."
```

**There is no dashboard and no self-serve signup.** During beta keys are issued
by hand — ask on [t.me/vulcxsupport](https://t.me/vulcxsupport). Keys can be
origin-locked, which is the only thing that makes a key in browser source safe;
ask for that if the key will ship in a page.

`/health`, `/metrics` and `/api/v1/tokens` sit outside the auth chain entirely.

---

## Response envelope

Every response is wrapped:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "invalid inputMint address", "code": "INVALID_REQUEST" }
```

`code` is the contract; `error` is prose and may be reworded at any time.
**Branch on `code`.** The SDK unwraps `data` for you and surfaces `code` on the
thrown `VulcxError`.

---

## The calls

### Quote — what will I get

```bash
curl -sS "https://api.vulcx.xyz/api/v1/quote?\
inputMint=So11111111111111111111111111111111111111112&\
outputMint=uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG&\
amount=1000000000&swapMode=ExactIn&slippageBps=50"
```

```json
{"success":true,"data":{
  "inputMint":"So111...112","outputMint":"uSd2c...NoG",
  "amountIn":"1000000000","amountOut":"7054",
  "priceImpactBps":1,"priceImpactPercent":"0.01%",
  "priceImpactSeverity":"none","priceImpactWarning":"",
  "feeBps":30,
  "routes":[{"poolAddress":"J7mxB...QMKp","poolType":"Vortex","percent":100,
             "inputMint":"So111...112","outputMint":"uSd2c...NoG"}],
  "routePath":["So111...112","uSd2c...NoG"],"hopCount":1,
  "otherAmountThreshold":"7018",
  "quoteId":"q_69feffbe1caf5b0793e5c3949d964a9e",
  "validForMs":3000,"firmForMs":400,
  "quoteSignature":"3NZrh...HQ4z","quoteExpiresAtMs":1788833610209,
  "contextSlot":731999348,"dataAgeMs":31}}
```

Parameters: `inputMint`, `outputMint`, `amount` (base units, as a string),
`swapMode` (`ExactIn` | `ExactOut`) are required; `slippageBps` defaults to 50.

Four things worth reading properly:

- **`amountIn` is what the route consumes**, not necessarily what you asked
  for. A concentrated-liquidity route that runs out of reachable ticks fills
  what it can, so a request for `100000000000` can come back as
  `99999759359`. Compare them.
- **`amountOut` is gross.** `/quote` does not apply Vulcx's fee — `feeBps` here
  is the *pool* fee across the route, what the LPs take. Vulcx's cut is not
  broken out until you build.
- **`dataAgeMs`** is how long ago any pool update reached the engine. State is
  held in memory off a stream that does not backfill after a reconnect, so a
  frozen feed prices off stale reserves and the response is otherwise identical
  to a fresh one. Treat a value materially above a second or two as a reason to
  distrust the price.
- **`poolType: "Vortex"` is the wire value; the venue is called Valiant.**
  `Flux` is Fluxbeam. Map it before you show it to anyone.

### Swap — a transaction, built for you

```bash
curl -sS -X POST "https://api.vulcx.xyz/api/v1/swap" \
  -H "Content-Type: application/json" \
  -d '{
    "userWallet":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "inputMint":"So11111111111111111111111111111111111111112",
    "outputMint":"uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG",
    "amount":"1000000000",
    "swapMode":"ExactIn",
    "slippageBps":50
  }'
```

Returns a base64 **unsigned v0 transaction** in `data.transaction`, plus
`lastValidBlockHeight`, the fee breakdown, and a `simulation` result.

**The server simulates before it answers, and a failing simulation is an error
status, not a 200 you have to inspect.** A `200` means the transaction passed
simulation. The failure carries its `SimulationResult` at `data.simulation` —
same place a success puts it — split three ways by what you should do about it:

| | Status | `code` | What it means |
|---|---|---|---|
| wallet is short | 400 | `SIM_INSUFFICIENT` | retrying changes nothing |
| price moved | 409 | `SIM_SLIPPAGE` | re-quote and retry |
| anything else | 422 | `SIM_FAILED` | the route cannot execute as shaped |

`"skipSimulation": true` opts out entirely — nothing is simulated, nothing
gates, and `simulation` is absent from the response. You then own whatever the
transaction does on chain.

Then: deserialize the base64, sign it, submit it to a Fogo RPC yourself, and
poll until `lastValidBlockHeight` passes. See
[`node-quote-to-swap`](./node-quote-to-swap) and
[`browser-wallet`](./browser-wallet).

### Instructions — compose it yourself

```bash
curl -sS -X POST "https://api.vulcx.xyz/api/v1/instructions" \
  -H "Content-Type: application/json" \
  -d '{
    "userWallet":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "inputMint":"So11111111111111111111111111111111111111112",
    "outputMint":"uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG",
    "amount":"1000000000","swapMode":"ExactIn","slippageBps":50
  }'
```

Returns `instructions[]` (`programId`, `accounts[]`, base64 `data`) and
`addressLookupTableAddresses[]`. Use this when the swap has to sit inside a
larger transaction — a memo, an account creation, a rebalance. You resolve the
lookup tables from chain and assemble the v0 transaction yourself.

Nothing is simulated on this path. There is no simulation gate to lean on.

### Firm quotes — the price you saw

Every quote carries a `quoteId`. Hand it back and the engine replays *that*
route with min-out anchored to *that* price, instead of re-routing against
whatever the book looks like a moment later:

```bash
curl -sS -X POST "https://api.vulcx.xyz/api/v1/swap" \
  -H "Content-Type: application/json" \
  -d '{"userWallet":"9WzDX...","inputMint":"So111...112","outputMint":"uSd2c...NoG",
       "amount":"1000000000","swapMode":"ExactIn",
       "quoteId":"q_69feffbe1caf5b0793e5c3949d964a9e","firm":true}'
```

With `"firm": true`, slippage collapses to a fixed margin around the quoted
price — price-or-fail. If the market moved past it you get a `409` **before** a
transaction is built.

The windows are short and measured from when the quote was **minted**, not from
when you send it: `validForMs` is ~3000, `firmForMs` ~400. That makes the firm
path reachable from machine flows only — bots, keepers, session-key signing.
Anything with a wallet popup in it will outlive the window and get a `410`.
Omit `quoteId` and let the server re-quote at build time under your
`slippageBps`; that is the right default for a UI.

Quotes are Ed25519-signed (`quoteSignature`). The verification key is public:

```bash
curl -sS "https://api.vulcx.xyz/.well-known/vulcx-quote-signer"
```

The signed message is
`vulcx-quote-v1|quoteId|inputMint|outputMint|amountIn|amountOut|exactIn|expiresAtUnixMs`,
so a third party can verify what price was quoted without trusting the server
that issued it.

### Your own fee

```bash
curl -sS -X POST "https://api.vulcx.xyz/api/v1/swap" \
  -H "Content-Type: application/json" \
  -d '{"userWallet":"9WzDX...","inputMint":"So111...112","outputMint":"uSd2c...NoG",
       "amount":"1000000000","swapMode":"ExactIn","slippageBps":50,
       "referrer":"<your base58 wallet>","integratorFeeBps":20}'
```

`referrer` and `integratorFeeBps` go together — one without the other is either
a `400 FEE_NEEDS_REFERRER` or a wallet nobody pays. You keep `integratorFeeBps`
**in full**; it is independent of Vulcx's `platformFeeBps` and the two **add**,
capped at 100 bps combined. Full treatment, including the slippage interaction
that will otherwise bite you: [`integrator-fee/`](./integrator-fee).

### Calling from another program (CPI)

```bash
curl -sS -X POST "https://api.vulcx.xyz/api/v1/cpi/route-accounts" \
  -H "Content-Type: application/json" \
  -d '{"authority":"<your PDA or signer>",
       "inputMint":"So111...112","outputMint":"uSd2c...NoG",
       "amount":"1000000000","swapMode":"ExactIn","slippageBps":50}'
```

Returns the account list your program needs to CPI into the aggregator: forward
it into your program's `route` CPI and sign with your PDA seeds
(`invoke_signed`). This is also the only endpoint that accepts
`allowedIntermediateMints` and `maxHops`, because the route corridor determines
which ATAs your PDA has to own — **no ATA-create or SOL wrap/unwrap
instructions are emitted here**, so every account in `requiredTokenAccounts`
(and the `referrerAta`, if you take a fee) must already exist before the CPI
runs. Split routes have no CPI form yet — that is a `422 CPI_SPLIT_UNSUP`.

### The small stuff

```bash
curl -sS "https://api.vulcx.xyz/api/v1/tokens"                  # display metadata, no auth
curl -sS "https://api.vulcx.xyz/api/v1/price/<mint>"            # spot USD, one mint
curl -sS "https://api.vulcx.xyz/api/v1/price?mints=<m1>,<m2>"   # batched, max 100
curl -sS "https://api.vulcx.xyz/api/v1/pools/stats"
curl -sS "https://api.vulcx.xyz/api/v1/pools/list"
curl -sS "https://api.vulcx.xyz/api/v1/pools/<address>"
curl -sS "https://api.vulcx.xyz/health"                         # readiness, not liveness
```

`/health` returns **503** when the engine holds no pools. It is readiness on
purpose: a process that is up but has loaded nothing can quote nothing.

### Streaming

```
wss://api.vulcx.xyz/api/v1/stream?key=<api key>
```

The one endpoint that always needs a key. Subscribe to pairs and receive a
quote push when the underlying pools change, rather than on a timer. It also
emits `{"type":"invalidate","quoteId":"…"}` when a firm quote drifts out of its
margin, so a UI can grey out a stale price instead of letting someone click it.

---

## Error codes

`code` is stable: never renamed, never reused for a different meaning once
shipped. New ones get added, so treat an unrecognised code as its HTTP status
class. `error` is the human sentence and is not stable — do not match on it.

### 400 — you sent something wrong

| `code` | What to do |
|---|---|
| `INVALID_REQUEST` | A parameter failed validation. Fix the request; retrying is pointless. |
| `INVALID_WALLET` | `userWallet` / `authority` is not a valid base58 pubkey. |
| `FEE_CAP_EXCEEDED` | `platformFeeBps + integratorFeeBps` > 100. Lower yours; read `platformFeeBps` off a build rather than assuming it. |
| `FEE_NEEDS_REFERRER` | You set `integratorFeeBps` with no `referrer` to pay it to. |
| `EXACT_OUT_MULTIHOP` | ExactOut cannot span hops on chain. Quote ExactOut to size the input, then execute ExactIn at input × (1 + buffer) and sweep the surplus. |
| `EXACT_OUT_DEX` | This venue has no exact-out CPI (Fluxbeam). Re-quote with `swapMode=ExactIn`. |
| `SESSION_ROUTE_UNSUP` | The route has a hop that cannot forward the session signer. Session routes are Valiant-V1-only today. |
| `QUOTE_MISMATCH` | The `quoteId` does not match the pair, amount or mode you sent with it. |
| `SIM_INSUFFICIENT` | The wallet cannot cover it. **Retrying changes nothing** — tell the user. |

### 401 / 403 — who you are

| `code` | Status | What to do |
|---|---|---|
| `MISSING_API_KEY` | 401 | Only reachable where a key is mandatory (`/stream`), or when anonymous access is disabled on that deployment. |
| `INVALID_API_KEY` | 403 | Revoked or wrong. Not retryable. |
| `ORIGIN_REQUIRED` | 403 | The key is origin-locked and no `Origin` header was sent — you are calling a browser key from a server. |
| `ORIGIN_NOT_ALLOWED` | 403 | The `Origin` is not on the key's allowlist. |
| `QUOTE_WRONG_KEY` | 403 | The `quoteId` was minted for a different API key. Quote and redeem with the same key. |

### 404 — nothing to route through

| `code` | What to do |
|---|---|
| `NO_POOL` | No pool exists for the pair. Not retryable. |
| `POOL_DATA_MISSING` | Pools exist but their state is not loaded yet. **Worth retrying** — loading retries in the background. |
| `NO_ROUTE` | Pools exist, but no path connects the pair *at this size*. Try smaller. |
| `NO_ROUTE_CONSTRAINED` | A path exists, just not inside your constraints. Only reachable on `/cpi/route-accounts`, the one endpoint that takes `maxHops` / `allowedIntermediateMints` — widen them, or drop them. |

### 409 — the request was fine, the world moved

Both are retryable after a fresh quote, and they are **not** the same event —
log them apart.

| `code` | What happened |
|---|---|
| `QUOTE_STALE` | A pinned route drifted past its firm margin. |
| `SIM_SLIPPAGE` | A plain build whose own simulation failed on slippage. |

### 410 — it existed and is gone

| `code` | What to do |
|---|---|
| `QUOTE_EXPIRED` | The `quoteId` is past `validForMs`. Re-quote. If you hit this routinely, you are pinning across a user interaction — stop pinning. |

### 422 — routable, but not buildable as shaped

| `code` | What to do |
|---|---|
| `ROUTE_TOO_LARGE` | More accounts than fit in one transaction. Split the trade, or constrain routing. |
| `CPI_SPLIT_UNSUP` | Split routes have no CPI form yet. Retry with a pair that routes directly. |
| `SIM_FAILED` | Simulation failed for a reason that is neither funds nor slippage. Read `data.simulation.logs`. |

### 429 / 500

| `code` | Status | What to do |
|---|---|---|
| `RATE_LIMITED` | 429 | Back off. If you are keyless, this is the 2 rps / burst 20 tier — get a key. |
| `INTERNAL` | 500 | Ours. Retry with backoff; the message is deliberately fixed, since interpolating an internal error can leak a credentialed RPC URL. |

### Codes on the SDK's typed errors

```ts
try {
  await vulcx.swap({ /* … */ });
} catch (err) {
  if (err instanceof VulcxError) {
    switch (err.code) {                 // stable
      case "SIM_INSUFFICIENT": /* tell the user, do not retry */ break;
      case "SIM_SLIPPAGE":
      case "QUOTE_STALE":      /* re-quote and retry */          break;
      case "POOL_DATA_MISSING":/* retry shortly */               break;
      default:                 /* fall back to err.statusCode */ break;
    }
  }
}
```

`err.code` is `undefined` on a transport failure with no response body, and on
a server old enough to predate codes — so always keep a `statusCode` fallback.

---

## Verified against

Everything above was read out of the engine's source and checked against the
live API on 2026-09-08 — the error codes against `shared/codes.go` and the
handlers in `internal/http/`, the fee arithmetic against
`internal/builder/fees.go` and the aggregator program, the anonymous limit
against `internal/config/config.go` (`ANON_RATE_LIMIT_RPS`/`_BURST`, 2/20).

Some published prose still carries older numbers — an anonymous tier of 1 rps /
burst 5, and a 20 bps protocol fee. The API is the authority; read
`platformFeeBps` off a build rather than trusting any document, this one
included.
