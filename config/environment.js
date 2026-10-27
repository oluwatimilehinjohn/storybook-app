const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const requiredVariables = ['MONGO_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'SESSION_SECRET']
const configurationHelp = 'On Render, open your web service > Environment, add these keys with real values, then Save, rebuild, and deploy. For local development, copy config/config.env.example to config/config.env and fill it in. Never commit the secrets file.'

function loadEnvironment({ env = process.env, envFile = path.join(__dirname, 'config.env') } = {}) {
    // An optional local file supplies defaults; deployment variables always win.
    try {
        const local = dotenv.parse(fs.readFileSync(envFile))
        for (const [key, value] of Object.entries(local)) {
            if (env[key] === undefined) env[key] = value
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw new Error('Could not read local configuration. Check config/config.env permissions. Secret values have not been logged.')
        }
    }

    const missing = requiredVariables.filter(key => typeof env[key] !== 'string' || !env[key].trim())
    if (missing.length) {
        throw new Error(`Missing required environment variables:\n${missing.map(key => '  - ' + key).join('\n')}\n${configurationHelp}`)
    }

    const placeholders = requiredVariables.filter(key => env[key].startsWith('replace-with-'))
    if (placeholders.length) {
        throw new Error(`Replace example placeholders for: ${placeholders.join(', ')}. ${configurationHelp}`)
    }
    if (!/^mongodb(?:\+srv)?:\/\//.test(env.MONGO_URI)) {
        throw new Error('MONGO_URI must be a MongoDB connection string starting with mongodb:// or mongodb+srv://.')
    }
    if (env.SESSION_SECRET.trim().length < 32) {
        throw new Error('SESSION_SECRET must contain at least 32 characters. Generate a random secret as described in README.md and store it in Render > Environment.')
    }

    const isProduction = env.NODE_ENV === 'production' || env.RENDER === 'true'
    let callback
    try {
        callback = new URL(env.GOOGLE_CALLBACK_URL)
    } catch {
        throw new Error('GOOGLE_CALLBACK_URL must be a complete URL ending in /auth/google/callback.')
    }
    if (!['http:', 'https:'].includes(callback.protocol) || callback.pathname !== '/auth/google/callback' || callback.search || callback.hash || callback.username || callback.password) {
        throw new Error('GOOGLE_CALLBACK_URL must use the deployed domain and the exact route /auth/google/callback, without query parameters or fragments.')
    }
    if (isProduction && callback.protocol !== 'https:') {
        throw new Error('GOOGLE_CALLBACK_URL must use HTTPS in production. Update it in Render > Environment and use the identical authorized redirect URI in Google Cloud.')
    }
    // Use exactly the URL we validated. Dashboard paste artifacts (such as a
    // leading newline) must not be passed through to Google's redirect_uri.
    env.GOOGLE_CALLBACK_URL = callback.href

    const port = env.PORT === undefined ? 3000 : Number(env.PORT)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535. Render supplies this automatically; local development defaults to 3000.')
    }
    return { port, isProduction }
}

module.exports = { loadEnvironment, requiredVariables }
