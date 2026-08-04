// ============================================================
// LICENSE GATE — Lemon Squeezy license keys
// The Lemon Squeezy license API is CORS-enabled, so activation and
// validation happen directly from the browser. On activation we store
// the returned instance id; we re-validate periodically and allow a
// short offline grace window.
// Docs: https://docs.lemonsqueezy.com/help/licensing
// ============================================================
const License = (function () {
  const LS_KEY = 'gridiron-license';
  const API = 'https://api.lemonsqueezy.com/v1/licenses';
  const cfg = CONFIG.license;

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
  function store(v) { localStorage.setItem(LS_KEY, JSON.stringify(v)); }
  function clear() { localStorage.removeItem(LS_KEY); }
  const now = () => Date.now();
  const days = n => n * 86400000;

  // Is the app unlocked right now (sync check, no network)?
  function isUnlocked() {
    if (!cfg.requireLicense) return true;
    const lic = load();
    if (!lic || !lic.key) return false;
    if (lic.devUnlock) return true;
    if (!lic.instanceId) return false;
    // within revalidate window → trust; past grace → lock
    const age = now() - (lic.lastValidated || 0);
    if (age <= days(cfg.revalidateDays)) return true;
    if (age <= days(cfg.revalidateDays + cfg.graceDays)) return true; // grace; background re-check will confirm
    return false;
  }

  function needsRevalidate() {
    const lic = load();
    if (!lic || lic.devUnlock) return false;
    return (now() - (lic.lastValidated || 0)) > days(cfg.revalidateDays);
  }

  async function api(path, key, extra) {
    const body = new URLSearchParams({ license_key: key, ...extra });
    const r = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    return r.json();
  }

  function optionalChecksPass(meta) {
    if (cfg.storeId && meta && meta.store_id && +meta.store_id !== +cfg.storeId) return false;
    if (cfg.productId && meta && meta.product_id && +meta.product_id !== +cfg.productId) return false;
    return true;
  }

  // Activate a fresh key on this device
  async function activate(key) {
    key = (key || '').trim();
    if (!key) return { ok: false, message: 'Enter a license key.' };

    // Dev bypass (only when explicitly configured)
    if (cfg.devUnlockCode && key === cfg.devUnlockCode) {
      store({ key, devUnlock: true, lastValidated: now() });
      return { ok: true, message: 'Developer unlock active.' };
    }

    let res;
    try {
      res = await api('activate', key, { instance_name: `Gridiron ${navigator.platform || 'web'} ${new Date().getFullYear()}` });
    } catch (e) {
      return { ok: false, message: 'Network error contacting license server. Check your connection.' };
    }
    if (!res || res.activated !== true) {
      const err = (res && (res.error || (res.license_key && res.license_key.status))) || 'Invalid or already-used license key.';
      return { ok: false, message: humanize(err) };
    }
    if (!optionalChecksPass(res.meta)) {
      return { ok: false, message: 'This key is for a different product.' };
    }
    store({
      key,
      instanceId: res.instance && res.instance.id,
      lastValidated: now(),
      customer: (res.meta && res.meta.customer_name) || null
    });
    return { ok: true, message: 'License activated. Enjoy the draft!' };
  }

  // Re-validate an already-activated key (called in background)
  async function revalidate() {
    const lic = load();
    if (!lic || !lic.key || lic.devUnlock) return true;
    let res;
    try { res = await api('validate', lic.key, lic.instanceId ? { instance_id: lic.instanceId } : {}); }
    catch { return true; } // offline: keep grace
    if (res && res.valid === true) {
      lic.lastValidated = now(); store(lic); return true;
    }
    // definitively invalid (revoked/refunded)
    clear();
    return false;
  }

  function humanize(s) {
    s = String(s);
    if (/not found/i.test(s)) return 'License key not found.';
    if (/activation limit/i.test(s)) return 'This key has reached its device activation limit. Deactivate another device or contact support.';
    if (/disabled|revoked/i.test(s)) return 'This license has been disabled.';
    if (/expired/i.test(s)) return 'This license has expired.';
    return s;
  }

  function customerName() { const l = load(); return l && l.customer; }
  function deactivateLocal() { clear(); }

  return { isUnlocked, needsRevalidate, activate, revalidate, customerName, deactivateLocal, buyUrl: cfg.buyUrl };
})();
