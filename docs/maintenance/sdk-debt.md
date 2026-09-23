# @vulcx/sdk — verified debt inventory

Every item was read in the source. Line numbers are against the `cleanup` branch **after**
the cleanup commit on it (2026-09-23). Drift claims were checked against
`route-engine/internal/http/`, `route-engine/internal/domain/` and `platform/httputil/`
(read-only).

Ranked by **risk × churn**. Churn in this repo is concentrated in `src/types.ts` (it is
edited every time route-engine adds a field) and `package.json` (every release), so
correctness problems there rank above equally-bad problems in `src/errors.ts`, which has not
changed since `881f09b`.

Effort: **S** ≈ under an hour · **M** ≈ half a day · **L** ≈ multi-day.

---

## Ranked summary

| # | Where | Problem | Risk | Effort |
|---|---|---|---|---|
| S1 | `package.json:12-18` | `"types"` is last in the `exports` conditions — TypeScript requires it first | **High** | S |
| S2 | `package.json:20-26` | `dist/` is committed and there is no `prepublishOnly` — `npm publish` can ship stale output | **High** | S |
| S3 | `client.ts:94-104` | `clearTimeout` is not in a `finally`; a thrown `fetch` leaks a 30 s timer | Med-High | S |
| S4 | repo root | No tests, no CI. `npm run typecheck` is the entire gate | Med-High | M |
| S5 | `types.ts:370` | `InstructionsResponse.dataAgeMs` is optional; the server always sends it | Med | S |
| S6 | `types.ts:373-381` | `APIErrorBody` does not describe the body the server actually sends | Med | S |
| S7 | `errors.ts:34-53` | `NoRouteError` for every 404, `AuthError` for every 403 — both narrower than what they catch | Med | M |
| S8 | `index.ts:2-17` | `RouteHopInfo` is reachable in values but not exported as a type | Med | S |
| S9 | `client.ts:42-51` | `quote()` enumerates params by hand and silently drops anything else | Med | S |
| S10 | repo root | No `CHANGELOG.md` and **no git tags** — release history is commit subjects | Med | S |
| S11 | `client.ts:88-162` | POSTs are retried on 429/5xx with no idempotency signal | Low-Med | M |
| S12 | `errors.ts:29,36,50,65,73` | Error messages hard-coded, discarding the server's `error` prose | Low-Med | S |
| S13 | `client.ts:123-125` | Error body cast to `Record<string, string>` when it is not one | Low | S |
| S14 | `tsconfig.json` | `declaration`/`declarationDir` emit three `.d.ts` files nothing references | Low | S |

---

## S1 — `exports.types` is in the wrong position · High · S

**`package.json:12-18`**

```json
"exports": {
  ".": {
    "import": "./dist/index.esm.js",
    "require": "./dist/index.cjs",
    "types": "./dist/index.d.ts"
  }
}
```

Export conditions are matched **in declaration order**, and `"types"` must come **first** or
TypeScript resolves `"import"`/`"require"` before it ever considers it. Under
`moduleResolution: "node16"`, `"nodenext"` or `"bundler"` — which is what a current
consumer project uses — this is the documented cause of *"Could not find a declaration file
for module '@vulcx/sdk'"*.

It is masked today by the top-level `"types": "dist/index.d.ts"` (`package.json:9`), which
older resolvers fall back to. Consumers on `node16`/`nodenext` do not get that fallback once
`exports` is present.

**Fix (S):**

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.esm.js",
    "require": "./dist/index.cjs"
  }
}
```

Not applied in the cleanup commit: it changes module resolution behaviour, which is outside
"no behaviour change", and it deserves a release of its own.

---

## S2 — publishing has no gate · High · S

Two halves of one problem.

**`dist/` is committed** (10 files, `git ls-files dist`). I verified it is currently
reproducible — `npm run build` on a clean tree leaves `git status` empty, and deleting the
per-module `.d.ts` files and rebuilding restores them byte-identically. So the tree is
honest *today*.

**Nothing keeps it honest.** `package.json:20-26` has `"files": ["dist"]` and no
`prepublishOnly`, no `prepack`, no `version` hook. `npm publish` tars up whatever `dist/`
happens to contain on that machine at that moment. Combined with the committed `dist/`, the
failure mode is specific and quiet: edit `src/`, commit without building, publish — and the
package ships the *previous* version's code under the new version number. Nothing in the
repo or in npm would show it.

There is also no CI, so no machine ever checks that `dist/` matches `src/`.

**Fix (S):** add

```json
"prepublishOnly": "npm run typecheck && npm run build"
```

and, in CI, run `npm run build && git diff --exit-code dist/` so a stale committed `dist/`
fails the branch. (Alternatively, stop committing `dist/` — but it is presumably committed so
the UMD build is reachable from a raw GitHub URL, so check before removing it.)

---

## S3 — the abort timer leaks on a thrown fetch · Med-High · S

**`client.ts:94-104`**

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), this.timeout);

const res = await fetch(url, { …, signal: controller.signal });

clearTimeout(timer);
```

