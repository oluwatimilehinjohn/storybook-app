const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fixture = require('./support/app')
let server
let base
before(async () => {
    server = fixture.createApp().listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    base = 'http://127.0.0.1:' + server.address().port
})
after(() => new Promise(resolve => server.close(resolve)))
beforeEach(() => fixture.reset())
const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options })
const submit = (url, values, user) => request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(user ? { 'x-test-user': user } : {}) }, body: new URLSearchParams(values) })

test('all important pages render using the real Handlebars templates', async () => {
    for (const url of ['/', '/dashboard', '/stories', '/stories/add', '/stories/edit/507f191e810c19729de860ea', '/stories/507f191e810c19729de860ea', '/stories/user/' + fixture.owner.id, '/test/empty']) {
        const response = await request(url)
        assert.equal(response.status, 200, url)
        const html = await response.text()
        assert.match(html, /<main id="main-content"/)
        assert.equal((html.match(/<h1[ >]/g) || []).length, 1, url + ' has one page heading')
        assert.doesNotMatch(html, /undefined|\{\{/, url)
    }
})
test('dashboard uses real story IDs and edit retains title and private visibility', async () => {
    assert.match(await (await request('/dashboard')).text(), /href="\/stories\/507f191e810c19729de860ea"/)
    const html = await (await request('/stories/edit/507f191e810c19729de860eb')).text()
    assert.match(html, /value="A letter to my future self"/)
    assert.match(html, /value="private" selected/)
    assert.doesNotMatch(html, /value="public" selected/)
})

test('every page loads the same versioned local design assets, including error pages', async () => {
    const { assets } = require('../config/presentation')
    const { escapeExpression } = require('handlebars')
    for (const url of ['/', '/dashboard', '/stories', '/stories/add', '/stories/edit/507f191e810c19729de860ea', '/stories/507f191e810c19729de860ea', '/stories/user/' + fixture.owner.id, '/test/empty', '/missing', '/test/error']) {
        const response = await request(url)
        const html = await response.text()
        assert.ok(response.headers.get('x-storybooks-ui'), url)
        assert.equal(response.headers.get('cache-control'), 'no-store', url)
        assert.ok(html.includes(escapeExpression(assets.styles)), url + ' uses versioned shared styles')
        assert.ok(html.includes(escapeExpression(assets.icons)), url + ' uses local icon fonts')
        assert.doesNotMatch(html, /https:\/\/(cdnjs\.cloudflare\.com|cdn\.ckeditor\.com)/)
    }
    for (const asset of Object.values(assets)) {
        const response = await request(asset, { headers: { 'x-test-user': 'guest', cookie: 'connect.sid=expired-session' } })
        assert.equal(response.status, 200, asset)
        assert.match(response.headers.get('content-type'), /css|javascript/, asset)
        assert.equal(response.headers.get('set-cookie'), null, asset + ' does not use sessions')
    }
})

test('static design assets remain available even when downstream session middleware fails', async () => {
    const express = require('express')
    const { configurePresentation, assets } = require('../config/presentation')
    const app = express()
    configurePresentation(app)
    app.use((req, res) => res.status(503).send('Session store unavailable'))
    const isolated = app.listen(0, '127.0.0.1')
    await new Promise(resolve => isolated.once('listening', resolve))
    try {
        const origin = 'http://127.0.0.1:' + isolated.address().port
        assert.equal((await fetch(origin + assets.styles)).status, 200)
        assert.equal((await fetch(origin + assets.icons)).status, 200)
        assert.equal((await fetch(origin + '/dashboard')).status, 503)
    } finally {
        await new Promise(resolve => isolated.close(resolve))
    }
})
test('authentication still protects every story operation', async () => {
    for (const url of ['/dashboard', '/stories', '/stories/add', '/stories/507f191e810c19729de860ea']) {
        const response = await request(url, { headers: { 'x-test-user': 'guest' } })
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), '/')
    }
    assert.equal((await submit('/stories', { title: 'Guest', body: 'Denied', status: 'public' }, 'guest')).status, 302)
    assert.equal(fixture.records().length, 4)
})
test('private stories are readable only by their owner and excluded from discovery', async () => {
    const url = '/stories/507f191e810c19729de860eb'
    assert.equal((await request(url)).status, 200)
    assert.equal((await request(url, { headers: { 'x-test-user': 'other' } })).status, 404)
    assert.doesNotMatch(await (await request('/stories')).text(), /A letter to my future self/)
    assert.doesNotMatch(await (await request('/stories/user/' + fixture.owner.id)).text(), /A letter to my future self/)
})
test('create and edit preserve contracts, show success and reject ownership injection', async () => {
    const response = await submit('/stories', { title: 'A new memory', body: '<p>My story</p>', status: 'private', user: fixture.other.id })
    assert.equal(response.headers.get('location'), '/dashboard')
    const created = fixture.records().at(-1)
    assert.equal(created.user, fixture.owner.id)
    assert.match(await (await request('/dashboard')).text(), /Your story has been saved/)
    await submit('/stories/' + created._id, { _method: 'PUT', title: 'Edited memory', body: '<p>Still mine</p>', status: 'public', user: fixture.other.id })
    assert.equal(created.title, 'Edited memory')
    assert.equal(created.user, fixture.owner.id)
})
test('empty content produces recoverable errors without losing input', async () => {
    const response = await submit('/stories', { title: 'Keep this title', body: '<p>&nbsp;</p>', status: 'public' })
    assert.equal(response.status, 400)
    const html = await response.text()
    assert.match(html, /value="Keep this title"/)
    assert.match(html, /role="alert"/)
    assert.equal(fixture.records().length, 4)
})
test('failed saves retain the submitted title and body', async () => {
    fixture.failWrites(true)
    const response = await submit('/stories', { title: 'Unsaved title', body: 'Words to recover', status: 'private' })
    assert.equal(response.status, 500)
    const html = await response.text()
    assert.match(html, /Unsaved title/)
    assert.match(html, /Words to recover/)
    assert.match(html, /Your words are still here/)
})
test('only the owner can edit or delete a story', async () => {
    const url = '/stories/507f191e810c19729de860ea'
    await submit(url, { _method: 'PUT', title: 'Hijacked', body: 'No', status: 'public' }, 'other')
    assert.notEqual(fixture.records()[0].title, 'Hijacked')
    assert.equal((await submit(url, { _method: 'DELETE' }, 'other')).status, 404)
    assert.equal(fixture.records().length, 4)
    assert.equal((await submit(url, { _method: 'DELETE' })).status, 302)
    assert.equal(fixture.records().length, 3)
    assert.match(await (await request('/dashboard')).text(), /Your story has been deleted/)
})
test('missing pages have a usable recovery link and proper status', async () => {
    const response = await request('/not-a-page')
    assert.equal(response.status, 404)
    assert.match(await response.text(), /href="\/dashboard"/)
    assert.equal((await request('/test/error')).status, 500)
})

