// ============================================================
// GRIDIRON COMMAND — deployment configuration
// Edit this ONE file to configure your store, licensing, and data proxy.
// ============================================================
const CONFIG = {

  // ---- Product ----
  appVersion: "1.0.0",
  dataYear: 2026,               // default ADP season to sync

  // ---- Licensing (Lemon Squeezy) ----------------------------------------
  // Set requireLicense: true before you sell. When true, users must enter a
  // valid license key (issued by Lemon Squeezy) to use the app. Activation
  // is verified live against the Lemon Squeezy API (CORS-enabled), and the
  // activated instance is re-validated periodically.
  license: {
    requireLicense: false,      // <-- flip to true for production builds
    storeId: null,              // your Lemon Squeezy store id (number), optional check
    productId: null,            // your product id (number), optional check
    revalidateDays: 3,          // how often to re-check a key online
    graceDays: 7,               // allow offline use this many days if revalidation fails
    buyUrl: "https://YOURSTORE.lemonsqueezy.com/buy/YOUR-PRODUCT",
    // Dev bypass: only works while requireLicense is false OR devUnlockCode matches.
    // Leave null in production. This lets you test a "licensed" build without a key.
    devUnlockCode: "GRIDIRON-DEV"
  },

  // ---- FantasyPros -------------------------------------------------------
  // Expert-consensus rankings (ECR) from api.fantasypros.com. The FP API
  // rejects browser CORS preflights, so all requests go through a proxy.
  // NEVER put a real key in this committed file.
  // FP standard keys are PERSONAL, NON-COMMERCIAL only (1 req/s, 500/day,
  // caching required — the app caches 6h per format automatically).
  //   1. Local/personal use: leave proxyUrl "" — the app falls back to
  //      same-origin /fp (dev server proxies with your gitignored key).
  //   2. Selling: point this at the worker /fp URL, but buyers must paste
  //      THEIR OWN keys (forwarded, never stored). Do not put your key on
  //      a worker that serves customers — that violates FP's terms.
  fantasyPros: {
    proxyUrl: ""              // e.g. "https://gridiron-adp.YOURNAME.workers.dev/fp"
  },

  // ---- Live ADP proxy ----------------------------------------------------
  // FantasyFootballCalculator's ADP API has current data but no CORS header,
  // so browsers can't call it directly. Deploy the tiny Cloudflare Worker in
  // /worker (free) and paste its URL here to enable one-click "Sync Live ADP".
  // Leave "" to hide the sync button and rely on CSV import + the built-in board.
  adpProxyUrl: "",              // e.g. "https://gridiron-adp.YOURNAME.workers.dev"

  // The upstream the worker fetches (the worker appends ?format=&teams=&year=)
  adpUpstream: "https://fantasyfootballcalculator.com/api/v1/adp"
};
