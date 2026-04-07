require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3001);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "drawmatrix";
const IS_RENDER =
  Boolean(process.env.RENDER) || Boolean(process.env.RENDER_SERVICE_ID);
const REQUIRE_MONGODB =
  process.env.REQUIRE_MONGODB === "true" ||
  process.env.NODE_ENV === "production" ||
  IS_RENDER;
const DATA_DIR = path.join(__dirname, "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SCHEDULES_FILE = path.join(DATA_DIR, "schedules.json");

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
const roomLocks = {};
let mongoClient = null;
let mongoDb = null;
let mongoConnectionError = null;
const RESERVED_USER_NAMES = ["Kovid", "Vedanth", "Mohith"];

const ensureDataStore = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  [
    [PROJECTS_FILE, []],
    [USERS_FILE, []],
    [MESSAGES_FILE, {}],
    [SCHEDULES_FILE, []],
  ].forEach(([filePath, initialValue]) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(initialValue, null, 2), "utf8");
    }
  });
};

const readJsonFile = (filePath, fallbackValue) => {
  ensureDataStore();

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    console.error(`Failed to read ${path.basename(filePath)}:`, error);
    return fallbackValue;
  }
};

const writeJsonFile = (filePath, value) => {
  ensureDataStore();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
};

const readProjects = () => {
  const parsed = readJsonFile(PROJECTS_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
};

const writeProjects = (projects) => {
  writeJsonFile(PROJECTS_FILE, projects);
};

const readUsers = () => {
  const parsed = readJsonFile(USERS_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
};

const writeUsers = (users) => {
  writeJsonFile(USERS_FILE, users);
};

const readMessages = () => {
  const parsed = readJsonFile(MESSAGES_FILE, {});
  return parsed && typeof parsed === "object" ? parsed : {};
};

const writeMessages = (messages) => {
  writeJsonFile(MESSAGES_FILE, messages);
};

const readSchedules = () => {
  const parsed = readJsonFile(SCHEDULES_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
};

const writeSchedules = (schedules) => {
  writeJsonFile(SCHEDULES_FILE, schedules);
};

const connectMongo = async () => {
  if (mongoDb) {
    return mongoDb;
  }

  if (!MONGODB_URI) {
    const missingUriError = new Error(
      "MongoDB Atlas is required, but MONGODB_URI is not set."
    );

    if (REQUIRE_MONGODB) {
      mongoConnectionError = missingUriError;
      throw missingUriError;
    }

    mongoConnectionError = null;
    console.warn("MONGODB_URI is not set. Falling back to JSON storage for local development.");
    return null;
  }

  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB);
    mongoConnectionError = null;
    console.log(`MongoDB connected to database "${MONGODB_DB}"`);
    return mongoDb;
  } catch (error) {
    mongoConnectionError = error;
    mongoClient = null;
    mongoDb = null;

    if (REQUIRE_MONGODB) {
      throw error;
    }

    console.error("MongoDB connection failed, falling back to JSON storage:", error);
    return null;
  }
};

const usingMongo = () => Boolean(mongoDb);

const getCollections = () => {
  if (!mongoDb) {
    return null;
  }

  return {
    projects: mongoDb.collection("projects"),
    users: mongoDb.collection("users"),
    messages: mongoDb.collection("messages"),
    schedules: mongoDb.collection("schedules"),
  };
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

const normalizeUser = (user = {}) => ({
  _id:
    typeof user._id === "string"
      ? user._id
      : user._id?.toString?.() ||
        `usr-${Math.random().toString(36).slice(2, 10)}`,
  email: user.email || "",
  username: user.username || user.assignedName || "Guest User",
  assignedName: user.assignedName || user.username || "Guest User",
  status: user.status || "offline",
  presenceKey: user.presenceKey || "",
  userId: user.userId || user.presenceKey || user.email || "",
  joinedOrder:
    typeof user.joinedOrder === "number" ? user.joinedOrder : 999,
  updatedAt: user.updatedAt || null,
  lastSeenAt: user.lastSeenAt || null,
  isGuest: Boolean(user.isGuest),
});

const listProjects = async (ownerEmail) => {
  if (usingMongo()) {
    const { projects } = getCollections();
    const docs = await projects.find(ownerEmail ? { ownerEmail } : {}).toArray();
    return docs.map(normalizeProject).sort(
      (a, b) =>
        new Date(b.lastModified || b.updatedAt).getTime() -
        new Date(a.lastModified || a.updatedAt).getTime()
    );
  }

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

const getProject = async (projectId) => {
  if (usingMongo()) {
    const { projects } = getCollections();
    const doc = await projects.findOne({ projectId });
    return doc ? normalizeProject(doc) : null;
  }

  return readProjects().map(normalizeProject).find((project) => project.projectId === projectId) || null;
};

const saveProjectRecord = async (projectInput) => {
  const incoming = normalizeProject(projectInput);
  const now = new Date().toISOString();

  if (usingMongo()) {
    const { projects } = getCollections();
    const existing = await projects.findOne({ projectId: incoming.projectId });
    const merged = normalizeProject({
      ...existing,
      ...incoming,
      createdAt: existing?.createdAt || incoming.createdAt || now,
      updatedAt: now,
      lastModified: incoming.lastModified || now,
    });

    await projects.updateOne(
      { projectId: incoming.projectId },
      { $set: merged },
      { upsert: true }
    );

    return merged;
  }

  const projects = readProjects().map(normalizeProject);
  const existingIndex = projects.findIndex(
    (project) => project.projectId === incoming.projectId
  );
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

const deleteProjectRecord = async (projectId) => {
  if (usingMongo()) {
    const { projects, messages, schedules } = getCollections();
    const result = await projects.deleteOne({ projectId });
    if (!result.deletedCount) {
      return false;
    }

    await messages.deleteMany({ projectId });
    await schedules.deleteMany({ projectId });
    return true;
  }

  const projects = readProjects().map(normalizeProject);
  const nextProjects = projects.filter((project) => project.projectId !== projectId);

  if (nextProjects.length === projects.length) {
    return false;
  }

  writeProjects(nextProjects);
  return true;
};

const patchProjectRecord = async (projectId, updates) => {
  const existing = await getProject(projectId);
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

const listMessages = async (projectId) => {
  if (usingMongo()) {
    const { messages } = getCollections();
    return messages
      .find({ projectId })
      .sort({ createdAt: 1 })
      .limit(200)
      .project({ _id: 0, id: 1, user: 1, text: 1, time: 1, createdAt: 1 })
      .toArray();
  }

  const allMessages = readMessages();
  const projectMessages = allMessages[projectId];
  return Array.isArray(projectMessages) ? projectMessages : [];
};

const saveMessage = async (projectId, messageInput = {}) => {
  const createdAt = messageInput.createdAt || new Date().toISOString();
  const nextMessage = {
    id:
      messageInput.id ||
      `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    user: messageInput.user || "System",
    text: messageInput.text || "",
    time:
      messageInput.time ||
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    createdAt,
  };

  if (usingMongo()) {
    const { messages } = getCollections();
    await messages.insertOne(nextMessage);
    return {
      id: nextMessage.id,
      user: nextMessage.user,
      text: nextMessage.text,
      time: nextMessage.time,
      createdAt: nextMessage.createdAt,
    };
  }

  const allMessages = readMessages();
  const existing = Array.isArray(allMessages[projectId])
    ? allMessages[projectId]
    : [];
  allMessages[projectId] = [
    ...existing,
    {
      id: nextMessage.id,
      user: nextMessage.user,
      text: nextMessage.text,
      time: nextMessage.time,
      createdAt: nextMessage.createdAt,
    },
  ].slice(-200);
  writeMessages(allMessages);
  return {
    id: nextMessage.id,
    user: nextMessage.user,
    text: nextMessage.text,
    time: nextMessage.time,
    createdAt: nextMessage.createdAt,
  };
};

const listSchedules = async (projectId) => {
  if (usingMongo()) {
    const { schedules } = getCollections();
    return schedules
      .find(projectId ? { projectId } : {})
      .sort({ date: 1, time: 1 })
      .project({ _id: 0 })
      .toArray();
  }

  return readSchedules()
    .filter((schedule) => !projectId || schedule.projectId === projectId)
    .sort((a, b) => {
      const aValue = `${a.date || ""}T${a.time || ""}`;
      const bValue = `${b.date || ""}T${b.time || ""}`;
      return aValue.localeCompare(bValue);
    });
};

const saveSchedule = async (scheduleInput = {}) => {
  const schedule = {
    _id:
      scheduleInput._id ||
      `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: scheduleInput.title || "Untitled Schedule",
    date: scheduleInput.date || "",
    time: scheduleInput.time || "",
    type: scheduleInput.type || "Meeting",
    projectId: scheduleInput.projectId || "",
    createdBy: scheduleInput.createdBy || "guest",
    createdAt: scheduleInput.createdAt || new Date().toISOString(),
  };

  if (usingMongo()) {
    const { schedules } = getCollections();
    await schedules.insertOne(schedule);
    return schedule;
  }

  const schedules = readSchedules();
  schedules.push(schedule);
  writeSchedules(schedules);
  return schedule;
};

const deleteSchedule = async (scheduleId) => {
  if (usingMongo()) {
    const { schedules } = getCollections();
    const result = await schedules.deleteOne({ _id: scheduleId });
    return Boolean(result.deletedCount);
  }

  const schedules = readSchedules();
  const nextSchedules = schedules.filter((schedule) => schedule._id !== scheduleId);
  if (nextSchedules.length === schedules.length) {
    return false;
  }

  writeSchedules(nextSchedules);
  return true;
};

const upsertUser = async (userInput = {}) => {
  if (!userInput.email) {
    return null;
  }

  const nextUser = {
    email: userInput.email,
    username: userInput.username || userInput.email,
    updatedAt: new Date().toISOString(),
  };

  if (usingMongo()) {
    const { users } = getCollections();
    await users.updateOne(
      { email: userInput.email },
      {
        $set: nextUser,
        $setOnInsert: {
          _id: `usr-${Math.random().toString(36).slice(2, 10)}`,
        },
      },
      { upsert: true }
    );

    const user = await users.findOne(
      { email: userInput.email },
      { projection: { _id: 1, email: 1, username: 1, updatedAt: 1 } }
    );
    return user;
  }

  const users = readUsers();
  const existingIndex = users.findIndex((user) => user.email === userInput.email);
  const finalUser = {
    _id:
      existingIndex >= 0
        ? users[existingIndex]._id
        : `usr-${Math.random().toString(36).slice(2, 10)}`,
    ...nextUser,
  };

  if (existingIndex >= 0) {
    users[existingIndex] = { ...users[existingIndex], ...finalUser };
  } else {
    users.push(finalUser);
  }

  writeUsers(users);
  return finalUser;
};

const listUsers = async () => {
  if (usingMongo()) {
    const { users } = getCollections();
    const docs = await users
      .find({})
      .project({
        _id: 1,
        email: 1,
        username: 1,
        assignedName: 1,
        status: 1,
        presenceKey: 1,
        userId: 1,
        joinedOrder: 1,
        updatedAt: 1,
        lastSeenAt: 1,
        isGuest: 1,
      })
      .sort({ joinedOrder: 1, createdAt: 1 })
      .toArray();
    return docs.map(normalizeUser);
  }

  return readUsers()
    .map(normalizeUser)
    .sort((a, b) => (a.joinedOrder || 999) - (b.joinedOrder || 999));
};

const assignReservedIdentity = (existingUsers) => {
  const taken = new Set(
    existingUsers
      .map((user) => user.assignedName || user.username)
      .filter(Boolean)
  );

  const reserved = RESERVED_USER_NAMES.find((name) => !taken.has(name));
  if (reserved) {
    return { assignedName: reserved, isGuest: false };
  }

  const guestNumbers = existingUsers
    .map((user) => {
      const candidate = user.assignedName || user.username || "";
      const match = /^Guest-(\d+)$/.exec(candidate);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => typeof value === "number");
  const nextGuestNumber =
    guestNumbers.length > 0 ? Math.max(...guestNumbers) + 1 : 1;

  return {
    assignedName: `Guest-${nextGuestNumber}`,
    isGuest: true,
  };
};

const createUserRecord = async (userInput = {}) => {
  const presenceKey = String(userInput.presenceKey || "").trim();
  const email = String(userInput.email || "").trim();
  const requestedUsername = String(userInput.username || "").trim();

  if (!presenceKey && !email) {
    return null;
  }

  const now = new Date().toISOString();

  if (usingMongo()) {
    const { users } = getCollections();
    const existingUsers = await users.find({}).sort({ joinedOrder: 1 }).toArray();
    const existingUser =
      (email && existingUsers.find((user) => user.email === email)) ||
      (presenceKey &&
        existingUsers.find((user) => user.presenceKey === presenceKey));

    if (existingUser) {
      const updates = {
        email: email || existingUser.email || "",
        presenceKey: presenceKey || existingUser.presenceKey || "",
        userId:
          existingUser.userId ||
          presenceKey ||
          email ||
          `usr-${Math.random().toString(36).slice(2, 10)}`,
        updatedAt: now,
      };

      await users.updateOne(
        { _id: existingUser._id },
        {
          $set: updates,
          $setOnInsert: {
            createdAt: now,
          },
        }
      );

      return normalizeUser({
        ...existingUser,
        ...updates,
      });
    }

    const identity = assignReservedIdentity(existingUsers);
    const joinedOrder = existingUsers.length + 1;
    const newUser = {
      _id: `usr-${Math.random().toString(36).slice(2, 10)}`,
      email,
      presenceKey,
      userId:
        presenceKey || email || `usr-${Math.random().toString(36).slice(2, 10)}`,
      username: identity.assignedName,
      assignedName: identity.assignedName,
      status: "offline",
      isGuest: identity.isGuest,
      joinedOrder,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };

    await users.insertOne(newUser);
    return normalizeUser(newUser);
  }

  const users = readUsers();
  const existingIndex = users.findIndex(
    (user) =>
      (email && user.email === email) ||
      (presenceKey && user.presenceKey === presenceKey)
  );

  if (existingIndex >= 0) {
    const existingUser = users[existingIndex];
    const updatedUser = {
      ...existingUser,
      email: email || existingUser.email || "",
      presenceKey: presenceKey || existingUser.presenceKey || "",
      userId:
        existingUser.userId ||
        presenceKey ||
        email ||
        `usr-${Math.random().toString(36).slice(2, 10)}`,
      updatedAt: now,
    };
    users[existingIndex] = updatedUser;
    writeUsers(users);
    return normalizeUser(updatedUser);
  }

  const identity = assignReservedIdentity(users);
  const newUser = {
    _id: `usr-${Math.random().toString(36).slice(2, 10)}`,
    email,
    presenceKey,
    userId:
      presenceKey || email || `usr-${Math.random().toString(36).slice(2, 10)}`,
    username: identity.assignedName,
    assignedName: identity.assignedName,
    status: "offline",
    isGuest: identity.isGuest,
    joinedOrder: users.length + 1,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
  users.push(newUser);
  writeUsers(users);
  return normalizeUser(newUser);
};

const setUserStatus = async ({ presenceKey, email, userId, status }) => {
  const now = new Date().toISOString();

  if (usingMongo()) {
    const { users } = getCollections();
    const match = [];
    if (presenceKey) match.push({ presenceKey });
    if (email) match.push({ email });
    if (userId) match.push({ userId });
    if (match.length === 0) {
      return null;
    }

    const user = await users.findOne({ $or: match });
    if (!user) {
      return null;
    }

    const updated = {
      ...user,
      status,
      updatedAt: now,
      lastSeenAt: now,
    };
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          status,
          updatedAt: now,
          lastSeenAt: now,
        },
      }
    );
    return normalizeUser(updated);
  }

  const users = readUsers();
  const index = users.findIndex(
    (user) =>
      (presenceKey && user.presenceKey === presenceKey) ||
      (email && user.email === email) ||
      (userId && user.userId === userId)
  );
  if (index < 0) {
    return null;
  }
  users[index] = {
    ...users[index],
    status,
    updatedAt: now,
    lastSeenAt: now,
  };
  writeUsers(users);
  return normalizeUser(users[index]);
};

const emitPresenceList = (projectId) => {
  io.to(projectId).emit("room_presence_list", roomPresence[projectId] || {});
};

app.get("/health", async (_req, res) => {
  const [projects, users, schedules] = await Promise.all([
    listProjects(),
    listUsers(),
    listSchedules(),
  ]);

  const mongoConnected = usingMongo();
  const healthy = !REQUIRE_MONGODB || mongoConnected;

  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    requiredStorage: REQUIRE_MONGODB ? "mongo" : "json-or-mongo",
    storage: usingMongo() ? "mongo" : "json",
    mongoConfigured: Boolean(MONGODB_URI),
    mongoConnected,
    mongoError:
      REQUIRE_MONGODB && mongoConnectionError
        ? mongoConnectionError.message
        : null,
    projects: projects.length,
    users: users.length,
    schedules: schedules.length,
  });
});

app.get("/api/presence", (_req, res) => {
  res.status(200).json(roomPresence);
});

app.get("/get-users", async (_req, res) => {
  res.status(200).json(await listUsers());
});

app.post("/upsert-user", async (req, res) => {
  const user = await createUserRecord(req.body || {});
  if (!user) {
    res.status(400).json({ error: "presenceKey or email is required" });
    return;
  }

  res.status(200).json({ user });
});

app.get("/api/messages", async (req, res) => {
  const projectId = String(req.query.projectId || "");
  res.status(200).json(await listMessages(projectId));
});

app.post("/api/messages", async (req, res) => {
  const projectId = req.body?.projectId;
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  const message = await saveMessage(projectId, req.body);
  io.to(projectId).emit("receive_message", message);
  res.status(201).json(message);
});

app.get("/api/schedules", async (req, res) => {
  const projectId = String(req.query.projectId || "");
  res.status(200).json(await listSchedules(projectId));
});

app.post("/api/schedules", async (req, res) => {
  if (!req.body?.projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  const schedule = await saveSchedule(req.body);
  res.status(201).json(schedule);
});

app.delete("/api/schedules/:scheduleId", async (req, res) => {
  const deleted = await deleteSchedule(req.params.scheduleId);
  if (!deleted) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  res.status(200).json({ ok: true });
});

app.get("/api/projects", async (req, res) => {
  const projects = await listProjects(req.query.ownerEmail);
  res.status(200).json(projects);
});

app.get("/projects", async (req, res) => {
  const projects = await listProjects(req.query.ownerEmail);
  res.status(200).json({ projects });
});

app.get("/api/projects/:projectId", async (req, res) => {
  const project = await getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json(project);
});

app.get("/projects/:projectId", async (req, res) => {
  const project = await getProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json({ project });
});

app.post("/api/projects/save", async (req, res) => {
  const payload = req.body || {};
  const snapshot = parseSnapshot(payload.objects || payload.content);

  const project = await saveProjectRecord({
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

app.put("/api/projects/:projectId", async (req, res) => {
  const payload = req.body || {};
  const snapshot = parseSnapshot(payload.content);

  const project = await saveProjectRecord({
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

app.patch("/api/projects/:projectId", async (req, res) => {
  const project = await patchProjectRecord(req.params.projectId, {
    name: req.body?.name,
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.status(200).json({ project });
});

app.delete("/api/projects/:projectId", async (req, res) => {
  const deleted = await deleteProjectRecord(req.params.projectId);
  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  delete roomPresence[req.params.projectId];
  delete roomLocks[req.params.projectId];

  const messages = readMessages();
  if (messages[req.params.projectId]) {
    delete messages[req.params.projectId];
    writeMessages(messages);
  }

  res.status(200).json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join_project", async (payload) => {
    const projectId = typeof payload === "string" ? payload : payload?.projectId;
    if (!projectId) {
      return;
    }

    const presenceKey =
      typeof payload === "object" ? String(payload?.presenceKey || "") : "";
    const email =
      typeof payload === "object" ? String(payload?.email || "") : "";
    const knownUser =
      (await createUserRecord({
        presenceKey,
        email,
        username: typeof payload === "object" ? payload?.username : "",
      })) || {};
    const userId =
      knownUser.userId ||
      (typeof payload === "object" && payload?.userId) ||
      presenceKey ||
      email ||
      socket.id;
    const username =
      knownUser.assignedName ||
      knownUser.username ||
      (typeof payload === "object" && payload?.username) ||
      "Guest";

    socket.join(projectId);
    socket.data.projectId = projectId;
    socket.data.userId = userId;
    socket.data.presenceKey = presenceKey || knownUser.presenceKey || "";
    socket.data.email = email || knownUser.email || "";

    await setUserStatus({
      presenceKey: socket.data.presenceKey,
      email: socket.data.email,
      userId,
      status: "online",
    });

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
      status: "online",
    };

    const project =
      (await getProject(projectId)) ||
      (await saveProjectRecord({ projectId, name: "Untitled Sheet" }));
    const snapshot = parseSnapshot(project.content);

    socket.emit("load_project", {
      projectId: project.projectId,
      projectName: project.name,
      objects: snapshot.objects,
      layers: snapshot.layers,
      activeLayerId: snapshot.activeLayerId,
    });

    emitPresenceList(projectId);
    socket.emit("message_history", await listMessages(projectId));
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
      status: "online",
    };

    io.to(projectId).emit("presence-update", { userId, presence: roomPresence[projectId][userId] });
    emitPresenceList(projectId);
  });

  socket.on("send_message", async (message) => {
    const projectId = message?.projectId || socket.data.projectId;
    if (!projectId) {
      return;
    }

    const savedMessage = await saveMessage(projectId, message);
    io.to(projectId).emit("receive_message", savedMessage);
  });

  socket.on("create_object", async ({ projectId, payload }) => {
    if (!projectId || !payload) {
      return;
    }

    const project =
      (await getProject(projectId)) ||
      (await saveProjectRecord({ projectId, name: "Untitled Sheet" }));
    const snapshot = parseSnapshot(project.content);
    snapshot.objects.push(payload);

    await saveProjectRecord({
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

  socket.on("delete_object", async ({ projectId, objectId }) => {
    if (!projectId || !objectId) {
      return;
    }

    const project = await getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.filter((object) => object.id !== objectId);

    await saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    io.to(projectId).emit("delete_object", { objectId });
  });

  socket.on("transform_object", async ({ projectId, objectId, payload }) => {
    if (!projectId || !objectId || !payload?.transform) {
      return;
    }

    const project = await getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId
        ? { ...object, transform: payload.transform }
        : object
    );

    await saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("transform_object", { objectId, payload });
  });

  socket.on("update_property", async ({ projectId, objectId, payload }) => {
    if (!projectId || !objectId || !payload?.properties) {
      return;
    }

    const project = await getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId
        ? { ...object, properties: payload.properties }
        : object
    );

    await saveProjectRecord({
      ...project,
      content: JSON.stringify(snapshot),
      objects: snapshot.objects,
      layers: snapshot.layers,
    });

    socket.to(projectId).emit("update_property", { objectId, payload });
  });

  socket.on("replace_geometry", async ({ projectId, objectId, geometryData }) => {
    if (!projectId || !objectId) {
      return;
    }

    const project = await getProject(projectId);
    if (!project) {
      return;
    }

    const snapshot = parseSnapshot(project.content);
    snapshot.objects = snapshot.objects.map((object) =>
      object.id === objectId ? { ...object, geometryData } : object
    );

    await saveProjectRecord({
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
    const { projectId, userId, presenceKey, email } = socket.data || {};

    if (projectId && userId && roomPresence[projectId]) {
      delete roomPresence[projectId][userId];
      io.to(projectId).emit("presence-disconnect", userId);
      io.to(projectId).emit("unlock_all_by_user", { userId });
      emitPresenceList(projectId);
    }

    void setUserStatus({
      presenceKey,
      email,
      userId,
      status: "offline",
    });
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const startServer = async () => {
  if (!REQUIRE_MONGODB) {
    ensureDataStore();
  }

  await connectMongo();

  server.listen(PORT, () => {
    console.log(
      `DrawMatrix server listening on port ${PORT} using ${
        usingMongo() ? "MongoDB Atlas" : "JSON storage"
      }`
    );
  });
};

startServer().catch((error) => {
  console.error("Failed to start DrawMatrix server:", error);
  process.exit(1);
});
