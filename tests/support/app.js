// Test-only in-memory fixtures. This server is never imported by the application.
const express = require('express')
const path = require('node:path')
const exphbs = require('express-handlebars')
const methodOverride = require('method-override')
const Story = require('../../models/Story')
const User = require('../../models/User')
const helpers = require('../../helpers/hbs')
const { configurePresentation } = require('../../config/presentation')

const owner = { _id: '507f1f77bcf86cd799439011', id: '507f1f77bcf86cd799439011', firstName: 'Alex', displayName: 'Alex Morgan' }
const other = { _id: '507f1f77bcf86cd799439012', id: '507f1f77bcf86cd799439012', firstName: 'Jamie', displayName: 'Jamie Park' }
let records
let failWrites = false
const reset = () => {
    failWrites = false
    records = [
        { _id: '507f191e810c19729de860ea', title: 'The quiet magic of a Sunday morning', body: '<p>There was no alarm that morning. Just the light through the curtains and the distant sound of someone making coffee.</p><p>I had forgotten what it felt like to have nowhere to be. To sit with a warm cup and let the day unfold at its own pace.</p><h2>A little room to breathe</h2><p>Maybe the moments we remember are the ones we almost overlook.</p>', status: 'public', user: owner._id, createdAt: new Date('2026-10-18') },
        { _id: '507f191e810c19729de860eb', title: 'A letter to my future self', body: '<p>I hope you still take the long way home sometimes. I hope you remember why you started, and give yourself permission to begin again.</p>', status: 'private', user: owner._id, createdAt: new Date('2026-10-15') },
        { _id: '507f191e810c19729de860ec', title: 'What the garden taught me', body: '<p>We planted the seeds in April, when the ground was still cold. All summer I learned to wait, to notice, and to trust small beginnings.</p>', status: 'public', user: owner._id, createdAt: new Date('2026-10-12') },
        { _id: '507f191e810c19729de860ed', title: 'Finding home in an unfamiliar city', body: '<p>At first, every street was a wrong turn. Then there was a familiar face at the bakery and a favourite bench by the river.</p>', status: 'public', user: other._id, createdAt: new Date('2026-10-10') }
    ]
}
reset()
const matches = (record, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(record, part))
    if (value instanceof RegExp) return value.test(record[key])
    if (value instanceof Date) return +record[key] === +value
    if (value && typeof value === 'object' && '$lt' in value) return record[key] < value.$lt
    return String(record[key]) === String(value)
})
const query = (value) => {
    let populated = false
    const result = {
        populate() { populated = true; return result },
        sort() { if (Array.isArray(value)) value.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id)); return result },
        limit(count) { value = value.slice(0, count); return result },
        async lean() {
            const copy = item => item ? { ...item, user: populated ? (item.user === owner._id ? owner : other) : item.user } : null
            return Array.isArray(value) ? value.map(copy) : copy(value)
        }
    }
    return result
}
Story.find = filter => query(records.filter(record => matches(record, filter)))
Story.findOne = filter => query(records.find(record => matches(record, filter)))
Story.findById = id => query(records.find(record => record._id === id))
Story.create = async values => {
    if (failWrites) throw new Error('Simulated storage failure')
    const story = { ...values, _id: '507f191e810c19729de860ee', createdAt: new Date() }
    records.push(story)
    return story
}
Story.findOneAndUpdate = async (filter, values) => {
    if (failWrites) throw new Error('Simulated storage failure')
    const story = records.find(record => matches(record, filter))
    if (story) Object.assign(story, values)
    return story
}
Story.deleteOne = async filter => {
    const index = records.findIndex(record => matches(record, filter))
    if (index === -1) return { deletedCount: 0 }
    records.splice(index, 1)
    return { deletedCount: 1 }
}
User.findById = id => ({ lean: async () => [owner, other].find(user => user._id === id) })

const createApp = () => {
    const app = express()
    configurePresentation(app)
    app.engine('.hbs', exphbs.engine({ helpers, defaultLayout: 'main', extname: '.hbs' }))
    app.set('view engine', '.hbs')
    app.set('views', path.resolve(__dirname, '../../views'))
    app.use(express.urlencoded({ extended: false }))
    app.use(methodOverride(req => req.body?._method))
    const session = {}
    app.use((req, res, next) => {
        req.user = req.headers['x-test-user'] === 'guest' || req.path === '/' ? undefined : req.headers['x-test-user'] === 'other' ? other : owner
        req.isAuthenticated = () => Boolean(req.user)
        req.session = session
        res.locals.user = req.user
        res.locals.activeNav = req.path === '/dashboard' ? 'dashboard' : req.path === '/stories' ? 'stories' : ''
        next()
    })
    app.get('/test/empty', (req, res) => res.render('dashboard', { name: owner.firstName, stories: [], pageTitle: 'My stories' }))
    app.get('/test/error', (req, res) => res.status(500).render('error/500'))
    app.get('/test/feed', (req, res) => {
        reset()
        for (let i = 0; i < 48; i++) records.push({ _id: (1000 + i).toString(16).padStart(24, '0'), title: 'Community moment ' + i, body: '<p>A small moment from the community, with a fresh perspective and something worth remembering.</p>', status: 'public', user: other._id, createdAt: new Date('2026-09-01') })
        res.redirect('/stories')
    })
    app.get('/test/reference/:name', (req, res) => {
        if (!/^[a-z0-9-]+\.png$/.test(req.params.name)) return res.sendStatus(404)
        res.sendFile(path.resolve(__dirname, '../../.preview', req.params.name))
    })
    app.use('/', require('../../routes/index'))
    app.use('/stories', require('../../routes/stories'))
    app.use((req, res) => res.status(404).render('error/404'))
    return app
}

module.exports = { createApp, reset, owner, other, records: () => records, failWrites: value => { failWrites = value } }

if (require.main === module) {
    createApp().listen(4173, '127.0.0.1', () => console.log('TEST FIXTURES ONLY: http://127.0.0.1:4173 (no database or Google sign-in)'))
}
