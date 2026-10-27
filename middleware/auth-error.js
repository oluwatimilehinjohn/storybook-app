const { renderError } = require('./diagnostics')

module.exports = (error, req, res, next) => {
    renderError(error, req, res, 'error/auth')
}
