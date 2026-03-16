const STORAGE_KEY = "mm_draft_tracker_v1";
const SYNC_DEBOUNCE_MS = 350;

const state = {
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

const auth = {
  user: null,
  team: null,
  socket: null,
  activeSection: "login",
  applyingRemoteState: false,
  saveTimer: null
};

const el = {
  authGate: document.getElementById("authGate"),
  appRoot: document.getElementById("appRoot"),
  toggleLoginBtn: document.getElementById("toggleLoginBtn"),
  toggleCreateBtn: document.getElementById("toggleCreateBtn"),
  toggleJoinBtn: document.getElementById("toggleJoinBtn"),
  loginToggleIcon: document.getElementById("loginToggleIcon"),
  createToggleIcon: document.getElementById("createToggleIcon"),
  joinToggleIcon: document.getElementById("joinToggleIcon"),
  loginAuthContent: document.getElementById("loginAuthContent"),
  createAuthContent: document.getElementById("createAuthContent"),
  joinAuthContent: document.getElementById("joinAuthContent"),
  loginForm: document.getElementById("loginForm"),
  createForm: document.getElementById("createForm"),
  joinForm: document.getElementById("joinForm"),
  loginEmailInput: document.getElementById("loginEmailInput"),
  loginPasswordInput: document.getElementById("loginPasswordInput"),
  createNameInput: document.getElementById("createNameInput"),
  createEmailInput: document.getElementById("createEmailInput"),
  createPasswordInput: document.getElementById("createPasswordInput"),
  createTeamNameInput: document.getElementById("createTeamNameInput"),
  joinNameInput: document.getElementById("joinNameInput"),
  joinEmailInput: document.getElementById("joinEmailInput"),
  joinPasswordInput: document.getElementById("joinPasswordInput"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  authStatus: document.getElementById("authStatus"),
  sessionInfo: document.getElementById("sessionInfo"),
  logoutBtn: document.getElementById("logoutBtn"),
  toggleSetupBtn: document.getElementById("toggleSetupBtn"),
  toggleSetupIcon: document.getElementById("toggleSetupIcon"),
  setupContent: document.getElementById("setupContent"),
  toggleRankingsBtn: document.getElementById("toggleRankingsBtn"),
  toggleRankingsIcon: document.getElementById("toggleRankingsIcon"),
  rankingsContent: document.getElementById("rankingsContent"),
  teamsInput: document.getElementById("teamsInput"),
  roundsInput: document.getElementById("roundsInput"),
  myTeamInput: document.getElementById("myTeamInput"),
  snakeInput: document.getElementById("snakeInput"),
  draftTeamsContainer: document.getElementById("draftTeamsContainer"),
  saveSetupBtn: document.getElementById("saveSetupBtn"),
  resetDraftBtn: document.getElementById("resetDraftBtn"),
  rankingsInput: document.getElementById("rankingsInput"),
  loadRankingsBtn: document.getElementById("loadRankingsBtn"),
  clearRankingsBtn: document.getElementById("clearRankingsBtn"),
  rankingsStatus: document.getElementById("rankingsStatus"),
  currentPickText: document.getElementById("currentPickText"),
  expectedTeamText: document.getElementById("expectedTeamText"),
  untilMyTurnText: document.getElementById("untilMyTurnText"),
  pickNumberInput: document.getElementById("pickNumberInput"),
  pickTeamInput: document.getElementById("pickTeamInput"),
  pickPlayerInput: document.getElementById("pickPlayerInput"),
  markMineInput: document.getElementById("markMineInput"),
  addPickBtn: document.getElementById("addPickBtn"),
  draftBestBtn: document.getElementById("draftBestBtn"),
  undoPickBtn: document.getElementById("undoPickBtn"),
  draftStatus: document.getElementById("draftStatus"),
  myRosterList: document.getElementById("myRosterList"),
  nextPicksList: document.getElementById("nextPicksList"),
  nextTurnTargets: document.getElementById("nextTurnTargets"),
  draftLogBody: document.getElementById("draftLogBody"),
  bestAvailableBody: document.getElementById("bestAvailableBody"),
  playersDatalist: document.getElementById("playersDatalist")
};

const tournamentPlayers = Array.isArray(window.TOURNAMENT_PLAYERS) ? window.TOURNAMENT_PLAYERS : [];

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTeamColor(teamSlot) {
  const safeTeams = Math.max(2, state.teams || 2);
  const boundedSlot = Math.max(1, Math.min(teamSlot, safeTeams));
  const hue = Math.round(((boundedSlot - 1) * 360) / safeTeams);
  return `hsl(${hue} 68% 42%)`;
}

function getStorageKey() {
  if (auth.team?.id) {
    return `${STORAGE_KEY}_${auth.team.id}`;
  }
  return STORAGE_KEY;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore malformed payloads
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function setAuthStatus(message, isError = false) {
  el.authStatus.textContent = message;
  el.authStatus.classList.toggle("error-text", Boolean(isError));
}

function showAuth(show) {
  el.authGate.classList.toggle("hidden", !show);
  el.appRoot.classList.toggle("hidden", show);
}

function renderAuthSections() {
  const sections = [
    {
      key: "login",
      button: el.toggleLoginBtn,
      content: el.loginAuthContent,
      icon: el.loginToggleIcon
    },
    {
      key: "create",
      button: el.toggleCreateBtn,
      content: el.createAuthContent,
      icon: el.createToggleIcon
    },
    {
      key: "join",
      button: el.toggleJoinBtn,
      content: el.joinAuthContent,
      icon: el.joinToggleIcon
    }
  ];

  sections.forEach((section) => {
    const isOpen = auth.activeSection === section.key;
    section.content.hidden = !isOpen;
    section.button.setAttribute("aria-expanded", String(isOpen));
    section.icon.textContent = isOpen ? "−" : "+";
  });
}

function setAuthSection(section) {
  auth.activeSection = section;
  renderAuthSections();
  setAuthStatus("");
}

function renderSessionInfo() {
  if (!auth.user || !auth.team) {
    el.sessionInfo.textContent = "";
    return;
  }
  el.sessionInfo.textContent = `Signed in as ${auth.user.name} | Team Workspace: ${auth.team.name} | Code: ${auth.team.code}`;
}

function pickToRound(pickNumber, teams) {
  return Math.floor((pickNumber - 1) / teams) + 1;
}

function ensureDraftTeamsLength(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  const next = [];
  for (let i = 0; i < safeCount; i += 1) {
    next.push((state.draftTeams[i] || "").trim());
  }
  state.draftTeams = next;
}

function getDraftTeamName(teamSlot) {
  const slot = Number(teamSlot);
  const custom = state.draftTeams[slot - 1];
  return custom && custom.trim() ? custom.trim() : `Team ${slot}`;
}

function pickToTeam(pickNumber, teams, snake) {
  const round = pickToRound(pickNumber, teams);
  const slotInRound = ((pickNumber - 1) % teams) + 1;
  if (!snake || round % 2 === 1) {
    return slotInRound;
  }
  return teams - slotInRound + 1;
}

function getUpcomingMyPicks(limit = 2) {
  const totalPicks = state.teams * state.rounds;
  const picks = [];
  for (let p = state.currentPick; p <= totalPicks; p += 1) {
    if (pickToTeam(p, state.teams, state.snake) === state.myTeam) {
      picks.push(p);
      if (picks.length >= limit) {
        break;
      }
    }
  }
  return picks;
}

function getPicksUntilMyTurn() {
  const nextPick = getUpcomingMyPicks(1)[0];
  if (!nextPick) {
    return null;
  }
  return nextPick - state.currentPick;
}

function parseRankingLine(rawLine) {
  const skipPatterns = [
    /already ranked/i,
    /not in field/i,
    /removed/i,
    /replaced by/i,
    /use .* instead/i
  ];
  const line = rawLine.trim();
  if (!line) return null;
  if (/^\d+\s*[-–]\s*\d+$/.test(line)) return null;
  if (skipPatterns.some((pattern) => pattern.test(line))) return null;

  const cleaned = line
    .replace(/[–—]/g, "-")
    .replace(/^\d+\s*[\.\)\:-]?\s*/, "")
    .replace(/⚠/g, "")
    .replace(/\?+/g, "")
    .trim();

  if (!cleaned) return null;

  let name = cleaned;
  let team = "";

  if (cleaned.includes(":")) {
    const [teamPart, playerPart] = cleaned.split(":");
    if (teamPart && playerPart) {
      team = teamPart.trim();
      name = playerPart.trim();
    }
  } else if (cleaned.includes("-")) {
    const firstDash = cleaned.indexOf("-");
    const left = cleaned.slice(0, firstDash).trim();
    const right = cleaned.slice(firstDash + 1).trim();
    if (left && right) {
      name = left;
      team = right;
    }
  }

  name = name.replace(/\s+/g, " ").trim();
  team = team.replace(/\s+/g, " ").trim();
  if (!name) return null;

  return { name, team };
}

function parseRankings(text) {
  const seen = new Set();
  const parsed = [];

  text.split("\n").forEach((line) => {
    const item = parseRankingLine(line);
    if (!item) return;

    const key = normalizeName(item.name);
    if (seen.has(key)) return;
    seen.add(key);

    parsed.push({
      rank: parsed.length + 1,
      name: item.name,
      team: item.team
    });
  });

  return parsed;
}

function getDraftedSet() {
  return new Set(state.picks.map((p) => normalizeName(p.player)));
}

function getAvailablePlayers() {
  const drafted = getDraftedSet();
  return state.rankings.filter((player) => !drafted.has(normalizeName(player.name)));
}

function parsePlayerInput(value) {
  const raw = value.trim();
  const parenMatch = raw.match(/^(.*?)\s+\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return {
      name: parenMatch[1].trim(),
      teamHint: parenMatch[2].trim()
    };
  }

  const dashMatch = raw.match(/^(.*?)\s*-\s*(.+)$/);
  if (dashMatch) {
    return {
      name: dashMatch[1].trim(),
      teamHint: dashMatch[2].trim()
    };
  }

  return {
    name: raw,
    teamHint: ""
  };
}

function findRankingByName(name) {
  const key = normalizeName(name);
  return state.rankings.find((player) => normalizeName(player.name) === key) || null;
}

function findTournamentPlayer(name, teamHint = "") {
  const playerKey = normalizeName(name);
  const teamKey = normalizeName(teamHint);
  const matches = tournamentPlayers.filter((player) => normalizeName(player.name) === playerKey);
  if (!matches.length) {
    return null;
  }
  if (!teamKey) {
    return matches[0];
  }
  const exact = matches.find((player) => normalizeName(player.team || "") === teamKey);
  return exact || matches[0];
}

function applyStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  state.teams = Number(snapshot.teams) || 15;
  state.rounds = Number(snapshot.rounds) || 10;
  state.myTeam = Number(snapshot.myTeam) || 1;
  state.snake = Boolean(snapshot.snake);
  state.draftTeams = Array.isArray(snapshot.draftTeams) ? snapshot.draftTeams : [];
  state.setupOpen = Boolean(snapshot.setupOpen);
  state.rankingsOpen = Boolean(snapshot.rankingsOpen);
  state.rankings = Array.isArray(snapshot.rankings) ? snapshot.rankings : [];
  state.picks = Array.isArray(snapshot.picks) ? snapshot.picks : [];
  state.currentPick = Number(snapshot.currentPick) || 1;
  ensureDraftTeamsLength(state.teams);
}

function scheduleServerSync() {
  if (!auth.user || !auth.socket || !auth.socket.connected || auth.applyingRemoteState) {
    return;
  }
  if (auth.saveTimer) {
    clearTimeout(auth.saveTimer);
  }
  auth.saveTimer = setTimeout(() => {
    auth.socket.emit("state:update", { state });
  }, SYNC_DEBOUNCE_MS);
}

function persist() {
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
  scheduleServerSync();
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    applyStateSnapshot(saved);
  } catch {
    // ignore invalid local storage payloads
  }
}

