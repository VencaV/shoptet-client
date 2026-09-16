# Security Policy

## Supported versions

Only the latest published version of each package receives security fixes.

## Reporting a vulnerability

Please do not open a public GitHub issue for security problems.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/VencaV/shoptet-client/security/advisories/new).
Include the affected package and version, a description of the issue, and steps to reproduce it.

You will get an acknowledgement within a few days. Once a fix is available it is published to npm and
the advisory is disclosed.

## Scope

Both packages handle credentials (a Shoptet private API token and webhook secret, Pohoda mServer
username and password). Reports about credential leakage, signature verification bypasses, or unsafe
handling of API responses are especially welcome.
