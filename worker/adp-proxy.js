/**
 * GRIDIRON COMMAND — ADP proxy (Cloudflare Worker)
 * ------------------------------------------------------------------
 * FantasyFootballCalculator's public ADP API serves current data but
 * sends no CORS header, so a browser can't call it. This tiny worker
 * fetches it server-side and re-serves it with CORS enabled + caching.
 *
 * DEPLOY (free):
 *   1. Create a free Cloudflare account.
 *   2. Workers & Pages → Create → Worker. Paste this file. Deploy.
 *   3. Copy the *.workers.dev URL into js/config.js → adpProxyUrl.
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    ...extra
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    const url = new URL(request.url);
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

    function json(obj, status) {
      return new Response(JSON.stringify(obj), {
        status, headers: cors({ "Content-Type": "application/json" })
      });
    }
  }
};