`clearTimeout` only runs when `fetch` **resolves**. If it rejects — DNS failure, connection
refused, TLS error, or the abort firing — the line is skipped and the timer stays armed for
the remainder of `timeout`. Same for the `await res.json()` calls below it (`:107`, `:123`),
which can throw on a truncated body.

In a browser this is invisible. **In Node it keeps the event loop alive**: a script that
catches the error and finishes still hangs for up to 30 s before exiting, because a pending
`setTimeout` is a ref'd handle. With the default `retries: 2` a fully-failing call arms three
of them. This is the kind of thing that gets reported as "the SDK makes my CLI hang" rather
than as a timer leak.

**Fix (S):**

```ts
try {
  const res = await fetch(…);
  …
} finally {
  clearTimeout(timer);
}
```

Not applied in the cleanup commit — it is a behaviour fix, not cleanup. It is the one item
here I would ship first.

---

## S4 — no tests, no CI · Med-High · M

No test runner in `package.json`, no `.github/`. The quality gate is `npm run typecheck`
(which does type-check the examples against `src/` via the `paths` mapping in
`examples/tsconfig.json` — genuinely useful) and `npm run build`, both run by hand.

Nothing exercises the logic that actually has branches:

- the `{success, data}` unwrap and its fall-through (`client.ts:106-120`);
- the status → error-class table (`client.ts:127-150`) — 9 branches, 0 covered;
- the retry/backoff loop and which errors escape it (`client.ts:88-162`);
- `VulcxError.code` extraction from a body that may be anything (`errors.ts:22-23`).

All of it is pure and fetch-injectable via `globalThis.fetch`, so `node --test` with a stub
covers the lot in well under a day.

The stakes are set by history: **`25b0341` and `8400009` were both type-drift bugs that
shipped** — `splitPercents` typed as `number[]` when it is a base64 string, and three fields
the server sends missing entirely. A contract test that asserts the SDK interfaces against a
captured route-engine response would have caught both.

---

## S5 — `InstructionsResponse.dataAgeMs` is optional; the server always sends it · Med · S

**`src/types.ts:369-370`**

```ts
/** How old that pool state was when the route was priced, in milliseconds. */
dataAgeMs?: number;
```

The server field has **no** `omitempty`:

```go
DataAgeMs   int64  `json:"dataAgeMs" example:"120"`
```
— `route-engine/internal/http/instructions_handler.go:154`

So it is always present, exactly as on `QuoteResponse` (`types.ts:164`, required) and
`SwapResponse` (`types.ts:278`, required). Only the instructions variant is marked optional,
and its doc comment is also the thin one — it omits the "check it, a build off a frozen feed
is byte-shaped like a live one" warning that the other two carry (`types.ts:150-163`,
`:269-277`).

The practical cost: a `/instructions` integrator writing `if (res.dataAgeMs && …)` under
`strictNullChecks` is nudged into treating the freshness signal as optional — on the one
endpoint where it matters most, because `/instructions` has no server-side simulation to
catch a stale build.

**This is a breaking type change** (required → readers stop needing a guard is fine;
optional → required breaks anyone constructing the object in a test double). Batch it with
S6 into one minor release, and copy the `QuoteResponse` warning across while you are there.

---

## S6 — `APIErrorBody` does not describe the error body · Med · S

**`src/types.ts:373-381`**

```ts
export interface APIErrorBody {
  error: string;
  code?: string;
}
```

The real body is `httputil.Response` (`platform/httputil/response.go:9-17`):

```go
type Response struct {
    Success bool        `json:"success"`
    Data    interface{} `json:"data,omitempty"`
    Error   string      `json:"error,omitempty"`
    Code    string      `json:"code,omitempty"`
}
```

Two omissions, one of which matters a lot:

