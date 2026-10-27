const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const exphbs = require('express-handlebars')
const { configurePresentation } = require('../config/presentation')
const { requestDiagnostics, markStage, traceMiddleware, errorHandler, safeError } = require('../middleware/diagnostics')
let server, origin
const records = []
const errorLog = console.error
const infoLog = console.info

before(async () => {
    console.error = line => records.push(JSON.parse(line))
    console.info = line => records.push(JSON.parse(line))
    const app = express()
    app.use(requestDiagnostics)
    configurePresentation(app)
    app.engine('.hbs', exphbs.engine({ helpers: require('../helpers/hbs'), defaultLayout: 'main', extname: '.hbs' }))
    app.set('view engine', '.hbs')
    app.use(express.json())
    app.get('/stories/:id', (req, res, next) => {
        markStage(req.params.id === 'slow' ? 'story.read' : 'story.feed')
        setTimeout(() => next(new Error('SENSITIVE-message')), req.params.id === 'slow' ? 30 : 1)
    })
    app.get('/broken-template', (req, res, next) => {
        res.render = (view, options, done) => done(new Error('SENSITIVE-template'))
        next(new Error('SENSITIVE-original'))
    })
    app.get('/auth/google/callback', traceMiddleware('session.load', (req, res, next) => {
        const error = new Error('SENSITIVE-session-store')
        error.code = 'ECONNREFUSED'
        next(error)
    }))
    app.use('/auth', require('../middleware/auth-error'))
    app.use(errorHandler)
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    origin = 'http://127.0.0.1:' + server.address().port
})
after(async () => {
    await new Promise(resolve => server.close(resolve))
    console.error = errorLog
    console.info = infoLog
})

test('browser, response header and structured error share a generated reference; incoming IDs and secrets are excluded', async () => {
    const response = await fetch(origin + '/stories/secret-path?code=SENSITIVE-code&token=SENSITIVE-token', { headers: { 'x-request-id': 'SENSITIVE-injected-id', authorization: 'Bearer SENSITIVE-authorization', cookie: 'session=SENSITIVE-cookie' } })
    assert.equal(response.status, 500)
    const id = response.headers.get('x-request-id')
    assert.match(id, /^[a-f0-9-]{36}$/)
    assert.ok((await response.text()).includes(id))
    const error = records.find(record => record.event === 'request.error' && record.requestId === id)
    assert.equal(error.route, '/stories/:id')
    assert.equal(error.stage, 'story.feed')
    assert.ok(error.error.locations.some(location => location.startsWith('tests/diagnostics.test.js:')))
    assert.ok(records.some(record => record.event === 'request.completed' && record.requestId === id && record.status === 500))
    assert.doesNotMatch(JSON.stringify(records), /SENSITIVE|secret-path/)
})

test('concurrent failures retain separate stages and request IDs', async () => {
    const responses = await Promise.all([fetch(origin + '/stories/slow'), fetch(origin + '/stories/fast')])
    const ids = responses.map(response => response.headers.get('x-request-id'))
    assert.notEqual(ids[0], ids[1])
    assert.equal(records.find(record => record.event === 'request.error' && record.requestId === ids[0]).stage, 'story.read')
    assert.equal(records.find(record => record.event === 'request.error' && record.requestId === ids[1]).stage, 'story.feed')
    await Promise.all(responses.map(response => response.text()))
})

test('session load errors before Passport render a traceable sign-in error', async () => {
    const response = await fetch(origin + '/auth/google/callback?code=SENSITIVE-code')
    assert.equal(response.status, 500)
    assert.match(await response.text(), /Try Google sign-in again/)
    const record = records.find(record => record.event === 'request.error' && record.requestId === response.headers.get('x-request-id'))
    assert.equal(record.stage, 'session.load')
    assert.equal(record.error.code, 'ECONNREFUSED')
    assert.doesNotMatch(JSON.stringify(record), /SENSITIVE/)
})

test('error-template failure produces plain text with the same reference instead of another generic error', async () => {
    const response = await fetch(origin + '/broken-template')
    assert.equal(response.status, 500)
    assert.match(response.headers.get('content-type'), /text\/plain/)
    const id = response.headers.get('x-request-id')
    assert.ok((await response.text()).includes(id))
    assert.ok(records.some(record => record.requestId === id && record.stage === 'view.render'))
})

test('malformed request bodies retain status 400 and do not log submitted content', async () => {
    const response = await fetch(origin + '/stories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"secret":"SENSITIVE-body"' })
    assert.equal(response.status, 400)
    assert.ok((await response.text()).includes(response.headers.get('x-request-id')))
    assert.doesNotMatch(JSON.stringify(records), /SENSITIVE/)
})

test('nested provider errors retain safe OAuth code and status without token payloads', () => {
    const error = new Error('SENSITIVE-access-token')
    error.name = 'InternalOAuthError'
    error.oauthError = { statusCode: 400, data: JSON.stringify({ error: 'invalid_grant', error_description: 'SENSITIVE-code', access_token: 'SENSITIVE-token' }) }
    const safe = safeError(error)
    assert.equal(safe.code, 'invalid_grant')
    assert.equal(safe.upstreamStatus, 400)
    assert.doesNotMatch(JSON.stringify(safe), /SENSITIVE/)
})

test('validation diagnostics identify fields without exposing user data or arbitrary property names', () => {
    const safe = safeError({ name: 'ValidationError', errors: { lastName: { value: 'SENSITIVE-name' }, 'SENSITIVE-field': { message: 'SENSITIVE-message' } } })
    assert.deepEqual(safe.validationFields, ['lastName'])
    assert.doesNotMatch(JSON.stringify(safe), /SENSITIVE/)
})
