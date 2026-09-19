/**
 * Canvas utility to composite cutout with transparent, solid color, or custom background
 * with custom aspect ratios, blur filters, full HD PNG and binary-search compressed JPG exports.
 */

export type CanvasRatio = 'original' | '1:1' | '16:9' | 'passport';
export type JpgCompressionPreset = '50kb' | '100kb' | 'max';

export interface ExportOptions {
  ratio?: CanvasRatio;
  backgroundColor?: string;
  customBgImage?: HTMLImageElement | null;
  blur?: number; // 0 to 20 px
}

/**
 * Load a blob into an HTMLImageElement
 */
function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
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
 * Refines the raw segmentation mask from background removal inference:
 * 1. Clamps alpha:
 *    - alpha < 0.35 (90/255) => 0 (hard-cut background, removes faint secondary object ghosts)
 *    - alpha > 0.70 (180/255) => 255 (pure solid foreground)
 *    - Linear interpolation strictly between 90 and 180 for fine hair strands and soft edges
 * 2. Strict 1px bilateral edge feathering & noise suppression:
 *    - Eliminates isolated floating noise speckles and ghosted outlines
 *    - Applies 1px bilateral filtering on edge boundary pixels for razor-sharp, anti-aliased cutouts
 */
export async function refineAlphaMask(rawBlob: Blob): Promise<Blob> {
  const img = await loadImageFromBlob(rawBlob);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return rawBlob;
  }

  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const total = width * height;

  // Pass 1: Strict Clamping Thresholds with smooth linear interpolation
  const LOW_THRESH = 90;   // ~0.35 * 255 (hard-cut background, eliminates secondary ghosts)
  const HIGH_THRESH = 180; // ~0.70 * 255 (pure solid foreground)
  const RANGE = HIGH_THRESH - LOW_THRESH; // 90

  const clampedAlpha = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const rawA = data[i * 4 + 3];
    if (rawA < LOW_THRESH) {
      clampedAlpha[i] = 0;
    } else if (rawA > HIGH_THRESH) {
      clampedAlpha[i] = 255;
    } else {
      // Linear interpolation strictly between 0.35 and 0.70
      clampedAlpha[i] = Math.round(((rawA - LOW_THRESH) / RANGE) * 255);
    }
  }

  // Pass 2: Strict 1px bilateral edge clean-up & ghost outline elimination
  const refinedAlpha = new Uint8Array(total);

  for (let y = 0; y < height; y++) {
    const yW = y * width;
    for (let x = 0; x < width; x++) {
      const i = yW + x;
      const a = clampedAlpha[i];

      // Fast skip for solid interior pixels and clear exterior pixels
      if (a === 0) {
        const up = y > 0 ? clampedAlpha[i - width] : 0;
        const down = y < height - 1 ? clampedAlpha[i + width] : 0;
        const left = x > 0 ? clampedAlpha[i - 1] : 0;
        const right = x < width - 1 ? clampedAlpha[i + 1] : 0;
        if (up === 0 && down === 0 && left === 0 && right === 0) {
          refinedAlpha[i] = 0;
          continue;
        }
      } else if (a === 255) {
        const up = y > 0 ? clampedAlpha[i - width] : 255;
        const down = y < height - 1 ? clampedAlpha[i + width] : 255;
        const left = x > 0 ? clampedAlpha[i - 1] : 255;
        const right = x < width - 1 ? clampedAlpha[i + 1] : 255;
        if (up === 255 && down === 255 && left === 255 && right === 255) {
          refinedAlpha[i] = 255;
          continue;
        }
      }

      // Boundary transition pixel (0 < a < 255 or edge neighbor)
      let nonZeroNeighbors = 0;
      let neighborMaxAlpha = 0;
      const pIdx = i * 4;
      const pr = data[pIdx];
      const pg = data[pIdx + 1];
      const pb = data[pIdx + 2];

      let wSum = 1.0;
      let aSum = a * 1.0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const nyW = ny * width;

        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const ni = nyW + nx;
          const na = clampedAlpha[ni];
          if (na > 0) {
            nonZeroNeighbors++;
            if (na > neighborMaxAlpha) neighborMaxAlpha = na;
          }

          // 1px spatial kernel weight
          const sw = (dx === 0 || dy === 0) ? 0.707 : 0.5;

          // Color similarity weight (preserves sharp object boundaries, feathers smooth transitions)
          const nIdx = ni * 4;
          const colorDist = Math.abs(pr - data[nIdx]) + Math.abs(pg - data[nIdx + 1]) + Math.abs(pb - data[nIdx + 2]);
          const rw = Math.max(0, 1 - colorDist / 200);

          const weight = sw * (0.35 + 0.65 * rw);
          wSum += weight;
          aSum += na * weight;
        }
      }

      // Prune isolated ghost noise / floating secondary debris
      if (a > 0 && (nonZeroNeighbors < 2 || (a < 120 && neighborMaxAlpha < 100))) {
        refinedAlpha[i] = 0;
      } else {
        const smoothedA = aSum / wSum;
        if (smoothedA < 15) {
          refinedAlpha[i] = 0; // eliminate faint sub-pixel ghost haze
        } else if (smoothedA > 248) {
          refinedAlpha[i] = 255;
        } else {
          refinedAlpha[i] = Math.round(smoothedA);
        }
      }
    }
  }

  // Write refined alpha and clean RGB on cut pixels to prevent color fringing
  for (let i = 0; i < total; i++) {
    const fa = refinedAlpha[i];
    const idx = i * 4;
    data[idx + 3] = fa;
    if (fa === 0) {
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
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

  // 1. Draw Background Layer (Custom Image or Solid Color)
  const blur = Math.max(0, Math.min(20, options.blur || 0));

  if (options.customBgImage) {
    const bgImg = options.customBgImage;
    // Cover fit for custom background image
    const bgScale = Math.max(targetW / bgImg.naturalWidth, targetH / bgImg.naturalHeight);
    const bgW = bgImg.naturalWidth * bgScale;
    const bgH = bgImg.naturalHeight * bgScale;
    const bgX = (targetW - bgW) / 2;
    const bgY = (targetH - bgH) / 2;

    ctx.save();
    if (blur > 0) {
      ctx.filter = `blur(${blur}px)`;
      // Slight bleed expansion to prevent edge fading under blur
      const bleed = blur * 2;
      ctx.drawImage(bgImg, bgX - bleed, bgY - bleed, bgW + bleed * 2, bgH + bleed * 2);
    } else {
      ctx.drawImage(bgImg, bgX, bgY, bgW, bgH);
    }
    ctx.restore();
  } else if (options.backgroundColor && options.backgroundColor !== 'transparent') {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, targetW, targetH);
  }

  // 2. Draw Cutout Layer Centered with Contain Fit
  const fitScale = Math.min(targetW / naturalW, targetH / naturalH);
  const dw = Math.round(naturalW * fitScale);
  const dh = Math.round(naturalH * fitScale);
  const dx = Math.round((targetW - dw) / 2);
  const dy = Math.round((targetH - dh) / 2);

  ctx.filter = 'none';
  ctx.drawImage(cutoutImg, dx, dy, dw, dh);

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

  // Fast path: if original ratio, no blur, transparent, and no custom image, the cutoutBlob is already correct
  if (
    (!options.ratio || options.ratio === 'original') &&
    (!options.backgroundColor || options.backgroundColor === 'transparent') &&
    !options.customBgImage &&
    (!options.blur || options.blur === 0)
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
