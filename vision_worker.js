// Dedicated Background Web Worker for MobileRaidSegmenterImpl + GeneralPostProcessor + EdgeSnapPostProcessor
// Runs TFLite WASM inference and 2-pass Sobel edge snapping completely off the main 120fps UI thread!

importScripts('extracted_assets/mediapipe/vision_bundle.js');

let screenElementDetector = null;
let commonObjectDetector = null;
let detectorsInitPromise = null;

async function initDetectors() {
  if (screenElementDetector && commonObjectDetector) return true;
  if (detectorsInitPromise) return detectorsInitPromise;
  detectorsInitPromise = (async () => {
    try {
      const fileset = await Vision.FilesetResolver.forVisionTasks('extracted_assets/mediapipe/wasm');
      // MobileRaidSegmenterImpl.java:40-44 & MobileRaidRectRetrieverModule.java:29, 46:
      // 1. MODEL_PATH_SCREEN_ELEMENT = "models/mobile_raid_v2_2_float32_finetuned_0804.tflite", threshold = 0.4f
      // 2. MODEL_PATH_COMMON_OBJECT  = "models/mobile_raid_common_object_33_int8_0730_w_metadata.tflite", threshold = 0.5f
      const [seDet, coDet] = await Promise.all([
        Vision.ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: 'extracted_assets/models/mobile_raid_v2_2_float32_finetuned_0804.tflite' },
          runningMode: 'IMAGE',
          scoreThreshold: 0.4
        }),
        Vision.ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: 'extracted_assets/models/mobile_raid_common_object_33_int8_0730_w_metadata.tflite' },
          runningMode: 'IMAGE',
          scoreThreshold: 0.5
        })
      ]);
      screenElementDetector = seDet;
      commonObjectDetector = coDet;

      // Pre-warm XNNPACK tensor arenas on a tiny 64x64 OffscreenCanvas so the first real screenshot has 0ms cold-start!
      if (typeof OffscreenCanvas !== 'undefined') {
        const warmupCanvas = new OffscreenCanvas(64, 64);
        const wctx = warmupCanvas.getContext('2d');
        wctx.fillStyle = '#000';
        wctx.fillRect(0, 0, 64, 64);
        const warmupBmp = warmupCanvas.transferToImageBitmap();
        screenElementDetector.detect(warmupBmp);
        commonObjectDetector.detect(warmupBmp);
        warmupBmp.close();
      }
      return true;
    } catch (err) {
      console.warn('Worker MobileRaid ObjectDetector init warning:', err);
      detectorsInitPromise = null;
      return false;
    }
  })();
  return detectorsInitPromise;
}

function generalPostProcess(aois, imgWidth, imgHeight) {
  if (!Array.isArray(aois) || aois.length === 0) return [];
  const isSingleAoi = aois.length === 1;
  const out = [];
  for (const aoi of aois) {
    const r = aoi.rect || aoi;
    const left = Math.max(1, Math.min(Math.round(r.x), imgWidth - 1));
    const top = Math.max(1, Math.min(Math.round(r.y), imgHeight - 1));
    const right = Math.max(1, Math.min(Math.round(r.x + r.width), imgWidth - 1));
    const bottom = Math.max(1, Math.min(Math.round(r.y + r.height), imgHeight - 1));
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) continue;

    if (aoi.category === 'WINDOW' && (w >= imgWidth * 0.95 || h >= imgHeight * 0.95)) {
      continue;
    }
    if (aoi.category !== 'TEXT' && !aoi.parsedText && Math.min(w, h) < 40) {
      continue;
    }
    if (isSingleAoi && aoi.isCommonObjectAoi) {
      const parentArea = imgWidth * imgHeight;
      const aoiArea = w * h;
      if (parentArea > 0 && aoiArea / parentArea >= 0.8) {
        continue;
      }
    }
    out.push({
      ...aoi,
      x: left,
      y: top,
      width: w,
      height: h,
      rect: { x: left, y: top, width: w, height: h }
    });
  }
  return out;
}

