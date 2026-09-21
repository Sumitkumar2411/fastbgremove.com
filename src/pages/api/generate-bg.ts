import type { APIRoute } from 'astro';

export const prerender = false;

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
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

/**
 * POST /api/generate-bg
 * Generates an AI background using Pollinations AI (Flux model, 100% free, zero keys)
 */
export const POST: APIRoute = async (context) => {
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

    // Construct Pollinations Flux endpoint URL
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      fullPrompt
    )}?width=1024&height=1024&nologo=true&model=flux`;

    // Fetch with 50-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(pollinationsUrl, {
        method: 'GET',
        headers: {
          Accept: 'image/jpeg,image/png,image/*',
          'User-Agent': 'FastBgRemove-Backdrop/1.0',
        },
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return jsonResponse(
          { error: 'Background generation timed out. Please try again with a simpler prompt.' },
          504
        );
      }
      return jsonResponse(
        { error: `Network error reaching image generator: ${fetchErr.message || 'Unknown network error'}` },
        502
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '');
      return jsonResponse(
        { error: `Image generation failed with status ${upstreamRes.status}: ${errText || upstreamRes.statusText}` },
        upstreamRes.status >= 400 && upstreamRes.status < 500 ? upstreamRes.status : 502
      );
    }

    // Process binary image buffer into base64 Data URL
    const arrayBuffer = await upstreamRes.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return jsonResponse(
        { error: 'Image generator returned an empty response. Please try again.' },
        502
      );
    }

    const mimeHeader = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const mimeType = mimeHeader.includes('png') ? 'image/png' : 'image/jpeg';
    const base64Data = arrayBufferToBase64(arrayBuffer);
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    // Return both image and imageUrl for full specification and frontend compatibility
    return jsonResponse({
      image: dataUrl,
      imageUrl: dataUrl,
    });
  } catch (err: any) {
    return jsonResponse(
      { error: `Unexpected internal server error: ${err?.message || 'Unknown error'}` },
      500
    );
  }
};
