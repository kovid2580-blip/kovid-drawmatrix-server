const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
// Support for dynamic CORS in production
const frontendURIs = [
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://192.168.1.7:3000"
].filter(Boolean);

app.use(cors({
    origin: frontendURIs,
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

// Presence tracking: { [projectId]: { [socketId]: presenceData } }
const projectPresences = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_project', (projectId) => {
        socket.join(projectId);
        console.log(`User ${socket.id} joined project ${projectId}`);
        
        // Immediate response with current room members
        if (projectPresences[projectId]) {
            socket.emit('room_presence_list', projectPresences[projectId]);
        }
    });

    socket.on('presence-update', (data) => {
        const { projectId, userId, presence } = data;
        console.log(`Presence update for user ${userId} in project ${projectId}`);
        if (!projectId || !userId) return;

        if (!projectPresences[projectId]) {
            projectPresences[projectId] = {};
        }

        projectPresences[projectId][socket.id] = { userId, ...presence };
        socket.to(projectId).emit('presence-update', { userId, presence });
        io.to(projectId).emit('room_presence_list', projectPresences[projectId]);
        console.log(`Current users in ${projectId}:`, Object.keys(projectPresences[projectId]).length);
    });

    socket.on('draw_event', (data) => {
        const { projectId, ...eventData } = data;
        socket.to(projectId).emit('remote_draw_event', eventData);
    });

    socket.on('cursor_move', (data) => {
        const { projectId, ...cursorData } = data;
        socket.to(projectId).emit('remote_cursor_move', cursorData);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const projectId in projectPresences) {
            if (projectPresences[projectId][socket.id]) {
                const userId = projectPresences[projectId][socket.id].userId;
                delete projectPresences[projectId][socket.id];
                if (Object.keys(projectPresences[projectId]).length === 0) {
                    delete projectPresences[projectId];
                }
                io.to(projectId).emit('presence-disconnect', userId);
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

