# Storybooks

Write personal stories, keep them private, or share them with other signed-in readers.

## For you feed

Open **Discover** (`/stories`) for a single-column feed of all public stories, newest first. Each post shows the author, date, reading time, a longer preview, and a link to read the complete story. Share copies a story link when clipboard access is supported. Shared links still require sign-in.

Title search runs on the server across public stories. The feed fetches 12 stories at a time using a date/ID cursor, so new posts do not shift subsequent pages or repeat earlier results. Scrolling loads two additional batches automatically, then a **More stories** link keeps browsing deliberate and the footer reachable. Search and pagination also work without JavaScript; failed requests preserve already loaded stories and allow retry.

Private stories remain in **My stories** and are excluded from every feed query. The feed uses chronological ordering, without personalized ranking or engagement tracking. Existing author collections, reading URLs, editing, authentication, and database records are unchanged. No dependency installation or database migration is required for this feature.

## Configuration

Copy `config/config.env.example` to `config/config.env`, then supply your own values. The local configuration is ignored by Git. Existing local credentials have been preserved during the migration to environment variables.

For deployment, set `MONGO_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and `SESSION_SECRET` in your hosting provider's environment settings. Set `PORT` when required by your hosting environment. The callback URL must match an authorized redirect URI for your Google OAuth client; preserve the existing deployed callback when migrating configuration.

Use a long random value for `SESSION_SECRET`. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and store it in your environment settings.

Run `npm install`, then `npm run dev` locally or `npm start` in production. Run `npm test` for the regression suite.

Credentials previously committed to Git should be rotated at Google Cloud and your database provider. Removing them from the latest source does not revoke credentials or remove older published Git history. Do not bypass GitHub push protection to publish credentials.

## Render deployment

The startup error listing all five variables means they are absent or blank in the running service. They were previously provided by embedded values or the tracked local configuration file. That secrets file is now deliberately excluded from Git, so Render cannot receive those values from a checkout. The application accepts Render's environment variables directly; a local environment file is optional and cannot override values supplied by the host. Example placeholders are not real configuration.

### Existing Render service

1. Open the existing web service in the Render Dashboard. Under **Settings > Build & Deploy**, use the repository root and set:
   - **Build Command:** `npm ci --omit=dev`
   - **Start Command:** `node app.js`
2. Under **Environment**, set `NODE_ENV=production` and all five variables in the table below. Do not paste values into Git, screenshots, or logs.
3. Remove an existing `NODE_VERSION=14.17.0` override, or change it to `22`. A Render `NODE_VERSION` environment variable takes precedence over the repository's `.node-version` file. Also remove any `NPM_CONFIG_PRODUCTION=false` or other install overrides that conflict with the intended production install.
4. Save the environment changes, then **Clear build cache & deploy** once to replace the old Node/Yarn dependency cache. Let Render supply `PORT`; the app binds to `0.0.0.0` on that port.

| Variable | Where to obtain it / what to enter |
| --- | --- |
| `MONGO_URI` | Your existing database provider's connection string. In MongoDB Atlas, use **Connect > Drivers**, supply a database user's credentials, and retain the existing database name and options so current users and stories remain accessible. URL-encode special characters in credentials. Permit the Render service's documented outbound IP addresses in Atlas Network Access. |
| `GOOGLE_CLIENT_ID` | Google Cloud **APIs & Services > Credentials**, from the existing **OAuth 2.0 Client ID** of type **Web application**. |
| `GOOGLE_CLIENT_SECRET` | The client secret for that same Google OAuth client. Use the rotated secret if the old one was exposed. |
| `GOOGLE_CALLBACK_URL` | `https://YOUR-RENDER-DOMAIN/auth/google/callback`, replacing the domain with the actual deployed HTTPS hostname (or your configured custom domain). No trailing slash, query, or fragment. |
| `SESSION_SECRET` | Generate a random value with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`, then paste the result only into Render's Environment setting. The app requires at least 32 characters. Keep the value stable across deployments and instances; rotation signs existing users out. |

The callback path is verified in code: `app.js` mounts `routes/auth.js` at `/auth`, and that router handles `GET /google/callback`. In Google Cloud, add the **exact same complete HTTPS URL** from `GOOGLE_CALLBACK_URL` to that OAuth client's **Authorized redirect URIs**. The scheme, hostname, path, and trailing-slash behavior must match. The login initiation route `/auth/google` is not the callback. Local development can separately register `http://localhost:3000/auth/google/callback`.

The Render Blueprint in `render.yaml` declares the same commands. It prompts for the database/OAuth values and generates a session secret for Blueprint-managed services. Adding the file alone does not change an existing dashboard-managed service, supply credentials, or configure Google Cloud. Apply the instructions above to the existing service; do not create a duplicate service just to use this file.

### Publishing the preview designs

The designs in `.preview/` are implemented by the real Handlebars templates and shared CSS. Screenshots are visual references, not images to embed as pages. Login, dashboard, discovery, author collections, reading, add/edit forms, empty states, and error pages all use those shared foundations with real application data.

Materialize, Font Awesome (including fonts), and CKEditor are bundled under `public/vendor/` at their existing versions. They no longer depend on external asset CDNs. Shared styles and scripts have content-versioned URLs; page responses use `Cache-Control: no-store`. Static assets are served before session middleware so a session-store failure cannot prevent styles from loading. The `X-Storybooks-UI` response header identifies the asset revision.

