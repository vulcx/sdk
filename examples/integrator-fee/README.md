# Charging your own fee

```bash
npm install @vulcx/sdk
npx tsx fee.ts

# with your own numbers
REFERRER_WALLET=<your base58 wallet> INTEGRATOR_FEE_BPS=30 npx tsx fee.ts
```

Nothing is signed or submitted. The example builds a transaction server-side,
reads the fee fields off the response and checks the arithmetic — which is the
whole of what you need to verify before shipping.

## The model, in one paragraph

Two rates ride on every swap. `platformFeeBps` is Vulcx's and Vulcx keeps it.
`integratorFeeBps` is yours, set per request, and **you keep it in full**. They
are **independent and they add**: yours is not a share of ours, ours does not
shrink when you raise yours, and the user pays the sum. Their sum is capped at
**100 bps**, enforced in the API and again on chain. Both are reported
separately on every `/swap`, `/instructions` and `/cpi/route-accounts` response,
because one blended number cannot tell you what you earned.

## What you actually set, and what you get

| | |
|---|---|
| You send | `integratorFeeBps` **and** `referrer` — both, together |
| Denominated in | basis points of the route's **gross** output |
| Paid in | the **output token**, not FOGO and not USD |
| Paid to | the `referrer` wallet's ATA for the output mint |
| ATA setup | none on `/swap` and `/instructions` — it is created idempotently inside the same transaction |
| Reported back | `integratorFeeBps` (echoed) and `integratorFeeAmount` |

`integratorFeeBps` without a `referrer` is a `400 FEE_NEEDS_REFERRER`. It is
never quietly redirected to Vulcx.

`referrer` without an `integratorFeeBps` earns nothing. There is no automatic
referral share — a referrer with no rate is just a wallet nobody pays.

## The arithmetic

For a route whose gross output is `amountOut`:

```
platformFeeAmount   = amountOut * platformFeeBps   / 10000   (truncated)
integratorFeeAmount = amountOut * integratorFeeBps / 10000   (truncated)
user receives       = amountOut - platformFeeAmount - integratorFeeAmount
```

Both rates apply to the **same** gross figure. Vulcx's is not taken first and
yours computed on the remainder.

A live build at 1 FOGO → USDC with `integratorFeeBps: 20`:

```
amountOut            7054        gross
platformFeeBps         15        Vulcx's current protocol rate
platformFeeAmount      10        7054 * 15 / 10000, truncated
integratorFeeBps       20        yours
integratorFeeAmount    14        7054 * 20 / 10000, truncated
user receives        7030
```

## The mistake that costs money

**Fees are spent out of your slippage budget.**

`minAmountOut` is derived from the **gross** output
(`amountOut * (10000 − slippageBps) / 10000`), but the program checks it against
the **net** output, after both fees have been transferred out. So:

```
total fee bps >= slippageBps   →   the transaction can never land
```

At 50 bps of slippage with 15 bps protocol + 20 bps integrator, you have 15 bps
of actual price headroom, not 50. Set your fee and your slippage together, or
you will ship an integration that reverts on every volatile pair and looks like
a routing bug.

## Do not hard-code the headroom

`platformFeeBps` is set by Vulcx and it moves — partner agreements lower it, and
the global rate is a live config value (15 bps at the time of writing, not the
20 bps in some older docs). Read it off a build and derive your ceiling from it:

```ts
const room = 100 - built.platformFeeBps;   // your maximum, today
```

Going over the cap is a `400 FEE_CAP_EXCEEDED` — a rejected request, not a
transaction that fails after your user has already signed it.

## If you are calling by CPI

`/cpi/route-accounts` takes the same `referrer` / `integratorFeeBps` pair, with
one difference that will cost you a transaction if you miss it: that builder
emits **no ATA-create instructions**. The referrer's ATA for the output mint
must already exist before the CPI runs. Create it once per output mint you
expect to earn in.

## One more thing to plan for

Your fee accrues in the **output token of each swap**. Across a mixed book that
means balances in every token your users buy, in ATAs owned by your referrer
wallet — not a single accounting currency. Sweeping that is your job, not the
aggregator's.
