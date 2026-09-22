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

function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    h.startsWith('169.254.')
  );
}

function extractImageFromHtml(html: string): string | null {
  // Regex to match <meta ...> tags in any attribute order
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const isTargetMeta =
      /property\s*=\s*["'](og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)["']/i.test(tag) ||
      /name\s*=\s*["'](og:image|twitter:image|twitter:image:src)["']/i.test(tag) ||
      /itemprop\s*=\s*["']image["']/i.test(tag);

    if (isTargetMeta) {
      const contentMatch = tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if (contentMatch && contentMatch[1]) {
        return contentMatch[1].trim();
      }
    }
  }

  // Also check <link rel="image_src" href="..."> or apple-touch-icon
  const linkMatch =
    html.match(/<link\s+[^>]*rel\s*=\s*["'](?:image_src|apple-touch-icon)["'][^>]*href\s*=\s*["']([^"']+)["']/i) ||
    html.match(/<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'](?:image_src|apple-touch-icon)["']/i);
  if (linkMatch && linkMatch[1]) {
    return linkMatch[1].trim();
  }

  return null;
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
 * Proxies external image URLs to avoid CORS issues and loads them safely into FastBgRemove.
 * Supports direct images (AVIF, WebP, PNG, JPG, SVG) and HTML pages (scrapes og:image / twitter:image).
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
    if (isForbiddenHost(parsedUrl.hostname)) {
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
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept':
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/html;q=0.9,*/*;q=0.8',
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

    let contentType = upstreamRes.headers.get('content-type') || 'image/png';
    let lowerContentType = contentType.toLowerCase();

    // HTML Page Fallback: if user pasted a webpage link, scrape og:image / twitter:image
    if (lowerContentType.includes('text/html')) {
      const htmlText = await upstreamRes.text();
      const extractedImageUrl = extractImageFromHtml(htmlText);

      if (!extractedImageUrl) {
        return jsonError(
          'The provided webpage did not contain a preview image (og:image or twitter:image). Please copy the direct image address.',
          400
        );
      }

      // Resolve relative URLs and normalize
      let resolvedUrl: URL;
      try {
        let cleanExtracted = extractedImageUrl.replace(/&amp;/g, '&');
        if (cleanExtracted.startsWith('//')) {
          cleanExtracted = `https:${cleanExtracted}`;
        }
        resolvedUrl = new URL(cleanExtracted, targetUrl);
      } catch {
        return jsonError('The webpage contains an invalid preview image URL.', 400);
      }

      if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
        return jsonError('Invalid image URL found in webpage metadata.', 400);
      }

      if (isForbiddenHost(resolvedUrl.hostname)) {
        return jsonError('The webpage image URL targets a forbidden private network.', 403);
      }

      // Fetch the extracted image
      const imageController = new AbortController();
      const imgTimeoutId = setTimeout(() => imageController.abort(), 15000);
      let imgRes: Response;
      try {
        imgRes = await fetch(resolvedUrl.href, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
          signal: imageController.signal,
        });
      } catch (err: any) {
        clearTimeout(imgTimeoutId);
        if (err.name === 'AbortError') {
          return jsonError('Timed out fetching preview image from the webpage.', 504);
        }
        return jsonError('Failed to fetch the preview image extracted from the webpage.', 502);
      } finally {
        clearTimeout(imgTimeoutId);
      }

      if (!imgRes.ok) {
        return jsonError(
          `Webpage preview image failed to load: remote server returned HTTP ${imgRes.status}`,
          502
        );
      }

      contentType = imgRes.headers.get('content-type') || 'image/png';
      lowerContentType = contentType.toLowerCase();

      if (
        !lowerContentType.startsWith('image/') &&
        !lowerContentType.includes('application/octet-stream')
      ) {
        return jsonError(
          `The extracted link is not a valid image format (Content-Type: ${contentType}).`,
          400
        );
      }

      const buffer = await imgRes.arrayBuffer();
      return new Response(buffer, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // Verify the direct response is an image or binary
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return jsonError('Internal server error while proxying image.', 500);
  }
};
