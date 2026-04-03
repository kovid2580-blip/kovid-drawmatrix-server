require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "projects.json");

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://drawmatrixreference.vercel.app",
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (
      allowedOrigins.includes(origin) ||
      origin.includes("vercel.app") ||
      origin.includes("localhost")
    ) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
  },
});

const roomPresence = {};
const roomMessages = {};
const roomLocks = {};

const ensureDataStore = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
};

const readProjects = () => {
  ensureDataStore();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to read projects.json:", error);
    return [];
  }
};

const writeProjects = (projects) => {
  ensureDataStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2), "utf8");
};

const normalizeProject = (project = {}) => {
  const now = new Date().toISOString();

  return {
    projectId: project.projectId || project.id || Math.random().toString(36).slice(2, 10),
    name: project.name || "Untitled Sheet",
    ownerEmail: project.ownerEmail || "guest",
    content:
      project.content ||
      JSON.stringify({
        objects: Array.isArray(project.objects) ? project.objects : [],
        layers: Array.isArray(project.layers) ? project.layers : [],
        activeLayerId: project.activeLayerId || "layer-0",
      }),
    objects: Array.isArray(project.objects) ? project.objects : [],
    layers: Array.isArray(project.layers) ? project.layers : [],
    config: project.config || {},
    createdAt: project.createdAt || now,
    updatedAt: project.updatedAt || now,
    lastModified: project.lastModified || project.updatedAt || now,
  };
};

const listProjects = (ownerEmail) => {
  const projects = readProjects().map(normalizeProject);
  const filtered = ownerEmail
    ? projects.filter((project) => project.ownerEmail === ownerEmail)
    : projects;

  return filtered.sort(
    (a, b) =>
      new Date(b.lastModified || b.updatedAt).getTime() -
      new Date(a.lastModified || a.updatedAt).getTime()
  );
};

const getProject = (projectId) => {
  return readProjects().map(normalizeProject).find((project) => project.projectId === projectId) || null;
};

const saveProjectRecord = (projectInput) => {
  const incoming = normalizeProject(projectInput);
  const projects = readProjects().map(normalizeProject);
  const existingIndex = projects.findIndex(
    (project) => project.projectId === incoming.projectId
  );
  const now = new Date().toISOString();

  const existing = existingIndex >= 0 ? projects[existingIndex] : null;
  const merged = normalizeProject({
    ...existing,
    ...incoming,
    createdAt: existing?.createdAt || incoming.createdAt || now,
    updatedAt: now,
    lastModified: incoming.lastModified || now,
  });

  if (existingIndex >= 0) {
    projects[existingIndex] = merged;
  } else {
    projects.push(merged);
  }

  writeProjects(projects);
  return merged;
};

const deleteProjectRecord = (projectId) => {
  const projects = readProjects().map(normalizeProject);
  const nextProjects = projects.filter((project) => project.projectId !== projectId);

  if (nextProjects.length === projects.length) {
    return false;
  }

  writeProjects(nextProjects);
  return true;
};

const patchProjectRecord = (projectId, updates) => {
  const existing = getProject(projectId);
  if (!existing) {
    return null;
  }

  return saveProjectRecord({
    ...existing,
    ...updates,
    projectId,
    lastModified: new Date().toISOString(),
  });
};

const parseSnapshot = (content) => {
  if (!content) {
    return { objects: [], layers: [], activeLayerId: "layer-0" };
  }

  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return {
      objects: Array.isArray(parsed.objects) ? parsed.objects : [],
      layers: Array.isArray(parsed.layers) ? parsed.layers : [],
      activeLayerId: parsed.activeLayerId || "layer-0",
    };
  } catch (error) {
    console.error("Failed to parse project snapshot:", error);
    return { objects: [], layers: [], activeLayerId: "layer-0" };
  }
};

const emitPresenceList = (projectId) => {
  io.to(projectId).emit("room_presence_list", roomPresence[projectId] || {});
};

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/presence", (_req, res) => {
  res.status(200).json(roomPresence);
});

app.get("/get-users", (_req, res) => {
  res.status(200).json([]);
});

app.get("/api/projects", (req, res) => {
  const projects = listProjects(req.query.ownerEmail);
  res.status(200).json(projects);
});

app.get("/projects", (req, res) => {
  const projects = listProjects(req.query.ownerEmail);
  res.status(200).json({ projects });
});

app.get("/api/projects/:projectId", (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json(project);
});

app.get("/projects/:projectId", (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json({ project });
});

app.post("/api/projects/save", (req, res) => {
  const payload = req.body || {};
  const snapshot = parseSnapshot(payload.objects || payload.content);

  const project = saveProjectRecord({
    projectId: payload.projectId,
    name: payload.name,
    ownerEmail: payload.ownerEmail,
    content: payload.objects || payload.content,
    objects: snapshot.objects,
    layers: payload.layers || snapshot.layers,
    config: payload.config || {},
    lastModified: new Date().toISOString(),
  });

  res.status(200).json({ project });
});

app.put("/api/projects/:projectId", (req, res) => {
  const payload = req.body || {};
  const snapshot = parseSnapshot(payload.content);

  const project = saveProjectRecord({
    projectId: req.params.projectId,
    name: payload.name,
    ownerEmail: payload.ownerEmail,
    content: payload.content,
    objects: snapshot.objects,
    layers: snapshot.layers,
    lastModified: payload.lastModified || new Date().toISOString(),
  });

  res.status(200).json({ project });
});

