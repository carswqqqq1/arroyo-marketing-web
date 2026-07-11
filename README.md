# Arroyo Marketing website

Static marketing site deployed on Cloudflare Pages with a Pages Function for lead intake.

## Local checks

```sh
npm run check:all
```

`npm run build` writes the deployable static site to `dist/`. The generated directory is ignored by Git.

## Lead delivery contract

The public form posts to `/api/lead`. Cloudflare Pages routes the request through `functions/api/lead.js` and the shared logic in `lib/lead-handler.mjs`.

The handler returns success only after at least one owner-facing durable sink succeeds:

- Resend accepts the owner notification, or
- Google Sheets accepts the lead row.

Client acknowledgement email is attempted only after that persistence gate. The submitted website URL is optional and is not fetched by the public handler.

## Required configuration

Configure at least one complete sink. Use `.env.example` as the key list; never commit real values.

For local work, put Cloudflare values in an ignored `.dev.vars` file.

### Resend

- `OWNER_EMAIL`
- `FROM_EMAIL`
- `RESEND_API_KEY`

### Google Sheets

- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Set non-sensitive values as Pages environment variables and credentials as encrypted Pages secrets. Never place live credentials in `wrangler.jsonc`.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Functions directory: `functions`

`wrangler.jsonc` is the source of truth for the output directory, compatibility date, and compatibility flags. `_headers` and `_redirects` are copied into `dist` during the build.

Run a local Pages preview after configuring local environment values:

```sh
npm run dev:cloudflare
```

The handler keeps request validation and a honeypot in code. Configure abuse protection and rate limiting at the Cloudflare edge; do not add isolate-local mutable counters to the Function.

Do not deploy until a test request proves the owner email, client acknowledgement, and Google Sheets row in the intended production environment.
