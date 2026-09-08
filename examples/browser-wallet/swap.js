/* Browser swap: the wallet signs, THIS PAGE submits.
 *
 * Why sign-only, and not signAndSendTransaction:
 * no wallet advertises a Fogo chain. Backpack, Brave, Solflare and Nightly all
 * report solana:mainnet/devnet/testnet/localnet and nothing else. Asking a
 * wallet to SEND would put the transaction on Solana, not Fogo. So the wallet
 * signs bytes and this file submits them to a Fogo RPC — the network is never
 * the wallet's to choose. A wallet-adapter "send" flow cannot work here; do not
 * port one in.
 *
 * No bundler, no dependencies, no build step. Open index.html and it runs.
 * This file never holds a key and never submits anything the user has not
 * confirmed in their own wallet UI.
 */
(function () {
  'use strict';

  var API = 'https://api.vulcx.xyz';
  var RPC = 'https://mainnet.fogo.io';
  var EXPLORER = 'https://fogoscan.com';

  var FOGO = 'So11111111111111111111111111111111111111112'; // 9 decimals
  var USDC = 'uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG'; // 6 decimals
  var AMOUNT_IN = '1000000000';  // 1 FOGO
  var SLIPPAGE_BPS = 50;

  /* A key is optional. Empty means the anonymous per-IP tier: 2 requests/s,
     burst 20, and a /swap build costs 5 of those units. A key raises that — but
     a key in page source is world-readable, so only ever put an ORIGIN-LOCKED
     key here. Keys are issued by hand during beta: https://t.me/vulcxsupport */
  var API_KEY = '';

  /* ---- Wallet Standard discovery -------------------------------------------
     Wallets announce themselves by responding to app-ready, so the page has to
     be listening before it dispatches. No adapter library involved. */
  var registered = [];
  var walletApi = {
    register: function () {
      registered = registered.concat(Array.prototype.slice.call(arguments));
      renderWallets();
      return function () {};
    },
    get: function () { return registered.slice(); },
    on: function () { return function () {}; },
  };
  window.addEventListener('wallet-standard:register-wallet', function (e) {
    try { e.detail(walletApi); } catch (_) {}
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletApi }));

  /* A wallet is usable here if it can connect AND sign. signAndSendTransaction
     is deliberately not required — we never call it. Backpack registers once
     per chain, so de-duplicate by name. */
  function wallets() {
    var seen = {};
    return registered.filter(function (w) {
      return w && w.features && w.features['standard:connect'] &&
             w.features['solana:signTransaction'] && !seen[w.name] && (seen[w.name] = 1);
    });
  }

  /* ---- encoding ---- */
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  /* ---- Fogo RPC (plain JSON-RPC, no web3.js) ---- */
  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || ('RPC ' + method + ' failed'));
      return j.result;
    });
  }

  /* ---- Vulcx API ---- */
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (API_KEY) h.Authorization = 'Bearer ' + API_KEY;
    return h;
  }

  /* Unwrap {success, data, error, code}. `code` is the stable reason string and
     the thing to branch on; `error` is prose the server may reword. */
  function unwrap(res) {
    return res.json().then(function (body) {
      if (res.ok && body.success) return body.data;
      var err = new Error(body.error || ('HTTP ' + res.status));
      err.code = body.code;
      err.status = res.status;
      err.data = body.data;
      throw err;
    });
  }

  function getQuote() {
    var qs = 'inputMint=' + FOGO + '&outputMint=' + USDC +
             '&amount=' + AMOUNT_IN + '&swapMode=ExactIn&slippageBps=' + SLIPPAGE_BPS;
    return fetch(API + '/api/v1/quote?' + qs, { headers: headers() }).then(unwrap);
  }

  function buildSwap(userWallet) {
    /* quoteId is not sent. It is redeemable for ~3s from when it was MINTED,
       and a wallet confirmation dialog outlives that every time, so pinning
       here guarantees a 410 rather than a better price. The server re-routes at
       build time under slippageBps instead. */
    return fetch(API + '/api/v1/swap', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        userWallet: userWallet,
        inputMint: FOGO,
        outputMint: USDC,
        amount: AMOUNT_IN,
        swapMode: 'ExactIn',
        slippageBps: SLIPPAGE_BPS,
      }),
    }).then(unwrap);
  }

  /* ---- sign, submit, confirm ---- */
  function signAndSubmit(wallet, account, base64Tx) {
    /* No `chain` is passed, on purpose: the wallet is signing bytes, not
       choosing a network. Passing solana:mainnet would be a lie, and there is
       no fogo:mainnet to pass. */
    return wallet.features['solana:signTransaction'].signTransaction({
      account: account,
      transaction: b64ToBytes(base64Tx),
    }).then(function (out) {
      var signed = out && out[0] && (out[0].signedTransaction || out[0].signedTransactionBytes);
      if (!signed) throw new Error('Wallet returned no signed transaction.');
      return rpc('sendTransaction', [bytesToB64(new Uint8Array(signed)), {
        encoding: 'base64', skipPreflight: false, maxRetries: 3,
        preflightCommitment: 'confirmed',
      }]);
    });
  }

  /* Poll until confirmed, or until the build's lastValidBlockHeight passes —
     past that the transaction can no longer land, so waiting only delays
     telling the user nothing happened. */
  function confirm(signature, lastValidBlockHeight) {
    var deadline = Date.now() + 90000;
    return new Promise(function (resolve, reject) {
      (function poll() {
        if (Date.now() > deadline) return reject(new Error('Confirmation timed out.'));
        rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: false }])
          .then(function (res) {
            var st = res && res.value && res.value[0];
            if (st && st.err) return reject(new Error(onChainFailure(st.err)));
            if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
              return resolve(st.confirmationStatus);
            }
            if (!st && lastValidBlockHeight) {
              return rpc('getBlockHeight', [{ commitment: 'confirmed' }]).then(function (h) {
                if (h > lastValidBlockHeight) {
                  return reject(new Error('Transaction expired before it landed. Nothing was swapped.'));
                }
                setTimeout(poll, 900);
              }).catch(function () { setTimeout(poll, 900); });
            }
            setTimeout(poll, 900);
          })
          .catch(function () { setTimeout(poll, 1200); });
      })();
    });
  }

  /* 6006 and 6036 are the aggregator's ExceededSlippage / AmountOutBelowMinimum
     discriminants. Anything else stays generic on purpose: guessing at an
     unknown program error is worse than admitting we do not know. */
  function onChainFailure(err) {
    var s = '';
    try { s = JSON.stringify(err); } catch (_) { s = String(err); }
    if (/6006|6036|Slippage|AmountOutBelowMinimum/i.test(s)) {
      return 'Price moved past your slippage tolerance before the swap landed. ' +
             'Nothing was swapped. Raise slippage or retry at the new price.';
    }
    if (/insufficient|InsufficientFunds/i.test(s)) {
      return 'Not enough balance to cover the swap and fees. Nothing was swapped.';
    }
    return 'The swap failed on chain and nothing was swapped.';
  }

  /* An API error the user can act on. Branch on code, never on the sentence. */
  function apiFailure(err) {
    switch (err.code) {
      case 'SIM_INSUFFICIENT': return 'Not enough balance for this swap. Retrying will not help.';
      case 'SIM_SLIPPAGE':
      case 'QUOTE_STALE':      return 'The price moved while the transaction was being built. Try again.';
      case 'QUOTE_EXPIRED':    return 'That quote expired. Getting a fresh one.';
      case 'NO_ROUTE':
      case 'NO_POOL':          return 'No route for this pair at this size.';
      case 'POOL_DATA_MISSING':return 'The engine is still loading pool state. Try again shortly.';
      case 'RATE_LIMITED':     return 'Rate limited — too many requests from this network. Wait a moment.';
      case 'ROUTE_TOO_LARGE':  return 'The best route is too large for one transaction. Try a smaller amount.';
      default:                 return err.message || 'The swap could not be built.';
    }
  }

  /* ---- UI ------------------------------------------------------------------ */
  var connected = null; // { wallet, account }
  var el = function (id) { return document.getElementById(id); };
  var say = function (msg) { el('status').textContent = msg; };

  function renderWallets() {
    var found = wallets();
    var box = el('wallets');
    box.innerHTML = '';
    if (!found.length) {
      box.textContent = 'No compatible wallet detected. Backpack supports Fogo mainnet natively.';
      return;
    }
    found.forEach(function (w) {
      var b = document.createElement('button');
      b.textContent = 'Connect ' + w.name;
      b.onclick = function () {
        w.features['standard:connect'].connect().then(function (res) {
          var accounts = (res && res.accounts) || w.accounts || [];
          if (!accounts.length) throw new Error('Wallet returned no account.');
          connected = { wallet: w, account: accounts[0] };
          say('Connected: ' + accounts[0].address);
          el('swap').disabled = false;
        }).catch(function (e) { say('Connect failed: ' + e.message); });
      };
      box.appendChild(b);
    });
  }

  el('quote').onclick = function () {
    say('Quoting…');
    getQuote().then(function (q) {
      var venue = { Vortex: 'Valiant', Flux: 'Fluxbeam' };
      say('1 FOGO -> ' + q.amountOut + ' USDC base units · impact ' + q.priceImpactPercent +
          ' · via ' + q.routes.map(function (r) { return venue[r.poolType] || r.poolType; }).join(' + ') +
          ' · data age ' + q.dataAgeMs + 'ms');
    }).catch(function (e) { say(apiFailure(e)); });
  };

  el('swap').onclick = function () {
    if (!connected) return;
    el('swap').disabled = true;
    say('Building…');
    buildSwap(connected.account.address).then(function (built) {
      /* amountOut is GROSS. Both fees come out of it on chain. */
      var net = BigInt(built.amountOut) - BigInt(built.platformFeeAmount) - BigInt(built.integratorFeeAmount);
      say('Sign in your wallet — you receive ' + net + ' USDC base units');
      return signAndSubmit(connected.wallet, connected.account, built.transaction)
        .then(function (sig) {
          say('Submitted ' + sig + ' — waiting for the chain…');
          return confirm(sig, built.lastValidBlockHeight).then(function () {
            el('status').innerHTML = 'Confirmed: <a href="' + EXPLORER + '/tx/' + sig + '">' + sig + '</a>';
          });
        });
    }).catch(function (e) {
      if (/reject|denied|cancel/i.test(e.message || '')) say('Cancelled in the wallet.');
      else say(e.code ? apiFailure(e) : (e.message || 'Swap failed.'));
    }).then(function () { el('swap').disabled = false; });
  };

  renderWallets();
})();
