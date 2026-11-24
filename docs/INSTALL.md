# Installing Planner

This guide is for admins of an OpenCloud instance. It takes a vanilla
[`opencloud-compose`](https://github.com/opencloud-eu/opencloud-compose) setup and
adds two things: a Radicale server for CalDAV/CardDAV, and the
**Planner** web app.

Everything below was tested against OpenCloud **9.2.0** with the upstream
`opencloud-compose` files (also the reference for this document). Commands assume
the compose checkout is your working directory and that `<host>` is your public
OpenCloud domain.

---

## 1. Requirements

| Component              | Version / note                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCloud server       | **9.x or newer** (tested with `opencloudeu/opencloud-rolling:9.2.0`)                                                                                                         |
| Deployment             | upstream [`opencloud-compose`](https://github.com/opencloud-eu/opencloud-compose) checkout (or an equivalent setup with the same volumes, proxy config and `apps` directory) |
| CalDAV/CardDAV backend | **Radicale** (`opencloudeu/radicale`, shipped as the `radicale/radicale.yml` compose fragment)                                                                               |
| Browser                | any current Chrome/Firefox/Safari/Edge; no extra client software needed                                                                                                      |

The app is a pure frontend extension: it talks CalDAV/CardDAV **same-origin** to
`https://<host>/caldav/` and `/carddav/` with the user's existing OpenCloud
session. There is no separate server component and no extra database.

---

## 2. Server: enable CalDAV / CardDAV

Upstream `opencloud-compose` already ships everything Radicale needs; it is just
not enabled by default.

### 2.1 Add the Radicale compose fragment

In `.env`, append `radicale/radicale.yml` to `COMPOSE_FILE`:

```dotenv
COMPOSE_FILE=docker-compose.yml:weboffice/collabora.yml:radicale/radicale.yml:caddy/opencloud.yml
```

`radicale/radicale.yml` does three things:

1. starts the `radicale` service (volume `radicale-data` → `/var/lib/radicale`),
2. mounts `config/radicale/config` into the container
   (`/etc/radicale/config`),
3. mounts `config/opencloud/proxy.yaml` into the OpenCloud container
   (`/etc/opencloud/proxy.yaml`).

> The proxy mount in step 3 is what actually publishes the DAV endpoints. Without
> it `/caldav/` returns **404**, even though Radicale is running.

### 2.2 Proxy routes (provided by `config/opencloud/proxy.yaml`)

`config/opencloud/proxy.yaml` adds a policy that forwards the DAV endpoints to
the Radicale container and injects the authenticated user:

| Endpoint               | Backend                | Headers                                                                         |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `/caldav/`             | `http://radicale:5232` | `X-Remote-User: <user>`, `X-Script-Name: /caldav`, `skip_x_access_token: true`  |
| `/.well-known/caldav`  | `http://radicale:5232` | same                                                                            |
| `/carddav/`            | `http://radicale:5232` | `X-Remote-User: <user>`, `X-Script-Name: /carddav`, `skip_x_access_token: true` |
| `/.well-known/carddav` | `http://radicale:5232` | same                                                                            |

`remote_user_header: X-Remote-User` means OpenCloud forwards the **user UUID**,
not the login name — see the troubleshooting table for what that implies for URLs.

### 2.3 Radicale authentication (provided by `config/radicale/config`)

```ini
[auth]
type = http_x_remote_user
```

Radicale trusts the `X-Remote-User` header and therefore must not be reachable
from the outside — only through the OpenCloud proxy. The compose fragment keeps
it on the internal `opencloud-net` network without published ports.

### 2.4 Start it

```bash
docker compose up -d
docker compose ps radicale opencloud
```

### 2.5 Verify the endpoint

Pick a user and a password (an app token, see section 4, or basic auth if
`PROXY_ENABLE_BASIC_AUTH` is on):

```bash
curl -u '<user>:<app-token>' -X PROPFIND -H 'Depth: 0' \
  -o /dev/null -w '%{http_code}\n' https://<host>/caldav/
```

A **207** (Multi-Status) means the proxy, the header and Radicale all work. `200`
is fine too on some proxies. Anything else: see section 6.

---

## 3. Install the app

### Option A — OpenCloud Web App Store

Install Planner from the App Store page of the OpenCloud web UI; updates are offered
there as well. If your instance has no store access, use option B.

### Option B — manual install from the release zip

The release archive is `planner-<version>.zip`. It contains **one
folder named after the app**:

```
planner/manifest.json
planner/js/…
planner/assets/…
planner/LICENSE
planner/THIRD-PARTY-LICENSES
```

So you extract the archive **into** the apps folder — the `planner/`
folder is created by the zip:

```bash
cd /path/to/opencloud-compose
sha256sum -c sha256sum.txt                     # optional: verify the download
unzip -o planner-<version>.zip -d config/opencloud/apps/
```

Result: `config/opencloud/apps/planner/manifest.json` (the folder name
_is_ the app id).

`config/opencloud/apps` is bind-mounted as the web assets apps directory
(`docker-compose.yml`: `${OC_APPS_DIR:-./config/opencloud/apps}:/var/lib/opencloud/web/assets/apps`).
No `apps.yaml` entry is needed — the app is discovered from its `manifest.json`.

The GitHub release page publishes three files: `planner-<version>.zip`,
`md5sum.txt` and `sha256sum.txt` (each in the usual `<hash>  <file>` form, so
`sha256sum -c sha256sum.txt` works in the folder that holds the zip).

A git clone is **not** an install: the build output `dist/` is not committed. To
serve a working tree instead of a release, run `pnpm install && pnpm build` in the
clone and mount its `dist/` directory as the app folder (`planner/`).

### 3.1 Restart and reload

```bash
docker compose restart opencloud
```

Then **hard-reload** the browser (Ctrl/Cmd+Shift+R) so the new remote entry is
fetched instead of the cached one.

### 3.2 What you should see

A new entry **Planner** in the app menu, opening your default app (Calendar by default)
with a sidebar for Calendar / Contacts / Tasks. On first use the app creates
nothing by itself — the Radicale collections configured in
`config/radicale/config` (`def-calendar`, `def-addressbook`) are provisioned per
user by Radicale.

### 3.3 Sizing / performance notes

The whole app is a few hundred KB (JS + CSS) served from the OpenCloud web
assets directory; no additional container, port or cron job is required.

---

## 4. Optional: app tokens for phones and desktop clients

Browsers use the OpenCloud session and need no token. Native DAV clients (DAVx5,
Thunderbird, iOS/macOS Calendar & Contacts) cannot use OpenID Connect, so they
need an **app token** per device.

1. Enable the `auth-app` service in `.env`:

   ```dotenv
   START_ADDITIONAL_SERVICES=auth-app
   ```

2. Enable app-token authentication on the proxy. Add a compose override (e.g.
   `app-auth/opencloud.yml`, part of `COMPOSE_FILE`) with:

   ```yaml
   services:
     opencloud:
       environment:
         PROXY_ENABLE_APP_AUTH: 'true'
   ```

3. `docker compose up -d`, then have each user create a token on their OpenCloud
   **account page** (App tokens → create; the token is shown once).

4. Configure the client:

   | Client          | Server                                                                                                | Credentials          |
   | --------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
   | DAVx5 (Android) | `https://<host>` (auto-discovers via `/.well-known/caldav` and `/.well-known/carddav`)                | username + app token |
   | Thunderbird     | `https://<host>/caldav/` and `https://<host>/carddav/`                                                | username + app token |
   | iOS / macOS     | Settings → Calendar/Contacts → Accounts → Other → Add CalDAV/CardDAV account, server `https://<host>` | username + app token |

The app's **Tools → Connect your devices** page shows the exact URLs and copies
them to the clipboard.

---

## 5. Admin configuration

Defaults for the app (DAV URL overrides, enabled apps, Files-sidebar entries and
other defaults) are set through the OpenCloud application config
(`config/opencloud/apps.yaml` → `applicationConfig`).

See **[docs/ADMIN-CONFIG.md](ADMIN-CONFIG.md)** for the full key reference
and ready-to-copy `apps.yaml` examples.

---

## 6. Troubleshooting

| Symptom                                                                     | Likely cause                                                                                              | Fix                                                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `404` on `https://<host>/caldav/`                                           | `config/opencloud/proxy.yaml` is not mounted into the OpenCloud container                                 | add `radicale/radicale.yml` to `COMPOSE_FILE` in `.env`, `docker compose up -d`                                             |
| `401 Unauthorized` from `/caldav/`                                          | wrong username/app token, revoked token, or app tokens not enabled                                        | re-create the token in the account page; check `PROXY_ENABLE_APP_AUTH: "true"` **and** `START_ADDITIONAL_SERVICES=auth-app` |
| `403` from an external reverse proxy in front of OpenCloud                  | the proxy considers the service "protected" (no origin / missing WebSocket or DAV allowance)              | make the service public or allow `/caldav`, `/carddav`, `/.well-known/*`                                                    |
| `502` / `503` on `/caldav/`                                                 | Radicale container is not running or crashed                                                              | `docker compose ps radicale`, `docker compose logs radicale`; check the `radicale` service is in `COMPOSE_FILE`             |
| App shows **"DAV connection failed"**                                       | the browser cannot reach `/caldav/` / `/carddav/` (routes missing or server down)                         | repeat the `curl … PROPFIND` check from 2.5 in the same browser origin                                                      |
| Collections appear under `/caldav/<uuid>/` instead of `/caldav/<username>/` | **by design**: OpenCloud forwards the user UUID in `X-Remote-User` and Radicale uses it as the login name | nothing to do — do not rename the folders; the app resolves paths from what the server returns                              |
| Calendars/contacts exist in another client but the app shows an empty list  | DAV URL override points at the wrong host                                                                 | remove the `caldavUrl`/`carddavUrl` override (defaults are same-origin) and reload                                          |
| Changes from a phone do not show up immediately                             | the calendar list is cached per session/tab                                                               | reload the tab, or wait for the next sync marker refresh                                                                    |

Useful one-liners:

```bash
docker compose ps
docker compose logs --tail 100 radicale
docker compose exec opencloud ls /var/lib/opencloud/web/assets/apps   # installed apps
curl -s -o /dev/null -w '%{http_code}\n' -u '<user>:<app-token>' -X PROPFIND \
  -H 'Depth: 0' https://<host>/caldav/
```

---

## 7. Updating and uninstalling

### Update

```bash
cd /path/to/opencloud-compose
rm -rf /tmp/cc-new && unzip -q planner-<new-version>.zip -d /tmp/cc-new
rsync -a --delete /tmp/cc-new/planner/ config/opencloud/apps/planner/
rm -rf /tmp/cc-new
docker compose restart opencloud
```

Use `rsync --delete` (or `rm -rf config/opencloud/apps/planner` first)
rather than extracting over the old install, so that stale hashed chunks from the
previous version are removed.

Then hard-reload the browser. The app id (`planner`) never changes, so
updates need no server-side migration.

### Uninstall

```bash
rm -rf config/opencloud/apps/planner
docker compose restart opencloud
```

That removes the web app only. **Calendar and contact data is not affected**: it
lives in Radicale's storage volume (`radicale-data`, or
`$RADICALE_DATA_DIR` → `/var/lib/radicale/collections`), which is independent of
the app. Deleting the volume is the only way to remove user data — back it up
first if you intend to reinstall later.

To remove CalDAV/CardDAV entirely, drop `radicale/radicale.yml` from
`COMPOSE_FILE` and remove the `radicale` service definition; the volume stays
until you delete it explicitly (`docker volume rm <project>_radicale-data`).

---

## See also

- `README.md` — feature overview and development setup
- `CHANGELOG.md` — release history
- `THIRD-PARTY-LICENSES` — third-party code shipped inside the app
- [docs/ADMIN-CONFIG.md](ADMIN-CONFIG.md) — every admin config key with `apps.yaml` examples
