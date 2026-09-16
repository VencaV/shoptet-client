# CLAUDE.md

## Project structure

pnpm monorepo with published packages:

- `packages/shoptet-client` — `@vencav/shoptet-client`, TypeScript client for the Shoptet Private API
- `packages/pohoda-client` — `@vencav/pohoda-client`, TypeScript client for the Pohoda mServer XML API

## Commands

```bash
pnpm install          # install dependencies
pnpm build            # build the package (tsup)
pnpm test             # run tests (vitest)
pnpm test:dist        # build and smoke-test the published dist entrypoints
pnpm lint             # lint the package
pnpm typecheck        # typecheck the package
```

## Watch out for when updating

### Versioning and release

- This repo publishes multiple packages via Changesets.
- Normal release flow: run `pnpm changeset`, commit the generated file in `.changeset/`, and push to `master`. GitHub Actions creates a "Version Packages" PR automatically. Merging that PR triggers the publish.
- The repository root `package.json` is intentionally `private: true` because it is the monorepo root, not a publish target.
- Publishable packages live under `packages/*/package.json`.
- For npm Trusted Publisher, the first publish may need to be done manually so the package exists on npm and can be connected to the GitHub workflow. After that, release automation can publish via OIDC.
- The release workflow uses Node 24 and `id-token: write` intentionally for npm Trusted Publisher support.

### Public API and documentation

- Keep each package's `src/index.ts`, `README.md`, and tests in sync. For a small OSS package, the README is effectively part of the API contract.
- `Result` is re-exported from `@vencav/result`. Do not reintroduce a local `Result` implementation unless there is a strong reason.
- If you change the public surface, verify both source-level tests and the dist smoke test.

### Runtime validation and security

- The client is designed to return `Result<T>` instead of throwing for API operations. Preserve that contract when handling malformed API responses.
- `apiUrl` validation, webhook signature verification, and token scrubbing are intentional defensive behavior. Avoid weakening them casually.
- Secret scrubbing must keep working for both plain header objects and Axios header abstractions.

### CI and Node support

- The package declares `engines.node: ">=20"`. CI runs against Node 20, 22, and 24.
- Do not lower the Node floor or widen the CI matrix casually; treat that as policy, not formatting.
- Trusted Publisher release uses Node 24 even though runtime support starts at Node 20.

### Build output

- The package publishes ESM + CJS + `.d.ts` via tsup.
- `exports`, `main`, `module`, and `types` in `packages/shoptet-client/package.json` must stay aligned with what `tsup` actually emits.
- If you change build config or export maps, verify `dist/` contents and run `pnpm test:dist`.

### ESLint

- Config lives in the root `eslint.config.mjs` and is shared by the package.
- Config files (`*.config.*`) are intentionally excluded from linting.

## Release

```bash
pnpm changeset        # describe changes interactively
git add .changeset/
git commit -m "chore: add changeset"
git push              # CI creates "Version Packages" PR; merging it publishes to npm
```
