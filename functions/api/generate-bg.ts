const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Convert ArrayBuffer to base64 string safely across Node and Cloudflare Worker runtimes
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Handle CORS preflight
 */
export const onRequestOptions = async (): Promise<Response> => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

/**
 * POST /api/generate-bg
 * Generates an AI background using Pollinations AI (Flux model, 100% free, zero keys)
 */
export const onRequestPost = async (context: {
  request: Request;
}): Promise<Response> => {
  try {
    const { request } = context;

    // Validate request content type
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return jsonResponse(
        { error: 'Invalid Content-Type. Please send application/json.' },
        400
      );
    }

    // Parse JSON body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Malformed JSON in request body.' }, 400);
    }

    // Extract & validate prompt
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!rawPrompt) {
      return jsonResponse(
        { error: 'Prompt is required and cannot be empty.' },
        400
      );
    }

    if (rawPrompt.length > 1000) {
      return jsonResponse(
        { error: 'Prompt exceeds the 1000 character limit.' },
        400
      );
    }

    // Enhance prompt for high quality studio backdrop
    const fullPrompt = `${rawPrompt}, high quality, photorealistic, professional photography, 8k, background only, empty space for product cutout`;

    // Direct flux model with random seed to prevent collisions / rate limits
    const randomSeed = Math.floor(Math.random() * 1000000);
    const primaryUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      fullPrompt
    )}?width=1024&height=1024&nologo=true&model=flux&seed=${randomSeed}`;
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      fullPrompt
    )}?width=1024&height=1024&nologo=true&seed=${randomSeed}`;

    const fetchImageBuffer = async (
      url: string,
      timeoutMs: number
    ): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'image/jpeg,image/png,image/*',
            'User-Agent': 'FastBgRemove-Backdrop/1.0',
          },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (!buf || buf.byteLength === 0) return null;
        const mimeHeader = res.headers.get('content-type') || 'image/jpeg';
        const mimeType = mimeHeader.includes('png') ? 'image/png' : 'image/jpeg';
        return { buffer: buf, mimeType };
      } catch {
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // 1. Try primary direct flux model with random seed
    let result = await fetchImageBuffer(primaryUrl, 30000);

    // 2. If primary fails with non-200 or timeout, try fallback URL
    if (!result) {
      result = await fetchImageBuffer(fallbackUrl, 25000);
    }

    if (!result) {
      return jsonResponse(
        { error: 'AI server busy, please try again in a few seconds.' },
        429
      );
    }

    const base64Data = arrayBufferToBase64(result.buffer);
    const dataUrl = `data:${result.mimeType};base64,${base64Data}`;

    // Return both image and imageUrl for full specification and frontend compatibility
    return jsonResponse({
      image: dataUrl,
      imageUrl: dataUrl,
    });
  } catch {
    return jsonResponse(
      { error: 'AI server busy, please try again in a few seconds.' },
      500
    );
  }
};
