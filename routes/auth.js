const express = require('express')
const passport = require('passport')
const router = express.Router()

// auth with google
//route get /auth/google
router.get('/google', passport.authenticate('google', { scope: ['profile'] }))

// auth callback
//get /auth/google/callback
router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', (error, user) => {
        if (error) {
            error.authStage = error.authStage || 'google'
            return next(error)
        }
        if (!user) return res.redirect('/')
        // Passport regenerates and saves the real session before redirecting.
        req.logIn(user, error => {
            if (error) {
                error.authStage = 'session'
                return next(error)
            }
            res.redirect('/dashboard')
        })
    })(req, res, next)
})

// logout user

router.get('/logout', function(req, res, next) {
    req.logout(function(err) {
      if (err) { 
        return next(err); 
        }
      res.redirect('/');
    });
  });

module.exports = router
