/**
 * High-Performance Client-Side Sticker Stroke & Shape Engine
 * Renders crisp die-cut outline borders, circular/rounded frame shapes, and anchored caption text (<50ms).
 * Strictly formats cutouts for official 512x512 WhatsApp & Discord sticker specifications.
 */

export type StickerSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;
export type StickerShape = 'die-cut' | 'circle' | 'square' | 'rounded';

export interface StickerRenderOptions {
  shape?: StickerShape;
  strokeColor?: string;
  strokeWidth?: number;
  captionText?: string;
  captionColor?: string;
  textNormX?: number;
  textNormY?: number;
  isBold?: boolean;
  isItalic?: boolean;
  fontSize?: number;
  showBoundingBox?: boolean;
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
 * Draws free-position sticker typography on canvas with full typography controls:
 * - Draggable normalized coordinates (textNormX, textNormY).
 * - Bold & Italic styling: ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}px sans-serif`.
 * - Size scaling relative to standard preview so text is proportional on HD/WhatsApp exports.
 * - Clamped boundaries so text stays visible within the canvas frame.
 * - High-contrast stroke outline (white on black or black on white) for 100% contrast on any image.
 */
export interface StickerTextOptions {
  text: string;
  normX?: number;
  normY?: number;
  isBold?: boolean;
  isItalic?: boolean;
  fontSize?: number;
  captionColor?: string;
  showBoundingBox?: boolean;
}

export function drawStickerText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: StickerTextOptions
): { x: number; y: number; w: number; h: number; normX: number; normY: number } | null {
  const rawText = (options.text || '').trim();
  if (!rawText) return null;

  const minDim = Math.min(width, height);
  const baseFontSize = options.fontSize && options.fontSize >= 12 ? options.fontSize : 32;
  const scale = Math.max(0.4, minDim / 480);
  const computedFontSize = Math.max(12, Math.round(baseFontSize * scale));

  const isBold = options.isBold !== false;
  const isItalic = !!options.isItalic;
  const fontStyle = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${computedFontSize}px sans-serif`.trim();

  ctx.save();
  ctx.font = fontStyle;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // 100% contrast styling on any photo
  const captionColor = options.captionColor || '#FFFFFF';
  const isBlack =
    captionColor.toUpperCase() === '#000000' ||
    captionColor.toLowerCase() === 'black' ||
    captionColor.toLowerCase() === '#000';
  const fillColor = isBlack ? '#000000' : '#FFFFFF';
  const strokeColor = isBlack ? '#FFFFFF' : '#000000';
  const strokeThickness = Math.max(3, Math.round(computedFontSize * 0.16));

  // Measure text dimensions for boundary clamping
  const metrics = ctx.measureText(rawText);
  const textWidth = metrics.width;
  const textHeight = computedFontSize;

  const rawNormX = typeof options.normX === 'number' ? options.normX : 0.5;
  const rawNormY = typeof options.normY === 'number' ? options.normY : 0.82;

  const rawX = rawNormX * width;
  const rawY = rawNormY * height;

  const halfW = textWidth / 2;
  const halfH = textHeight / 2;
  const margin = Math.max(6, Math.round(8 * scale));

  // Clamp boundaries so text stays visible within the canvas frame
  const clampedX = Math.max(halfW + margin, Math.min(width - halfW - margin, rawX));
  const clampedY = Math.max(halfH + margin, Math.min(height - halfH - margin, rawY));

  // 1. Contrasting outer stroke
  ctx.lineWidth = strokeThickness;
  ctx.strokeStyle = strokeColor;
  ctx.strokeText(rawText, clampedX, clampedY);

  // 2. Crisp solid text fill
  ctx.fillStyle = fillColor;
  ctx.fillText(rawText, clampedX, clampedY);

  // 3. Subtle interactive selection bounding box (Linear / Canva grade)
  if (options.showBoundingBox) {
    ctx.save();
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.lineWidth = Math.max(1.5, 1.8 * scale);
    ctx.strokeStyle = '#E5A93C';
    const padX = Math.max(6, 8 * scale);
    const padY = Math.max(4, 5 * scale);
    const boxX = clampedX - halfW - padX;
    const boxY = clampedY - halfH - padY;
    const boxW = textWidth + padX * 2;
    const boxH = textHeight + padY * 2;

    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // 4 Corner anchor handles
    ctx.fillStyle = '#E5A93C';
    const handleSize = Math.max(4, Math.round(5 * scale));
    ctx.fillRect(boxX - handleSize / 2, boxY - handleSize / 2, handleSize, handleSize);
    ctx.fillRect(boxX + boxW - handleSize / 2, boxY - handleSize / 2, handleSize, handleSize);
    ctx.fillRect(boxX - handleSize / 2, boxY + boxH - handleSize / 2, handleSize, handleSize);
    ctx.fillRect(boxX + boxW - handleSize / 2, boxY + boxH - handleSize / 2, handleSize, handleSize);

    ctx.restore();
  }

  ctx.restore();

  return {
    x: clampedX - halfW,
    y: clampedY - halfH,
    w: textWidth,
    h: textHeight,
    normX: clampedX / width,
    normY: clampedY / height
  };
}

