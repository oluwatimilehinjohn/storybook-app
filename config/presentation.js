const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')

const publicDirectory = path.join(__dirname, '../public')
const files = {
    materialize: '/vendor/materialize/1.0.0/materialize.min.css',
    icons: '/vendor/fontawesome/6.2.1/css/all.min.css',
    styles: '/css/style.css',
    app: '/js/app.js',
    feed: '/js/feed.js',
    editor: '/vendor/ckeditor/35.4.0/ckeditor.js'
}
const assets = Object.fromEntries(Object.entries(files).map(([name, url]) => {
    const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(publicDirectory, url))).digest('hex').slice(0, 12)
    return [name, `${url}?v=${version}`]
}))
const version = crypto.createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12)

function configurePresentation(app) {
    app.locals.assets = assets
    app.set('views', path.join(__dirname, '../views'))
    app.use((req, res, next) => {
        res.setHeader('X-Storybooks-UI', version)
        next()
    })
    // Serve styling before session/Passport middleware, including on error pages.
    app.use(express.static(publicDirectory, { maxAge: 0, etag: true }))
    app.use((req, res, next) => {
        // Signed-in HTML must not be reused for another account or an old deploy.
        res.setHeader('Cache-Control', 'no-store')
        next()
    })
}

module.exports = { configurePresentation, assets }
