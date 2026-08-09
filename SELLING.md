# Selling Gridiron Command — Deployment & Monetization Guide

This is the operator's manual for turning the app into a paid product. It covers
hosting, license keys, live data, and the legal must-dos. Everything here is
Phase 1 — enough to take money safely.

---

## 1. How the pieces fit together

```
  Buyer ──▶ Lemon Squeezy checkout ──▶ license key emailed
     │
     ▼
  Your hosted app (static files)  ──▶ activates key live against Lemon Squeezy API
     │                                  (CORS-enabled; no backend needed)
     ▼
  "Sync Live ADP" button ──▶ your Cloudflare Worker ──▶ FantasyFootballCalculator
                              (adds CORS + caching)
```

Only **two** external accounts are required: **Lemon Squeezy** (payments + keys)
and **Cloudflare** (the free ADP proxy). Both have free tiers; Lemon Squeezy
takes a per-sale fee.

Everything is configured in **`js/config.js`** — you never touch the app logic.

---

## 2. Turn on the license gate

By default `requireLicense` is `false` so you can develop freely. To sell:

1. Create a **Lemon Squeezy** account and a **Product** (a one-time purchase, or
   a yearly "season pass" — see pricing below). Enable **License Keys** on the
   product's variant (Lemon Squeezy → product → *License keys* → enable).
2. In `js/config.js`, set:
   ```js
   license: {
     requireLicense: true,
     storeId: 12345,          // optional: your store id (extra safety)
     productId: 67890,        // optional: your product id
     buyUrl: "https://YOURSTORE.lemonsqueezy.com/buy/abc123",
     devUnlockCode: null,     // REMOVE the dev bypass for production!
     ...
   }
   ```
3. That's it. On load the app shows the activation screen; a valid key unlocks it
   and is remembered on that device. Keys re-validate every few days and allow a
   7-day offline grace window (both configurable).

**Activation limits:** set the "activation limit" per license in Lemon Squeezy
(e.g. 3 devices). The app surfaces a friendly message when a buyer hits the cap.

> Security note: this is client-side licensing. It stops casual copying and ties
> the app to paying customers, but a determined technical user can bypass any
> browser-only gate. The real moats are (a) hosting it yourself so there are no
> files to redistribute, and (b) the Phase 2 server-side AI announcer, which
> can't be pirated because the smarts live on your server.

---

## 3. Deploy the live-ADP proxy (optional but recommended)

FantasyFootballCalculator's ADP API has great current data but sends no CORS
header, so browsers can't call it directly. The included Cloudflare Worker fixes
that. Without it, the app still works via **CSV import** and the built-in board —
the "Sync Live ADP" button just shows a hint.

1. Free **Cloudflare** account → **Workers & Pages** → **Create Worker**.
2. Paste [`worker/adp-proxy.js`](worker/adp-proxy.js). Deploy.
3. Copy the `*.workers.dev` URL into `js/config.js`:
   ```js
   adpProxyUrl: "https://gridiron-adp.yourname.workers.dev"
   ```
4. (Optional) In the worker, set `ALLOWED_ORIGIN` to your app's domain so only
   your site can use it.

The worker caches responses at Cloudflare's edge for an hour, so you won't hammer
the upstream even with many users.

### FantasyPros expert-consensus rankings (recommended data source)

The app can also pull ~100-expert consensus rankings (ECR) from the FantasyPros
API — better signal than raw mock-draft ADP. Note (verified): the FP API
**rejects browser CORS preflights** (403 on OPTIONS), so the browser can never
call it directly — every setup routes through a proxy.

**⚠ FP API terms (standard keys): personal, non-commercial use only.** You may
not use your key for commercial purposes, resell the data, or distribute API
access to third parties. Quota: 1 request/second, 500 requests/day, and they
require you to cache. That dictates the architecture:

- **Your own machine (personal use — allowed):** run the local dev server (it
  proxies `/fp` using your key file, which is gitignored) and click
  **FANTASYPROS ECR** in setup.
- **For buyers — your key must NEVER serve them.** Serving customers from your
  personal key = commercial use + distributing API access, both prohibited.
  The compliant options:
  1. **Bring-your-own-key:** each buyer pastes *their own* free FantasyPros
     key into the setup screen (stored only in their browser). The worker's
     `/fp` route forwards it as `x-api-key` without storing anything — the
     worker is a CORS shim, not shared access. Do NOT set `FP_API_KEY` on a
     worker that buyers use.
  2. **CSV import:** FantasyPros lets logged-in users export their own
     rankings/cheat sheets — buyers can import those directly, no API at all.
  3. **A real commercial license:** if you want FP data built-in for buyers,
     ask FantasyPros for partner/commercial API terms before launch.

**Quota compliance (built-in):** the app caches each synced board in
localStorage for 6 hours per scoring format, collapses concurrent syncs into
one request, and falls back to the cached board when offline or rate-limited
(a revoked/bad key still surfaces as an error — it's never masked). Worst
case is ~a dozen requests/day against the 500/day cap, and the UI can't fire
faster than 1 request/second. The Cloudflare Worker additionally edge-caches
for an hour.

Also keep `fantasy pros api.txt` (and any file containing a real key) out of
the repo — it's already in .gitignore.

---

## 4. Host the app

It's pure static files (HTML/CSS/JS) — host anywhere:

- **Cloudflare Pages / Netlify / Vercel** — drag-and-drop the folder, free HTTPS,
  custom domain. Recommended.
- **GitHub Pages** — also fine.

Point your domain at it, flip `requireLicense: true`, and you're live.

---

## 5. Legal checklist (do NOT skip before charging)

- [x] **Announcer renamed** to the fictional "Buck 'The Cannon' Callahan." Never
      use a real broadcaster's name or likeness.
- [ ] **No NFL/team trademarks.** Player *names and stats* are facts and are fine
      to use in the US. NFL team logos, the "NFL" name, and team wordmarks are
      trademarked — don't put them in your product, store page, or marketing.
      Use city/abbreviation text (e.g. "DAL") not logos.
- [ ] **ADP data licensing.** Confirm the commercial-use terms of whatever ADP
      source you ship. FantasyFootballCalculator is used here via their public
      API for convenience — verify their terms, or lean on user-supplied CSVs.
- [ ] **Add Terms & a Refund policy** on your store page (Lemon Squeezy has
      templates). Because it's seasonal, state your refund window clearly.
- [ ] **"Not affiliated with the NFL"** disclaimer in your footer/store page.

---

## 6. Pricing suggestion

This product is **seasonal** — nearly all demand is late July through early
September (draft season). A subscription invites chargebacks and "why am I still
paying in March" cancellations. Better options:

- **Season pass:** ~$15–25, unlocks for the current season. Simple, matches how
  people think about their league.
- **One-time "lifetime":** ~$29–39, unlocks all future seasons. Higher upfront,
  no renewal friction. Good if your update burden is low.

Sell the **experience** (draft-night entertainment on the big screen, the
announcer, the shareable recap), not the analytics — that's what's hard to copy
and what people will pay a premium for.

---

## 7. What's deliberately NOT here (Phase 2+)

- **LLM + neural-voice announcer** — unique, unrepeatable commentary. Needs a
  small backend (which also becomes an un-pirateable licensing anchor).
- **Draft-platform sync** (Sleeper/ESPN/Yahoo) — picks flow onto the board
  automatically instead of manual entry.
- **Mock draft mode** with AI opponents.
- **Auction & keeper** formats.

See the conversation notes / roadmap for the full Phase 2 plan.