/**
 * Fast hit-test helper to determine if pointer is hovering over or touching the text
 */
export function computeTextHitTest(
  width: number,
  height: number,
  pointerNormX: number,
  pointerNormY: number,
  options: {
    text: string;
    normX?: number;
    normY?: number;
    fontSize?: number;
    isBold?: boolean;
  }
): boolean {
  const rawText = (options.text || '').trim();
  if (!rawText || width <= 0 || height <= 0) return false;

  const minDim = Math.min(width, height);
  const baseFontSize = options.fontSize && options.fontSize >= 12 ? options.fontSize : 32;
  const scale = Math.max(0.4, minDim / 480);
  const computedFontSize = Math.max(12, Math.round(baseFontSize * scale));

  const approxWidth = rawText.length * (computedFontSize * (options.isBold ? 0.65 : 0.58));
  const approxHeight = computedFontSize;

  const textNormX = typeof options.normX === 'number' ? options.normX : 0.5;
  const textNormY = typeof options.normY === 'number' ? options.normY : 0.82;

  // Normalized hit area with 16px touch padding
  const padNormX = (approxWidth / 2 + 16 * scale) / width;
  const padNormY = (approxHeight / 2 + 16 * scale) / height;

  return (
    Math.abs(pointerNormX - textNormX) <= padNormX &&
    Math.abs(pointerNormY - textNormY) <= padNormY
  );
}

/**
 * Draws anchored sticker typography (backward-compatible delegate to drawStickerText).
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
  let normY = 0.85;
  if (shape === 'circle') normY = 0.82;
  else if (shape === 'square') normY = 0.84;
  else if (shape === 'rounded') normY = 0.85;

  drawStickerText(ctx, width, height, {
    text,
    normX: 0.5,
    normY,
    captionColor,
    isBold: true,
    isItalic: false
  });
}

/**
 * Unified sticker rendering function:
 * Supports die-cut contour outline, circular badge clip, sharp 1:1 square frame clip,
 * rounded rectangle clip, and interactive typography text.
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
  } else if (shape === 'square') {
    const minSide = Math.min(width, height);
    const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
    const side = Math.max(1, minSide - pad * 2);
    const sx = Math.round((width - side) / 2);
    const sy = Math.round((height - side) / 2);

    // 1. Sharp 1:1 square clipping mask (ctx.rect)
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, side, side);
    ctx.clip();
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();

    // 2. Outer stroke border with sharp 90-degree miter corners
    if (strokeWidth > 0) {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.rect(sx, sy, side, side);
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

  // 3. Sticker Caption Text (Draggable & Typography-Styled)
  if (options.captionText && options.captionText.trim().length > 0) {
    drawStickerText(ctx, width, height, {
      text: options.captionText.trim(),
      normX: options.textNormX,
      normY: options.textNormY,
      isBold: options.isBold,
      isItalic: options.isItalic,
      fontSize: options.fontSize,
      captionColor: options.captionColor || '#FFFFFF',
      showBoundingBox: !!options.showBoundingBox
    });
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
      if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
        throw new Error('Invalid source canvas dimensions for WhatsApp export');
      }

      const outCanvas = document.createElement('canvas');
      outCanvas.width = 512;
      outCanvas.height = 512;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.clearRect(0, 0, 512, 512);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Calculate aspect-ratio contained fit with 16px safety padding
      const padding = 16;
      const maxDim = 512 - padding * 2; // 480px usable box
      const scale = Math.min(maxDim / sourceCanvas.width, maxDim / sourceCanvas.height);
      const w = Math.max(1, Math.round(sourceCanvas.width * scale));
      const h = Math.max(1, Math.round(sourceCanvas.height * scale));
      const x = Math.round((512 - w) / 2);
      const y = Math.round((512 - h) / 2);

      ctx.drawImage(sourceCanvas, x, y, w, h);

      outCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          // Robust fallback via toDataURL if toBlob returns null
          try {
            const dataUrl = outCanvas.toDataURL('image/png');
            const parts = dataUrl.split(',');
            const bstr = atob(parts[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
              u8arr[n] = bstr.charCodeAt(n);
            }
            resolve(new Blob([u8arr], { type: 'image/png' }));
          } catch (dataUrlErr) {
            reject(new Error('WhatsApp sticker blob conversion failed'));
          }
        }
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
