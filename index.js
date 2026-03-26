const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config();

const dbURI = process.env.DB_URI || 'mongodb://localhost:27017/arch-platform';
mongoose.connect(dbURI)
    .then((result) => console.log('Connected to MongoDB'))
    .catch((err) => console.log(err));

app.use(authRoutes);

// Serve static files (disabled for standalone signaling server on Render)
// const path = require('path');
// const clientBuildPath = path.join(__dirname, '../client/dist');
// app.use(express.static(clientBuildPath));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for production collaboration
        methods: ["GET", "POST"]
    }
});


io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_project', (projectId) => {
        socket.join(projectId);
        console.log(`User ${socket.id} joined project ${projectId}`);
    });

    socket.on('draw_event', (data) => {
        // Broadcast to everyone else in the room
        const { projectId, ...eventData } = data;
        socket.to(projectId).emit('remote_draw_event', eventData);
    });

    socket.on('cursor_move', (data) => {
        const { projectId, ...cursorData } = data;
        socket.to(projectId).emit('remote_cursor_move', cursorData);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

