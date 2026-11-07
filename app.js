/* Face Relay — a 3-second "name the famous face" party game for teams.
 * Plain browser JS, no build step. Photos come from Wikipedia at game start.
 * Optional host remote: a second window (?view=host) synced over BroadcastChannel.
 */
(() => {
  "use strict";

  const IS_HOST_VIEW = new URLSearchParams(location.search).get("view") === "host";
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("face-relay") : null;
  const $app = document.getElementById("app");
  const STORE_KEY = "face-relay:settings:v2";
  const CACHE_KEY = "face-relay:wiki:v1";
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
    decks: ["bollywood", "cricket", "hollywood", "music"],
    seconds: 3,
    laps: 1,
    turns: 3,     // relay: turns per team
    chances: 1,   // relay: tries each player gets before the chain breaks
    rounds: 20,   // shout-out: number of faces
    customNames: "",
    muted: false,
  };

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return { ...defaults }; }
  }
  function saveSettings() {
    const { mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, customNames, muted } = S;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ mode, teamCount, teamSizes, teamColors, decks, seconds, laps, turns, chances, rounds, customNames, muted })); } catch {}
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
        if (p && !p.missing && p.thumbnail) {
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
    hostConnected: false,
  };
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

  // Answering order inside a team: 1..n, or 1..n then n..1 for "down & back"
  function chainOrder() {
    const base = Array.from({ length: S.teamSizes[S.team] }, (_, i) => i);
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
    S.round = 0; S.awarded = null;
    S.screen = "ready"; render();
  }

  function go() {
    if (S.mode === "shout") S.round++;
    nextCard();
    S.result = null; S.awarded = null;
    S.deadline = performance.now() + S.seconds * 1000;
    S.lastTick = -1;
    S.screen = "show"; sfx.go(); render();
  }

  function stopClock() { S.secondsLeft = Math.max(0, (S.deadline - performance.now()) / 1000); }

  // Relay judging
  function judge(correct) {
    if (S.mode !== "relay" || inputLocked()) return;
    if (S.screen !== "show") return;
    stopClock();
    S.result = correct ? "correct" : "wrong";
    if (correct) { S.scores[S.team]++; S.run++; sfx.correct(); }
    else { S.misses++; sfx.wrong(); }
    S.screen = "result";
    render();
  }
  let autoTimer = null;
  function timeUp() {
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
      if (S.result === "correct" && S.link < chainOrder().length - 1) { S.link++; S.misses = 0; S.screen = "ready"; return render(); }
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

  function finish() { S.screen = "final"; sfx.win(); confetti(); render(); }

  // Shout-out: award a team
  function award(t) {
    if (S.mode !== "shout" || S.screen !== "show" || inputLocked()) return;
    stopClock();
    if (t >= 0 && t < S.teamCount) { S.scores[t]++; S.awarded = t; sfx.correct(); }
    else { S.awarded = -1; sfx.wrong(); }
    S.screen = "result"; render();
  }

  function primary() {
    if (S.screen !== "setup" && inputLocked()) return;
    switch (S.screen) {
      case "setup": return startGame();
      case "ready": return go();
      case "show": if (S.mode === "relay") judge(true); else award(-1); return;
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

  async function restart() {
    if (!(await ask("Restart the game?", "Restart"))) return;
    clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = "";
    S.scores = Array(S.teamCount).fill(0); S.clears = Array(S.teamCount).fill(0);
    S.team = 0; S.turnNo = 1; S.link = 0; S.run = 0; S.misses = 0; S.result = null; S.cleared = false;
    S.round = 0; S.awarded = null; S.screen = "ready"; render();
  }

  function toMenu() { clearTimeout(autoTimer); document.getElementById("confetti").innerHTML = ""; S.screen = "setup"; render(); }

  // ---------- timer loop ----------
  function loop() {
    if (S.screen === "show" && !IS_HOST_VIEW) {
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
    remote: svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17.2h.01"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 10l4 4M20 10l-4 4"/>'),
    restart: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
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
    if (IS_HOST_VIEW) return;
    if (S.screen !== lastScreen) { lastScreen = S.screen; lockUntil = performance.now() + INPUT_LOCK_MS; }
    $app.dataset.screen = S.screen;
    $app.innerHTML = S.screen === "setup" ? viewSetup() : S.screen === "loading" ? viewLoading() : viewGame();
    if (S.screen === "setup") bindSetup();
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
          <button class="ghost" data-act="host" type="button" title="Open a second window on your laptop that shows the answers">${IC.remote} Host remote</button>
          <button class="ghost" data-act="howto" type="button">${IC.help} How to play</button>
          <button class="ghost" data-act="fs" type="button">${IC.expand} Fullscreen</button>
        </div>
      </header>
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ""}
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
        <button class="big go" data-act="start" type="button">Start</button>
      </footer>
      ${howtoDialog()}
    </main>`;
  }

  function howtoDialog() {
    return `<dialog id="howto">
      <h2>How to play</h2>
      <h3>Relay Chain</h3>
      <ol>
        <li>Teams take turns. Players answer in order, ${S.seconds}s per face.</li>
        <li>Correct: +1. Wrong or timeout uses a chance. Out of chances ends the turn.</li>
        <li>Whole team correct: +${CHAIN_BONUS} bonus.</li>
        <li>Host: <kbd>Space</kbd> correct / next, <kbd>←</kbd> wrong.</li>
      </ol>
      <h3>Shout-Out Battle</h3>
      <ol>
        <li>First team to shout the name scores.</li>
        <li>Host: <kbd>1</kbd>–<kbd>${S.teamCount}</kbd> award, <kbd>0</kbd> nobody.</li>
      </ol>
      <h3>Keys</h3>
      <p>${keyHint("R", "restart")} ${keyHint("F", "fullscreen")} ${keyHint("M", "mute")} ${keyHint("Esc", "menu")}</p>
      <form method="dialog"><button class="big go">Close</button></form>
    </dialog>`;
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
        stage = `<div class="showwrap">${photo(false, "live")}</div>
          <div class="timer"><div class="track"><div id="timebar"></div></div><div id="timenum">${S.seconds}</div></div>`;
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
      <footer class="keys">${S.screen !== "final" ? `${scoreboard()}<span class="prog">${progress}</span>` : ""}${keys ? `<span class="hints">${keys}</span>` : ""}<span class="spacer"></span>${S.hostConnected ? `<span class="kh live">${IC.remote} Host remote on</span>` : ""}
        <button class="ghost sm" data-act="restart" type="button" title="Restart (R)">${IC.restart} Restart</button>
        <button class="ghost sm icon" data-act="mute" type="button" title="Sound (M)" aria-label="${S.muted ? "Unmute" : "Mute"}">${S.muted ? IC.soundOff : IC.soundOn}</button>
        <button class="ghost sm icon" data-act="fs" type="button" title="Fullscreen (F)" aria-label="Fullscreen">${IC.expand}</button>
        <button class="ghost sm" data-act="menu" type="button" title="Menu (Esc)">${IC.close} Menu</button></footer>
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
            case "howto": return document.getElementById("howto")?.showModal();
      case "fs": return toggleFs();
      case "restart": return restart();
      case "mute": S.muted = !S.muted; saveSettings(); return render();
      case "menu": ask("Quit to menu?", "Quit").then((ok) => ok && toMenu()); return;
      case "host": return openHost();
    }
  });

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.()
      .then(() => navigator.keyboard?.lock?.(["Escape"]).catch(() => {}))
      .catch(() => {});
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
    if (k === "m" || k === "M") { S.muted = !S.muted; saveSettings(); return render(); }
    if (k === "Escape" && S.screen !== "setup" && S.screen !== "loading") { e.preventDefault(); ask("Quit to menu?", "Quit").then((ok) => ok && toMenu()); }
  });

  // ---------- host remote (BroadcastChannel) ----------
  function openHost() {
    if (!channel) return toast("Not supported in this browser");
    const w = window.open(location.pathname + "?view=host", "face-relay-host", "width=460,height=760");
    if (!w) toast("Pop-up blocked");
  }

  function broadcast() {
    if (!channel || IS_HOST_VIEW) return;
    const relay = S.mode === "relay";
    channel.postMessage({
      type: "state",
      screen: S.screen, mode: S.mode,
      answer: S.card && ["show", "judge", "result"].includes(S.screen) ? { name: S.card.name, desc: S.card.desc, img: S.card.img } : null,
      // Pre-announce the next face so the host knows it before it's shown
      upcoming: S.screen === "ready" && S.queue.length ? (() => { const c = S.queue[S.qi % S.queue.length]; return { name: c.name, desc: c.desc, img: c.img }; })() : null,
      status: S.screen === "setup" ? "In the menu"
        : relay ? `${teamName(S.team)} · ${playerLabel(chainOrder()[S.link] ?? 0)}${S.chances > 1 ? ` (chance ${Math.min(S.misses + 1, S.chances)}/${S.chances})` : ""} · turn ${Math.min(S.turnNo, S.turns)}/${S.turns}`
        : `Face ${S.round}/${S.rounds}`,
      teams: S.scores.map((s, t) => ({ name: teamName(t), color: teamColor(t), score: s })),
      deadline: S.screen === "show" ? Date.now() + (S.deadline - performance.now()) : 0,
    });
  }

  if (channel && !IS_HOST_VIEW) {
    channel.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === "hello") { S.hostConnected = true; broadcast(); render(); }
      if (m.type === "bye") { S.hostConnected = false; render(); }
      if (m.type !== "cmd") return;
      if (m.cmd === "primary") primary();
      if (m.cmd === "correct") judge(true);
      if (m.cmd === "wrong") judge(false);
      if (m.cmd === "award") award(m.arg);
    };
  }

  // Host view: a compact remote that shows the answer
  function hostView() {
    document.title = "Face Relay — Host remote";
    document.body.classList.add("hostview");
    let st = null;
    const send = (cmd, arg) => channel.postMessage({ type: "cmd", cmd, arg });
    const paint = () => {
      if (!st) { $app.innerHTML = `<main class="host"><h1>Host remote</h1><p class="sub">Waiting for the game tab</p></main>`; return; }
      const a = st.answer || st.upcoming;
      const relay = st.mode === "relay";
      let btns = "";
      if (st.screen === "ready") btns = `<button class="big go" data-h="primary">Show</button>`;
      else if (st.screen === "show" && relay) btns = `<button class="big go" data-h="primary">Correct</button>`;
      else if (st.screen === "show") btns = `<div class="hgrid">${st.teams.map((t, i) => `<button class="big" style="background:${t.color};color:#fff" data-h="award" data-arg="${i}">${esc(t.name)}</button>`).join("")}<button class="big bad" data-h="award" data-arg="-1">Nobody</button></div>`;
      else if (st.screen === "result" || st.screen === "turnEnd") btns = `<button class="big go" data-h="primary">Continue</button>`;
      else if (st.screen === "final") btns = `<button class="big go" data-h="primary">Menu</button>`;
      $app.innerHTML = `<main class="host">
        <p class="eyebrow">${esc(st.status)}</p>
        ${a ? `<div class="hans ${st.answer ? "" : "next"}"><img src="${esc(a.img)}" alt="" referrerpolicy="no-referrer" /><div><small>${st.answer ? "Now" : "Next"}</small><b>${esc(a.name)}</b><em>${esc(a.desc)}</em></div></div>` : ""}
        ${st.screen === "show" ? `<div class="htimer" id="htimer"></div>` : ""}
        <div class="hbtns">${btns}</div>
        ${st.teams?.length && st.screen !== "setup" ? `<ul class="hscores">${st.teams.map((t) => `<li><span><i class="dot" style="--c:${t.color}"></i> ${esc(t.name)}</span><b>${t.score}</b></li>`).join("")}</ul>` : ""}
      </main>`;
    };
    channel.onmessage = (ev) => { if (ev.data?.type === "state") { st = ev.data; paint(); } };
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-h]"); if (!b) return;
      send(b.dataset.h, b.dataset.arg !== undefined ? +b.dataset.arg : undefined);
    });
    document.addEventListener("keydown", (e) => {
      if (!st) return;
      if (e.key === " ") { e.preventDefault(); send("primary"); }
      if (e.key === "ArrowLeft") send("wrong");
      if (/^[0-9]$/.test(e.key) && st.mode === "shout") send("award", e.key === "0" ? -1 : +e.key - 1);
    });
    const tick = () => {
      const el = document.getElementById("htimer");
      if (el && st?.deadline) el.textContent = Math.max(0, (st.deadline - Date.now()) / 1000).toFixed(1) + "s";
      requestAnimationFrame(tick);
    };
    tick();
    addEventListener("beforeunload", () => channel.postMessage({ type: "bye" }));
    channel.postMessage({ type: "hello" });
    paint();
  }

  // ---------- boot ----------
  if (IS_HOST_VIEW) {
    if (!channel) $app.innerHTML = `<main class="host"><h1>Not supported in this browser</h1></main>`;
    else hostView();
  } else {
    render();
    requestAnimationFrame(loop);
  }
})();
