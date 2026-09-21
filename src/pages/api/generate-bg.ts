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
 * Handle CORS preflight
 */
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

/**
 * Helper to call Google Imagen 3 (imagen-3.0-generate-002:predict)
 */
async function callImagen(apiKey: string, prompt: string, signal: AbortSignal) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  return res;
}

/**
 * Helper to call Google Gemini Image model (generateContent with responseModalities: ["IMAGE"])
 */
async function callGeminiImage(apiKey: string, modelName: string, prompt: string, signal: AbortSignal) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `Generate a high quality, clean photo background: ${prompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  return res;
}

/**
 * POST /api/generate-bg
 * Generates an AI background using Google Imagen 3 with Gemini image fallback
 */
export const POST: APIRoute = async (context) => {
  try {
    const { request, locals } = context;

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

    // Read API key from Cloudflare runtime env or process.env
    const runtimeEnv = (locals as any)?.runtime?.env || (context as any)?.env || {};
    const apiKey =
      runtimeEnv.GEMINI_API_KEY ||
      (context as any)?.env?.GEMINI_API_KEY ||
      (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '');

    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'GEMINI_API_KEY is not configured on Cloudflare. Please configure it in Cloudflare Pages secrets.',
        },
        500
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
      // 1. Try Imagen 3 primary endpoint
      let upstreamRes = await callImagen(apiKey, prompt, controller.signal);

      // 2. If Imagen model returns 404 (not found / not supported for predict on this key),
      // seamlessly try available Gemini image models
      if (upstreamRes.status === 404) {
        const candidateModels = [
          'gemini-3.1-flash-lite-image',
          'gemini-3.1-flash-image',
          'gemini-2.5-flash-image',
          'gemini-3-pro-image',
        ];

        for (const model of candidateModels) {
          upstreamRes = await callGeminiImage(apiKey, model, prompt, controller.signal);
          if (upstreamRes.status === 200) {
            break;
          }
          // If 404 (model not found) or 429 with limit 0, try next candidate
          if (upstreamRes.status === 404) continue;
          if (upstreamRes.status === 429) {
            const clone = upstreamRes.clone();
            const text = await clone.text().catch(() => '');
            if (text.includes('limit: 0')) {
              continue;
            }
            break; // Standard rate limit, don't keep hammering
          }
          break;
        }
      }

      // Handle Rate Limiting (429)
      if (upstreamRes.status === 429) {
        const text = await upstreamRes.text().catch(() => '');
        let upstreamMessage = '';
        try {
          const parsed = JSON.parse(text);
          upstreamMessage = parsed?.error?.message || text;
        } catch {
          upstreamMessage = text;
        }

        if (upstreamMessage.includes('limit: 0')) {
          return jsonResponse(
            {
              error:
                'Google AI Image Generation requires a billing-enabled Gemini API key (Google free tier quota for image generation is 0). Please enable Pay-As-You-Go in Google AI Studio.',
            },
            429
          );
        }

        return jsonResponse(
          { error: `Google AI rate limit (429): ${upstreamMessage || 'Quota exceeded'}` },
          429
        );
      }

      // Handle non-200 responses
      if (!upstreamRes.ok) {
        const errorJson = await upstreamRes.json().catch(() => null);
        const upstreamMessage =
          errorJson?.error?.message ||
          `Google AI generation failed with HTTP ${upstreamRes.status}: ${upstreamRes.statusText}`;

        if (upstreamRes.status === 400 && upstreamMessage.toLowerCase().includes('safety')) {
          return jsonResponse(
            { error: 'The prompt was flagged by Google AI safety guidelines. Please modify your description.' },
            400
          );
        }

        return jsonResponse(
          { error: upstreamMessage },
          upstreamRes.status >= 400 && upstreamRes.status < 500 ? upstreamRes.status : 502
        );
      }

      const data: any = await upstreamRes.json();

      // Extract image from Imagen 3 format
      let base64Bytes: string | undefined;
      let mimeType = 'image/jpeg';

      if (data?.predictions?.[0]) {
        const prediction = data.predictions[0];
        base64Bytes =
          prediction?.bytesBase64Encoded ||
          prediction?.image?.imageBytes ||
          prediction?.imageBytes;
        if (prediction?.mimeType) {
          mimeType = prediction.mimeType;
        }
      }

      // Extract image from Gemini generateContent format
      if (!base64Bytes && data?.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part?.inlineData?.data) {
            base64Bytes = part.inlineData.data;
            mimeType = part.inlineData.mimeType || 'image/png';
            break;
          }
        }
      }

      if (!base64Bytes) {
        return jsonResponse(
          { error: 'No image data was returned by the AI model. Please try a different prompt.' },
          422
        );
      }

      const imageUrl = `data:${mimeType};base64,${base64Bytes}`;
      return jsonResponse({ imageUrl });
    } catch (fetchErr: any) {
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
  } catch (err: any) {
    return jsonResponse(
      { error: `Unexpected internal server error: ${err?.message || 'Unknown error'}` },
      500
    );
  }
};
