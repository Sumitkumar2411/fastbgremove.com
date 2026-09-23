/**
 * High-Performance Client-Side Sticker Stroke & Shape Engine
 * Renders crisp die-cut outline borders, circular/rounded frame shapes, and anchored caption text (<50ms).
 * Strictly formats cutouts for official 512x512 WhatsApp & Discord sticker specifications.
 */

export type StickerSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;
export type StickerShape = 'die-cut' | 'circle' | 'rounded';

export interface StickerRenderOptions {
  shape?: StickerShape;
  strokeColor?: string;
  strokeWidth?: number;
  captionText?: string;
  captionColor?: string;
}

// Cached silhouette offscreen canvas to avoid garbage collection churn during 60 FPS slider dragging
let cachedSilhouetteCanvas: HTMLCanvasElement | null = null;

function getSourceDimensions(source: StickerSource): { width: number; height: number } {
  if ('naturalWidth' in source) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height
    };
  }
  return {
    width: source.width,
    height: source.height
  };
}

/**
 * Fallback-safe rounded rectangle path drawer.
 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

/**
 * Creates or reuses a solid-color silhouette offscreen canvas.
 * Preserves the exact alpha mask contour of the subject while filling RGB with strokeColor.
 */
function createSilhouetteCanvas(
  source: StickerSource,
  strokeColor: string,
  width: number,
  height: number
): HTMLCanvasElement {
  if (!cachedSilhouetteCanvas) {
    cachedSilhouetteCanvas = document.createElement('canvas');
  }

  if (cachedSilhouetteCanvas.width !== width || cachedSilhouetteCanvas.height !== height) {
    cachedSilhouetteCanvas.width = width;
    cachedSilhouetteCanvas.height = height;
  }

  const offCtx = cachedSilhouetteCanvas.getContext('2d', { willReadFrequently: false });
  if (!offCtx) {
    throw new Error('Unable to acquire 2D context for offscreen sticker silhouette');
  }

  offCtx.clearRect(0, 0, width, height);
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = 'high';

  // 1. Draw source subject
  offCtx.drawImage(source, 0, 0, width, height);

  // 2. Tint entire subject silhouette with solid strokeColor using source-in
  offCtx.globalCompositeOperation = 'source-in';
  offCtx.fillStyle = strokeColor;
  offCtx.fillRect(0, 0, width, height);

  // Reset composite operation
  offCtx.globalCompositeOperation = 'source-over';

  return cachedSilhouetteCanvas;
}

/**
 * Draws a zero-lag, anti-aliased die-cut sticker outline around a subject cutout.
 *
 * Algorithm:
 * - Generates a solid color silhouette in an offscreen buffer.
 * - Iteratively renders concentric radial passes (8 to 16 angular steps around circumference).
 * - Composites the original clean cutout crisp on top at (0, 0).
 */
export function drawStickerOutline(
  ctx: CanvasRenderingContext2D,
  imageBitmap: StickerSource,
  strokeColor: string = '#FFFFFF',
  strokeWidth: number = 12
): void {
  const { width, height } = getSourceDimensions(imageBitmap);

  // If stroke width is 0 or negative, simply composite the original image crisp
  if (strokeWidth <= 0) {
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    return;
  }

  const silhouette = createSilhouetteCanvas(imageBitmap, strokeColor, width, height);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Iterative shadow composite setup
  ctx.shadowColor = strokeColor;
  ctx.shadowBlur = 0;

  // Adaptive angular resolution: 8 passes for thin strokes, 16 passes for thicker die-cuts
  const numAngles = strokeWidth <= 6 ? 8 : 16;
  const angleStep = (2 * Math.PI) / numAngles;

  // Radial step interval (step every 2-3px so thicker borders are 100% solid with zero hollows)
  const stepSize = Math.max(1, Math.min(3, Math.floor(strokeWidth / 4)));

  for (let r = stepSize; r < strokeWidth; r += stepSize) {
    for (let i = 0; i < numAngles; i++) {
      const angle = i * angleStep;
      const dx = Math.round(r * Math.cos(angle));
      const dy = Math.round(r * Math.sin(angle));
      ctx.drawImage(silhouette, dx, dy);
    }
  }

  // Final exact outer perimeter pass
  for (let i = 0; i < numAngles; i++) {
    const angle = i * angleStep;
    const dx = Math.round(strokeWidth * Math.cos(angle));
    const dy = Math.round(strokeWidth * Math.sin(angle));
    ctx.drawImage(silhouette, dx, dy);
  }

  ctx.restore();

  // Composite the original clean cutout crisp on top
  ctx.drawImage(imageBitmap, 0, 0, width, height);
}

