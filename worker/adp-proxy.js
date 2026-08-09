/**
 * GRIDIRON COMMAND — backend worker (Cloudflare Worker)
 * ------------------------------------------------------------------
 * Routes:
 *   /            FFC ADP proxy (CORS + edge cache)
 *   /fp          FantasyPros ECR proxy (forwarded x-api-key or FP_API_KEY)
 *   /announce    AI announcer — Claude-generated pick commentary
 *   /voice       Neural TTS for announcer lines (ElevenLabs or OpenAI)
 *
 * DEPLOY (free tier):
 *   1. Create a free Cloudflare account.
 *   2. Workers & Pages → Create → Worker. Paste this file. Deploy.
 *   3. Copy the *.workers.dev URL into js/config.js.
 *
 * SECRETS (Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY   required for /announce
 *   ANNOUNCER_MODEL     optional — defaults to "claude-opus-5"; set
 *                       "claude-haiku-4-5" for the cheap/fast tier
 *   ELEVENLABS_API_KEY  optional — /voice via ElevenLabs
 *   ELEVENLABS_VOICE_ID optional — defaults to a stock voice
 *   OPENAI_API_KEY      optional — /voice via OpenAI TTS (used if no ElevenLabs)
 *   LICENSE_REQUIRED    optional — "true" to require a valid Lemon Squeezy
 *                       license key (x-gridiron-license header) on
 *                       /announce and /voice. Leave unset for personal use.
 *   FP_API_KEY          optional — personal deployments only (see /fp note)
 *
 * Optional hardening: set ALLOWED_ORIGIN to your app's domain instead
 * of "*" so only your site can use the proxy.
 */

const ALLOWED_ORIGIN = "*";
const UPSTREAM = "https://fantasyfootballcalculator.com/api/v1/adp";
const VALID_FORMATS = new Set(["standard", "half-ppr", "ppr"]);

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, x-api-key, x-gridiron-license",
    ...extra
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: cors({ "Content-Type": "application/json" })
  });
}

// ---- basic per-IP rate limit (per-isolate; upgrade to KV/Durable Objects
// if you need a hard global limit — this stops casual abuse, not attacks) ----
const rateBuckets = new Map();
function rateLimited(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now > b.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > limit;
}

// ---- Lemon Squeezy license check (only when LICENSE_REQUIRED="true") ----
const licenseCache = new Map();   // key -> {ok, exp}
async function licenseOk(request, env) {
  if (!env || env.LICENSE_REQUIRED !== "true") return true;
  const key = request.headers.get("x-gridiron-license");
  if (!key) return false;
  const cached = licenseCache.get(key);
  if (cached && Date.now() < cached.exp) return cached.ok;
  try {
    const r = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key: key }),
    });
    const data = await r.json();
    const ok = data && data.valid === true;
    licenseCache.set(key, { ok, exp: Date.now() + 10 * 60 * 1000 });
    return ok;
  } catch {
    return true;   // license server unreachable: fail open rather than kill draft night
  }
}

// ---- announcer prompt ----
const ANNOUNCER_SYSTEM = `You are Buck "The Cannon" Callahan, a bombastic fictional fantasy-football draft-night announcer with a booming broadcast voice, quick wit, and deep fantasy knowledge. You call picks live on a draft-party broadcast.

Rules:
- Reply with ONLY the announcer line. No quotes, no stage directions, no emojis, no markdown.
- 1-3 sentences, at most 55 words. Punchy, spoken-word broadcast rhythm (the line is read aloud by TTS).
- Reference the specifics you're given: player, fantasy team name, pick slot, value, roster situation, or earlier picks. Never invent stats or injuries.
- Match tone to the grade: steal (score >= 88) = ecstatic disbelief; good (72+) = warm approval; fair (50+) = measured pro's nod; reach (32+) = skeptical ribbing; disaster (<32) = theatrical meltdown.
- Kickers or defenses taken absurdly early deserve a proper roast. A team hoarding QBs deserves a jab.
- Vary your openings — never start consecutive calls the same way. Light callbacks to earlier picks in this draft are gold.
- For mode "wrap": deliver a 2-3 sentence draft-closing send-off using the recap facts given.`;

