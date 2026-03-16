#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// ZTDC Build Pipeline
// src/ (clean, readable) → root (minified + obfuscated for GH Pages)
//
// Usage:
//   node build.js          # full build
//   node build.js --clean  # remove built artifacts only
// ═══════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { minify } = require("html-minifier-terser");
const JavaScriptObfuscator = require("javascript-obfuscator");

// ── Config ───────────────────────────────────────────────
const SRC = path.join(__dirname, "src");
const OUT = __dirname; // root = GH Pages deploy target

const HTML_FILES = ["index.html", "callback.html"];

// Static assets copied as-is (already public / machine-readable)
const STATIC_COPY = [
  "agents.txt",
  ".nojekyll",
  "README.md",
  "contracts",
  "recipes",
];

// JS obfuscator — medium protection, keeps code functional
// "low" preset keeps size manageable; we add string encoding on top
const OBFUSCATOR_OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjection: false, // biggest size contributor — skip for SPA
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false, // safe — don't break window.X refs
  rotateStringArray: true,
  selfDefending: false, // can break in strict-mode contexts
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.6,
  stringArrayWrappersCount: 1,
  transformObjectKeys: false, // reduces bloat from object key transforms
  unicodeEscapeSequence: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: false,
  target: "browser",
  // preserve these so CDN callbacks + DOM APIs still work
  reservedNames: [
    "^google$",
    "^gapi$",
    "^msal$",
    "^GIS$",
    "^onGoogleLibraryLoad$",
  ],
  reservedStrings: [
    "^https://",
    "^wss://",
  ],
};

// html-minifier-terser options
const HTML_MINIFIER_OPTS = {
  collapseWhitespace: true,
  conservativeCollapse: false,
  removeComments: true,
  removeRedundantAttributes: true,
  removeEmptyAttributes: true,
  removeOptionalTags: false, // keep <html><head><body> for safety
  minifyCSS: true, // uses clean-css internally
  minifyJS: false, // we handle JS ourselves via obfuscator
  collapseBooleanAttributes: true,
  sortAttributes: true,
  sortClassName: true,
  decodeEntities: true,
  processConditionalComments: true,
  trimCustomFragments: true,
};

// ── Helpers ──────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = (bytes / 1024).toFixed(1);
  return `${kb} KB`;
}

// ── Core: Extract → Obfuscate → Re-inject ───────────────

/**
 * Find all <script>...</script> blocks (not src= external scripts),
 * obfuscate each one, and return the modified HTML.
 */
function obfuscateInlineScripts(html) {
  // Match <script ...> content </script>, but NOT <script src="...">
  const SCRIPT_RE =
    /(<script(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi;

  let count = 0;
  const result = html.replace(SCRIPT_RE, (match, openTag, jsCode, closeTag) => {
    const trimmed = jsCode.trim();
    if (!trimmed || trimmed.length < 50) {
      // Skip tiny inline handlers or empty scripts
      return match;
    }

    count++;
    try {
      const obfuscated = JavaScriptObfuscator.obfuscate(trimmed, OBFUSCATOR_OPTS);
      return `${openTag}${obfuscated.getObfuscatedCode()}${closeTag}`;
    } catch (err) {
      console.warn(
        `  ⚠ Script block #${count} obfuscation failed, keeping original: ${err.message}`
      );
      return match;
    }
  });

  console.log(`  📦 Obfuscated ${count} inline <script> block(s)`);
  return result;
}

// ── Build Pipeline ───────────────────────────────────────

async function buildHTML(filename) {
  const srcPath = path.join(SRC, filename);
  const outPath = path.join(OUT, filename);

  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠ Source not found: ${srcPath}`);
    return;
  }

  const raw = fs.readFileSync(srcPath, "utf-8");
  const rawSize = Buffer.byteLength(raw);

  console.log(`\n🔨 Building ${filename} (${formatBytes(rawSize)} source)`);

  // Step 1: Obfuscate inline JS
  console.log("  Step 1: Obfuscating JavaScript…");
  const withObfuscatedJS = obfuscateInlineScripts(raw);

  // Step 2: Minify HTML + inline CSS
  console.log("  Step 2: Minifying HTML + CSS…");
  const minified = await minify(withObfuscatedJS, HTML_MINIFIER_OPTS);

  // Step 3: Write output
  fs.writeFileSync(outPath, minified, "utf-8");
  const outSize = Buffer.byteLength(minified);

  // Note: obfuscation can increase JS size, but we still minify HTML/CSS
  const ratio = ((outSize / rawSize) * 100).toFixed(0);
  console.log(
    `  ✅ ${formatBytes(rawSize)} → ${formatBytes(outSize)} (${ratio}% of source)`
  );
}

function copyStatic() {
  console.log("\n📂 Copying static assets…");
  for (const item of STATIC_COPY) {
    const srcPath = path.join(SRC, item);
    const outPath = path.join(OUT, item);

    // Static assets may live at root already (not in src/)
    // Try src/ first, fall back to root
    const actualSrc = fs.existsSync(srcPath) ? srcPath : path.join(OUT, item);
    if (actualSrc === outPath) {
      console.log(`  · ${item} (already at root)`);
      continue;
    }
    if (!fs.existsSync(actualSrc)) {
      console.log(`  · ${item} (not found, skipping)`);
      continue;
    }

    copyRecursive(actualSrc, outPath);
    console.log(`  ✓ ${item}`);
  }
}

function clean() {
  console.log("🧹 Cleaning built HTML files…");
  for (const f of HTML_FILES) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`  ✓ Removed ${f}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--clean")) {
    clean();
    return;
  }

  console.log("═══════════════════════════════════════════");
  console.log(" ZTDC Build Pipeline");
  console.log(" src/ → root (minified + obfuscated)");
  console.log("═══════════════════════════════════════════");

  const start = Date.now();

  // Build HTML files
  for (const f of HTML_FILES) {
    await buildHTML(f);
  }

  // Copy static assets
  copyStatic();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Build complete in ${elapsed}s`);
  console.log("   Deploy: git add . && git commit && git push");
}

main().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
