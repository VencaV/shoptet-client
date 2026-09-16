# Contributing

Thanks for taking the time to contribute.

## Setup

This is a pnpm monorepo. Use the Node version from `.nvmrc` (Node 20 or newer is supported).

```bash
pnpm install
pnpm build
pnpm test
```

## Before opening a pull request

Run the same checks as CI:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:dist
```

Keep each package's `src/index.ts`, `README.md`, and tests in sync. The README is part of the public
API contract, so document any new or changed exports.

## Changesets

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Commit the generated file in `.changeset/` together with your change. Merging to `master` opens a
"Version Packages" pull request; merging that publishes to npm.

## Reporting security issues

See [SECURITY.md](./SECURITY.md). Please do not report vulnerabilities in public issues.
