const path = require('path')
const express = require('express')
const mongoose = require('mongoose')
const dotenv = require('dotenv')
const morgan = require('morgan')
const exphbs = require('express-handlebars')
const methodOverride = require('method-override')
const passport = require('passport')
const session = require('express-session')
const MongoStore = require('connect-mongo')(session)
const connectDB = require('./config/db')



//load config
dotenv.config({ path: './config/config.env' })

const requiredEnvironment = ['MONGO_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'SESSION_SECRET']
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name])
if (missingEnvironment.length) {
    throw new Error(`Missing configuration: ${missingEnvironment.join(', ')}. Set hosting environment variables or copy config/config.env.example to config/config.env.`)
}

//passport config
require('./config/passport')(passport)

connectDB()

const app = express()

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
//static folder
app.use(express.static(path.join(__dirname, 'public')))

//routes
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth'))
app.use('/stories', require('./routes/stories'))

app.use((req, res) => res.status(404).render('error/404', { pageTitle: 'Page not found' }))
app.use((err, req, res, next) => {
    console.error(err)
    if (res.headersSent) return next(err)
    res.status(500).render('error/500', { pageTitle: 'Something went wrong' })
})

const PORT = process.env.PORT

app.listen(
    PORT, console.log(`server running in ${process.env.NODE_ENV} mode on port ${PORT}`))
