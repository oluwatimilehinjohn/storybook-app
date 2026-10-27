// OAuth errors can contain tokens, codes, URLs, or provider response bodies.
// Log only known categories, never the raw error or request query.
module.exports = (error, req, res, next) => {
    const stage = ['account', 'google', 'session'].includes(error.authStage) ? error.authStage : 'request'
    const types = ['TokenError', 'InternalOAuthError', 'ValidationError', 'MongoServerError', 'MongoServerSelectionError', 'MongooseServerSelectionError', 'CastError']
    const type = types.includes(error.name) ? error.name : 'Error'
    const codes = ['invalid_client', 'invalid_grant', 'redirect_uri_mismatch', 'access_denied']
    const code = codes.includes(error.code) ? error.code : 'unavailable'
    console.error(`[authentication] stage=${stage} type=${type} code=${code}. Check Google client credentials/callback for google errors, MongoDB user records for account errors, and the session store for session errors.`)
    if (res.headersSent) return next(new Error('Authentication response failed; sensitive details redacted.'))
    if (stage === 'session') {
        // Do not retry saving a partially authenticated session while rendering the error.
        req.session = null
        delete req.user
    }
    res.status(500).render('error/auth', { pageTitle: 'Sign-in could not finish' })
}
