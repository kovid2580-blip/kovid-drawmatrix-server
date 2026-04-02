const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    projectId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    ownerEmail: { type: String, required: true, default: 'shared' },
    objects: { type: Array, default: [] },
    layers: { type: Array, default: [] },
    // Compatibility fields for newer frontend sync route (/projects)
    content: { type: String, default: '' },
    lastModified: { type: Date, default: Date.now },
    activeLayerId: { type: String, default: null },
    config: {
        unitSystem: { type: String, default: "metric" },
        gridSpacing: { type: Number, default: 1 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
