const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema({
    googleId: {
        type: String,
        required: true
    },
    displayName: {
        type: String,
        required: true
    },
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        // Google profiles do not always include a family name.
        default: ''
    },
    image: {
        type: String,
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
})

module.exports =mongoose.model('User', UserSchema)
