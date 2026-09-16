# @vencav/shoptet-client

TypeScript client for the [Shoptet](https://www.shoptet.cz/) Private API. Covers orders, stock, pricelists, and webhook signature validation.

## Install

```bash
npm install @vencav/shoptet-client axios
```

`axios` is a peer dependency and must be installed separately.

## Usage

```ts
import { createShoptetClient } from "@vencav/shoptet-client";

const client = createShoptetClient(
  {
    apiUrl: "https://api.myshop.shoptet.com", // must be HTTPS
    oauthAccessToken: "your-private-api-token",
    webhookSecret: "your-webhook-secret",
  },
  {
    maxBatchSize: 300, // optional, default 300 (Shoptet API hard limit)
  }
);
```

All methods return a `Result<T>` — either `{ status: "ok"; data: T }` or `{ status: "error"; error: Error }`. No method throws.

## API

### `getOrder(orderCode)`

```ts
const result = await client.getOrder("OBJ-2024-001");
if (result.status === "error") {
  console.error(result.error.message);
} else {
  console.log(result.data.code, result.data.customer.email);
}
```

### `createOrder(order, options?)`

Creates an order via `POST /api/orders`. Accepts a `CreateOrderRequest` object and optional suppression flags.

```ts
const result = await client.createOrder(
  {
    externalCode: "EXT-001",
    currency: { code: "CZK" },
    email: "customer@example.com",
    items: [
      {
        itemType: "product",
        code: "SKU-123",
        name: "Product name",
        amount: "1.000",
        unitPriceWithVat: "299.00",
        vatRate: "21.00",
      },
    ],
  },
  {
    suppressEmailSending: true,
    suppressDocumentGeneration: true,
  }
);
```

### `batchUpdateStock(items)`

Updates stock quantities. Quantities are relative movements (positive = add, negative = subtract).

```ts
const result = await client.batchUpdateStock([
  { productCode: "SKU-123", quantity: 10 },
  { productCode: "SKU-456", quantity: -3 },
]);

if (result.status === "ok") {
  console.log(`${result.data.success} updated, ${result.data.failed} failed`);
  for (const err of result.data.errors) {
    console.error(`${err.code}: ${err.error}`);
  }
}
```

> **Note:** The Shoptet API hard limit is 300 items per request. `batchUpdateStock` returns `Result.error` if `items.length` exceeds `maxBatchSize` (configurable via options, default 300).

### `batchUpdatePrices(items)`

Updates selling prices (with VAT) on the default pricelist.

```ts
const result = await client.batchUpdatePrices([
  { code: "SKU-123", price: 299.9 },
  { code: "SKU-456", price: 149.0 },
]);
```

Same `{ success, failed, errors }` shape as `batchUpdateStock`.

### `validateWebhookSignature(payload, signature)`

Validates the `Shoptet-Webhook-Signature` header using HMAC-SHA1. Returns `true` if valid.

```ts
app.post("/webhook", (req, res) => {
  const signature = req.headers["shoptet-webhook-signature"] ?? "";
  if (!client.validateWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  // process webhook...
});
```

### `getDefaultStockId()` / `getDefaultPricelistId()`

Returns the ID of the first warehouse / pricelist found in Shoptet. Result is cached after the first successful call. Useful if you need the IDs for custom requests.

## Result type

All methods return `Result<T>`, re-exported from `@vencav/result`:

```ts
type Result<T, E = Error> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };
```

Check with `result.status === "ok"` or use the exported `Result.isOk()` / `Result.isError()` helpers.

```ts
import { Result } from "@vencav/shoptet-client";
```

## Security

- Webhook signatures are validated using `crypto.timingSafeEqual` to prevent timing attacks.
- The API token is sent in a request header (`Shoptet-Private-API-Token`). If you use error-reporting tools (Sentry, Datadog), configure them to scrub this header from outgoing HTTP request metadata.

## TypeScript

Full type definitions are included. Key exported types: `ShoptetCredentials`, `ShoptetClientOptions`, `ShoptetOrder`, `ShoptetOrderItem`, `CreateOrderRequest`, `CreateOrderOptions`.

## License

MIT
