// ============================================================================
// Feature 8 - Admin/User Mode for monitor.html + server.js route
// Run: node feature8-admin-user-mode.js
// Location: Run from C:\Aplicaciones\mi-servidor-web-v2
// ============================================================================
const fs = require('fs');
const path = require('path');

// ===================== PATCH 1: monitor.html =====================
var monitorPath = path.join(__dirname, 'public', 'monitor.html');
var mc = fs.readFileSync(monitorPath, 'utf8');
console.log('[INFO] Read monitor.html (' + mc.length + ' chars)');

if (mc.includes('var isAdmin')) {
  console.log('[SKIP] monitor.html already patched with isAdmin');
} else {

  // --- 1A: Add CSS for viewer-mode before </style> ---
  var viewerCSS = [
    '',
    '        /* === Admin/User Mode (Feature 8) === */',
    '        .viewer-mode .csv-url-display { display: none !important; }',
    '        .viewer-mode .design-ct-display { cursor: default !important; }',
    '        .viewer-mode .equipment-name a { pointer-events: none; border-bottom-color: transparent !important; cursor: default; text-decoration: none !important; }'
  ].join('\n');

  mc = mc.replace('    </style>', viewerCSS + '\n    </style>');
  console.log('[OK] viewer-mode CSS added');

  // --- 1B: Replace lineCode parsing with isAdmin-aware version ---
  var oldLineCode = 'var lineCode = window.location.pathname.split("/")[2] || "GPEC5_L1";';
  if (!mc.includes(oldLineCode)) {
    console.error('[ERROR] Could not find lineCode declaration');
    process.exit(1);
  }

  var newLineCode = [
    'var pathParts = window.location.pathname.split("/");',
    '        var isAdmin = pathParts[1] === "admin";',
    '        var lineCode = isAdmin ? (pathParts[3] || "GPEC5_L1") : (pathParts[2] || "GPEC5_L1");',
    '        if (!isAdmin) document.body.classList.add("viewer-mode");'
  ].join('\n');

  mc = mc.replace(oldLineCode, newLineCode);
  console.log('[OK] isAdmin flag + lineCode parsing updated');

  // --- 1C: Update header/back-arrow for admin mode ---
  var oldTitleLine = "document.title = 'VSM ' + lineDisplay + ' - Monitor';";
  if (mc.includes(oldTitleLine)) {
    var adminAwareness = [
      oldTitleLine,
      '        if (isAdmin) {',
      '            var backLink = document.querySelector("a[href=\'/\']");',
      '            if (backLink) backLink.href = "/admin";',
      "            document.getElementById('line-title').textContent = 'VSM Admin Monitor - ' + lineDisplay;",
      "            document.title = 'VSM ' + lineDisplay + ' - Admin Monitor';",
      '        }'
    ].join('\n');
    mc = mc.replace(oldTitleLine, adminAwareness);
    console.log('[OK] Admin header/title/back-link added');
  }

  // --- 1D: Add guard to editDesignCT function ---
  var oldEditCT = 'function editDesignCT(equipmentId, currentValue) {';
  if (mc.includes(oldEditCT)) {
    mc = mc.replace(oldEditCT, oldEditCT + '\n            if (!isAdmin) return;');
    console.log('[OK] editDesignCT guard added');
  }

  // --- 1E: Add guard to editCsvUrl function ---
  var oldEditUrl = 'function editCsvUrl(equipmentId, currentUrl) {';
  if (mc.includes(oldEditUrl)) {
    mc = mc.replace(oldEditUrl, oldEditUrl + '\n            if (!isAdmin) return;');
    console.log('[OK] editCsvUrl guard added');
  } else {
    // Try alternate signature
    var altEditUrl = 'function editCsvUrl(equipmentId, currentValue) {';
    if (mc.includes(altEditUrl)) {
      mc = mc.replace(altEditUrl, altEditUrl + '\n            if (!isAdmin) return;');
      console.log('[OK] editCsvUrl guard added (alt signature)');
    } else {
      console.log('[WARN] editCsvUrl function not found - check manually');
    }
  }

  // --- Write monitor.html ---
  fs.writeFileSync(monitorPath, mc, 'utf8');
  console.log('[OK] monitor.html patched (' + mc.length + ' chars)');
}