function syncSetupInputs() {
  el.teamsInput.value = state.teams;
  el.myTeamInput.max = String(state.teams);
  el.roundsInput.value = state.rounds;
  el.myTeamInput.value = state.myTeam;
  el.snakeInput.checked = state.snake;
}

function renderDraftTeamInputs(teamCount = state.teams) {
  const safeTeamCount = Math.max(2, Number(teamCount) || state.teams || 2);
  ensureDraftTeamsLength(safeTeamCount);

  el.draftTeamsContainer.innerHTML = "";
  for (let slot = 1; slot <= safeTeamCount; slot += 1) {
    const wrapper = document.createElement("label");
    wrapper.className = "draft-team-label";
    wrapper.innerHTML = `
      <span>Team Number ${slot}</span>
      <input
        type="text"
        class="draft-team-name-input"
        data-slot="${slot}"
        value="${escapeHtml(state.draftTeams[slot - 1] || "")}"
        placeholder="Team ${slot}"
      >
    `;
    el.draftTeamsContainer.appendChild(wrapper);
  }
}

function renderSetupPanel() {
  el.setupContent.hidden = !state.setupOpen;
  el.toggleSetupBtn.setAttribute("aria-expanded", String(state.setupOpen));
  el.toggleSetupIcon.textContent = state.setupOpen ? "−" : "+";
}

