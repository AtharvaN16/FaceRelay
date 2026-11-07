/* Face Relay — a 3-second "name the famous face" party game for teams.
 * Plain browser JS, no build step. Photos come from Wikipedia at game start.
 * Optional phone remote: scan a QR code to control the game from a phone (WebRTC via PeerJS).
 */
(() => {
  "use strict";

  const PARAMS = new URLSearchParams(location.search);
  const REMOTE_CODE = (PARAMS.get("remote") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  // This page is the phone remote rather than the game itself
  const IS_HOST_VIEW = !!REMOTE_CODE;
  const $app = document.getElementById("app");
  const STORE_KEY = "face-relay:settings:v2";
  const CACHE_KEY = "face-relay:wiki:v2";   // v2: non-photo images filtered out
  const SEEN_KEY = "face-relay:seen:v1";

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cleanName = (title) => title.replace(/\s*\([^)]*\)\s*$/, "");
  const TEAMS = [
    { name: "Blue", color: "#3d7ef5" },
    { name: "Pink", color: "#ec4f8c" },
    { name: "Green", color: "#1fb36b" },
    { name: "Purple", color: "#9a5cf6" },
    { name: "Orange", color: "#f2711c" },
    { name: "Cyan", color: "#1aa9c2" },
    { name: "Yellow", color: "#e5b20b" },
    { name: "Lime", color: "#7cc21b" },
  ];
  const MAX_TEAMS = 6, MAX_PER_TEAM = 8;
  const CHAIN_BONUS = 3;
  // Each team picks a palette entry (S.teamColors[t] = index into TEAMS)
  const teamPal = (t) => TEAMS[(S.teamColors && S.teamColors[t]) ?? t] || TEAMS[t % TEAMS.length];
  const teamName = (t) => `${teamPal(t).name} Team`;
  const teamColor = (t) => teamPal(t).color;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const defaults = {
    mode: "relay",
    teamCount: 2,
    teamSizes: [3, 3],
    teamColors: [0, 1],
    decks: ["bollywood", "sports", "hollywood", "music"],
    seconds: 3,
    laps: 1,
    turns: 3,     // relay: turns per team
    chances: 1,   // relay: tries each player gets before the chain breaks
    rounds: 20,   // shout-out: number of faces
    customNames: "",
    muted: false,
    tvMode: false,  // higher-contrast look for TVs
  };

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return { ...defaults }; }
  }
  function saveSettings() {
    const { mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, customNames, muted, tvMode } = S;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, customNames, muted, tvMode })); } catch {}
  }

  // ---------- sound ----------
  let actx = null;
  function tone(freq, dur = 0.15, type = "sine", vol = 0.2, when = 0) {
    if (S.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + when;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  const sfx = {
    tick: () => tone(880, 0.06, "square", 0.08),
    go: () => { tone(523, 0.1, "triangle", 0.2); tone(784, 0.14, "triangle", 0.2, 0.08); },
    correct: () => { tone(988, 0.12, "sine", 0.25); tone(1319, 0.3, "sine", 0.25, 0.1); },
    wrong: () => { tone(160, 0.5, "sawtooth", 0.18); tone(120, 0.6, "sawtooth", 0.15, 0.05); },
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.22, i * 0.13)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, "triangle", 0.2, i * 0.22)),
  };

  // ---------- Wikipedia ----------
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } }
  function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

  async function wikiApi(params) {
    const u = new URL("https://en.wikipedia.org/w/api.php");
    Object.entries({ format: "json", formatversion: "2", origin: "*", ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u);
    if (!r.ok) throw new Error("Wikipedia " + r.status);
    return r.json();
  }

  // Wikipedia sometimes uses a signature, logo, flag or diagram as a page's main image.
  // Those are almost always SVG drawings, have tell-tale file names, or are very wide.
  function isPhoto(thumb) {
    if (!thumb?.source) return false;
    const file = decodeURIComponent(thumb.source.split("/").slice(-2).join("/"));
    if (/\.svg\b/i.test(file)) return false;
    if (/signature|autograph|logo|coat[_ ]of[_ ]arms|flag[_ ]of|emblem|wordmark/i.test(file)) return false;
    if (thumb.width && thumb.height && thumb.width / thumb.height > 1.6) return false;
    return true;
  }

  // Resolve a list of titles → [{key, name, desc, img}] (cached for a week)
  async function fetchPeople(titles) {
    const cache = readCache();
    const week = 7 * 864e5, now = Date.now();
    const out = new Map();
    const need = [];
    for (const t of titles) {
      const c = cache[t];
      if (c && now - c.at < week) out.set(t, c); else need.push(t);
    }
    for (let i = 0; i < need.length; i += 40) {
      const chunk = need.slice(i, i + 40);
      const j = await wikiApi({ action: "query", redirects: "1", prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "900", pilimit: "50", titles: chunk.join("|") });
      const norm = new Map();
      for (const n of j.query?.normalized || []) norm.set(n.from, n.to);
      for (const n of j.query?.redirects || []) norm.set(n.from, n.to);
      const pages = new Map((j.query?.pages || []).map((p) => [p.title, p]));
      for (const t of chunk) {
        let title = t, guard = 0;
        while (norm.has(title) && guard++ < 5) title = norm.get(title);
        const p = pages.get(title);
        if (p && !p.missing && isPhoto(p.thumbnail)) {
          const entry = { key: t, name: cleanName(p.title), desc: p.description || "", img: p.thumbnail.source, at: now };
          cache[t] = entry; out.set(t, entry);
        }
      }
    }
    writeCache(cache);
    return titles.map((t) => out.get(t)).filter(Boolean);
  }

  // Free-text names → best Wikipedia title
  async function searchTitle(q) {
    const j = await wikiApi({ action: "query", list: "search", srsearch: q, srlimit: "1", srnamespace: "0" });
    return j.query?.search?.[0]?.title || null;
  }

  function preload(src) {
    return new Promise((res) => {
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.onload = () => (im.decode ? im.decode().catch(() => {}).then(() => res(true)) : res(true));
      im.onerror = () => res(false);
      im.src = src;
    });
  }

  // ---------- state ----------
  const S = {
    ...loadSettings(),
    screen: "setup",       // setup | loading | ready | show | judge | result | turnEnd | final
    photos: [],            // own uploaded photos [{name, img}]
    queue: [], qi: 0, card: null,
    loadMsg: "", loadPct: 0, error: "",
    scores: [], clears: [],
    // relay
    team: 0, turnNo: 1, link: 0, run: 0, result: null, cleared: false,
    // shout
    round: 0, awarded: null,
    deadline: 0, secondsLeft: 0, lastTick: -1,
    paused: false, pauseLeft: 0, undone: false,   // pause / undo
    skipping: false, skipAt: 0,                   // 0.5s break after Skip before the next face
    undoStack: [],
  };
  const GAME_KEY = "face-relay:game:v1";
  // Saved settings from older versions: cricket merged into sports; drop decks that no longer exist
  S.decks = [...new Set((S.decks || []).map((d) => (d === "cricket" ? "sports" : d)))].filter((d) => window.DECKS[d]);
  S.teamCount = clamp(+S.teamCount || 2, 1, MAX_TEAMS);
  if (!Array.isArray(S.teamSizes)) S.teamSizes = [];
  if (!Array.isArray(S.teamColors)) S.teamColors = [];
  S.colorPick = null;   // team whose color picker is open
  syncTeams();
  // Keep one size per team: new teams copy the last team's size
  function syncTeams() {
    const last = S.teamSizes.length ? S.teamSizes[S.teamSizes.length - 1] : 3;
    S.teamSizes = Array.from({ length: S.teamCount }, (_, t) => clamp(+S.teamSizes[t] || last, 1, MAX_PER_TEAM));
    // Colors: keep existing picks, no duplicates, fill new teams with the first unused color
    const used = new Set();
    S.teamColors = Array.from({ length: S.teamCount }, (_, t) => {
      let c = S.teamColors[t];
      if (!(c >= 0 && c < TEAMS.length) || used.has(c)) c = TEAMS.findIndex((_, i) => !used.has(i) && !S.teamColors.slice(t + 1).includes(i));
      if (c < 0) c = TEAMS.findIndex((_, i) => !used.has(i));
      used.add(c); return c;
    });
  }
  function setTeamColor(t, c) {
    const other = S.teamColors.indexOf(c);
    if (other >= 0 && other !== t) S.teamColors[other] = S.teamColors[t];   // swap so colors stay unique
    S.teamColors[t] = c;
  }

  // Answering order for the current team. Every team gets the same number of faces per turn
  // (the size of the biggest team); smaller teams go around again: P1, P2, P1, P2.
  // "Down & back" then reverses that order.
  function chainOrder() {
    const size = S.teamSizes[S.team];
    const len = Math.max(...S.teamSizes.slice(0, S.teamCount));
    const base = Array.from({ length: len }, (_, i) => i % size);
    return S.laps === 2 ? base.concat(base.slice().reverse()) : base;
  }
  const playerLabel = (i) => `Player ${i + 1}`;

  function nextCard() {
    S.card = S.queue[S.qi++];
    if (S.qi >= S.queue.length) { S.queue = shuffle(S.queue); S.qi = 0; }
    markSeen(S.card.key);
  }
  function markSeen(key) {
    try {
      const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]").filter((k) => k !== key);
      seen.push(key); localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-300)));
    } catch {}
  }
  function orderBySeen(cards) {
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch {}
    const rank = new Map(seen.map((k, i) => [k, i]));
    const fresh = shuffle(cards.filter((c) => !rank.has(c.key)));
    const old = cards.filter((c) => rank.has(c.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
    return fresh.concat(old);
  }

  // ---------- game flow ----------
  async function startGame() {
    enterFullscreen();   // must run before the first await (needs the click/keypress)
    clearGame();
    saveSettings();
    S.screen = "loading"; S.error = ""; S.loadPct = 0; S.loadMsg = "Loading"; render();

    try {
      const titles = new Set();
      S.decks.forEach((d) => window.DECKS[d]?.people.forEach((t) => titles.add(t)));
      const custom = S.customNames.split("\n").map((s) => s.trim()).filter(Boolean);
      if (custom.length) {
        render();
        const found = await Promise.all(custom.map((n) => searchTitle(n).catch(() => null)));
        found.forEach((t) => t && titles.add(t));
      }
      let cards = [];
      if (titles.size) {
        render();
        cards = await fetchPeople([...titles]);
      }
      cards = cards.concat(S.photos.map((p) => ({ key: "own:" + p.name, name: p.name, desc: "", img: p.img })));
      if (!cards.length) throw new Error("Pick at least one deck.");

      cards = orderBySeen(cards);
      // Preload the first batch before starting, the rest in the background.
      const first = Math.min(cards.length, 12);
      let done = 0;
      const ok = await Promise.all(cards.slice(0, first).map((c) => preload(c.img).then((r) => { done++; S.loadPct = done / first; updateLoadBar(); return r; })));
      const good = cards.slice(0, first).filter((_, i) => ok[i]);
      const rest = cards.slice(first);
      S.queue = good.concat(rest); S.qi = 0;
      rest.forEach((c) => preload(c.img).then((r) => { if (!r) S.queue = S.queue.filter((x) => x !== c); }));
      if (!S.queue.length) throw new Error("Couldn't load photos. Check your connection.");
    } catch (e) {
      S.error = e.message || String(e); S.screen = "setup"; render(); return;
    }

    S.scores = Array(S.teamCount).fill(0);
    S.clears = Array(S.teamCount).fill(0);
    S.team = 0; S.turnNo = 1; S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false;
    S.round = 0; S.awarded = null; S.undoStack = []; S.paused = false; S.undone = false;
    S.screen = "ready"; render();
  }

  function go() {
    if (S.mode === "shout") S.round++;
    nextCard();
    S.result = null; S.awarded = null; S.paused = false; S.undone = false; S.skipping = false;
    S.deadline = performance.now() + S.seconds * 1000;
    S.lastTick = -1;
    S.screen = "show"; sfx.go(); render();
  }

  const timeLeft = () => Math.max(0, S.paused ? S.pauseLeft : (S.deadline - performance.now()) / 1000);

  // ---- Undo: remember the game right before every call (correct / wrong / timeout / award)
  function snapshot() {
    S.undoStack.push({
      scores: S.scores.slice(), clears: S.clears.slice(), team: S.team, turnNo: S.turnNo, link: S.link,
      run: S.run, misses: S.misses, round: S.round, card: S.card, left: timeLeft(),
    });
    if (S.undoStack.length > 30) S.undoStack.shift();
  }
  function undo() {
    if (!["show", "result", "turnEnd", "ready", "final"].includes(S.screen)) return;
    const u = S.undoStack.pop();
    if (!u) return toast("Nothing to undo");
    document.getElementById("confetti").innerHTML = "";
    Object.assign(S, { scores: u.scores, clears: u.clears, team: u.team, turnNo: u.turnNo, link: u.link,
      run: u.run, misses: u.misses, round: u.round, card: u.card });
    // Back on the same face with the clock frozen, ready to be judged again
    S.result = null; S.awarded = null; S.cleared = false;
    S.screen = "show"; S.paused = true; S.pauseLeft = u.left; S.undone = true;
    render();
  }

  // ---- Pause: freezes the clock and hides the face (no peeking while paused)
  function togglePause() {
    if (S.screen !== "show" || S.skipping) return;
    if (S.paused) { S.deadline = performance.now() + S.pauseLeft * 1000; S.paused = false; S.undone = false; }
    else { S.pauseLeft = timeLeft(); S.paused = true; }
    render();
  }

  // ---- Skip: hide the face, give everyone a second to reorient, then deal a new face with full time (no penalty)
  const SKIP_DELAY_MS = 500;
  function skip() {
    if (S.screen !== "show" || (S.paused && !S.undone) || S.skipping) return;
    S.paused = false; S.undone = false;
    S.skipping = true; S.skipAt = performance.now() + SKIP_DELAY_MS;
    render();
  }
  function finishSkip() {
    S.skipping = false;
    nextCard();
    S.deadline = performance.now() + S.seconds * 1000; S.lastTick = -1;
    sfx.go(); render();
  }

  function stopClock() { S.secondsLeft = timeLeft(); }

  // Relay judging
  function judge(correct) {
    if (S.mode !== "relay" || inputLocked()) return;
    if (S.screen !== "show" || (S.paused && !S.undone) || S.skipping) return;
    stopClock(); snapshot(); S.paused = false; S.undone = false;
    S.result = correct ? "correct" : "wrong";
    if (correct) { S.scores[S.team]++; S.run++; sfx.correct(); }
    else { S.misses++; sfx.wrong(); }
    S.screen = "result";
    render();
  }
  let autoTimer = null;
  function timeUp() {
    snapshot();
    if (S.mode === "relay") {
      S.secondsLeft = 0; S.misses++; S.result = "timeout"; S.screen = "result"; sfx.wrong(); render();
    } else {
      S.awarded = -1; S.screen = "result"; sfx.wrong(); render();
    }
  }

  function advance() {
    clearTimeout(autoTimer);
    if (S.mode === "shout") {
      if (S.screen !== "result") return;
      if (S.round >= S.rounds) return finish();
      S.screen = "ready"; return render();
    }
    if (S.screen === "result") {
      if (S.result === "correct" && S.link < chainOrder().length - 1) { S.link++; S.misses = 0; S.result = null; S.screen = "ready"; return render(); }
      // Missed, but this player still has chances left: same player, new face
      if (S.result !== "correct" && S.misses < S.chances) { S.result = null; S.screen = "ready"; return render(); }
      // Turn over: either the whole chain cleared or someone missed
      S.cleared = S.result === "correct";
      if (S.cleared) { S.scores[S.team] += CHAIN_BONUS; S.clears[S.team]++; sfx.win(); confetti(); }
      S.screen = "turnEnd"; return render();
    }
    if (S.screen === "turnEnd") {
      S.team++;
      if (S.team >= S.teamCount) { S.team = 0; S.turnNo++; }
      if (S.turnNo > S.turns) return finish();
      S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false;
      S.screen = "ready"; return render();
    }
  }

  function finish() { S.screen = "final"; sfx.win(); confetti(); render(); clearGame(); }

  // Shout-out: award a team
  function award(t) {
    if (S.mode !== "shout" || S.screen !== "show" || (S.paused && !S.undone) || S.skipping || inputLocked()) return;
    stopClock(); snapshot(); S.paused = false; S.undone = false;
    if (t >= 0 && t < S.teamCount) { S.scores[t]++; S.awarded = t; sfx.correct(); }
    else { S.awarded = -1; sfx.wrong(); }
    S.screen = "result"; render();
  }

  function primary() {
    if (S.screen !== "setup" && inputLocked()) return;
    switch (S.screen) {
      case "setup": return startGame();
      case "ready": return go();
      case "show":
        if (S.skipping) return;
        if (S.paused && !S.undone) return togglePause();   // Space resumes a paused face
        if (S.mode === "relay") judge(true); else award(-1); return;
      case "result": case "turnEnd": return advance();
      case "final": return toMenu();
    }
  }

  // Restart the current game with the same teams and settings (photos stay loaded)
  // In-page confirm. The browser's built-in confirm dialog forces Chrome out of fullscreen.
  function ask(message, okLabel) {
    document.querySelector("dialog.confirm")?.remove();
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "confirm";
      d.innerHTML = `<p>${esc(message)}</p><form method="dialog" class="confirm-actions">
        <button class="big neutral" value="no">Cancel</button>
        <button class="big go" value="yes" autofocus>${esc(okLabel)}</button></form>`;
      d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
      document.body.appendChild(d);
      d.showModal();
    });
  }

  async function restart(confirmed = false) {
    if (!["ready", "show", "result", "turnEnd", "final"].includes(S.screen)) return;
    if (!confirmed && !(await ask("Restart the game?", "Restart"))) return;
    clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = "";
    S.scores = Array(S.teamCount).fill(0); S.clears = Array(S.teamCount).fill(0);
    S.team = 0; S.turnNo = 1; S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false;
    S.round = 0; S.awarded = null; S.undoStack = []; S.paused = false; S.undone = false; S.skipping = false; S.screen = "ready"; render();
  }

  function toMenu() { S.skipping = false; clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = ""; clearGame(); S.screen = "setup"; render(); }

  // ---------- save / resume (localStorage on this device) ----------
  const GAME_FIELDS = ["mode", "teamCount", "teamSizes", "teamColors", "seconds", "laps", "turns", "chances", "rounds",
    "scores", "clears", "team", "turnNo", "link", "run", "misses", "result", "cleared", "round", "awarded", "screen", "card", "qi"];
  function saveGame() {
    if (!["ready", "show", "result", "turnEnd"].includes(S.screen)) return;
    const g = { savedAt: Date.now() };
    GAME_FIELDS.forEach((k) => (g[k] = S[k]));
    if (g.screen === "show") g.screen = "ready";   // a face that was on screen is re-dealt on resume
    // Uploaded photos only live in this tab's memory, so they can't be resumed
    g.queue = S.queue.filter((c) => !String(c.img).startsWith("blob:"));
    if (g.card && String(g.card.img).startsWith("blob:")) { g.card = null; if (g.screen === "result") g.screen = "ready"; }
    try { localStorage.setItem(GAME_KEY, JSON.stringify(g)); } catch {}
  }
  function loadGame() {
    try {
      const g = JSON.parse(localStorage.getItem(GAME_KEY) || "null");
      if (!g || Date.now() - g.savedAt > 12 * 3600e3 || !g.queue?.length) return null;
      return g;
    } catch { return null; }
  }
  function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch {} }
  function resumeGame() {
    const g = loadGame(); if (!g) return;
    enterFullscreen();
    GAME_FIELDS.forEach((k) => { if (k in g) S[k] = g[k]; });
    S.queue = g.queue; S.qi = Math.min(g.qi || 0, S.queue.length - 1);
    if (!S.card && S.screen === "result") S.screen = "ready";
    S.undoStack = []; S.paused = false; S.undone = false;
    saveSettings(); render();
  }

  // ---------- timer loop ----------
  function loop() {
    if (S.screen === "show" && S.skipping && !IS_HOST_VIEW) {
      const left = S.skipAt - performance.now();
      if (left <= 0) finishSkip();
    } else if (S.screen === "show" && !S.paused && !IS_HOST_VIEW) {
      const left = (S.deadline - performance.now()) / 1000;
      const bar = document.getElementById("timebar"), num = document.getElementById("timenum");
      const frac = Math.max(0, left / S.seconds);
      if (bar) { bar.style.transform = `scaleX(${frac})`; bar.dataset.hot = frac < 0.34 ? "1" : ""; }
      const whole = Math.ceil(Math.max(0, left));
      if (num && num.textContent !== String(whole)) num.textContent = whole;
      if (whole !== S.lastTick && whole > 0 && whole <= 3) { S.lastTick = whole; sfx.tick(); }
      if (left <= 0) timeUp();
    }
    requestAnimationFrame(loop);
  }

  // ---------- effects ----------
  function confetti() {
    const box = document.getElementById("confetti");
    box.innerHTML = "";
    for (let i = 0; i < 120; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = TEAMS[i % TEAMS.length].color;
      c.style.animationDelay = Math.random() * 1.2 + "s";
      c.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      c.style.setProperty("--r", (Math.random() * 720 - 360) + "deg");
      box.appendChild(c);
    }
    setTimeout(() => (box.innerHTML = ""), 5000);
  }
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
  }
  function updateLoadBar() { const b = document.getElementById("loadbar"); if (b) b.style.transform = `scaleX(${S.loadPct})`; }

  // Line icons (stroke = currentColor)
  const svg = (d, extra = "") => `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const IC = {
    pause: svg('<path d="M9 5v14M15 5v14"/>'),
    play: svg('<path d="M7 5l12 7-12 7z"/>'),
    skip: svg('<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    tv: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 20h8"/>'),
    remote: svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 10l4 4M20 10l-4 4"/>'),
    restart: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    chain: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    shout: svg('<path d="M3 10v4h3l8 5V5L6 10z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5"/>'),
  };

  // ---------- rendering ----------
  // Ignore game input for a moment after each screen change so a double tap can't skip a step
  const INPUT_LOCK_MS = 350;
  let lastScreen = null, lockUntil = 0;
  const inputLocked = () => performance.now() < lockUntil;

  function render() {
    document.body.classList.toggle("tv", !!S.tvMode);
    if (IS_HOST_VIEW) return;
    if (S.screen !== lastScreen) { lastScreen = S.screen; lockUntil = performance.now() + INPUT_LOCK_MS; }
    $app.dataset.screen = S.screen;
    $app.innerHTML = S.screen === "setup" ? viewSetup() : S.screen === "loading" ? viewLoading() : viewGame();
    if (S.screen === "setup") bindSetup();
    saveGame();
    broadcast();
  }

  const keyHint = (k, label) => `<span class="kh"><kbd>${k}</kbd>${label}</span>`;

  function stepper(key, value, min, max) {
    return `<div class="stepper">
      <button type="button" data-step="${key}" data-d="-1" ${value <= min ? "disabled" : ""} aria-label="Fewer">−</button>
      <b>${value}</b>
      <button type="button" data-step="${key}" data-d="1" ${value >= max ? "disabled" : ""} aria-label="More">+</button></div>`;
  }

  function viewSetup() {
    const relay = S.mode === "relay";
    const deckChips = Object.entries(window.DECKS).map(([k, d]) => `
      <button class="deck ${S.decks.includes(k) ? "on" : ""}" data-deck="${k}" type="button">
        <span>${esc(d.label)}</span><small>${d.people.length}</small>
      </button>`).join("");
    const teamPreview = Array.from({ length: S.teamCount }, (_, t) => `
      <div class="tprev" style="--c:${teamColor(t)}">
        <div class="thead"><button type="button" class="swatch" data-colorpick="${t}" aria-label="Change ${teamName(t)} color" aria-expanded="${S.colorPick === t}"></button><b>${teamName(t)}</b></div>
        ${S.colorPick === t ? `<div class="swatches" role="listbox" aria-label="Team color">${TEAMS.map((c, i) => {
          const owner = S.teamColors.indexOf(i);
          return `<button type="button" class="sw ${i === S.teamColors[t] ? "on" : ""} ${owner >= 0 && owner !== t ? "taken" : ""}" data-setcolor="${t}:${i}" style="--c:${c.color}" title="${c.name}${owner >= 0 && owner !== t ? " (swap with " + teamName(owner) + ")" : ""}" aria-label="${c.name}"></button>`;
        }).join("")}</div>` : ""}
        ${relay ? `<div class="psize"><button type="button" data-tsize="${t}" data-d="-1" ${S.teamSizes[t] <= 1 ? "disabled" : ""} aria-label="Remove a player from ${teamName(t)}">−</button>
          <span class="pdots">${Array.from({ length: S.teamSizes[t] }, (_, p) => `<i>${p + 1}</i>`).join("")}</span>
          <button type="button" data-tsize="${t}" data-d="1" ${S.teamSizes[t] >= MAX_PER_TEAM ? "disabled" : ""} aria-label="Add a player to ${teamName(t)}">+</button></div>` : ""}</div>`).join("");
    const segs = (name, vals, cur, fmt = (v) => v) => `<div class="seg">${vals.map((v) => `<button type="button" data-${name}="${v}" class="${v === cur ? "on" : ""}">${fmt(v)}</button>`).join("")}</div>`;

    return `
    <main class="setup">
      <header class="brand">
        <div class="logo"><span class="logo-mark" aria-hidden="true"><i></i><i></i></span><h1>Face Relay</h1></div>
        <div class="top-actions">
          ${remotePill()}
          <button class="ghost ${S.tvMode ? "active" : ""}" data-act="tv" type="button" aria-pressed="${!!S.tvMode}" title="Higher contrast for TVs (T)">${IC.tv} TV mode</button>
          <button class="ghost" data-act="fs" type="button">${IC.expand} Fullscreen</button>
        </div>
      </header>
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ""}
      ${(() => { const g = loadGame(); if (!g) return "";
        const names = g.scores.map((sc, t) => { const pal = TEAMS[g.teamColors?.[t] ?? t] || TEAMS[t]; return `<span class="rs"><i class="dot" style="--c:${pal.color}"></i>${pal.name} ${sc}</span>`; }).join("");
        return `<div class="resume"><span class="rtitle">Game in progress</span>${names}<span class="spacer"></span>
          <button class="ghost" data-act="discard" type="button">Discard</button>
          <button class="big go resume-btn" data-act="resume" type="button">Resume</button></div>`; })()}
      <div class="setup-main">
      <div class="cols">
        <section class="panel">
          <h2>Mode</h2>
          <div class="modes">
            <button type="button" class="mode ${relay ? "on" : ""}" data-mode="relay">
              <b>${IC.chain} Relay Chain</b><span>Teams take turns. Players answer in order.</span>
            </button>
            <button type="button" class="mode ${!relay ? "on" : ""}" data-mode="shout">
              <b>${IC.shout} Shout-Out Battle</b><span>First team to shout the name scores.</span>
            </button>
          </div>
          <h2>Teams</h2>
          <div class="steppers">${stepper("teamCount", S.teamCount, 1, MAX_TEAMS)}</div>
          <div class="tpreviews">${teamPreview}</div>
        </section>
        <section class="panel">
          <h2>Faces</h2>
          <div class="decks">${deckChips}</div>
          <details class="custom" ${S.customNames.trim() || S.photos.length ? "open" : ""}>
            <summary>Add</summary>
            <div class="custom-body">
            <label class="lbl">Names, one per line</label>
            <textarea id="customNames" rows="3" placeholder="Sunil Grover&#10;Kapil Sharma&#10;MrBeast">${esc(S.customNames)}</textarea>
            <label class="lbl">Photos (file name is the answer)</label>
            <input type="file" id="photos" accept="image/*" multiple />
            ${S.photos.length ? `<div class="thumbs">${S.photos.map((p, i) => `<figure><img src="${p.img}" alt=""><figcaption>${esc(p.name)}</figcaption><button class="x" data-delphoto="${i}" type="button">×</button></figure>`).join("")}</div>` : ""}
            </div>
          </details>
          <div class="row">
            <div><h3>Time</h3>${segs("secs", [2, 3, 5, 8], S.seconds, (v) => v + "s")}</div>
            ${relay
              ? `<div><h3>Turns per team</h3>${segs("turns", [1, 2, 3, 5], S.turns)}</div>
                 <div><h3>Chances per player</h3>${segs("chances", [1, 2, 3], S.chances)}</div>
                 <div><h3>Order</h3>${segs("laps", [1, 2], S.laps, (v) => (v === 1 ? "Once" : "Down & back"))}</div>`
              : `<div><h3>Faces</h3>${segs("rounds", [10, 20, 30, 50], S.rounds)}</div>`}
          </div>
        </section>
      </div>
      <footer class="startbar">
        <button class="big go start-btn" data-act="start" type="button">Start</button>
      </footer>
      </div>
    </main>`;
  }

  function viewLoading() {
    return `<main class="center loading">
      <div class="spinner"></div>
      <div class="loadtrack"><div id="loadbar" style="transform:scaleX(${S.loadPct})"></div></div>
    </main>`;
  }

  // Team scoreboard. In shout mode the pills are clickable award buttons.
  function scoreboard() {
    const shout = S.mode === "shout";
    const lead = Math.max(...S.scores);
    return `<div class="scores">${S.scores.map((s, t) => `
      <button type="button" class="score ${S.mode === "relay" && t === S.team ? "cur" : ""} ${shout && S.awarded === t ? "hit" : ""} ${s === lead && lead > 0 && S.teamCount > 1 ? "lead" : ""}"
        ${shout ? `data-award="${t}"` : 'tabindex="-1"'} style="--c:${teamColor(t)}">
        ${shout ? `<kbd>${t + 1}</kbd>` : ""}<i class="dot"></i><span class="sn">${teamName(t)}</span><b>${s}</b>
      </button>`).join("")}</div>`;
  }

  function chain() {
    const order = chainOrder();
    return `<div class="chain" style="--c:${teamColor(S.team)}">${order.map((pi, i) => {
      const out = S.result && S.result !== "correct" && S.misses >= S.chances;
      const state = i < S.link || (i === S.link && S.result === "correct") ? "done" : i === S.link ? (out && S.screen !== "ready" ? "fail" : "now") : "";
      const pips = S.chances > 1 && i === S.link && state !== "done"
        ? `<span class="pips">${Array.from({ length: S.chances }, (_, k) => `<i class="${k < S.misses ? "used" : ""}"></i>`).join("")}</span>` : "";
      return `<div class="link ${state}"><span>P${pi + 1}</span>${pips}</div>`;
    }).join('<i class="joint"></i>')}</div>`;
  }

  function photo(revealed, cls = "") {
    const c = S.card;
    return `<figure class="photo ${cls}">
      <div class="frame"><img src="${esc(c.img)}" alt="Who is this?" referrerpolicy="no-referrer" /></div>
      ${revealed ? `<figcaption class="on"><b>${esc(c.name)}</b>${c.desc ? `<small>${esc(c.desc)}</small>` : ""}</figcaption>` : ""}
    </figure>`;
  }

  function podium() {
    const ranked = S.scores.map((s, t) => ({ t, s, c: S.clears[t] })).sort((a, b) => b.s - a.s);
    const rankOf = (r) => ranked.findIndex((x) => x.s === r.s);
    return `<ol class="podium">${ranked.map((r) => {
      const k = rankOf(r);
      const meta = S.mode === "relay" && r.c ? `${r.c} chain${r.c > 1 ? "s" : ""}` : "";
      return `<li class="${k === 0 && r.s > 0 ? "top" : ""}" style="--c:${teamColor(r.t)}">
        <span class="rank">${S.teamCount > 1 ? k + 1 : ""}</span>
        <span class="team"><i class="dot"></i>${teamName(r.t)}</span>
        <span class="meta">${meta}</span>
        <span class="pts">${r.s}</span></li>`;
    }).join("")}</ol>`;
  }

  function viewGame() {
    const relay = S.mode === "relay";
    const tc = teamColor(S.team);
    let top = relay ? chain() : "";
    const progress = relay ? `Turn <b>${Math.min(S.turnNo, S.turns)}</b>/${S.turns}` : `Face <b>${Math.max(S.round, 1)}</b>/${S.rounds}`;
    let stage = "", keys = "", bottom = "";

    switch (S.screen) {
      case "ready": {
        if (relay) {
          const order = chainOrder();
          const pi = order[S.link];
          stage = `<div class="ready" style="--c:${tc}">
            ${S.misses > 0 ? `<p class="eyebrow">Chance ${S.misses + 1} of ${S.chances}</p>` : ""}
            <h2 class="who">${playerLabel(pi)}</h2></div>`;
        } else {
          stage = `<div class="ready"><h2 class="who">Face ${S.round + 1}</h2></div>`;
        }
        break;
      }
      case "show": {
        const left = S.skipping ? S.seconds : timeLeft(), frac = Math.max(0, left / S.seconds);
        const state = S.skipping ? "paused skipping" : S.undone ? "undone" : S.paused ? "paused" : "";
        stage = `<div class="showwrap ${state}">${photo(false, "live")}
            ${S.skipping ? `<div class="state-chip" id="skipchip">Skipping</div>` : S.undone ? `<div class="state-chip">Undone · judge again</div>` : S.paused ? `<div class="state-chip">Paused</div>` : ""}</div>
          <div class="timer"><div class="track"><div id="timebar" style="transform:scaleX(${frac})" data-hot="${frac < 0.34 ? 1 : ""}"></div></div><div id="timenum">${Math.ceil(left)}</div></div>`;
        keys = relay ? "" : `${keyHint(`1–${S.teamCount}`, "award")} ${keyHint("0", "nobody")}`;
        break;
      }
      case "result": {
        if (relay) {
          const ok = S.result === "correct";
          const last = S.link >= chainOrder().length - 1;
          stage = `<div class="showwrap">${photo(true, ok ? "good" : "bad")}</div>`;
        } else {
          stage = `<div class="showwrap">${photo(true, S.awarded >= 0 ? "good" : "bad")}</div>`;
        }
        break;
      }
      case "turnEnd": {
        const lastTurn = S.team === S.teamCount - 1 && S.turnNo >= S.turns;
        const nextTeam = (S.team + 1) % S.teamCount;
        stage = `<div class="ready turnend" style="--c:${tc}">
          <h2 class="who">${S.cleared ? "Chain cleared" : `${S.run} point${S.run === 1 ? "" : "s"}`}</h2>
          ${!lastTurn && S.teamCount > 1 ? `<p class="sub next">Next: <b style="color:${teamColor(nextTeam)}">${teamName(nextTeam)}</b></p>` : ""}</div>`;
        break;
      }
      case "final": {
        top = ""; bottom = "";
        const ranked = S.scores.map((s, t) => ({ s, t })).sort((a, b) => b.s - a.s);
        const leaders = ranked.filter((r) => r.s === ranked[0].s);
        const headline = S.teamCount === 1 ? `${ranked[0].s} points`
          : ranked[0].s === 0 ? "Nobody scored"
          : leaders.length > 1 ? "Tie"
          : `<span style="color:${teamColor(ranked[0].t)}">${teamName(ranked[0].t)}</span> wins`;
        stage = `<div class="end win"><h2>${headline}</h2>
          ${podium()}
          <button class="big go" data-act="primary" type="button">Menu</button></div>`;
        break;
      }
    }

    return `<main class="game ${relay ? "relay" : "shout"} s-${S.screen}">
      ${top}
      <section class="stage">${stage}</section>
      ${bottom}
      <footer class="keys">${S.screen !== "final" ? `${scoreboard()}<span class="prog">${progress}</span>` : ""}${keys ? `<span class="hints">${keys}</span>` : ""}<span class="spacer"></span>${phoneConns.size ? `<span class="kh live">${IC.remote} Phone connected</span>` : ""}
        ${S.screen === "show" && !S.undone && !S.skipping ? `<button class="txt-btn" data-act="pause" type="button" title="Pause (P)"><kbd>P</kbd>${S.paused ? "Resume" : "Pause"}</button>` : ""}
        ${S.screen === "show" && !(S.paused && !S.undone) && !S.skipping ? `<button class="txt-btn" data-act="skip" type="button" title="Skip face (S)"><kbd>S</kbd>Skip</button>` : ""}
        ${S.undoStack.length && S.screen === "result" ? `<button class="txt-btn" data-act="undo" type="button" title="Undo last call (U)"><kbd>U</kbd>Undo</button>` : ""}
        <button class="ghost sm icon" data-act="restart" type="button" title="Restart (R)" aria-label="Restart">${IC.restart}</button>
        <button class="ghost sm icon" data-act="mute" type="button" title="Sound (M)" aria-label="${S.muted ? "Unmute" : "Mute"}">${S.muted ? IC.soundOff : IC.soundOn}</button>
        <button class="ghost sm icon" data-act="fs" type="button" title="Fullscreen (F)" aria-label="Fullscreen">${IC.expand}</button>
        <button class="ghost sm" data-act="menu" type="button" title="Menu (Esc)">${IC.menu} Menu</button></footer>
    </main>`;
  }

  // ---------- setup bindings ----------
  function bindSetup() {
    const ta = document.getElementById("customNames");
    ta?.addEventListener("input", () => { S.customNames = ta.value; saveSettings(); });
    document.getElementById("photos")?.addEventListener("change", (e) => {
      [...e.target.files].forEach((f) => {
        const name = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s*\(\d+\)$/, "").trim();
        S.photos.push({ name, img: URL.createObjectURL(f) });
      });
      render();
    });
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    if (IS_HOST_VIEW) return;
    if (S.colorPick !== null && !e.target.closest(".swatches, [data-colorpick]")) { S.colorPick = null; render(); }
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.deck) { S.decks = S.decks.includes(d.deck) ? S.decks.filter((x) => x !== d.deck) : S.decks.concat(d.deck); saveSettings(); return render(); }
    if (d.mode) { S.mode = d.mode; if (S.mode === "shout" && S.seconds < 5) S.seconds = 5; if (S.mode === "relay" && S.seconds > 3) S.seconds = 3; saveSettings(); return render(); }
    if (d.step) {
      S.teamCount = clamp(S.teamCount + +d.d, 1, MAX_TEAMS); syncTeams(); saveSettings(); return render();
    }
    if (d.colorpick !== undefined) { const t = +d.colorpick; S.colorPick = S.colorPick === t ? null : t; return render(); }
    if (d.setcolor) { const [t, c] = d.setcolor.split(":").map(Number); setTeamColor(t, c); S.colorPick = null; saveSettings(); return render(); }
    if (d.tsize !== undefined) {
      const i = +d.tsize; S.teamSizes[i] = clamp(S.teamSizes[i] + +d.d, 1, MAX_PER_TEAM); saveSettings(); return render();
    }
    if (d.secs) { S.seconds = +d.secs; saveSettings(); return render(); }
    if (d.laps) { S.laps = +d.laps; saveSettings(); return render(); }
    if (d.turns) { S.turns = +d.turns; saveSettings(); return render(); }
    if (d.chances) { S.chances = +d.chances; saveSettings(); return render(); }
    if (d.rounds) { S.rounds = +d.rounds; saveSettings(); return render(); }
    if (d.delphoto) { URL.revokeObjectURL(S.photos[+d.delphoto].img); S.photos.splice(+d.delphoto, 1); return render(); }
    if (d.award !== undefined) return award(+d.award);
    switch (d.act) {
      case "start": return startGame();
      case "primary": return primary();
      case "fs": return toggleFs();
      case "tv": S.tvMode = !S.tvMode; saveSettings(); return render();
      case "restart": return restart();
      case "pause": return togglePause();
      case "skip": return skip();
      case "undo": return undo();
      case "resume": return resumeGame();
      case "discard": clearGame(); return render();
      case "mute": S.muted = !S.muted; saveSettings(); return render();
      case "menu": ask("Quit to menu?", "Quit").then((ok) => ok && toMenu()); return;
      case "host": return openRemoteDialog();
      case "remoteOff": userTurnedOff = true; stopRoom(); toast("Phone disconnected"); return;
    }
  });

  function enterFullscreen() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen()
      .then(() => { navigator.keyboard?.lock?.(["Escape"]).catch(() => {}); if (S.screen === "setup") render(); })
      .catch(() => {});
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else enterFullscreen();
  }

  document.addEventListener("keydown", (e) => {
    if (IS_HOST_VIEW) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector("dialog[open]");
    if (typing) return;
    const k = e.key;
    if (e.repeat) { if (k === " ") e.preventDefault(); return; }
    if (k === "Escape" && S.colorPick !== null) { S.colorPick = null; return render(); }
    if (k === " " || k === "Spacebar") { e.preventDefault(); return primary(); }
    if (k === "Enter" && S.screen === "setup") { e.preventDefault(); return startGame(); }
    if (k === "ArrowLeft" || k === "Backspace" || k === "x" || k === "X") { e.preventDefault(); return judge(false); }
    if ((k === "r" || k === "R") && S.screen !== "setup" && S.screen !== "loading") return restart();
    if (/^[0-9]$/.test(k) && S.mode === "shout") return award(k === "0" ? -1 : +k - 1);
    if (k === "f" || k === "F") return toggleFs();
    if (k === "p" || k === "P") return togglePause();
    if (k === "s" || k === "S") return skip();
    if (k === "u" || k === "U") return undo();
    if (k === "m" || k === "M") { S.muted = !S.muted; saveSettings(); return render(); }
    if (k === "t" || k === "T") { S.tvMode = !S.tvMode; saveSettings(); return render(); }
    if (k === "Escape" && S.screen !== "setup" && S.screen !== "loading") { e.preventDefault(); ask("Quit to menu?", "Quit").then((ok) => ok && toMenu()); }
  });

  // ---------- remote control ----------
  // The phone scans a QR code and connects straight to this browser over WebRTC (PeerJS).
  // The free PeerJS server only introduces the two devices; game messages go device to device.
  const PEERJS_SRC = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
  const QR_SRC = "https://unpkg.com/qrcode-generator@1.4.4/qrcode.js";
  const PEER_PREFIX = "facerelay-v1-";
  const ROOM_KEY = "face-relay:room:v1";
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const randomCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  const scripts = {};
  const loadScript = (src) => scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = src; el.onload = res; el.onerror = () => { delete scripts[src]; rej(new Error("load")); };
    document.head.appendChild(el);
  }));

  let peer = null, roomCode = null, roomStatus = "off";   // off | starting | ready | error
  const phoneConns = new Set();

  async function startRoom() {
    if (peer || roomStatus === "starting") return;
    roomStatus = "starting"; paintRemoteDialog(); render();
    try { await loadScript(PEERJS_SRC); } catch { roomStatus = "error"; return paintRemoteDialog(); }
    let code = localStorage.getItem(ROOM_KEY) || randomCode();
    openPeer(code, 0);
  }
  function openPeer(code, attempt) {
    peer = new window.Peer(PEER_PREFIX + code, { debug: 0 });
    peer.on("open", () => { roomCode = code; roomStatus = "ready"; try { localStorage.setItem(ROOM_KEY, code); } catch {} paintRemoteDialog(); render(); });
    peer.on("connection", (conn) => {
      conn.on("open", () => { phoneConns.add(conn); broadcast(); render(); paintRemoteDialog(); });
      conn.on("data", handleRemote);
      const drop = () => { if (phoneConns.delete(conn)) { render(); paintRemoteDialog(); } };
      conn.on("close", drop); conn.on("error", drop);
    });
    peer.on("disconnected", () => { try { peer.reconnect(); } catch {} });
    peer.on("error", (e) => {
      if (e.type === "unavailable-id") {
        // After a refresh the old room can take a few seconds to free up; then fall back to a new code
        peer.destroy(); peer = null;
        return setTimeout(() => openPeer(attempt < 3 ? code : randomCode(), attempt + 1), 2500);
      }
      if (["network", "server-error", "socket-error", "socket-closed", "browser-incompatible"].includes(e.type)) { roomStatus = "error"; paintRemoteDialog(); }
    });
  }
  // Reconnect the room automatically after a refresh if a phone was used before
  if (!IS_HOST_VIEW && localStorage.getItem(ROOM_KEY)) setTimeout(startRoom, 500);

  // Turn the phone remote off: disconnect phones, close the room, and stop it reopening after a refresh
  function stopRoom() {
    for (const c of phoneConns) { try { c.send({ type: "off" }); } catch {} }
    const closing = [...phoneConns];
    setTimeout(() => closing.forEach((c) => { try { c.close(); } catch {} }), 300);   // let the "off" message arrive first
    phoneConns.clear();
    try { peer?.destroy(); } catch {}
    peer = null; roomCode = null; roomStatus = "off";
    try { localStorage.removeItem(ROOM_KEY); } catch {}
    render(); paintRemoteDialog();
  }

  function applySetting(k, v) {
    if (S.screen !== "setup") return;
    const n = +v;
    switch (k) {
      case "mode": S.mode = v === "shout" ? "shout" : "relay";
        if (S.mode === "shout" && S.seconds < 5) S.seconds = 5; if (S.mode === "relay" && S.seconds > 3) S.seconds = 3; break;
      case "teamCount": S.teamCount = clamp(n, 1, MAX_TEAMS); syncTeams(); break;
      case "teamSize": { const [t, d] = String(v).split(":").map(Number); if (S.teamSizes[t] != null) S.teamSizes[t] = clamp(S.teamSizes[t] + d, 1, MAX_PER_TEAM); break; }
      case "deck": if (window.DECKS[v]) S.decks = S.decks.includes(v) ? S.decks.filter((x) => x !== v) : S.decks.concat(v); break;
      case "secs": if ([2, 3, 5, 8].includes(n)) S.seconds = n; break;
      case "turns": if ([1, 2, 3, 5].includes(n)) S.turns = n; break;
      case "chances": if ([1, 2, 3].includes(n)) S.chances = n; break;
      case "laps": if ([1, 2].includes(n)) S.laps = n; break;
      case "rounds": if ([10, 20, 30, 50].includes(n)) S.rounds = n; break;
      default: return;
    }
    saveSettings(); render();
  }

  function handleRemote(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") return broadcast();
    if (m.type !== "cmd") return;
    ({ primary, correct: () => judge(true), wrong: () => judge(false), award: () => award(m.arg),
       pause: togglePause, skip, undo,
       set: () => applySetting(m.arg?.k, m.arg?.v),
       restartNow: () => restart(true),
       menuNow: () => { if (S.screen !== "setup" && S.screen !== "loading") toMenu(); },
       mute: () => { S.muted = !S.muted; saveSettings(); render(); },
       // Starting from the phone: the TV can't go fullscreen without a tap on the TV itself, so it starts windowed
       start: () => { if (S.screen === "setup") startGame(); } })[m.cmd]?.();
  }

  const isLocalhost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const remoteUrl = () => `${location.origin}${location.pathname}?remote=${roomCode}`;

  let userTurnedOff = false;
  async function openRemoteDialog() {
    let d = document.getElementById("remote-dlg");
    const fresh = !d;
    if (!d) { d = document.createElement("dialog"); d.id = "remote-dlg"; d.className = "remote-dlg"; document.body.appendChild(d); }
    if (fresh) d.addEventListener("click", (e) => {
      if (e.target === d) return d.close();   // click on the backdrop
      const b = e.target.closest("[data-r]"); if (!b) return;
      const r = b.dataset.r;
      if (r === "close") d.close();
      if (r === "on" || r === "retry") { userTurnedOff = false; roomStatus = "off"; try { peer?.destroy(); } catch {} peer = null; startRoom(); }
      if (r === "off") { userTurnedOff = true; stopRoom(); toast("Phone remote turned off"); }
    });
    if (!d.open) d.showModal();
    // First open turns the phone remote on; after you turn it off, it stays off until you press "Turn on"
    if (roomStatus === "off" && !userTurnedOff) startRoom();
    paintRemoteDialog();
    loadScript(QR_SRC).then(paintRemoteDialog).catch(() => {});
  }
  function paintRemoteDialog() {
    const d = document.getElementById("remote-dlg"); if (!d || !d.open) return;
    const n = phoneConns.size;
    let body = "", actions = "";
    if (roomStatus === "off") {
      body = `<div class="r-qr off">${IC.remote}</div><p class="r-conn">Phone remote is off</p>`;
      actions = `<button class="big go" data-r="on" type="button">Turn on</button>`;
    } else if (roomStatus === "error") {
      body = `<div class="r-qr off">${IC.remote}</div><p class="r-note bad">Couldn't connect. Check the internet and try again.</p>`;
      actions = `<button class="big" data-r="retry" type="button">Try again</button>`;
    } else if (roomStatus !== "ready" || !window.qrcode) {
      body = `<div class="r-qr loading"><div class="spinner"></div></div><p class="r-conn">Turning on…</p>`;
    } else {
      const q = window.qrcode(0, "M"); q.addData(remoteUrl()); q.make();
      body = `<div class="r-qr">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
        <p class="r-note">Scan with your phone camera, or open<br><b>${esc(remoteUrl().replace(/^https?:\/\//, ""))}</b></p>
        ${isLocalhost() ? `<p class="r-note warn">Phones can't open “localhost”. Use the live site or your laptop's Wi-Fi address instead.</p>` : ""}
        <p class="r-conn ${n ? "on" : ""}">${n ? `<i class="live-dot"></i>${n} phone${n > 1 ? "s" : ""} connected` : "Waiting for a phone…"}</p>`;
      actions = `<button class="big neutral" data-r="off" type="button">Turn off</button>`;
    }
    d.innerHTML = `<button class="r-close" data-r="close" type="button" aria-label="Close">${IC.close}</button>
      <h2 class="r-title">Phone remote</h2>${body}${actions ? `<div class="r-actions">${actions}</div>` : ""}`;
  }

  // Menu header remote button:
  //  • off / waiting → opens the Remote dialog (you need the QR code)
  //  • phone connected → green; one click disconnects it (hover says so)
  function remotePill() {
    const phones = phoneConns.size;
    if (phones) return `<button class="ghost remote-btn connected" data-act="remoteOff" type="button" title="Click to disconnect the phone">
        <i class="live-dot"></i><span class="rb-text">Phone connected${phones > 1 ? ` (${phones})` : ""}</span><span class="rb-hover">Disconnect</span></button>`;
    const waiting = roomStatus === "ready" || roomStatus === "starting";
    return `<button class="ghost remote-btn" data-act="host" type="button" title="Control the game from your phone">
        ${waiting ? `<i class="live-dot"></i>Remote on · waiting` : `${IC.remote} Remote`}</button>`;
  }

  function broadcast() {
    if (IS_HOST_VIEW) return;
    const relay = S.mode === "relay";
    const cur = relay && S.scores.length && !["setup", "loading", "final"].includes(S.screen);
    const msg = {
      type: "state",
      screen: S.screen, mode: S.mode,
      answer: S.card && ["show", "result"].includes(S.screen) ? { name: S.card.name, desc: S.card.desc, img: S.card.img } : null,
      upcoming: S.screen === "ready" && S.queue.length ? (() => { const c = S.queue[S.qi % S.queue.length]; return { name: c.name, desc: c.desc, img: c.img }; })() : null,
      team: cur ? { name: teamName(S.team), color: teamColor(S.team) } : null,
      player: cur ? `P${(chainOrder()[S.link] ?? 0) + 1}` : null,
      chance: cur && S.chances > 1 ? `${Math.min(S.misses + 1, S.chances)}/${S.chances}` : null,
      round: !relay && S.screen !== "setup" ? `Face ${Math.max(S.round, 1)}/${S.rounds}` : null,
      teams: S.scores.map((s, t) => ({ name: teamName(t), color: teamColor(t), score: s })),
      paused: S.paused, undone: S.undone, skipping: S.skipping, canUndo: S.undoStack.length > 0, muted: !!S.muted,
      settings: S.screen === "setup" ? {
        mode: S.mode, teamCount: S.teamCount, seconds: S.seconds, turns: S.turns, chances: S.chances, laps: S.laps, rounds: S.rounds,
        teams: Array.from({ length: S.teamCount }, (_, t) => ({ name: teamName(t), color: teamColor(t), size: S.teamSizes[t] })),
        decks: Object.entries(window.DECKS).map(([k, d]) => ({ k, label: d.label, n: d.people.length, on: S.decks.includes(k) })),
      } : null,
      left: S.screen === "show" ? timeLeft() : 0,
    };
    for (const c of phoneConns) if (c.open) { try { c.send(msg); } catch {} }
  }


  // ---------- the remote itself (phone or laptop window) ----------
  function remoteView() {
    document.title = "Face Relay remote";
    document.body.classList.add("hostview");
    let st = null, conn = "connecting", send = () => {}, retryTimer = null, wake = null, turnedOff = false;

    // Only the controls that make sense right now (layout from the Figma "Remote" screens)
    const controls = () => {
      const relay = st.mode === "relay";
      const B = (cmd, label, cls = "", arg) => `<button class="big ${cls}" data-h="${cmd}" ${arg !== undefined ? `data-arg="${arg}"` : ""}>${label}</button>`;
      const G = (cmd, label, cls = "") => `<button class="ghost ${cls}" data-h="${cmd}">${label}</button>`;
      const undo = st.canUndo ? `<div class="r-undo">${G("undo", `${IC.undo} Undo`)}</div>` : "";
      const skipPause = `<div class="r-pair">${G("skip", `${IC.skip} Skip`, "wide")}${G("pause", `${IC.pause} Pause`, "wide")}</div>`;
      switch (st.screen) {
        case "ready": return { main: B("primary", "Next") };
        case "show":
          if (st.skipping) return { main: "" };
          if (st.paused && !st.undone) return { main: B("pause", "Resume") };
          if (!relay) return { main: (st.undone ? "" : skipPause) + `<div class="r-grid">${st.teams.map((t, i) => `<button class="big neutral" data-h="award" data-arg="${i}"><i class="dot" style="--c:${t.color}"></i>${esc(t.name)}</button>`).join("")}${B("award", "Nobody", "neutral", -1)}</div>` };
          // "Next" = they got it. A wrong answer is the timeout (or Undo to re-judge)
          return { main: (st.undone ? "" : skipPause) + B("primary", "Next") };
        case "result": return { main: undo + B("primary", "Next") };
        case "turnEnd": return { main: B("primary", "Next") };
        case "final": return { main: B("primary", "Back to menu") };
        case "setup": return { main: B("start", "Start game", "start") };
        default: return { main: "" };
      }
    };

    // Phone version of the TV menu: one row per setting, options as tabs
    const setupRows = () => {
      const cfg = st.settings; if (!cfg) return "";
      const relay = cfg.mode === "relay";
      const tabs = (k, opts, cur) => `<div class="seg r-tabs">${opts.map(([v, label]) =>
        `<button type="button" class="${String(v) === String(cur) ? "on" : ""}" data-h="set" data-k="${k}" data-v="${v}">${label}</button>`).join("")}</div>`;
      const row = (label, control) => `<div class="r-row"><span class="r-label">${label}</span>${control}</div>`;
      return `<section class="r-setup">
        ${row("Mode", tabs("mode", [["relay", "Relay"], ["shout", "Shout-Out"]], cfg.mode))}
        ${row("Teams", tabs("teamCount", [1, 2, 3, 4, 5, 6].map((n) => [n, n]), cfg.teamCount))}
        ${relay ? cfg.teams.map((t, i) => row(`<i class="dot" style="--c:${t.color}"></i>${esc(t.name)}`,
          `<div class="r-step"><button type="button" data-h="set" data-k="teamSize" data-v="${i}:-1" ${t.size <= 1 ? "disabled" : ""}>−</button><b>${t.size}</b><button type="button" data-h="set" data-k="teamSize" data-v="${i}:1" ${t.size >= 8 ? "disabled" : ""}>+</button></div>`)).join("") : ""}
        <div class="r-row r-col"><span class="r-label">Faces</span><div class="r-decks">${cfg.decks.map((d) =>
          `<button type="button" class="deck ${d.on ? "on" : ""}" data-h="set" data-k="deck" data-v="${d.k}">${esc(d.label)}<small>${d.n}</small></button>`).join("")}</div></div>
        ${row("Time", tabs("secs", [2, 3, 5, 8].map((n) => [n, n + "s"]), cfg.seconds))}
        ${relay ? row("Turns per team", tabs("turns", [1, 2, 3, 5].map((n) => [n, n]), cfg.turns))
          + row("Chances per player", tabs("chances", [1, 2, 3].map((n) => [n, n]), cfg.chances))
          + row("Order", tabs("laps", [[1, "Once"], [2, "Down & back"]], cfg.laps))
          : row("Faces", tabs("rounds", [10, 20, 30, 50].map((n) => [n, n]), cfg.rounds))}
      </section>`;
    };

    // The TV's bottom-row controls, as round icon buttons at the top (fullscreen needs a tap on the TV itself)
    const topIcons = () => !["ready", "show", "result", "turnEnd", "final"].includes(st.screen) ? "" : `<div class="r-top">
        <button class="r-icon" data-h="restartNow" data-confirm="Restart the game?" aria-label="Restart">${IC.restart}</button>
        <button class="r-icon" data-h="mute" aria-label="${st.muted ? "Turn sound on" : "Turn sound off"}">${st.muted ? IC.soundOff : IC.soundOn}</button>
        <button class="r-icon" data-h="menuNow" data-confirm="Quit to menu?" aria-label="Menu">${IC.menu}</button></div>`;

    const paint = () => {
      if (conn !== "on" || !st) {
        const msg = conn === "off" ? "The remote was turned off on the TV."
          : conn === "notfound" ? `No game found for <b>${esc(REMOTE_CODE)}</b>.<br>Open the game on the TV and press Remote.`
          : conn === "lost" ? "Connection lost. Reconnecting…"
          : conn === "error" ? "Couldn't connect. Check the internet."
          : "Connecting to the TV…";
        $app.innerHTML = `<main class="remote center-r"><div class="spinner ${conn === "notfound" || conn === "error" || conn === "off" ? "off" : ""}"></div><p class="r-msg">${msg}</p>
          ${conn === "notfound" || conn === "error" || conn === "off" ? `<button class="big" data-r="retry">${conn === "off" ? "Reconnect" : "Try again"}</button>` : ""}</main>`;
        return;
      }
      const a = st.skipping ? null : st.answer || st.upcoming;
      const who = st.team ? `<i class="dot" style="--c:${st.team.color}"></i>${esc(st.team.name)} · <b>${st.player}</b>${st.chance ? ` · chance ${st.chance}` : ""}` : st.round ? esc(st.round) : "";
      const c = controls();
      $app.innerHTML = `<main class="remote">
        ${topIcons()}
        ${who ? `<p class="r-who">${who}</p>` : ""}
        ${st.screen === "loading" ? `<div class="r-loading"><div class="spinner"></div><p class="r-msg">Loading faces…</p></div>` : ""}
        ${a && st.screen !== "final" ? `<div class="r-card ${st.answer ? "" : "next"}"><img src="${esc(a.img)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />
          <b>${esc(a.name)}</b></div>` : ""}
        ${st.screen === "setup" ? setupRows() : ""}
        ${st.screen === "show" && st.skipping ? `<div class="r-timer r-skip"><p class="r-msg">Skipping</p></div>` : st.screen === "show" ? `<div class="r-timer" id="htimer"></div>` : ""}
        ${st.screen === "final" ? `<p class="r-msg">Game over</p>` : ""}
        <div class="r-main">${c.main}</div>
        ${c.extra ? `<div class="r-extra">${c.extra}</div>` : ""}
      </main>`;
    };

    const onState = (m) => {
      if (m?.type !== "state") return;
      st = m; st.localDeadline = st.screen === "show" && !st.paused ? Date.now() + st.left * 1000 : 0;
      paint();
    };

    async function connectPhone() {
      clearTimeout(retryTimer);
      try { await loadScript(PEERJS_SRC); } catch { conn = "error"; return paint(); }
      const p = new window.Peer({ debug: 0 });
      const retry = (state, ms) => { conn = state; paint(); try { p.destroy(); } catch {} retryTimer = setTimeout(connectPhone, ms); };
      p.on("open", () => {
        const c = p.connect(PEER_PREFIX + REMOTE_CODE, { reliable: true });
        const t = setTimeout(() => { if (!c.open) retry("notfound", 4000); }, 10000);
        c.on("open", () => { clearTimeout(t); conn = "on"; send = (cmd, arg) => c.open && c.send({ type: "cmd", cmd, arg }); c.send({ type: "hello" }); paint(); });
        c.on("data", (m) => { if (m?.type === "off") { turnedOff = true; conn = "off"; clearTimeout(retryTimer); try { p.destroy(); } catch {} return paint(); } onState(m); });
        c.on("close", () => { if (!turnedOff) retry("lost", 1500); });
      });
      p.on("error", (e) => retry(e.type === "peer-unavailable" ? "notfound" : "error", 4000));
    }

    connectPhone();

    document.addEventListener("click", (e) => {
      if (!wake && navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => (wake = w)).catch(() => {});   // keep the phone awake
      if (e.target.closest('[data-r="retry"]')) { turnedOff = false; conn = "connecting"; paint(); return connectPhone(); }
      const b = e.target.closest("[data-h]"); if (!b) return;
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      if (b.dataset.h === "set") return send("set", { k: b.dataset.k, v: b.dataset.v });
      send(b.dataset.h, b.dataset.arg !== undefined ? +b.dataset.arg : undefined);
    });
    document.addEventListener("keydown", (e) => {
      if (!st || e.repeat) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); send("primary"); }
      if (k === "ArrowLeft") send("wrong");
      if (k === "p" || k === "P") send("pause");
      if (k === "s" || k === "S") send("skip");
      if (k === "u" || k === "U") send("undo");
      if (/^[0-9]$/.test(k) && st.mode === "shout") send("award", k === "0" ? -1 : +k - 1);
    });
    const tick = () => {
      const el = document.getElementById("htimer");
      if (el && st) el.textContent = Math.ceil(st.localDeadline ? Math.max(0, (st.localDeadline - Date.now()) / 1000) : st.left || 0);
      requestAnimationFrame(tick);
    };
    tick();
    paint();
  }

  // ---------- boot ----------
  if (IS_HOST_VIEW) {
    remoteView();
  } else {
    render();
    requestAnimationFrame(loop);
  }
})();