// ===================== PATCH 2: server.js =====================
var serverPath = path.join(__dirname, 'src', 'presentation', 'api', 'server.js');
var sc = fs.readFileSync(serverPath, 'utf8');
console.log('[INFO] Read server.js (' + sc.length + ' chars)');

if (sc.includes('/admin/monitor/:lineCode')) {
  console.log('[SKIP] server.js already has /admin/monitor route');
} else {
  // Insert admin/monitor route right after the existing monitor route
  var monitorRoute = "app.get('/monitor/:lineCode', (req, res) => {";
  if (!sc.includes(monitorRoute)) {
    console.error('[ERROR] Could not find /monitor/:lineCode route');
    process.exit(1);
  }

  // Find the full route block (it's a few lines)
  var routeBlock = "app.get('/monitor/:lineCode', (req, res) => {\n        res.sendFile('monitor.html', { root: publicPath });\n    });";
  
  // Try to find it
  if (sc.includes(routeBlock)) {
    var adminRoute = routeBlock + "\n\n    // Admin monitor - same page, admin mode detected by URL\n    app.get('/admin/monitor/:lineCode', (req, res) => {\n        res.sendFile('monitor.html', { root: publicPath });\n    });";
    sc = sc.replace(routeBlock, adminRoute);
    console.log('[OK] /admin/monitor/:lineCode route added');
  } else {
    // Alternate: find just the app.get line and insert after the closing });
    var idx = sc.indexOf(monitorRoute);
    var closingIdx = sc.indexOf('});', idx) + 3;
    var insertStr = "\n\n    // Admin monitor - same page, admin mode detected by URL\n    app.get('/admin/monitor/:lineCode', (req, res) => {\n        res.sendFile('monitor.html', { root: publicPath });\n    });";
    sc = sc.substring(0, closingIdx) + insertStr + sc.substring(closingIdx);
    console.log('[OK] /admin/monitor/:lineCode route added (alt method)');
  }

  fs.writeFileSync(serverPath, sc, 'utf8');
  console.log('[OK] server.js patched (' + sc.length + ' chars)');
}

// --- Also update admin.html "View" link to point to /admin/monitor/ ---
var adminPath = path.join(__dirname, 'public', 'admin.html');
var ac = fs.readFileSync(adminPath, 'utf8');

if (ac.includes('/admin/monitor/')) {
  console.log('[SKIP] admin.html already points to /admin/monitor/');
} else {
  // The lines tab has links like: <a href=/monitor/ + line_code
  ac = ac.replace(
    "\"<td><a href=/monitor/\" + l.line_code + \" class=monitor-link>View &rarr;</a></td>\"",
    "\"<td><a href=/admin/monitor/\" + l.line_code + \" class=monitor-link>View &rarr;</a></td>\""
  );
  fs.writeFileSync(adminPath, ac, 'utf8');
  console.log('[OK] admin.html View links updated to /admin/monitor/');
}

console.log('');
console.log('[DONE] All patches applied');
console.log('');
console.log('[IMPORTANT] Restart service:');
console.log('  Restart-Service VSM-API -Force');
console.log('');
console.log('[TEST URLS]');
console.log('  User mode:  http://10.3.0.200:3000/monitor/GPEC5_L1');
console.log('    - No CSV URL visible');
console.log('    - Design CT visible but NOT clickable');
console.log('    - Equipment names are plain text (no links)');
console.log('');
console.log('  Admin mode: http://10.3.0.200:3000/admin/monitor/GPEC5_L1');
console.log('    - CSV URL visible + editable');
console.log('    - Design CT clickable to edit');
console.log('    - Equipment names are hyperlinks');
console.log('    - Header shows "Admin Monitor"');
console.log('    - Back arrow goes to /admin');
