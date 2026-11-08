# Face Relay

A party game for the TV: a famous face appears, and you have a few seconds to name it.
Inspired by the quick-fire "name the person in the photo" games on Korean variety shows.

Plain HTML/CSS/JS with no build step. Photos are loaded live from Wikipedia.

## Run it
```bash
npm start            # http://localhost:4173 (no-cache dev server, needs Python 3)
```
Other devices on the same Wi-Fi can open `http://<your-laptop-ip>:4173`.

## Put it on the TV
- **Chrome:** ⋮ → *Cast…* → *Cast tab*, then press **F** for fullscreen.
- **Mac:** AirPlay / Screen Mirroring, or HDMI.
- **Remote:** press **Remote** in the menu and scan the QR code with your phone. The phone shows the answer and only the buttons you need right now (Next, Skip, Pause, Undo). It connects straight to the game's browser (WebRTC via the free PeerJS server), so there's no backend. Phones can't open `localhost`, so use the live site.

## Setup
- **Teams:** 1–6 teams. Click a team's colour square to change its colour. Use − / + on a team to set its players (1–8).
- **Personalities:** pick decks (Bollywood & Indian Cinema, Hollywood, Music, Sports Stars, Tech & Business, Scientists, Writers & History; about 260 people). To add people or a new category, see [Add faces or a category](#add-faces-or-a-category).
- **Time:** 2, 3, 5 or 8 seconds per face.

## Modes
- **Relay Chain:** teams take turns, and players answer in order (P1, P2, …).
  - Every team gets the same number of faces per turn (the size of the biggest team). Smaller teams go around again: P1, P2, P1, P2.
  - Each correct answer scores +1.
  - A wrong answer or timeout uses one of that player's chances; running out of chances ends the team's turn.
  - If the whole team gets its faces right, they get a +3 bonus.
  - Settings: turns per team, chances per player, and order (once, or down & back).
- **Shout-Out Battle:** every team plays at once. The first team to shout the name scores.

## Keys
| Key | Action |
| --- | --- |
| `Space` | Next. With no phone connected, Space first reveals the name to the room, then Space again = right |
| `⌘` (Mac) / `Ctrl` (Windows) | Wrong, after the name is revealed (tap it on its own) |
| `]` / `[` | Right / wrong |
| `1`–`6` / `0` | Award a team / nobody (Shout-Out) |
| `P` | Pause (hides the face, freezes the clock) |
| `S` | Skip. Relay: the turn passes to the next player (no point, no penalty, but no chain bonus). Shout-Out: a new face |
| `U` | Undo the last call: the score goes back and the same player gets a new face (no penalty) |
| `T` | TV mode (higher contrast) |
| `R` | Restart |
| `F` | Fullscreen |
| `M` | Mute |
| `Esc` | Menu |

## Saving
The game in progress is saved in this browser's local storage. After an accidental refresh or a closed tab, the menu offers **Resume**. Quitting to the menu or finishing a game clears it.

## Add faces or a category
All the people live in [`decks.js`](decks.js). Every person is the title of their English Wikipedia page; the game loads the photo and the short description from Wikipedia. You can edit it straight on GitHub, with nothing to install:

1. Open [`decks.js` on GitHub](https://github.com/AtharvaN16/FaceRelay/blob/main/decks.js) and press the pencil icon (**Edit this file**).
2. Make your change (below).
3. Press **Commit changes**. Vercel puts the new version live in about 30 seconds. Reload the game on the TV and phone.

**Add a person to a category.** Add their Wikipedia page title, in quotes, followed by a comma, to that category's `people` list:
```js
people: [
  "Shah Rukh Khan", "Amitabh Bachchan",
  "Kiara Advani",           // ← new
```
Use the exact title from the end of their Wikipedia link, with spaces instead of underscores: `en.wikipedia.org/wiki/Kiara_Advani` → `"Kiara Advani"`. When a name is shared, Wikipedia adds a word in brackets, and you include it too: `en.wikipedia.org/wiki/Vijay_(actor)` → `"Vijay (actor)"`.

**Add a new category.** Copy this block and paste it on the line above `// ↑ Paste new categories above this line`:
```js
  cricket: {
    label: "Cricket",
    emoji: "🏏",
    people: [
      "Virat Kohli", "MS Dhoni", "Sachin Tendulkar", "Rohit Sharma", "Jasprit Bumrah"
    ]
  },
```
- `cricket` is an internal id: lowercase, no spaces, different from the other categories.
- `label` is the name on the pill in the menu.
- Aim for 20 or more people so a game doesn't run out.

The new category shows up in the menu's Personalities list; tap it to include it.

**Famous only.** Below the categories, the `FAMOUS` list picks the best-known people from each category for the **Famous only** pill. To include someone there, add their name to their category's line in `FAMOUS` (they must also be in that category's `people`). For a new category, add a line such as `cricket: ["Virat Kohli", "MS Dhoni"],`.

**Good to know**
- The person needs an English Wikipedia page with a photo. Anyone without one is quietly left out of the game.
- If the game stops loading after an edit, a quote or comma is probably missing. GitHub's **History** button on the file lets you go back.
- Optional, on a computer with the project: `npm run verify-decks` checks every name and lists the ones without a photo.

## Deploy to Vercel
This is a static site, so it needs no config:
```bash
vercel --prod
```
