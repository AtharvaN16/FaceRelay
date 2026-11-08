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
  // A custom name (double-click it in the menu) or the colour's default, e.g. "Blue Team"
  const teamName = (t) => (S.teamNames && S.teamNames[t]) || `${teamPal(t).name} Team`;
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
    famousOnly: false,   // only the best-known people in each deck
    negScoring: false,   // a wrong answer costs a point and play carries on
    noRepeats: true,     // faces already shown in earlier games wait until the rest of the decks have been played
    skips: -1,           // skips per turn (relay) / per game (shout); -1 = unlimited
    muted: false,
    tvMode: false,  // higher-contrast look for TVs
  };

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return { ...defaults }; }
  }
  function saveSettings() {
    const { mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, muted, tvMode, famousOnly, negScoring, skips, noRepeats, teamNames } = S;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, muted, tvMode, famousOnly, negScoring, skips, noRepeats, teamNames })); } catch {}
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
    queue: [], qi: 0, card: null,
    loadMsg: "", loadPct: 0, error: "",
    scores: [], clears: [],
    // relay
    team: 0, turnNo: 1, link: 0, run: 0, result: null, cleared: false,
    // shout
    round: 0, awarded: null,
    deadline: 0, secondsLeft: 0, lastTick: -1,
    paused: false, pauseLeft: 0, revealed: false,   // pause / reveal (no phone)
    skipping: false, skipAt: 0,                   // 0.5s break after Skip before the next face
    undoStack: [],
  };
  const GAME_KEY = "face-relay:game:v1";
  // Saved settings from older versions: cricket merged into sports; drop decks that no longer exist
  S.decks = [...new Set((S.decks || []).map((d) => (d === "cricket" ? "sports" : d)))].filter((d) => window.DECKS[d]);
  // Famous only is exclusive with the decks (older saves could have both)
  if (S.famousOnly && S.decks.length) { S.decksBeforeFamous = S.decks; S.decks = []; }
  S.teamCount = clamp(+S.teamCount || 2, 1, MAX_TEAMS);
  if (!Array.isArray(S.teamSizes)) S.teamSizes = [];
  if (!Array.isArray(S.teamColors)) S.teamColors = [];
  S.colorPick = null;   // team whose color picker is open
  syncTeams();
  // − on a team with one player left removes that team (as long as another team remains)
  function changeTeamSize(i, d) {
    if (S.teamSizes[i] == null) return;
    if (d < 0 && S.teamSizes[i] <= 1) {
      if (S.teamCount <= 1) return;
      S.teamSizes.splice(i, 1); S.teamColors.splice(i, 1); S.teamNames.splice(i, 1); S.teamCount--; S.colorPick = null; syncTeams();
      return;
    }
    S.teamSizes[i] = clamp(S.teamSizes[i] + d, 1, MAX_PER_TEAM);
  }
  // Keep one size per team: new teams copy the last team's size
  function syncTeams() {
    const last = S.teamSizes.length ? S.teamSizes[S.teamSizes.length - 1] : 3;
    S.teamSizes = Array.from({ length: S.teamCount }, (_, t) => clamp(+S.teamSizes[t] || last, 1, MAX_PER_TEAM));
    if (!Array.isArray(S.teamNames)) S.teamNames = [];
    S.teamNames = Array.from({ length: S.teamCount }, (_, t) => (typeof S.teamNames[t] === "string" ? S.teamNames[t] : ""));
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
  // "Famous only" is its own pill: the best-known names from every category. It's exclusive with the other decks.
  const famousCount = () => new Set(Object.values(window.DECKS).flatMap((d) => d.famous || [])).size;
  function chooseDeck(k) {
    if (k === "famous") {
      if (S.famousOnly) { S.famousOnly = false; S.decks = S.decksBeforeFamous?.length ? S.decksBeforeFamous : []; }
      else { S.decksBeforeFamous = S.decks.slice(); S.famousOnly = true; S.decks = []; }
      return;
    }
    if (!window.DECKS[k]) return;
    if (S.famousOnly) { S.famousOnly = false; S.decks = [k]; return; }
    S.decks = S.decks.includes(k) ? S.decks.filter((x) => x !== k) : S.decks.concat(k);
  }
  const playerLabel = (i) => `Player ${i + 1}`;

  // Every face shown on this device, across games ("No repeats" deals unseen faces first)
  const SEEN_KEY = "face-relay:seen:v2";
  const seenFaces = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } };
  const saveSeen = (set) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-2000))); } catch {} };
  try { localStorage.removeItem("face-relay:last-game:v1"); } catch {}   // older one-game-back list
  function rememberFace(key) {
    const seen = seenFaces(); if (!seen.has(key)) { seen.add(key); saveSeen(seen); }
  }

  function nextCard() {
    S.card = S.queue[S.qi++];
    if (S.qi >= S.queue.length) { S.queue = shuffle(S.queue); S.qi = 0; }
    rememberFace(S.card.key);
  }

  // ---------- game flow ----------
  async function startGame() {
    enterFullscreen();   // must run before the first await (needs the click/keypress)
    clearGame();
    saveSettings();
    S.screen = "loading"; S.error = ""; S.loadPct = 0; S.loadMsg = "Loading"; render();

    try {
      const titles = new Set();
      if (S.famousOnly) Object.values(window.DECKS).forEach((d) => (d.famous || []).forEach((t) => titles.add(t)));
      else S.decks.forEach((d) => window.DECKS[d]?.people.forEach((t) => titles.add(t)));
      let cards = [];
      if (titles.size) {
        render();
        cards = await fetchPeople([...titles]);
      }
      if (!cards.length) throw new Error("Pick at least one deck.");

      // Fresh random order every game. "No repeats": faces seen in earlier games go to the end (only reached
      // if the deck runs out). Once fewer than a third of these decks are unseen, they all start fresh again,
      // so a game never ends up made only of the leftovers.
      if (S.noRepeats) {
        const seen = seenFaces();
        const unseen = cards.filter((c) => !seen.has(c.key));
        if (unseen.length < Math.max(12, cards.length / 3)) { cards.forEach((c) => seen.delete(c.key)); saveSeen(seen); cards = shuffle(cards); }
        else cards = shuffle(unseen).concat(shuffle(cards.filter((c) => seen.has(c.key))));
      } else cards = shuffle(cards);
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
    S.team = 0; S.turnNo = 1; S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false; newTurn();
    S.round = 0; S.awarded = null; S.undoStack = []; S.paused = false; S.revealed = false;
    S.screen = "ready"; render();
  }

  function go() {
    if (S.mode === "shout") S.round++;
    nextCard();
    S.result = null; S.awarded = null; S.paused = false; S.revealed = false; S.skipping = false;
    S.deadline = performance.now() + S.seconds * 1000;
    S.lastTick = -1;
    S.screen = "show"; sfx.go(); render();
  }

  // Start of a team's turn (relay) or of the game (shout: skips are per game)
  const pointsLabel = (n) => `${n < 0 ? "−" + Math.abs(n) : n} point${Math.abs(n) === 1 ? "" : "s"}`;
  function newTurn(relayOnly = false) {
    if (relayOnly && S.mode !== "relay") return;
    S.turnMisses = 0; S.turnAdj = 0; S.turnSkips = 0; S.marks = []; S.skipsLeft = S.skips < 0 ? Infinity : S.skips;
    // Where this team stood when the turn began, so "Restart chain" can put it back
    S.turnStart = { score: S.scores?.[S.team] ?? 0, clears: S.clears?.[S.team] ?? 0 };
  }
  const timeLeft = () => Math.max(0, S.paused ? S.pauseLeft : (S.deadline - performance.now()) / 1000);

  // ---- Undo: take back the last call and give the same player (or round) a fresh face.
  // The old face's name has been seen, so it is never shown again. No penalty, no skip used.
  function snapshot() {
    S.undoStack = [{
      scores: S.scores.slice(), clears: S.clears.slice(), team: S.team, turnNo: S.turnNo, link: S.link,
      run: S.run, misses: S.misses, round: S.round, turnMisses: S.turnMisses, turnAdj: S.turnAdj || 0, turnSkips: S.turnSkips || 0, marks: (S.marks || []).slice(), skipsLeft: S.skipsLeft,
    }];
  }
  function undo() {
    if (S.screen !== "result" || inputLocked()) return;
    const u = S.undoStack.pop();
    if (!u) return;
    clearTimeout(autoTimer);
    document.getElementById("confetti").innerHTML = "";
    Object.assign(S, { scores: u.scores, clears: u.clears, team: u.team, turnNo: u.turnNo, link: u.link,
      run: u.run, misses: u.misses, round: u.round, turnMisses: u.turnMisses, turnAdj: u.turnAdj || 0, turnSkips: u.turnSkips || 0, marks: u.marks, skipsLeft: u.skipsLeft });
    S.result = null; S.awarded = null; S.cleared = false; S.paused = false; S.revealed = false; S.skipping = false;
    nextCard();
    S.deadline = performance.now() + S.seconds * 1000; S.lastTick = -1;
    S.screen = "show"; sfx.go(); render();
  }

  // ---- Pause: freezes the clock and hides the face (no peeking while paused)
  function togglePause() {
    if (S.screen !== "show" || S.skipping || S.revealed) return;
    if (S.paused) { S.deadline = performance.now() + S.pauseLeft * 1000; S.paused = false; S.revealed = false; }
    else { S.pauseLeft = timeLeft(); S.paused = true; }
    render();
  }

  // ---- Skip: hide the face, give everyone a second to reorient, then deal a new face with full time (no penalty)
  const SKIP_DELAY_MS = 500;
  function skip() {
    if (S.screen !== "show" || (S.paused && !S.revealed) || S.skipping) return;
    if (!(S.skipsLeft > 0)) return toast("No skips left");
    S.skipsLeft--;
    S.paused = false; S.revealed = false;
    S.skipping = true; S.skipAt = performance.now() + SKIP_DELAY_MS;
    render();
  }
  function finishSkip() {
    S.skipping = false;
    // Relay: a skip is a pass. The chain moves to the next player (no point, no penalty, no extra face),
    // and a turn with a skip can't earn the chain bonus.
    if (S.mode === "relay") {
      S.marks[S.link] = "skip"; S.turnSkips = (S.turnSkips || 0) + 1;
      S.result = null; S.misses = 0;
      if (S.link >= chainOrder().length - 1) { S.cleared = false; S.screen = "turnEnd"; return render(); }
      S.link++; return go();
    }
    nextCard();
    S.deadline = performance.now() + S.seconds * 1000; S.lastTick = -1;
    sfx.go(); render();
  }

  // ---- Reveal (no phone connected): nobody holds the answer, so Space shows the name to the whole room,
  // freezes the clock, and the host judges with [ (wrong) or ] (right)
  const solo = () => !phoneConns.size;
  let revealedAt = 0;   // a quick double-tap of Space shouldn't reveal and score in one go
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const WRONG_KEY = IS_MAC ? "⌘" : "Ctrl";
  function reveal() {
    if (S.screen !== "show" || S.skipping || S.revealed || inputLocked()) return;
    S.pauseLeft = timeLeft(); S.paused = true; S.revealed = true; revealedAt = performance.now();
    render();
  }

  function stopClock() { S.secondsLeft = timeLeft(); }

  // Relay judging
  function judge(correct) {
    if (S.mode !== "relay" || inputLocked()) return;
    if (S.screen !== "show" || (S.paused && !S.revealed) || S.skipping) return;
    stopClock(); snapshot(); S.paused = false; S.revealed = false;
    S.result = correct ? "correct" : "wrong";
    if (correct) { S.scores[S.team]++; S.run++; sfx.correct(); }
    else { S.misses++; S.turnMisses++; if (S.negScoring) S.scores[S.team]--; sfx.wrong(); }
    S.screen = "result";
    render();
  }
  let autoTimer = null;
  function timeUp() {
    snapshot();
    if (S.mode === "relay") {
      S.secondsLeft = 0; S.misses++; S.turnMisses++; if (S.negScoring) S.scores[S.team]--; S.result = "timeout"; S.screen = "result"; sfx.wrong(); render();
    } else {
      S.awarded = -1; S.screen = "result"; sfx.wrong(); render();
    }
  }

  function advance() {
    clearTimeout(autoTimer);
    if (S.mode === "shout") {
      if (S.screen !== "result") return;
      if (S.round >= S.rounds) return finish();
      return go();   // straight to the next face (no extra "ready" press)
    }
    if (S.screen === "result") {
      // Same team carries on: deal the next player's face straight away (the chain row shows who's up).
      // The "Player N" ready screen is only used at the start of each team's turn.
      const last = S.link >= chainOrder().length - 1;
      // Negative scoring: a miss costs a point but the chain carries on to the next player
      if (S.negScoring && S.result !== "correct") {
        S.marks[S.link] = "miss";
        if (!last) { S.link++; S.misses = 0; S.result = null; return go(); }
        S.cleared = false; S.screen = "turnEnd"; return render();
      }
      if (S.result === "correct") S.marks[S.link] = "ok";
      if (S.result === "correct" && !last) { S.link++; S.misses = 0; S.result = null; return go(); }
      // Missed, but this player still has chances left: same player, new face
      if (S.result !== "correct" && S.misses < S.chances) { S.result = null; return go(); }
      // Turn over: either the whole chain cleared or someone missed
      S.cleared = S.result === "correct" && !(S.negScoring && S.turnMisses) && !S.turnSkips;
      if (S.cleared) { S.scores[S.team] += CHAIN_BONUS; S.clears[S.team]++; sfx.win(); confetti(); }
      S.screen = "turnEnd"; return render();
    }
    if (S.screen === "turnEnd") {
      S.team++;
      if (S.team >= S.teamCount) { S.team = 0; S.turnNo++; }
      if (S.turnNo > S.turns) return finish();
      S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false; newTurn(S.mode === "relay");
      S.screen = "ready"; return render();
    }
  }

  function finish() { S.screen = "final"; sfx.win(); confetti(); render(); clearGame(); }

  // Shout-out: award a team
  function award(t) {
    if (S.mode !== "shout" || S.screen !== "show" || (S.paused && !S.revealed) || S.skipping || inputLocked()) return;
    stopClock(); snapshot(); S.paused = false; S.revealed = false;
    if (t >= 0 && t < S.teamCount) { S.scores[t]++; S.awarded = t; sfx.correct(); }
    else { S.awarded = -1; sfx.wrong(); }
    S.screen = "result"; render();
  }

  // Shout-Out with negative scoring: a team shouted a wrong name → −1, face stays up for the others
  function penalize(t) {
    if (S.mode !== "shout" || !S.negScoring || S.screen !== "show" || (S.paused && !S.revealed) || S.skipping) return;
    if (!(t >= 0 && t < S.teamCount)) return;
    snapshot(); S.scores[t]--; sfx.wrong(); render();
  }

  function primary() {
    if (S.screen !== "setup" && inputLocked()) return;
    switch (S.screen) {
      case "setup": return startGame();
      case "ready": return go();
      case "show":
        if (S.skipping) return;
        if (S.paused && !S.revealed) return togglePause();   // Space resumes a paused face
        // No phone: Space reveals the name, then Space again = right (Relay); ⌘ / Ctrl = wrong
        if (solo()) { if (!S.revealed) return reveal(); if (S.mode === "relay" && performance.now() - revealedAt > 400) judge(true); return; }
        if (S.mode === "relay") judge(true); else award(-1); return;
      case "result": case "turnEnd": return advance();
      case "final": return toMenu();
    }
  }

  // Restart the current game with the same teams and settings
  // Keyboard shortcuts helper
  const SHORTCUTS = [
    ["During a game", [
      [["Space"], "Next. With no phone: reveal the name, then Space again = right"],
      [[WRONG_KEY], "Wrong answer (after the reveal)"],
      [["]"], "Right answer"],
      [["["], "Wrong answer"],
      [["P"], "Pause / resume"],
      [["S"], "Skip (Relay: pass to the next player; Shout-Out: new face)"],
      [["U"], "Undo the last call: new face, no penalty"],
      [["1", "–", "6"], "Shout-Out: award a team"],
      [["⇧", "1", "–", "6"], "Shout-Out: −1 to a team (negative scoring)"],
      [["0"], "Shout-Out: nobody got it"],
    ]],
    ["Anywhere", [
      [["Enter"], "Start the game (in the menu)"],
      [["R"], "Restart the game"],
      [["M"], "Sound on / off"],
      [["F"], "Fullscreen on / off"],
      [["T"], "TV mode on / off"],
      [["Esc"], "Back to the menu"],
      [["?"], "Show these shortcuts"],
    ]],
  ];
  function openShortcuts() {
    document.querySelector("dialog.keys-dlg")?.remove();
    const d = document.createElement("dialog");
    d.className = "remote-dlg keys-dlg";
    d.innerHTML = `<button class="r-close" type="button" aria-label="Close">${IC.close}</button>
      <h2 class="r-title">Keyboard shortcuts</h2>
      ${SHORTCUTS.map(([group, rows]) => `<section class="sc-group"><h3>${group}</h3>
        ${rows.map(([keys, label]) => `<div class="sc-row"><span class="sc-keys">${keys.map((k) => (k === "–" ? `<i>–</i>` : `<kbd>${k}</kbd>`)).join("")}</span><span>${label}</span></div>`).join("")}</section>`).join("")}`;
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest(".r-close")) d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.appendChild(d); d.showModal();
  }

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

  // A modal with several choices (stacked); resolves with the chosen value, or null on Cancel / Esc
  function choose(message, options) {
    document.querySelector("dialog.confirm")?.remove();
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.className = "confirm choose";
      d.innerHTML = `<button class="r-close" type="button" aria-label="Close">${IC.close}</button>
        <p>${esc(message)}</p><form method="dialog" class="confirm-actions stack">
        ${options.map((o, i) => `<button class="big ${o.cls || "neutral"}" value="${o.value}" ${i === 0 ? "autofocus" : ""}>${esc(o.label)}</button>`).join("")}</form>`;
      d.addEventListener("click", (e) => { if (e.target === d || e.target.closest(".r-close")) d.close(""); });
      d.addEventListener("close", () => { resolve(d.returnValue || null); d.remove(); });
      document.body.appendChild(d);
      d.showModal();
    });
  }

  // Restart button / R: in Relay (mid-game) choose between the current team's chain and the whole game
  async function restartMenu() {
    if (!["ready", "show", "result", "turnEnd", "final"].includes(S.screen)) return;
    if (S.mode !== "relay" || S.screen === "final") return restart();
    const wasRunning = S.screen === "show" && !S.paused && !S.skipping;
    if (wasRunning) togglePause();   // freeze the clock (and hide the face) while the modal is open
    const pick = await choose("Restart", [
      { value: "chain", label: `Restart ${teamName(S.team)}'s chain` },
      { value: "game", label: "Restart the game", cls: "go" },
    ]);
    if (pick === "chain") return restartChain();
    if (pick === "game") return restart(true);
    if (wasRunning && S.screen === "show" && S.paused) togglePause();
  }

  // Start the current team's turn over: their chain goes back to P1 and this turn's points are taken back
  function restartChain() {
    if (S.mode !== "relay" || !["ready", "show", "result", "turnEnd"].includes(S.screen)) return;
    clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = "";
    const t = S.turnStart;
    if (t) { S.scores[S.team] = t.score; S.clears[S.team] = t.clears; }
    else {   // older save without turnStart: take back what this turn added
      S.scores[S.team] -= S.run - (S.negScoring ? S.turnMisses || 0 : 0) + (S.turnAdj || 0) + (S.cleared ? CHAIN_BONUS : 0);
      if (S.cleared) S.clears[S.team]--;
    }
    S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false; newTurn();
    S.undoStack = []; S.paused = false; S.revealed = false; S.skipping = false; S.screen = "ready";
    toast(`${teamName(S.team)}'s chain restarted`); render();
  }

  async function restart(confirmed = false) {
    if (!["ready", "show", "result", "turnEnd", "final"].includes(S.screen)) return;
    if (!confirmed && !(await ask("Restart the game?", "Restart"))) return;
    clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = "";
    S.scores = Array(S.teamCount).fill(0); S.clears = Array(S.teamCount).fill(0);
    S.team = 0; S.turnNo = 1; S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false; newTurn();
    S.round = 0; S.awarded = null; S.undoStack = []; S.paused = false; S.revealed = false; S.skipping = false; S.screen = "ready"; render();
  }

  function toMenu() { S.skipping = false; clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = ""; clearGame(); S.screen = "setup"; render(); }

  // ---------- save / resume (localStorage on this device) ----------
  const GAME_FIELDS = ["mode", "teamCount", "teamSizes", "teamColors", "seconds", "laps", "turns", "chances", "rounds",
    "scores", "clears", "team", "turnNo", "link", "run", "misses", "result", "cleared", "round", "awarded", "screen", "card", "qi",
    "negScoring", "skips", "turnMisses", "marks", "skipsLeft", "turnStart", "teamNames", "turnAdj", "turnSkips"];
  function saveGame() {
    if (!["ready", "show", "result", "turnEnd"].includes(S.screen)) return;
    const g = { savedAt: Date.now() };
    GAME_FIELDS.forEach((k) => (g[k] = S[k]));
    if (g.screen === "show") g.screen = "ready";   // a face that was on screen is re-dealt on resume
    g.queue = S.queue;
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
    S.undoStack = []; S.paused = false; S.revealed = false; S.skipping = false;
    if (S.skipsLeft == null) S.skipsLeft = S.skips < 0 ? Infinity : S.skips;   // Infinity is saved as null
    S.marks = S.marks || []; S.turnMisses = S.turnMisses || 0;
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
  let confettiTimer;
  function confetti() {
    const box = document.getElementById("confetti");
    box.innerHTML = "";
    clearTimeout(confettiTimer);   // an earlier burst's cleanup must not cut this one short
    for (let i = 0; i < 120; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = TEAMS[i % TEAMS.length].color;
      c.style.animationDelay = Math.random() * 1.2 + "s";
      c.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      c.style.setProperty("--r", (Math.random() * 720 - 360) + "deg");
      box.appendChild(c);
    }
    confettiTimer = setTimeout(() => (box.innerHTML = ""), 5000);
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
    keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>'),
    collapse: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
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
    else document.getElementById("remote-dlg")?.open && document.getElementById("remote-dlg").close();   // game started: dismiss the QR dialog
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
    const famousChip = `<button class="deck ${S.famousOnly ? "on" : ""}" data-deck="famous" type="button"><span>Famous only</span><small>${famousCount()}</small></button>`;
    const deckChips = famousChip + Object.entries(window.DECKS).map(([k, d]) => `
      <button class="deck ${S.decks.includes(k) ? "on" : ""}" data-deck="${k}" type="button">
        <span>${esc(d.label)}</span><small>${d.people.length}</small>
      </button>`).join("");
    const teamPreview = Array.from({ length: S.teamCount }, (_, t) => `
      <div class="tprev" style="--c:${teamColor(t)}">
        <div class="thead"><button type="button" class="swatch" data-colorpick="${t}" aria-label="Change ${teamName(t)} color" aria-expanded="${S.colorPick === t}"></button>${S.editTeam === t
          ? `<input class="tname-input" id="tname-input" data-t="${t}" maxlength="20" value="${esc(teamName(t))}" placeholder="${teamPal(t).name} Team" aria-label="Team name" spellcheck="false" />`
          : `<b class="tname" data-tname="${t}" title="Double-click to rename">${teamName(t)}</b>`}</div>
        ${S.colorPick === t ? `<div class="swatches" role="listbox" aria-label="Team color">${TEAMS.map((c, i) => {
          const owner = S.teamColors.indexOf(i);
          return `<button type="button" class="sw ${i === S.teamColors[t] ? "on" : ""} ${owner >= 0 && owner !== t ? "taken" : ""}" data-setcolor="${t}:${i}" style="--c:${c.color}" title="${c.name}${owner >= 0 && owner !== t ? " (swap with " + teamName(owner) + ")" : ""}" aria-label="${c.name}"></button>`;
        }).join("")}</div>` : ""}
        ${relay ? `<div class="psize"><button type="button" data-tsize="${t}" data-d="-1" ${S.teamSizes[t] <= 1 && S.teamCount <= 1 ? "disabled" : ""} aria-label="${S.teamSizes[t] <= 1 ? `Remove ${teamName(t)}` : `Remove a player from ${teamName(t)}`}">−</button>
          <span class="pdots">${Array.from({ length: S.teamSizes[t] }, (_, p) => `<i>${p + 1}</i>`).join("")}</span>
          <button type="button" data-tsize="${t}" data-d="1" ${S.teamSizes[t] >= MAX_PER_TEAM ? "disabled" : ""} aria-label="Add a player to ${teamName(t)}">+</button></div>` : ""}</div>`).join("");
    const segs = (name, vals, cur, fmt = (v) => v) => `<div class="seg">${vals.map((v) => `<button type="button" data-${name}="${v}" class="${v === cur ? "on" : ""}">${fmt(v)}</button>`).join("")}</div>`;

    return `
    <main class="setup">
      <header class="brand">
        <div class="logo"><span class="logo-mark" aria-hidden="true"><i></i><i></i></span><h1>Face Relay</h1></div>
        <div class="top-actions">
          ${remotePill()}
          <button class="ghost" data-act="keys" type="button" title="Keyboard shortcuts (?)">${IC.keyboard} Shortcuts</button>
          <button class="ghost ${S.tvMode ? "active" : ""}" data-act="tv" type="button" aria-pressed="${!!S.tvMode}" title="Higher contrast for TVs (T)">${IC.tv} TV mode</button>
          <button class="ghost ${document.fullscreenElement ? "fs-on" : ""}" data-act="fs" type="button">${document.fullscreenElement ? `${IC.collapse} Exit fullscreen` : `${IC.expand} Fullscreen`}</button>
        </div>
      </header>
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ""}
      ${(() => { const g = loadGame(); if (!g) return "";
        const names = g.scores.map((sc, t) => { const pal = TEAMS[g.teamColors?.[t] ?? t] || TEAMS[t]; return `<span class="rs"><i class="dot" style="--c:${pal.color}"></i>${g.teamNames?.[t] || pal.name} ${sc}</span>`; }).join("");
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
          <h2>Personalities</h2>
          <div class="decks">${deckChips}</div>
          <div class="row">
            <div><h3>Time</h3>${segs("secs", [2, 3, 5, 8], S.seconds, (v) => v + "s")}</div>
            ${relay
              ? `<div><h3>Turns per team</h3>${segs("turns", [1, 2, 3, 5], S.turns)}</div>
                 ${S.negScoring ? "" : `<div><h3>Chances per player</h3>${segs("chances", [1, 2, 3], S.chances)}</div>`}
                 <div><h3>Order</h3>${segs("laps", [1, 2], S.laps, (v) => (v === 1 ? "Once" : "Down & back"))}</div>`
              : `<div><h3>Rounds</h3>${segs("rounds", [10, 20, 30, 50], S.rounds)}</div>`}
            <div><h3>${relay ? "Skips per turn" : "Skips"}</h3>${segs("skips", [0, 1, 2, -1], S.skips, (v) => (v < 0 ? "Unlimited" : v))}</div>
            <div class="toggles">
              <label class="tg"><button type="button" class="switch ${S.negScoring ? "on" : ""}" role="switch" aria-checked="${S.negScoring}" data-act="neg" title="A wrong answer costs a point and play carries on"><i></i></button>Negative scoring</label>
              <label class="tg"><button type="button" class="switch ${S.noRepeats ? "on" : ""}" role="switch" aria-checked="${!!S.noRepeats}" data-act="repeat" title="Faces from earlier games don't come up again until the rest of the decks have been played"><i></i></button>No repeats</label>
            </div>
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
      const negMiss = S.negScoring && i === S.link && S.result && S.result !== "correct";
      const state = i < S.link ? (S.marks?.[i] === "miss" ? "fail" : S.marks?.[i] === "skip" ? "skipped" : "done")
        : i === S.link && S.result === "correct" ? "done"
        : i === S.link ? ((out || negMiss) && S.screen !== "ready" ? "fail" : "now") : "";
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

  // Final standings: ranks share a number on a tie
  function standings() {
    const ranked = S.scores.map((s, t) => ({ t, s, c: S.clears[t] })).sort((a, b) => b.s - a.s);
    ranked.forEach((r) => { r.rank = ranked.findIndex((x) => x.s === r.s) + 1; });
    return ranked;
  }
  const chainsLabel = (r) => (S.mode === "relay" && r.c ? `${r.c} chain${r.c > 1 ? "s" : ""}` : "");

  // Top 3 on rings (2nd · 1st · 3rd), a slowly turning glow behind the winner, medals by rank
  function podiumTop(top, hasRest = false) {
    const slot = (r) => {
      if (!r) return "";
      const medal = r.rank === 1 ? "gold" : r.rank === 2 ? "silver" : "bronze";
      const meta = [pointsLabel(r.s), chainsLabel(r)].filter(Boolean).join(" · ");
      const first = r === top[0];
      return `<div class="pod ${medal} ${first ? "first" : ""}" style="--c:${teamColor(r.t)}">
        <div class="pod-ring"><span class="pod-score">${r.s}</span>
          ${first ? `<i class="spark s1" aria-hidden="true"></i><i class="spark s2" aria-hidden="true"></i>` : ""}
          <span class="medal">${r.rank}</span></div>
        <div class="pod-label"><b class="pod-name"><i class="dot"></i>${teamName(r.t)}</b><small class="pod-meta">${meta}</small></div></div>`;
    };
    // The glow sits behind every ring (first child, lowest layer), centred on the winner
    return `<div class="pod3 n${top.length} ${hasRest ? "has-rest" : ""}"><div class="pod-glow" aria-hidden="true"><i class="rays"></i><i class="halo"></i></div>
      ${slot(top[1])}${slot(top[0])}${slot(top[2])}</div>`;
  }

  // Everyone else (4th place down), as a list
  function podium(list) {
    return `<ol class="podium">${list.map((r) => `<li class="${r.rank === 1 && r.s > 0 ? "top" : ""}" style="--c:${teamColor(r.t)}">
        <span class="rank">${r.rank}</span>
        <span class="team"><i class="dot"></i>${teamName(r.t)}</span>
        <span class="meta">${chainsLabel(r)}</span>
        <span class="pts">${r.s}</span></li>`).join("")}</ol>`;
  }


  function viewGame() {
    const relay = S.mode === "relay";
    const tc = teamColor(S.team);
    let top = relay ? chain() : "";
    const progress = relay ? `Turn <b>${Math.min(S.turnNo, S.turns)}</b>/${S.turns}` : `Round <b>${Math.max(S.round, 1)}</b>/${S.rounds}`;
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
        const state = S.skipping ? "paused skipping" : S.revealed ? "" : S.paused ? "paused" : "";
        stage = `<div class="showwrap ${state} ${S.revealed ? "revealed" : ""}">${photo(S.revealed, "live")}
            ${S.skipping ? `<div class="state-chip" id="skipchip">Skipping</div>` : S.paused && !S.revealed ? `<div class="state-chip">Paused</div>` : ""}</div>
          <div class="timer"><div class="track"><div id="timebar" style="transform:scaleX(${frac})" data-hot="${frac < 0.34 ? 1 : ""}"></div></div><div id="timenum">${Math.ceil(left)}</div></div>`;
        const teamKeys = `${keyHint(`1–${S.teamCount}`, "award")} ${keyHint("0", "nobody")}${S.negScoring ? ` ${keyHint(`⇧1–${S.teamCount}`, "−1")}` : ""}`;
        // No phone: Space reveals the name, then the host judges. With a phone, the phone holds the answer.
        keys = S.skipping || (S.paused && !S.revealed) ? ""
          : solo() && !S.revealed ? ""
          : !relay ? teamKeys
          : "";   // relay without a phone: [ wrong / ] right sit with Skip on the right
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
          <h2 class="who">${S.cleared ? "Chain cleared" : pointsLabel(S.run - (S.negScoring ? S.turnMisses : 0) + (S.turnAdj || 0))}</h2>
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
        const all = standings();
        // Podium for 1 team or 3+ with a single winner. 2 teams (lopsided), a tie for 1st, or nobody scoring: the table
        const usePod = ranked[0].s > 0 && S.teamCount !== 2 && leaders.length === 1;
        const board = usePod ? podiumTop(all.slice(0, 3), all.length > 3) + (all.length > 3 ? podium(all.slice(3)) : "") : podium(all);
        stage = `<div class="end win ${usePod ? "has-pod" : ""}"><h2>${headline}</h2>
          ${board}
          <button class="big go" data-act="primary" type="button">Menu</button></div>`;
        break;
      }
    }

    return `<main class="game ${relay ? "relay" : "shout"} s-${S.screen}">
      ${top}
      <section class="stage">${stage}</section>
      ${bottom}
      <footer class="keys">${S.screen !== "final" ? `${scoreboard()}<span class="prog">${progress}</span>` : ""}${keys ? `<span class="hints">${keys}</span>` : ""}<span class="spacer"></span>${phoneConns.size ? `<span class="kh live">${IC.remote} Phone connected</span>` : ""}
        ${S.screen === "show" && !S.revealed && !S.skipping ? `<button class="txt-btn" data-act="pause" type="button" title="Pause (P)"><kbd>P</kbd>${S.paused ? "Resume" : "Pause"}</button>` : ""}
        ${S.screen === "show" && relay && S.revealed && solo() ? `<button class="txt-btn" data-act="wrong" type="button" title="Wrong (${WRONG_KEY})"><kbd>${WRONG_KEY}</kbd>Wrong</button><button class="txt-btn" data-act="right" type="button" title="Right (Space)"><kbd>Space</kbd>Right</button>` : ""}
        ${S.screen === "show" && !(S.paused && !S.revealed) && !S.skipping && S.skipsLeft > 0 ? `<button class="txt-btn" data-act="skip" type="button" title="Skip face (S)"><kbd>S</kbd>Skip${Number.isFinite(S.skipsLeft) ? ` · ${S.skipsLeft}` : ""}</button>` : ""}
        ${S.undoStack.length && S.screen === "result" ? `<button class="txt-btn" data-act="undo" type="button" title="Undo last call (U)"><kbd>U</kbd>Undo</button>` : ""}
        ${(() => {   // Space: "Next" between screens, "Confirm" while a face is up (reveal with no phone / right answer)
          const lbl = ["ready", "result", "turnEnd"].includes(S.screen) ? "Next"
            : S.screen === "show" && !S.skipping && !S.paused && (relay || solo()) ? "Confirm" : "";
          return lbl ? `<button class="txt-btn" data-act="primary" type="button" title="${lbl} (Space)"><kbd>Space</kbd>${lbl}</button>` : "";
        })()}
        <button class="ghost sm icon" data-act="restart" type="button" title="Restart (R)" aria-label="Restart">${IC.restart}</button>
        <button class="ghost sm icon" data-act="mute" type="button" title="Sound (M)" aria-label="${S.muted ? "Unmute" : "Mute"}">${S.muted ? IC.soundOff : IC.soundOn}</button>
        <button class="ghost sm icon ${document.fullscreenElement ? "fs-on" : ""}" data-act="fs" type="button" title="${document.fullscreenElement ? "Exit fullscreen (F)" : "Fullscreen (F)"}" aria-label="${document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"}">${document.fullscreenElement ? IC.collapse : IC.expand}</button>
        <button class="ghost sm" data-act="menu" type="button" title="Menu (Esc)">${IC.menu} Menu</button></footer>
    </main>`;
  }

  // ---------- setup bindings ----------
  function bindSetup() {
    // Rename a team: double-click its name, Enter / click away saves, Esc cancels, empty = default colour name
    document.querySelectorAll("[data-tname]").forEach((el) => el.addEventListener("dblclick", () => { S.editTeam = +el.dataset.tname; S.colorPick = null; render(); }));
    const ti = document.getElementById("tname-input");
    if (ti) {
      ti.focus(); ti.select();
      let done = false;
      const finish = (save) => {
        if (done) return; done = true;
        const t = +ti.dataset.t;
        if (save) {
          const v = ti.value.replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim();
          S.teamNames[t] = v && v !== `${teamPal(t).name} Team` ? v : "";
          saveSettings();
        }
        S.editTeam = null; render();
      };
      ti.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
      ti.addEventListener("blur", () => finish(true));
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    if (IS_HOST_VIEW) return;
    if (S.colorPick !== null && !e.target.closest(".swatches, [data-colorpick]")) { S.colorPick = null; render(); }
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.deck) { chooseDeck(d.deck); saveSettings(); return render(); }
    if (d.mode) { S.mode = d.mode; if (S.mode === "shout" && S.seconds < 5) S.seconds = 5; if (S.mode === "relay" && S.seconds > 3) S.seconds = 3; saveSettings(); return render(); }
    if (d.step) {
      S.teamCount = clamp(S.teamCount + +d.d, 1, MAX_TEAMS); syncTeams(); saveSettings(); return render();
    }
    if (d.colorpick !== undefined) { const t = +d.colorpick; S.colorPick = S.colorPick === t ? null : t; return render(); }
    if (d.setcolor) { const [t, c] = d.setcolor.split(":").map(Number); setTeamColor(t, c); S.colorPick = null; saveSettings(); return render(); }
    if (d.tsize !== undefined) {
      changeTeamSize(+d.tsize, +d.d); saveSettings(); return render();
    }
    if (d.secs) { S.seconds = +d.secs; saveSettings(); return render(); }
    if (d.laps) { S.laps = +d.laps; saveSettings(); return render(); }
    if (d.turns) { S.turns = +d.turns; saveSettings(); return render(); }
    if (d.skips) { S.skips = +d.skips; saveSettings(); return render(); }
    if (d.chances) { S.chances = +d.chances; saveSettings(); return render(); }
    if (d.rounds) { S.rounds = +d.rounds; saveSettings(); return render(); }
    if (d.award !== undefined) return award(+d.award);
    switch (d.act) {
      case "start": return startGame();
      case "primary": return primary();
      case "fs": return toggleFs();
      case "tv": S.tvMode = !S.tvMode; saveSettings(); return render();
      case "keys": return openShortcuts();
      case "neg": S.negScoring = !S.negScoring; saveSettings(); return render();
      case "repeat": S.noRepeats = !S.noRepeats; saveSettings(); return render();
      case "restart": return restartMenu();
      case "pause": return togglePause();
      case "skip": return skip();
      case "wrong": return judge(false);
      case "right": return judge(true);
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

  let modArmed = false;
  document.addEventListener("keydown", (e) => {
    if (IS_HOST_VIEW) return;
    modArmed = (e.key === "Meta" || e.key === "Control") && !e.repeat;
    if (e.metaKey || e.ctrlKey || e.altKey) return;   // ⌘R, Ctrl+R etc. belong to the browser
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector("dialog[open]");
    if (typing) return;
    const k = e.key;
    if (e.repeat) { if (k === " ") e.preventDefault(); return; }
    if (k === "?") { e.preventDefault(); return openShortcuts(); }
    if (k === "Escape" && S.colorPick !== null) { S.colorPick = null; return render(); }
    if (k === " " || k === "Spacebar") { e.preventDefault(); return primary(); }
    if (k === "Enter" && S.screen === "setup") { e.preventDefault(); return startGame(); }
    if (k === "ArrowLeft" || k === "Backspace" || k === "x" || k === "X" || k === "[") { e.preventDefault(); return judge(false); }
    if (k === "]") { e.preventDefault(); return judge(true); }
    if ((k === "r" || k === "R") && S.screen !== "setup" && S.screen !== "loading") return restartMenu();
    if (e.shiftKey && /^Digit[1-9]$/.test(e.code) && S.mode === "shout") return penalize(+e.code.slice(5) - 1);
    if (/^[0-9]$/.test(k) && S.mode === "shout") return award(k === "0" ? -1 : +k - 1);
    if (k === "f" || k === "F") return toggleFs();
    if (k === "p" || k === "P") return togglePause();
    if (k === "s" || k === "S") return skip();
    if (k === "u" || k === "U") return undo();
    if (k === "m" || k === "M") { S.muted = !S.muted; saveSettings(); return render(); }
    if (k === "t" || k === "T") { S.tvMode = !S.tvMode; saveSettings(); return render(); }
    if (k === "Escape" && S.screen !== "setup" && S.screen !== "loading") { e.preventDefault(); ask("Quit to menu?", "Quit").then((ok) => ok && toMenu()); }
  });

  document.addEventListener("keyup", (e) => {
    if (IS_HOST_VIEW || !modArmed || !(e.key === "Meta" || e.key === "Control")) return;
    modArmed = false;
    if (document.querySelector("dialog[open]")) return;
    if (S.mode === "relay" && S.revealed && S.screen === "show") judge(false);
  });
  window.addEventListener("blur", () => { modArmed = false; });

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
      conn.on("open", () => {
        // One phone at a time: the newest one takes over and any other phone is told it was replaced
        const old = [...phoneConns]; phoneConns.clear();
        old.forEach((c) => { try { c.send({ type: "replaced" }); } catch {} setTimeout(() => { try { c.close(); } catch {} }, 300); });
        phoneConns.add(conn); broadcast(); render(); paintRemoteDialog();
      });
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
      case "teamSize": { const [t, d] = String(v).split(":").map(Number); changeTeamSize(t, d); break; }
      case "deck": chooseDeck(v); break;
      case "secs": if ([2, 3, 5, 8].includes(n)) S.seconds = n; break;
      case "neg": S.negScoring = v === "on"; break;
      case "repeat": S.noRepeats = v === "on"; break;
      case "skips": if ([0, 1, 2, -1].includes(n)) S.skips = n; break;
      case "turns": if ([1, 2, 3, 5].includes(n)) S.turns = n; break;
      case "chances": if ([1, 2, 3].includes(n)) S.chances = n; break;
      case "laps": if ([1, 2].includes(n)) S.laps = n; break;
      case "rounds": if ([10, 20, 30, 50].includes(n)) S.rounds = n; break;
      default: return;
    }
    saveSettings(); render();
  }

  // Host fixes a mistake by hand: +1 / −1 to a team, on the result screen (from the phone)
  function adjustScore(t, d) {
    if (S.screen !== "result" || !(t >= 0 && t < S.teamCount) || (d !== 1 && d !== -1)) return;
    S.scores[t] += d;
    if (S.mode === "relay" && t === S.team) S.turnAdj = (S.turnAdj || 0) + d;   // counts toward this turn's points
    render();
  }

  function handleRemote(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") return broadcast();
    if (m.type !== "cmd") return;
    ({ primary, correct: () => judge(true), wrong: () => judge(false), award: () => award(m.arg),
       pause: togglePause, skip, undo, penalize: () => penalize(m.arg), adjust: () => adjustScore(m.arg?.t, m.arg?.d),
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
      if (r === "off") { userTurnedOff = true; stopRoom(); d.close(); toast("Phone remote turned off"); }
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
      team: cur ? { name: teamName(S.team), color: teamColor(S.team) } : null, teamIdx: S.team, awarded: S.awarded,
      player: cur ? `P${(chainOrder()[S.link] ?? 0) + 1}` : null,
      chance: cur && S.chances > 1 ? `${Math.min(S.misses + 1, S.chances)}/${S.chances}` : null,
      round: !relay && S.screen !== "setup" ? `Round ${Math.max(S.round, 1)}/${S.rounds}` : null,
      teams: S.scores.map((s, t) => ({ name: teamName(t), color: teamColor(t), score: s })),
      turnEnd: S.screen === "turnEnd" ? (() => {
        const nt = (S.team + 1) % S.teamCount, last = S.team === S.teamCount - 1 && S.turnNo >= S.turns;
        return { headline: S.cleared ? "Chain cleared" : pointsLabel(S.run - (S.negScoring ? S.turnMisses : 0) + (S.turnAdj || 0)), color: teamColor(S.team),
          next: !last && S.teamCount > 1 ? { name: teamName(nt), color: teamColor(nt) } : null, last };
      })() : null,
      final: S.screen === "final" ? (() => {
        const ranked = S.scores.map((sc, t) => ({ name: teamName(t), color: teamColor(t), score: sc })).sort((a, b) => b.score - a.score);
        const top = ranked.filter((r) => r.score === ranked[0].score);
        return { headline: S.teamCount === 1 ? `${ranked[0].score} points` : ranked[0].score === 0 ? "Nobody scored" : top.length > 1 ? "Tie" : `${ranked[0].name} wins`,
          color: top.length === 1 && S.teamCount > 1 && ranked[0].score > 0 ? ranked[0].color : null, ranked };
      })() : null,
      skipsLeft: Number.isFinite(S.skipsLeft) ? S.skipsLeft : null, neg: !!S.negScoring,
      paused: S.paused, revealed: S.revealed, skipping: S.skipping, canUndo: S.undoStack.length > 0, muted: !!S.muted,
      settings: S.screen === "setup" ? {
        mode: S.mode, teamCount: S.teamCount, seconds: S.seconds, turns: S.turns, chances: S.chances, laps: S.laps, rounds: S.rounds,
        teams: Array.from({ length: S.teamCount }, (_, t) => ({ name: teamName(t), color: teamColor(t), size: S.teamSizes[t] })),
        decks: [{ k: "famous", label: "Famous only", n: famousCount(), on: !!S.famousOnly }]
          .concat(Object.entries(window.DECKS).map(([k, d]) => ({ k, label: d.label, n: d.people.length, on: !S.famousOnly && S.decks.includes(k) }))),
        famous: S.famousOnly ? "famous" : "all", neg: !!S.negScoring, repeat: !!S.noRepeats, skips: S.skips,
      } : null,
      left: S.screen === "show" ? timeLeft() : 0,
    };
    for (const c of phoneConns) if (c.open) { try { c.send(msg); } catch {} }
  }


  // ---------- the remote itself (phone or laptop window) ----------
  function remoteView() {
    document.title = "Face Relay remote";
    document.body.classList.add("hostview");
    let st = null, conn = "connecting", send = () => {}, retryTimer = null, wake = null, turnedOff = false

    // Only the controls that make sense right now (layout from the Figma "Remote" screens)
    const controls = () => {
      const relay = st.mode === "relay";
      const B = (cmd, label, cls = "", arg) => `<button class="big ${cls}" data-h="${cmd}" ${arg !== undefined ? `data-arg="${arg}"` : ""}>${label}</button>`;
      const G = (cmd, label, cls = "") => `<button class="ghost ${cls}" data-h="${cmd}">${label}</button>`;
      // Result screen: −1  Undo  +1 for the team that just played (Shout-Out: the team that got the point)
      const fixT = relay ? st.teamIdx : st.awarded;
      const fix = st.teams[fixT];
      const resultTools = fix ? `<div class="r-fix">
          <button class="ghost r-fix-btn" data-h="adjust" data-t="${fixT}" data-d="-1" aria-label="${esc(fix.name)} minus one point">−1</button>
          ${st.canUndo ? G("undo", `${IC.undo} Undo`, "wide") : `<span class="r-fix-score"><i class="dot" style="--c:${fix.color}"></i>${fix.score}</span>`}
          <button class="ghost r-fix-btn plus" data-h="adjust" data-t="${fixT}" data-d="1" aria-label="${esc(fix.name)} plus one point">+1</button></div>`
        : st.canUndo ? `<div class="r-undo">${G("undo", `${IC.undo} Undo`)}</div>` : "";
      const canSkip = st.skipsLeft === null || st.skipsLeft > 0;
      const skipPause = `<div class="r-pair ${canSkip ? "" : "one"}">${canSkip ? G("skip", `${IC.skip} Skip${st.skipsLeft !== null ? ` · ${st.skipsLeft}` : ""}`, "wide") : ""}${G("pause", `${IC.pause} Pause`, "wide")}</div>`;
      switch (st.screen) {
        case "ready": return { main: B("primary", "Next") };
        case "show":
          if (st.skipping) return { main: "" };
          if (st.paused && !st.revealed) return { main: B("pause", "Resume") };
          if (!relay) return { main: skipPause + (st.neg
              ? `<div class="r-teams">${st.teams.map((t, i) => `<div class="r-team"><button class="big neutral" data-h="award" data-arg="${i}"><i class="dot" style="--c:${t.color}"></i>${esc(t.name)}</button><button class="ghost r-minus" data-h="penalize" data-arg="${i}" aria-label="${esc(t.name)} minus one">−1</button></div>`).join("")}${B("award", "Nobody", "neutral", -1)}</div>`
              : `<div class="r-grid">${st.teams.map((t, i) => `<button class="big neutral" data-h="award" data-arg="${i}"><i class="dot" style="--c:${t.color}"></i>${esc(t.name)}</button>`).join("")}${B("award", "Nobody", "neutral", -1)}</div>`) };
          // "Next" moves the game on (during a face it scores the answer). A wrong answer is ← / the timeout, or Undo to re-judge
          return { main: skipPause + B("primary", "Next") };
        case "result": return { main: resultTools + B("primary", "Next") };
        case "turnEnd": return { main: B("primary", st.turnEnd?.last ? "See results" : "Next team") };
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
          `<div class="r-step"><button type="button" data-h="set" data-k="teamSize" data-v="${i}:-1" ${t.size <= 1 && cfg.teams.length <= 1 ? "disabled" : ""}>−</button><b>${t.size}</b><button type="button" data-h="set" data-k="teamSize" data-v="${i}:1" ${t.size >= 8 ? "disabled" : ""}>+</button></div>`)).join("") : ""}
        <div class="r-row r-col"><span class="r-label">Personalities</span><div class="r-decks">${cfg.decks.map((d) =>
          `<button type="button" class="deck ${d.on ? "on" : ""}" data-h="set" data-k="deck" data-v="${d.k}">${esc(d.label)}<small>${d.n}</small></button>`).join("")}</div></div>
        ${row("Time", tabs("secs", [2, 3, 5, 8].map((n) => [n, n + "s"]), cfg.seconds))}
        ${relay ? row("Turns per team", tabs("turns", [1, 2, 3, 5].map((n) => [n, n]), cfg.turns))
          + (cfg.neg ? "" : row("Chances per player", tabs("chances", [1, 2, 3].map((n) => [n, n]), cfg.chances)))
          + row("Order", tabs("laps", [[1, "Once"], [2, "Down & back"]], cfg.laps))
          : row("Rounds", tabs("rounds", [10, 20, 30, 50].map((n) => [n, n]), cfg.rounds))}
        ${row(relay ? "Skips per turn" : "Skips", tabs("skips", [[0, 0], [1, 1], [2, 2], [-1, "∞"]], cfg.skips))}
        ${row("Negative scoring", `<button type="button" class="switch ${cfg.neg ? "on" : ""}" role="switch" aria-checked="${cfg.neg}" aria-label="Negative scoring" data-h="set" data-k="neg" data-v="${cfg.neg ? "off" : "on"}"><i></i></button>`)}
        ${row("No repeats", `<button type="button" class="switch ${cfg.repeat ? "on" : ""}" role="switch" aria-checked="${cfg.repeat}" aria-label="No repeats" data-h="set" data-k="repeat" data-v="${cfg.repeat ? "off" : "on"}"><i></i></button>`)}
      </section>`;
    };

    // The TV's bottom-row controls, as round icon buttons at the top (fullscreen needs a tap on the TV itself)
    const topIcons = () => !["ready", "show", "result", "turnEnd", "final"].includes(st.screen) ? "" : `<div class="r-top">
        <button class="r-icon" data-h="restartNow" data-confirm="Restart the game?" aria-label="Restart">${IC.restart}</button>
        <button class="r-icon" data-h="mute" aria-label="${st.muted ? "Turn sound on" : "Turn sound off"}">${st.muted ? IC.soundOff : IC.soundOn}</button>
        <button class="r-icon" data-h="menuNow" data-confirm="Quit to menu?" aria-label="Menu">${IC.menu}</button></div>`;

    const paint = () => {
      if (conn !== "on" || !st) {
        const msg = conn === "replaced" ? "Another phone took over the remote."
          : conn === "off" ? "The remote was turned off on the TV."
          : conn === "notfound" ? `No game found for <b>${esc(REMOTE_CODE)}</b>.<br>Open the game on the TV and press Remote.`
          : conn === "lost" ? "Connection lost. Reconnecting…"
          : conn === "error" ? "Couldn't connect. Check the internet."
          : "Connecting to the TV…";
        $app.innerHTML = `<main class="remote center-r"><div class="spinner ${conn === "notfound" || conn === "error" || conn === "off" || conn === "replaced" ? "off" : ""}"></div><p class="r-msg">${msg}</p>
          ${conn === "notfound" || conn === "error" || conn === "off" || conn === "replaced" ? `<button class="big" data-r="retry">${conn === "replaced" ? "Take over" : conn === "off" ? "Reconnect" : "Try again"}</button>` : ""}</main>`;
        return;
      }
      const a = st.skipping ? null : st.answer || st.upcoming;
      const who = st.team ? `<i class="dot" style="--c:${st.team.color}"></i>${esc(st.team.name)} · <b>${st.player}</b>${st.chance ? ` · chance ${st.chance}` : ""}` : st.round ? esc(st.round) : "";
      const c = controls();
      $app.innerHTML = `<main class="remote ${st.screen === "setup" ? "" : "fit"}">
        ${topIcons()}
        ${who ? `<p class="r-who">${who}</p>` : ""}
        ${st.screen === "loading" ? `<div class="r-loading"><div class="spinner"></div><p class="r-msg">Loading faces…</p></div>` : ""}
        ${a && st.screen !== "final" ? `<div class="r-card ${st.answer ? "" : "next"}"><img src="${esc(a.img)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />
          <b>${esc(a.name)}</b></div>` : ""}
        ${st.screen === "setup" ? setupRows() : ""}
        ${st.screen === "show" && st.skipping ? `<div class="r-timer r-skip"><p class="r-msg">Skipping</p></div>` : st.screen === "show" ? `<div class="r-timer" id="htimer"></div>` : ""}
        ${st.turnEnd ? `<div class="r-summary"><b style="color:${st.turnEnd.color}">${esc(st.turnEnd.headline)}</b>
          ${st.turnEnd.next ? `<p>Next: <span style="color:${st.turnEnd.next.color}">${esc(st.turnEnd.next.name)}</span></p>` : st.turnEnd.last ? `<p>Final scores next</p>` : ""}</div>` : ""}
        ${st.final ? `<div class="r-summary"><b ${st.final.color ? `style="color:${st.final.color}"` : ""}>${esc(st.final.headline)}</b>
          <ol class="r-rank">${st.final.ranked.map((r) => `<li><span><i class="dot" style="--c:${r.color}"></i>${esc(r.name)}</span><b>${r.score}</b></li>`).join("")}</ol></div>` : ""}
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
        c.on("data", (m) => { if (m?.type === "replaced") { turnedOff = true; conn = "replaced"; clearTimeout(retryTimer); try { p.destroy(); } catch {} return paint(); } if (m?.type === "off") { turnedOff = true; conn = "off"; clearTimeout(retryTimer); try { p.destroy(); } catch {} return paint(); } onState(m); });
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
      if (b.dataset.h === "adjust") return send("adjust", { t: +b.dataset.t, d: +b.dataset.d });
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

  // Keep the fullscreen buttons in sync (also when leaving fullscreen with the browser's own controls)
  if (!IS_HOST_VIEW) document.addEventListener("fullscreenchange", () => render());

  // ---------- boot ----------
  if (IS_HOST_VIEW) {
    remoteView();
  } else {
    render();
    requestAnimationFrame(loop);
  }
})();
