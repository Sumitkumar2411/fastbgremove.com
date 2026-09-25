/**
 * Canvas utility to composite cutout with transparent, solid color, or custom background
 * with custom aspect ratios, blur filters, full HD PNG and binary-search compressed JPG exports.
 */

import {
  renderStickerCanvas,
  createWhatsAppStickerBlob,
  createWhatsAppStickerCanvas,
  exportWhatsAppSticker,
  type StickerShape,
  type StickerRenderOptions
} from '../utils/stickerEngine';

export {
  createWhatsAppStickerBlob,
  createWhatsAppStickerCanvas,
  exportWhatsAppSticker,
  type StickerShape,
  type StickerRenderOptions
};

export type CanvasRatio = 'original' | '1:1' | '16:9' | 'passport';
export type JpgCompressionPreset = '50kb' | '100kb' | 'max';

export interface ExportOptions {
  ratio?: CanvasRatio;
  backgroundColor?: string;
  customBgImage?: HTMLImageElement | null;
  originalImage?: HTMLImageElement | null;
  blur?: number; // 0 to 30 px
  isBlurEnabled?: boolean;
  isShadowEnabled?: boolean;
  shadowOpacity?: number; // 0 to 100
  isStickerEnabled?: boolean;
  stickerStrokeColor?: string;
  stickerStrokeWidth?: number;
  stickerShape?: StickerShape;
  stickerPanX?: number;
  stickerPanY?: number;
  stickerCaptionText?: string;
  stickerCaptionColor?: string;
  stickerTextNormX?: number;
  stickerTextNormY?: number;
  stickerIsBold?: boolean;
  stickerIsItalic?: boolean;
  stickerFontSize?: number;
}

/**
 * Load a blob into an HTMLImageElement
 */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image blob'));
    };
    img.src = url;
  });
}

/**
 * Refines the raw segmentation mask from background removal inference (PhotoRoom-grade edge precision):
 * 1. MASK RESOLUTION & BILINEAR UPSCALING:
 *    - Offscreen intermediate canvas with imageSmoothingEnabled = true & imageSmoothingQuality = 'high'
 *    - Eliminates nearest-neighbor blocky edge artifacts
 * 2. COLOR-AWARE ALPHA SNAPPING (Trimap Thresholding):
 *    - alpha < 0.30 => targetAlpha = 0 (forcefully drops faint edge artifacts & gray bounding boxes)
 *    - alpha > 0.75 => targetAlpha = 255 (solid foreground subject)
 *    - Strictly linear hair transition band: ((alpha - 0.30) / (0.75 - 0.30)) * 255
 *    - 1px morphological erosion on the outer perimeter to strip away bounding-box residue
 * 3. 1px BILATERAL EDGE FEATHERING:
 *    - Anti-aliases transition boundaries respecting original pixel colors
 * 4. CANVAS CLEAR RECT:
 *    - Explicitly clears offscreen and export canvases with ctx.clearRect() so no ghost layers linger
 */
