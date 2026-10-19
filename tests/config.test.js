const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadEnvironment, requiredVariables } = require('../config/environment')

const validEnvironment = () => ({
    NODE_ENV: 'production',
    MONGO_URI: 'mongodb://127.0.0.1:27017/config-test',
    GOOGLE_CLIENT_ID: 'test-only-client-id',
    GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
    GOOGLE_CALLBACK_URL: 'https://example.com/auth/google/callback',
    SESSION_SECRET: 'test-only-session-secret-not-for-production',
    PORT: '10000'
})

function temporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'storybook-config-'))
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
        fs.rmSync(directory, { recursive: true, force: true })
    })
    return directory
}

test('deployment variables work without any local environment file', t => {
    const envFile = path.join(temporaryDirectory(t), 'missing.env')
    assert.deepEqual(loadEnvironment({ env: validEnvironment(), envFile }), { port: 10000, isProduction: true })
    assert.equal(fs.existsSync(envFile), false)
})

test('local dotenv file supplies missing values without overriding deployment variables', t => {
    const envFile = path.join(temporaryDirectory(t), 'local.env')
    const values = validEnvironment()
    values.NODE_ENV = 'development'
    values.GOOGLE_CALLBACK_URL = 'http://localhost:3000/auth/google/callback'
    fs.writeFileSync(envFile, Object.entries(values).map(([key, value]) => key + '=' + value).join('\n'))
    const env = { PORT: '4567' }
    assert.deepEqual(loadEnvironment({ env, envFile }), { port: 4567, isProduction: false })
    assert.equal(env.GOOGLE_CLIENT_ID, values.GOOGLE_CLIENT_ID)
    const production = validEnvironment()
    assert.equal(loadEnvironment({ env: production, envFile }).isProduction, true)
    assert.equal(production.GOOGLE_CALLBACK_URL, 'https://example.com/auth/google/callback')
})

test('missing or blank variables name every required key and give Render instructions', t => {
    const envFile = path.join(temporaryDirectory(t), 'absent.env')
    assert.throws(() => loadEnvironment({ env: { GOOGLE_CLIENT_ID: '   ' }, envFile }), error => {
        for (const key of requiredVariables) assert.match(error.message, new RegExp(key))
        assert.match(error.message, /Render.*Environment/)
        assert.match(error.message, /Never commit/)
        return true
    })
})

test('validation never includes configured secret values', t => {
    const env = validEnvironment()
    delete env.MONGO_URI
    assert.throws(() => loadEnvironment({ env, envFile: path.join(temporaryDirectory(t), 'absent.env') }), error => {
        assert.match(error.message, /MONGO_URI/)
        assert.equal(error.message.includes(env.GOOGLE_CLIENT_SECRET), false)
        assert.equal(error.message.includes(env.SESSION_SECRET), false)
        return true
    })
})

test('weak secrets, placeholders, wrong callback paths, insecure production URLs and invalid ports fail', t => {
    const envFile = path.join(temporaryDirectory(t), 'absent.env')
    for (const [key, value] of [
        ['SESSION_SECRET', 'short'],
        ['GOOGLE_CLIENT_ID', 'replace-with-your-google-client-id'],
        ['GOOGLE_CALLBACK_URL', 'https://example.com/wrong-route'],
        ['GOOGLE_CALLBACK_URL', 'http://example.com/auth/google/callback'],
        ['GOOGLE_CALLBACK_URL', 'https://example.com/auth/google/callback?code=secret'],
        ['MONGO_URI', 'https://example.com'],
        ['PORT', 'not-a-port'],
        ['PORT', '0']
    ]) {
        assert.throws(() => loadEnvironment({ env: { ...validEnvironment(), [key]: value }, envFile }), new RegExp(key))
    }
})

test('local development has a default port and Render enforces HTTPS even without NODE_ENV', t => {
    const env = validEnvironment()
    delete env.PORT
    delete env.NODE_ENV
    const envFile = path.join(temporaryDirectory(t), 'absent.env')
    assert.equal(loadEnvironment({ env, envFile }).port, 3000)
    env.RENDER = 'true'
    env.GOOGLE_CALLBACK_URL = 'http://example.com/auth/google/callback'
    assert.throws(() => loadEnvironment({ env, envFile }), /HTTPS/)
})
