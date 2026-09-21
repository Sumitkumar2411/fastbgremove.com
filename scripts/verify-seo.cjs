const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

let errors = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    errors++;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function verifySeo() {
  console.log('\n--- 1. VERIFYING META TAGS & OPEN GRAPH ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf-8');

  // Title
  assert(
    indexHtml.includes('<title>fastbgremove.com – 100% Free HD Background Remover (Zero Upload, Unlimited)</title>'),
    'dist/index.html contains exact production title'
  );

  // Description
  assert(
    indexHtml.includes('<meta name="description" content="Instant, 100% in-browser background removal with zero server uploads. Download full original resolution HD PNGs with no watermarks and no sign-up."'),
    'dist/index.html contains exact production description'
  );

  // Open Graph
  assert(
    indexHtml.includes('<meta property="og:title" content="fastbgremove.com – Free In-Browser Background Remover"'),
    'dist/index.html contains og:title'
  );
  assert(
    indexHtml.includes('<meta property="og:description" content="Remove image backgrounds instantly in HD. 100% private, no sign-up, zero watermarks."'),
    'dist/index.html contains og:description'
  );
  assert(
    indexHtml.includes('<meta property="og:image" content="https://fastbgremove.com/og-image.png"'),
    'dist/index.html contains og:image'
  );
  assert(
    indexHtml.includes('<meta property="og:url" content="https://fastbgremove.com/"'),
    'dist/index.html contains og:url'
  );
  assert(
    indexHtml.includes('<meta name="twitter:card" content="summary_large_image"'),
    'dist/index.html contains twitter:card summary_large_image'
  );

  console.log('\n--- 2. VERIFYING OG IMAGE ---');
  const ogImgDist = path.join(__dirname, '../dist/og-image.png');
  const ogImgPub = path.join(__dirname, '../public/og-image.png');
  assert(fs.existsSync(ogImgPub), 'public/og-image.png exists');
  assert(fs.existsSync(ogImgDist), 'dist/og-image.png copied to build output');

  const meta = await sharp(ogImgDist).metadata();
  assert(meta.width === 1200 && meta.height === 630, `OG image dimensions are 1200x630 (actual: ${meta.width}x${meta.height})`);
  assert(meta.format === 'png', `OG image is PNG format`);

  console.log('\n--- 3. VERIFYING STRICT SINGLE <H1> ACROSS CORE PAGES ---');
  const corePages = [
    { name: '/', file: 'dist/index.html' },
    { name: '/passport-photo-white-background', file: 'dist/passport-photo-white-background/index.html' },
    { name: '/transparent-signature-maker', file: 'dist/transparent-signature-maker/index.html' },
    { name: '/remove-bg-alternative', file: 'dist/remove-bg-alternative/index.html' }
  ];

  for (const page of corePages) {
    const html = fs.readFileSync(path.join(__dirname, '..', page.file), 'utf-8');
    const h1Matches = html.match(/<h1[\s>]/gi) || [];
    assert(h1Matches.length === 1, `Page ${page.name} has strictly 1 <h1> tag (found: ${h1Matches.length})`);
  }

  console.log('\n--- 4. VERIFYING IMG ALT ATTRIBUTES ---');
  // Check all HTML files in dist
  function findHtmlFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(findHtmlFiles(fullPath));
      } else if (file.endsWith('.html')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const htmlFiles = findHtmlFiles(path.join(__dirname, '../dist'));
  let totalImgs = 0;
  let imgsWithoutAlt = 0;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf-8');
    const imgTags = html.match(/<img[^>]*>/gi) || [];
    for (const tag of imgTags) {
      totalImgs++;
      const altMatch = tag.match(/alt="([^"]*)"/i);
      if (!altMatch || altMatch[1].trim() === '') {
        console.error(`Img missing or empty alt in ${path.relative(path.join(__dirname, '..'), file)}: ${tag}`);
        imgsWithoutAlt++;
      }
    }
  }

  assert(totalImgs > 0, `Scanned ${totalImgs} img tags across all generated HTML pages`);
  assert(imgsWithoutAlt === 0, `All img tags have descriptive alt attributes (0 missing)`);

  console.log('\n--- 5. VERIFYING ROBOTS.TXT & SITEMAP ---');
  const robotsTxt = fs.readFileSync(path.join(__dirname, '../dist/robots.txt'), 'utf-8');
  assert(robotsTxt.includes('User-agent: *'), 'robots.txt contains User-agent: *');
  assert(robotsTxt.includes('Allow: /'), 'robots.txt contains Allow: /');
  assert(robotsTxt.includes('Sitemap: https://fastbgremove.com/sitemap.xml'), 'robots.txt contains Sitemap: https://fastbgremove.com/sitemap.xml');

  assert(fs.existsSync(path.join(__dirname, '../dist/sitemap-index.xml')), 'dist/sitemap-index.xml exists');
  assert(fs.existsSync(path.join(__dirname, '../dist/sitemap-0.xml')), 'dist/sitemap-0.xml exists');

  console.log('\n--- 6. VERIFYING JSON-LD STRUCTURED DATA SCHEMA ---');
  const jsonLdRegex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let schemasFound = [];
  while ((match = jsonLdRegex.exec(indexHtml)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      schemasFound.push(parsed);
    } catch (e) {
      assert(false, `JSON-LD parsing error: ${e.message}`);
    }
  }

  const hasSoftwareApp = schemasFound.some(s => s['@type'] === 'SoftwareApplication');
  const hasFaq = schemasFound.some(s => s['@type'] === 'FAQPage');

  assert(hasSoftwareApp, 'JSON-LD SoftwareApplication schema cleanly embedded');
  assert(hasFaq, 'JSON-LD FAQPage schema cleanly embedded');

  console.log('\n======================================');
  if (errors === 0) {
    console.log('🎉 ALL SEO HARDENING CRITERIA PASSED (0 ERRORS)!');
  } else {
    console.error(`❌ ENCOUNTERED ${errors} ERRORS DURING SEO VERIFICATION.`);
    process.exit(1);
  }
}

verifySeo().catch(err => {
  console.error(err);
  process.exit(1);
});
