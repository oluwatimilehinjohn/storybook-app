const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const session = require('express-session')
const passport = require('passport')
const exphbs = require('express-handlebars')
const User = require('../models/User')
const { configurePresentation } = require('../config/presentation')
const account = { id: '507f1f77bcf86cd799439011', googleId: 'google-test-account' }
let strategy
let server
let origin
let outcome = 'success'
let failSession = false
const store = new session.MemoryStore()
const storeSet = store.set.bind(store)
store.set = (id, value, done) => failSession ? done(new Error('sensitive-store-details')) : storeSet(id, value, done)
const originalFindById = User.findById

before(async () => {
    const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']
    const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    Object.assign(process.env, { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_CALLBACK_URL: 'http://localhost/auth/google/callback' })
    try { require('../config/passport')(passport); strategy = passport._strategy('google') }
    finally {
        for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
    }
    // Only replace the provider exchange; exercise real Passport session handling.
    passport.use('google', { authenticate() {
        if (outcome === 'denied') return this.fail()
        if (outcome === 'error') {
            const error = new Error('sensitive-provider-response')
            error.name = 'TokenError'; error.code = 'invalid_client'
            return this.error(error)
        }
        this.success(account)
    } })
    User.findById = (id, done) => done(null, id === account.id ? account : null)
    const app = express()
    configurePresentation(app)
    app.engine('.hbs', exphbs.engine({ helpers: require('../helpers/hbs'), defaultLayout: 'main', extname: '.hbs' }))
    app.set('view engine', '.hbs')
    app.use(session({ secret: 'test-only-session-secret-with-more-than-32-characters', resave: false, saveUninitialized: false, store }))
    app.use(passport.initialize())
    app.use(passport.session())
    app.use('/auth', require('../routes/auth'))
    app.use('/auth', require('../middleware/auth-error'))
    app.get('/dashboard', require('../middleware/auth').ensureAuth, (req, res) => res.json({ id: req.user.id }))
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    origin = 'http://127.0.0.1:' + server.address().port
})
after(async () => { User.findById = originalFindById; await new Promise(resolve => server.close(resolve)) })

const verify = profile => new Promise((resolve, reject) => strategy._verify('', '', profile, (error, user) => error ? reject(error) : resolve(user)))

test('existing Google accounts sign in without optional name/photo data', async t => {
    const find = User.findOne
    t.after(() => { User.findOne = find })
    User.findOne = async filter => { assert.deepEqual(filter, { googleId: account.googleId }); return account }
    assert.equal(await verify({ id: account.googleId }), account)
})

test('new accounts tolerate missing photo and family name without changing the Google identity', async t => {
    const find = User.findOne, create = User.create
    t.after(() => { User.findOne = find; User.create = create })
    User.findOne = async () => null
    User.create = async values => {
        const doc = new User(values)
        assert.equal(doc.validateSync(), undefined)
        return values
    }
    const user = await verify({ id: account.googleId, displayName: 'Alex', name: { givenName: 'Alex' }, photos: [] })
    assert.equal(user.googleId, account.googleId)
    assert.equal(user.lastName, '')
    assert.equal(user.image, '')
    const minimal = await verify({ id: account.googleId })
    assert.equal(minimal.displayName, 'Storybooks member')
})

test('missing Google identity and database failures reach Passport instead of escaping the async callback', async t => {
    await assert.rejects(verify({}), error => error.authStage === 'account')
    const find = User.findOne
    t.after(() => { User.findOne = find })
    User.findOne = async () => { throw new Error('database unavailable') }
    await assert.rejects(verify({ id: account.googleId }), error => error.authStage === 'account')
})

test('callback saves a real Passport session before redirecting and restoring the signed-in user', async () => {
    const response = await fetch(origin + '/auth/google/callback', { redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), '/dashboard')
    const cookie = response.headers.get('set-cookie').split(';')[0]
    const dashboard = await fetch(origin + '/dashboard', { redirect: 'manual', headers: { cookie } })
    assert.equal(dashboard.status, 200)
    assert.equal((await dashboard.json()).id, account.id)
    assert.equal((await fetch(origin + '/dashboard', { redirect: 'manual' })).status, 302)
})

test('provider and session errors offer a fresh sign-in and log only safe diagnostics', async () => {
    const log = console.error
    const messages = []
    console.error = message => messages.push(String(message))
    try {
        for (const stage of ['google', 'session']) {
            outcome = stage === 'google' ? 'error' : 'success'
            failSession = stage === 'session'
            const response = await fetch(origin + '/auth/google/callback', { redirect: 'manual' })
            assert.equal(response.status, 500)
            assert.equal(response.headers.get('set-cookie'), null, 'failed login does not issue a session cookie')
            const body = await response.text()
            assert.match(body, /Try Google sign-in again/)
            assert.doesNotMatch(body, /sensitive-|invalid_client/)
            assert.ok(messages.some(message => message.includes('stage=' + stage)))
        }
        assert.match(messages.join('\n'), /code=invalid_client/)
        assert.doesNotMatch(messages.join('\n'), /sensitive-/)
    } finally { outcome = 'success'; failSession = false; console.error = log }
})

test('declined sign-in returns home without creating an authenticated session', async () => {
    outcome = 'denied'
    try {
        const response = await fetch(origin + '/auth/google/callback', { redirect: 'manual' })
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), '/')
        assert.equal(response.headers.get('set-cookie'), null)
    } finally { outcome = 'success' }
})
