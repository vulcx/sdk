# quote → build → sign → submit → confirm (Node)

The whole path in one file, for a server that holds its own key: a bot, a
keeper, a backend that swaps on a user's behalf. For the browser shape — wallet
signs, page submits — see [`../browser-wallet`](../browser-wallet).

**It does not broadcast unless you pass `--send`.** The default is a dry run
that stops after the build, which is enough to verify the integration without
spending anything.

## Run it

```bash
npm install @vulcx/sdk @solana/web3.js
npx tsx swap.ts
```

That is the whole setup — no API key, no wallet, no RPC endpoint of your own.
Keyless requests are served on the anonymous per-IP tier (2 rps, burst 20; a
`/swap` build costs 5 of those units), which is plenty for one run.

To actually swap:

```bash
export SOLANA_KEYPAIR=~/.config/solana/id.json
npx tsx swap.ts --send
```

## Environment

| Variable | Required | What it does |
|---|---|---|
| `VULCX_API_KEY` | no | Raises you off the anonymous tier. Issued by hand during beta — ask on [Telegram](https://t.me/vulcxsupport). |
| `FOGO_RPC_URL` | no | Defaults to `https://mainnet.fogo.io`. |
| `SOLANA_KEYPAIR` | only for `--send` | Path to a `solana-keygen` JSON file. Read at signing time and nowhere else. |

No secret is ever written into the source. If you find yourself pasting a key
into a file, stop — every path in this example takes a *path* or a *public*
address.

## What to take from it

- **A key is optional.** `new VulcxSDK()` works. The key raises the rate limit;
  only `/api/v1/stream` (the WebSocket) hard-requires one.
- **`quoteId` is not used here, on purpose.** It is redeemable for `validForMs`
  (3s today) measured from when the quote was *minted*. A server-side tick can
  make that window; a flow with a human in it cannot. Without a `quoteId` the
  server re-routes at build time under your `slippageBps`.
- **A failing simulation is an error, not a 200.** The server simulates before
  it returns, so reaching the line after `swap()` means the transaction passed.
  You never hand a user a transaction that can only revert.
- **`amountOut` is gross.** Both fees come out of it on chain. What the user
  receives is `amountOut − platformFeeAmount − integratorFeeAmount`.
- **`amountIn` is what the route consumed**, not necessarily what you asked
  for. A concentrated-liquidity route that runs out of reachable ticks fills
  what it can. Compare the two.
- **Check `dataAgeMs`.** Pool state is held in memory off a stream that does
  not backfill after a reconnect, so a frozen feed prices off stale reserves and
  the response looks identical to a fresh one apart from this number.
- **Branch on `err.code`, not on `err.message`.** The code is a stable
  contract; the message is prose the server may reword. The full table is in
  [the cookbook](../README.md#error-codes).
- **Confirmation is polled by hand.** The build hands back
  `lastValidBlockHeight` but not the blockhash, and that height is the honest
  deadline — past it the transaction can no longer land.
