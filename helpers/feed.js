const PAGE_SIZE = 12

function feedOptions(query) {
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) {
        return { error: 'Search with a title of 100 characters or fewer.' }
    }
    const search = (query.q || '').trim()
    const filter = { status: 'public' }
    if (search) filter.title = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (query.before !== undefined) {
        const match = typeof query.before === 'string' && query.before.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([a-f0-9]{24})$/)
        const date = match && new Date(match[1])
        if (!match || !Number.isFinite(date.getTime()) || date.toISOString() !== match[1]) {
            return { search, error: 'This feed link has expired or is invalid. Start again with the latest stories.' }
        }
        filter.$or = [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: match[2] } }]
    }
    return { search, filter }
}

function nextFeedUrl(story, search) {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    params.set('before', new Date(story.createdAt).toISOString() + '_' + story._id)
    return '/stories?' + params.toString()
}

module.exports = { PAGE_SIZE, feedOptions, nextFeedUrl }
