const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    time: {
        type: String,
        required: true
    },
    type: {
        type: String,
        default: 'Meeting'
    },
    projectId: {
        type: String,
        default: '1234567890' // Matching the hardcoded ROOM_ID in frontend for now
    },
    createdBy: {
        type: String // email
    }
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);
