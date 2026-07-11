# Arroyo Marketing website

Static marketing site with one shared lead handler for Cloudflare Pages and Netlify.

## Local checks

```sh
npm run check:all
```

`npm run build` writes the deployable static site to `dist/`. The generated directory is ignored by Git.

## Lead delivery contract

The public form posts to `/api/lead` on both platforms:

- Cloudflare Pages routes the request through `functions/api/lead.js`.
- Netlify rewrites `/api/lead` to `netlify/functions/submit-lead.js`.

The handler returns success only after at least one owner-facing durable sink succeeds:

- Resend accepts the owner notification, or
- Google Sheets accepts the lead row.

Client acknowledgement email is attempted only after that persistence gate. The submitted website URL is optional and is not fetched by the public handler.

## Required configuration

Configure at least one complete sink. Use `.env.example` as the key list; never commit real values.

For local work, put Cloudflare values in an ignored `.dev.vars` file or Netlify values in an ignored `.env` file.

### Resend

- `OWNER_EMAIL`
- `FROM_EMAIL`
- `RESEND_API_KEY`

### Google Sheets

- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

For Cloudflare, set these as Pages environment variables or encrypted secrets in the dashboard. For Netlify, set them in Site configuration > Environment variables.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Functions directory: `functions`

`wrangler.toml` records the output directory and compatibility date. `_headers` and `_redirects` are copied into `dist` during the build.

Run a local Pages preview after configuring local environment values:

```sh
npm run dev:cloudflare
```

Do not deploy until a test request proves the owner sink, optional client email, and sheet behavior in the intended production environment.
