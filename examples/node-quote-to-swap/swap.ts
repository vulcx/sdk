/**
 * quote -> build -> sign -> submit -> confirm, the whole path, in one file.
 *
 * This is the Node/server shape: the process holds the key. For the browser
 * shape (wallet signs, page submits) see ../browser-wallet.
 *
 * It will NOT broadcast unless you pass --send. Without that flag it stops
 * after the build and prints what would have been signed, which is enough to
 * verify an integration end to end without spending anything.
 *
 *   npx tsx swap.ts                       # dry run, no key needed
 *   SOLANA_KEYPAIR=~/.config/solana/id.json npx tsx swap.ts --send
 *
 * Env:
 *   VULCX_API_KEY   optional. Without it you are on the anonymous per-IP tier
 *                   (2 rps, burst 20). A /swap build costs 5 of those units.
 *   FOGO_RPC_URL    defaults to https://mainnet.fogo.io
 *   SOLANA_KEYPAIR  path to a solana-keygen JSON file. Only read under --send.
 *                   Never paste a secret key into this file.
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  VulcxSDK,
  VulcxError,
  NoRouteError,
  RateLimitError,
  AuthError,
  BadRequestError,
  QuoteExpiredError,
  QuoteStaleError,
} from "@vulcx/sdk";

const FOGO = "So11111111111111111111111111111111111111112"; // Wrapped FOGO, 9 decimals
const USDC = "uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG"; // USDC on Fogo, 6 decimals

const AMOUNT_IN = "1000000000"; // 1 FOGO, in base units
const SLIPPAGE_BPS = 50; // 0.5%

const send = process.argv.includes("--send");
const haveKeypair = Boolean(process.env.SOLANA_KEYPAIR);
const rpcUrl = process.env.FOGO_RPC_URL ?? "https://mainnet.fogo.io";

// A key is optional. `new VulcxSDK()` works; the key only raises the rate
// limit. Only /api/v1/stream (the WebSocket) hard-requires one.
const vulcx = new VulcxSDK({ apiKey: process.env.VULCX_API_KEY });

async function main(): Promise<void> {
  // ---- 1. quote -----------------------------------------------------------
  const quote = await vulcx.quote({
    inputMint: FOGO,
    outputMint: USDC,
    amount: AMOUNT_IN,
    swapMode: "ExactIn",
    slippageBps: SLIPPAGE_BPS,
  });

  console.log(
    `quote: ${quote.amountIn} -> ${quote.amountOut} ` +
      `(${quote.hopCount} hop, impact ${quote.priceImpactPercent}, pool fee ${quote.feeBps} bps)`
  );
  console.log(`  venues: ${quote.routes.map((r) => venue(r.poolType)).join(" + ")}`);

  // dataAgeMs is how long ago any pool update reached the engine. The feed does
  // not backfill after a reconnect, so a frozen feed prices off stale reserves
  // and the response looks identical to a fresh one apart from this number.
  // Check it before you commit a user's money to the price.
  if (quote.dataAgeMs !== undefined && quote.dataAgeMs > 2000) {
    throw new Error(`market data is ${quote.dataAgeMs}ms old — refusing to trade on it`);
  }

  // amountIn is what the route CONSUMES, not what you asked for. A concentrated
  // -liquidity route that runs out of reachable ticks fills what it can, so an
  // ExactIn request for 100000000000 can come back as 99999759359. Compare.
  if (quote.amountIn !== AMOUNT_IN) {
    console.log(`  note: route consumes ${quote.amountIn}, not the ${AMOUNT_IN} requested`);
  }

  // ---- 2. build -----------------------------------------------------------
  //
  // quoteId is deliberately NOT passed here. It is redeemable for validForMs
  // (3s today), measured from when the quote was minted — not from when you
  // send it. A server-side script can make that window; anything with a human
  // or a wallet popup in it cannot, and gets a 410 for its trouble. Without a
  // quoteId the server re-routes at build time under your slippageBps, which
  // is the right default. See ../../README.md for the firm-quote flow.
  const built = await vulcx.swap({
    userWallet: signerAddress(),
    inputMint: FOGO,
    outputMint: USDC,
    amount: quote.amountIn,
    swapMode: "ExactIn",
    slippageBps: SLIPPAGE_BPS,
    // Simulation is on whenever there is a real wallet behind this, which is
    // every path that could ever be signed. With no SOLANA_KEYPAIR set we are
    // building against a placeholder address that does not exist on chain, and
    // the simulation would fail on AccountNotFound before printing anything
    // useful — so the introductory dry run skips it. Never ship this flag on a
    // path a user can sign: the simulation is what stops them signing a
    // transaction that can only revert.
    skipSimulation: !haveKeypair,
  });

  // With simulation on, the server simulated this before returning it, so
  // reaching this line means it passed — a failing simulation is thrown, not
  // returned as a 200 you have to inspect. See the catch block below.
  reportFees(built.amountOut, built.platformFeeAmount, built.integratorFeeAmount);
  // minAmountOut is derived from the GROSS amountOut, but the program checks it
  // against the NET output, after both fees have been taken. So the fees are
  // spent out of your slippage budget — see ../integrator-fee for why that
  // matters when you set your own.
  console.log(`  minAmountOut: ${built.minAmountOut} (checked on chain against the net output)`);
  if (built.simulation) {
    console.log(`  simulated ok: ${built.simulation.computeUnitsConsumed} compute units`);
  }

  if (!send) {
    console.log(
      haveKeypair
        ? "\ndry run — the transaction above simulated cleanly; pass --send to sign and broadcast"
        : "\ndry run, unsimulated — set SOLANA_KEYPAIR to build (and simulate) against a real wallet"
    );
    return;
  }

  // ---- 3. sign ------------------------------------------------------------
  const payer = loadKeypair();
  const tx = VersionedTransaction.deserialize(
    Buffer.from(built.transaction, "base64")
  );
  tx.sign([payer]);

  // ---- 4. submit ----------------------------------------------------------
  const connection = new Connection(rpcUrl, "confirmed");
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  console.log(`  submitted: ${signature}`);

  // ---- 5. confirm ---------------------------------------------------------
  //
  // Polled by hand rather than with confirmTransaction(): the build hands back
  // lastValidBlockHeight but not the blockhash, and lastValidBlockHeight is the
  // honest deadline — past it the transaction can no longer land, so waiting
  // longer only delays telling the user nothing happened.
  await confirm(connection, signature, built.lastValidBlockHeight);
  console.log(`  confirmed: https://fogoscan.com/tx/${signature}`);
}

/** Poll until the network confirms, or the transaction's block height passes. */
async function confirm(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) {
      // The chain says why. Slippage is both the most common cause and the only
      // one the user can act on, so name it; 6006/6036 are the aggregator's
      // ExceededSlippage / AmountOutBelowMinimum discriminants.
      const detail = JSON.stringify(status.err);
      if (/6006|6036|Slippage|AmountOutBelowMinimum/i.test(detail)) {
        throw new Error(
          "reverted: price moved past minAmountOut before it landed. " +
            "Nothing was swapped — re-quote, or raise slippageBps."
        );
      }
      throw new Error(`reverted on chain: ${detail}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    if (!status && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new Error("transaction expired before it landed — nothing was swapped");
    }
    await sleep(900);
  }
  throw new Error("confirmation timed out");
}

/**
 * amountOut is the route's GROSS output. Both fees come out of it on chain, so
 * what the user actually receives is amountOut minus both.
 */
function reportFees(amountOut: string, platformFee: string, integratorFee: string): void {
  const net = BigInt(amountOut) - BigInt(platformFee) - BigInt(integratorFee);
  console.log(`build: gross ${amountOut}`);
  console.log(`  - protocol fee (Vulcx):   ${platformFee}`);
  console.log(`  - integrator fee (yours): ${integratorFee}`);
  console.log(`  = user receives:          ${net}`);
}

/** `Vortex` is the wire value for the venue; `Valiant` is what it is called. */
const VENUE_NAME: Record<string, string> = { Vortex: "Valiant", Flux: "Fluxbeam" };
function venue(poolType: string): string {
  return VENUE_NAME[poolType] ?? poolType;
}

/**
 * The build needs a wallet ADDRESS, not a key — the key is only needed to sign.
 * With no keypair configured, fall back to a placeholder that is a valid pubkey
 * and owns nothing, so the introductory run needs no setup at all.
 */
function signerAddress(): string {
  if (!haveKeypair) return "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  return loadKeypair().publicKey.toBase58();
}

let cachedKeypair: Keypair | undefined;
function loadKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  const path = process.env.SOLANA_KEYPAIR;
  if (!path) throw new Error("SOLANA_KEYPAIR must point at a solana-keygen JSON file to use --send");
  const secret = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? "~"), "utf8"));
  cachedKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  return cachedKeypair;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The error handling an integration actually needs.
 *
 * Branch on `err.code` — the API's stable reason string — not on the message,
 * which is prose the server may reword. The typed classes below cover a status
 * each; `code` splits the statuses that carry more than one meaning (409 is
 * both QUOTE_STALE and SIM_SLIPPAGE; 404 is NO_POOL, NO_ROUTE or
 * POOL_DATA_MISSING). Full table: ../README.md.
 */
main().catch((err: unknown) => {
  if (err instanceof QuoteExpiredError) {
    // 410 QUOTE_EXPIRED — only reachable when redeeming a quoteId. Re-quote.
    console.error("quote aged out before it was redeemed; re-quote and retry");
  } else if (err instanceof QuoteStaleError) {
    // 409. QUOTE_STALE = a pinned route drifted past its firm margin.
    // SIM_SLIPPAGE = a plain build whose own simulation failed on slippage.
    // Same recovery, different event — worth logging apart.
    console.error(`price moved (${err.code ?? "409"}); re-quote and retry`);
  } else if (err instanceof NoRouteError) {
    // 404. NO_POOL: nothing exists for the pair. NO_ROUTE: pools exist, no path
    // at this size — try smaller. POOL_DATA_MISSING: the engine has not loaded
    // state yet, which IS worth retrying.
    console.error(`no route (${err.code ?? "404"}) — ${err.code === "POOL_DATA_MISSING" ? "engine still loading, retry" : "try a smaller size or another pair"}`);
  } else if (err instanceof BadRequestError) {
    // 400. SIM_INSUFFICIENT means the wallet cannot cover it and retrying
    // changes nothing. FEE_CAP_EXCEEDED / FEE_NEEDS_REFERRER are your request
    // to fix. Anything else is a malformed field.
    console.error(`rejected (${err.code ?? "400"}): ${err.message}`);
  } else if (err instanceof RateLimitError) {
    // 429 RATE_LIMITED. The SDK already retried twice with backoff before
    // surfacing this, so it means the budget is genuinely gone, not contended.
    console.error("rate limited — a key raises the anonymous 2 rps / burst 20");
  } else if (err instanceof AuthError) {
    // 401 MISSING_API_KEY / 403 INVALID_API_KEY, or an origin-locked key used
    // from an origin that is not on its allowlist.
    console.error(`key rejected (${err.code ?? "401/403"})`);
  } else if (err instanceof VulcxError) {
    // 422 ROUTE_TOO_LARGE / SIM_FAILED: routable, not buildable as shaped.
    console.error(`vulcx ${err.statusCode} ${err.code ?? ""}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
