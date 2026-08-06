/**
 * Paylaşımlı oda depolama
 * - Firebase: config.js VEYA yerel kayıt VEYA linkteki fb parametresi
 * - Yoksa: localStorage (cihaz lokal) + JSON yedek
 */
(function (global) {
  const LOCAL_PREFIX = "edizokul:oda:";
  const META_KEY = "edizokul:meta";
  const FB_KEY = "edizokul:firebase";

  function uid(len = 10) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  function paymentId() {
    return "p_" + uid(8);
  }

  function emptyRoom(overrides = {}) {
    return {
      id: overrides.id || uid(10),
      baslik: overrides.baslik || "Ediz Okul Parası",
      hedef: overrides.hedef ?? 0,
      odemeler: overrides.odemeler || [],
      olusturma: overrides.olusturma || new Date().toISOString(),
      guncelleme: overrides.guncelleme || new Date().toISOString(),
      version: 1,
    };
  }

  function normalizeFirebase(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    const apiKey = String(cfg.apiKey || "").trim();
    const databaseURL = String(cfg.databaseURL || "").trim().replace(/\/$/, "");
    if (!apiKey || !databaseURL || apiKey.startsWith("BURAYA")) return null;
    return {
      apiKey,
      authDomain: String(cfg.authDomain || "").trim(),
      databaseURL,
      projectId: String(cfg.projectId || "").trim(),
    };
  }

  function loadStoredFirebase() {
    try {
      return normalizeFirebase(JSON.parse(localStorage.getItem(FB_KEY) || "null"));
    } catch {
      return null;
    }
  }

  function saveFirebaseConfig(cfg) {
    const normalized = normalizeFirebase(cfg);
    if (!normalized) throw new Error("Geçersiz Firebase bilgisi");
    localStorage.setItem(FB_KEY, JSON.stringify(normalized));
    if (!global.EDIZ_CONFIG) global.EDIZ_CONFIG = {};
    global.EDIZ_CONFIG.firebase = normalized;
    return normalized;
  }

  function encodeFb(cfg) {
    const compact = [cfg.apiKey, cfg.authDomain || "", cfg.databaseURL, cfg.projectId || ""].join("\n");
    return btoa(unescape(encodeURIComponent(compact)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function decodeFb(token) {
    try {
      const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
      const raw = decodeURIComponent(
        escape(atob(token.replace(/-/g, "+").replace(/_/g, "/") + pad))
      );
      const [apiKey, authDomain, databaseURL, projectId] = raw.split("\n");
      return normalizeFirebase({ apiKey, authDomain, databaseURL, projectId });
    } catch {
      return null;
    }
  }

  /** Linkteki fb= parametresini uygula (aile üyeleri için) */
  function ingestFirebaseFromUrl() {
    const u = new URL(global.location.href);
    const token = u.searchParams.get("fb");
    if (!token) return false;
    const cfg = decodeFb(token);
    if (!cfg) return false;
    saveFirebaseConfig(cfg);
    return true;
  }

  function bootstrapFirebase() {
    ingestFirebaseFromUrl();
    const fromFile = normalizeFirebase(global.EDIZ_CONFIG?.firebase);
    const fromLocal = loadStoredFirebase();
    const cfg = fromFile || fromLocal;
    if (cfg) {
      if (!global.EDIZ_CONFIG) global.EDIZ_CONFIG = {};
      global.EDIZ_CONFIG.firebase = cfg;
    }
    return cfg;
  }

  function getFirebase() {
    return normalizeFirebase(global.EDIZ_CONFIG?.firebase) || loadStoredFirebase();
  }

  function isCloudEnabled() {
    return !!getFirebase();
  }

  function roomUrl(id) {
    const u = new URL(global.location.href);
    u.searchParams.set("oda", id);
    const fb = getFirebase();
    if (fb) u.searchParams.set("fb", encodeFb(fb));
    else u.searchParams.delete("fb");
    u.hash = "";
    return u.toString();
  }

  function currentRoomId() {
    const u = new URL(global.location.href);
    return u.searchParams.get("oda") || null;
  }

  function saveLocal(room) {
    localStorage.setItem(LOCAL_PREFIX + room.id, JSON.stringify(room));
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    meta.lastRoom = room.id;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function loadLocal(id) {
    const raw = localStorage.getItem(LOCAL_PREFIX + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function firebaseGet(path) {
    const fb = getFirebase();
    const url = `${fb.databaseURL}/${path}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Firebase okuma hatası: " + res.status);
    return res.json();
  }

  async function firebasePut(path, data) {
    const fb = getFirebase();
    const url = `${fb.databaseURL}/${path}.json`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Firebase yazma hatası: " + res.status);
    return res.json();
  }

  function subscribe(roomId, onData, onError) {
    const fb = getFirebase();
    if (!fb) {
      const handler = (e) => {
        if (e.key === LOCAL_PREFIX + roomId && e.newValue) {
          try {
            onData(JSON.parse(e.newValue));
          } catch (_) {}
        }
      };
      global.addEventListener("storage", handler);
      const interval = setInterval(() => {
        const r = loadLocal(roomId);
        if (r) onData(r);
      }, 2500);
      return () => {
        global.removeEventListener("storage", handler);
        clearInterval(interval);
      };
    }

    const url = `${fb.databaseURL}/rooms/${roomId}.json`;
    const es = new EventSource(url);
    es.addEventListener("put", (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.data) onData(payload.data);
      } catch (e) {
        onError?.(e);
      }
    });
    es.addEventListener("patch", async () => {
      try {
        const fresh = await firebaseGet(`rooms/${roomId}`);
        if (fresh) onData(fresh);
      } catch (e) {
        onError?.(e);
      }
    });
    es.onerror = (e) => onError?.(e);
    return () => es.close();
  }

  async function createRoom({ baslik, hedef } = {}) {
    const room = emptyRoom({ baslik, hedef: Number(hedef) || 0 });
    if (isCloudEnabled()) {
      await firebasePut(`rooms/${room.id}`, room);
    } else {
      saveLocal(room);
    }
    return room;
  }

  async function loadRoom(id) {
    if (isCloudEnabled()) {
      const data = await firebaseGet(`rooms/${id}`);
      if (!data) return null;
      saveLocal(data);
      return data;
    }
    return loadLocal(id);
  }

  async function saveRoom(room) {
    room.guncelleme = new Date().toISOString();
    room.version = (room.version || 0) + 1;
    if (isCloudEnabled()) {
      await firebasePut(`rooms/${room.id}`, room);
    }
    saveLocal(room);
    return room;
  }

  /** USD ve kurModu yoksa canli say (henüz bozdurulmamış) */
  function isLiveUsd(payment) {
    if (payment.paraBirimi !== "USD") return false;
    if (payment.kurModu === "sabit") return false;
    return payment.kurModu === "canli" || payment.kurModu == null;
  }

  function paymentTl(payment, liveRate) {
    if (isLiveUsd(payment) && liveRate) {
      return Math.round(Number(payment.tutar) * liveRate * 100) / 100;
    }
    return Number(payment.tlKarsilik) || 0;
  }

  async function addPayment(room, payment) {
    const p = {
      id: paymentId(),
      ad: payment.ad?.trim() || "Anonim",
      tutar: Number(payment.tutar),
      paraBirimi: payment.paraBirimi === "USD" ? "USD" : "TRY",
      tarih: payment.tarih,
      kur: payment.kur ?? null,
      kurKaynak: payment.kurKaynak ?? null,
      kurModu: payment.kurModu || (payment.paraBirimi === "USD" ? "canli" : "sabit"),
      tlKarsilik: Number(payment.tlKarsilik),
      not: payment.not || "",
      eklenme: new Date().toISOString(),
    };
    room.odemeler = [p, ...(room.odemeler || [])];
    return saveRoom(room);
  }

  async function updatePayment(room, paymentId, payment) {
    const idx = (room.odemeler || []).findIndex((p) => p.id === paymentId);
    if (idx < 0) throw new Error("Ödeme bulunamadı");
    const prev = room.odemeler[idx];
    room.odemeler[idx] = {
      ...prev,
      ad: payment.ad?.trim() || "Anonim",
      tutar: Number(payment.tutar),
      paraBirimi: payment.paraBirimi === "USD" ? "USD" : "TRY",
      tarih: payment.tarih,
      kur: payment.kur ?? null,
      kurKaynak: payment.kurKaynak ?? null,
      kurModu: payment.kurModu || (payment.paraBirimi === "USD" ? "canli" : "sabit"),
      tlKarsilik: Number(payment.tlKarsilik),
      not: payment.not || prev.not || "",
      guncelleme: new Date().toISOString(),
    };
    return saveRoom(room);
  }

  async function removePayment(room, paymentIdToRemove) {
    room.odemeler = (room.odemeler || []).filter((p) => p.id !== paymentIdToRemove);
    return saveRoom(room);
  }

  /** Bozduruldu: anlık kuru sabitle */
  async function lockPaymentRate(room, paymentId, { kur, kurKaynak, tlKarsilik }) {
    room.odemeler = (room.odemeler || []).map((p) => {
      if (p.id !== paymentId) return p;
      return {
        ...p,
        kurModu: "sabit",
        kur,
        kurKaynak,
        tlKarsilik,
        bozdurma: new Date().toISOString(),
      };
    });
    return saveRoom(room);
  }

  async function updateHedef(room, hedef) {
    room.hedef = Number(hedef) || 0;
    return saveRoom(room);
  }

  function totals(room, liveRate) {
    const toplanan = (room.odemeler || []).reduce(
      (s, p) => s + paymentTl(p, liveRate),
      0
    );
    const hedef = Number(room.hedef) || 0;
    const kalan = Math.max(0, hedef - toplanan);
    const yuzde = hedef > 0 ? Math.min(100, (toplanan / hedef) * 100) : 0;
    return { toplanan, hedef, kalan, yuzde };
  }

  function exportJson(room) {
    return JSON.stringify(room, null, 2);
  }

  async function importJson(text) {
    const data = JSON.parse(text);
    if (!data || !data.id || !Array.isArray(data.odemeler)) {
      throw new Error("Geçersiz yedek dosyası");
    }
    return saveRoom(data);
  }

  // İlk yüklemede config’i hazırla
  bootstrapFirebase();

  global.EdizStore = {
    uid,
    emptyRoom,
    isCloudEnabled,
    roomUrl,
    currentRoomId,
    createRoom,
    loadRoom,
    saveRoom,
    addPayment,
    updatePayment,
    removePayment,
    lockPaymentRate,
    updateHedef,
    subscribe,
    totals,
    isLiveUsd,
    paymentTl,
    exportJson,
    importJson,
    getFirebase,
    saveFirebaseConfig,
    bootstrapFirebase,
    ingestFirebaseFromUrl,
  };
})(window);