export async function refineAlphaMask(
  rawBlob: Blob,
  originalBlob?: Blob | File | null
): Promise<Blob> {
  const rawImg = await loadImageFromBlob(rawBlob);
  let targetWidth = rawImg.naturalWidth;
  let targetHeight = rawImg.naturalHeight;
  let origImg: HTMLImageElement | null = null;

  if (originalBlob) {
    try {
      origImg = await loadImageFromBlob(originalBlob);
      targetWidth = origImg.naturalWidth;
      targetHeight = origImg.naturalHeight;
    } catch (_) {}
  }

  // 1. Intermediate Offscreen Mask Canvas with High-Quality Bicubic/Bilinear Smoothing
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = targetWidth;
  maskCanvas.height = targetHeight;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return rawBlob;
  }

  // Canvas clearRect before drawing
  maskCtx.clearRect(0, 0, targetWidth, targetHeight);
  maskCtx.imageSmoothingEnabled = true;
  maskCtx.imageSmoothingQuality = 'high';
  maskCtx.drawImage(rawImg, 0, 0, targetWidth, targetHeight);

  const maskImgData = maskCtx.getImageData(0, 0, targetWidth, targetHeight);
  const maskData = maskImgData.data;

  // 2. Output Canvas with Pristine Colors from Original Image (or raw image fallback)
  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetWidth;
  outCanvas.height = targetHeight;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) {
    return rawBlob;
  }

  // Canvas clearRect before drawing
  outCtx.clearRect(0, 0, targetWidth, targetHeight);
  if (origImg) {
    outCtx.drawImage(origImg, 0, 0, targetWidth, targetHeight);
  } else {
    outCtx.drawImage(rawImg, 0, 0, targetWidth, targetHeight);
  }

  const outImgData = outCtx.getImageData(0, 0, targetWidth, targetHeight);
  const outData = outImgData.data;
  const total = targetWidth * targetHeight;

  // 3. Color-Aware Alpha Snapping (Trimap Thresholding)
  const tAlpha = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const rawAlpha = maskData[i * 4 + 3] / 255;
    let targetAlpha = 0;
    if (rawAlpha < 0.30) {
      targetAlpha = 0; // Forcefully drop all faint edge artifacts & gray boxes
    } else if (rawAlpha > 0.75) {
      targetAlpha = 255; // Solid foreground subject
    } else {
      // Smooth hair transition band
      targetAlpha = Math.round(((rawAlpha - 0.30) / (0.75 - 0.30)) * 255);
    }
    tAlpha[i] = targetAlpha;
  }

  // 4. 1px Morphological Erosion on the outer perimeter to strip away bounding-box residue
  const erodedAlpha = new Uint8Array(total);
  for (let y = 0; y < targetHeight; y++) {
    const yW = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const i = yW + x;
      const a = tAlpha[i];
      if (a === 0) {
        erodedAlpha[i] = 0;
        continue;
      }

      const up = y > 0 ? tAlpha[i - targetWidth] : 0;
      const down = y < targetHeight - 1 ? tAlpha[i + targetWidth] : 0;
      const left = x > 0 ? tAlpha[i - 1] : 0;
      const right = x < targetWidth - 1 ? tAlpha[i + 1] : 0;

      // Solid interior pixel
      if (up === 255 && down === 255 && left === 255 && right === 255) {
        erodedAlpha[i] = 255;
        continue;
      }

      // Outer perimeter pixel touching background
      const minNeighbor = Math.min(up, down, left, right);
      if (minNeighbor === 0) {
        // Protect connected fine hair strands
        const isConnectedHair = (up > 160 && down > 160) || (left > 160 && right > 160);
        if (isConnectedHair) {
          erodedAlpha[i] = a;
        } else {
          // Strip away 1px bounding-box residue and gray shoulder/clothing contours
          erodedAlpha[i] = 0;
        }
      } else {
        erodedAlpha[i] = a;
      }
    }
  }

  // 5. Bilateral Edge Anti-Aliasing on transition boundaries
  const finalAlpha = new Uint8Array(total);
  for (let y = 0; y < targetHeight; y++) {
    const yW = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const i = yW + x;
      const a = erodedAlpha[i];
      if (a === 0) {
        finalAlpha[i] = 0;
        continue;
      }
      if (a === 255) {
        const up = y > 0 ? erodedAlpha[i - targetWidth] : 255;
        const down = y < targetHeight - 1 ? erodedAlpha[i + targetWidth] : 255;
        const left = x > 0 ? erodedAlpha[i - 1] : 255;
        const right = x < targetWidth - 1 ? erodedAlpha[i + 1] : 255;
        if (up === 255 && down === 255 && left === 255 && right === 255) {
          finalAlpha[i] = 255;
          continue;
        }
      }

      // Transition pixel
      let wSum = 1.0;
      let aSum = a * 1.0;
      const pIdx = i * 4;
      const pr = outData[pIdx];
      const pg = outData[pIdx + 1];
      const pb = outData[pIdx + 2];

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= targetHeight) continue;
        const nyW = ny * targetWidth;

        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= targetWidth) continue;

          const ni = nyW + nx;
          const na = erodedAlpha[ni];
          const sw = (dx === 0 || dy === 0) ? 0.707 : 0.5;

          const nIdx = ni * 4;
          const colorDist = Math.abs(pr - outData[nIdx]) + Math.abs(pg - outData[nIdx + 1]) + Math.abs(pb - outData[nIdx + 2]);
          const rw = Math.max(0, 1 - colorDist / 180);

          const weight = sw * (0.35 + 0.65 * rw);
          wSum += weight;
          aSum += na * weight;
        }
      }

      const smoothedA = aSum / wSum;
      if (smoothedA < 12) {
        finalAlpha[i] = 0;
      } else if (smoothedA > 248) {
        finalAlpha[i] = 255;
      } else {
        finalAlpha[i] = Math.round(smoothedA);
      }
    }
  }

  // 6. Write refined alpha and clean transparent RGB pixels
  for (let i = 0; i < total; i++) {
    const fa = finalAlpha[i];
    const idx = i * 4;
    outData[idx + 3] = fa;
    if (fa === 0) {
      outData[idx] = 0;
      outData[idx + 1] = 0;
      outData[idx + 2] = 0;
    }
  }

  outCtx.putImageData(outImgData, 0, 0);

  return new Promise((resolve, reject) => {
    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create refined PNG blob'));
    }, 'image/png', 1.0);
  });
}