function renderRankingsPanel() {
  el.rankingsContent.hidden = !state.rankingsOpen;
  el.toggleRankingsBtn.setAttribute("aria-expanded", String(state.rankingsOpen));
  el.toggleRankingsIcon.textContent = state.rankingsOpen ? "−" : "+";
}

function syncDraftInputs() {
  const expectedTeam = pickToTeam(state.currentPick, state.teams, state.snake);
  el.pickNumberInput.value = state.currentPick;
  el.pickTeamInput.value = expectedTeam;
  el.markMineInput.checked = expectedTeam === state.myTeam;
}

function refreshDatalist() {
  const options = [];
  const seen = new Set();

  function addOption(name, team = "") {
    const label = team ? `${name} (${team})` : name;
    const dedupeKey = `${normalizeName(name)}|${normalizeName(team)}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    options.push(label);
  }

  el.playersDatalist.innerHTML = "";
  state.rankings.forEach((player) => {
    addOption(player.name, player.team);
  });

  tournamentPlayers.forEach((player) => {
    addOption(player.name, player.team);
  });

  options.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.label = value;
    el.playersDatalist.appendChild(opt);
  });
}

function renderSummary() {
  const totalPicks = state.teams * state.rounds;
  const expectedTeam = pickToTeam(state.currentPick, state.teams, state.snake);
  const expectedTeamName = getDraftTeamName(expectedTeam);
  const round = pickToRound(state.currentPick, state.teams);
  const untilMyTurn = getPicksUntilMyTurn();

  el.currentPickText.textContent = `${state.currentPick} of ${totalPicks} (Round ${round})`;
  el.expectedTeamText.textContent = `${expectedTeamName} (Slot ${expectedTeam})`;
  el.untilMyTurnText.textContent = untilMyTurn === null ? "No turns left" : String(untilMyTurn);
}

function renderRoster() {
  const mine = state.picks.filter((p) => p.isMine);
  el.myRosterList.innerHTML = "";
  if (!mine.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No players drafted yet.";
    el.myRosterList.appendChild(li);
    return;
  }

  mine.forEach((pick, idx) => {
    const li = document.createElement("li");
    const meta = pick.teamName ? ` (${pick.teamName})` : "";
    li.textContent = `${idx + 1}. ${pick.player}${meta}`;
    el.myRosterList.appendChild(li);
  });
}

function renderForecast() {
  const upcoming = getUpcomingMyPicks(2);
  const available = getAvailablePlayers();
  const untilNext = getPicksUntilMyTurn();

  el.nextPicksList.innerHTML = "";
  if (!upcoming.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No picks remaining.";
    el.nextPicksList.appendChild(li);
  } else {
    upcoming.forEach((pickNum, idx) => {
      const delta = pickNum - state.currentPick;
      const li = document.createElement("li");
      li.textContent = `Pick ${pickNum} (${idx === 0 ? "next" : `+${delta} picks`})`;
      el.nextPicksList.appendChild(li);
    });
  }

  el.nextTurnTargets.innerHTML = "";
  if (untilNext === null) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Draft complete.";
    el.nextTurnTargets.appendChild(li);
    return;
  }

  const start = Math.max(0, untilNext);
  const forecastSlice = available.slice(start, start + 10);
  if (!forecastSlice.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No projected options available.";
    el.nextTurnTargets.appendChild(li);
    return;
  }

  forecastSlice.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name}${p.team ? ` (${p.team})` : ""}`;
    el.nextTurnTargets.appendChild(li);
  });
}

