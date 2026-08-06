/**
 * Dekont fotoğrafını küçültüp JPEG data URL üretir.
 * Aile paylaşımı (Firebase) için boyut sınırlı tutulur.
 */
(function (global) {
  const MAX_EDGE = 1280;
  const MAX_BYTES = 380 * 1024; // ~380KB data URL payload hedefi
  const QUALITIES = [0.72, 0.6, 0.48, 0.36];

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Fotoğraf okunamadı"));
      };
      img.src = url;
    });
  }

  function drawToCanvas(img, maxEdge) {
    let { width, height } = img;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  }

  function dataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return Math.ceil((b64.length * 3) / 4);
  }

  async function compressReceipt(file) {
    if (!file || !file.type.startsWith("image/")) {
      throw new Error("Lütfen bir fotoğraf seç");
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error("Fotoğraf çok büyük (max 12MB)");
    }

    const img = await loadImage(file);
    let edge = MAX_EDGE;
    let best = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const canvas = drawToCanvas(img, edge);
      for (const q of QUALITIES) {
        const dataUrl = canvas.toDataURL("image/jpeg", q);
        const bytes = dataUrlBytes(dataUrl);
        best = { dataUrl, bytes, width: canvas.width, height: canvas.height };
        if (bytes <= MAX_BYTES) {
          return best;
        }
      }
      edge = Math.round(edge * 0.75);
    }

    if (best && best.bytes <= 550 * 1024) return best;
    throw new Error("Dekont sıkıştırılamadı. Daha net/yakından tekrar dene.");
  }

  global.EdizImage = {
    compressReceipt,
    dataUrlBytes,
  };
})(window);