/**
 * Draws anchored sticker typography centered near the bottom of the subject/frame.
 * Renders bold sans-serif with a 4px+ contrasting stroke (ctx.strokeText + ctx.fillText).
 */
export function drawAnchoredCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  captionColor: string = '#FFFFFF',
  strokeWidth: number = 0,
  shape: StickerShape = 'die-cut'
): void {
  if (!text) return;

  const minDim = Math.min(width, height);
  // Responsive bold font size
  const fontSize = Math.max(18, Math.round(minDim * 0.085));

  // Determine contrasting stroke color
  const isBlackText =
    captionColor.toUpperCase() === '#000000' ||
    captionColor.toLowerCase() === 'black' ||
    captionColor.toLowerCase() === '#000';
  const textColor = isBlackText ? '#000000' : '#FFFFFF';
  const strokeColor = isBlackText ? '#FFFFFF' : '#000000';
  const strokeThickness = Math.max(4, Math.round(fontSize * 0.12));

  // Calculate bottom margin: give enough room from the edge and shape boundary
  let bottomMargin = Math.max(16, Math.round(height * 0.05));
  if (shape === 'circle') {
    bottomMargin = Math.max(24, Math.round(minDim * 0.09)) + strokeWidth;
  } else if (shape === 'rounded') {
    bottomMargin = Math.max(16, Math.round(height * 0.05)) + strokeWidth;
  }

  const textX = width / 2;
  const textY = height - bottomMargin;

  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // 1. Contrasting stroke outline (4px+ thickness for instant readability on any background)
  ctx.lineWidth = strokeThickness;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, textX, textY);

  // 2. Solid bold text fill
  ctx.fillStyle = textColor;
  ctx.fillText(text, textX, textY);

  ctx.restore();
}

/**
 * Unified sticker rendering function:
 * Supports die-cut contour outline, circular badge clip, and rounded rectangle clip,
 * plus anchored bold typography caption text.
 */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  source: StickerSource,
  options: StickerRenderOptions = {}
): void {
  const { width, height } = getSourceDimensions(source);
  const shape = options.shape || 'die-cut';
  const strokeColor = options.strokeColor || '#FFFFFF';
  const strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 14;

  if (shape === 'circle') {
    const minSide = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
    const radius = Math.max(1, minSide / 2 - pad);

    // 1. Circular clipping mask
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();

    // 2. Outer stroke border
    if (strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  } else if (shape === 'rounded') {
    const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
    const rx = pad;
    const ry = pad;
    const rw = width - pad * 2;
    const rh = height - pad * 2;
    const borderRadius = Math.max(8, Math.round(Math.min(rw, rh) * 0.12));

    // 1. Rounded rectangle clipping mask
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, rx, ry, rw, rh, borderRadius);
    ctx.clip();
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();

    // 2. Outer stroke border
    if (strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      drawRoundRect(ctx, rx, ry, rw, rh, borderRadius);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // Default 'die-cut' contour outline
    drawStickerOutline(ctx, source, strokeColor, strokeWidth);
  }

  // 3. Anchored Sticker Text
  if (options.captionText && options.captionText.trim().length > 0) {
    drawAnchoredCaption(
      ctx,
      options.captionText.trim(),
      width,
      height,
      options.captionColor || '#FFFFFF',
      strokeWidth,
      shape
    );
  }
}

/**
 * Creates a standalone HTMLCanvasElement containing the subject with sticker shape, outline, and caption.
 */
export function renderStickerCanvas(
  source: StickerSource,
  optionsOrColor: string | StickerRenderOptions = '#FFFFFF',
  strokeWidth: number = 14
): HTMLCanvasElement {
  let opts: StickerRenderOptions;
  if (typeof optionsOrColor === 'string') {
    opts = {
      strokeColor: optionsOrColor,
      strokeWidth: strokeWidth,
      shape: 'die-cut'
    };
  } else {
    opts = optionsOrColor;
  }

  const { width, height } = getSourceDimensions(source);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for sticker rendering');
  }

  ctx.clearRect(0, 0, width, height);
  drawSticker(ctx, source, opts);
  return canvas;
}

