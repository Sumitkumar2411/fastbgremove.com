import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
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
 * GET /api/fetch-image?url=...
 * Proxies external image URLs to avoid CORS issues and loads them safely into FastBgRemove
 */
export const GET: APIRoute = async (context) => {
  try {
    const { request } = context;
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url')?.trim();

    if (!targetUrl) {
      return jsonError('Missing "url" query parameter.', 400);
    }

    // Validate URL syntax
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return jsonError('Invalid URL provided.', 400);
    }

    // Protocol validation
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return jsonError('Invalid protocol. Only HTTP and HTTPS URLs are supported.', 400);
    }

    // SSRF protection: reject local and internal private networks
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('169.254.')
    ) {
      return jsonError('Access to local and private network addresses is forbidden.', 403);
    }

    // Fetch upstream image with a 15-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return jsonError('Image fetch timed out. The remote host took too long to respond.', 504);
      }
      return jsonError('Failed to connect to the remote image server.', 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstreamRes.ok) {
      return jsonError(
        `Failed to fetch image: remote server returned HTTP ${upstreamRes.status} (${upstreamRes.statusText})`,
        upstreamRes.status >= 400 && upstreamRes.status < 600 ? upstreamRes.status : 502
      );
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/png';

    // Verify the response is an image or binary
    const lowerContentType = contentType.toLowerCase();
    if (
      !lowerContentType.startsWith('image/') &&
      !lowerContentType.includes('application/octet-stream')
    ) {
      return jsonError(
        `The requested URL does not appear to be an image (Content-Type: ${contentType}).`,
        400
      );
    }

    const buffer = await upstreamRes.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return jsonError('Internal server error while proxying image.', 500);
  }
};
