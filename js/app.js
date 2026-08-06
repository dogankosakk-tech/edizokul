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

  const moneyUSD = (n) =>
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
    editingId: null,
    pendingFoto: null,
    fotoRemoved: false,
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

  function tlToUsd(tl, rate) {
    if (!rate) return null;
    return Math.round((tl / rate) * 100) / 100;
  }

  function setPhotoPreview(dataUrl) {
    const wrap = $("#photoPreviewWrap");
    const img = $("#photoPreview");
    const clearBtn = $("#btnClearPhoto");
    if (dataUrl) {
      img.src = dataUrl;
      show(wrap);
      show(clearBtn);
    } else {
      img.removeAttribute("src");
      hide(wrap);
      hide(clearBtn);
    }
  }

  function clearPhotoInputs() {
    if ($("#payPhoto")) $("#payPhoto").value = "";
    if ($("#payPhotoCam")) $("#payPhotoCam").value = "";
  }

  async function handlePhotoFile(file) {
    if (!file) return;
    $("#photoStatus").textContent = "Sıkıştırılıyor…";
    try {
      const result = await EdizImage.compressReceipt(file);
      state.pendingFoto = result.dataUrl;
      state.fotoRemoved = false;
      setPhotoPreview(result.dataUrl);
      const kb = Math.round(result.bytes / 1024);
      $("#photoStatus").textContent = `Dekont hazır (~${kb} KB)`;
    } catch (e) {
      toast(e.message, "error");
      $("#photoStatus").textContent = "";
    } finally {
      clearPhotoInputs();
    }
  }

  async function ensureLiveRate(force = false) {
    if (!force && state.liveRate) return state.liveRate;
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

  function resetPayForm() {
    state.editingId = null;
    state.pendingFoto = null;
    state.fotoRemoved = false;
    $("#payEditId").value = "";
    $("#payDialogTitle").textContent = "Ödeme ekle";
    $("#paySubmitBtn").textContent = "Kaydet";
    $("#payName").value = "";
    $("#payAmount").value = "";
    $("#payDate").value = defaultDateTimeLocal();
    $('input[name="currency"][value="TRY"]').checked = true;
    if ($("#payLiveRate")) $("#payLiveRate").checked = true;
    $("#rateManual").value = "";
    hide($("#rateBox"));
    hide($("#liveRateLabel"));
    $("#tlPreview").textContent = "—";
    $("#photoStatus").textContent = "";
    setPhotoPreview(null);
    clearPhotoInputs();
  }

  async function openEditPayment(payment) {
    state.editingId = payment.id;
    state.pendingFoto = null;
    state.fotoRemoved = false;
    $("#payEditId").value = payment.id;
    $("#payDialogTitle").textContent = "Ödemeyi düzenle";
    $("#paySubmitBtn").textContent = "Güncelle";
    $("#payName").value = payment.ad || "";
    $("#payAmount").value = payment.tutar;
    $("#payDate").value = payment.tarih
      ? String(payment.tarih).slice(0, 16)
      : defaultDateTimeLocal();
    $(`input[name="currency"][value="${payment.paraBirimi === "USD" ? "USD" : "TRY"}"]`).checked =
      true;
    if ($("#payLiveRate")) {
      $("#payLiveRate").checked = EdizStore.isLiveUsd(payment);
    }
    if (payment.kur) $("#rateManual").value = payment.kur;
    if (payment.foto) {
      setPhotoPreview(payment.foto);
      $("#photoStatus").textContent = "Mevcut dekont";
    } else {
      setPhotoPreview(null);
      $("#photoStatus").textContent = "";
    }
    openSheet("#payDialog");
    await refreshRatePreview();
    updateTlPreview();
  }

  async function render() {
    const room = state.room;
    if (!room) return;

    const liveRate = await ensureLiveRate(true);
    const { toplanan, hedef, kalan, yuzde } = EdizStore.totals(room, liveRate);
    const kalanUsd = tlToUsd(kalan, liveRate);
    const hedefUsd = tlToUsd(hedef, liveRate);
    const toplananUsd = tlToUsd(toplanan, liveRate);

    $("#brandTitle").textContent = room.baslik || "Ediz Okul Parası";
    $("#kalanTutar").textContent = `${moneyTR(kalan)} ₺`;
    $("#kalanUsd").textContent =
      kalanUsd == null ? "Kur yükleniyor…" : `≈ ${moneyUSD(kalanUsd)} $`;
    $("#hedefTutar").textContent = `${moneyTR(hedef)} ₺`;
    $("#hedefUsd").textContent =
      hedefUsd == null ? "" : `· ${moneyUSD(hedefUsd)} $`;
    $("#toplananTutar").textContent = `${moneyTR(toplanan)} ₺`;
    $("#toplananUsd").textContent =
      toplananUsd == null ? "" : `· ${moneyUSD(toplananUsd)} $`;
    $("#progressFill").style.width = `${yuzde}%`;
    $("#progressLabel").textContent = `%${yuzde.toFixed(0)} tamamlandı`;
    $("#hedefInput").value = hedef || "";
    show($("#btnCopyLink"));

    let banner = $("#liveRateBanner");
    const hasLive = (room.odemeler || []).some((p) => EdizStore.isLiveUsd(p));
    if (hasLive && liveRate) {
      if (!banner) {
        banner = document.createElement("p");
        banner.id = "liveRateBanner";
        banner.className = "live-rate-banner";
        $("#progressLabel")?.after(banner);
      }
      banner.textContent = `Anlık kur: ${state.liveRateLabel || liveRate}`;
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
                ? ` · kur ${Number(rateShown).toLocaleString("tr-TR", {
                    maximumFractionDigits: 4,
                  })}`
                : ""
            }</span>
            ${
              live
                ? `<span class="pill">Anlık kur</span>`
                : p.kurKaynak
                  ? `<span class="source">${escapeHtml(p.kurKaynak)}</span>`
                  : ""
            }
            ${
              p.foto
                ? `<button type="button" class="dekont-thumb" data-photo="${p.id}" aria-label="Dekontu gör">
                    <img src="${p.foto}" alt="Dekont" />
                  </button>`
                : ""
            }
          </div>
          <div class="payment-amount">
            <span>${raw}</span>
            <div class="row-actions">
              <button type="button" class="btn ghost tiny" data-edit="${p.id}">Düzenle</button>
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
  }

  async function boot() {
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
    hide($("#btnCopyLink"));
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
    $(id).showModal();
  }
  function closeSheet(id) {
    $(id)?.close();
  }

  function buildPaymentPayload() {
    const ad = $("#payName").value.trim();
    const tutar = parseFloat($("#payAmount").value);
    const paraBirimi = $('input[name="currency"]:checked').value;
    const tarih = $("#payDate").value;
    const liveMode = paraBirimi === "USD" && $("#payLiveRate")?.checked;
    if (!tutar || tutar <= 0) {
      toast("Geçerli tutar gir", "warn");
      return null;
    }

    let kur = null;
    let kurKaynak = null;
    let tlKarsilik = tutar;
    let kurModu = "sabit";

    if (paraBirimi === "USD") {
      kur = parseFloat($("#rateManual").value) || state.liveRate;
      if (!kur || kur <= 0) {
        toast("USD için kur gerekli", "warn");
        return null;
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

    let foto;
    if (state.pendingFoto) foto = state.pendingFoto;
    else if (state.fotoRemoved) foto = null;
    else if (state.editingId) foto = undefined; // mevcut kalsın
    else foto = null;

    return {
      ad,
      tutar,
      paraBirimi,
      tarih,
      kur,
      kurKaynak,
      kurModu,
      tlKarsilik,
      foto,
      liveMode,
    };
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
          toast("Oda oluşturuldu. Linki kopyala ikonuyla paylaş.", "ok");
        } else {
          toast("Oda hazır. Aileyle paylaşmak için kurulumu aç.", "warn");
        }
      } catch (e) {
        toast(e.message, "error");
      }
    });

    $("#btnOpenSetup").addEventListener("click", openSetup);

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
        if (state.room) {
          state.room = await EdizStore.saveRoom(state.room);
          await bindRoom(state.room);
          toast("Paylaşım açıldı", "ok");
          hide($("#setupScreen"));
          show($("#appScreen"));
        } else {
          toast("Paylaşım açıldı", "ok");
          hide($("#setupScreen"));
          show($("#welcomeScreen"));
        }
      } catch (e) {
        toast(e.message, "error");
      }
    });

    $("#btnCopyLink").addEventListener("click", async () => {
      if (!state.room) return;
      const url = EdizStore.roomUrl(state.room.id);
      try {
        await navigator.clipboard.writeText(url);
        toast("Link kopyalandı", "ok");
      } catch {
        toast("Link kopyalanamadı", "warn");
      }
    });

    $("#btnAddPay").addEventListener("click", () => {
      resetPayForm();
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
      const payload = buildPaymentPayload();
      if (!payload) return;
      const { liveMode, ...payment } = payload;

      try {
        if (state.editingId) {
          state.room = await EdizStore.updatePayment(state.room, state.editingId, payment);
          toast("Ödeme güncellendi", "ok");
        } else {
          state.room = await EdizStore.addPayment(state.room, payment);
          toast(liveMode ? "USD eklendi (anlık kur)" : "Ödeme eklendi", "ok");
        }
        resetPayForm();
        await render();
        closeSheet("#payDialog");
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
      const photoBtn = e.target.closest("[data-photo]");
      if (photoBtn) {
        const id = photoBtn.getAttribute("data-photo");
        const payment = state.room.odemeler.find((p) => p.id === id);
        if (payment?.foto) {
          $("#photoViewerImg").src = payment.foto;
          openSheet("#photoDialog");
        }
        return;
      }

      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        const id = editBtn.getAttribute("data-edit");
        const payment = state.room.odemeler.find((p) => p.id === id);
        if (payment) await openEditPayment(payment);
        return;
      }

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

    $("#payPhoto")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      handlePhotoFile(file);
    });
    $("#payPhotoCam")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      handlePhotoFile(file);
    });
    $("#btnClearPhoto")?.addEventListener("click", () => {
      state.pendingFoto = null;
      state.fotoRemoved = true;
      setPhotoPreview(null);
      $("#photoStatus").textContent = "Dekont kaldırıldı";
      clearPhotoInputs();
    });

    $$("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-close");
        closeSheet(id);
        if (id === "#payDialog") resetPayForm();
        if (id === "#photoDialog") $("#photoViewerImg").removeAttribute("src");
      })
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    boot();
  });
})();