function computeSobelGradients(sourceBitmap) {
  // EdgeSnapPostProcessor.java:39: EDGE_SNAP_TARGET_WIDTH = 720
  // Downscale to 720px width for Sobel gradient computation so 2-pass edge snapping
  // runs in <8ms instead of 120ms on 1080p/4K displays!
  const targetWidth = 720;
  const origW = sourceBitmap.width;
  const origH = sourceBitmap.height;
  const scale = origW > targetWidth ? targetWidth / origW : 1.0;
  const w = Math.max(4, Math.round(origW * scale));
  const h = Math.max(4, Math.round(origH * scale));

  const workCanvas = new OffscreenCanvas(w, h);
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceBitmap, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  const absGx = new Float32Array(w * h);
  const absGy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -luma[r0 + x - 1] + luma[r0 + x + 1] -
        2 * luma[r1 + x - 1] + 2 * luma[r1 + x + 1] -
        luma[r2 + x - 1] + luma[r2 + x + 1];
      const gy =
        -luma[r0 + x - 1] - 2 * luma[r0 + x] - luma[r0 + x + 1] +
        luma[r2 + x - 1] + 2 * luma[r2 + x] + luma[r2 + x + 1];
      absGx[r1 + x] = Math.abs(gx);
      absGy[r1 + x] = Math.abs(gy);
    }
  }
  return { width: w, height: h, absGx, absGy, scale, origW, origH };
}

function snapAxisProfile(profile, originalIndex, distanceSigma, minAvgGradient, minPeakRatio, span) {
  if (!profile.length || span <= 0 || distanceSigma <= 0) {
    return { idx: originalIndex, ok: false };
  }
  const invSig = 1.0 / distanceSigma;
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    const d = (i - originalIndex) * invSig;
    const prior = Math.exp(-0.5 * d * d);
    const weighted = profile[i] * prior;
    if (weighted > bestVal) {
      bestVal = weighted;
      bestIdx = i;
    }
  }
  const peakVal = profile[bestIdx];
  const avgGrad = peakVal / span;
  const sorted = Array.from(profile).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
  const ok = avgGrad >= minAvgGradient && peakVal >= minPeakRatio * (1e-6 + med);
  return { idx: bestIdx, ok };
}

