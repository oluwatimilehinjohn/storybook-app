const { loadEnvironment } = require('./config/environment')
// Validate before initializing authentication, database connections, or HTTP.
let configuration
try {
    configuration = loadEnvironment()
} catch (error) {
    console.error(`Startup configuration error:\n${error.message}`)
    process.exit(1)
}

const express = require('express')
const mongoose = require('mongoose')
const morgan = require('morgan')
const exphbs = require('express-handlebars')
const methodOverride = require('method-override')
const passport = require('passport')
const session = require('express-session')
const MongoStore = require('connect-mongo')(session)
const connectDB = require('./config/db')
const { configurePresentation } = require('./config/presentation')

//passport config
require('./config/passport')(passport)

const app = express()
configurePresentation(app)
// Render terminates HTTPS at its reverse proxy.
if (configuration.isProduction) app.set('trust proxy', 1)

//body parser
app.use(express.urlencoded({ extended: false }))
app.use(express.json())

//method override
app.use(methodOverride(function (req, res) {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    // look in urlencoded POST bodies and delete it
    var method = req.body._method
    delete req.body._method
    return method
  }
}))
//logging
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'))
}

//handlebars helpers
const helpers = require('./helpers/hbs')

//handlebars
app.engine('.hbs', exphbs.engine({
    helpers, defaultLayout: 'main', extname: '.hbs'
}));
app.set('view engine', '.hbs');

//sessions
app.use(session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
    cookie: {
        httpOnly: true,
        secure: configuration.isProduction,
        sameSite: 'lax'
    },
    store: new MongoStore({ mongooseConnection: mongoose.connection })
}))

//passport middleware
app.use(passport.initialize())
app.use(passport.session())

//set global variable
app.use(function (req, res, next){
    res.locals.user = req.user
    res.locals.activeNav = req.path === '/dashboard' ? 'dashboard' : req.path.startsWith('/stories') && !req.path.startsWith('/stories/add') && !req.path.startsWith('/stories/edit') ? 'stories' : ''
    next()
})
//routes
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth'))
app.use('/stories', require('./routes/stories'))
app.use('/auth', require('./middleware/auth-error'))

app.use((req, res) => res.status(404).render('error/404', { pageTitle: 'Page not found' }))
app.use((err, req, res, next) => {
    console.error(err)
    if (res.headersSent) return next(err)
    res.status(500).render('error/500', { pageTitle: 'Something went wrong' })
})

// Only accept requests once the real database connection is established.
connectDB()
    .then(() => {
        const server = app.listen(configuration.port, '0.0.0.0', () => {
            console.log(`Server listening on port ${configuration.port}`)
        })
        server.on('error', () => {
            console.error('HTTP startup failed. Check PORT and whether another process is using it.')
            process.exit(1)
        })
    })
    .catch(error => {
        console.error(error.message)
        process.exit(1)
    })
