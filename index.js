const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
// Support for dynamic CORS in production
const frontendURIs = [
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://192.168.1.7:3000",
    "https://drawmatrix.vercel.app" // Your target Vercel URL
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (frontendURIs.indexOf(origin) !== -1 || origin.includes("vercel.app")) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json());

const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config();

// Connect to MongoDB Atlas (via DB_URI env var) or fallback to local
const dbURI = process.env.DB_URI || 'mongodb://localhost:27017/arch-platform';
mongoose.connect(dbURI)
    .then((result) => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB Connection Error:', err));

app.use(authRoutes);

app.post('/upsert-user', async (req, res) => {
    const { email, username } = req.body;
    console.log(`Upserting user: ${email} (${username})`);
    try {
        const User = require('./models/User');
        let user = await User.findOne({ email });
        if (!user) {
            console.log(`Creating new user for ${email}`);
            user = await User.create({ 
                email, 
                username: username || email.split('@')[0],
                password: 'google-auth-placeholder-' + Math.random().toString(36)
            });
        } else {
            console.log(`User ${email} already exists`);
        }
        res.status(200).json(user);
    } catch (err) {
        console.error("Upsert error:", err);
        res.status(500).send("Error syncing user");
    }
});

// Serve static files (disabled for standalone signaling server on Render)
// const path = require('path');
// const clientBuildPath = path.join(__dirname, '../client/dist');
// app.use(express.static(clientBuildPath));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: frontendURIs,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const Project = require('./models/Project');
const Schedule = require('./models/Schedule');
const Message = require('./models/Message');

// --- Schedule API Routes ---

app.get('/api/schedules', async (req, res) => {
    const { projectId } = req.query;
    try {
        const query = projectId ? { projectId } : {};
        const schedules = await Schedule.find(query).sort({ date: 1, time: 1 });
        res.status(200).json(schedules);
    } catch (err) {
        console.error("Error fetching schedules:", err);
        res.status(500).send("Error fetching schedules");
    }
});

app.post('/api/schedules', async (req, res) => {
    const { title, date, time, type, projectId, createdBy } = req.body;
    try {
        const newSchedule = await Schedule.create({
            title,
            date,
            time,
            type,
            projectId: projectId || '1234567890',
            createdBy
        });
        res.status(201).json(newSchedule);
    } catch (err) {
        console.error("Error creating schedule:", err);
        res.status(500).send("Error creating schedule");
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    try {
        await Schedule.findByIdAndDelete(req.params.id);
        res.status(200).send("Schedule deleted");
    } catch (err) {
        console.error("Error deleting schedule:", err);
        res.status(500).send("Error deleting schedule");
    }
});

app.get('/api/messages', async (req, res) => {
    const { projectId } = req.query;
    try {
        const query = projectId ? { projectId } : {};
        const messages = await Message.find(query).sort({ createdAt: 1 }).limit(100);
        res.status(200).json(messages);
    } catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).send("Error fetching messages");
    }
});

// --- Project Management API Routes ---

app.get('/api/projects', async (req, res) => {
    const { ownerEmail } = req.query;
    if (!ownerEmail) return res.status(400).send("ownerEmail required");
    try {
        const projects = await Project.find({ ownerEmail }).sort({ updatedAt: -1 });
        res.status(200).json(projects);
    } catch (err) {
        console.error("Error fetching projects:", err);
        res.status(500).send("Error fetching projects");
    }
});

app.post('/api/projects/save', async (req, res) => {
    const { projectId, name, ownerEmail, objects, layers, config } = req.body;
    if (!projectId || !ownerEmail) return res.status(400).send("projectId and ownerEmail required");
    try {
        const project = await Project.findOneAndUpdate(
            { projectId },
            { 
                $set: { 
                    name, 
                    ownerEmail, 
                    objects, 
                    layers, 
                    config,
                    updatedAt: new Date()
                } 
            },
            { upsert: true, new: true }
        );
        res.status(200).json(project);
    } catch (err) {
        console.error("Error saving project:", err);
        res.status(500).send("Error saving project");
    }
});

