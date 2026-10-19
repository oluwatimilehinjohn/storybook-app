# Storybooks

Write personal stories, keep them private, or share them with other signed-in readers.

## Configuration

Copy `config/config.env.example` to `config/config.env`, then supply your own values. The local configuration is ignored by Git. Existing local credentials have been preserved during the migration to environment variables.

For deployment, set `MONGO_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and `SESSION_SECRET` in your hosting provider's environment settings. Set `PORT` when required by your hosting environment. The callback URL must match an authorized redirect URI for your Google OAuth client; preserve the existing deployed callback when migrating configuration.

Use a long random value for `SESSION_SECRET`. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and store it in your environment settings.

Run `npm install`, then `npm run dev` locally or `npm start` in production. Run `npm test` for the regression suite.

Credentials previously committed to Git should be rotated at Google Cloud and your database provider. Removing them from the latest source does not revoke credentials or remove older published Git history. Do not bypass GitHub push protection to publish credentials.
