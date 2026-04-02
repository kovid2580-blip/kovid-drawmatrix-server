require('dotenv').config();
const dns = require('dns');
if (dns && dns.setServers) {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Initialize frontendURIs AFTER dotenv.config() to ensure process.env.FRONTEND_URL is available
const frontendURIs = [
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://192.168.1.7:3000",
    "https://drawmatrixreference.vercel.app"
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
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

// Improved MongoDB Connection Logic for Render/Atlas
let dbURI = process.env.MONGODB_URI || process.env.DB_URI || 'mongodb://localhost:27017/arch-platform';

// Ensure standard retry logic is appended for replica sets if missing
if (dbURI.includes("mongodb.net") && !dbURI.includes("retryWrites=")) {
    const separator = dbURI.includes("?") ? "&" : "?";
    dbURI += `${separator}retryWrites=true&w=majority`;
}

mongoose.connect(dbURI, {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000,        // Close sockets after 45s of inactivity
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    if (err.message.includes('ReplicaSetNoPrimary')) {
        console.error('💡 TIP: Check if Render IP is whitelisted (0.0.0.0/0) in MongoDB Atlas');
    }
});

app.use(authRoutes);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: frontendURIs,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const Project = require('./models/Project');

// Compatibility endpoints for Projects Dashboard
app.get('/projects', async (_req, res) => {
    try {
        const projects = await Project.find({}).sort({ updatedAt: -1 });
        res.status(200).json({
            projects: projects.map((project) => ({
                projectId: project.projectId,
                name: project.name,
                content: project.content || JSON.stringify({ objects: project.objects }),
                lastModified: project.lastModified || project.updatedAt || new Date(),
            })),
        });
    } catch (err) {
        console.error('Error fetching /projects:', err);
        res.status(500).json({ error: 'Error fetching projects' });
    }
});

app.delete('/projects/:projectId', async (req, res) => {
    try {
        await Project.deleteOne({ projectId: req.params.projectId });
        res.status(200).send("Project deleted");
    } catch (err) {
        res.status(500).send("Error deleting project");
    }
});

// 🔹 BACKBONE: Minimal Room State
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 🔹 JOIN ROOM (Backbone)
    socket.on('join-room', async ({ roomId, username }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                hostId: socket.id,
                users: [],
            };
        }

        rooms[roomId].users.push(socket.id);
        const room = rooms[roomId];

        try {
            // Load state from DB for persistence
            let project = await Project.findOne({ projectId: roomId });
            if (!project) {
                project = await Project.create({
                    projectId: roomId,
                    name: username ? `${username}'s Sheet` : "Untitled Sheet",
                    ownerEmail: "shared",
                    objects: [],
                });
            }

            // Backbone Sync Init
            socket.emit('init', {
                hostId: room.hostId,
                canvasState: project.objects,
                projectName: project.name,
            });

            io.to(roomId).emit('user-list', room.users);
        } catch (err) {
            console.error("Error in join-room:", err);
        }
    });

    // 🔹 DRAW EVENT (ONLY HOST - Backbone)
    socket.on('draw', async ({ roomId, shape }) => {
        const room = rooms[roomId];
        if (!room) return;

        if (socket.id !== room.hostId) {
            console.warn(`Blocked draw attempt from non-host: ${socket.id}`);
            return;
        }

        // Persist to DB
        try {
            await Project.findOneAndUpdate(
                { projectId: roomId },
                { $push: { objects: shape }, $set: { updatedAt: new Date() } }
            );
            // Broadcast to viewers
            socket.to(roomId).emit('draw', shape);
        } catch (err) {
            console.error("Error persisting draw:", err);
        }
    });

    // 🔹 CLEAR CANVAS (ONLY HOST - Backbone)
    socket.on('clear-canvas', async ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;

        try {
            await Project.findOneAndUpdate({ projectId: roomId }, { $set: { objects: [] } });
            io.to(roomId).emit('clear-canvas');
        } catch (err) {
            console.error("Error clearing canvas:", err);
        }
    });

    // 🔹 TRANSFER HOST (ONLY HOST - Backbone)
    socket.on('transfer-host', ({ roomId, newHostId }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;

        room.hostId = newHostId;
        io.to(roomId).emit('host-changed', newHostId);
    });

    // 🔹 DISCONNECT (Backbone)
    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);

        for (let roomId in rooms) {
            const room = rooms[roomId];
            room.users = room.users.filter((id) => id !== socket.id);

            // If host leaves → assign new host
            if (room.hostId === socket.id && room.users.length > 0) {
                room.hostId = room.users[0];
                io.to(roomId).emit('host-changed', room.hostId);
            }

            io.to(roomId).emit('user-list', room.users);

            if (room.users.length === 0) {
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