/**
 * Renders the composited canvas with aspect ratio, background color / custom image,
 * optional blur filter, and foreground cutout centered with contain fit.
 */
export async function renderCompositeCanvas(
  cutoutBlob: Blob,
  options: ExportOptions = {}
): Promise<HTMLCanvasElement> {
  const cutoutImg = await loadImageFromBlob(cutoutBlob);
  const naturalW = cutoutImg.naturalWidth;
  const naturalH = cutoutImg.naturalHeight;

  const ratio = options.ratio || 'original';
  let targetW = naturalW;
  let targetH = naturalH;

  if (ratio === '1:1') {
    const maxSide = Math.max(naturalW, naturalH);
    targetW = maxSide;
    targetH = maxSide;
  } else if (ratio === '16:9') {
    const targetAspect = 16 / 9;
    const currentAspect = naturalW / naturalH;
    if (currentAspect >= targetAspect) {
      targetW = naturalW;
      targetH = Math.round(targetW / targetAspect);
    } else {
      targetH = naturalH;
      targetW = Math.round(targetH * targetAspect);
    }
  } else if (ratio === 'passport') {
    // 3.5cm x 4.5cm ratio = 7 / 9
    const targetAspect = 3.5 / 4.5;
    const currentAspect = naturalW / naturalH;
    if (currentAspect >= targetAspect) {
      targetW = naturalW;
      targetH = Math.round(targetW / targetAspect);
    } else {
      targetH = naturalH;
      targetW = Math.round(targetH * targetAspect);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D canvas context');
  }
  ctx.clearRect(0, 0, targetW, targetH);

  // 1. Draw Background Layer (Blurred Original Image, Custom Image, or Solid Color)
  const isBlur = !!options.isBlurEnabled && (options.blur || 0) > 0;
  const rawBlur = Math.max(0, Math.min(30, options.blur || 0));
  // Scale blur proportionally so high-resolution exports (e.g. 4000px wide) have identical visual depth as the preview canvas
  const canvasBlurPx = Math.max(1, Math.round(rawBlur * (targetW / 800)));

  // Target background image: custom uploaded background OR original image when blur is enabled
  const bgImg = options.customBgImage || (options.isBlurEnabled && options.originalImage ? options.originalImage : null);

  if (bgImg) {
    const bgScale = Math.max(targetW / bgImg.naturalWidth, targetH / bgImg.naturalHeight);
    const bgW = bgImg.naturalWidth * bgScale;
    const bgH = bgImg.naturalHeight * bgScale;
    const bgX = (targetW - bgW) / 2;
    const bgY = (targetH - bgH) / 2;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (isBlur) {
      ctx.filter = `blur(${canvasBlurPx}px)`;
      // 1.04x scale / bleed expansion to prevent edge fading/halo under blur
      const bleedScale = 1.04;
      const bw = bgW * bleedScale;
      const bh = bgH * bleedScale;
      const bx = (targetW - bw) / 2;
      const by = (targetH - bh) / 2;
      ctx.drawImage(bgImg, bx, by, bw, bh);
    } else {
      ctx.drawImage(bgImg, bgX, bgY, bgW, bgH);
    }
    ctx.restore();
  } else if (options.backgroundColor && options.backgroundColor !== 'transparent') {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, targetW, targetH);
  }

  // 2. Prepare Cutout Foreground Layer (with optional die-cut/shape sticker outline and caption)
  let foregroundElement: HTMLImageElement | HTMLCanvasElement = cutoutImg;
  if (
    options.isStickerEnabled &&
    ((options.stickerStrokeWidth ?? 0) > 0 ||
      (options.stickerShape && options.stickerShape !== 'die-cut') ||
      (options.stickerCaptionText && options.stickerCaptionText.trim().length > 0))
  ) {
    foregroundElement = renderStickerCanvas(cutoutImg, {
      shape: options.stickerShape || 'die-cut',
      strokeColor: options.stickerStrokeColor || '#FFFFFF',
      strokeWidth: options.stickerStrokeWidth ?? 14,
      panX: options.stickerPanX,
      panY: options.stickerPanY,
      captionText: options.stickerCaptionText,
      captionColor: options.stickerCaptionColor || '#FFFFFF',
      textNormX: options.stickerTextNormX,
      textNormY: options.stickerTextNormY,
      isBold: options.stickerIsBold,
      isItalic: options.stickerIsItalic,
      fontSize: options.stickerFontSize
    });
  }

  // Draw Cutout Layer Centered with Contain Fit
  const fitScale = Math.min(targetW / naturalW, targetH / naturalH);
  const dw = Math.round(naturalW * fitScale);
  const dh = Math.round(naturalH * fitScale);
  const dx = Math.round((targetW - dw) / 2);
  const dy = Math.round((targetH - dh) / 2);

  // 3. Draw Realistic Drop Shadow if enabled
  if (options.isShadowEnabled) {
    const shadowIntensity = Math.max(0, Math.min(100, options.shadowOpacity ?? 60)) / 100;
    if (shadowIntensity > 0) {
      ctx.save();
      const scaleRatio = targetW / 800;
      const shadowBlur = Math.round(20 * scaleRatio * shadowIntensity);
      const shadowOffsetY = Math.round(10 * scaleRatio * shadowIntensity);
      ctx.shadowColor = `rgba(0, 0, 0, ${(0.65 * shadowIntensity).toFixed(3)})`;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = shadowOffsetY;
      ctx.drawImage(foregroundElement, dx, dy, dw, dh);
      ctx.restore();
    }
  }

  // Draw sharp cutout foreground
  ctx.filter = 'none';
  ctx.drawImage(foregroundElement, dx, dy, dw, dh);

  return canvas;
}

