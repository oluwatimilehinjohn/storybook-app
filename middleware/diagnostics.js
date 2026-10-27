const { randomUUID } = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const path = require('node:path')
const context = new AsyncLocalStorage()
const root = path.resolve(__dirname, '..').replace(/\\/g, '/') + '/'
const stages = new Set(['request', 'session.load', 'session.save', 'session.serialize', 'session.deserialize', 'session.logout', 'google.redirect', 'google.token', 'google.profile', 'account.profile', 'account.lookup', 'account.create', 'dashboard.load', 'story.create', 'story.feed', 'story.read', 'story.edit', 'story.update', 'story.delete', 'author.load', 'view.render'])
const types = new Set(['Error', 'TypeError', 'SyntaxError', 'TokenError', 'InternalOAuthError', 'AuthorizationError', 'ValidationError', 'ValidatorError', 'MongoError', 'MongoServerError', 'MongoNetworkError', 'MongoServerSelectionError', 'MongooseServerSelectionError', 'CastError'])
const codes = new Set(['invalid_client', 'invalid_grant', 'redirect_uri_mismatch', 'access_denied', 'temporarily_unavailable', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'entity.parse.failed', 'entity.too.large'])
const fields = new Set(['googleId', 'displayName', 'firstName', 'lastName', 'image', 'title', 'body', 'status', 'user', '_id'])

function routeLabel(req) {
    const pathname = (req.originalUrl || req.url || '').split('?')[0]
    if (['/', '/dashboard', '/stories', '/stories/add', '/auth/google', '/auth/google/callback', '/auth/logout'].includes(pathname)) return pathname
    if (/^\/stories\/user\/[^/]+$/.test(pathname)) return '/stories/user/:userId'
    if (/^\/stories\/edit\/[^/]+$/.test(pathname)) return '/stories/edit/:id'
    if (/^\/stories\/[^/]+$/.test(pathname)) return '/stories/:id'
    if (/^\/(css|js|vendor)\//.test(pathname)) return '/assets'
    return '/unmatched'
}

function markStage(stage) {
    const trace = context.getStore()
    if (trace && stages.has(stage)) {
        trace.stage = stage
        if (trace.steps.length < 24) trace.steps.push({ stage, elapsedMs: Date.now() - trace.started })
    }
}

function requestDiagnostics(req, res, next) {
    const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || ''
    const trace = { requestId: randomUUID(), release: /^[a-f0-9]{7,40}$/i.test(commit) ? commit.slice(0, 12) : 'local', route: routeLabel(req), method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER', started: Date.now(), stage: 'request', steps: [], reported: new WeakSet() }
    req.diagnostics = trace
    res.setHeader('X-Request-ID', trace.requestId)
    res.setHeader('X-Storybooks-Release', trace.release)
    res.on('finish', () => {
        if (trace.route.startsWith('/auth/') || trace.failed) console.info(JSON.stringify({ event: 'request.completed', timestamp: new Date().toISOString(), requestId: trace.requestId, release: trace.release, route: trace.route, method: trace.method, status: res.statusCode, elapsedMs: Date.now() - trace.started }))
    })
    context.run(trace, next)
}

function safeError(error) {
    if (!error || typeof error !== 'object') return { type: 'Error' }
    const result = { type: types.has(error.name) ? error.name : 'Error' }
    const provider = error.oauthError
    let providerCode
    if (typeof provider?.data === 'string' && provider.data.length < 8192) {
        try { providerCode = JSON.parse(provider.data).error } catch { /* Not a JSON provider response. */ }
    }
    const code = [error.code, error.type, provider?.code, providerCode, error.cause?.code].find(value => codes.has(value))
    if (code) result.code = code
    if ([18, 13, 11000].includes(error.code)) result.databaseCode = error.code
    const status = [error.statusCode, error.status, provider?.statusCode].find(value => Number.isInteger(value) && value >= 400 && value <= 599)
    if (status) result.upstreamStatus = status
    if (error.errors && typeof error.errors === 'object') result.validationFields = Object.keys(error.errors).filter(key => fields.has(key))
    // Retain file/line locations, never messages, arguments, URLs or absolute paths.
    result.locations = typeof error.stack === 'string' ? error.stack.split('\n').slice(1).map(line => {
        const match = line.replace(/\\/g, '/').match(/\(?([^()\s]+):(\d+):(\d+)\)?$/)
        if (!match || !match[1].startsWith(root)) return null
        const file = match[1].slice(root.length)
        return /^[a-zA-Z0-9_./-]+$/.test(file) ? `${file}:${match[2]}:${match[3]}` : null
    }).filter(Boolean).slice(0, 6) : []
    return result
}

function reportError(error, req, res, stage) {
    const trace = req.diagnostics || context.getStore()
    const selected = stages.has(stage) ? stage : stages.has(error?.diagnosticStage) ? error.diagnosticStage : trace?.stage || 'request'
    const requestId = trace?.requestId || randomUUID()
    res.locals.errorReference = requestId
    if (!res.headersSent) res.setHeader('X-Request-ID', requestId)
    if (trace) {
        trace.failed = true
        if (error && typeof error === 'object') {
            if (trace.reported.has(error)) return requestId
            trace.reported.add(error)
        }
    }
    console.error(JSON.stringify({ event: 'request.error', timestamp: new Date().toISOString(), requestId, release: trace?.release || 'local', route: trace?.route || routeLabel(req), method: trace?.method || 'OTHER', stage: selected, elapsedMs: trace ? Date.now() - trace.started : 0, steps: trace?.steps || [], error: safeError(error) }))
    return requestId
}

function renderError(error, req, res, view = 'error/500', status = 500) {
    const reference = reportError(error, req, res)
    if (res.headersSent) return res.destroy()
    if ((error?.diagnosticStage || req.diagnostics?.stage || '').startsWith('session.') || error?.authStage === 'session') {
        req.session = null
        delete req.user
        delete res.locals.user
    }
    res.status(status).render(view, { pageTitle: 'Request could not finish', errorStatus: status }, (renderFailure, html) => {
        if (renderFailure) {
            reportError(renderFailure, req, res, 'view.render')
            return res.status(500).type('text/plain').send(`We could not complete this request. Please try again. Reference: ${reference}`)
        }
        res.send(html)
    })
}

function traceMiddleware(stage, middleware) {
    return (req, res, next) => {
        markStage(stage)
        const complete = error => {
            if (error && !error.diagnosticStage) error.diagnosticStage = stage
            if (!error) markStage('request')
            next(error)
        }
        try { middleware(req, res, complete) } catch (error) { complete(error) }
    }
}

function errorHandler(error, req, res, next) {
    const status = error?.type === 'entity.parse.failed' ? 400 : error?.type === 'entity.too.large' ? 413 : 500
    renderError(error, req, res, 'error/500', status)
}

module.exports = { requestDiagnostics, markStage, reportError, renderError, traceMiddleware, errorHandler, safeError }