function edgeSnapPostProcess(sourceBitmap, aois) {
  if (!sourceBitmap || !Array.isArray(aois) || aois.length === 0) return aois;
  const hasSnapCandidate = aois.some((a) => a.category !== 'TEXT' && a.category !== 'WINDOW');
  if (!hasSnapCandidate) return aois;

  const grads = computeSobelGradients(sourceBitmap, 720);
  const { width: w, height: h, absGx, absGy, scale, origW, origH } = grads;

  function refinePass(toRefine, originalRaw) {
    const blockers = toRefine.map((a) => {
      const r = a.rect || a;
      return { left: Math.round(r.x * scale), top: Math.round(r.y * scale), right: Math.round((r.x + r.width) * scale), bottom: Math.round((r.y + r.height) * scale) };
    });
    const origRects = originalRaw.map((a) => {
      const r = a.rect || a;
      return { left: Math.round(r.x * scale), top: Math.round(r.y * scale), right: Math.round((r.x + r.width) * scale), bottom: Math.round((r.y + r.height) * scale) };
    });

    return toRefine.map((aoi, idx) => {
      if (aoi.category === 'TEXT') return aoi;
      const isWin = aoi.category === 'WINDOW';
      const searchR = Math.round((isWin ? 0 : 10) * scale);
      const distSigma = (isWin ? 0 : 10.0) * scale;
      if (searchR <= 0) return aoi;

      const rect = blockers[idx];
      const origRect = origRects[idx];
      let topLo = 0, leftLo = 0, botHi = h, rightHi = w;
      const margin = 2;

      for (let j = 0; j < blockers.length; j++) {
        if (j === idx) continue;
        if (isWin && toRefine[j].category === 'TEXT') continue;
        const other = blockers[j];
        const origOther = origRects[j];
        const cols = origOther.left < origRect.right && origOther.right > origRect.left;
        const rows = origOther.top < origRect.bottom && origOther.bottom > origRect.top;
        if (!cols || !rows) {
          const curCols = other.left < rect.right && other.right > rect.left;
          const curRows = other.top < rect.bottom && other.bottom > rect.top;
          if (curCols && other.top < rect.top) topLo = Math.max(topLo, other.bottom + margin);
          if (curCols && other.bottom > rect.bottom) botHi = Math.min(botHi, other.top - margin);
          if (curRows && other.left < rect.left) leftLo = Math.max(leftLo, other.right + margin);
          if (curRows && other.right > rect.right) rightHi = Math.min(rightHi, other.left - margin);
        }
      }

      let y0e = Math.max(rect.top, topLo);
      let y1e = Math.min(rect.bottom, botHi);
      let x0e = Math.max(rect.left, leftLo);
      let x1e = Math.min(rect.right, rightHi);
      if (y1e - y0e < 4) { y0e = rect.top; y1e = rect.bottom; }
      if (x1e - x0e < 4) { x0e = rect.left; x1e = rect.right; }

      let newTop = y0e;
      if (rect.top > 0) {
        const rLo = Math.max(0, Math.max(y0e - searchR, topLo));
        const rHi = Math.min(h, y0e + searchR + 1);
        const cLo = Math.max(0, x0e);
        const cHi = Math.min(w, x1e);
        if (rHi > rLo && cHi > cLo) {
          const prof = new Float32Array(rHi - rLo);
          for (let r = rLo; r < rHi; r++) {
            let sum = 0;
            const base = r * w;
            for (let c = cLo; c < cHi; c++) sum += absGy[base + c];
            prof[r - rLo] = sum;
          }
          const res = snapAxisProfile(prof, y0e - rLo, distSigma, 12.0, 1.3, cHi - cLo);
          if (res.ok) newTop = rLo + res.idx;
        }
      }

      let newBot = y1e;
      if (rect.bottom < h) {
        const rLo = Math.max(0, y1e - searchR);
        const rHi = Math.min(Math.min(h, y1e + searchR + 1), botHi + 1);
        const cLo = Math.max(0, x0e);
        const cHi = Math.min(w, x1e);
        if (rHi > rLo && cHi > cLo) {
          const prof = new Float32Array(rHi - rLo);
          for (let r = rLo; r < rHi; r++) {
            let sum = 0;
            const base = r * w;
            for (let c = cLo; c < cHi; c++) sum += absGy[base + c];
            prof[r - rLo] = sum;
          }
          const res = snapAxisProfile(prof, y1e - rLo, distSigma, 12.0, 1.3, cHi - cLo);
          if (res.ok) newBot = rLo + res.idx;
        }
      }

      let newLeft = x0e;
      if (rect.left > 0) {
        const cLo = Math.max(0, Math.max(x0e - searchR, leftLo));
        const cHi = Math.min(w, x0e + searchR + 1);
        const rLo = Math.max(0, y0e);
        const rHi = Math.min(h, y1e);
        if (cHi > cLo && rHi > rLo) {
          const prof = new Float32Array(cHi - cLo);
          for (let c = cLo; c < cHi; c++) {
            let sum = 0;
            for (let r = rLo; r < rHi; r++) sum += absGx[r * w + c];
            prof[c - cLo] = sum;
          }
          const res = snapAxisProfile(prof, x0e - cLo, distSigma, 12.0, 1.3, rHi - rLo);
          if (res.ok) newLeft = cLo + res.idx;
        }
      }

      let newRight = x1e;
      if (rect.right < w) {
        const cLo = Math.max(0, x1e - searchR);
        const cHi = Math.min(Math.min(w, x1e + searchR + 1), rightHi + 1);
        const rLo = Math.max(0, y0e);
        const rHi = Math.min(h, y1e);
        if (cHi > cLo && rHi > rLo) {
          const prof = new Float32Array(cHi - cLo);
          for (let c = cLo; c < cHi; c++) {
            let sum = 0;
            for (let r = rLo; r < rHi; r++) sum += absGx[r * w + c];
            prof[c - cLo] = sum;
          }
          const res = snapAxisProfile(prof, x1e - cLo, distSigma, 12.0, 1.3, rHi - rLo);
          if (res.ok) newRight = cLo + res.idx;
        }
      }

      if (newRight - newLeft < 4) { newLeft = x0e; newRight = x1e; }
      if (newBot - newTop < 4) { newTop = y0e; newBot = y1e; }

      const fl = Math.max(1, Math.min(Math.round(newLeft / scale), origW - 1));
      const ft = Math.max(1, Math.min(Math.round(newTop / scale), origH - 1));
      const fr = Math.max(1, Math.min(Math.round(newRight / scale), origW - 1));
      const fb = Math.max(1, Math.min(Math.round(newBot / scale), origH - 1));
      const fw = Math.max(4, fr - fl);
      const fh = Math.max(4, fb - ft);
      return {
        ...aoi,
        x: fl,
        y: ft,
        width: fw,
        height: fh,
        rect: { x: fl, y: ft, width: fw, height: fh }
      };
    });
  }

  const pass1 = refinePass(aois, aois);
  return refinePass(pass1, aois);
}

