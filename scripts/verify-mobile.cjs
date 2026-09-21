const fs = require('fs');
const path = require('path');

let errors = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    errors++;
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

function verifyMobile() {
  console.log('\n--- VERIFYING MOBILE & TOUCH HARDENING ---');

  const indexHtml = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf-8');

  // 1. Header checks
  assert(
    indexHtml.includes('overflow-x-auto no-scrollbar'),
    'Header navigation has overflow-x-auto no-scrollbar container'
  );
  assert(
    indexHtml.includes('px-3 sm:px-6 md:px-8'),
    'Header container has responsive mobile padding px-3 sm:px-6 md:px-8'
  );
  assert(
    indexHtml.includes('w-7 h-7 sm:w-8 sm:h-8'),
    'Header logo has responsive mobile sizing w-7 h-7 sm:w-8 sm:h-8'
  );

  // 2. Dropzone & Workspace Card checks
  assert(
    indexHtml.includes('min-h-[220px] sm:min-h-[340px]'),
    'Dropzone has mobile min-height classes min-h-[220px] sm:min-h-[340px]'
  );
  assert(
    indexHtml.includes('p-4 sm:p-8 md:p-14'),
    'Dropzone has mobile padding classes p-4 sm:p-8 md:p-14'
  );
  assert(
    indexHtml.includes('p-3.5 sm:p-7'),
    'Workspace card has responsive mobile padding p-3.5 sm:p-7'
  );

  // 3. Split Slider Touch Action & Touch Drag
  assert(
    indexHtml.includes('touch-action: none') || indexHtml.includes('touch-none'),
    'Stage box and handle have touch-action: none / touch-none'
  );

  // Check client bundle for touch event listeners
  const astroFiles = fs.readdirSync(path.join(__dirname, '../dist/_astro'));
  const bgRemoverBundle = astroFiles.find(f => f.startsWith('BgRemover') && f.endsWith('.js'));
  assert(bgRemoverBundle !== undefined, 'BgRemover compiled client bundle exists');

  if (bgRemoverBundle) {
    const bundleContent = fs.readFileSync(path.join(__dirname, '../dist/_astro', bgRemoverBundle), 'utf-8');
    assert(bundleContent.includes('touchstart'), 'Compiled client bundle contains touchstart event listener');
    assert(bundleContent.includes('touchmove'), 'Compiled client bundle contains touchmove event listener');
    assert(bundleContent.includes('touchend'), 'Compiled client bundle contains touchend event listener');
    assert(bundleContent.includes('clientX'), 'Compiled client bundle contains clientX touch tracking');
  }

  // 4. Ratio Controls & Action Buttons
  assert(
    indexHtml.includes('shrink-0 whitespace-nowrap'),
    'Ratio segmented control buttons have shrink-0 whitespace-nowrap'
  );
  assert(
    indexHtml.includes('grid grid-cols-2 sm:flex'),
    'Bottom secondary action buttons use 2-column grid on mobile (grid-cols-2 sm:flex)'
  );
  assert(
    indexHtml.includes('Download Full HD PNG'),
    'Download Full HD PNG button exists'
  );

  // 5. Footer checks
  assert(
    indexHtml.includes('grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12'),
    'Footer grid collapses to 1 column on mobile (grid-cols-1 sm:grid-cols-2 lg:grid-cols-4)'
  );
  assert(
    indexHtml.includes('India flag badge'),
    'Indian flag badge exists'
  );

  console.log('\n======================================');
  if (errors === 0) {
    console.log('🎉 ALL MOBILE & TOUCH CRITERIA PASSED (0 ERRORS)!');
  } else {
    console.error(`❌ ENCOUNTERED ${errors} ERRORS DURING MOBILE VERIFICATION.`);
    process.exit(1);
  }
}

verifyMobile();
