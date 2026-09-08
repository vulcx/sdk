# Browser swap — the wallet signs, the page submits

No bundler, no dependencies, no build step. Two files.

```bash
npx serve .
# then open the printed URL and click Connect
```

Opening `index.html` from `file://` will not work: wallet extensions inject on
http(s) origins, and the API's CORS headers are origin-scoped. Serve it.

## The thing that matters

**No wallet advertises a Fogo chain.** Backpack, Brave, Solflare and Nightly all
report `solana:mainnet` / `devnet` / `testnet` / `localnet` and nothing else.
So:

- The page calls **`solana:signTransaction`** and passes **no `chain`**. The
  wallet is signing bytes, not choosing a network. There is no `fogo:mainnet`
  to pass and `solana:mainnet` would be a lie.
- The page then **submits the signed bytes itself**, over plain JSON-RPC, to
  `https://mainnet.fogo.io`.

Do not port a wallet-adapter `signAndSendTransaction` flow into this. It cannot
work — the wallet would broadcast to Solana, where the aggregator program does
not exist.

Wallet discovery is the Wallet Standard handshake directly: listen for
`wallet-standard:register-wallet`, then dispatch `wallet-standard:app-ready`.
Order matters — a wallet that registers before you are listening is invisible.
No adapter library is involved, and none is needed.

## API key

`API_KEY` at the top of `swap.js` is empty, so the page runs on the anonymous
per-IP tier: 2 rps, burst 20, and a `/swap` build costs 5 units. One build plus
a few quotes fits.

If you set a key: **it ships in page source and is world-readable.** Only ever
put an origin-locked key here — the edge enforces the allowlist on both the REST
chain and the `/stream` handshake, which is the only thing making a public key
safe. Keys are issued by hand during beta via
[t.me/vulcxsupport](https://t.me/vulcxsupport); there is no dashboard.

Keyless also means every visitor behind a shared egress IP contends for one
bucket. An origin-locked key is the real fix for a production page.

## Error handling

`apiFailure()` maps the API's stable `code` to something a user can act on.
Branch on `code`, never on the message — the message is prose the server may
reword. See [the cookbook](../README.md#error-codes).

On-chain failures are separate: `onChainFailure()` names slippage (aggregator
error codes 6006 / 6036) because it is both the most common cause and the only
one the user can do something about. Everything else stays generic — guessing at
an unknown program error is worse than admitting you do not know.

## Venue naming

`poolType` comes back as `"Vortex"` on the wire. Users read **Valiant**. The map
is at the top of the quote handler in `swap.js`; keep it in step if you add
venues.