function runSegmenterOnBitmap(bitmap, modelType) {
  const detector = modelType === 'SCREEN_ELEMENT' ? screenElementDetector : commonObjectDetector;
  if (!detector || !bitmap) return [];
  try {
    const result = detector.detect(bitmap);
    const detections = (result && result.detections) || [];
    const rawAois = [];
    for (const det of detections) {
      const box = det.boundingBox;
      if (!box || box.width <= 0 || box.height <= 0) continue;
      const cat = det.categories && det.categories[0];
      const classId = cat && typeof cat.index === 'number' ? cat.index : -1;
      const score = cat && typeof cat.score === 'number' ? cat.score : 0;
      const label = (cat && cat.categoryName) || '';

      let aoiCategory = null;
      let isCommonObject = false;
      if (modelType === 'SCREEN_ELEMENT') {
        // Exact bytecode from MobileRaidSegmenterImpl.smali:1048-1102:
        // SCREEN_ELEMENT_CLASS_ID = 704 (0x2c0), INTERACTABLE_CLASS_ID = 706 (0x2c2)
        // activeScreenElementThreshold = 0.8f (for classId 704), activeThreshold = 0.4f (for classId 706)
        // Any classId != 704 && classId != 706 is rejected!
        if (classId !== 706 && classId !== 704) {
          aoiCategory = null;
        } else if (classId === 704 && score < 0.8) {
          aoiCategory = null;
        } else if (classId === 704) {
          aoiCategory = 'WINDOW';
        } else {
          aoiCategory = 'INTERACTABLE';
        }
      } else {
        aoiCategory = 'INTERACTABLE';
        isCommonObject = true;
      }

      if (aoiCategory) {
        const rx = Math.round(box.originX);
        const ry = Math.round(box.originY);
        const rw = Math.round(box.width);
        const rh = Math.round(box.height);
        rawAois.push({
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          rect: { x: rx, y: ry, width: rw, height: rh },
          label,
          category: aoiCategory,
          isCommonObjectAoi: isCommonObject,
          score
        });
      }
    }
    const genFiltered = generalPostProcess(rawAois, bitmap.width, bitmap.height);
    return edgeSnapPostProcess(bitmap, genFiltered);
  } catch (err) {
    console.warn(`Worker MobileRaidSegmenter (${modelType}) error:`, err);
    return [];
  }
}

