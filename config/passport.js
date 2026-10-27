const GoogleStrategy = require('passport-google-oauth20').Strategy
const User = require('../models/User')
const { markStage } = require('../middleware/diagnostics')


//google strategy
module.exports = function(passport) {
    const strategy = new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL
    },    
    async (accessToken, refreshToken, profile, done) => {
        let stage = 'account.profile'
        markStage(stage)
        try {
            if (!profile || typeof profile.id !== 'string' || !profile.id.trim()) {
                throw new Error('Google profile has no account identifier')
            }
            stage = 'account.lookup'
            markStage(stage)
            let user = await User.findOne({ googleId: profile.id })
            if (!user) {
                const text = value => typeof value === 'string' ? value.trim() : ''
                const givenName = text(profile.name?.givenName)
                const familyName = text(profile.name?.familyName)
                const displayName = text(profile.displayName) || [givenName, familyName].filter(Boolean).join(' ') || 'Storybooks member'
                const newUser = {
                    googleId: profile.id,
                    displayName,
                    firstName: givenName || displayName,
                    lastName: familyName,
                    image: text(profile.photos?.[0]?.value)
                }
                stage = 'account.create'
                markStage(stage)
                user = await User.create(newUser)
            }
            return done(null, user)
        } catch (err) {
            err.authStage = 'account'
            err.diagnosticStage = stage
            return done(err)
        }

    })
    // Instrument Passport's public profile hook; token exchange stays in Passport.
    const userProfile = strategy.userProfile
    strategy.userProfile = function (accessToken, done) {
        markStage('google.profile')
        userProfile.call(this, accessToken, (error, profile) => {
            if (error) error.diagnosticStage = 'google.profile'
            done(error, profile)
        })
    }
    passport.use(strategy)

    passport.serializeUser((user, done) => {
        markStage('session.serialize')
        done(null, user.id)
    })
    passport.deserializeUser((id, done) => {
        markStage('session.deserialize')
        User.findById(id, (err, user) => {
            if (err) err.diagnosticStage = 'session.deserialize'
            done(err, user)
        })
    })
}
