const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

function ensureDbFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: [], teams: [], states: {} }, null, 2),
      "utf8"
    );
  }
}

function readDb() {
  ensureDbFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { users: [], teams: [], states: {} };
    }
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      states: parsed.states && typeof parsed.states === "object" ? parsed.states : {}
    };
  } catch {
    return { users: [], teams: [], states: {} };
  }
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function generateId() {
  return crypto.randomUUID();
}

function randomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    out += alphabet[index];
  }
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const parts = String(passwordHash || "").split(":");
  if (parts.length !== 2) return false;
  const [salt, savedHash] = parts;
  const nextHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(savedHash, "hex");
  const b = Buffer.from(nextHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    teamId: user.teamId
  };
}

function sanitizeTeam(team) {
  return {
    id: team.id,
    name: team.name,
    code: team.code
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultState() {
  return {
    teams: 15,
    rounds: 10,
    myTeam: 1,
    snake: true,
    draftTeams: [],
    setupOpen: false,
    rankingsOpen: false,
    rankings: [],
    picks: [],
    currentPick: 1
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "2mb" }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
});

app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = user;
  req.db = db;
  next();
}

app.post("/api/auth/create-team", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const teamName = String(req.body.teamName || "").trim();

  if (!name || !email || !password || !teamName) {
    res.status(400).json({ error: "All fields are required." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  const db = readDb();
  if (db.users.some((user) => user.email === email)) {
    res.status(409).json({ error: "Email already in use." });
    return;
  }

  let code = randomCode(6);
  while (db.teams.some((team) => team.code === code)) {
    code = randomCode(6);
  }

  const team = {
    id: generateId(),
    name: teamName,
    code,
    createdAt: new Date().toISOString()
  };
  const user = {
    id: generateId(),
    name,
    email,
    passwordHash: hashPassword(password),
    teamId: team.id,
    createdAt: new Date().toISOString()
  };

  db.teams.push(team);
  db.users.push(user);
  db.states[team.id] = defaultState();
  writeDb(db);

  req.session.userId = user.id;
  res.json({ user: sanitizeUser(user), team: sanitizeTeam(team) });
});

app.post("/api/auth/join-team", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const teamCode = String(req.body.teamCode || "").trim().toUpperCase();

  if (!name || !email || !password || !teamCode) {
    res.status(400).json({ error: "All fields are required." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  const db = readDb();
  if (db.users.some((user) => user.email === email)) {
    res.status(409).json({ error: "Email already in use." });
    return;
  }

  const team = db.teams.find((entry) => entry.code === teamCode);
  if (!team) {
    res.status(404).json({ error: "Team code not found." });
    return;
  }

  const user = {
    id: generateId(),
    name,
    email,
    passwordHash: hashPassword(password),
    teamId: team.id,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  if (!db.states[team.id]) {
    db.states[team.id] = defaultState();
  }
  writeDb(db);

  req.session.userId = user.id;
  res.json({ user: sanitizeUser(user), team: sanitizeTeam(team) });
});

app.post("/api/auth/login", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const db = readDb();
  const user = db.users.find((entry) => entry.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const team = db.teams.find((entry) => entry.id === user.teamId);
  if (!team) {
    res.status(500).json({ error: "User team is missing." });
    return;
  }

  req.session.userId = user.id;
  res.json({ user: sanitizeUser(user), team: sanitizeTeam(team) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  const db = readDb();
  const user = db.users.find((entry) => entry.id === req.session.userId);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const team = db.teams.find((entry) => entry.id === user.teamId);
  if (!team) {
    res.status(500).json({ error: "User team is missing." });
    return;
  }
  res.json({ user: sanitizeUser(user), team: sanitizeTeam(team) });
});

app.get("/api/state", requireAuth, (req, res) => {
  const teamState = req.db.states[req.user.teamId] || defaultState();
  res.json({ state: teamState });
});

app.put("/api/state", requireAuth, (req, res) => {
  const payload = req.body.state;
  if (!isObject(payload)) {
    res.status(400).json({ error: "Invalid state payload." });
    return;
  }

  req.db.states[req.user.teamId] = payload;
  writeDb(req.db);

  io.to(req.user.teamId).emit("state:sync", {
    state: payload,
    updatedBy: req.user.name,
    updatedAt: new Date().toISOString()
  });

  res.json({ ok: true });
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.use((socket, next) => {
  const db = readDb();
  const user = db.users.find((entry) => entry.id === socket.request.session.userId);
  if (!user) {
    next(new Error("unauthorized"));
    return;
  }
  const team = db.teams.find((entry) => entry.id === user.teamId);
  if (!team) {
    next(new Error("team_not_found"));
    return;
  }
  socket.user = user;
  socket.team = team;
  next();
});

io.on("connection", (socket) => {
  socket.join(socket.user.teamId);
  socket.emit("team:meta", {
    team: sanitizeTeam(socket.team),
    user: sanitizeUser(socket.user)
  });

  socket.on("state:update", (payload) => {
    if (!payload || !isObject(payload.state)) {
      return;
    }

    const db = readDb();
    db.states[socket.user.teamId] = payload.state;
    writeDb(db);

    socket.to(socket.user.teamId).emit("state:sync", {
      state: payload.state,
      updatedBy: socket.user.name,
      updatedAt: new Date().toISOString()
    });
  });
});

app.use(express.static(__dirname));

server.listen(PORT, () => {
  ensureDbFile();
  console.log(`Draft tracker running on http://localhost:${PORT}`);
});
