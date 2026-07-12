# @vulcx/sdk

TypeScript SDK for the Vulcx DEX aggregator API. Works in Node.js, browsers, and any JavaScript runtime with `fetch`.

## Install

```bash
npm install @vulcx/sdk
```

Or via CDN:

```html
<script src="https://unpkg.com/@vulcx/sdk"></script>
```

## Quick Start

```typescript
import { VulcxSDK } from "@vulcx/sdk";

const vulcx = new VulcxSDK({
  apiKey: "vulcx_your_api_key_here",
  chain: "solana", // or "fogo"
});

// Get a quote
const quote = await vulcx.quote({
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "1000000000", // 1 SOL in lamports
  swapMode: "ExactIn",
  slippageBps: 50,
});

console.log(`Output: ${quote.amountOut}, Impact: ${quote.priceImpactPercent}`);
```

## API

### `new VulcxSDK(config)`

| Parameter   | Type     | Default                       | Description                |
| ----------- | -------- | ----------------------------- | -------------------------- |
| `apiKey`    | `string` | **required**                  | Your API key               |
| `chain`     | `string` | `"solana"`                    | `"solana"` or `"fogo"`     |
| `baseUrl`   | `string` | `"https://api.vulcx.xyz"` | API base URL               |
| `timeout`   | `number` | `30000`                       | Request timeout in ms      |
| `retries`   | `number` | `2`                           | Retry count for 429/5xx    |

### `sdk.quote(params): Promise<QuoteResponse>`

```typescript
const quote = await vulcx.quote({
  inputMint: "So111...",
  outputMint: "EPjFW...",
  amount: "1000000000",
  swapMode: "ExactIn", // or "ExactOut"
  slippageBps: 50, // optional, default 50
});
```

### `sdk.swap(params): Promise<SwapResponse>`

Returns a base64-encoded unsigned transaction.

```typescript
const swap = await vulcx.swap({
  userWallet: "9WzDX...",
  inputMint: "So111...",
  outputMint: "EPjFW...",
  amount: "1000000000",
  swapMode: "ExactIn",
  slippageBps: 50,
  skipSimulation: false,
});

// Sign and send swap.transaction with your wallet adapter
```

### `sdk.instructions(params): Promise<InstructionsResponse>`

Returns raw instructions for composability.

```typescript
const ixs = await vulcx.instructions({
  userWallet: "9WzDX...",
  inputMint: "So111...",
  outputMint: "EPjFW...",
  amount: "1000000000",
  swapMode: "ExactIn",
});

// Build your own transaction with ixs.instructions
```

## Error Handling

```typescript
import { VulcxSDK, NoRouteError, RateLimitError, AuthError } from "@vulcx/sdk";

try {
  const quote = await vulcx.quote({ ... });
} catch (err) {
  if (err instanceof NoRouteError) {
    console.log("No route found between tokens");
  } else if (err instanceof RateLimitError) {
    console.log("Rate limited, try again later");
  } else if (err instanceof AuthError) {
    console.log("Invalid API key");
  }
}
```

## Framework Examples

### React

```tsx
import { VulcxSDK } from "@vulcx/sdk";
import { useEffect, useState } from "react";

const sdk = new VulcxSDK({ apiKey: "vulcx_..." });

function SwapPage() {
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    sdk.quote({
      inputMint: "So111...",
      outputMint: "EPjFW...",
      amount: "1000000000",
      swapMode: "ExactIn",
    }).then(setQuote);
  }, []);

  return <div>{quote && <p>Output: {quote.amountOut}</p>}</div>;
}
```

### Node.js

```javascript
const { VulcxSDK } = require("@vulcx/sdk");

const sdk = new VulcxSDK({ apiKey: process.env.VULCX_KEY });
const quote = await sdk.quote({ ... });
```
