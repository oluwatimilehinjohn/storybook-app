const moment = require('moment')
const { escapeExpression } = require('handlebars')

const stripTags = (input = '') => String(input).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()

module.exports = {
    formatDate: (date, format) => date ? moment(date).format(format) : '',
    truncate: (input = '', length) => {
        const text = String(input)
        if (text.length <= length) return text
        const cut = text.slice(0, length)
        const space = cut.lastIndexOf(' ')
        return cut.slice(0, space > length / 2 ? space : length) + '…'
    },
    stripTags,
    eq: (left, right) => String(left) === String(right),
    readingTime: (body) => Math.max(1, Math.ceil(stripTags(body).split(/\s+/).filter(Boolean).length / 200)),
    editIcon: (storyUser, loggedUser, storyId, floating = true) => {
        if (!storyUser || !loggedUser || String(storyUser._id) !== String(loggedUser._id)) return ''
        const href = '/stories/edit/' + escapeExpression(String(storyId))
        return floating === false
            ? '<a href="' + href + '" class="text-link"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edit story</a>'
            : '<a href="' + href + '" class="icon-button" aria-label="Edit story" title="Edit story"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></a>'
    },
    select: function (selected, options) {
        return options.fn(this).replace(/ selected(?:="selected")?/g, '').replace(
            'value="' + escapeExpression(selected) + '"',
            'value="' + escapeExpression(selected) + '" selected'
        )
    }
}