- **`data` is missing.** On a rejected build, route-engine attaches the `SimulationResult`
  at `data.simulation` — deliberately, so a caller that already reads that field on success
  keeps working (`route-engine/internal/http/swap_handler.go:31-39`, `swapSimulationFailure`).
  The README tells integrators the simulation "rides along on the thrown error's body", and
  `APIErrorBody` gives them no type for it. They end up casting `err.body as any`.
- `success: false` is missing, which is cosmetic.

`VulcxError.body` is typed `unknown` (`errors.ts:18`), so `APIErrorBody` is the only thing
that could describe it, and it is never actually used as the type of anything — it is
exported for consumers to cast to.

**Fix (S):** add `success?: boolean` and
`data?: { simulation?: SimulationResult } & Record<string, unknown>`. Both optional, so it is
additive and non-breaking.

---

## S7 — two error classes are narrower than the statuses they catch · Med · M

**`client.ts:128-134`** maps 403 → `AuthError` and 404 → `NoRouteError`.

`platform/httputil/codes.go` documents exactly why those statuses are overloaded, and its
header comment is worth reading — it says the codes exist *because* "404 means 'no pool',
'no route' **and** the deliberately-disguised admin gate".

- **404** covers `NO_POOL`, `POOL_DATA_MISSING`, `NO_ROUTE`, `NO_ROUTE_CONSTRAINED`. The SDK
  calls all four `NoRouteError` with the fixed message `"No route found"`
  (`errors.ts:36`). `POOL_DATA_MISSING` in particular is *not* "no route" — it means pools
  exist but their state is not loaded, i.e. retry later, which is the opposite advice.
- **403** covers `QUOTE_WRONG_KEY`, `ORIGIN_NOT_ALLOWED`, `ORIGIN_REQUIRED`,
  `STREAM_NOT_IN_PLAN`. The SDK calls all of them `AuthError` with
  `"Invalid or missing API key"` (`errors.ts:50`) — which is wrong for every one of them.
  An integrator whose origin-locked key is being sent from the wrong origin is told their
  key is invalid and goes looking in the wrong place.

The information is not lost — `.code` carries it (`errors.ts:13`) — but the class name and
message actively mislead, and the class name is what people branch on first.

**Fix (M):** keep the classes (removing one would break consumers) and make the messages
honest: use the server's `error` prose instead of the hard-coded sentence (see S12). Longer
term, consider `PoolDataMissingError extends NoRouteError` and
`OriginNotAllowedError extends AuthError` — subclassing is additive, so existing
`instanceof NoRouteError` checks keep matching.

---

## S8 — `RouteHopInfo` cannot be named · Med · S

`src/types.ts:37-43` defines it, `RouteInfo.hops?: RouteHopInfo[]` (`:65`) uses it, and
`src/index.ts` does not export it.

A consumer can read `quote.routes[0].hops?.[0].poolType` fine — inference works — but cannot
write `function renderHop(hop: RouteHopInfo)`, extract it to a variable with an annotation,
or use it in a React prop type. They have to write
`NonNullable<RouteInfo["hops"]>[number]`, which is exactly the kind of thing that makes an
SDK feel unfinished.

Multi-hop split legs are not exotic — `RouteInfo`'s own comment (`:45-52`) explains that a
leg reporting `hops` is the case where `poolAddress`/`poolType` describe only the first hop,
so anyone rendering a route path correctly **must** handle it.

**Fix (S):** add `RouteHopInfo` to the type export list. Purely additive. Not done in the
cleanup commit because it widens the public API, which was out of scope for that pass — but
it is a one-line, zero-risk change.

---

## S9 — `quote()` drops unknown params silently · Med · S

**`client.ts:43-51`** enumerates five fields into a `URLSearchParams` and ignores everything
else on the object.

That is correct today: `QuoteRequest` has exactly five fields and so does the server's
binding struct (`route-engine/internal/http/quote_handler.go:44-68`). But it creates an
asymmetry that is not written down anywhere:

- **`swap()` / `instructions()`** `JSON.stringify` the whole object (`client.ts:100`), so
  adding an optional request field is a `types.ts`-only change.
- **`quote()`** needs `client.ts` edited too, and if you forget, TypeScript is perfectly
  happy — the field exists on the interface, the caller sets it, and it is dropped in
  transit. You get a silently unparameterised quote.

Given how often `types.ts` changes to track the server, this will eventually catch someone.

