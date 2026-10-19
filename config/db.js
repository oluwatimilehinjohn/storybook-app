const mongoose = require('mongoose')

const connectDB = async () => {
    try {
        console.log('Connecting to MongoDB')
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,
        })
        console.log('MongoDB connected')
    } catch {
        // Driver errors can include a connection string. Keep credentials out of logs.
        throw new Error('MongoDB connection failed. Check MONGO_URI, database-user credentials, and database network access for this service. No HTTP listener was started. Connection details have not been logged.')
    }
}

module.exports = connectDB
