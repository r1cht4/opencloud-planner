# Security policy

## Supported versions

Only the latest released version of OpenCloud Planner receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a vulnerability. Report it privately to the maintainers, for
example through the private security reporting channel of the repository (on GitHub: _Security_ →
_Report a vulnerability_) or by e-mail to the address published in `package.json`.

Include the affected version, the OpenCloud version, what an attacker can do and the steps to
reproduce. You will get an acknowledgement as soon as possible; please give us time to ship a fix
before disclosing the issue publicly.

## Scope

OpenCloud Planner is a browser extension: it holds no server component and no data of its own. It talks
CalDAV/CardDAV to the OpenCloud origin it was loaded from and sends the OpenCloud access token to no
other host. Reports about the OpenCloud server, the proxy configuration or Radicale itself belong to
those projects.

Issues that are in scope include, for example:

- cross-site scripting through imported `.ics`/`.vcf` data,
- a way to make the extension send the access token, credentials or calendar data to a third party,
- leaking data of one user to another.