let latestScreenBitmap = null;
let latestRawRaidAois = [];
let latestOcrAois = [];

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    await initDetectors();
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'segment_screen') {
    const ready = await initDetectors();
    if (!ready || !msg.bitmap) {
      if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
      return;
    }
    if (latestScreenBitmap && latestScreenBitmap.close) {
      latestScreenBitmap.close();
    }
    latestScreenBitmap = msg.bitmap;
    latestOcrAois = Array.isArray(msg.ocrAois) ? msg.ocrAois : [];

    // AOIDetectorImpl.java:313-315:
    // 1. processedRaidDeferred = detectionPostProcessor.postProcess(screenshot, raidDeferred)
    // 2. If ocrAois are already present, processedAllDeferred = detectionPostProcessor.postProcess(screenshot, ocrAois + raidDeferred)
    const detector = screenElementDetector;
    const result = detector ? detector.detect(latestScreenBitmap) : null;
    const detections = (result && result.detections) || [];
    const rawRaid = [];
    for (const det of detections) {
      const box = det.boundingBox;
      if (!box || box.width <= 0 || box.height <= 0) continue;
      const cat = det.categories && det.categories[0];
      const classId = cat && typeof cat.index === 'number' ? cat.index : -1;
      const score = cat && typeof cat.score === 'number' ? cat.score : 0;
      const label = (cat && cat.categoryName) || '';

      let aoiCategory = null;
      if (classId === 704 && score >= 0.8) {
        aoiCategory = 'WINDOW';
      } else if (classId === 706) {
        aoiCategory = 'INTERACTABLE';
      }
      if (aoiCategory) {
        const rx = Math.round(box.originX);
        const ry = Math.round(box.originY);
        const rw = Math.round(box.width);
        const rh = Math.round(box.height);
        rawRaid.push({
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          rect: { x: rx, y: ry, width: rw, height: rh },
          label,
          category: aoiCategory,
          isCommonObjectAoi: false,
          score
        });
      }
    }
    latestRawRaidAois = rawRaid;

    const combinedRaw = latestOcrAois.length > 0 ? [...latestOcrAois, ...rawRaid] : rawRaid;
    const genFiltered = generalPostProcess(combinedRaw, latestScreenBitmap.width, latestScreenBitmap.height);
    const snapped = edgeSnapPostProcess(latestScreenBitmap, genFiltered);
    const raidOnly = snapped.filter((a) => a.category !== 'TEXT');

    self.postMessage({
      type: 'screen_aois',
      seq: msg.seq,
      aois: raidOnly
    });
    return;
  }

  // Exact port of AOIDetectorImpl$init$processedAllDeferred$1.java:78-83:
  // When OCR finishes, re-run detectionPostProcessor.postProcess(screenshot, ocrDeferred + raidDeferred)
  // so EdgeSnapPostProcessor.sideClamps clamps INTERACTABLE boxes against OCR TEXT blockers!
  if (msg.type === 'reprocess_with_ocr') {
    latestOcrAois = Array.isArray(msg.ocrAois) ? msg.ocrAois : [];
    if (!latestScreenBitmap || latestRawRaidAois.length === 0) return;
    const combinedRaw = [...latestOcrAois, ...latestRawRaidAois];
    const genFiltered = generalPostProcess(combinedRaw, latestScreenBitmap.width, latestScreenBitmap.height);
    const snapped = edgeSnapPostProcess(latestScreenBitmap, genFiltered);
    const raidOnly = snapped.filter((a) => a.category !== 'TEXT');
    self.postMessage({
      type: 'screen_aois',
      seq: msg.seq,
      aois: raidOnly
    });
    return;
  }

  if (msg.type === 'segment_subelement') {
    const ready = await initDetectors();
    if (!ready || !msg.bitmap) {
      if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
      return;
    }
    const subAois = runSegmenterOnBitmap(msg.bitmap, 'COMMON_OBJECT');
    msg.bitmap.close();
    self.postMessage({
      type: 'subelement_aois',
      key: msg.key,
      safeL: msg.safeL,
      safeT: msg.safeT,
      parentAoi: msg.parentAoi,
      subAois
    });
  }
};

initDetectors();
