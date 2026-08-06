/**
 * TCMB USD/TRY kur servisi
 * Öncelik: yerel rates/*.json (GitHub Actions ile güncellenir)
 * Yedek: Jina üzerinden TCMB XML, sonra currency-api
 * Dönüşümde ForexBuying (döviz alış) kullanılır — Google orta piyasadan daha gerçekçi.
 */
(function (global) {
  const cache = new Map();
  const BASE = new URL(".", global.location.href).pathname.replace(/\/?$/, "/");

  function toISODate(input) {
    if (!input) return new Date().toISOString().slice(0, 10);
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}/.test(input)) {
      return input.slice(0, 10);
    }
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return tz.toISOString().slice(0, 10);
  }

  function prevDay(iso) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function fromLocal(iso) {
    return fetchJson(`${BASE}rates/${iso}.json`);
  }

  async function fromLatestLocal() {
    return fetchJson(`${BASE}rates/latest.json`);
  }

  function parseTcmbXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML parse error");
    const root = doc.querySelector("Tarih_Date");
    const currencies = [...doc.querySelectorAll("Currency")];
    const usdNode = currencies.find((c) => c.getAttribute("CurrencyCode") === "USD");
    if (!usdNode) throw new Error("USD yok");
    const num = (tag) => parseFloat(usdNode.querySelector(tag)?.textContent || "0");
    const usd = {
      unit: num("Unit") || 1,
      forexBuying: num("ForexBuying"),
      forexSelling: num("ForexSelling"),
      banknoteBuying: num("BanknoteBuying"),
      banknoteSelling: num("BanknoteSelling"),
    };
    return {
      source: "TCMB",
      date: null,
      tcmbDate: root?.getAttribute("Tarih") || null,
      bulletin: root?.getAttribute("Bulten_No") || null,
      usd,
      rateUsed: "forexBuying",
      usdTry: usd.forexBuying,
    };
  }

  async function fromTcmbDirect(iso) {
    const [y, m, d] = iso.split("-");
    const url = `https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`;
    // Jina reader CORS-friendly; XML içeriğini markdown olarak döner, ham XML için alternatif dene
    const proxies = [
      url,
      `https://r.jina.ai/${url}`,
    ];
    let lastErr;
    for (const p of proxies) {
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        if (text.includes("<ForexBuying>") || text.includes("ForexBuying")) {
          // ham XML veya içinde XML parçası
          const start = text.indexOf("<?xml");
          const xml = start >= 0 ? text.slice(start) : text;
          if (xml.includes("<Currency")) {
            const data = parseTcmbXml(xml);
            data.date = iso;
            return data;
          }
        }
        // Jina markdown: satır satır 47.4881 gibi
        const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
        const idx = lines.findIndex((l) => /ABD DOLARI|US DOLLAR/i.test(l));
        if (idx >= 0) {
          const nums = [];
          for (let i = idx; i < Math.min(idx + 12, lines.length); i++) {
            const m = lines[i].match(/^(\d+[.,]\d+)$/);
            if (m) nums.push(parseFloat(m[1].replace(",", ".")));
          }
          if (nums.length >= 2) {
            const usd = {
              unit: 1,
              forexBuying: nums[0],
              forexSelling: nums[1],
              banknoteBuying: nums[2] || nums[0],
              banknoteSelling: nums[3] || nums[1],
            };
            return {
              source: "TCMB",
              date: iso,
              tcmbDate: null,
              bulletin: null,
              usd,
              rateUsed: "forexBuying",
              usdTry: usd.forexBuying,
              via: "jina",
            };
          }
        }
        throw new Error("parse failed");
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("TCMB alınamadı");
  }

  async function fromCurrencyApi(iso) {
    const urls = [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${iso}/v1/currencies/usd.min.json`,
      `https://${iso}.currency-api.pages.dev/v1/currencies/usd.min.json`,
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json`,
      `https://latest.currency-api.pages.dev/v1/currencies/usd.min.json`,
    ];
    let lastErr;
    for (const url of urls) {
      try {
        const data = await fetchJson(url);
        const rate = data?.usd?.try;
        if (!rate) throw new Error("try yok");
        return {
          source: "currency-api",
          date: data.date || iso,
          tcmbDate: null,
          bulletin: null,
          usd: {
            unit: 1,
            forexBuying: rate,
            forexSelling: rate,
            banknoteBuying: rate,
            banknoteSelling: rate,
          },
          rateUsed: "mid",
          usdTry: rate,
          note: "Orta piyasa kuru (TCMB yedeği)",
        };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("currency-api alınamadı");
  }

  async function resolveForDate(iso) {
    const today = toISODate(new Date());
    let cursor = iso > today ? today : iso;
    // Hafta sonu / tatil: en fazla 10 gün geriye bak
    for (let i = 0; i < 10; i++) {
      const key = cursor;
      if (cache.has(key)) return cache.get(key);

      // 1) Yerel önbellek
      try {
        const local = await fromLocal(cursor);
        cache.set(key, local);
        return local;
      } catch (_) {}

      // 2) TCMB (doğrudan / proxy)
      try {
        const tcmb = await fromTcmbDirect(cursor);
        cache.set(key, tcmb);
        return tcmb;
      } catch (_) {}

      cursor = prevDay(cursor);
    }

    // 3) latest local
    try {
      const latest = await fromLatestLocal();
      cache.set(iso, latest);
      return latest;
    } catch (_) {}

    // 4) currency-api
    const fallback = await fromCurrencyApi(iso);
    cache.set(iso, fallback);
    return fallback;
  }

  async function getUsdTry(dateInput) {
    const iso = toISODate(dateInput);
    const data = await resolveForDate(iso);
    return {
      iso,
      rate: data.usdTry,
      source: data.source,
      rateUsed: data.rateUsed,
      detail: data,
      label: formatRateLabel(data),
    };
  }

  function formatRateLabel(data) {
    const r = Number(data.usdTry).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    if (data.source === "TCMB") {
      return `TCMB döviz alış · ${r} ₺`;
    }
    return `${data.source} · ${r} ₺`;
  }

  function usdToTry(amountUsd, rate) {
    return Math.round(amountUsd * rate * 100) / 100;
  }

  global.EdizRates = {
    toISODate,
    getUsdTry,
    usdToTry,
    formatRateLabel,
  };
})(window);
