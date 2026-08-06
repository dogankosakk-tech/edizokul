/**
 * Ediz Okul — arayüz ve uygulama mantığı
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const moneyTR = (n) =>
    Number(n || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const state = {
    room: null,
    unsubscribe: null,
    ratePreview: null,
    liveRate: null,
    liveRateLabel: "",
  };

  function show(el) {
    el?.classList.remove("hidden");
  }
  function hide(el) {
    el?.classList.add("hidden");
  }

  function toast(msg, type = "info") {
    const el = $("#toast");
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function setCloudBadge() {
    const badge = $("#cloudBadge");
    if (EdizStore.isCloudEnabled()) {
      badge.textContent = "Canlı paylaşım açık";
      badge.dataset.on = "1";
    } else {
      badge.textContent = "Yerel mod — paylaşım için kurulum";
      badge.dataset.on = "0";
    }
  }

  async function ensureLiveRate() {
    const hasLive = (state.room?.odemeler || []).some((p) => EdizStore.isLiveUsd(p));
    const addingLive =
      $('input[name="currency"]:checked')?.value === "USD" && $("#payLiveRate")?.checked;
    if (!hasLive && !addingLive && state.liveRate) return state.liveRate;
    try {
      const info = await EdizRates.getLiveUsdTry();
      state.liveRate = info.rate;
      state.liveRateLabel = info.label;
      return info.rate;
    } catch (e) {
      console.error(e);
      return state.liveRate;
    }
  }

  async function render() {
    const room = state.room;
    if (!room) return;

    const liveRate = await ensureLiveRate();
    const { toplanan, hedef, kalan, yuzde } = EdizStore.totals(room, liveRate);
    $("#brandTitle").textContent = room.baslik || "Ediz Okul Parası";
    $("#kalanTutar").textContent = moneyTR(kalan);
    $("#toplananTutar").textContent = moneyTR(toplanan);
    $("#hedefTutar").textContent = moneyTR(hedef);
    $("#progressFill").style.width = `${yuzde}%`;
    $("#progressLabel").textContent = `%${yuzde.toFixed(0)} tamamlandı`;
    $("#shareUrl").value = EdizStore.roomUrl(room.id);
    $("#hedefInput").value = hedef || "";

    let banner = $("#liveRateBanner");
    const hasLive = (room.odemeler || []).some((p) => EdizStore.isLiveUsd(p));
    if (hasLive && liveRate) {
      if (!banner) {
        banner = document.createElement("p");
        banner.id = "liveRateBanner";
        banner.className = "live-rate-banner";
        $("#progressLabel")?.after(banner);
      }
      banner.textContent = `Anlık kur: ${state.liveRateLabel || liveRate} (bozdurulmamış USD)`;
      show(banner);
    } else if (banner) {
      hide(banner);
    }

    const list = $("#paymentList");
    list.innerHTML = "";
    if (!room.odemeler?.length) {
      list.innerHTML = `<li class="empty">Henüz ödeme yok. İlk katkıyı sen ekle.</li>`;
    } else {
      for (const p of room.odemeler) {
        const li = document.createElement("li");
        li.className = "payment";
        const when = p.tarih
          ? new Date(p.tarih).toLocaleString("tr-TR", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        const live = EdizStore.isLiveUsd(p);
        const tl = EdizStore.paymentTl(p, liveRate);
        const rateShown = live && liveRate ? liveRate : p.kur;
        const raw =
          p.paraBirimi === "USD"
            ? `${moneyTR(p.tutar)} $ → ${moneyTR(tl)} ₺`
            : `${moneyTR(tl)} ₺`;
        li.innerHTML = `
          <div class="payment-main">
            <strong>${escapeHtml(p.ad)}</strong>
            <span class="meta">${escapeHtml(when)}${
              rateShown
                ? ` · kur ${Number(rateShown).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}`
                : ""
            }</span>
            ${
              live
                ? `<span class="pill">Anlık kur</span>`
                : p.kurKaynak
                  ? `<span class="source">${escapeHtml(p.kurKaynak)}</span>`
                  : ""
            }
          </div>
          <div class="payment-amount">
            <span>${raw}</span>
            <div class="row-actions">
              ${
                live
                  ? `<button type="button" class="btn ghost tiny" data-lock="${p.id}">Bozduruldu</button>`
                  : ""
              }
              <button type="button" class="icon-btn" data-del="${p.id}" aria-label="Sil">✕</button>
            </div>
          </div>`;
        list.appendChild(li);
      }
    }

    show($("#appScreen"));
    hide($("#welcomeScreen"));
    hide($("#setupScreen"));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function bindRoom(room) {
    if (state.unsubscribe) state.unsubscribe();
    state.room = room;
    const url = new URL(location.href);
    url.searchParams.set("oda", room.id);
    history.replaceState(null, "", url);
    state.unsubscribe = EdizStore.subscribe(
      room.id,
      (fresh) => {
        if (!fresh) return;
        if (!state.room || (fresh.version || 0) >= (state.room.version || 0)) {
          state.room = fresh;
          render();
        }
      },
      () => toast("Bağlantı koptu, yeniden deneniyor…", "warn")
    );
    await render();
    setCloudBadge();
  }

  async function boot() {
    setCloudBadge();
    const id = EdizStore.currentRoomId();
    if (id) {
      try {
        const room = await EdizStore.loadRoom(id);
        if (room) {
          await bindRoom(room);
          return;
        }
        toast("Oda bulunamadı. Yeni bir oda oluşturabilirsin.", "warn");
      } catch (e) {
        console.error(e);
        toast("Oda yüklenemedi: " + e.message, "error");
      }
    }
    show($("#welcomeScreen"));
    hide($("#appScreen"));
  }

  function defaultDateTimeLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  async function refreshRatePreview() {
    const currency = $('input[name="currency"]:checked')?.value || "TRY";
    const box = $("#rateBox");
    const liveLabel = $("#liveRateLabel");
    const live = $("#payLiveRate")?.checked;

    if (currency !== "USD") {
      hide(box);
      hide(liveLabel);
      state.ratePreview = null;
      updateTlPreview();
      return;
    }

    show(liveLabel);
    show(box);

    if (live) {
      hide($("#rateManualLabel"));
      $("#rateHint").textContent =
        "Bozdurulana kadar toplam her açılışta güncel TCMB kuruyla hesaplanır.";
      $("#rateStatus").textContent = "Anlık kur alınıyor…";
      try {
        const info = await EdizRates.getLiveUsdTry();
        state.ratePreview = info;
        state.liveRate = info.rate;
        state.liveRateLabel = info.label;
        $("#rateStatus").textContent = `Anlık · ${info.label}`;
        $("#rateManual").value = info.rate;
        updateTlPreview();
      } catch (e) {
        console.error(e);
        $("#rateStatus").textContent = "Kur alınamadı";
      }
      return;
    }

    show($("#rateManualLabel"));
    $("#rateHint").textContent = "Varsayılan: TCMB döviz alış. Farklıysa düzeltebilirsin.";
    $("#rateStatus").textContent = "Kur alınıyor…";
    const tarih = $("#payDate").value || defaultDateTimeLocal();
    try {
      const info = await EdizRates.getUsdTry(tarih);
      state.ratePreview = info;
      $("#rateStatus").textContent = info.label;
      $("#rateManual").value = info.rate;
      updateTlPreview();
    } catch (e) {
      console.error(e);
      $("#rateStatus").textContent = "Kur alınamadı — elle gir";
      state.ratePreview = null;
    }
  }

  function updateTlPreview() {
    const currency = $('input[name="currency"]:checked')?.value || "TRY";
    const amount = parseFloat($("#payAmount").value);
    const out = $("#tlPreview");
    if (!amount || amount <= 0) {
      out.textContent = "—";
      return;
    }
    if (currency === "TRY") {
      out.textContent = `${moneyTR(amount)} ₺`;
      return;
    }
    const rate = parseFloat($("#rateManual").value) || state.ratePreview?.rate || state.liveRate;
    if (!rate) {
      out.textContent = "Kur gerekli";
      return;
    }
    const suffix = $("#payLiveRate")?.checked ? " (anlık)" : "";
    out.textContent = `${moneyTR(EdizRates.usdToTry(amount, rate))} ₺${suffix}`;
  }

  function openSheet(id) {
    const el = $(id);
    el.showModal();
  }
  function closeSheet(id) {
    $(id)?.close();
  }

  function wire() {
    $("#btnCreate").addEventListener("click", async () => {
      const baslik = $("#newTitle").value.trim() || "Ediz Okul Parası";
      const hedef = parseFloat($("#newHedef").value) || 0;
      if (hedef <= 0) {
        toast("Hedef tutarı gir (₺)", "warn");
        return;
      }
      try {
        const room = await EdizStore.createRoom({ baslik, hedef });
        await bindRoom(room);
        if (EdizStore.isCloudEnabled()) {
          toast("Oda oluşturuldu. Linki ailenle paylaş!", "ok");
        } else {
          toast("Oda hazır. Aileyle paylaşmak için kurulumu aç.", "warn");
        }
      } catch (e) {
        toast(e.message, "error");
      }
    });

    $("#btnOpenSetup").addEventListener("click", openSetup);
    $("#btnOpenSetupFromApp")?.addEventListener("click", openSetup);

    function openSetup() {
      const fb = EdizStore.getFirebase();
      if (fb) {
        $("#fbApiKey").value = fb.apiKey || "";
        $("#fbAuthDomain").value = fb.authDomain || "";
        $("#fbDatabaseURL").value = fb.databaseURL || "";
        $("#fbProjectId").value = fb.projectId || "";
      }
      hide($("#welcomeScreen"));
      hide($("#appScreen"));
      show($("#setupScreen"));
    }

    $("#btnSetupBack").addEventListener("click", () => {
      hide($("#setupScreen"));
      if (state.room) show($("#appScreen"));
      else show($("#welcomeScreen"));
    });

    $("#btnSaveFb").addEventListener("click", async () => {
      try {
        EdizStore.saveFirebaseConfig({
          apiKey: $("#fbApiKey").value,
          authDomain: $("#fbAuthDomain").value,
          databaseURL: $("#fbDatabaseURL").value,
          projectId: $("#fbProjectId").value,
        });
        setCloudBadge();
        if (state.room) {
          // Yereldeki odayı buluta taşı
          state.room = await EdizStore.saveRoom(state.room);
          await bindRoom(state.room);
          toast("Canlı paylaşım açıldı — oda buluta taşındı", "ok");
          hide($("#setupScreen"));
          show($("#appScreen"));
        } else {
          toast("Canlı paylaşım açıldı", "ok");
          hide($("#setupScreen"));
          show($("#welcomeScreen"));
        }
      } catch (e) {
        toast(e.message, "error");
      }
    });

    $("#btnCopyLink").addEventListener("click", async () => {
      const url = $("#shareUrl").value;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link kopyalandı", "ok");
      } catch {
        $("#shareUrl").select();
        toast("Linki elle kopyala", "warn");
      }
    });

    $("#btnShareNative").addEventListener("click", async () => {
      const url = $("#shareUrl").value;
      if (navigator.share) {
        try {
          await navigator.share({
            title: state.room?.baslik || "Ediz Okul",
            text: "Okul parası takip linki",
            url,
          });
        } catch (_) {}
      } else {
        $("#btnCopyLink").click();
      }
    });

    $("#btnAddPay").addEventListener("click", () => {
      $("#payName").value = "";
      $("#payAmount").value = "";
      $("#payDate").value = defaultDateTimeLocal();
      $('input[name="currency"][value="TRY"]').checked = true;
      if ($("#payLiveRate")) $("#payLiveRate").checked = true;
      $("#rateManual").value = "";
      hide($("#rateBox"));
      hide($("#liveRateLabel"));
      $("#tlPreview").textContent = "—";
      openSheet("#payDialog");
    });

    $("#btnEditHedef").addEventListener("click", () => {
      $("#hedefInput").value = state.room?.hedef || "";
      openSheet("#hedefDialog");
    });

    $$('input[name="currency"]').forEach((el) =>
      el.addEventListener("change", refreshRatePreview)
    );
    $("#payLiveRate")?.addEventListener("change", refreshRatePreview);
    $("#payDate").addEventListener("change", refreshRatePreview);
    $("#payAmount").addEventListener("input", updateTlPreview);
    $("#rateManual").addEventListener("input", updateTlPreview);

    $("#payForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.room) return;
      const ad = $("#payName").value.trim();
      const tutar = parseFloat($("#payAmount").value);
      const paraBirimi = $('input[name="currency"]:checked').value;
      const tarih = $("#payDate").value;
      const liveMode = paraBirimi === "USD" && $("#payLiveRate")?.checked;
      if (!tutar || tutar <= 0) {
        toast("Geçerli tutar gir", "warn");
        return;
      }

      let kur = null;
      let kurKaynak = null;
      let tlKarsilik = tutar;
      let kurModu = "sabit";

      if (paraBirimi === "USD") {
        kur = parseFloat($("#rateManual").value) || state.liveRate;
        if (!kur || kur <= 0) {
          toast("USD için kur gerekli", "warn");
          return;
        }
        tlKarsilik = EdizRates.usdToTry(tutar, kur);
        if (liveMode) {
          kurModu = "canli";
          kurKaynak = `Anlık kur · ${state.liveRateLabel || kur}`;
        } else {
          kurModu = "sabit";
          kurKaynak = state.ratePreview?.label || `Elle girilen kur · ${kur}`;
          if (state.ratePreview && Math.abs(state.ratePreview.rate - kur) > 0.0001) {
            kurKaynak = `Elle düzeltildi · ${kur.toLocaleString("tr-TR", {
              maximumFractionDigits: 4,
            })}`;
          }
        }
      }

      try {
        const room = await EdizStore.addPayment(state.room, {
          ad,
          tutar,
          paraBirimi,
          tarih,
          kur,
          kurKaynak,
          kurModu,
          tlKarsilik,
        });
        state.room = room;
        await render();
        closeSheet("#payDialog");
        toast(liveMode ? "USD eklendi (anlık kur)" : "Ödeme eklendi", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("#hedefForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const hedef = parseFloat($("#hedefInput").value) || 0;
      try {
        state.room = await EdizStore.updateHedef(state.room, hedef);
        await render();
        closeSheet("#hedefDialog");
        toast("Hedef güncellendi", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("#paymentList").addEventListener("click", async (e) => {
      const lockBtn = e.target.closest("[data-lock]");
      if (lockBtn) {
        const id = lockBtn.getAttribute("data-lock");
        try {
          const info = await EdizRates.getLiveUsdTry();
          const payment = state.room.odemeler.find((p) => p.id === id);
          if (!payment) return;
          const tl = EdizRates.usdToTry(payment.tutar, info.rate);
          if (
            !confirm(
              `Bu USD ödemeyi bozduruldu sayıp kuru sabitlemek istiyor musun?\n${info.label}`
            )
          ) {
            return;
          }
          state.room = await EdizStore.lockPaymentRate(state.room, id, {
            kur: info.rate,
            kurKaynak: `Bozduruldu · ${info.label}`,
            tlKarsilik: tl,
          });
          await render();
          toast("Kur sabitlendi", "ok");
        } catch (err) {
          toast(err.message, "error");
        }
        return;
      }

      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      const id = btn.getAttribute("data-del");
      if (!confirm("Bu ödemeyi silmek istiyor musun?")) return;
      try {
        state.room = await EdizStore.removePayment(state.room, id);
        await render();
        toast("Ödeme silindi", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("#btnExport").addEventListener("click", () => {
      if (!state.room) return;
      const blob = new Blob([EdizStore.exportJson(state.room)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ediz-okul-${state.room.id}.json`;
      a.click();
    });

    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const room = await EdizStore.importJson(text);
        await bindRoom(room);
        toast("Yedek yüklendi", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
      e.target.value = "";
    });

    $$("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-close");
        closeSheet(id);
      })
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    boot();
  });
})();