app.patch('/api/projects/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { name } = req.body;
    try {
        const project = await Project.findOneAndUpdate(
            { projectId },
            { $set: { name, updatedAt: new Date() } },
            { new: true }
        );
        res.status(200).json(project);
    } catch (err) {
        console.error("Error renaming project:", err);
        res.status(500).send("Error renaming project");
    }
});

app.delete('/api/projects/:projectId', async (req, res) => {
    const { projectId } = req.params;
    try {
        await Project.deleteOne({ projectId });
        // Also clean up associated schedules and messages if desired
        await Schedule.deleteMany({ projectId });
        await Message.deleteMany({ projectId });
        res.status(200).send("Project deleted");
    } catch (err) {
        console.error("Error deleting project:", err);
        res.status(500).send("Error deleting project");
    }
});

app.get('/api/presence', (req, res) => {
    res.status(200).json(projectPresences);
});

// Presence tracking: { [projectId]: { [socketId]: presenceData } }
const projectPresences = {};

// Global fixed identity presence (used by schedules/editor pages).
const FIXED_IDENTITIES = ['Kovid', 'Vedanth', 'Mohith'];
let guestCounter = 1;
const presenceRegistry = new Map();

function getPresencePayload() {
    return Array.from(presenceRegistry.values()).map((entry) => ({
        userId: entry.userId,
        name: entry.name,
        status: entry.status,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
    }));
}

function broadcastPresence() {
    io.emit('presence_list', { users: getPresencePayload() });
}

function assignIdentityForClient(clientKey) {
    if (presenceRegistry.has(clientKey)) {
        return presenceRegistry.get(clientKey);
    }

    const currentCount = presenceRegistry.size;
    const name =
        currentCount < FIXED_IDENTITIES.length
            ? FIXED_IDENTITIES[currentCount]
            : `Guest-${guestCounter++}`;

    const now = new Date().toISOString();
    const identity = {
        userId: clientKey,
        name,
        status: 'offline',
        sockets: new Set(),
        firstSeen: now,
        lastSeen: now,
    };

    presenceRegistry.set(clientKey, identity);
    return identity;
}

function decodeContent(content) {
    try {
        const parsed = JSON.parse(content || '{}');
        return {
            objects: Array.isArray(parsed.objects) ? parsed.objects : [],
            layers: Array.isArray(parsed.layers) ? parsed.layers : [],
            activeLayerId: parsed.activeLayerId || null,
        };
    } catch (_err) {
        return { objects: [], layers: [], activeLayerId: null };
    }
}

function encodeContent(project) {
    if (project.content) return project.content;
    return JSON.stringify({
        objects: Array.isArray(project.objects) ? project.objects : [],
        layers: Array.isArray(project.layers) ? project.layers : [],
        activeLayerId: project.activeLayerId || null,
    });
}

// Compatibility endpoints for frontend project sync.
app.get('/projects', async (_req, res) => {
    try {
        const projects = await Project.find({}).sort({ updatedAt: -1 });
        res.status(200).json({
            projects: projects.map((project) => ({
                projectId: project.projectId,
                name: project.name,
                content: encodeContent(project),
                lastModified: project.lastModified || project.updatedAt || new Date(),
            })),
        });
    } catch (err) {
        console.error('Error fetching /projects:', err);
        res.status(500).json({ error: 'Error fetching projects' });
    }
});

app.get('/projects/:projectId', async (req, res) => {
    try {
        const project = await Project.findOne({ projectId: req.params.projectId });
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        return res.status(200).json({
            project: {
                projectId: project.projectId,
                name: project.name,
                content: encodeContent(project),
                lastModified: project.lastModified || project.updatedAt || new Date(),
            },
        });
    } catch (err) {
        console.error('Error fetching /projects/:projectId:', err);
        return res.status(500).json({ error: 'Error fetching project' });
    }
});

