# API clients monorepo

Monorepo for TypeScript API client packages including `@vencav/shoptet-client` and `@vencav/pohoda-client`.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@vencav/shoptet-client`](./packages/shoptet-client) | Shoptet Private API client with order, stock, pricelist, and webhook helpers | [![npm](https://img.shields.io/npm/v/@vencav/shoptet-client)](https://www.npmjs.com/package/@vencav/shoptet-client) |
| [`@vencav/pohoda-client`](./packages/pohoda-client) | Pohoda mServer XML client with response parsing and stock export helpers | [![npm](https://img.shields.io/npm/v/@vencav/pohoda-client)](https://www.npmjs.com/package/@vencav/pohoda-client) |

## Quick start

```bash
pnpm add @vencav/shoptet-client axios
```

```ts
import { createShoptetClient } from "@vencav/shoptet-client";

const client = createShoptetClient({
  apiUrl: "https://api.myshop.shoptet.com",
  oauthAccessToken: process.env.SHOPTET_PRIVATE_API_TOKEN ?? "",
  webhookSecret: process.env.SHOPTET_WEBHOOK_SECRET ?? "",
});
```

Full package documentation lives in [packages/shoptet-client/README.md](packages/shoptet-client/README.md) and [packages/pohoda-client/README.md](packages/pohoda-client/README.md).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm test:dist
```

## Publishing

This repo uses Changesets:

```bash
pnpm changeset
git add .changeset/
git commit -m "chore: add changeset"
git push
```

Merging the release PR publishes the package.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## License

MIT — see [LICENSE](./LICENSE).