app.patch("/api/projects/:projectId", (req, res) => {
  const project = patchProjectRecord(req.params.projectId, {
    name: req.body?.name,
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json({ project });
});

app.delete("/api/projects/:projectId", (req, res) => {
  const deleted = deleteProjectRecord(req.params.projectId);
  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  delete roomPresence[req.params.projectId];
  delete roomMessages[req.params.projectId];
  delete roomLocks[req.params.projectId];

  res.status(200).json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join_project", (payload) => {
    const projectId = typeof payload === "string" ? payload : payload?.projectId;
    if (!projectId) {
      return;
    }

    const userId =
      (typeof payload === "object" && payload?.userId) || socket.id;
    const username =
      (typeof payload === "object" && payload?.username) || "Guest";

    socket.join(projectId);
    socket.data.projectId = projectId;
    socket.data.userId = userId;

    if (!roomPresence[projectId]) {
      roomPresence[projectId] = {};
    }

    roomPresence[projectId][userId] = {
      id: userId,
      userId,
      name: username,
      color: "#38bdf8",
      cursor: null,
      cameraPosition: [0, 0, 0],
    };

    const project = getProject(projectId) || saveProjectRecord({ projectId, name: "Untitled Sheet" });
    const snapshot = parseSnapshot(project.content);

    socket.emit("load_project", {
      projectId: project.projectId,
      projectName: project.name,
      objects: snapshot.objects,
      layers: snapshot.layers,
      activeLayerId: snapshot.activeLayerId,
    });

    emitPresenceList(projectId);
    socket.emit("message_history", roomMessages[projectId] || []);
  });

  socket.on("presence-update", ({ projectId, userId, presence }) => {
    if (!projectId || !userId || !presence) {
      return;
    }

    if (!roomPresence[projectId]) {
      roomPresence[projectId] = {};
    }

    roomPresence[projectId][userId] = {
      ...roomPresence[projectId][userId],
      ...presence,
      id: userId,
      userId,
    };

    io.to(projectId).emit("presence-update", { userId, presence: roomPresence[projectId][userId] });
    emitPresenceList(projectId);
  });

  socket.on("send_message", (message) => {
    const projectId = message?.projectId || socket.data.projectId;
    if (!projectId) {
      return;
    }

    if (!roomMessages[projectId]) {
      roomMessages[projectId] = [];
    }

    roomMessages[projectId].push(message);
    io.to(projectId).emit("receive_message", message);
  });

  socket.on("create_object", ({ projectId, payload }) => {
    if (!projectId || !payload) {
      return;
    }

    const project = getProject(projectId) || saveProjectRecord({ projectId, name: "Untitled Sheet" });
    const snapshot = parseSnapshot(project.content);
    snapshot.objects.push(payload);

    saveProjectRecord({
      ...project,
      projectId,
      content: JSON.stringify({
        ...snapshot,
        objects: snapshot.objects,
        layers: snapshot.layers,
      }),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("create_object", { payload });
  });

  socket.on("delete_object", ({ projectId, objectId }) => {
    if (!projectId || !objectId) {
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.filter((object) => object.id !== objectId);

    saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    io.to(projectId).emit("delete_object", { objectId });
  });

  socket.on("transform_object", ({ projectId, objectId, payload }) => {
    if (!projectId || !objectId || !payload?.transform) {
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId
        ? { ...object, transform: payload.transform }
        : object
    );

    saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("transform_object", { objectId, payload });
  });

  socket.on("update_property", ({ projectId, objectId, payload }) => {
    if (!projectId || !objectId || !payload?.properties) {
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId
        ? { ...object, properties: payload.properties }
        : object
    );

    saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("update_property", { objectId, payload });
  });

  socket.on("replace_geometry", ({ projectId, objectId, geometryData }) => {
    if (!projectId || !objectId) {
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId ? { ...object, geometryData } : object
    );

    saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("replace_geometry", { objectId, geometryData });
  });

  socket.on("lock_object", ({ projectId, objectId, userId }) => {
    if (!projectId || !objectId || !userId) {
      return;
    }

    if (!roomLocks[projectId]) {
      roomLocks[projectId] = {};
    }

    roomLocks[projectId][objectId] = userId;
    io.to(projectId).emit("lock_object", { objectId, userId });
  });

  socket.on("unlock_object", ({ projectId, objectId }) => {
    if (!projectId || !objectId) {
      return;
    }

    if (roomLocks[projectId]) {
      delete roomLocks[projectId][objectId];
    }

    io.to(projectId).emit("unlock_object", { objectId });
  });

  socket.on("disconnect", () => {
    const { projectId, userId } = socket.data || {};

    if (projectId && userId && roomPresence[projectId]) {
      delete roomPresence[projectId][userId];
      io.to(projectId).emit("presence-disconnect", userId);
      io.to(projectId).emit("unlock_all_by_user", { userId });
      emitPresenceList(projectId);
    }
  });
});

server.listen(PORT, () => {
  ensureDataStore();
  console.log(`DrawMatrix server listening on port ${PORT}`);
});
