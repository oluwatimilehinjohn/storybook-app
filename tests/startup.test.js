const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { requiredVariables } = require('../config/environment')

const root = path.resolve(__dirname, '..')
function deploymentCopy(t) {
    fs.mkdirSync(path.join(root, '.preview'), { recursive: true })
    const directory = fs.mkdtempSync(path.join(root, '.preview', 'startup-'))
    fs.copyFileSync(path.join(root, 'app.js'), path.join(directory, 'app.js'))
    for (const name of ['config', 'routes', 'models', 'middleware', 'helpers']) {
        fs.cpSync(path.join(root, name), path.join(directory, name), {
            recursive: true,
            filter: source => !source.endsWith('.env')
        })
    }
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.join(root, '.preview'))
        fs.rmSync(directory, { recursive: true, force: true })
    })
    assert.equal(fs.existsSync(path.join(directory, 'config/config.env')), false)
    return directory
}

test('real entry point fails clearly before database startup when deployment configuration is absent', t => {
    const directory = deploymentCopy(t)
    const env = { ...process.env, NODE_ENV: 'production' }
    for (const key of requiredVariables) delete env[key]
    const result = spawnSync(process.execPath, ['app.js'], { cwd: directory, env, encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Startup configuration error/)
    for (const key of requiredVariables) assert.match(result.stderr, new RegExp(key))
    assert.match(result.stderr, /Render.*Environment/)
    assert.doesNotMatch(result.stdout, /Server listening|MongoDB connected/)
})

test('real entry point accepts environment-only configuration, attempts MongoDB, and does not listen on database failure', t => {
    const directory = deploymentCopy(t)
    const result = spawnSync(process.execPath, ['app.js'], {
        cwd: directory,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            MONGO_URI: 'mongodb://test-user:test-password@127.0.0.1:1/unreachable?directConnection=true',
            GOOGLE_CLIENT_ID: 'test-only-id',
            GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
            GOOGLE_CALLBACK_URL: 'https://example.com/auth/google/callback',
            SESSION_SECRET: 'test-only-session-secret-not-for-production',
            PORT: '10000'
        },
        encoding: 'utf8',
        // Includes cold module loading on Windows in addition to the 10s DB timeout.
        timeout: 60000
    })
    assert.equal(result.status, 1, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'))
    assert.match(result.stdout, /Connecting to MongoDB/)
    assert.match(result.stderr, /MongoDB connection failed/)
    assert.match(result.stderr, /network access/)
    assert.doesNotMatch(result.stderr, /Startup configuration error|test-password|test-only-client-secret|test-only-session-secret/)
    assert.doesNotMatch(result.stdout, /Server listening/)
})
