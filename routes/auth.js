const express = require('express')
const passport = require('passport')
const { markStage } = require('../middleware/diagnostics')
const router = express.Router()

// auth with google
//route get /auth/google
router.get('/google', (req, res, next) => {
    markStage('google.redirect')
    passport.authenticate('google', { scope: ['profile'] })(req, res, next)
})

// auth callback
//get /auth/google/callback
router.get('/google/callback', (req, res, next) => {
    markStage('google.token')
    passport.authenticate('google', (error, user) => {
        if (error) {
            error.authStage = error.authStage || 'google'
            error.diagnosticStage = error.diagnosticStage || 'google.token'
            return next(error)
        }
        if (!user) return res.redirect('/')
        // Passport regenerates and saves the real session before redirecting.
        markStage('session.save')
        req.logIn(user, error => {
            if (error) {
                error.authStage = 'session'
                error.diagnosticStage = error.diagnosticStage || 'session.save'
                return next(error)
            }
            res.redirect('/dashboard')
        })
    })(req, res, next)
})

// logout user

router.get('/logout', function(req, res, next) {
    markStage('session.logout')
    req.logout(function(err) {
      if (err) { 
        err.diagnosticStage = 'session.logout'
        return next(err); 
        }
      res.redirect('/');
    });
  });

module.exports = router
