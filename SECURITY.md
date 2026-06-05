# Security policy

Meridian takes security findings seriously and fixes them before new features
ship.

## Reporting a vulnerability

Please report vulnerabilities privately rather than opening a public issue.

* Open a [private security advisory](https://github.com/nickk02/meridian/security/advisories/new) on the repository, or
* email the maintainer at the address on the GitHub profile.

Include enough detail to reproduce: the affected endpoint or component, the
request or input, and the observed versus expected behavior. A proof of concept
helps but is not required.

## Scope

In scope:

* The Worker API (`/api/*`) and its authentication, including the token-guarded ingest endpoint.
* The SPA: any path from feed data to the DOM (for example, rendering a `source_url` or object name).
* Provenance and audit integrity: anything that lets an action be forged, an audit entry be dropped, or a link be created without a basis.

Out of scope:

* The upstream public data feeds themselves. Meridian only reads them.
* Findings that require a Cloudflare account compromise or physical access to the operator's machine.
* Rate-limit or denial-of-service reports against the free-tier instance without a concrete amplification or bypass.

## Handling

Reports are acknowledged, triaged, and fixed on a priority track ahead of feature
work. A fix ships before the related feature area is extended. Reporters are
credited in the advisory unless they ask not to be.
