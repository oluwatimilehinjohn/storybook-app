const express = require('express')
const router = express.Router()
const { ensureAuth, ensureGuest } = require('../middleware/auth')
const Story = require('../models/Story')

router.get('/', ensureGuest, (req, res) => {
    res.render('login', { layout: 'login' })
})

router.get('/dashboard', ensureAuth, async (req, res) => {
    try {
        const stories = await Story.find({ user: req.user.id }).lean()
        const notice = req.session.notice
        delete req.session.notice
        res.render('dashboard', { name: req.user.firstName, stories, pageTitle: 'My stories', notice })
    } catch (err) {
        console.error(err)
        res.status(500).render('error/500', { pageTitle: 'Something went wrong' })
    }
})

module.exports = router
