interface Env {
  GEMINI_API_KEY?: string;
  [key: string]: any;
}

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
 * Generates an AI background using Google Imagen 3 (imagen-3.0-generate-002)
 */
export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  try {
    const { request, env } = context;

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
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return jsonResponse(
        { error: 'Prompt is required and cannot be empty.' },
        400
      );
    }

    if (prompt.length > 1000) {
      return jsonResponse(
        { error: 'Prompt exceeds the 1000 character limit.' },
        400
      );
    }

    // Retrieve Gemini / Google AI API Key from environment
    const apiKey =
      env?.GEMINI_API_KEY ||
      (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '');

    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'GEMINI_API_KEY is not configured on Cloudflare. Please configure it in Cloudflare Pages secrets (npx wrangler pages secret put GEMINI_API_KEY --project-name=fastbgremove).',
        },
        500
      );
    }

    // Endpoint for Imagen 3 generation
    const googleEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(
      apiKey
    )}`;

    const requestPayload = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1',
      },
    };

    // Upstream request with a 45-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(googleEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return jsonResponse(
          { error: 'Image generation timed out after 45 seconds. Please try again with a simpler prompt.' },
          504
        );
      }
      return jsonResponse(
        { error: `Network error reaching Google AI: ${fetchErr.message || 'Unknown network error'}` },
        502
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Rate-limiting check (HTTP 429)
    if (upstreamRes.status === 429) {
      return jsonResponse(
        {
          error:
            'Google Imagen rate limit reached. Please wait a few moments before trying again.',
        },
        429
      );
    }

    // Handle non-200 responses from Google API
    if (!upstreamRes.ok) {
      const errorJson = await upstreamRes.json().catch(() => null);
      const upstreamMessage =
        errorJson?.error?.message ||
        `Google AI generation failed with HTTP ${upstreamRes.status}: ${upstreamRes.statusText}`;

      // Check if prompt violated safety policies
      if (upstreamRes.status === 400 && upstreamMessage.toLowerCase().includes('safety')) {
        return jsonResponse(
          {
            error:
              'The prompt was flagged by Google AI safety guidelines. Please modify your description.',
          },
          400
        );
      }

      return jsonResponse({ error: upstreamMessage }, upstreamRes.status >= 400 && upstreamRes.status < 500 ? upstreamRes.status : 502);
    }

    const data: any = await upstreamRes.json();

    // Extract base64 image data from Imagen 3 predict response
    const prediction = data?.predictions?.[0];
    const base64Bytes =
      prediction?.bytesBase64Encoded ||
      prediction?.image?.imageBytes ||
      prediction?.imageBytes;

    if (!base64Bytes) {
      return jsonResponse(
        {
          error:
            'No image returned by model. The prompt may have been filtered by safety checks.',
        },
        422
      );
    }

    const mimeType = prediction?.mimeType || 'image/jpeg';
    const imageUrl = `data:${mimeType};base64,${base64Bytes}`;

    return jsonResponse({ imageUrl });
  } catch (err: any) {
    return jsonResponse(
      {
        error: `Unexpected internal server error: ${err?.message || 'Unknown error'}`,
      },
      500
    );
  }
};
