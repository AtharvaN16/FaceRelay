// Checks every deck title resolves on Wikipedia and has a lead image.
import fs from "node:fs";
const src = fs.readFileSync(new URL("../decks.js", import.meta.url), "utf8");
const window = {}; new Function("window", src)(window);
let bad = 0;
for (const [key, deck] of Object.entries(window.DECKS)) {
  for (let i = 0; i < deck.people.length; i += 40) {
    const chunk = deck.people.slice(i, i + 40);
    const u = new URL("https://en.wikipedia.org/w/api.php");
    Object.entries({ action: "query", format: "json", formatversion: "2", redirects: "1",
      prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "800", titles: chunk.join("|") })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    let j;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(u, { headers: { "User-Agent": "face-relay-deck-check/1.0" } });
      const txt = await r.text();
      try { j = JSON.parse(txt); break; } catch { await new Promise((res) => setTimeout(res, 8000 * (attempt + 1))); }
    }
    if (!j) throw new Error("Wikipedia kept rate-limiting; try again in a minute");
    await new Promise((res) => setTimeout(res, 500));
    const norm = new Map();
    for (const n of j.query.normalized || []) norm.set(n.from, n.to);
    for (const n of j.query.redirects || []) norm.set(n.from, n.to);
    const pages = new Map(j.query.pages.map(p => [p.title, p]));
    for (const t of chunk) {
      let title = t; while (norm.has(title)) title = norm.get(title);
      const p = pages.get(title);
      if (!p || p.missing || !p.thumbnail) { bad++; console.log(`✗ [${key}] ${t}`, p ? (p.missing ? "missing" : "no image") : "not found"); }
      else if (/disambiguation/i.test(p.description || "")) { bad++; console.log(`✗ [${key}] ${t} disambiguation`); }
    }
  }
}
console.log(bad ? `${bad} problems` : "All titles OK");
