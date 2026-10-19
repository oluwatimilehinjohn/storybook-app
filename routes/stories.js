const express = require('express')
const router = express.Router()
const { ensureAuth } = require('../middleware/auth')
const { stripTags } = require('../helpers/hbs')
const Story = require('../models/Story')
const User = require('../models/User')

const validStory = ({ title, body, status }) =>
    typeof title === 'string' && title.trim() &&
    typeof body === 'string' && stripTags(body) &&
    ['public', 'private'].includes(status)

const formValues = (body) => ({
    title: typeof body.title === 'string' ? body.title : '',
    body: typeof body.body === 'string' ? body.body : '',
    status: ['public', 'private'].includes(body.status) ? body.status : 'public'
})

const formFailure = (res, view, story, status, message) => res.status(status).render(view, {
    story, pageTitle: view.endsWith('edit') ? 'Edit story' : 'Write a story', formError: message
})

router.get('/add', ensureAuth, (req, res) => {
    res.render('stories/add', { pageTitle: 'Write a story' })
})

router.post('/', ensureAuth, async (req, res) => {
    const values = formValues(req.body)
    if (!validStory(req.body)) return formFailure(res, 'stories/add', values, 400, 'Add a title and story, and choose public or private before saving.')
    try {
        await Story.create({ ...values, user: req.user.id })
        req.session.notice = 'Your story has been saved.'
        res.redirect('/dashboard')
    } catch (err) {
        console.error(err)
        return formFailure(res, 'stories/add', values, 500, 'We couldn’t save your story. Your words are still here. Please try again.')
    }
})

router.get('/', ensureAuth, async (req, res) => {
    try {
        const stories = await Story.find({ status: 'public' }).populate('user').sort({ createdAt: 'desc' }).lean()
        res.render('stories/index', { stories, pageTitle: 'Discover stories' })
    } catch (err) {
        console.error(err)
        res.status(500).render('error/500', { pageTitle: 'Something went wrong' })
    }
})

router.get('/:id', ensureAuth, async (req, res) => {
    try {
        const story = await Story.findById(req.params.id).populate('user').lean()
        if (!story || !story.user || (story.status !== 'public' && String(story.user._id) !== String(req.user.id))) {
            return res.status(404).render('error/404', { pageTitle: 'Story not found' })
        }
        res.render('stories/show', { story, pageTitle: story.title })
    } catch (err) {
        console.error(err)
        res.status(err.name === 'CastError' ? 404 : 500).render(err.name === 'CastError' ? 'error/404' : 'error/500')
    }
})

router.get('/edit/:id', ensureAuth, async (req, res) => {
    try {
        const story = await Story.findOne({ _id: req.params.id }).lean()
        if (!story) return res.status(404).render('error/404', { pageTitle: 'Story not found' })
        if (String(story.user) !== String(req.user.id)) return res.redirect('/stories')
        res.render('stories/edit', { story, pageTitle: 'Edit story' })
    } catch (err) {
        console.error(err)
        res.status(err.name === 'CastError' ? 404 : 500).render(err.name === 'CastError' ? 'error/404' : 'error/500')
    }
})

router.put('/:id', ensureAuth, async (req, res) => {
    const values = { ...formValues(req.body), _id: req.params.id }
    try {
        const story = await Story.findById(req.params.id).lean()
        if (!story) return res.status(404).render('error/404', { pageTitle: 'Story not found' })
        if (String(story.user) !== String(req.user.id)) return res.redirect('/stories')
        if (!validStory(req.body)) return formFailure(res, 'stories/edit', values, 400, 'Add a title and story, and choose public or private before saving.')
        await Story.findOneAndUpdate({ _id: req.params.id, user: req.user.id }, formValues(req.body), { new: true, runValidators: true })
        req.session.notice = 'Your changes have been saved.'
        res.redirect('/dashboard')
    } catch (err) {
        console.error(err)
        return formFailure(res, 'stories/edit', values, 500, 'We couldn’t save your changes. Your words are still here. Please try again.')
    }
})

router.delete('/:id', ensureAuth, async (req, res) => {
    try {
        const result = await Story.deleteOne({ _id: req.params.id, user: req.user.id })
        if (!result.deletedCount) return res.status(404).render('error/404', { pageTitle: 'Story not found' })
        req.session.notice = 'Your story has been deleted.'
        res.redirect('/dashboard')
    } catch (err) {
        console.error(err)
        return res.status(500).render('error/500', { pageTitle: 'Something went wrong' })
    }
})

router.get('/user/:userId', ensureAuth, async (req, res) => {
    try {
        const author = await User.findById(req.params.userId).lean()
        if (!author) return res.status(404).render('error/404', { pageTitle: 'Author not found' })
        const stories = await Story.find({ user: req.params.userId, status: 'public' }).populate('user').lean()
        res.render('stories/index', { stories, authorName: author.displayName, pageTitle: 'Stories by ' + author.displayName })
    } catch (err) {
        console.error(err)
        res.status(err.name === 'CastError' ? 404 : 500).render(err.name === 'CastError' ? 'error/404' : 'error/500')
    }
})

module.exports = router