function renderDraftLog() {
  el.draftLogBody.innerHTML = "";
  if (!state.picks.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="muted">No picks logged yet.</td>';
    el.draftLogBody.appendChild(row);
    return;
  }

  state.picks.forEach((pick) => {
    const teamColor = getTeamColor(pick.team);
    const draftTeamLabel = getDraftTeamName(pick.team);
    const row = document.createElement("tr");
    row.className = "draft-log-row";
    row.style.setProperty("--team-color", teamColor);
    if (pick.isMine) {
      row.classList.add("my-pick-row");
    }
    row.innerHTML = `
      <td>${pick.pick}</td>
      <td>${escapeHtml(pick.player)}</td>
      <td>${escapeHtml(pick.teamName || "-")}</td>
      <td>${escapeHtml(pick.region || "-")}</td>
      <td><span class="team-pill" style="--team-color:${teamColor}">${escapeHtml(draftTeamLabel)}</span></td>
      <td>${pick.round}</td>
    `;
    el.draftLogBody.appendChild(row);
  });
}

function renderBestAvailable() {
  const available = getAvailablePlayers();
  const untilNext = getPicksUntilMyTurn();

  el.bestAvailableBody.innerHTML = "";
  if (!available.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="4" class="muted">No players available.</td>';
    el.bestAvailableBody.appendChild(row);
    return;
  }

  available.slice(0, 40).forEach((player, idx) => {
    const row = document.createElement("tr");
    if (untilNext !== null && idx < untilNext) {
      row.classList.add("at-risk");
    }
    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${player.rank}</td>
      <td>${player.name}</td>
      <td>${player.team || "-"}</td>
    `;
    el.bestAvailableBody.appendChild(row);
  });
}

function renderRankingsStatus() {
  el.rankingsStatus.textContent = `${state.rankings.length} players loaded.`;
}

function syncRankingsInput() {
  if (document.activeElement === el.rankingsInput) {
    return;
  }
  el.rankingsInput.value = state.rankings
    .map((p) => (p.team ? `${p.name} - ${p.team}` : p.name))
    .join("\n");
}

function setDraftMessage(text) {
  el.draftStatus.textContent = text;
}

function connectSocket() {
  if (typeof window.io !== "function") {
    setDraftMessage("Realtime sync unavailable: socket.io client not loaded.");
    return;
  }

  if (auth.socket) {
    auth.socket.disconnect();
    auth.socket = null;
  }

  auth.socket = window.io();
  auth.socket.on("connect", () => {
    setDraftMessage(`Live sync connected for ${auth.team.name}.`);
  });
  auth.socket.on("state:sync", (payload) => {
    if (!payload || typeof payload.state !== "object") {
      return;
    }
    auth.applyingRemoteState = true;
    applyStateSnapshot(payload.state);
    updateAll();
    auth.applyingRemoteState = false;
    if (payload.updatedBy && payload.updatedBy !== auth.user?.name) {
      setDraftMessage(`Live update received from ${payload.updatedBy}.`);
    }
  });
  auth.socket.on("connect_error", () => {
    setDraftMessage("Live sync temporarily disconnected.");
  });
}

async function hydrateTeamState() {
  const payload = await apiRequest("/api/state");
  if (payload?.state && typeof payload.state === "object") {
    applyStateSnapshot(payload.state);
  }
}

async function completeAuth(authPayload) {
  auth.user = authPayload.user;
  auth.team = authPayload.team;

  setAuthStatus("");
  renderSessionInfo();
  showAuth(false);
  loadPersisted();
  await hydrateTeamState();
  connectSocket();
  updateAll();
}

async function initializeAuth() {
  try {
    const payload = await apiRequest("/api/me");
    await completeAuth(payload);
  } catch {
    showAuth(true);
    renderAuthSections();
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  setAuthStatus("Signing in...");
  try {
    const payload = await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        email: el.loginEmailInput.value.trim(),
        password: el.loginPasswordInput.value
      }
    });
    await completeAuth(payload);
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

async function handleCreateTeamSubmit(event) {
  event.preventDefault();
  setAuthStatus("Creating team workspace...");
  try {
    const payload = await apiRequest("/api/auth/create-team", {
      method: "POST",
      body: {
        name: el.createNameInput.value.trim(),
        email: el.createEmailInput.value.trim(),
        password: el.createPasswordInput.value,
        teamName: el.createTeamNameInput.value.trim()
      }
    });
    await completeAuth(payload);
    setDraftMessage(`Team created. Share code ${auth.team.code} with teammates.`);
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

async function handleJoinTeamSubmit(event) {
  event.preventDefault();
  setAuthStatus("Joining team workspace...");
  try {
    const payload = await apiRequest("/api/auth/join-team", {
      method: "POST",
      body: {
        name: el.joinNameInput.value.trim(),
        email: el.joinEmailInput.value.trim(),
        password: el.joinPasswordInput.value,
        teamCode: el.joinCodeInput.value.trim().toUpperCase()
      }
    });
    await completeAuth(payload);
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

async function handleLogout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore logout request failures and clear local session anyway
  }

  if (auth.socket) {
    auth.socket.disconnect();
    auth.socket = null;
  }
  if (auth.saveTimer) {
    clearTimeout(auth.saveTimer);
  }

  auth.user = null;
  auth.team = null;
  auth.saveTimer = null;
  renderSessionInfo();
  setAuthSection("login");
  setAuthStatus("You have been logged out.");
  showAuth(true);
}

function updateAll() {
  renderSetupPanel();
  renderRankingsPanel();
  syncSetupInputs();
  renderDraftTeamInputs(state.teams);
  syncDraftInputs();
  renderSummary();
  renderRoster();
  renderForecast();
  renderDraftLog();
  renderBestAvailable();
  renderRankingsStatus();
  syncRankingsInput();
  refreshDatalist();
  persist();
}

function onSaveSetup() {
  const teams = Number(el.teamsInput.value);
  const rounds = Number(el.roundsInput.value);
  const myTeam = Number(el.myTeamInput.value);
  const snake = Boolean(el.snakeInput.checked);

  if (!teams || teams < 2) {
    setDraftMessage("Teams must be 2 or greater.");
    return;
  }
  if (!rounds || rounds < 1) {
    setDraftMessage("Rounds must be 1 or greater.");
    return;
  }
  if (!myTeam || myTeam < 1 || myTeam > teams) {
    setDraftMessage(`Your team slot must be between 1 and ${teams}.`);
    return;
  }

  ensureDraftTeamsLength(teams);
  const nameInputs = el.draftTeamsContainer.querySelectorAll(".draft-team-name-input");
  nameInputs.forEach((input) => {
    const slot = Number(input.dataset.slot || 0);
    if (slot >= 1 && slot <= teams) {
      state.draftTeams[slot - 1] = input.value.trim();
    }
  });

  state.teams = teams;
  state.rounds = rounds;
  state.myTeam = myTeam;
  state.snake = snake;

  if (state.currentPick > teams * rounds) {
    state.currentPick = teams * rounds;
  }

  setDraftMessage("Setup updated.");
  updateAll();
}

function onLoadRankings() {
  const parsed = parseRankings(el.rankingsInput.value);
  state.rankings = parsed;
  setDraftMessage(`Loaded ${parsed.length} ranked players.`);
  updateAll();
}

function onClearRankings() {
  state.rankings = [];
  el.rankingsInput.value = "";
  setDraftMessage("Rankings cleared.");
  updateAll();
}

function onAddPick({ autoBest = false } = {}) {
  const pickNumber = Number(el.pickNumberInput.value);
  const team = Number(el.pickTeamInput.value);
  let playerEntry = el.pickPlayerInput.value.trim();

  if (!playerEntry && autoBest) {
    const best = getAvailablePlayers()[0];
    playerEntry = best ? best.name : "";
  }

  if (!pickNumber || pickNumber < 1) {
    setDraftMessage("Pick number is required.");
    return;
  }
  if (!team || team < 1 || team > state.teams) {
    setDraftMessage(`Team slot must be between 1 and ${state.teams}.`);
    return;
  }
  if (!playerEntry) {
    setDraftMessage("Player name is required.");
    return;
  }

  const parsed = parsePlayerInput(playerEntry);
  const ranking = findRankingByName(parsed.name);
  const rosterPlayer = findTournamentPlayer(parsed.name, parsed.teamHint || (ranking ? ranking.team : ""));
  const resolvedName = ranking ? ranking.name : rosterPlayer ? rosterPlayer.name : parsed.name;
  const resolvedTeamName = ranking
    ? ranking.team
    : rosterPlayer
      ? rosterPlayer.team || ""
      : parsed.teamHint;

  const draftedSet = getDraftedSet();
  if (draftedSet.has(normalizeName(resolvedName))) {
    setDraftMessage(`${resolvedName} is already drafted.`);
    return;
  }

  const pick = {
    pick: pickNumber,
    round: pickToRound(pickNumber, state.teams),
    team,
    player: resolvedName,
    teamName: resolvedTeamName || "",
    region: "",
    isMine: Boolean(el.markMineInput.checked) || team === state.myTeam
  };

  state.picks.push(pick);
  state.picks.sort((a, b) => a.pick - b.pick);

  const totalPicks = state.teams * state.rounds;
  state.currentPick = Math.min(totalPicks, Math.max(...state.picks.map((p) => p.pick)) + 1);

  el.pickPlayerInput.value = "";
  setDraftMessage(`Added pick ${pick.pick}: ${pick.player}.`);
  updateAll();
}

function onDraftBestForMyTeam() {
  const expectedTeam = pickToTeam(state.currentPick, state.teams, state.snake);
  if (expectedTeam !== state.myTeam) {
    setDraftMessage(`Current pick belongs to Team ${expectedTeam}, not your slot.`);
    return;
  }
  el.pickNumberInput.value = state.currentPick;
  el.pickTeamInput.value = state.myTeam;
  el.markMineInput.checked = true;
  onAddPick({ autoBest: true });
}

function onUndoPick() {
  if (!state.picks.length) {
    setDraftMessage("No picks to undo.");
    return;
  }
  const removed = state.picks.pop();
  state.currentPick = removed.pick;
  setDraftMessage(`Removed pick ${removed.pick}: ${removed.player}.`);
  updateAll();
}

function onResetDraft() {
  const confirmed = window.confirm("Are you sure you want to reset the draft log? This cannot be undone.");
  if (!confirmed) {
    setDraftMessage("Reset cancelled.");
    return;
  }
  state.picks = [];
  state.currentPick = 1;
  setDraftMessage("Draft log reset.");
  updateAll();
}

function attachEvents() {
  el.toggleLoginBtn.addEventListener("click", () => setAuthSection("login"));
  el.toggleCreateBtn.addEventListener("click", () => setAuthSection("create"));
  el.toggleJoinBtn.addEventListener("click", () => setAuthSection("join"));
  el.loginForm.addEventListener("submit", handleLoginSubmit);
  el.createForm.addEventListener("submit", handleCreateTeamSubmit);
  el.joinForm.addEventListener("submit", handleJoinTeamSubmit);
  el.logoutBtn.addEventListener("click", handleLogout);

  el.toggleSetupBtn.addEventListener("click", () => {
    state.setupOpen = !state.setupOpen;
    updateAll();
  });
  el.toggleRankingsBtn.addEventListener("click", () => {
    state.rankingsOpen = !state.rankingsOpen;
    updateAll();
  });
  el.saveSetupBtn.addEventListener("click", onSaveSetup);
  el.teamsInput.addEventListener("input", () => {
    const nextTeams = Number(el.teamsInput.value);
    if (!nextTeams || nextTeams < 2 || nextTeams > 40) {
      return;
    }
    el.myTeamInput.max = String(nextTeams);
    if (Number(el.myTeamInput.value) > nextTeams) {
      el.myTeamInput.value = String(nextTeams);
    }
    ensureDraftTeamsLength(nextTeams);
    renderDraftTeamInputs(nextTeams);
    persist();
  });
  el.draftTeamsContainer.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.classList.contains("draft-team-name-input")) {
      return;
    }
    const slot = Number(target.dataset.slot || 0);
    if (slot < 1) {
      return;
    }
    ensureDraftTeamsLength(Math.max(slot, Number(el.teamsInput.value) || state.teams));
    state.draftTeams[slot - 1] = target.value;
    persist();
  });
  el.resetDraftBtn.addEventListener("click", onResetDraft);
  el.loadRankingsBtn.addEventListener("click", onLoadRankings);
  el.clearRankingsBtn.addEventListener("click", onClearRankings);
  el.addPickBtn.addEventListener("click", () => onAddPick());
  el.draftBestBtn.addEventListener("click", onDraftBestForMyTeam);
  el.undoPickBtn.addEventListener("click", onUndoPick);
}

async function bootstrap() {
  attachEvents();
  setAuthSection("login");
  await initializeAuth();
}

bootstrap();
