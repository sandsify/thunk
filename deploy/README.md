# Deployment: the server for Thunk and the hints

One VM (RHEL 9, 4 CPUs, 8 GB) runs three containers (`compose.yaml`):

- **thunk**: runs the readers' code (`../server`). Privileged, for its
  bubblewrap sandboxes (no network, read-only file system, time and
  memory limits per job). Not reachable from outside.
- **hints**: the AI hint service (`../hints`). Holds the API key.
- **caddy**: the only open ports, 80 and 443. Gets a Let's Encrypt
  certificate for `SITE` and passes on only `POST`/`OPTIONS` to
  `/submit` (Thunk) and `/hint` (hints); everything else (Thunk's own
  playground, saved snippets, admin) is 404. Requests whose `Origin` is
  not `PAGES_ORIGIN` get 403, and `/submit` is limited per IP address
  (`SUBMIT_PER_MINUTE`, generous because a campus network may put many
  readers behind one address; Thunk's queue protects its capacity). The
  access log has no IP addresses.

Keep the VM single-purpose: if code ever escaped Thunk's sandbox, the
privileged container would give it the VM. So use keys that cost
nothing if they leak: Gemini from a Google project without billing, or
an OpenRouter key with its own credit limit.

## Setup (once)

```sh
sudo dnf -y install git
git clone https://github.com/sandsify/thunk.git
cd thunk && git submodule update --init server/play-haskell
cd deploy
cp env.example .env && chmod 600 .env && vi .env      # SITE, PAGES_ORIGIN, the key
sudo ./setup-rhel9.sh                                  # Docker CE, firewall, start
sudo docker compose logs -f thunk                      # the first start builds packages (20-40 min)
```

DNS for `SITE` must point at the VM, and ports 80 and 443 must be open
from the internet (Let's Encrypt checks port 80).

## Check

```sh
curl -s -H 'Origin: https://www.example.org' -H 'Content-Type: application/json' \
  -d '{"code":">>> 1 + 1\n","version":"9.8.4","opt":"O0","output":"ghci"}' https://SITE/submit
# {"ec":0, ... "sout":"2\n\u001e\n" ...}
curl -s -o /dev/null -w '%{http_code}\n' https://SITE/          # 404
curl -s -o /dev/null -w '%{http_code}\n' -d '{}' https://SITE/submit   # 403 (no Origin)
```

Then publish the pages against it, from a machine with a Kerberos ticket
(`kinit`):

```sh
THUNK_URL=https://SITE HINT_URL=https://SITE widget/build.sh page.md out/
```

## Run

- Update: `git pull && sudo docker compose up -d --build` (Caddy picks up
  a changed `caddy/Caddyfile` with `sudo docker compose exec caddy caddy
  reload --config /etc/caddy/Caddyfile`).
- Logs: `sudo docker compose logs -f caddy|thunk|hints`. Hint requests
  are also in the `hintlog` volume, one JSON line each (page, task,
  model, whether a hint was shown; no code, no IP).
- Switch the hint model: edit `.env` (see `env.example`), then
  `sudo docker compose up -d hints`.

## Tested locally (2026-11-03)

With `SITE=localhost` (Caddy's own certificate), `HTTPS_PORT=8443`, the
mock hint model and `SUBMIT_PER_MINUTE=5`: submit with the right Origin
200, without or with another Origin 403, preflight 200, `/`, `/save`,
`/admin` 404, the sixth submit in a minute 429, hints 200 and logged,
no IP addresses in Caddy's log. Not tested: RHEL 9 itself, Let's
Encrypt, and the pages in Canvas against it.
