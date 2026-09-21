const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function generateOgImage() {
  const logoBuffer = fs.readFileSync(path.join(__dirname, '../public/logo.png'));
  const logoBase64 = logoBuffer.toString('base64');

  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#141416" />
      <stop offset="50%" stop-color="#0d0d0f" />
      <stop offset="100%" stop-color="#060608" />
    </linearGradient>
    <radialGradient id="orange-glow" cx="80%" cy="20%" r="55%">
      <stop offset="0%" stop-color="#f54e00" stop-opacity="0.22" />
      <stop offset="70%" stop-color="#f54e00" stop-opacity="0.0" />
    </radialGradient>
    <radialGradient id="bottom-glow" cx="20%" cy="85%" r="45%">
      <stop offset="0%" stop-color="#f54e00" stop-opacity="0.10" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0.0" />
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#26262c" stroke-width="1.2" stroke-opacity="0.3" />
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.8" />
    </filter>
  </defs>

  <!-- Background Layers -->
  <rect width="1200" height="630" fill="url(#bg-grad)" />
  <rect width="1200" height="630" fill="url(#orange-glow)" />
  <rect width="1200" height="630" fill="url(#bottom-glow)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <!-- Outer Border Frame with Orange Geometric Accents -->
  <rect x="28" y="28" width="1144" height="574" rx="18" fill="none" stroke="#2e2e34" stroke-width="2" />
  <rect x="28" y="28" width="48" height="4.5" fill="#f54e00" rx="2" />
  <rect x="28" y="28" width="4.5" height="48" fill="#f54e00" rx="2" />

  <!-- Top Pill / Status Badge -->
  <g transform="translate(80, 75)">
    <rect width="270" height="42" rx="21" fill="#1b1b22" stroke="#383844" stroke-width="1.5" />
    <circle cx="24" cy="21" r="6" fill="#149e61" />
    <text x="42" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="13.5" font-weight="700" fill="#e4e4e7" letter-spacing="0.6">100% CLIENT-SIDE WASM</text>
  </g>

  <!-- Left Side: Brand & Hero Messaging -->
  <g transform="translate(80, 155)">
    <!-- Brand Wordmark -->
    <text x="0" y="48" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="52" font-weight="900" fill="#ffffff" letter-spacing="-1">
      fastbgremove<tspan fill="#f54e00">.com</tspan>
    </text>

    <!-- Main Value Headline -->
    <text x="0" y="116" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="38" font-weight="800" fill="#f4f4f5" letter-spacing="-0.5">
      100% Free HD Background Remover
    </text>

    <!-- Subtitle / Taglines -->
    <text x="0" y="166" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="400" fill="#a1a1aa">
      Instant in-browser background removal with zero server uploads.
    </text>
    <text x="0" y="202" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="400" fill="#a1a1aa">
      Download full original resolution HD PNGs with zero watermarks.
    </text>

    <!-- Badges Row -->
    <g transform="translate(0, 245)">
      <!-- Badge 1: Zero Uploads -->
      <g transform="translate(0, 0)">
        <rect width="180" height="46" rx="8" fill="#191920" stroke="#f54e00" stroke-width="1.5" stroke-opacity="0.4" />
        <text x="20" y="28" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="14.5" font-weight="700" fill="#f54e00">🔒 Zero Uploads</text>
      </g>
      <!-- Badge 2: Full HD Resolution -->
      <g transform="translate(196, 0)">
        <rect width="180" height="46" rx="8" fill="#191920" stroke="#2e2e38" stroke-width="1.5" />
        <text x="20" y="28" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="14.5" font-weight="600" fill="#e4e4e7">⚡ Full HD Export</text>
      </g>
      <!-- Badge 3: No Watermarks -->
      <g transform="translate(392, 0)">
        <rect width="180" height="46" rx="8" fill="#191920" stroke="#2e2e38" stroke-width="1.5" />
        <text x="20" y="28" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="14.5" font-weight="600" fill="#e4e4e7">✨ No Watermark</text>
      </g>
      <!-- Badge 4: No Sign-Up -->
      <g transform="translate(588, 0)">
        <rect width="168" height="46" rx="8" fill="#191920" stroke="#2e2e38" stroke-width="1.5" />
        <text x="20" y="28" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="14.5" font-weight="600" fill="#e4e4e7">🚀 No Sign-Up</text>
      </g>
    </g>
  </g>

  <!-- Right Side: The Elephant Badge Card -->
  <g transform="translate(860, 140)" filter="url(#shadow)">
    <!-- Ambient glow behind elephant -->
    <circle cx="140" cy="140" r="150" fill="#f54e00" fill-opacity="0.12" />
    <!-- Elephant circular border ring -->
    <circle cx="140" cy="140" r="142" fill="#18181f" stroke="#f54e00" stroke-width="3.5" stroke-opacity="0.75" />
    
    <!-- Clip elephant to circle -->
    <clipPath id="circleClip">
      <circle cx="140" cy="140" r="135" />
    </clipPath>
    <image href="data:image/png;base64,${logoBase64}" x="5" y="5" width="270" height="270" clip-path="url(#circleClip)" />
    
    <!-- Decorative Tag below badge -->
    <g transform="translate(35, 298)">
      <rect width="210" height="34" rx="17" fill="#f54e00" />
      <text x="105" y="22" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="13" font-weight="800" fill="#ffffff" letter-spacing="1">PRIVACY BY ISOLATION</text>
    </g>
  </g>

  <!-- Bottom Footer Line -->
  <g transform="translate(80, 545)">
    <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-size="15" font-weight="500" fill="#71717a">
      Free In-Browser Utility • Passport White Background • Transparent Signature Maker • Zero Cloud Storage
    </text>
  </g>
</svg>
`;

  const outputPathSvg = path.join(__dirname, '../public/og-image.svg');
  const outputPathPng = path.join(__dirname, '../public/og-image.png');

  fs.writeFileSync(outputPathSvg, svg.trim());
  console.log('Saved SVG to:', outputPathSvg);

  await sharp(Buffer.from(svg))
    .resize(1200, 630)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(outputPathPng);

  const meta = await sharp(outputPathPng).metadata();
  console.log(`Successfully generated ${outputPathPng}: ${meta.width}x${meta.height}, format: ${meta.format}, size: ${meta.size} bytes`);
}

generateOgImage().catch(console.error);