If Render still displays the old design, check the service's connected repository, branch, and deployed commit, then deploy the latest commit containing these templates and assets. A local screenshot or GitHub push alone does not prove Render has successfully deployed it. Fix any missing environment variables or startup errors listed above if the new deployment fails. On inspection during this change, the configured public domain returned the original login markup, while the checked-out templates rendered the preview design.

After a successful deployment, verify the landing page contains the redesigned introduction, its HTML references `/css/style.css?v=...` and local `/vendor/` assets, and the response includes `X-Storybooks-UI`. Then sign in and check the remaining pages. Changing browsers or clearing browser data cannot replace an older release still being served by Render.

### Runtime and package manager

This project uses **npm**, with a committed `package-lock.json` (lockfile version 2). There is no Yarn lockfile. Keep the lockfile and use `npm ci` locally for an exact development installation; Render uses `npm ci --omit=dev`. `node_modules` is ignored and supplied by installation instead of committed copies. No separate build/transpile step exists for this Express/Handlebars application. The Render start command stays `node app.js`, which does not require the development-only `cross-env` package.

`.node-version` selects Node **22**, and `package.json` bounds the Node version to `22.x` (npm 10 or 11). Node 22 is an LTS line compatible with every declared Node engine range in the existing lockfile. The tests also require modern built-in Node testing/fetch APIs unavailable in Node 14. No dependency versions were upgraded for this deployment fix. Local verification uses Node 22.14.0; Render selects an available patch within the 22 line. Node 14 is end-of-life and should not be retained merely because older packages install on it.

### Startup and verification

If a request fails, its browser error page displays an **Error reference**. Search application logs for that ID to find the matching JSON `request.error` and `request.completed` events. The same reference is in the `X-Request-ID` response header. These diagnostics work locally and on any host; they do not depend on Render logs specifically.

Each error records the timestamp, HTTP method, route pattern, failure stage, timing, safe error category/code, relevant source file and line locations, and the stages reached during that request. `release` and the `X-Storybooks-Release` header use `RENDER_GIT_COMMIT` or `GIT_COMMIT` when available (otherwise `local`). Incoming request IDs are not trusted; the app generates its own.

| Stage | Where to investigate |
| --- | --- |
| `google.redirect` | Starting the Google authorization request |
| `google.token` | Exchanging the code; `invalid_client` points to client credentials, while `invalid_grant` can indicate an expired/reused code or callback mismatch |
| `google.profile` | Retrieving the Google profile after token exchange; check the logged upstream status/network code |
| `account.profile` | Validating the Google account identifier |
| `account.lookup` / `account.create` | MongoDB user lookup or creation; validation field names and selected database codes are included without values |
| `session.load` / `session.deserialize` | Reading the session or restoring its user |
| `session.save` / `session.logout` | Completing login or logout |
| `dashboard.load`, `story.*`, `author.load` | The corresponding application operation |
| `view.render` | Rendering the error page itself; a plain-text response preserves the same reference if the template fails |

Logs deliberately exclude query strings, OAuth codes, access tokens, cookies, authorization headers, bodies, user profile values, database URIs, raw error messages and provider response bodies. Source locations are relative to the application. The old development access logger was replaced so it cannot print callback query strings. Existing form recovery keeps submitted content on the page and includes an error reference on failed saves.


The callback handles optional Google profile names/photos, and an absent family name no longer blocks creating a user. Existing accounts and story ownership remain unchanged; no data migration is needed. Missing Google account IDs still fail authentication. Session failures discard the incomplete login, and the error page offers a fresh sign-in. Do not refresh or share callback URLs containing authorization codes. Start again from the site's sign-in button.

- Missing configuration lists only the missing variable names and setup steps, never their values. Placeholder values, short session secrets, invalid database schemes, callback path mismatches, production HTTP callbacks, and invalid ports fail explicitly.
- Database startup uses `MONGO_URI`. The app waits for MongoDB before opening the HTTP listener. A connection failure exits nonzero with credential/network troubleshooting guidance and without logging the connection string.
- Production sessions continue to use MongoDB and `SESSION_SECRET`. Cookies are HTTP-only, Secure in production, and SameSite=Lax. Express trusts the first proxy hop so Render's forwarded HTTPS information permits secure cookies during the Google redirect flow.
- Run `npm test` for the existing application tests plus configuration and real-entry-point startup tests. The startup tests copy application source without `config.env`, inject test-only environment values, and verify that missing configuration and an unreachable MongoDB fail safely. They do not bypass database/authentication code or connect to production accounts.
- After deployment, verify the Render logs show `MongoDB connected` followed by `Server listening on port ...`, visit the landing page, and complete a real Google sign-in. Check persistence across requests, existing stories, and logout. These production checks require your configured service and Google account; local tests do not establish a successful Render deployment.

The existing locked dependencies were retained to avoid unrelated breaking changes. During verification, the production install reported 34 npm audit findings (5 low, 16 moderate, 10 high, 3 critical). These require a separately tested dependency/security update; this configuration fix does not resolve them. Previously exposed credentials also still require provider-side rotation.

References: [Render Node version precedence](https://render.com/docs/node-version), [Render environment settings](https://render.com/docs/configure-environment-variables), [Node release support](https://nodejs.org/en/about/previous-releases), and [Express secure session cookies behind a proxy](https://expressjs.com/en/resources/middleware/session/).