app.put('/projects/:projectId', async (req, res) => {
    const { name, content, lastModified } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const decoded = decodeContent(content || '{}');
    try {
        const project = await Project.findOneAndUpdate(
            { projectId: req.params.projectId },
            {
                $set: {
                    name,
                    ownerEmail: 'shared',
                    content: content || '{}',
                    objects: decoded.objects,
                    layers: decoded.layers,
                    activeLayerId: decoded.activeLayerId,
                    lastModified: lastModified ? new Date(lastModified) : new Date(),
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true }
        );

        return res.status(200).json({
            project: {
                projectId: project.projectId,
                name: project.name,
                content: encodeContent(project),
                lastModified: project.lastModified || project.updatedAt || new Date(),
            },
        });
    } catch (err) {
        console.error('Error saving /projects/:projectId:', err);
        return res.status(500).json({ error: 'Error saving project' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('presence_register', ({ clientKey }) => {
        if (!clientKey || typeof clientKey !== 'string') return;

        const identity = assignIdentityForClient(clientKey);
        identity.sockets.add(socket.id);
        identity.status = 'online';
        identity.lastSeen = new Date().toISOString();

        socket.data.clientKey = clientKey;
        socket.data.presenceName = identity.name;

        socket.emit('presence_identity', {
            userId: identity.userId,
            name: identity.name,
            status: identity.status,
        });

        broadcastPresence();
    });

    socket.on('join_project', async ({ projectId, userId, username }) => {
        socket.join(projectId);
        socket.data.projectId = projectId;
        socket.data.userId = userId || socket.data.clientKey || userId;
        socket.data.username = socket.data.presenceName || username || `User-${socket.id.slice(0, 4)}`;

        console.log(`[Socket] User ${socket.data.username} joined room: ${projectId}`);

        try {
            // Load or create project in DB
            let project = await Project.findOne({ projectId });
            if (!project) {
                project = await Project.create({
                    projectId,
                    name: "Untitled Project",
                    ownerEmail: "system", // Placeholder
                    objects: [],
                    layers: [{ id: 'layer-0', name: 'Default', visible: true, locked: false, color: '#ffffff', order: 0 }]
                });
            }
            
            // Send initial state to the user
            socket.emit('load_project', {
                objects: project.objects,
                layers: project.layers,
                projectName: project.name,
                config: project.config
            });

            // Immediate response with current room members
            if (projectPresences[projectId]) {
                socket.emit('room_presence_list', projectPresences[projectId]);
            }
        } catch (err) {
            console.error("Error joining project:", err);
        }
    });

    socket.on('presence-update', (data) => {
        const { projectId, userId, presence } = data;
        if (!projectId || !userId) return;

        if (!projectPresences[projectId]) {
            projectPresences[projectId] = {};
        }

        projectPresences[projectId][socket.id] = { userId, ...presence };
        socket.to(projectId).emit('presence-update', { userId, presence });
        io.to(projectId).emit('room_presence_list', projectPresences[projectId]);
    });

    // --- CAD Collaborative Events ---

    socket.on('create_object', async (data) => {
        const { projectId, payload } = data;
        console.log(`[CAD] Create: ${payload.type} (${payload.id}) in room ${projectId}`);
        socket.to(projectId).emit('create_object', { payload });
        
        try {
            await Project.findOneAndUpdate(
                { projectId },
                { $push: { objects: payload } }
            );
            console.log(`[DB] Created object ${payload.id} successfully`);
        } catch (err) {
            console.error(`[DB ERROR] Create object ${payload.id}:`, err);
        }
    });

    socket.on('transform_object', async (data) => {
        const { projectId, objectId, payload } = data;
        // Verbose logging for non-throttled transforms might be too much, but for debugging we log it
        // console.log(`[CAD] Transform: ${objectId} in room ${projectId}`);
        
        socket.to(projectId).emit('transform_object', { objectId, payload });

        try {
            await Project.updateOne(
                { projectId, "objects.id": objectId },
                { $set: { "objects.$.transform": payload.transform } }
            );
        } catch (err) {
            console.error(`[DB ERROR] Transform object ${objectId}:`, err);
        }
    });

    socket.on('delete_object', async (data) => {
        const { projectId, objectId } = data;
        socket.to(projectId).emit('delete_object', { objectId });

        try {
            await Project.findOneAndUpdate(
                { projectId },
                { $pull: { objects: { id: objectId } } }
            );
        } catch (err) {
            console.error("Error deleting object from DB:", err);
        }
    });

    socket.on('replace_geometry', async (data) => {
        const { projectId, objectId, geometryData } = data;
        socket.to(projectId).emit('replace_geometry', { objectId, geometryData });

        try {
            await Project.updateOne(
                { projectId, "objects.id": objectId },
                { $set: { "objects.$.geometryData": geometryData } }
            );
        } catch (err) {
            console.error("Error replacing geometry in DB:", err);
        }
    });

    socket.on('cursor_move', (data) => {
        const { projectId, ...cursorData } = data;
        socket.to(projectId).emit('remote_cursor_move', cursorData);
    });

    socket.on('send_message', async (data) => {
        const { projectId, user, text, time } = data;
        console.log(`[Chat] Message in room ${projectId} from ${user}: ${text}`);
        
        try {
            const newMessage = await Message.create({
                projectId,
                user,
                text,
                time
            });
            // Broadcast to everyone else in the room
            socket.to(projectId).emit('receive_message', newMessage);
        } catch (err) {
            console.error("Error saving message to DB:", err);
        }
    });

    socket.on('lock_object', async (data) => {
        const { projectId, objectId, userId } = data;
        console.log(`[CAD] Lock: ${objectId} by user ${userId} in room ${projectId}`);
        socket.to(projectId).emit('lock_object', { objectId, userId });
        try {
            await Project.updateOne(
                { projectId, "objects.id": objectId },
                { $set: { "objects.$.lockedBy": userId } }
            );
        } catch (err) {
            console.error(`[DB ERROR] Lock object ${objectId}:`, err);
        }
    });

    socket.on('unlock_object', async (data) => {
        const { projectId, objectId } = data;
        console.log(`[CAD] Unlock: ${objectId} in room ${projectId}`);
        socket.to(projectId).emit('unlock_object', { objectId, userId: null });
        try {
            await Project.updateOne(
                { projectId, "objects.id": objectId },
                { $set: { "objects.$.lockedBy": null } }
            );
        } catch (err) {
            console.error(`[DB ERROR] Unlock object ${objectId}:`, err);
        }
    });

    socket.on('disconnect', async () => {
        const { projectId, userId, username } = socket.data;

        const clientKey = socket.data?.clientKey;
        if (clientKey && presenceRegistry.has(clientKey)) {
            const identity = presenceRegistry.get(clientKey);
            identity.sockets.delete(socket.id);
            identity.status = identity.sockets.size > 0 ? 'online' : 'offline';
            identity.lastSeen = new Date().toISOString();
            broadcastPresence();
        }

        if (projectId && userId) {
            console.log(`[Socket] User ${username || socket.id} disconnected from project ${projectId}`);
            
            // Cleanup local presence tracking
            if (projectPresences[projectId]) {
                delete projectPresences[projectId][socket.id];
                if (Object.keys(projectPresences[projectId]).length === 0) {
                    delete projectPresences[projectId];
                }
                io.to(projectId).emit('presence-disconnect', userId);
                io.to(projectId).emit('room_presence_list', projectPresences[projectId] || {});
            }

            // UNLOCK objects held by this user across the database
            try {
                await Project.updateMany(
                    { projectId, "objects.lockedBy": userId },
                    { $set: { "objects.$[elem].lockedBy": null } },
                    { arrayFilters: [{ "elem.lockedBy": userId }] }
                );
                socket.to(projectId).emit('unlock_all_by_user', { userId });
            } catch (err) {
                console.error("Disconnect cleanup error:", err);
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// STABILITY HEARTBEAT: Prune stale presences every 30s
setInterval(() => {
    const activeSocketIds = Array.from(io.sockets.sockets.keys());
    for (const projectId in projectPresences) {
        for (const socketId in projectPresences[projectId]) {
            if (!activeSocketIds.includes(socketId)) {
                delete projectPresences[projectId][socketId];
            }
        }
        if (Object.keys(projectPresences[projectId]).length === 0) {
            delete projectPresences[projectId];
        } else {
            // Broadcast the cleaned list to the project
            io.to(projectId).emit('room_presence_list', projectPresences[projectId]);
        }
    }
}, 30000);