**Fix (S):** build the query from the object generically —
`Object.entries(params).filter(([,v]) => v !== undefined)` — so a new optional field works
without touching `client.ts`. Same shape as the POST path.

---

## S10 — no changelog, no tags · Med · S

`package.json:3` is the only record that this is `0.7.1`. `git tag` is **empty**, and there
is no `CHANGELOG.md`. Release history exists only as commit subjects — `0.7.0`, `0.6.0`,
`0.5.1`, `0.4.0`, `v0.3.0` — with two `!`-marked breaking commits (`ce27d92`, `d3e4920`, the
second reverting the auth half of the first).

For a package whose whole job is to be a stable contract, "what changed in 0.7.0" is
currently answerable only by reading `git log` and guessing where the boundaries are. An
integrator pinning `^0.7.0` has nothing to read.

**Fix (S):** `CHANGELOG.md` reconstructed from the version commits (they are descriptive
enough), then tag retroactively: `git tag v0.7.1 <sha>` for each. Cheap now, impossible
later.

---

## S11 — POSTs are retried with no idempotency signal · Low-Med · M

`client.ts:88-162` retries 429 and ≥500 for **all three** methods, including
`POST /api/v1/swap` and `POST /api/v1/instructions`.

Today this is benign: both endpoints *build* a transaction, they do not submit one, so a
duplicate build costs latency and rate-limit budget and nothing else. Worth stating
explicitly because it is not obvious from the code, and because the cost is real — a
`/swap` build is 5 cost units (`platform/edge/cost.go:24`), so three attempts spend 15 of a
free plan's 20 units/second.

It becomes a correctness problem the moment any POST gains a side effect. There is no
`Idempotency-Key` header and no per-method retry policy.

**Fix (M):** make the retry policy per-method (`GET` retried by default, `POST` opt-in), or
add an idempotency key. Either way, document it — the README already documents the
firm-quote interaction, which is the sharper edge of the same setting.

---

## S12 — hard-coded error messages discard the server's prose · Low-Med · S

`RateLimitError` (`errors.ts:29`), `NoRouteError` (`:36`), `AuthError` (`:50`),
`QuoteExpiredError` (`:65`) and `QuoteStaleError` (`:73`) all call `super()` with a fixed
string and pass the body separately. The server's `error` field — the sentence written for a
human, which `platform/httputil/codes.go` is careful to keep improvable — is available at
`client.ts:124` as `errMsg` and is **thrown away** for these five.

`BadRequestError` and `ServerError` do the opposite and pass `errMsg` through
(`client.ts:132`, `:146`), so the behaviour is inconsistent between classes.

The practical effect: a developer who logs `err.message` sees "No route found" where the
server said something specific like "pools exist but their state is not loaded". They then
have to know to look at `err.body` — which is typed `unknown` (S6).

**Fix (S):** pass `errMsg` as the message and keep the current string as the fallback when
the body has none. Changes what `err.message` prints, so it is a behaviour change — but
`message` is explicitly not a contract (`errors.ts:5-6`).

---

## S13 — the error body is cast to a type it is not · Low · S

**`client.ts:123-125`**

```ts
const errBody = await res.json().catch(() => ({}));
const errMsg = (errBody as Record<string, string>)?.error ?? res.statusText;
```

`errBody` is `httputil.Response`, whose `data` is an arbitrary object and whose `success` is
a boolean — it is not `Record<string, string>`. The cast happens to work because only
`.error` is read and that one *is* a string, but it is a lie that will mislead the next
person to add a field read here (`.code` is read safely elsewhere, in `errors.ts:22-23`,
with a proper `typeof` guard — that is the pattern to copy).

`res.statusText` is also empty string on HTTP/2, where it does not exist, so a 500 with no
JSON body produces `new ServerError("")`.

**Fix (S):** type it as `Partial<APIErrorBody>` once S6 lands, and fall back to
`` `HTTP ${res.status}` `` rather than `statusText`.

---

## S14 — three `.d.ts` files nothing references · Low · S

`tsconfig.json:9-10` sets `declaration: true` + `declarationDir: "dist"`, which makes
`@rollup/plugin-typescript` emit `dist/client.d.ts`, `dist/errors.d.ts` and
`dist/types.d.ts` alongside the bundled `dist/index.d.ts` that `rollup-plugin-dts` produces
and that `package.json` actually points at.