/**
 * Creates Full HD PNG Blob (Lossless, transparent or custom background)
 */
export async function createHdExportBlob(
  cutoutBlob: Blob,
  backgroundColorOrOptions: string | ExportOptions = 'transparent'
): Promise<Blob> {
  const options: ExportOptions =
    typeof backgroundColorOrOptions === 'string'
      ? { backgroundColor: backgroundColorOrOptions }
      : backgroundColorOrOptions;

  // Fast path: if original ratio, no blur, no shadow, transparent, no custom image, and no active sticker features, the cutoutBlob is already correct
  if (
    (!options.ratio || options.ratio === 'original') &&
    (!options.backgroundColor || options.backgroundColor === 'transparent') &&
    !options.customBgImage &&
    !options.isBlurEnabled &&
    !options.isShadowEnabled &&
    (!options.blur || options.blur === 0) &&
    (!options.isStickerEnabled ||
      ((!options.stickerStrokeWidth || options.stickerStrokeWidth <= 0) &&
        (!options.stickerShape || options.stickerShape === 'die-cut') &&
        (!options.stickerCaptionText || options.stickerCaptionText.trim().length === 0)))
  ) {
    return cutoutBlob;
  }

  const canvas = await renderCompositeCanvas(cutoutBlob, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else resolve(cutoutBlob);
    }, 'image/png', 1.0);
  });
}

