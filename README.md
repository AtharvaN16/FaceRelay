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
- **Host remote:** opens a small window on your laptop that shows the answer and the next face. Cast only the main tab.

## Setup
- **Teams:** 1–6 teams. Click a team's colour square to change its colour. Use − / + on a team to set its players (1–8).
- **Faces:** pick decks (Bollywood & Indian Cinema, Hollywood, Music, Sports Stars, Tech & Business, Scientists, Writers & History; about 260 people). **+ Add** takes extra names (looked up on Wikipedia) or photos; the file name is the answer.
- **Time:** 2, 3, 5 or 8 seconds per face.

## Modes
- **Relay Chain:** teams take turns, and players answer in order (P1, P2, …).
  - Each correct answer scores +1.
  - A wrong answer or timeout uses one of that player's chances; running out of chances ends the team's turn.
  - If the whole team gets its faces right, they get a +3 bonus.
  - Settings: turns per team, chances per player, and order (once, or down & back).
- **Shout-Out Battle:** every team plays at once. The first team to shout the name scores.

## Keys
| Key | Action |
| --- | --- |
| `Space` | Show face / correct / next |
| `←` | Wrong |
| `1`–`6` / `0` | Award a team / nobody (Shout-Out) |
| `R` | Restart |
| `F` | Fullscreen |
| `M` | Mute |
| `Esc` | Menu |

## Edit the decks
Edit `decks.js`, then run `npm run verify-decks` to check that every name has a Wikipedia photo.

## Deploy to Vercel
This is a static site, so it needs no config:
```bash
vercel --prod
```
