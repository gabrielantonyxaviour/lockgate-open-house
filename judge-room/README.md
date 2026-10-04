# Private judge room

Password-protected supporting evidence at `https://open-house.lockgate.finance/judges`.
This is a separate Worker with a specific path route; it does not deploy the product app.

## Content and secrets

Place the confidential dossier in `private/evidence.json` locally. Its format contains
`overview`, `asOf`, `metrics`, `sections` and `appendices`. The source export stays outside
Git. It is bundled into the server Worker and is returned only after authentication.
Never put it in the public app, static assets, or a committed fixture.

Three Cloudflare secrets are required: `PASSWORD_SALT`, `PASSWORD_HASH`, `SESSION_SECRET`.
Use a cryptographically random password with at least 128 bits of entropy; the hash is
SHA-256 of the salt, a NUL separator and the password. Generate a random session secret.
Store any local credentials in the ignored `private/` directory with mode 600.
Upload secrets using `wrangler secret bulk private/worker-secrets.json`.

## Verify and deploy

```sh
npm ci
npm test
wrangler deploy --dry-run
wrangler deploy
```

The tests cover anonymous data access, input bounds, rate limiting, missing secrets,
origin checks, cookie tampering, expiry, host binding and HTML escaping. They require a
local evidence export for the Worker import, but exercise synthetic test data.

Login uses a signed, eight-hour, HttpOnly/Secure/SameSite cookie. Every response disables
browser/CDN caching and search indexing. Login attempts are limited to eight per minute
per IP at a Cloudflare location. No external assets, trackers or client scripts are used.

After deployment, verify anonymous and authenticated paths, rate limiting and logout.
Also confirm the public product root still responds. Keep the password out of HackQuest
public fields; distribute it separately to the judging team.