/**
 * Bulletproof WhatsApp Sticker Export Pipeline strictly at 512x512 pixels:
 * Computes contain-fit with 16px safety padding (480px usable box), centers the subject,
 * and outputs an official transparent PNG blob.
 */
export function exportWhatsAppSticker(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = 512;
      outCanvas.height = 512;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      // Calculate contain-fit with 16px safety padding
      const maxDim = 512 - 32; // 480px usable
      const scale = Math.min(maxDim / sourceCanvas.width, maxDim / sourceCanvas.height);
      const w = Math.round(sourceCanvas.width * scale);
      const h = Math.round(sourceCanvas.height * scale);
      const x = Math.round((512 - w) / 2);
      const y = Math.round((512 - h) / 2);

      ctx.clearRect(0, 0, 512, 512);
      ctx.drawImage(sourceCanvas, x, y, w, h);

      outCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Blob conversion failed'));
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * WhatsApp & Discord Sticker Canvas Generator (Legacy-compatible wrapper).
 */
export function createWhatsAppStickerCanvas(
  source: StickerSource,
  strokeColor: string = '#FFFFFF',
  strokeWidth: number = 14
): HTMLCanvasElement {
  const stickerCanvas = renderStickerCanvas(source, {
    strokeColor,
    strokeWidth,
    shape: 'die-cut'
  });

  const targetSize = 512;
  const padding = 16;
  const maxContentDim = targetSize - padding * 2; // 480px

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = targetSize;
  outputCanvas.height = targetSize;

  const outCtx = outputCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('Failed to acquire 2D context for WhatsApp sticker export');
  }

  outCtx.clearRect(0, 0, targetSize, targetSize);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';

  const fitScale = Math.min(maxContentDim / stickerCanvas.width, maxContentDim / stickerCanvas.height);
  const dw = Math.round(stickerCanvas.width * fitScale);
  const dh = Math.round(stickerCanvas.height * fitScale);
  const dx = Math.round(padding + (maxContentDim - dw) / 2);
  const dy = Math.round(padding + (maxContentDim - dh) / 2);

  outCtx.drawImage(stickerCanvas, dx, dy, dw, dh);
  return outputCanvas;
}

/**
 * Generates an official WhatsApp 512x512 PNG Blob from an image, canvas, or blob source.
 */
export async function createWhatsAppStickerBlob(
  source: StickerSource | Blob,
  strokeColor: string = '#FFFFFF',
  strokeWidth: number = 14
): Promise<Blob> {
  let stickerSource: StickerSource;

  if (source instanceof Blob) {
    stickerSource = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(source);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image blob for WhatsApp sticker export'));
      };
      img.src = url;
    });
  } else {
    stickerSource = source;
  }

  const renderedCanvas = renderStickerCanvas(stickerSource, {
    strokeColor,
    strokeWidth,
    shape: 'die-cut'
  });

  return exportWhatsAppSticker(renderedCanvas);
}
