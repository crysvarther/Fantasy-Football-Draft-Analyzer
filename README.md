# 🏈 GRIDIRON COMMAND — Fantasy Football Draft Analyzer

A self-contained draft war room built for a widescreen TV. No install, no internet
required — just double-click **index.html** and it opens in your browser.

## Running it

1. Double-click `index.html` (Chrome or Edge recommended).
2. Press **F11** for fullscreen on the TV.
3. Pick your league settings and hit **KICKOFF THE DRAFT**.

## Features

- **Live snake draft board** — color-coded by position, auto-advances the
  "ON THE CLOCK" tracker, and scrolls to keep the current pick in view.
- **Pick grading (A+ → F)** — every pick is graded against the player's
  format-adjusted board value. Steals celebrate with confetti; disasters get
  booed. Grading accounts for:
  - how far the player fell (or how far you reached)
  - how many better players you passed up
  - roster construction (filling a hole helps; a 3rd QB hurts)
  - kickers/defenses drafted absurdly early
- **League settings** — 8/10/12/14/16 teams, 10–16 rounds, Standard /
  Half PPR / Full PPR scoring, 1QB or Superflex, editable team names.
  All values (ADP + projections) re-rank automatically per format.
- **Player data, three ways** —
  - **Built-in board** — curated 2026 rankings, works fully offline.
  - **Sync Live ADP** — pulls current average draft position (requires the
    included Cloudflare Worker proxy; see [SELLING.md](SELLING.md)).
  - **Import CSV** — drop in your own cheat sheet / rankings export. Flexible
    column matching; estimates projections for players it doesn't recognize.
- **AI announcer** — "Buck 'The Cannon' Callahan" in a broadcast lower-third
  with animated voice bars. Commentary is spoken aloud using your browser's
  built-in text-to-speech (toggle MIC ON/MUTED at setup). Reaches get roasted.
  Kickers in round 3 get *really* roasted.
- **Post-draft recap** — power rankings by draft grade, "Steal of the Draft"
  and "Biggest Reach" awards, and a one-click **shareable graphic** (a PNG for
  your league chat).
- **Best Available panel** — top of the board with live value tags.
- **Undo & auto-save** — undo any pick; the draft auto-saves (with its exact
  player pool) so you can close the browser and hit RESUME SAVED DRAFT later.

## Selling it?

See [SELLING.md](SELLING.md) for the full deployment + monetization guide:
license keys via Lemon Squeezy, the live-ADP proxy, hosting, and the legal
checklist. Licensing is off by default (`js/config.js` → `license.requireLicense`)
so you can develop freely.

## Tips

- Type in the search box and press **Enter** to instantly draft the top match.
- Click anywhere on the grade card to dismiss it early.
- The announcer voice depends on the voices installed in Windows — Edge
  usually has the best ones.

## Customizing the player pool

All player data lives in `js/players.js` — one line per player:

```
[name, team, position, ADP (full-PPR overall), projected PPR points, receptions, bye week]
```

The shipped data is a ~215-player sample board (2026 season, approximate).
Before draft day, you can paste in fresh ADP numbers from your favorite site —
only that one file needs editing.