async function handleAnnounce(request, env) {
  if (!env || !env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY not configured on the worker" }, 501);
  }
  let ctx;
  try { ctx = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  const model = (env.ANNOUNCER_MODEL || "claude-opus-5").trim();
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,                    // headroom: on Opus 5 thinking counts toward the cap
      output_config: { effort: "low" },    // fast + cheap; plenty for a one-liner
      system: ANNOUNCER_SYSTEM,
      messages: [{ role: "user", content: `Draft context:\n${JSON.stringify(ctx)}\n\nCall it, Buck.` }],
    }),
  });
  if (!resp.ok) {
    return json({ error: `anthropic ${resp.status}` }, 502);
  }
  const data = await resp.json();
  if (data.stop_reason === "refusal") {
    return json({ error: "refused" }, 502);   // client falls back to template lines
  }
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").trim();
  if (!text) return json({ error: "empty completion" }, 502);
  return json({ line: text, model: data.model }, 200);
}

// ---- neural TTS ----
async function handleVoice(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const text = String(body.text || "").slice(0, 600);
  if (!text) return json({ error: "no text" }, 400);

  if (env && env.ELEVENLABS_API_KEY) {
    const voiceId = env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";   // stock deep male voice
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
    });
    if (!r.ok) return json({ error: `elevenlabs ${r.status}` }, 502);
    return new Response(r.body, { status: 200, headers: cors({ "Content-Type": "audio/mpeg" }) });
  }
  if (env && env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice: "onyx", input: text }),
    });
    if (!r.ok) return json({ error: `openai ${r.status}` }, 502);
    return new Response(r.body, { status: 200, headers: cors({ "Content-Type": "audio/mpeg" }) });
  }
  return json({ error: "no TTS provider configured" }, 501);   // client uses browser TTS
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    const url = new URL(request.url);

    // ---- AI announcer routes (POST, license-gated when selling) ----
    if (url.pathname === "/announce" || url.pathname === "/voice") {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      if (rateLimited(ip)) return json({ error: "rate limited" }, 429);
      if (!(await licenseOk(request, env))) return json({ error: "license required" }, 403);
      try {
        return url.pathname === "/announce"
          ? await handleAnnounce(request, env)
          : await handleVoice(request, env);
      } catch (e) {
        return json({ error: "internal", detail: String(e) }, 500);
      }
    }

    // ---- FantasyPros ECR proxy ----------------------------------------
    // FP standard keys are PERSONAL, NON-COMMERCIAL use only. This route is
    // a CORS shim: each user's own key arrives as x-api-key and is
    // forwarded, never stored. The FP_API_KEY env fallback is ONLY for a
    // private personal deployment (your own devices) — do NOT set it on a
    // worker that serves customers; that distributes your API access.
    if (url.pathname === "/fp") {
      const fpApiKey = request.headers.get("x-api-key") || (env && env.FP_API_KEY);
      if (!fpApiKey) {
        return json({ error: "FP_API_KEY not configured on the worker" }, 501);
      }
      const scoring = (url.searchParams.get("scoring") || "HALF").toUpperCase();
      const fpYear = Math.min(2100, Math.max(2000, parseInt(url.searchParams.get("year") || "2026", 10)));
      if (!["STD", "HALF", "PPR"].includes(scoring)) {
        return json({ error: "scoring must be STD | HALF | PPR" }, 400);
      }
      try {
        const upstream = await fetch(
          `https://api.fantasypros.com/public/v2/json/nfl/${fpYear}/consensus-rankings?type=draft&scoring=${scoring}&position=ALL&week=0`,
          { headers: { "x-api-key": fpApiKey, "Accept": "application/json" },
            cf: { cacheTtl: 3600, cacheEverything: true } }
        );
        if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502);
        const body = await upstream.text();
        return new Response(body, {
          status: 200,
          headers: cors({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" })
        });
      } catch (e) {
        return json({ error: "fetch failed", detail: String(e) }, 502);
      }
    }
    const format = (url.searchParams.get("format") || "ppr").toLowerCase();
    const teams = Math.min(20, Math.max(4, parseInt(url.searchParams.get("teams") || "12", 10)));
    const year = Math.min(2100, Math.max(2000, parseInt(url.searchParams.get("year") || "2026", 10)));

    if (!VALID_FORMATS.has(format)) {
      return json({ error: "format must be standard | half-ppr | ppr" }, 400);
    }

    const target = `${UPSTREAM}/${format}?teams=${teams}&year=${year}`;
    try {
      const upstream = await fetch(target, {
        headers: { "Accept": "application/json", "User-Agent": "GridironCommand/1.0" },
        cf: { cacheTtl: 3600, cacheEverything: true }   // cache 1h at the edge
      });
      if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502);
      const body = await upstream.text();
      return new Response(body, {
        status: 200,
        headers: cors({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" })
      });
    } catch (e) {
      return json({ error: "fetch failed", detail: String(e) }, 502);
    }
  }
};