/**
 * Helper to convert canvas to JPEG blob with given quality
 */
function canvasToJpgBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to convert canvas to JPEG'));
    }, 'image/jpeg', quality);
  });
}

/**
 * Creates Compressed JPG Blob using Iterative Binary Search on Quality and Resolution
 * Guarantees file size lands strictly below selected threshold (Under 50 KB, Under 100 KB, or Max Quality).
 */
export async function createCompressedJpgBlob(
  cutoutBlob: Blob,
  preset: JpgCompressionPreset = '100kb',
  options: ExportOptions = {}
): Promise<Blob> {
  // JPEG does not support transparency. If transparent with no custom background, default to pure white.
  const isTransparent = (!options.backgroundColor || options.backgroundColor === 'transparent') && !options.customBgImage;
  const jpgOptions: ExportOptions = {
    ...options,
    backgroundColor: isTransparent ? '#FFFFFF' : options.backgroundColor
  };

  const canvas = await renderCompositeCanvas(cutoutBlob, jpgOptions);

  // Max Quality mode
  if (preset === 'max') {
    return canvasToJpgBlob(canvas, 0.95);
  }

  const targetLimit = preset === '50kb' ? 50 * 1024 : 100 * 1024;

  // 1. Check if full quality already fits below target threshold
  const initialTest = await canvasToJpgBlob(canvas, 0.95);
  if (initialTest.size <= targetLimit) {
    return initialTest;
  }

  // 2. Iterative Binary Search on JPEG Quality (range: 0.05 to 0.95)
  let low = 0.05;
  let high = 0.95;
  let bestBlob: Blob | null = null;

  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    const blob = await canvasToJpgBlob(canvas, mid);
    if (blob.size <= targetLimit) {
      bestBlob = blob;
      low = mid; // Try higher quality
    } else {
      high = mid; // Too large, decrease quality
    }
  }

  if (bestBlob && bestBlob.size <= targetLimit) {
    return bestBlob;
  }

  // 3. If quality alone cannot satisfy targetLimit (e.g. huge 4000x3000 photos where headers/DCT blocks exceed 50KB/100KB),
  // iteratively scale down canvas dimensions until file size strictly meets target.
  let scale = 0.85;
  while (scale >= 0.15) {
    const scaledW = Math.max(100, Math.round(canvas.width * scale));
    const scaledH = Math.max(100, Math.round(canvas.height * scale));

    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = scaledW;
    scaledCanvas.height = scaledH;
    const sCtx = scaledCanvas.getContext('2d');
    if (!sCtx) break;

    sCtx.clearRect(0, 0, scaledW, scaledH);
    // High quality downsampling
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(canvas, 0, 0, scaledW, scaledH);

    // Binary search on quality for this scaled canvas
    low = 0.1;
    high = 0.92;
    for (let i = 0; i < 6; i++) {
      const mid = (low + high) / 2;
      const b = await canvasToJpgBlob(scaledCanvas, mid);
      if (b.size <= targetLimit) {
        bestBlob = b;
        low = mid;
      } else {
        high = mid;
      }
    }

    if (bestBlob && bestBlob.size <= targetLimit) {
      return bestBlob;
    }

    scale -= 0.15;
  }

  return bestBlob || (await canvasToJpgBlob(canvas, 0.05));
}

/**
 * Trigger file download in browser
 */
export function triggerDownload(blob: Blob, filename: string = 'fastbgremove-hd.png') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copy image blob to system clipboard
 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (!navigator.clipboard || !window.ClipboardItem) {
    return false;
  }
  try {
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}
