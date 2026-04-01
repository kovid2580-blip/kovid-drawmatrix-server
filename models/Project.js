const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    projectId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    ownerEmail: { type: String, required: true },
    objects: { type: Array, default: [] },
    layers: { type: Array, default: [] },
    config: {
        unitSystem: { type: String, default: "metric" },
        gridSpacing: { type: Number, default: 1 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
