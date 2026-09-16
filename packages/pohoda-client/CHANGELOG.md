# @vencav/pohoda-client

## 0.1.2

### Patch Changes

- 5799068: Security and code-quality hardening from the open-source readiness review.

  - `@vencav/pohoda-client`: `getConfig()` returns a frozen copy of the configuration without the password (new `PohodaPublicConfig` type). Response parsing is fully typed, tolerates malformed numeric values instead of producing `NaN`, and uses a keep-alive agent for `https://` endpoints too.
  - `@vencav/shoptet-client`: malformed `errors` entries in API error responses no longer produce `undefined` messages, and batch results never report more failures than items sent.
  - Both packages depend on `@vencav/result` `^0.1.1`.

## 0.1.1

### Patch Changes

- Initial release.