They are build output, not strays — deleting and rebuilding restores them — but nothing
consumes them, they are committed, and they are a second set of declarations that can
disagree with the bundled one. They also make the published tarball bigger for no benefit.

**Fix (S):** `declaration: false` in the root tsconfig (the `dts` pass does not need it),
then delete the three files. Verify `npm run build` still produces `dist/index.d.ts` before
committing — `rollup-plugin-dts` reads source, not emitted declarations, so it should.

---

## Cross-repo drift found (SDK side)

Checked against `route-engine` and `platform` read-only.

| Area | Result |
|---|---|
| `QuoteRequest` ↔ `quote_handler.go:44-68` | **No drift.** 5/5 fields, same names, same optionality. |
| `SwapRequest` ↔ `swap_handler.go:49-100` | **No drift.** 11/11. `integratorFeeBps` is `*uint16` server-side, and the SDK's optional `number` correctly reproduces the "omit = use key default, explicit 0 = off" semantics. |
| `InstructionsRequest` ↔ `instructions_handler.go:39-82` | **No drift.** 11/11, including `sessionAccount`. |
| `QuoteResponse` ↔ `quote_handler.go:117-237` | **No drift.** 22/22. Every `omitempty` matches an `?`. `splitPercents` correctly typed as the base64 `string` (`[]uint8` marshals that way) — the `25b0341` fix holds. |
| `SwapResponse` ↔ `swap_handler.go:103-190` | **No drift.** 20/20. `isSplitRoute` is correctly **required** here: the handler struct has no `omitempty`, unlike `domain.MultiHopSwapResponse` which does. The SDK comment at `types.ts:282` calls this out and is right. |
| `InstructionsResponse` ↔ `instructions_handler.go:86-155` | **One mismatch** — `dataAgeMs` (S5). 15/16 otherwise exact. |
| `SimulationResult` ↔ `domain/swap.go:259-273` | **No drift.** 8/8. |
| `APIErrorBody` ↔ `httputil/response.go:9-17` | **Incomplete** — missing `data` and `success` (S6). |
| Error codes | The SDK does not enumerate them. `platform/httputil/codes.go` publishes 26; `VulcxError.code` passes them through untyped, which is deliberate (`errors.ts:7-8`: "New codes get added, so treat one you do not recognise as its HTTP status class"). |
| Venue naming | **Correct throughout.** Every `Vortex` in this repo is framed as the wire value with `Valiant` as the name (`types.ts:39`, `examples/README.md:121`, `examples/browser-wallet/README.md:62`, `examples/node-quote-to-swap/swap.ts:200`). No regression. Note that `route-engine/internal/http/instructions_handler.go:80` still says "Session routes are currently **Vortex**-V1-only" in a swagger description that becomes public docs — the SDK says Valiant (`types.ts:319`) and is the correct one. |
| Unwrapped endpoints | 8 endpoints route-engine serves have no SDK binding — see `sdk.md` §3. `/api/v1/tokens` is the one integrators visibly need. |

---

## Decisions needed

1. **Does `0.8.0` batch the breaking type fixes?** S5 (`dataAgeMs` optional → required) is
   technically breaking. S6, S8 and the S1 `exports` reorder are not. Doing S5 alone is a
   minor bump for a one-character change; batching it with S7's subclasses and S12's message
   change makes one coherent release. My recommendation: ship S1 + S3 as `0.7.2` (both are
   plain bugs), then batch the rest.

2. **Keep committing `dist/`?** It is reproducible today but unguarded (S2). Either add the
   CI check that keeps it honest, or stop committing it — but check first whether anything
   depends on fetching `dist/index.umd.js` from a raw GitHub URL, since the README advertises
   the unpkg path and someone may have pinned the repo instead.

3. **Should the SDK wrap `/api/v1/tokens`?** It needs no key and allows any origin, and every
   integrator rendering an amount needs symbols and decimals. The portal already
   reimplements the fetch plus a `formatTokenAmount` helper
   (`dashboard/lib/tokens.ts`). Adding `tokens()` is additive and small — but it is the
   first step toward the SDK being more than a thin wrapper, so it is a scope decision.

4. **How far to go on error subclassing (S7)?** Honest messages are cheap and clearly right.
   New subclasses for `POOL_DATA_MISSING` and `ORIGIN_NOT_ALLOWED` are additive and
   `instanceof`-compatible, but they commit the SDK to tracking route-engine's code list —
   which `errors.ts:7-8` deliberately declined to do. Pick one philosophy and write it down.
