# Security

## Reporting a problem

Please don't open a public issue. Email ericdevlin@me.com with:

- what you found and where (URL, file, or endpoint)
- the steps to reproduce it
- what an attacker could do with it

Only test against your own account or a local copy (see the README for running it locally). Don't access other people's data, run automated scans against the live sites, or degrade the service.

## What's in scope

The Lookout app and API (sign-in, sessions, the admin area, uploads, the page fetcher, the auto-apply flow and the Firefox extension), and the code in this repository.

## How it's protected

The README's [Security notes](README.md#security-notes) describe the main protections: hashed single-use sign-in tokens, same-origin checks on every write, encrypted API keys, checked uploads, an SSRF-safe page fetcher and a per-request CSP. Known open items are GitHub issues labeled `security` or `hardening`.

## If something goes wrong

[docs/incident-response.md](docs/incident-response.md) is the plan for a breach: how we'd notice, what to do in the first hour, and how and when we tell people.