test('Google sign-in looks up the stable profile ID and returns an existing account', async () => {
    const User = require('../models/User')
    const originalFind = User.findOne
    const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']
    const originalEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]))
    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost/auth/google/callback'
    let strategy
    require('../config/passport')({ use(value) { strategy = value }, serializeUser() {}, deserializeUser() {} })
    let lookup
    User.findOne = async filter => { lookup = filter; return fixture.owner }
    try {
        assert.equal(strategy._oauth2._clientId, process.env.GOOGLE_CLIENT_ID)
        assert.equal(strategy._oauth2._clientSecret, process.env.GOOGLE_CLIENT_SECRET)
        assert.equal(strategy._callbackURL, process.env.GOOGLE_CALLBACK_URL)
        const user = await new Promise((resolve, reject) => strategy._verify('', '', {
            id: 'google-user-123', displayName: 'Alex Morgan', name: { givenName: 'Alex', familyName: 'Morgan' }, photos: [{ value: '' }]
        }, (error, account) => error ? reject(error) : resolve(account)))
        assert.deepEqual(lookup, { googleId: 'google-user-123' })
        assert.equal(user, fixture.owner)
    } finally {
        User.findOne = originalFind
        for (const key of keys) {
            if (originalEnvironment[key] === undefined) delete process.env[key]
            else process.env[key] = originalEnvironment[key]
        }
    }
})
