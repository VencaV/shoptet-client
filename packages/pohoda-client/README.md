# @vencav/pohoda-client

TypeScript client for the [Pohoda mServer XML API](https://www.stormware.cz/pohoda/xml/). Covers XML submission, parsed import/export responses, and stock export helpers.

## Install

```bash
npm install @vencav/pohoda-client axios
```

`axios` is a peer dependency and must be installed separately.

## Usage

```ts
import { createPohodaClient } from "@vencav/pohoda-client";

const client = createPohodaClient({
  endpoint: "http://pohoda.local:666",
  username: process.env.POHODA_USERNAME ?? "",
  password: process.env.POHODA_PASSWORD ?? "",
  serverName: "TestServer",
});
```

`createPohodaClient()` throws synchronously on invalid configuration (bad endpoint, empty credentials). All client methods return a `Result<T>` and never throw.

Options:

| Field | Required | Description |
|-------|----------|-------------|
| `endpoint` | yes | mServer base URL (`http://` or `https://`) |
| `username`, `password` | yes | mServer credentials, sent as `STW-Authorization: Basic ...` |
| `serverName` | yes | Value of the `STW-mServer-Name` header |
| `ico` | no | Company ID, kept in the config for callers building XML documents |
| `timeoutMs` | no | Request timeout, default 45000 |
| `stockExportTimeoutMs` | no | Timeout for `sendStockExportXml`, default 45000 |

## API

### `sendXml(xml)`

Posts XML to `/xml` and returns a parsed response.

```ts
const result = await client.sendXml(xml);
if (result.status === "ok" && result.data.success) {
  console.log(result.data.id, result.data.number);
}
```

### `sendStockExportXml(xml)`

Posts stock export XML to `/xml` and returns parsed stock items.

```ts
const result = await client.sendStockExportXml(xml);
if (result.status === "ok") {
  console.log(result.data.items);
}
```

### `getConfig()`

Returns a frozen copy of the client config **without the password**, so it is safe to log.

## Result type

The package re-exports `Result` from `@vencav/result`.

```ts
import { Result } from "@vencav/pohoda-client";
```

## Security

- Both `http://` and `https://` endpoints are supported because mServer typically runs on a LAN. Over `http://` the Basic auth credentials travel unencrypted, so only use it on a trusted network and prefer `https://` where mServer is exposed beyond it.
- Embedded credentials in `endpoint` are rejected.
- `getConfig()` never returns the password.
- Errors returned as `Result.error` contain only the error message and, when available, the textual response body. They never carry request headers.

## Notes

- The client reuses keep-alive HTTP and HTTPS agents to avoid repeated TCP handshake overhead on mServer requests.

## License

MIT