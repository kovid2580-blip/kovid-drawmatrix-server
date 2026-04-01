const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    projectId: {
        type: String,
        required: true,
        index: true
    },
    user: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    time: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
