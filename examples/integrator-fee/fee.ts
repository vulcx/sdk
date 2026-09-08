/**
 * Charging your own fee, and reconciling what you actually receive.
 *
 * Nothing here signs or submits. It builds a transaction server-side, reads the
 * fee fields off the response and checks the arithmetic, which is the whole of
 * what a partner needs to verify before shipping.
 *
 *   npx tsx fee.ts
 *   INTEGRATOR_FEE_BPS=30 REFERRER_WALLET=<your base58 wallet> npx tsx fee.ts
 *
 * Env:
 *   REFERRER_WALLET     base58 wallet that collects your fee. Defaults to a
 *                       placeholder so the example runs; set yours to see a
 *                       real destination. This is a PUBLIC key — no secret is
 *                       needed anywhere in this file.
 *   INTEGRATOR_FEE_BPS  your rate. Default 20 (0.20%).
 *   VULCX_API_KEY       optional; raises the anonymous rate limit.
 */
import { VulcxSDK, VulcxError, BadRequestError } from "@vulcx/sdk";

const FOGO = "So11111111111111111111111111111111111111112";
const USDC = "uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG";

const AMOUNT_IN = "1000000000"; // 1 FOGO
const SLIPPAGE_BPS = 50;

// Any valid pubkey works as a destination — replace it with yours.
const REFERRER = process.env.REFERRER_WALLET ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const INTEGRATOR_FEE_BPS = Number(process.env.INTEGRATOR_FEE_BPS ?? 20);

// Only needed to shape the transaction; nothing is signed.
const USER_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const vulcx = new VulcxSDK({ apiKey: process.env.VULCX_API_KEY });

async function main(): Promise<void> {
  const built = await vulcx.swap({
    userWallet: USER_WALLET,
    inputMint: FOGO,
    outputMint: USDC,
    amount: AMOUNT_IN,
    swapMode: "ExactIn",
    slippageBps: SLIPPAGE_BPS,
    // Both are required together. integratorFeeBps without a referrer is a 400
    // FEE_NEEDS_REFERRER, not a fee quietly redirected to Vulcx.
    referrer: REFERRER,
    integratorFeeBps: INTEGRATOR_FEE_BPS,
    // Skip the server-side simulation: this wallet holds nothing, so a
    // simulation would fail on funds and throw before the fee fields could be
    // read. Never do this in production — the simulation is what stops a user
    // signing a transaction that can only revert.
    skipSimulation: true,
  });

  const gross = BigInt(built.amountOut);
  const platform = BigInt(built.platformFeeAmount);
  const integrator = BigInt(built.integratorFeeAmount);
  const net = gross - platform - integrator;

  console.log(`route output (gross):        ${gross}`);
  console.log(`  Vulcx protocol fee:        ${platform}  (${built.platformFeeBps} bps, Vulcx keeps)`);
  console.log(`  your integrator fee:       ${integrator}  (${built.integratorFeeBps} bps, YOU keep, in full)`);
  console.log(`  the user receives:         ${net}`);
  console.log(`  total taken from the user: ${platform + integrator} (${built.platformFeeBps + built.integratorFeeBps} bps)`);
  console.log(`  paid on chain to:          ${REFERRER}`);
  console.log(`                             (its ATA for the output mint, created in the same transaction)`);

  // The two rates are INDEPENDENT and they ADD. Yours is not a share of Vulcx's
  // and Vulcx's does not shrink when you raise yours — the user pays the sum.
  // The response reports them separately for exactly this reason: one blended
  // number cannot tell you what you earned.
  assert(
    integrator === (gross * BigInt(built.integratorFeeBps)) / 10000n,
    "integrator fee is bps of the GROSS route output, truncated"
  );
  assert(
    platform === (gross * BigInt(built.platformFeeBps)) / 10000n,
    "protocol fee is bps of the same gross output — not of what is left after yours"
  );
  assert(
    built.integratorFeeBps === INTEGRATOR_FEE_BPS,
    "the response echoes the rate you asked for, so you can reconcile it"
  );

  // Your fee is denominated in the OUTPUT token and lands in the referrer's ATA
  // for the output mint. Across a mixed book that means you accrue balances in
  // every token your users buy, not in one accounting currency. Plan for it.
  console.log(`\nfee token: the output mint (${USDC}), not FOGO and not USD`);

  // The fees come out of the same slippage budget the min-out is measured
  // against: minAmountOut is derived from the gross output, and the program
  // checks it against the NET output after both fees. So a total fee rate at or
  // above your slippage tolerance is a transaction that cannot land.
  const totalFeeBps = built.platformFeeBps + built.integratorFeeBps;
  if (totalFeeBps >= SLIPPAGE_BPS) {
    console.log(
      `\nWARNING: ${totalFeeBps} bps of fees against ${SLIPPAGE_BPS} bps of slippage — ` +
        `the on-chain min-out check is applied after fees, so this reverts every time. ` +
        `Raise slippageBps above the fee total.`
    );
  } else {
    console.log(
      `headroom: ${SLIPPAGE_BPS - totalFeeBps} bps of slippage left after ${totalFeeBps} bps of fees`
    );
  }
}

function assert(ok: boolean, why: string): void {
  if (!ok) throw new Error(`fee reconciliation failed: ${why}`);
  console.log(`  ok: ${why}`);
}

main().catch((err: unknown) => {
  if (err instanceof BadRequestError && err.code === "FEE_CAP_EXCEEDED") {
    // The two rates sum to more than 100 bps. Enforced here AND on chain, so
    // you get a 400 instead of a transaction that fails after the user signs.
    // Vulcx's side is set by us and can move (partner agreements lower it), so
    // do not hard-code your ceiling at 100 minus today's protocol rate — read
    // platformFeeBps off a build and derive it.
    console.error(`fee cap: ${err.message}`);
  } else if (err instanceof BadRequestError && err.code === "FEE_NEEDS_REFERRER") {
    console.error("integratorFeeBps was set with no referrer to pay it to");
  } else if (err instanceof VulcxError) {
    console.error(`vulcx ${err.statusCode} ${err.code ?? ""}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
