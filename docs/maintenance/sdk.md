# @vulcx/sdk — maintenance map

Thin TypeScript client for the Vulcx route-engine HTTP API. Four source files, 652 lines,
**zero runtime dependencies** — it uses the platform `fetch`, `AbortController` and
`setTimeout` and nothing else. Node ≥ 18, browsers, and any runtime with `fetch`.

Published as `@vulcx/sdk`, currently `0.7.1`.

Line references are against `cleanup` as of 2026-09-23. **route-engine is the source of
truth for this API**; everything here mirrors it and every claim below was checked against
`route-engine/internal/http/` and `internal/domain/` this pass.

---

## 1. Layout

| File | Lines | Role |
|---|---|---|
| `src/index.ts` | 27 | The public surface. Nothing is public unless it is re-exported here. |
| `src/client.ts` | 168 | `VulcxSDK` — three methods and one private `request()`. |
| `src/types.ts` | 381 | Request/response interfaces. Mostly doc comments; the types themselves are small. |
| `src/errors.ts` | 76 | `VulcxError` + seven subclasses. |
| `examples/` | — | Three runnable programs plus the curl cookbook. Type-checked in CI-equivalent (`npm run typecheck`). |
| `dist/` | — | **Committed build output.** See §5. |

`src/types.ts` is 60% documentation by volume, and deliberately so: several fields are
counter-intuitive enough that an integrator reading only the field name gets it wrong
(`feeAmount`'s denomination, `splitPercents`' encoding, `isSplitRoute`'s omission). Those
comments are the SDK's real product. Preserve them when editing.

---

## 2. Public API surface

Everything reachable by a consumer, and nothing else:

**Value exports** (`src/index.ts:1,18-27`)
`VulcxSDK` · `VulcxError` · `RateLimitError` · `NoRouteError` · `BadRequestError` ·
`AuthError` · `ServerError` · `QuoteExpiredError` · `QuoteStaleError`

**Type exports** (`src/index.ts:2-17`)
`APIErrorBody` · `SDKConfig` · `SwapMode` · `PriceImpactSeverity` · `QuoteRequest` ·
`QuoteResponse` · `RouteInfo` · `SwapRequest` · `SwapResponse` · `SimulationResult` ·
`InstructionsRequest` · `InstructionsResponse` · `RawInstruction` · `RawAccountMeta`

> **`RouteHopInfo` is defined (`src/types.ts:37-43`) and used by `RouteInfo.hops`
> (`:65`), but is not exported.** A consumer can reach the values, and TypeScript will
> infer them, but cannot *name* the type — `function render(hop: RouteHopInfo)` does not
> compile against the package. See `sdk-debt.md` S3.

### `new VulcxSDK(config?)` — `src/client.ts:35-40`

| Option | Default | Notes |
|---|---|---|
| `apiKey` | — | Optional. Sent as `Authorization: Bearer …` only when present (`:79-81`). |
| `baseUrl` | `https://api.vulcx.xyz` | Trailing slashes stripped (`:37`). |
| `timeout` | `30_000` ms | **Per attempt**, not per call. |
| `retries` | `2` | Retry *count*, so up to 3 attempts total. |

The key is optional by design, not by accident (`src/client.ts:31-34`): keyless callers are
served anonymously at a small per-IP budget. This matches `route-engine`'s
`ANON_ACCESS_ENABLED` model. `/api/v1/stream` is the one endpoint that always requires a
key — and the SDK does not implement it at all.

### Methods

| Method | Wire call | Lines |
|---|---|---|
| `quote(params)` | `GET /api/v1/quote?…` | `client.ts:42-53` |
| `swap(params)` | `POST /api/v1/swap` | `client.ts:55-57` |
| `instructions(params)` | `POST /api/v1/instructions` | `client.ts:59-67` |

`quote()` is the only one that builds a query string by hand (`:43-51`) — the POST methods
pass the params object straight through as the JSON body.

---

## 3. Mapping to route-engine

Verified field-by-field this pass against the handler structs, which are the wire contract
(the `internal/domain` types are *not* — `/swap` serialises `SwapHandlerResponse`, not
`domain.SwapResponse`, and they differ).

| SDK type | route-engine struct |
|---|---|
| `QuoteRequest` | `QuoteRequest` — `internal/http/quote_handler.go:44-68` (`form:` tags) |
| `QuoteResponse` | `QuoteResponse` — `internal/http/quote_handler.go:117-237` |
| `RouteInfo` / `RouteHopInfo` | `RouteInfo` / `RouteHopInfo` — `quote_handler.go:93-114` / `:72-84` |
| `SwapRequest` | `SwapHandlerRequest` — `internal/http/swap_handler.go:49-100` |
| `SwapResponse` | `SwapHandlerResponse` — `internal/http/swap_handler.go:103-190` |
| `SimulationResult` | `domain.SimulationResult` — `internal/domain/swap.go:259-273` |
| `InstructionsRequest` | `InstructionsRequest` — `internal/http/instructions_handler.go:39-82` |
| `InstructionsResponse` | `InstructionsResponse` — `internal/http/instructions_handler.go:86-155` |
| `APIErrorBody` | `httputil.Response` — `platform/httputil/response.go:9-17` |

**Request coverage is complete.** `QuoteRequest`'s five fields are exactly the server's five
`form:` params. `SwapRequest`'s eleven fields are exactly `SwapHandlerRequest`'s eleven.
`InstructionsRequest`'s eleven match too, including `sessionAccount`.

**Response coverage is complete too** — I diffed every JSON tag on all four response
structs against the SDK interfaces and **no field the server sends is missing**:
`QuoteResponse` 22/22, `SwapResponse` 20/20, `InstructionsResponse` 16/16,
`SimulationResult` 8/8.

What *has* drifted is narrower: one optional/required marker disagrees with the Go
`omitempty`, and `APIErrorBody` does not describe the error body the server actually sends.
See `sdk-debt.md` S1.

### Endpoints route-engine serves that the SDK does not wrap

`GET /api/v1/price` · `GET /api/v1/price/:mint` · `GET /api/v1/pools/stats` ·
`GET /api/v1/pools/list` · `GET /api/v1/pools/:address` · `GET /api/v1/tokens` ·
`POST /api/v1/cpi/route-accounts` · `GET /api/v1/stream` (WebSocket)

`/tokens` is the notable one: the portal fetches it directly
(`dashboard/lib/tokens.ts:23`) because the SDK has no binding, and any integrator
rendering a symbol next to an amount needs the same thing.

### The response envelope

route-engine wraps every 200 in `{success, data}` (`platform/httputil/response.go:19-24`).
`client.ts:106-120` unwraps it, and falls through to the raw body when `success` is absent,
so a future unwrapped endpoint would still work. Error bodies carry
`{success:false, error, code}` and `code` is the stable contract — see
`platform/httputil/codes.go`, which is explicit that `error` is prose and may be reworded at
any time.

`VulcxError.code` (`src/errors.ts:13,22-23`) lifts that code off the body. **This is the
field to branch on**, and `errors.ts:2-12` says so at length.

### Status → error class

`client.ts:127-150`:

| Status | Class | Retried? |
|---|---|---|
| 400 | `BadRequestError` | no |
| 401, 403 | `AuthError` | no |
| 404 | `NoRouteError` | no |
| 409 | `QuoteStaleError` | no |
| 410 | `QuoteExpiredError` | no |
| 429 | `RateLimitError` | **yes** |
| ≥ 500 | `ServerError` | **yes** |
| other 4xx | `VulcxError` | no |
| transport / abort | native error | **yes** |

A 200 whose envelope says `success:false` becomes a plain `VulcxError` with the HTTP status
(`client.ts:116`).

> Two of these names are narrower than what they catch. **`NoRouteError` is thrown for
> every 404**, and route-engine distinguishes `NO_POOL`, `POOL_DATA_MISSING`, `NO_ROUTE`
> and `NO_ROUTE_CONSTRAINED` behind that one status (`platform/httputil/codes.go`). **`AuthError`
> covers 403**, which includes `QUOTE_WRONG_KEY`, `ORIGIN_NOT_ALLOWED` and
> `STREAM_NOT_IN_PLAN` — none of which is "invalid or missing API key", the message the
> class hard-codes (`errors.ts:50`). Read `.code` when the distinction matters.

### Retry loop

`client.ts:88-162`. Backoff is `min(1000 * 2^(attempt-1), 8000)` ms (`:90`), applied
*before* attempts 2 and 3. A fresh `AbortController` and timer per attempt (`:94-95`).

**The README is right that this is incompatible with firm quotes** (`README.md`, "Firm
quotes" section): `firmForMs` is ~400 ms and the first backoff alone is 1000 ms, so a firm
redemption that hits one transient 429 is guaranteed to land outside its window. `retries`
is a client-level option, so firm flows need a second instance with `retries: 0`. That is
documented and is the right call — just know it before you "fix" the backoff.

POSTs are retried too. `/swap` and `/instructions` are builds, not submissions, so a
duplicate build costs latency and rate-limit budget but nothing on chain.

---

## 4. Firm quotes — the contract worth understanding

The one piece of real protocol logic the SDK mediates.

1. `quote()` returns `quoteId`, `validForMs` (~3 s) and `firmForMs` (~400 ms)
   (`types.ts:122-136`). `quoteId` is **absent** when the quote cannot be pinned — split
   routes, per `:126`.
2. Passing `quoteId` to `swap()`/`instructions()` replays *that* route and anchors min-out
   to *that* price.
3. Adding `firm: true` collapses slippage to the server's firm margin: price-or-fail. If
   the market moved past it you get 409 **before** a transaction is built
   (`types.ts:181-188`).
4. Both windows are measured from when the quote was **minted**, not from when you send it.
   A wallet popup outlives them.

410 → `QuoteExpiredError` (past `validForMs`). 409 → `QuoteStaleError`, which route-engine
uses for **two** distinct causes — `QUOTE_STALE` (a pinned route drifted past its firm
margin) and `SIM_SLIPPAGE` (the build's own simulation failed on slippage). Same recovery:
re-quote.

The server simulates before returning, and **a failed simulation is an error, not a 200 you
inspect** (`route-engine/internal/http/swap_handler.go:31-39`). The `SimulationResult` rides
along on the thrown error's `body.data.simulation` — the handler deliberately puts it where
a successful response puts it, so a caller that already reads that field keeps working.

---

## 5. Build, versioning and publishing

```bash
npm run build        # rollup -c  → dist/
npm run typecheck    # tsc --noEmit  &&  tsc --noEmit -p examples/tsconfig.json
npm run dev          # rollup -c -w
```

`rollup.config.js` produces two passes:

1. `src/index.ts` → `dist/index.cjs` (CJS), `dist/index.esm.js` (ESM),
   `dist/index.umd.js` (UMD, global `VulcxSDK`), all with sourcemaps, via
   `@rollup/plugin-typescript`. That plugin also honours `tsconfig`'s
   `declaration: true` + `declarationDir: "dist"`, which is why `dist/client.d.ts`,
   `dist/errors.d.ts` and `dist/types.d.ts` appear — they are build output, not strays,
   even though `package.json` points `types` at the bundled `dist/index.d.ts`.
2. `src/index.ts` → `dist/index.d.ts` via `rollup-plugin-dts` — one flat declaration file.

**`.cjs`, not `.cjs.js`**, and the config says why (`rollup.config.js:8-10`):
`"type": "module"` makes Node treat every `.js` as ESM, which broke
`require("@vulcx/sdk")` with "exports is not defined".

### Examples are part of the type gate

`examples/tsconfig.json` maps `@vulcx/sdk` → `../src/index.ts` via `paths`, so
`npm run typecheck` fails if a type change breaks an example. It is standalone rather than
extending the root tsconfig because that one sets `declarationDir`, which tsc rejects
alongside `declaration: false`.

**This is the closest thing the repo has to a test suite.** There is no test runner, no
`.github/` and no CI.

### Versioning

Consumers pin by semver from npm. `package.json:3` is the only version record: **there are
no git tags** and no `CHANGELOG.md`. Version history lives in commit subjects
(`0.7.0`, `0.6.0`, `0.5.1`, `0.4.0`, `v0.3.0`) and the `feat!:`/`fix!:` prefixes on the two
breaking commits.

`dist/` is **committed**. I verified it is reproducible: `npm run build` on a clean tree
leaves `git status` empty, and deleting the per-module `.d.ts` files and rebuilding restores
them byte-identically. So the tree is self-consistent today — but nothing enforces that, and
there is no `prepublishOnly`, so `npm publish` ships whatever `dist/` happens to contain.
See `sdk-debt.md` S2.

### What breaks consumers

Ranked by how quietly it breaks them.

| Change | Effect | Precedent |
|---|---|---|
| Renaming or removing an export from `src/index.ts` | compile error | — |
| Making an optional response field **required** | compile error on object construction; fine for readers | — |
| Making a required response field **optional** | compile error at every read site under `strict` | `25b0341` |
| Changing a field's **type** | compile error, or silent misbehaviour | `25b0341` — `splitPercents` was typed `number[]`; it is a base64 **string**, so `.map()` walked the characters |
| Adding a **required** field to a request interface | compile error for every caller | — |
| Changing which error class a status maps to | silently changes which `catch` branch fires | — |
| Changing retry/backoff defaults | silently breaks firm-quote flows | — |
| Adding an optional field, or a new export | safe | `f2d9d89`, `8400009` |
| Editing a doc comment | safe | — |

The `splitPercents` episode is the one to remember: **a wrong type is worse than a missing
one.** A missing field makes the compiler complain; a wrong field compiles and produces
nonsense at runtime.

Two `!`-marked commits exist — `ce27d92` (`feat!: make apiKey optional and stop sending
Authorization`) and `d3e4920` (`fix!: send Authorization when an apiKey is given, keep it
optional`) — the second reverting the auth half of the first. Both are in `0.5.x` territory.

---

## 6. Things that will surprise you

- **`timeout` is per attempt.** With defaults, a call to a dead host takes up to
  `3 × 30s + 1s + 2s = 93s` before it throws.
- **`quote()` silently ignores unknown params.** It reads exactly five fields
  (`client.ts:43-51`); anything else on the object is dropped rather than rejected. That is
  correct today — the server accepts exactly those five — but it means adding a server-side
  query param requires editing `client.ts`, not just `types.ts`.
- **`swap()` and `instructions()` do the opposite**: the whole object is `JSON.stringify`d
  (`client.ts:100`), so an unknown field is sent and the server's binder decides. Adding an
  optional request field to those two needs only a `types.ts` edit.
- **`integratorFeeBps: 0` is meaningful.** The server takes `*uint16`
  (`swap_handler.go:86`): omitting it uses the API key's portal default, while an explicit
  `0` turns that default off for the request. `undefined` and `0` are different requests.
- **`referrer` on its own earns nothing** (`types.ts:189-197`). There is no automatic
  referral share; a referrer without `integratorFeeBps` is a wallet nobody pays.
- **`feeAmount` is input-denominated**, unlike `platformFeeAmount` and
  `integratorFeeAmount` which are output-denominated (`types.ts:231-244`). Subtracting it
  from `amountOut` is the classic integration bug and the comment carries the measured
  numbers showing it is 425× the entire output for 1 FOGO → USDC.
- **`amountIn` can come back smaller than what you asked for** (`types.ts:71-76`) — a
  partial fill on a size the pools cannot absorb. Compare the two before building.
- **`dataAgeMs` is the staleness signal and it is easy to ignore.** `types.ts:150-164`
  explains why it matters: the engine's internal staleness penalty scales with price
  impact, so a low-impact trade off a frozen feed is penalised by exactly zero and the
  response is otherwise identical to a fresh one.
