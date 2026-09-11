// schwab-screenshotter.test.mjs
//   bash scripts/with-node.sh node --test src/schwab-share-card/schwab-screenshotter.test.mjs
//   bash scripts/with-node.sh node --test --test-name-pattern "build-output" src/schwab-share-card/schwab-screenshotter.test.mjs
// Node 20+, no dependencies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  armPicker,
  buildCard,
  canBuildCard,
  cardOptions,
  canvasToPngBlob,
  clipboardBlocker,
  collapse,
  findPositionRow,
  findDayCells,
  findTotalCells,
  fitFont,
  formatDollars,
  formatPercent,
  formatQuantity,
  formatShareTime,
  highlightRect,
  isParentRow,
  main,
  openingSideLabel,
  paintCard,
  parsePositionRow,
  parseSignedDollars,
  parseSignedPercent,
  readHeaderTexts,
  readInstrument,
  readLabeledText,
  readParentIdentity,
  readParentQuantity,
  readQuantity,
  readRowIdentity,
  rectOf,
  renderCard,
  rowCells,
  runFlow,
  showChooser,
  showToast,
  textOf,
  toneOf,
  writePngToClipboard,
  ACCENT,
  BANNER_TEXT,
  CARD_H,
  CARD_THEME,
  CARD_W,
  CHOOSER_HINT_TEXT,
  CHOOSER_MODES,
  CHOOSER_TITLE,
  CHOOSER_TOGGLES,
  CLIPBOARD_MESSAGES,
  HIGHLIGHT_WIDTH,
  MAX_WALK,
  NO_ROW_TEXT,
  PREVIEW_ERROR,
  TOAST_OK_TEXT,
} from './schwab-screenshotter.mjs';
import {
  buildBookmarklet,
  buildInstallPage,
  decodeBookmarklet,
  encodeBody,
  squeezeLine,
  stripModule,
  INSTALL_PATH,
  MAX_BYTES,
  MODULE_PATH,
  OUTPUT_PATH,
  URL_UNSAFE_RE,
} from './build.mjs';

// Every way a script could reach an endpoint, load a resource, run remote code
// or persist data, checked as plain substrings of the squeezed module and of
// the built bookmarklet by the no-network tests. README.md's Privacy section
// points here. Shortening this list is a planning decision, not a fix. The
// navigator entries name members rather than the object, because
// navigator.clipboard is the one capability this program exists to use and
// no-network-static asserts it is still reached.
export const FORBIDDEN_TOKENS = [
  'fetch', 'XMLHttpRequest', 'XDomainRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'Image', 'importScripts', 'import(', 'require(', '<script', 'iframe',
  "createElement('script", "createElement('img", "createElement('link", '.src',
  'Worker', 'SharedWorker', 'serviceWorker', 'RTCPeerConnection', 'postMessage',
  'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'eval(', 'Function(', 'document.write', 'navigator.geolocation',
  'navigator.credentials', 'navigator.mediaDevices', 'navigator.connection',
  '@import', 'url(',
];
// "<scheme>://..." up to whitespace, a quote or a closing paren.
const SCHEME_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/g;
// Anything shaped like a hostname on a common TLD. The lookahead keeps a
// property access such as card.mode from reading as ".co".
const HOSTNAME_RE = /[A-Za-z0-9.-]+\.(?:com|net|io|org|co)(?![A-Za-z0-9_])/g;

test('skeleton', () => {
  assert.equal(collapse('  ACME\u00a0\u00a0 281215C00240000 '), 'ACME 281215C00240000');
  assert.equal(
    textOf({ children: [{ textContent: 'ACME' }, { textContent: '281215C00240000' }] }),
    'ACME\n281215C00240000',
  );
  assert.equal(BANNER_TEXT, 'Click a position (Esc to cancel)');
  assert.equal(ACCENT, '#00A0DF');
});

test('build-output', () => {
  const moduleSource = readFileSync(MODULE_PATH, 'utf8');

  // the line squeezer keeps string contents and only drops space next to punctuation
  assert.equal(squeezeLine("const a = { b: 'x y', c: \"p q\" };"), "const a={b:'x y',c:\"p q\"};");
  assert.equal(squeezeLine('return typeof x === \'string\' ? x : null;'), "return typeof x==='string'?x:null;");
  assert.equal(squeezeLine('const s = "a \\" b";'), 'const s="a \\" b";');
  assert.equal(squeezeLine('if (a - 1 > b) { return a - -1; }'), 'if(a - 1>b){return a - -1;}');

  // only what a bookmark, a URL parser or an href cannot carry raw is escaped
  assert.equal(
    encodeBody('a b{c:1,d}; e=f?g&h<i>j%k"l"#m'),
    'a%20b{c:1,d};%20e=f%3Fg%26h%3Ci%3Ej%25k%22l%22%23m',
  );
  assert.equal(encodeBody('\t\n\u00a0\u2014'), '%09%0A%C2%A0%E2%80%94');
  // and the rule that reads a built URL back agrees with it, character for
  // character: each one bites, and an escape triple is left alone
  for (const ch of [' ', '\t', '\n', '\r', '"', '#', '&', '<', '>', '?', '\u00a0']) {
    assert.ok(URL_UNSAFE_RE.test('javascript:a' + ch + 'b'), JSON.stringify(ch) + ' is carried raw');
  }
  assert.ok(URL_UNSAFE_RE.test('javascript:a%zzb'), 'a stray percent is not caught');
  assert.equal(URL_UNSAFE_RE.test('javascript:a%20b%C2%A0c'), false);

  const url = buildBookmarklet(moduleSource);
  assert.ok(url.startsWith('javascript:'), url.slice(0, 40));
  assert.equal(MAX_BYTES, 32768);
  assert.ok(Buffer.byteLength(url) < MAX_BYTES, 'bookmarklet is ' + Buffer.byteLength(url) + ' bytes');
  assert.equal(URL_UNSAFE_RE.test(url), false, 'the built URL carries a character a bookmark would mangle');
  // the whole route rests on this: the narrow escape set is exactly invertible
  assert.equal('javascript:' + encodeBody(decodeBookmarklet(url)), url);
  assert.ok(
    Buffer.byteLength(url) < Buffer.byteLength('javascript:' + encodeURIComponent(decodeBookmarklet(url))),
    'the narrow escape set costs more than encodeURIComponent',
  );

  const body = decodeBookmarklet(url);
  assert.doesNotThrow(() => new Function(body));
  assert.ok(body.startsWith('(()=>{'));
  assert.ok(body.endsWith('main();})();'));
  assert.equal((body.match(/\bmain\(\);/g) || []).length, 1, 'exactly one main() call');
  assert.ok(!/\bexport\b/.test(body), 'no export keywords survive');
  assert.ok(!/@bookmarklet-strip/.test(body), 'the auto-run guard is removed');
  assert.ok(!/^\s*\/\//m.test(body), 'no comment lines survive');
  assert.throws(() => decodeBookmarklet('https://example.com/'), /not a javascript: URL/);

  // the squeezed script behaves like the module it was built from
  const api = new Function(stripModule(moduleSource) + '\nreturn { collapse, textOf, BANNER_TEXT, ACCENT };')();
  assert.equal(api.collapse('  ACME\u00a0\u00a0 281215C00240000 '), collapse('  ACME\u00a0\u00a0 281215C00240000 '));
  assert.equal(api.textOf({ children: [{ textContent: 'APP' }] }), 'APP');
  assert.equal(api.BANNER_TEXT, BANNER_TEXT);
  assert.equal(api.ACCENT, ACCENT);

  // the committed artifact is a fresh build
  const committed = readFileSync(OUTPUT_PATH, 'utf8').trim();
  assert.equal(committed, url, 'schwab-screenshotter.bookmarklet.txt is stale; run bash scripts/with-node.sh node src/schwab-share-card/build.mjs');
  assert.ok(committed.startsWith('javascript:'));
  assert.ok(Buffer.byteLength(committed) < MAX_BYTES);
  assert.doesNotThrow(() => new Function(decodeBookmarklet(committed)));

  // the install page is generated from the same URL and must not go stale either
  assert.ok(INSTALL_PATH.endsWith(join('docs', 'index.html')), 'the install page is what GitHub Pages serves');
  const page = readFileSync(INSTALL_PATH, 'utf8');
  assert.equal(page, buildInstallPage(url), 'docs/index.html is stale; run bash scripts/with-node.sh node src/schwab-share-card/build.mjs');
  assert.ok(page.includes('href="' + url + '"'), 'the drag link carries the built bookmarklet');
  // The href is no longer percent-encoded past recognition, so the program's
  // own text is read by this scan too: a future src= or url( in the module
  // surfaces here rather than in a browser.
  assert.ok(!/<script|src=|@import|url\(/.test(page), 'the page loads nothing');
  assert.throws(() => buildInstallPage('javascript:a"b'));
  assert.throws(() => buildInstallPage('https://example.com/'));
});

// The synthetic twin of the responsive capture: same markup, invented symbol
// and invented figures, because this tree is exported to a public repository.
const PARENT_FIXTURE = 'positions-parent-acme-short-call.html';

test('fixtures', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
  const cells = (html) => (html.match(/<t[hd][\s>]/g) || []).length;

  const rows = [
    { file: 'shares-zork.html', isOption: 'false', symbol: 'ZORK' },
    { file: 'short-call-acme.html', isOption: 'true', symbol: 'ACME   270115C00050000' },
    { file: 'long-call-acme.html', isOption: 'true', symbol: 'ACME   281215C00240000' },
  ];

  // every synthetic row keeps the hooks the parser selects on
  for (const row of rows) {
    const html = read(row.file);
    assert.ok(html.includes('app-position-row'), row.file + ' is not a position row');
    assert.ok(html.includes('data-symbol="' + row.symbol + '"'), row.file + ' lost its data-symbol padding');
    assert.equal(collapse(row.symbol).split(' ').length, row.isOption === 'true' ? 2 : 1);
    assert.ok(html.includes('data-isoption="' + row.isOption + '"'), row.file + ' has the wrong data-isoption');
    assert.ok(/<td[^>]*\btooltip-column\b/.test(html), row.file + ' has no tooltip-column cell');
    assert.ok(/class="symbolColumn"/.test(html), row.file + ' has no symbol column');
  }

  // the short call is written, so quantity, cost basis and market value are negative
  const shortCall = read('short-call-acme.html');
  assert.ok(shortCall.includes('> -2 <'), 'the written call needs a negative quantity');
  assert.ok(shortCall.includes('> -$2,000.00 <'), 'the written call opens for a credit');
  assert.ok(shortCall.includes('> -$2,065.00 <'), 'the written call carries a negative market value');

  // the offline page is a whole document with a header row the column lookup can align to
  const page = read('positions.html');
  assert.ok(page.startsWith('<!doctype html>'), 'the offline page must open over file://');
  // The href is no longer percent-encoded past recognition, so the program's
  // own text is read by this scan too: a future src= or url( in the module
  // surfaces here rather than in a browser.
  assert.ok(!/<script|src=|@import|url\(/.test(page), 'the page loads nothing');
  assert.ok(page.includes('Gain/Loss %'), 'the header row names the total gain/loss column');
  assert.equal(
    cells(page.match(/<thead>[\s\S]*?<\/thead>/)[0]),
    cells(read('shares-zork.html')),
    'the header row and the equity row must have the same number of cells',
  );
  for (const row of rows) {
    assert.ok(page.includes('data-symbol="' + row.symbol + '"'), 'the page is missing ' + row.file);
  }

  // Nothing from the live captures may reach the public tree. The figures
  // are named once, in the export gate's forbid list, and read from there:
  // spelling them out here would publish them alongside the fixtures they
  // guard. The gate is private and has no counterpart in the exported tree,
  // so this runs wherever the list exists and the export covers the rest.
  // the responsive dialect keeps none of the hooks above: no data- attributes
  // at all, the symbol twice over, screen-reader labels on the figures and a
  // day change that must never be read as the total
  const parent = read(PARENT_FIXTURE);
  assert.ok(/<tr class="positions-parent-row/.test(parent), PARENT_FIXTURE + ' is not a responsive row');
  assert.ok(!/data-isoption|data-symbol/.test(parent), PARENT_FIXTURE + ' must carry no data- attributes');
  assert.ok(parent.includes('position-options-three-lines'), PARENT_FIXTURE + ' lost its narrow-screen symbol');
  for (const label of ['Quantity', 'Gain Loss', 'Day Change']) {
    assert.ok(parent.includes('<span class="sr-only">' + label + '</span>'), PARENT_FIXTURE + ' lost its ' + label + ' label');
  }

  const names = rows.map((row) => row.file).concat('positions.html', PARENT_FIXTURE);
  const gatePath = join(HERE, '..', '..', 'scripts', 'export-public.sh');
  if (existsSync(gatePath)) {
    const listed = /^FORBIDDEN_DATA='([^']*)'/m.exec(readFileSync(gatePath, 'utf8'));
    assert.ok(listed, 'the export gate names no live figures');
    const live = listed[1].split('|').map((figure) => figure.replace(/\\/g, ''));
    assert.ok(live.length >= 8, 'the export gate lists too few figures to be the real list');
    for (const name of names) {
      const html = read(name);
      for (const secret of live) {
        assert.ok(!html.includes(secret), name + ' leaks a live figure: ' + secret);
      }
    }
  }

  // A bare ticker is too short to forbid across a whole tree, so the rows
  // are held to an allowlist instead: every symbol in them is invented.
  const synthetic = rows.map((row) => row.symbol);
  for (const name of names) {
    for (const [, symbol] of read(name).matchAll(/data-symbol="([^"]*)"/g)) {
      assert.ok(synthetic.includes(symbol), name + ' carries a symbol that is not synthetic: ' + symbol);
    }
  }
});

// --- the parser against the captured rows ----------------------------------

// Text as the browser would hand it over: the entities Schwab writes into the
// responsive cells are characters by the time textContent is read, and the
// non-breaking space in particular is what collapse turns into the space the
// parser splits on.
const ENTITIES = { nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

function decodeEntities(text) {
  return text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (whole, name) => ENTITIES[name]);
}

// The elements of inner that this fake DOM models, as open tag, name and body.
// A depth counter rather than one regex is what finds them: the responsive
// dialect nests a span inside a link inside a span, and a lazy match would end
// the outer span at the inner one's closing tag. Tags outside the set, br and
// the layout divs, are left in the text they sit in. The scanner is built per
// call because the walk recurses into each child it finds, and a shared
// lastIndex would be rewound under the caller.
const FAKE_TAG = '<(\\/?)(th|td|a|span|button)\\b([^>]*)>';

function fakeChildren(inner, parent) {
  let depth = 0;
  let start = 0;
  let openTag = '';
  let name = '';
  const tagRe = new RegExp(FAKE_TAG, 'g');
  for (let m = tagRe.exec(inner); m; m = tagRe.exec(inner)) {
    if (m[1] === '/') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        const child = fakeEl(name, openTag, inner.slice(start, m.index));
        child.parentElement = parent;
        parent.children.push(child);
      }
      continue;
    }
    if (depth === 0) {
      name = m[2];
      openTag = m[3];
      start = m.index + m[0].length;
    }
    depth += 1;
  }
}

// A fixture row as the duck-typed elements attrOf and textOf expect: one tr of
// th/td children, each holding nested a, span or button elements. Attributes
// sit behind getAttribute, a childless element carries its own textContent,
// and parentElement is wired so a click can be climbed from. Parsing the
// captured markup rather than hand-writing rows is what locks the tests to
// Schwab.
function fakeEl(tag, openTag, inner) {
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  for (let m = attrRe.exec(openTag); m; m = attrRe.exec(openTag)) {
    attrs[m[1]] = m[2];
  }
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: attrs.class || '',
    children: [],
    parentElement: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
  fakeChildren(inner, node);
  if (node.children.length === 0) {
    node.textContent = decodeEntities(inner);
  }
  return node;
}

function rowFromHtml(html) {
  const tr = html.match(/<tr\b([^>]*)>([\s\S]*)<\/tr>/);
  assert.ok(tr, 'the fixture holds no tr');
  return fakeEl('tr', tr[1], tr[2]);
}

test('row-identity', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');

  // shares, a written call and a bought call read the same way
  const rows = [
    {
      file: 'shares-zork.html',
      identity: {
        instrument: 'ZORK',
        isOption: false,
        osi: null,
        parentName: null,
        quantity: 2500,
        side: 'long',
      },
    },
    {
      file: 'short-call-acme.html',
      identity: {
        instrument: 'ACME 01/15/2027 50.00 C',
        isOption: true,
        osi: 'ACME 270115C00050000',
        parentName: 'ACME Covered Call',
        quantity: -2,
        side: 'short',
      },
    },
    {
      file: 'long-call-acme.html',
      identity: {
        instrument: 'ACME 12/15/2028 240.00 C',
        isOption: true,
        osi: 'ACME 281215C00240000',
        parentName: 'ACME Covered Call',
        quantity: 3,
        side: 'long',
      },
    },
  ];
  for (const row of rows) {
    assert.deepEqual(readRowIdentity(rowFromHtml(read(row.file))), row.identity, row.file);
  }

  // a click resolves to its row from the cell, from the link and from a text node
  const shares = rowFromHtml(read('shares-zork.html'));
  const cells = rowCells(shares);
  assert.equal(cells[0].className, 'symbolColumn');
  assert.equal(cells.length, 13);
  assert.equal(findPositionRow(shares), shares);
  assert.equal(findPositionRow(cells[3]), shares, 'the quantity cell belongs to its row');
  assert.equal(findPositionRow(rowCells(cells[0])[0]), shares, 'so does the symbol link');
  assert.equal(findPositionRow({ parentElement: cells[3] }), shares, 'and so does a text node');
  assert.equal(findPositionRow(null), null);

  // page chrome is not a position row, and the climb stops at MAX_WALK
  let node = fakeEl('div', ' class="page-chrome"', 'x');
  const clicked = node;
  for (let i = 0; i < MAX_WALK + 2; i++) {
    const parent = fakeEl('div', '', '');
    node.parentElement = parent;
    node = parent;
  }
  assert.equal(findPositionRow(clicked), null, 'page chrome is no position row');
  node.parentElement = shares;
  assert.equal(findPositionRow(clicked), null, 'a row further than MAX_WALK away is out of reach');

  // a row missing what the parser wants yields empties, never a throw
  const bare = rowFromHtml('<tr app-position-row=""><th class="symbolColumn" scope="row"> </th><td> $1.00 </td></tr>');
  assert.equal(readInstrument(bare), '');
  assert.deepEqual(readRowIdentity(bare), {
    instrument: '',
    isOption: false,
    osi: null,
    parentName: null,
    quantity: null,
    side: null,
  });

  // commas and signs survive the quantity cell
  assert.equal(readQuantity(rowFromHtml('<tr><td> 1,900 </td></tr>')), 1900);
  assert.equal(readQuantity(rowFromHtml('<tr><td> -4 </td></tr>')), -4);
  assert.equal(rowCells(null).length, 0);
});

test('positions-parent-row', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const row = rowFromHtml(readFileSync(join(HERE, 'fixtures', PARENT_FIXTURE), 'utf8'));

  // a click anywhere in the row resolves to it, exactly as in the other dialect
  assert.equal(findPositionRow(row), row, 'the responsive row is a position row');
  const cells = rowCells(row);
  assert.equal(findPositionRow(cells[4]), row, 'the labeled quantity cell belongs to its row');
  assert.equal(findPositionRow(rowCells(cells[0])[0]), row, 'so does the symbol link');
  assert.deepEqual(readHeaderTexts(row), [], 'the captured row stands alone');

  // the one-line symbol wins over the three-line copy, and the sign is the side
  assert.deepEqual(readRowIdentity(row), {
    instrument: 'ACME 03/20/2027 75.00 C',
    isOption: true,
    osi: null,
    parentName: null,
    quantity: -1,
    side: 'short',
  });

  // the total is the labeled gain/loss cell; the day change alongside it is
  // both larger and differently signed, so reading the wrong cell shows up
  assert.deepEqual(findTotalCells(row), { pct: '-60.00%', usd: '-$150.00' });
  assert.equal(readLabeledText(row, 'Day Change'), '-140.00% (-140.00%)');
  const snapshot = parsePositionRow(row);
  assert.equal(snapshot.totalPct, -60);
  assert.equal(snapshot.totalDollars, -150);
  assert.equal(snapshot.side, 'short');
  assert.equal(snapshot.quantity, -1);

  // the day change is the stacked cell's own pair, never the market value
  // sitting above it in the same cell
  assert.deepEqual(findDayCells(row), { pct: '-140.00%', usd: '-$350.00' });
  assert.equal(snapshot.dayPct, -140);
  assert.equal(snapshot.dayDollars, -350);
  for (const figure of ['400', '250', '3.5']) {
    assert.ok(!JSON.stringify(snapshot).includes(figure), 'the snapshot carries ' + figure);
  }

  // a narrow screen drops the labeled columns and stacks the quantity instead
  const stacked = rowFromHtml('<tr class="positions-parent-row">'
    + '<td class="symbolCol"><span class="wrappable position symbol position-options">'
    + '<a href="/x"><span id="currentRowSymbol1">ACME 03/20/2027 75.00 C</span></a></span></td>'
    + '<td class="stacked priceQuantityStacked"><div class="stacked-div"><span>$4.00</span></div>'
    + '<span class="stacked-bottom"><span>-3</span></span></td></tr>');
  assert.equal(readParentQuantity(stacked), -3, 'the stacked cell carries the quantity under the price');
  assert.equal(parsePositionRow(stacked), null, 'a row with no gain/loss cell makes no card');

  // an equity row in the same dialect has no option label to go by
  const equity = rowFromHtml('<tr class="positions-parent-row">'
    + '<td class="symbolCol"><span class="wrappable position symbol"><a href="/x">'
    + '<span id="currentRowSymbol2">ZORK</span></a></span></td>'
    + '<td class="unstacked"><span class="sr-only">Quantity</span><span>250</span></td>'
    + '<td class="unstacked gainLossTooltipColumn"><span class="position-cell">'
    + '<span class="sr-only">Gain Loss</span><span class="wrappable position mark-positive">'
    + '<span title="+8.00%">+$2,000.00</span><br>'
    + '<span class="no-stack" title="+8.00%">&nbsp;(+8.00%)</span></span></span></td></tr>');
  assert.deepEqual(readRowIdentity(equity), {
    instrument: 'ZORK',
    isOption: false,
    osi: null,
    parentName: null,
    quantity: 250,
    side: 'long',
  });
  const shares = parsePositionRow(equity);
  assert.equal(shares.totalPct, 8);
  assert.equal(shares.totalDollars, 2000);

  // the attribute dialect is untouched by any of it
  const legacy = rowFromHtml(readFileSync(join(HERE, 'fixtures', 'short-call-acme.html'), 'utf8'));
  assert.equal(isParentRow(legacy), false, 'an attribute row is not a responsive one');
  assert.equal(readLabeledText(legacy, 'Quantity'), null, 'the attribute dialect labels nothing');
  assert.equal(readParentIdentity(row).instrument, readRowIdentity(row).instrument);
});

// A table around a row, so the header-aware column lookup has something to
// climb to. fakeEl only parses cells, so thead, tbody and the table itself are
// wired by hand; the rows themselves still come from the captured markup.
function pageRows(html) {
  const table = fakeEl('table', '', '');
  const head = fakeEl('thead', '', '');
  const body = fakeEl('tbody', '', '');
  table.children.push(head, body);
  head.parentElement = table;
  body.parentElement = table;
  const header = rowFromHtml(html.match(/<thead>[\s\S]*?<\/thead>/)[0]);
  header.parentElement = head;
  head.children.push(header);
  const rows = [];
  for (const markup of html.match(/<tr app-position-row[\s\S]*?<\/tr>/g)) {
    const row = rowFromHtml(markup);
    row.parentElement = body;
    body.children.push(row);
    rows.push(row);
  }
  return rows;
}

test('total-gain', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');

  // a bare captured tr has no header row, so the tooltip rule resolves it
  const captured = [
    { file: 'shares-zork.html', instrument: 'ZORK', totalPct: 12.4, totalDollars: 24800 },
    { file: 'short-call-acme.html', instrument: 'ACME 01/15/2027 50.00 C', totalPct: -3.25, totalDollars: -65 },
    { file: 'long-call-acme.html', instrument: 'ACME 12/15/2028 240.00 C', totalPct: 41.7, totalDollars: 8340 },
  ];
  for (const row of captured) {
    const bare = rowFromHtml(read(row.file));
    assert.deepEqual(readHeaderTexts(bare), [], row.file + ' stands alone');
    const snapshot = parsePositionRow(bare);
    assert.equal(snapshot.instrument, row.instrument, row.file);
    assert.equal(snapshot.totalPct, row.totalPct, row.file);
    assert.equal(snapshot.totalDollars, row.totalDollars, row.file);
  }

  // the same rows inside the offline page resolve through the header row
  const paged = pageRows(read('positions.html'));
  assert.equal(paged.length, captured.length);
  assert.ok(readHeaderTexts(paged[0]).includes('Gain/Loss $'), 'the header row is reachable from a body row');
  for (let i = 0; i < paged.length; i++) {
    const snapshot = parsePositionRow(paged[i]);
    assert.equal(snapshot.totalPct, captured[i].totalPct, captured[i].file + ' under its header row');
    assert.equal(snapshot.totalDollars, captured[i].totalDollars, captured[i].file + ' under its header row');
  }

  // the equity row ends on a repeated day percent; the confirming title rejects it
  const shares = rowFromHtml(read('shares-zork.html'));
  assert.equal(collapse(textOf(rowCells(shares)[11])), '+1.24%', 'the trailing cell repeats the day percent');
  assert.deepEqual(findTotalCells(shares), { pct: '+12.40%', usd: '+$24,800.00' });

  // the day pair is the dollar cell whose title is a percent the total does
  // not claim, which is what keeps it off the total's own cells
  assert.deepEqual(findDayCells(shares), { pct: '+1.24%', usd: '+$2,750.00' });

  // the snapshot is the whole card input, and none of it names the account
  const snapshot = parsePositionRow(shares);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'dayDollars',
    'dayPct',
    'instrument',
    'isOption',
    'osi',
    'parentName',
    'quantity',
    'side',
    'totalDollars',
    'totalPct',
  ]);
  assert.equal(snapshot.side, 'long');
  assert.equal(snapshot.dayPct, 1.24);
  assert.equal(snapshot.dayDollars, 2750);
  for (const figure of ['200,000', '224,800', '89.92']) {
    assert.ok(!JSON.stringify(snapshot).includes(figure), 'the snapshot carries ' + figure);
  }

  // a row with no day pair to find is still a row: the total stands alone and
  // the card is what decides that the missing line drops out
  const dayless = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column" title="+$24,800.00"> +12.40% </td></tr>');
  assert.equal(findDayCells(dayless), null, 'one tooltip cell is the total, not a day change');
  assert.equal(parsePositionRow(dayless).dayPct, null);
  assert.equal(parsePositionRow(dayless).dayDollars, null);

  // a reordered table is read by header name, which the cell rule alone cannot do
  const moved = fakeEl('table', '', '');
  const movedHead = rowFromHtml('<tr><th>Symbol</th><th>Day Gain/Loss %</th><th>Gain/Loss %</th><th>Gain/Loss $</th></tr>');
  const movedRow = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column" title="+$2,750.00"> +1.24% </td>'
    + '<td class="tooltip-column" title="+$24,800.00"> +12.40% </td>'
    + '<td class="tooltip-column" title="+12.40%"> +$24,800.00 </td></tr>');
  moved.children.push(movedHead, movedRow);
  movedHead.parentElement = moved;
  movedRow.parentElement = moved;
  assert.deepEqual(findTotalCells(movedRow), { pct: '+12.40%', usd: '+$24,800.00' });
  assert.equal(parsePositionRow(movedRow).totalPct, 12.4, 'the header names the total column');

  // a header row longer than the body row falls back instead of throwing
  const ragged = fakeEl('table', '', '');
  const raggedHead = rowFromHtml('<tr><th>Symbol</th><th>Gain/Loss %</th><th>Cost Basis</th><th>Quantity</th><th>Gain/Loss $</th></tr>');
  const raggedRow = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column" title="-$80.00"> -7.14% </td></tr>');
  ragged.children.push(raggedHead, raggedRow);
  raggedHead.parentElement = ragged;
  raggedRow.parentElement = ragged;
  assert.equal(readHeaderTexts(raggedRow).length, 5);
  assert.deepEqual(findTotalCells(raggedRow), { pct: '-7.14%', usd: '-$80.00' }, 'an out-of-range index falls back');
  assert.equal(parsePositionRow(raggedRow).totalDollars, -80, 'the tooltip title supplies the dollars');

  // when the pair disagrees the dollars win, because the card can show them alone
  const crossed = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column" title="-$24,800.00"> +12.40% </td></tr>');
  assert.equal(parsePositionRow(crossed).totalPct, -12.4);
  assert.equal(parsePositionRow(crossed).totalDollars, -24800);

  // a flat position is still a position
  const flat = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column" title="$0.00"> 0.00% </td></tr>');
  assert.equal(parsePositionRow(flat).totalPct, 0);
  assert.equal(parsePositionRow(flat).totalDollars, 0);

  // half a pair is no snapshot at all
  const unreadable = rowFromHtml('<tr app-position-row=""><th class="symbolColumn"><a> ZORK </a></th>'
    + '<td class="tooltip-column"> n/a </td></tr>');
  assert.equal(parsePositionRow(unreadable), null, 'no dollars, no snapshot');
  assert.equal(findTotalCells(rowFromHtml('<tr app-position-row=""><td> 100 </td></tr>')), null);
  assert.equal(parsePositionRow(rowFromHtml('<tr app-position-row=""><td> 100 </td></tr>')), null);
  assert.equal(parsePositionRow(null), null);
  assert.equal(parsePositionRow(fakeEl('div', ' class="page-chrome"', 'x')), null, 'page chrome is no position');

  // the parsers keep signs, drop commas, and answer null rather than NaN
  assert.equal(parseSignedPercent('+8.91%'), 8.91);
  assert.equal(parseSignedPercent('-7.14%'), -7.14);
  assert.equal(parseSignedPercent('8.91%'), 8.91);
  assert.equal(parseSignedPercent('1,024.50%'), 1024.5, 'a percent above 999 is not capped');
  assert.equal(parseSignedPercent('n/a'), null);
  assert.equal(parseSignedPercent(''), null);
  assert.equal(parseSignedDollars('-$80.00'), -80);
  assert.equal(parseSignedDollars('$-80.00'), -80, 'the sign may sit either side of the dollar sign');
  assert.equal(parseSignedDollars('+$1,234,567.89'), 1234567.89, 'a dollar figure above a million is not capped');
  assert.equal(parseSignedDollars('$0.00'), 0);
  assert.equal(parseSignedDollars('n/a'), null);
  assert.equal(parseSignedDollars('+12.40%'), null);
  assert.equal(parseSignedDollars('\u00a0+$9.32\u00a0'), 9.32, 'non-breaking spaces collapse first');
});
// The card draws only what these four return, so the formats are pinned here
// and the renderer is left with no string work of its own to get wrong.
test('format', () => {
  assert.equal(formatPercent(8.91), '+8.91%');
  assert.equal(formatPercent(-7.14), '-7.14%');
  assert.equal(formatPercent(0), '+0.00%', 'a flat position still carries a sign');
  assert.equal(formatPercent(3.456), '+3.46%', 'more than two decimals rounds rather than truncating');
  assert.equal(formatPercent(-0.004), '-0.00%', 'a hair below zero keeps its minus');
  assert.equal(formatPercent(1024.5), '+1024.50%', 'the percent is not grouped');
  assert.equal(formatPercent(NaN), null, 'an unreadable value is null, never NaN%');
  assert.equal(formatPercent(Infinity), null);
  assert.equal(formatPercent(null), null);

  assert.equal(formatDollars(12345.67), '+$12,345.67');
  assert.equal(formatDollars(-80), '-$80.00');
  assert.equal(formatDollars(0), '+$0.00');
  assert.equal(formatDollars(1234567.891), '+$1,234,567.89', 'rounding happens before grouping');
  assert.equal(formatDollars(-0.004), '-$0.00', 'the sign sits outside the dollar sign');
  assert.equal(formatDollars(999), '+$999.00', 'three digits need no comma');
  assert.equal(formatDollars(1000), '+$1,000.00');
  assert.equal(formatDollars(-24800), '-$24,800.00');
  assert.equal(formatDollars(NaN), null);
  assert.equal(formatDollars('12345.67'), null, 'the formatter takes numbers, not parsed text');

  // the parse-to-render round trip the card actually performs
  assert.equal(formatPercent(parseSignedPercent('+8.91%')), '+8.91%');
  assert.equal(formatDollars(parseSignedDollars('+$12,345.67')), '+$12,345.67');

  assert.equal(formatShareTime(new Date(2026, 8, 11, 7, 5)), 'Share Time: 09/11/2026 07:05');
  assert.equal(formatShareTime(new Date(2026, 11, 25, 0, 0)), 'Share Time: 12/25/2026 00:00', 'midnight is 00, not 24');
  assert.equal(formatShareTime(new Date(2026, 0, 1, 23, 59)), 'Share Time: 01/01/2026 23:59');
  assert.equal(formatShareTime(new Date('nope')), null);
  assert.equal(formatShareTime(null), null);

  assert.equal(toneOf(1), 'gain');
  assert.equal(toneOf(-1), 'loss');
  assert.equal(toneOf(0), 'flat');
  assert.equal(toneOf(-0.004), 'loss', 'tone follows the sign, not the rounded string');
  assert.equal(toneOf(NaN), null);
});

// --- the card display list, with no canvas anywhere -------------------------

// The snapshot every card assertion starts from. marketValue and costBasis are
// decoys: a real snapshot carries neither, and asserting they never surface
// proves the builder reads only what the PRD allows on a shareable card.
function cardSnapshot(extra) {
  return Object.assign(
    {
      instrument: 'INTC',
      totalPct: 12.4,
      totalDollars: 24800,
      isOption: false,
      osi: null,
      parentName: null,
      quantity: 1337,
      side: 'long',
      marketValue: 246913,
      costBasis: 222113,
    },
    extra || {},
  );
}

const CARD_NOW = new Date(2026, 8, 11, 7, 5);
const CARD_WIDTH_LIMIT = 888;

function cardTexts(card) {
  return card.ops.filter((op) => op.op === 'text').map((op) => op.text);
}

function cardTextOps(card) {
  return card.ops.filter((op) => op.op === 'text');
}

function fontPx(font) {
  return Number(/([0-9]+)px/.exec(font)[1]);
}

// A stub measurer at a wider-than-average ratio, so the fitting steps are
// deterministic instead of depending on a real font metric.
function stubMeasure(text, font) {
  return text.length * fontPx(font) * 0.6;
}

test('card-list', () => {
  const pct = buildCard(cardSnapshot(), 'pct', CARD_NOW);
  assert.equal(pct.width, CARD_W);
  assert.equal(pct.height, CARD_H);
  assert.equal(pct.ops[0].op, 'backdrop', 'the background is painted first');
  assert.deepEqual(
    { x: pct.ops[0].x, y: pct.ops[0].y, w: pct.ops[0].w, h: pct.ops[0].h },
    { x: 0, y: 0, w: CARD_W, h: CARD_H },
    'the backdrop covers the whole card',
  );
  assert.equal(pct.ops[0].base, CARD_THEME.base);
  assert.equal(pct.ops[0].from, CARD_THEME.washFrom);
  assert.equal(pct.ops[0].to, CARD_THEME.washTo);

  const pctTexts = cardTexts(pct);
  assert.equal(pctTexts.length, 5, 'instrument, label, number, timestamp, mark');
  assert.deepEqual(pctTexts.slice(0, 3), ['INTC', 'Performance', '+12.40%']);
  assert.ok(
    !pctTexts.some((text) => text.includes('$')),
    'percent-only shows no dollar amount at all',
  );

  const usd = buildCard(cardSnapshot(), 'usd', CARD_NOW);
  const usdTexts = cardTexts(usd);
  assert.equal(usdTexts.length, 5);
  assert.equal(usdTexts[2], '+$24,800.00');
  assert.ok(
    !usdTexts.some((text) => text.includes('%')),
    'dollars-only shows no percent at all',
  );

  const both = buildCard(cardSnapshot(), 'both', CARD_NOW);
  const bothTexts = cardTexts(both);
  assert.equal(bothTexts.length, 6, 'both adds the dollar line under the percent');
  assert.equal(bothTexts[2], '+12.40%', 'the percent stays the primary');
  assert.equal(bothTexts[3], '+$24,800.00');
  const bothOps = cardTextOps(both);
  assert.ok(
    fontPx(bothOps[3].font) < fontPx(bothOps[2].font),
    'the dollar line reads smaller than the percent it sits under',
  );
  assert.ok(bothOps[3].y > bothOps[2].y, 'and sits below it');
  assert.ok(bothOps[3].y < CARD_THEME.margin + 1728, 'clear of the footer line');

  // tone always follows the dollars, in every mode
  assert.equal(cardTextOps(pct)[2].fill, CARD_THEME.gain);
  const loss = buildCard(cardSnapshot({ totalPct: -7.14, totalDollars: -24800 }), 'pct', CARD_NOW);
  assert.equal(cardTextOps(loss)[2].fill, CARD_THEME.loss);
  assert.equal(cardTexts(loss)[2], '-7.14%');
  const flat = buildCard(cardSnapshot({ totalPct: 0, totalDollars: 0 }), 'both', CARD_NOW);
  assert.equal(cardTextOps(flat)[2].fill, CARD_THEME.flat, 'exactly zero is flat, not a gain');

  // the footer: the pinned share time on the left, the project mark right
  const footer = cardTextOps(pct)[3];
  const mark = cardTextOps(pct)[4];
  assert.equal(footer.text, 'Share Time: 09/11/2026 07:05');
  assert.equal(footer.x, CARD_THEME.margin);
  assert.equal(footer.align, 'left');
  assert.equal(mark.text, 'ss');
  assert.equal(mark.align, 'right');
  assert.equal(mark.x, CARD_W - CARD_THEME.margin);
  assert.equal(mark.y, footer.y, 'both footer lines share a baseline');

  // fitting: a line that fits keeps its size, a long one shrinks to the
  // content width, and nothing ever drops below the readable floor
  assert.equal(fontPx(cardTextOps(pct)[0].font), 96, 'a ticker needs no shrinking');
  const option = buildCard(
    cardSnapshot({ instrument: 'APP 10/16/2026 400.00 C' }),
    'pct',
    CARD_NOW,
    stubMeasure,
  );
  const optionFont = cardTextOps(option)[0].font;
  assert.ok(fontPx(optionFont) < 96, 'a full option line is stepped down');
  assert.ok(
    stubMeasure('APP 10/16/2026 400.00 C', optionFont) <= CARD_WIDTH_LIMIT,
    'and ends up inside the 888 px between the margins',
  );
  const huge = buildCard(
    cardSnapshot({ instrument: 'ACMECORPORATION 12/15/2028 1240.00 C' }),
    'pct',
    CARD_NOW,
    stubMeasure,
  );
  assert.equal(fontPx(cardTextOps(huge)[0].font), 64, 'the floor holds even when nothing fits');
  const rich = buildCard(cardSnapshot({ totalPct: 1284.5, totalDollars: 1284500 }), 'usd', CARD_NOW, stubMeasure);
  assert.equal(cardTexts(rich)[2], '+$1,284,500.00');
  assert.ok(
    stubMeasure('+$1,284,500.00', cardTextOps(rich)[2].font) <= CARD_WIDTH_LIMIT,
    'a seven-figure number is fitted like any other line',
  );
  assert.equal(fitFont(null, 'INTC', '700 96px sans-serif', CARD_WIDTH_LIMIT), '700 96px sans-serif');
  assert.equal(
    fontPx(fitFont(null, 'ACMECORPORATION 12/15/2028 1240.00 C', '700 96px sans-serif', CARD_WIDTH_LIMIT)),
    64,
    'a missing measurer falls back to the estimate rather than throwing',
  );

  // nothing the PRD keeps off a shareable card reaches an op
  for (const card of [pct, usd, both]) {
    const dump = JSON.stringify(card);
    assert.ok(!dump.includes('1337'), 'the quantity stays off the card');
    assert.ok(!dump.includes('246913'), 'the market value stays off the card');
    assert.ok(!dump.includes('222113'), 'the cost basis stays off the card');
    assert.ok(!dump.includes('long'), 'the side stays off the card');
    for (const op of card.ops) {
      assert.ok(op.op === 'backdrop' || op.op === 'text', 'the painter only ever sees two op kinds');
    }
  }

  assert.equal(buildCard(cardSnapshot(), 'day', CARD_NOW), null, 'an unknown mode draws nothing');
  assert.equal(buildCard(cardSnapshot(), null, CARD_NOW), null);
  assert.equal(buildCard(null, 'pct', CARD_NOW), null);
  assert.equal(buildCard(cardSnapshot({ totalPct: NaN }), 'pct', CARD_NOW), null, 'an unreadable number is no card');
});

// --- the painter, the renderer and the encoder, against doubles -------------

// A recording 2D context. Every property assignment and every call lands in
// one ordered list, which is what lets a test prove the four text properties
// were set for the run they belong to instead of inherited from the run
// before. measureText answers from the font currently assigned, so the fitting
// a real canvas would drive happens here too.
// A gradient double that keeps its stops in the order they were added, which
// is what lets a test read a ring's hard edge off two stops at one offset.
function fakeGradient() {
  const stops = [];
  return {
    stops,
    addColorStop(offset, color) {
      stops.push({ offset, color });
    },
  };
}

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {
      calls.push({ call: 'save' });
    },
    restore() {
      calls.push({ call: 'restore' });
    },
    createLinearGradient(x0, y0, x1, y1) {
      const gradient = fakeGradient();
      calls.push({ call: 'createLinearGradient', args: [x0, y0, x1, y1], gradient });
      return gradient;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const gradient = fakeGradient();
      calls.push({ call: 'createRadialGradient', args: [x0, y0, r0, x1, y1, r1], gradient });
      return gradient;
    },
    setTransform(a, b, c, d, e, f) {
      calls.push({ call: 'setTransform', args: [a, b, c, d, e, f] });
    },
    resetTransform() {
      calls.push({ call: 'resetTransform' });
    },
    fillRect(x, y, w, h) {
      calls.push({ call: 'fillRect', args: [x, y, w, h] });
    },
    fillText(text, x, y) {
      calls.push({ call: 'fillText', args: [text, x, y] });
    },
    measureText(text) {
      return { width: String(text).length * (ctx.font === null ? 16 : fontPx(ctx.font)) * 0.6 };
    },
  };
  for (const name of ['font', 'fillStyle', 'textAlign', 'textBaseline']) {
    let held = null;
    Object.defineProperty(ctx, name, {
      get() {
        return held;
      },
      set(value) {
        held = value;
        calls.push({ set: name, value });
      },
    });
  }
  return ctx;
}

// A canvas double: the recording context for '2d' and nothing for anything
// else, and a toBlob that calls back with whatever the test handed it, a blob
// or the null a browser reports when the encode could not be afforded.
function fakeCanvas(ctx, blob) {
  const attributes = {};
  return {
    width: 0,
    height: 0,
    types: [],
    attributes,
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getContext(kind) {
      return kind === '2d' ? ctx : null;
    },
    toBlob(cb, type) {
      this.types.push(type);
      cb(blob);
    },
  };
}

function canvasDoc(canvas) {
  const tags = [];
  return {
    tags,
    createElement(tag) {
      tags.push(tag);
      return canvas;
    },
  };
}

// One drawn string with the state it was drawn under. Pending assignments are
// dropped at every call, so a property that shows up here was set between the
// previous drawing call and this one and could not have leaked from an earlier
// op.
function textRuns(calls) {
  const runs = [];
  let pending = {};
  for (const entry of calls) {
    if (entry.set) {
      pending[entry.set] = entry.value;
      continue;
    }
    if (entry.call === 'fillText') {
      runs.push(Object.assign({ text: entry.args[0], x: entry.args[1], y: entry.args[2] }, pending));
    }
    pending = {};
  }
  return runs;
}

// The card the toggles are measured against: the one this program drew before
// they existed. Anything a default card gains is a regression, which is why
// the modes are asserted here whole rather than only where a toggle is on.
test('buildCard modes answer to the default toggles', () => {
  const snapshot = cardSnapshot({ dayPct: 1.24, dayDollars: 2750 });
  const expected = {
    pct: ['INTC', 'Performance', '+12.40%', 'Share Time: 09/11/2026 07:05', 'ss'],
    usd: ['INTC', 'Performance', '+$24,800.00', 'Share Time: 09/11/2026 07:05', 'ss'],
    both: ['INTC', 'Performance', '+12.40%', '+$24,800.00', 'Share Time: 09/11/2026 07:05', 'ss'],
  };
  for (const mode of ['pct', 'usd', 'both']) {
    const card = buildCard(snapshot, mode, CARD_NOW, stubMeasure);
    assert.deepEqual(cardTexts(card), expected[mode], 'mode ' + mode + ' draws what it always drew');
    assert.deepEqual(
      card,
      buildCard(snapshot, mode, CARD_NOW, stubMeasure, cardOptions(null)),
      'naming the defaults changes nothing about ' + mode,
    );
    const dump = JSON.stringify(card);
    assert.ok(!dump.includes('1,337'), 'the quantity is off until asked for');
    assert.ok(!dump.includes('Day change'), 'so is the day change');
  }
  assert.deepEqual(cardOptions(null), { showQuantity: false, showDayChange: false, showOverallChange: true });
  assert.deepEqual(cardOptions({ showQuantity: 'yes' }), cardOptions(null), 'only true turns a line on');
  assert.equal(cardOptions({ showOverallChange: false }).showOverallChange, false, 'and only false turns one off');
  assert.equal(cardOptions({ showOverallChange: 0 }).showOverallChange, true, 'a stray zero is not an answer');
});

// One test for the three lines the sheet switches, because what matters about
// them is the combinations: which line is the headline, what order the rest
// stand in, and which sets are not a card at all.
test('card-toggles', () => {
  const snapshot = cardSnapshot({ dayPct: 1.24, dayDollars: 2750 });
  const build = (mode, options) => buildCard(snapshot, mode, CARD_NOW, stubMeasure, options);

  // the quantity is the row's own signed figure, grouped like the dollars
  assert.equal(formatQuantity(1337), '1,337');
  assert.equal(formatQuantity(-1337), '-1,337');
  assert.equal(formatQuantity(-1), '-1');
  assert.equal(formatQuantity(12.5), '12.5');
  assert.equal(formatQuantity(null), null);
  assert.equal(formatQuantity(NaN), null);
  const quantity = build('pct', { showQuantity: true });
  assert.deepEqual(
    cardTexts(quantity),
    ['INTC', 'Performance', '+12.40%', 'Quantity 1,337', 'Share Time: 09/11/2026 07:05', 'ss'],
  );
  assert.equal(
    cardTexts(buildCard(cardSnapshot({ quantity: -1 }), 'pct', CARD_NOW, stubMeasure, { showQuantity: true }))[3],
    'Quantity -1',
    'a written contract keeps its minus',
  );

  // the day change follows the same % / $ / both mode the total does
  assert.equal(cardTexts(build('pct', { showDayChange: true }))[3], 'Day change +1.24%');
  assert.equal(cardTexts(build('usd', { showDayChange: true }))[3], 'Day change +$2,750.00');
  assert.equal(cardTexts(build('both', { showDayChange: true }))[4], 'Day change +1.24% (+$2,750.00)');

  // both extra lines stand under the headline, day first, neither overlapping
  const all = build('pct', { showQuantity: true, showDayChange: true });
  const lines = cardTextOps(all);
  assert.deepEqual(cardTexts(all).slice(3, 5), ['Day change +1.24%', 'Quantity 1,337']);
  assert.ok(lines[3].y > lines[2].y, 'the day line sits under the headline number');
  assert.ok(lines[4].y > lines[3].y, 'and the quantity under the day line');
  assert.equal(lines[3].x, CARD_THEME.margin, 'every line starts at the same margin');
  assert.equal(lines[4].x, CARD_THEME.margin);
  assert.ok(lines[4].y < cardTextOps(all)[5].y, 'and both stay above the footer');
  assert.equal(lines[3].fill, CARD_THEME.gain, 'the day line carries the tone of its own dollars');
  assert.equal(
    cardTextOps(buildCard(cardSnapshot({ dayPct: -1.24, dayDollars: -2750 }), 'pct', CARD_NOW, stubMeasure, { showDayChange: true }))[3].fill,
    CARD_THEME.loss,
    'a losing day is red under a winning total',
  );

  // with the overall change off the day change is promoted into the headline
  const promoted = build('pct', { showDayChange: true, showOverallChange: false });
  assert.deepEqual(cardTexts(promoted), ['INTC', 'Day change', '+1.24%', 'Share Time: 09/11/2026 07:05', 'ss']);
  assert.equal(cardTextOps(promoted)[2].y, cardTextOps(build('pct', null))[2].y, 'at the headline baseline');
  assert.ok(
    fontPx(cardTextOps(promoted)[2].font) > fontPx(cardTextOps(all)[3].font),
    'and at the headline size, not the supporting one',
  );

  // a quantity-only card is a card; a card with nothing on it is not
  const bare = build('pct', { showQuantity: true, showOverallChange: false });
  assert.deepEqual(cardTexts(bare), ['INTC', 'Quantity 1,337', 'Share Time: 09/11/2026 07:05', 'ss']);
  assert.equal(cardTextOps(bare)[1].y, cardTextOps(build('pct', null))[2].y, 'the stack starts at the headline');
  assert.equal(build('pct', { showOverallChange: false }), null, 'every line off is no card');
  assert.equal(build('usd', { showOverallChange: false }), null);
  assert.equal(canBuildCard(null), true, 'the defaults are copyable');
  assert.equal(canBuildCard({ showOverallChange: false }), false);
  assert.equal(canBuildCard({ showOverallChange: false, showQuantity: true }), true);
  assert.equal(canBuildCard({ showOverallChange: false, showDayChange: true }), true);

  // a row whose day change the parser could not find drops the line rather
  // than drawing a word in place of a number
  const dayless = cardSnapshot();
  assert.deepEqual(
    cardTexts(buildCard(dayless, 'pct', CARD_NOW, stubMeasure, { showDayChange: true })),
    ['INTC', 'Performance', '+12.40%', 'Share Time: 09/11/2026 07:05', 'ss'],
  );
  assert.equal(
    buildCard(dayless, 'pct', CARD_NOW, stubMeasure, { showDayChange: true, showOverallChange: false }),
    null,
    'and a card that had only that line is no card',
  );

  // a long line on a supporting row is allowed past the headline's floor
  const long = buildCard(
    cardSnapshot({ dayPct: 1284.5, dayDollars: 1284500 }),
    'both',
    CARD_NOW,
    stubMeasure,
    { showDayChange: true },
  );
  const dayLine = cardTextOps(long)[4];
  assert.equal(dayLine.text, 'Day change +1284.50% (+$1,284,500.00)');
  assert.ok(stubMeasure(dayLine.text, dayLine.font) <= CARD_WIDTH_LIMIT, 'and is fitted inside the margins');
  assert.equal(fitFont(stubMeasure, 'x', '500 56px sans-serif', CARD_WIDTH_LIMIT, 32), '500 56px sans-serif');
  assert.equal(fontPx(fitFont(stubMeasure, dayLine.text, '500 56px sans-serif', 120, 32)), 32, 'down to its own floor');

  // nothing the PRD keeps off a card arrives with them
  for (const card of [quantity, all, promoted, bare]) {
    const dump = JSON.stringify(card);
    assert.ok(!dump.includes('246913'), 'the market value stays off the card');
    assert.ok(!dump.includes('222113'), 'the cost basis stays off the card');
    assert.ok(!dump.includes('long'), 'the side stays off the card');
  }
});

// The one line on the card that comes from the sign of a figure rather than
// from the figure itself, which is why every case here is a quantity the
// reader never sees.
test('opening-side', () => {
  const bought = cardSnapshot({ instrument: 'ACME 12/15/2028 240.00 C', isOption: true, quantity: 3, side: 'long' });
  const written = cardSnapshot({ instrument: 'ACME 01/15/2027 50.00 C', isOption: true, quantity: -2, side: 'short' });

  assert.equal(openingSideLabel(bought), 'buy-to-open');
  assert.equal(openingSideLabel(written), 'sell-to-open');
  assert.equal(openingSideLabel(cardSnapshot()), null, 'shares opened no side worth naming');
  assert.equal(openingSideLabel(cardSnapshot({ isOption: true, quantity: null })), null, 'an unread quantity picks no side');
  assert.equal(openingSideLabel(cardSnapshot({ isOption: true, quantity: 0 })), null, 'and neither does a flat zero');
  assert.equal(openingSideLabel(cardSnapshot({ isOption: true, quantity: NaN })), null);
  assert.equal(openingSideLabel(null), null);

  // the side is the position's, not the mode's, so all three carry it
  for (const mode of ['pct', 'usd', 'both']) {
    assert.ok(cardTexts(buildCard(bought, mode, CARD_NOW, stubMeasure)).includes('buy-to-open'), 'mode ' + mode + ' drops the bought side');
    assert.ok(cardTexts(buildCard(written, mode, CARD_NOW, stubMeasure)).includes('sell-to-open'), 'mode ' + mode + ' drops the written side');
  }

  const ops = cardTextOps(buildCard(written, 'pct', CARD_NOW, stubMeasure));
  assert.deepEqual(
    ops.map((op) => op.text).slice(0, 3),
    ['ACME 01/15/2027 50.00 C', 'sell-to-open', 'Performance'],
    'the side reads between the instrument and the label',
  );
  assert.ok(ops[1].y > ops[0].y, 'and is painted under the instrument');
  assert.ok(fontPx(ops[1].font) < fontPx(ops[0].font), 'smaller than the instrument it belongs to');
  assert.equal(ops[1].x, CARD_THEME.margin, 'on the margin every other line starts from');
  assert.equal(ops[1].fill, CARD_THEME.secondary, 'in the supporting colour, not a gain or a loss');

  const dump = JSON.stringify(buildCard(written, 'pct', CARD_NOW, stubMeasure));
  assert.ok(!dump.includes('-2'), 'how many contracts there are stays off the card');
  assert.ok(!dump.includes('short'), 'and so does the word the parser used');
});

// What the side line must not disturb: the card every share row draws, and
// the card an option draws when its quantity could not be read.
test('buildCard leaves shares and unread options without an opening side', () => {
  const shorted = cardSnapshot({ quantity: -1900 });
  assert.deepEqual(
    cardTexts(buildCard(shorted, 'both', CARD_NOW, stubMeasure)),
    ['INTC', 'Performance', '+12.40%', '+$24,800.00', 'Share Time: 09/11/2026 07:05', 'ss'],
    'a short share position is a share position, and the card says nothing about how it was opened',
  );

  const labelOf = (snapshot) => cardTextOps(buildCard(snapshot, 'pct', CARD_NOW, stubMeasure))[1];
  assert.equal(labelOf(shorted).text, 'Performance');
  assert.equal(labelOf(shorted).y, 436, 'the label keeps the height it held before the side line existed');
  assert.equal(labelOf(cardSnapshot({ isOption: true, quantity: null })).y, 436, 'an option with nothing to say keeps it too');

  const ops = cardTextOps(buildCard(cardSnapshot({ isOption: true, quantity: -2 }), 'pct', CARD_NOW, stubMeasure));
  assert.equal(ops[2].text, 'Performance');
  assert.equal(ops[2].y, 498, 'and only a card carrying a side moves the label down');
  assert.ok(ops[2].y > ops[1].y + fontPx(ops[1].font), 'far enough down that the two lines cannot touch');
});

const PCT_TEXTS = ['INTC', 'Performance', '+12.40%', 'Share Time: 09/11/2026 07:05', 'ss'];

test('paint', async () => {
  const both = buildCard(cardSnapshot(), 'both', CARD_NOW, stubMeasure);
  const ctx = fakeCtx();
  assert.equal(paintCard(ctx, both), both.ops.length, 'every op in the list is painted');
  assert.equal(ctx.calls[0].call, 'save', 'the walk leaves the context as it found it');
  assert.equal(ctx.calls[ctx.calls.length - 1].call, 'restore');

  // the background: the base colour straight onto the card, then the wash down
  // the op's own box with the two theme stops, assigned to fillStyle and
  // filled over the whole card
  assert.deepEqual(ctx.calls[1], { set: 'fillStyle', value: CARD_THEME.base }, 'the base goes down first');
  assert.equal(ctx.calls[2].call, 'fillRect');
  assert.deepEqual(ctx.calls[2].args, [0, 0, CARD_W, CARD_H]);
  const grad = ctx.calls[3];
  assert.equal(grad.call, 'createLinearGradient');
  assert.deepEqual(grad.args, [0, 0, 0, CARD_H], 'top to bottom, not corner to corner');
  assert.deepEqual(grad.gradient.stops, [
    { offset: 0, color: CARD_THEME.washFrom },
    { offset: 1, color: CARD_THEME.washTo },
  ]);
  assert.equal(ctx.calls[4].set, 'fillStyle');
  assert.equal(ctx.calls[4].value, grad.gradient, 'the gradient itself becomes the fill');
  assert.equal(ctx.calls[5].call, 'fillRect');
  assert.deepEqual(ctx.calls[5].args, [0, 0, CARD_W, CARD_H]);

  // every text run carries its own font, colour and alignment: a canvas draws
  // with the font current at fillText time, so an inherited one would paint
  // the right string at the wrong size
  const runs = textRuns(ctx.calls);
  for (const run of runs) {
    assert.deepEqual(
      Object.keys(run).sort(),
      ['fillStyle', 'font', 'text', 'textAlign', 'textBaseline', 'x', 'y'],
      'each run set all four properties before it was drawn',
    );
  }
  assert.deepEqual(runs.map((run) => run.text), [
    'INTC',
    'Performance',
    '+12.40%',
    '+$24,800.00',
    'Share Time: 09/11/2026 07:05',
    'ss',
  ]);
  assert.equal(runs[2].fillStyle, CARD_THEME.gain, 'the tone reaches the canvas');
  assert.equal(runs[5].textAlign, 'right', 'and so does the mark alignment');

  const pctCtx = fakeCtx();
  paintCard(pctCtx, buildCard(cardSnapshot(), 'pct', CARD_NOW, stubMeasure));
  assert.deepEqual(textRuns(pctCtx.calls).map((run) => run.text), PCT_TEXTS);
  const usdCtx = fakeCtx();
  paintCard(usdCtx, buildCard(cardSnapshot(), 'usd', CARD_NOW, stubMeasure));
  assert.deepEqual(textRuns(usdCtx.calls).map((run) => run.text), [
    'INTC',
    'Performance',
    '+$24,800.00',
    'Share Time: 09/11/2026 07:05',
    'ss',
  ]);

  const bare = fakeCtx();
  delete bare.save;
  delete bare.restore;
  assert.equal(
    paintCard(bare, { ops: [{ op: 'glow', x: 0, y: 0 }, both.ops[1]] }),
    1,
    'an op kind this painter does not know is skipped, not thrown on',
  );
  assert.equal(textRuns(bare.calls).length, 1, 'and a context with no save still paints');
  assert.equal(paintCard(null, both), 0);
  assert.equal(paintCard(fakeCtx(), null), 0);

  // the renderer: a 1080 by 1920 backing store, painted through the same walk
  const renderCtx = fakeCtx();
  const canvas = fakeCanvas(renderCtx, null);
  const doc = canvasDoc(canvas);
  assert.equal(renderCard(doc, cardSnapshot(), 'pct', CARD_NOW), canvas);
  assert.deepEqual(doc.tags, ['canvas']);
  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1920);
  assert.equal(canvas.width, CARD_W);
  assert.equal(canvas.height, CARD_H);
  assert.deepEqual(textRuns(renderCtx.calls).map((run) => run.text), PCT_TEXTS);

  const optionCtx = fakeCtx();
  renderCard(
    canvasDoc(fakeCanvas(optionCtx, null)),
    cardSnapshot({ instrument: 'APP 10/16/2026 400.00 C' }),
    'pct',
    CARD_NOW,
  );
  assert.ok(
    fontPx(textRuns(optionCtx.calls)[0].font) < 96,
    'the renderer fits with the very context it paints on',
  );

  assert.equal(renderCard(doc, cardSnapshot(), 'day', CARD_NOW), null, 'an unknown mode renders nothing');
  assert.equal(renderCard(doc, null, 'pct', CARD_NOW), null);
  assert.equal(
    renderCard(canvasDoc({ getContext: () => null }), cardSnapshot(), 'pct', CARD_NOW),
    null,
    'a detached document hands back no 2d context',
  );
  assert.equal(renderCard(null, cardSnapshot(), 'pct', CARD_NOW), null);

  // the encoder: a PNG blob, or a reason
  const blob = { type: 'image/png', size: 4096 };
  const encodable = fakeCanvas(fakeCtx(), blob);
  assert.equal(await canvasToPngBlob(encodable), blob);
  assert.deepEqual(encodable.types, ['image/png'], 'the encoder always asks for a PNG');
  await assert.rejects(
    canvasToPngBlob(fakeCanvas(fakeCtx(), null)),
    /produced no image/,
    'a null blob is a failure, not an empty success',
  );
  await assert.rejects(canvasToPngBlob({}), /produced no image/, 'and so is a canvas that cannot encode');
});

// The backdrop, held to the CSS quoted above CARD_THEME: a #172136 base under
// a repeating nine-pixel ring pattern and a light-blue wash, the pair faded out
// elliptically towards the edges. The painter reaches that with four fills,
// because a canvas has neither a mask nor a repeating gradient of its own.
test('card-background', () => {
  const card = buildCard(cardSnapshot(), 'pct', CARD_NOW, stubMeasure);
  const backdrop = card.ops[0];
  assert.equal(backdrop.base, '#172136', 'the base is the colour the CSS names');
  assert.ok(
    backdrop.from.startsWith('#8CC7FF') && backdrop.to.startsWith('#8CC7FF'),
    'both ends of the wash are the light blue the CSS names',
  );
  assert.ok(backdrop.from !== backdrop.to, 'and the wash is a ramp between them, not one flat colour');
  assert.ok(
    !JSON.stringify(card.ops).includes('#0A1633'),
    'the flat navy the card used to fill itself with is gone',
  );

  const ctx = fakeCtx();
  paintCard(ctx, card);
  const named = (name) => ctx.calls.filter((entry) => entry.call === name);
  assert.equal(named('fillRect').length, 4, 'base, wash, rings and fade');

  // the rings: one radial gradient out from the top-left corner carrying a
  // clear stop and a base stop for every nine pixels, each period closing at
  // the offset the next one opens at so the edge stays hard
  const radial = named('createRadialGradient');
  assert.equal(radial.length, 2, 'the rings and the fade');
  const reach = CARD_W + CARD_H;
  assert.deepEqual(radial[0].args, [0, 0, 0, 0, 0, reach], 'the rings run out from the corner the CSS puts them at');
  const rings = radial[0].gradient.stops;
  assert.equal(rings.length, 2 * Math.floor(reach / 9), 'a clear stop and a ring stop every nine pixels');
  assert.equal(rings[0].color, CARD_THEME.base + '00', 'a period opens clear');
  assert.ok(rings[1].color.startsWith(CARD_THEME.base), 'and closes on the base colour');
  assert.equal(rings[1].offset - rings[0].offset, 9 / reach, 'nine pixels of pitch, as a fraction of the reach');
  assert.equal(rings[2].offset, rings[1].offset, 'the next period opens where this one closed, so the edge is hard');

  // the mask: a circular gradient scaled into the ellipse the CSS asks for,
  // clear at the centre and bare base by the time it reaches the rim
  const scaled = named('setTransform');
  assert.equal(scaled.length, 1, 'the ellipse is the one thing that needs a transform');
  assert.deepEqual(
    scaled[0].args,
    [1, 0, 0, CARD_H / CARD_W, CARD_W / 2, CARD_H / 2],
    'the circle is stretched to the card and centred on it',
  );
  assert.deepEqual(radial[1].gradient.stops, [
    { offset: 0, color: CARD_THEME.base + '00' },
    { offset: 1, color: CARD_THEME.base },
  ], 'the fade runs from clear at the centre to the bare base at its rim');
  assert.ok(
    radial[1].args[5] > CARD_W / 2 && radial[1].args[5] < CARD_W,
    'that rim is past the side edge and well inside the corner, as three quarters of the ellipse is',
  );
  assert.equal(named('resetTransform').length, 1, 'and the transform is cleared again');

  // the wash is now the only linear gradient on the card
  const linear = named('createLinearGradient');
  assert.equal(linear.length, 1);
  assert.deepEqual(
    linear[0].gradient.stops.map((stop) => stop.color),
    [CARD_THEME.washFrom, CARD_THEME.washTo],
  );
});

// The fade paints over everything beneath it and the ellipse needs a transform
// the text must not inherit, so where the words sit in the walk is not a
// detail: after the backdrop, and back at the identity.
test('paintCard text over the background', () => {
  const card = buildCard(cardSnapshot(), 'pct', CARD_NOW, stubMeasure);
  assert.equal(card.ops[0].op, 'backdrop');
  assert.ok(card.ops.slice(1).every((op) => op.op === 'text'), 'every op after the backdrop is a text run');

  const ctx = fakeCtx();
  assert.equal(paintCard(ctx, card), card.ops.length, 'every op in the list is painted');
  const kinds = ctx.calls.map((entry) => entry.call);
  const firstText = kinds.indexOf('fillText');
  assert.ok(firstText > 0, 'the card says something');
  assert.ok(kinds.lastIndexOf('fillRect') < firstText, 'the whole backdrop is down before the first word');
  assert.ok(kinds.indexOf('resetTransform') < firstText, 'and the ellipse transform is cleared before it');

  const runs = textRuns(ctx.calls);
  assert.deepEqual(runs.map((run) => run.text), PCT_TEXTS, 'the instrument, the number and the footer all reach the canvas');
  assert.equal(runs[0].fillStyle, CARD_THEME.headline, 'the instrument is drawn in the headline colour');
  assert.equal(runs[2].fillStyle, CARD_THEME.gain, 'and the number in its tone');
});

// --- the clipboard against a fake window -----------------------------------

// A window double carrying only what the writer reads off it: the secure
// context flag, a ClipboardItem constructor that records what it was built
// with, and a clipboard whose write records the list it was handed. Each
// option takes one capability away or makes the write reject, which is how
// every diagnostic code is reached without a browser.
function fakeWin(opts) {
  const o = opts || {};
  const writes = [];
  const items = [];
  const win = { writes, items, isSecureContext: o.isSecureContext !== false };
  if (!o.noClipboardItem) {
    win.ClipboardItem = function (parts) {
      this.parts = parts;
      items.push(this);
    };
  }
  if (!o.noNavigator) {
    const clipboard = o.noWrite
      ? {}
      : {
          write(list) {
            writes.push(list);
            return 'reject' in o ? Promise.reject(o.reject) : Promise.resolve();
          },
        };
    win.navigator = o.noClipboard ? {} : { clipboard };
  }
  return win;
}

test('clipboard', async () => {
  assert.deepEqual(
    CLIPBOARD_MESSAGES,
    {
      'insecure-context': 'Clipboard needs a secure page (https)',
      unsupported: 'This browser cannot copy images',
      'permission-denied': 'Clipboard permission denied',
      'write-failed': 'Could not copy the card',
    },
    'four codes, four messages, and nothing free-form',
  );

  const blob = { type: 'image/png', size: 4096 };

  // the success path: one ClipboardItem keyed image/png, carrying the blob
  // itself rather than a promise for it, which is the shape Chrome and Edge
  // take
  {
    const win = fakeWin();
    assert.equal(clipboardBlocker(win), null, 'a secure page with the API present is not blocked');
    assert.deepEqual(await writePngToClipboard(win, blob), { ok: true });
    assert.equal(win.writes.length, 1, 'one write, and one item in it');
    assert.deepEqual(win.writes[0], [win.items[0]]);
    assert.deepEqual(Object.keys(win.items[0].parts), ['image/png'], 'the only image type the clipboard takes');
    assert.equal(win.items[0].parts['image/png'], blob);
  }

  // an http page: the API is hidden there entirely, so calling that absence
  // unsupported would send the user after a browser problem that is really a
  // page-URL problem
  {
    const win = fakeWin({ isSecureContext: false });
    assert.equal(clipboardBlocker(win), 'insecure-context');
    assert.deepEqual(await writePngToClipboard(win, blob), {
      ok: false,
      code: 'insecure-context',
      message: 'Clipboard needs a secure page (https)',
    });
    assert.equal(win.writes.length, 0, 'a blocked page is never written to');
    assert.equal(win.items.length, 0);
  }

  // a browser that cannot copy images, reached every way the API can be
  // missing: no ClipboardItem to build, no write to call, no clipboard, no
  // navigator at all
  for (const opts of [{ noClipboardItem: true }, { noWrite: true }, { noClipboard: true }, { noNavigator: true }]) {
    const win = fakeWin(opts);
    const where = Object.keys(opts)[0];
    assert.equal(clipboardBlocker(win), 'unsupported', where);
    assert.deepEqual(
      await writePngToClipboard(win, blob),
      { ok: false, code: 'unsupported', message: 'This browser cannot copy images' },
      where,
    );
    assert.equal(win.writes.length, 0, where);
  }

  // a window that never says whether it is secure is judged on its API alone,
  // and no window at all is an outcome rather than a crash
  {
    const win = fakeWin();
    delete win.isSecureContext;
    assert.equal(clipboardBlocker(win), null);
    assert.deepEqual(await writePngToClipboard(win, blob), { ok: true });
  }
  assert.equal(clipboardBlocker(null), 'unsupported');
  assert.deepEqual(await writePngToClipboard(null, blob), {
    ok: false,
    code: 'unsupported',
    message: 'This browser cannot copy images',
  });

  // a refusal by name and the same refusal said only in prose: a gesture that
  // expired while the card rendered arrives as NotAllowedError, which is the
  // common one
  for (const err of [Object.assign(new Error('nope'), { name: 'NotAllowedError' }), new Error('Write denied')]) {
    const win = fakeWin({ reject: err });
    assert.deepEqual(
      await writePngToClipboard(win, blob),
      { ok: false, code: 'permission-denied', message: 'Clipboard permission denied' },
      err.name,
    );
    assert.equal(win.writes.length, 1, 'the write was attempted before it was refused');
  }

  // anything else the write throws is the one message that fits them all,
  // including a rejection carrying neither a name nor a message
  for (const err of [new Error('quota exceeded'), {}, null]) {
    const win = fakeWin({ reject: err });
    assert.deepEqual(
      await writePngToClipboard(win, blob),
      { ok: false, code: 'write-failed', message: 'Could not copy the card' },
      String(err),
    );
  }

  // a ClipboardItem that throws on the way in never escapes as a throw either
  {
    const win = fakeWin();
    win.ClipboardItem = function () {
      throw new Error('unsupported format');
    };
    assert.deepEqual(await writePngToClipboard(win, blob), {
      ok: false,
      code: 'write-failed',
      message: 'Could not copy the card',
    });
  }

  // nothing to copy is a failure, not a blank image on the clipboard
  {
    const win = fakeWin();
    assert.deepEqual(await writePngToClipboard(win, null), {
      ok: false,
      code: 'write-failed',
      message: 'Could not copy the card',
    });
    assert.equal(win.writes.length, 0, 'a missing blob is never written');
  }

  // no path out of here rejects: a caller always gets an outcome object, and
  // its message always came from the table
  for (const opts of [{}, { isSecureContext: false }, { noWrite: true }, { reject: new Error('x') }, { reject: null }]) {
    const outcome = await writePngToClipboard(fakeWin(opts), blob);
    assert.equal(typeof outcome.ok, 'boolean');
    if (!outcome.ok) {
      assert.equal(outcome.message, CLIPBOARD_MESSAGES[outcome.code], outcome.code);
    }
    await assert.doesNotReject(() => writePngToClipboard(fakeWin(opts), blob), 'an outcome, never a throw');
  }

  // and the bookmarklet only ever writes: reading a user's clipboard is not
  // something a page dropped on a brokerage account gets to do
  assert.ok(
    !/clipboard\s*\.\s*read/.test(readFileSync(MODULE_PATH, 'utf8')),
    'this module must never read the clipboard',
  );
});

// --- the picker against a fake document ------------------------------------

// document, window and body doubles. Every listener, appended child and timer
// is recorded, so a test can dispatch into an armed picker and read back
// exactly what it put on the page and what it took away again. Listeners a
// created element takes are kept apart from the document's own, because that
// is the distinction a capture-phase overlay is built on.
function fakeEnv() {
  const listeners = [];
  const nodeListeners = [];
  const children = [];
  const timers = [];
  const body = {
    style: { cursor: '' },
    children,
    appendChild(el) {
      el.parentNode = body;
      children.push(el);
    },
    removeChild(el) {
      const i = children.indexOf(el);
      if (i >= 0) {
        children.splice(i, 1);
      }
      el.parentNode = null;
    },
  };
  const doc = {
    body,
    createElement(tag) {
      const attributes = {};
      const kids = [];
      let text = '';
      const el = {
        tagName: tag.toUpperCase(),
        parentNode: null,
        parentElement: null,
        attributes,
        children: kids,
        focused: false,
        style: {},
        setAttribute(name, value) {
          attributes[name] = String(value);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
        appendChild(child) {
          child.parentNode = el;
          child.parentElement = el;
          kids.push(child);
        },
        removeChild(child) {
          const i = kids.indexOf(child);
          if (i >= 0) {
            kids.splice(i, 1);
          }
          child.parentNode = null;
          child.parentElement = null;
        },
        addEventListener(type, fn, opts) {
          nodeListeners.push({ node: el, type, fn, capture: typeof opts === 'object' && opts !== null ? Boolean(opts.capture) : Boolean(opts) });
        },
        removeEventListener(type, fn) {
          const i = nodeListeners.findIndex((l) => l.node === el && l.type === type && l.fn === fn);
          if (i >= 0) {
            nodeListeners.splice(i, 1);
          }
        },
        focus() {
          el.focused = true;
        },
      };
      // Writing text over an element empties it first, which is what lets the
      // one preview slot hold a card, then a line of text, then a card again
      // without the fake keeping what the real DOM would have dropped.
      Object.defineProperty(el, 'textContent', {
        get() {
          return text;
        },
        set(value) {
          text = String(value);
          for (const child of kids.splice(0, kids.length)) {
            child.parentNode = null;
            child.parentElement = null;
          }
        },
      });
      return el;
    },
    addEventListener(type, fn, opts) {
      listeners.push({ type, fn, capture: typeof opts === 'object' && opts !== null ? Boolean(opts.capture) : Boolean(opts) });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) {
        listeners.splice(i, 1);
      }
    },
  };
  const win = {
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  doc.defaultView = win;
  return {
    doc,
    win,
    listeners,
    nodeListeners,
    children,
    timers,
    dispatch(type, event) {
      for (const l of listeners.slice()) {
        if (l.type === type) {
          l.fn(event);
        }
      }
    },
    dispatchOn(node, type, event) {
      for (const l of nodeListeners.slice()) {
        if (l.node === node && l.type === type) {
          l.fn(event);
        }
      }
      const handler = node['on' + type];
      if (typeof handler === 'function') {
        handler(event);
      }
    },
  };
}

function fakeEvent(target, key) {
  return {
    target,
    key,
    prevented: false,
    stopped: false,
    stoppedImmediately: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stoppedImmediately = true; },
  };
}

// The frames the picker has on the page, found the way the picker marks them.
function overlaysOf(d) {
  return d.children.filter((el) => el.attributes && el.attributes['data-schwab-shot'] === 'highlight');
}

// A parsed fixture row measures nothing on its own, so give it a box. Reading
// node.rect live lets a test move the row under the mouse.
function withRect(el, rect) {
  el.rect = rect;
  el.getBoundingClientRect = () => ({
    left: el.rect.left,
    top: el.rect.top,
    width: el.rect.width,
    height: el.rect.height,
    right: el.rect.left + el.rect.width,
    bottom: el.rect.top + el.rect.height,
  });
  return el;
}

test('picker', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
  const ROW_RECT = { left: 40, top: 200, width: 720, height: 48 };
  const positionRow = () => withRect(rowFromHtml(read('shares-zork.html')), ROW_RECT);
  const chrome = () => fakeEl('div', ' class="page-chrome"', 'x');

  // the two geometry helpers, including the answers that keep a frame off the page
  assert.equal(rectOf(null), null);
  assert.equal(rectOf({}), null);
  assert.equal(rectOf({ getBoundingClientRect: () => null }), null);
  assert.equal(rectOf({ getBoundingClientRect: () => ({ left: 1, top: 2 }) }), null, 'half a rect is no rect');
  assert.deepEqual(
    highlightRect({ left: 10, top: 20, width: 100, height: 40 }),
    { left: 10 - HIGHLIGHT_WIDTH, top: 20 - HIGHLIGHT_WIDTH, width: 100 + 2 * HIGHLIGHT_WIDTH, height: 40 + 2 * HIGHLIGHT_WIDTH },
  );

  // arming needs a document with a body and a window, and says so
  assert.throws(() => armPicker(null, fakeEnv().win), /needs a document/);
  assert.throws(() => armPicker({}, fakeEnv().win), /needs a document/, 'a document without a body cannot half-arm');
  assert.throws(() => armPicker(fakeEnv().doc, null), /needs a document/);

  // the banner announces itself in the Schwab accent and the cursor turns
  {
    const d = fakeEnv();
    d.doc.body.style.cursor = 'pointer';
    const state = armPicker(d.doc, d.win, () => {});
    assert.equal(d.win.__schwabShot, state);
    assert.equal(d.children.length, 1);
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    const style = d.children[0].attributes.style;
    assert.ok(style.includes('border:2px solid ' + ACCENT), 'the banner is framed in the accent');
    assert.ok(style.includes('position:fixed') && style.includes('translateX(-50%)'), 'a fixed, transform-centred pill cannot reflow the page');
    assert.ok(style.includes('pointer-events:none'), 'the banner must not eat the click it asks for');
    assert.equal(d.doc.body.style.cursor, 'crosshair');
    assert.deepEqual(d.listeners.map((l) => l.type).sort(), ['click', 'keydown', 'mousemove']);
    for (const l of d.listeners) {
      assert.equal(l.capture, true, l.type + ' must listen in the capture phase');
    }
    state.cleanup();
    assert.equal(d.doc.body.style.cursor, 'pointer', 'the previous cursor comes back');
    assert.equal(d.children.length, 0);
    assert.ok(!('__schwabShot' in d.win), 'the arm key is deleted, not left behind as null');
    assert.doesNotThrow(() => state.cleanup(), 'cleanup is safe to call twice');
  }

  // hovering a cell frames the row that encloses it, grown by HIGHLIGHT_WIDTH
  {
    const d = fakeEnv();
    const row = positionRow();
    const state = armPicker(d.doc, d.win, () => {});
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    const frames = overlaysOf(d);
    assert.equal(frames.length, 1, 'the cell frames its row');
    const box = highlightRect(row.getBoundingClientRect());
    assert.deepEqual(
      { left: frames[0].style.left, top: frames[0].style.top, width: frames[0].style.width, height: frames[0].style.height },
      { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' },
    );
    assert.equal(frames[0].style.left, '38px', 'the frame sits outside the row, not over it');
    assert.ok(frames[0].attributes.style.includes('pointer-events:none'));
    assert.ok(frames[0].attributes.style.includes('background:transparent'), 'the frame must not hide the row it marks');
    assert.deepEqual(row.style, undefined, 'the row itself is never styled');

    // the row moves under the mouse and the frame follows it
    row.rect = { left: 40, top: 120, width: 720, height: 48 };
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    assert.equal(overlaysOf(d)[0].style.top, 120 - HIGHLIGHT_WIDTH + 'px');

    // off the rows entirely, and onto a row that measures nothing
    d.dispatch('mousemove', fakeEvent(chrome()));
    assert.equal(overlaysOf(d).length, 0, 'page chrome wears no frame');
    d.dispatch('mousemove', fakeEvent(rowCells(rowFromHtml(read('shares-zork.html')))[3]));
    assert.equal(overlaysOf(d).length, 0, 'a row with no measurable box gets no frame');
    state.cleanup();
  }

  // moves are coalesced through requestAnimationFrame, and a pending frame is cancelled
  {
    const d = fakeEnv();
    const row = positionRow();
    const queued = [];
    const cancelled = [];
    d.win.requestAnimationFrame = (fn) => {
      queued.push(fn);
      return queued.length;
    };
    d.win.cancelAnimationFrame = (id) => cancelled.push(id);
    const state = armPicker(d.doc, d.win, () => {});
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    d.dispatch('mousemove', fakeEvent(rowCells(row)[4]));
    assert.equal(queued.length, 1, 'two moves inside one frame schedule one repaint');
    assert.equal(overlaysOf(d).length, 0, 'nothing is placed until the frame runs');
    queued[0]();
    assert.equal(overlaysOf(d).length, 1);
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    assert.equal(queued.length, 2, 'the next move schedules again');
    state.cleanup();
    assert.deepEqual(cancelled, [2], 'the frame still in flight is cancelled');
    assert.doesNotThrow(() => queued[1](), 'a frame that runs anyway finds the picker stood down');
    assert.equal(overlaysOf(d).length, 0);
  }

  // the click is swallowed before Schwab sees it and resolves to the row
  {
    const d = fakeEnv();
    const row = positionRow();
    const picked = [];
    armPicker(d.doc, d.win, (r) => picked.push(r));
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    assert.equal(d.children.length, 2, 'banner and frame');
    const ev = fakeEvent(rowCells(row)[3]);
    d.dispatch('click', ev);
    assert.equal(ev.prevented, true, 'Schwab must not navigate');
    assert.equal(ev.stopped, true);
    assert.equal(ev.stoppedImmediately, true, 'a sibling capture handler must not see it either');
    assert.deepEqual(picked, [row]);
    assert.equal(d.children.length, 0, 'the banner and the frame go with the click');
    assert.equal(d.listeners.length, 0, 'a one-shot picker leaves no listeners behind');
    assert.deepEqual(d.timers, []);
  }

  // a click on a text node inside a cell still resolves to the row
  {
    const d = fakeEnv();
    const row = positionRow();
    const picked = [];
    armPicker(d.doc, d.win, (r) => picked.push(r));
    d.dispatch('click', fakeEvent({ parentElement: rowCells(row)[3] }));
    assert.deepEqual(picked, [row]);
  }

  // a click on page chrome says so, parks the banner for a beat, and stays down
  {
    const d = fakeEnv();
    const picked = [];
    armPicker(d.doc, d.win, (r) => picked.push(r));
    d.dispatch('click', fakeEvent(chrome()));
    assert.deepEqual(picked, [null]);
    assert.equal(d.children.length, 1);
    assert.equal(d.children[0].textContent, NO_ROW_TEXT);
    assert.equal(d.listeners.length, 0, 'a miss does not silently re-arm the picker');
    assert.equal(d.timers.length, 1);
    assert.equal(d.timers[0].ms, 1800);
    d.timers[0].fn();
    assert.equal(d.children.length, 0, 'the miss message clears itself');
  }

  // Esc stands the picker down and calls back with nothing
  {
    const d = fakeEnv();
    const row = positionRow();
    const picked = [];
    const state = armPicker(d.doc, d.win, (r) => picked.push(r));
    d.dispatch('mousemove', fakeEvent(rowCells(row)[3]));
    assert.equal(d.children.length, 2);
    d.dispatch('keydown', fakeEvent(null, 'a'));
    assert.deepEqual(picked, [], 'any other key is not a cancel');
    const esc = fakeEvent(null, 'Escape');
    d.dispatch('keydown', esc);
    assert.equal(esc.prevented, true);
    assert.deepEqual(picked, [null]);
    assert.equal(d.children.length, 0);
    assert.equal(d.listeners.length, 0);
    state.cleanup();
    assert.deepEqual(picked, [null], 'a cancel already spent calls back no further');
  }

  // Esc after the click has already resolved must not call back twice
  {
    const d = fakeEnv();
    const row = positionRow();
    const picked = [];
    const state = armPicker(d.doc, d.win, (r) => picked.push(r));
    const onKey = d.listeners.find((l) => l.type === 'keydown').fn;
    d.dispatch('click', fakeEvent(rowCells(row)[3]));
    onKey(fakeEvent(null, 'Escape'));
    assert.deepEqual(picked, [row]);
    assert.doesNotThrow(() => state.cleanup());
  }

  // arming twice replaces the first arm rather than stacking on it
  {
    const d = fakeEnv();
    const first = armPicker(d.doc, d.win, () => {});
    const second = armPicker(d.doc, d.win, () => {});
    assert.notEqual(first, second);
    assert.equal(d.children.length, 1, 'one banner, not two');
    assert.equal(d.listeners.length, 3, 'one set of listeners, not two');
    assert.equal(d.win.__schwabShot, second);
    first.cleanup();
    assert.equal(d.children.length, 1, 'the replaced arm takes nothing of the live one with it');
    assert.equal(d.doc.body.style.cursor, 'crosshair');
    second.cleanup();
    assert.equal(d.children.length, 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.doc.body.style.cursor, '');
  }

  // a picker armed without a callback resolves a click without throwing
  {
    const d = fakeEnv();
    const row = positionRow();
    armPicker(d.doc, d.win);
    assert.doesNotThrow(() => d.dispatch('click', fakeEvent(rowCells(row)[3])));
    assert.equal(d.children.length, 0);
  }
});

// --- the toast against the same fake document ------------------------------

// The messages on the page, found the way the module marks them.
function toastsOf(d) {
  return d.children.filter((el) => el.attributes && el.attributes['data-schwab-shot'] === 'toast');
}

test('toast', () => {
  assert.equal(TOAST_OK_TEXT, 'Copied to clipboard', 'the wiring, the clipboard and the README all quote this string');

  // a page whose body has not parsed yet is a no-op, not a crash
  assert.equal(typeof showToast({}, TOAST_OK_TEXT), 'function');
  assert.doesNotThrow(() => showToast({}, TOAST_OK_TEXT)());
  assert.doesNotThrow(() => showToast(null, TOAST_OK_TEXT)());

  // the success message announces itself in the success tone
  {
    const d = fakeEnv();
    showToast(d.doc, TOAST_OK_TEXT);
    assert.equal(toastsOf(d).length, 1);
    const el = toastsOf(d)[0];
    assert.equal(el.textContent, TOAST_OK_TEXT);
    assert.equal(el.attributes.role, 'status', 'a status role is what a screen reader announces');
    const style = el.attributes.style;
    assert.ok(style.includes('border-left:2px solid #22C55E'), 'a copy that worked reads green');
    assert.ok(style.includes('pointer-events:none'), 'the toast must never eat the click that follows it');
    assert.ok(style.includes('position:fixed') && style.includes('translateX(-50%)'), 'a fixed, transform-centred pill cannot reflow the page');
    assert.deepEqual(d.timers.map((t) => t.ms), [3200], 'the toast takes itself away');
  }

  // the failure message differs from it only in the edge colour
  {
    const d = fakeEnv();
    showToast(d.doc, 'Clipboard refused the image', 'error');
    const style = toastsOf(d)[0].attributes.style;
    assert.ok(style.includes('border-left:2px solid #EF4444'), 'a copy that failed reads red');
    assert.ok(!style.includes('#22C55E'));
    assert.equal(toastsOf(d)[0].textContent, 'Clipboard refused the image');
    const ok = fakeEnv();
    showToast(ok.doc, 'x');
    assert.equal(
      style.replace('#EF4444', '#22C55E'),
      toastsOf(ok)[0].attributes.style,
      'the two tones are one pill with one colour swapped',
    );
  }

  // a second message supersedes the first rather than stacking under it
  {
    const d = fakeEnv();
    showToast(d.doc, 'first');
    const remove = showToast(d.doc, 'second');
    assert.equal(toastsOf(d).length, 1, 'only one toast is ever on the page');
    assert.equal(toastsOf(d)[0].textContent, 'second');
    d.timers[0].fn();
    assert.equal(toastsOf(d).length, 1, 'the first toast timer must not take the second one down');
    assert.equal(toastsOf(d)[0].textContent, 'second');
    remove();
    assert.equal(toastsOf(d).length, 0, 'the returned remove detaches the toast');
    assert.doesNotThrow(() => remove(), 'remove is safe to call twice');
    assert.doesNotThrow(() => d.timers[1].fn(), 'the timeout is safe after a manual dismiss');
  }

  // the timeout is what dismisses an untouched toast
  {
    const d = fakeEnv();
    const remove = showToast(d.doc, TOAST_OK_TEXT);
    d.timers[0].fn();
    assert.equal(toastsOf(d).length, 0);
    assert.doesNotThrow(() => remove(), 'dismissing an expired toast does nothing');
  }

  // an empty message still draws a pill, because the padding is the pill
  {
    const d = fakeEnv();
    showToast(d.doc, '');
    assert.equal(toastsOf(d).length, 1);
    assert.equal(toastsOf(d)[0].textContent, '');
    assert.ok(toastsOf(d)[0].attributes.style.includes('padding:10px 16px'));
  }

  // a toast leaves an armed picker's own furniture alone
  {
    const d = fakeEnv();
    const state = armPicker(d.doc, d.win, () => {});
    showToast(d.doc, TOAST_OK_TEXT);
    assert.equal(d.children.length, 2);
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    state.cleanup();
    assert.equal(toastsOf(d).length, 1, 'standing the picker down does not clear the message');
  }
});

// --- the chooser against the same fake document ----------------------------

// The sheets the chooser has on the page, found the way it marks them.
function choosersOf(d) {
  return d.children.filter((el) => el.attributes && el.attributes['data-schwab-shot'] === 'chooser');
}

// The sheet's own buttons in document order: the three modes and cancel. The
// heading and the toggle row are its other children, and the toggles sit
// inside that row rather than beside these.
function buttonsOf(backdrop) {
  return backdrop.children[0].children.filter((el) => el.tagName === 'BUTTON');
}

// The toggle row's buttons, in the order the sheet offers the lines.
function togglesOf(backdrop) {
  const row = backdrop.children[0].children.find((el) => el.attributes['data-schwab-shot'] === 'chooser-toggles');
  return row ? row.children : [];
}

// A click delivered where a browser would deliver it first: the backdrop's
// capture listener, above the sheet whatever was clicked sits in.
function clickOn(d, backdrop, target) {
  const event = fakeEvent(target);
  d.dispatchOn(backdrop, 'click', event);
  return event;
}

test('chooser', () => {
  assert.equal(CHOOSER_TITLE, 'Share card');
  assert.deepEqual(
    CHOOSER_MODES,
    [{ id: 'pct', label: '% only' }, { id: 'usd', label: '$ only' }, { id: 'both', label: 'both' }],
    'the card builder and the wiring switch on these ids',
  );

  // a page whose body has not parsed yet is a no-op, not a crash
  assert.equal(typeof showChooser({}, () => {}), 'function');
  assert.doesNotThrow(() => showChooser({}, () => {})());
  assert.doesNotThrow(() => showChooser(null, () => {})());

  // the sheet offers the three modes and cancel over a dimmed page
  {
    const d = fakeEnv();
    const close = showChooser(d.doc, () => {});
    assert.equal(choosersOf(d).length, 1);
    const backdrop = choosersOf(d)[0];
    const dim = backdrop.attributes.style;
    assert.ok(dim.includes('position:fixed') && dim.includes('inset:0'), 'the backdrop covers the viewport');
    assert.ok(dim.includes('z-index:2147483646'), 'and sits one below the sheet it holds');
    const sheet = backdrop.children[0];
    assert.equal(sheet.attributes['data-schwab-shot'], 'chooser-sheet');
    assert.ok(sheet.attributes.style.includes('z-index:2147483647'));
    assert.ok(sheet.attributes.style.includes('border:1px solid ' + ACCENT), 'the sheet wears the Schwab accent');
    assert.equal(sheet.children[0].textContent, CHOOSER_TITLE);
    const buttons = buttonsOf(backdrop);
    assert.deepEqual(buttons.map((b) => b.textContent), ['% only', '$ only', 'both', 'Cancel']);
    assert.deepEqual(buttons.map((b) => b.attributes['data-schwab-shot-mode']), ['pct', 'usd', 'both', 'cancel']);
    assert.deepEqual(
      buttons.map((b) => b.attributes.type),
      ['button', 'button', 'button', 'button'],
      'a typed button cannot submit a Schwab form even reparented into one',
    );
    assert.equal(buttons[0].focused, true, 'percent only is the default answer');
    assert.deepEqual(d.listeners.map((l) => l.type + ':' + l.capture), ['keydown:true'], 'Esc is heard in the capture phase');
    assert.deepEqual(
      d.nodeListeners.map((l) => l.type + ':' + l.capture),
      ['click:true', 'click:true'],
      'the sheet and the backdrop both hear the click',
    );
    close();
  }

  // each mode button answers with its own id, and the page never sees the click
  for (const mode of ['pct', 'usd', 'both']) {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    const backdrop = choosersOf(d)[0];
    const button = buttonsOf(backdrop).find((b) => b.attributes['data-schwab-shot-mode'] === mode);
    const event = clickOn(d, backdrop, button);
    assert.deepEqual(picked, [mode]);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(event.stoppedImmediately, true, 'a Schwab handler under the sheet must not run');
    assert.equal(choosersOf(d).length, 0, 'answering takes the sheet off the page');
    assert.equal(d.listeners.length, 0);
    assert.equal(d.nodeListeners.length, 0);
  }

  // a click that lands inside a button is still that button's
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, { parentElement: buttonsOf(backdrop)[1] });
    assert.deepEqual(picked, ['usd']);
  }

  // cancel answers with nothing
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, buttonsOf(backdrop)[3]);
    assert.deepEqual(picked, [null]);
    assert.equal(choosersOf(d).length, 0);
  }

  // so does Esc, and it is swallowed on the way
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    d.dispatch('keydown', fakeEvent(null, 'a'));
    assert.deepEqual(picked, [], 'any other key is not a cancel');
    const esc = fakeEvent(null, 'Escape');
    d.dispatch('keydown', esc);
    assert.deepEqual(picked, [null]);
    assert.equal(esc.prevented, true);
    assert.equal(esc.stoppedImmediately, true, 'Esc must not also reach a picker still armed behind the sheet');
    assert.equal(choosersOf(d).length, 0);
    assert.equal(d.listeners.length, 0);
  }

  // the dimmed page around the sheet cancels; the sheet's own padding does not
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    const backdrop = choosersOf(d)[0];
    const padding = clickOn(d, backdrop, backdrop.children[0]);
    assert.deepEqual(picked, [], 'a miss inside the sheet is not an answer');
    assert.equal(padding.prevented, true, 'it is swallowed all the same');
    assert.equal(choosersOf(d).length, 1);
    clickOn(d, backdrop, backdrop);
    assert.deepEqual(picked, [null]);
    assert.equal(choosersOf(d).length, 0);
  }

  // the answer is given once, whatever arrives after it
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m));
    const backdrop = choosersOf(d)[0];
    const button = buttonsOf(backdrop)[0];
    const onKey = d.listeners.find((l) => l.type === 'keydown').fn;
    const onClick = d.nodeListeners.find((l) => l.node === backdrop).fn;
    clickOn(d, backdrop, button);
    onClick(fakeEvent(button));
    onKey(fakeEvent(null, 'Escape'));
    assert.deepEqual(picked, ['pct'], 'a double click answers once');
  }

  // close() dismisses the sheet without answering and is safe to call twice
  {
    const d = fakeEnv();
    const picked = [];
    const close = showChooser(d.doc, (m) => picked.push(m));
    close();
    assert.equal(choosersOf(d).length, 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.nodeListeners.length, 0);
    assert.deepEqual(picked, [], 'an abandoned flow is not a cancel the caller has to field');
    assert.doesNotThrow(() => close());
  }

  // a second chooser replaces the first rather than stacking on it
  {
    const d = fakeEnv();
    const first = [];
    const second = [];
    showChooser(d.doc, (m) => first.push(m));
    showChooser(d.doc, (m) => second.push(m));
    assert.equal(choosersOf(d).length, 1, 'one sheet, not two');
    assert.deepEqual(d.listeners.map((l) => l.type), ['keydown'], 'the replaced sheet takes its key listener with it');
    assert.equal(d.nodeListeners.length, 2);
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, buttonsOf(backdrop)[2]);
    assert.deepEqual(first, [], 'the replaced sheet answers no one');
    assert.deepEqual(second, ['both']);
  }

  // a backdrop some earlier page state left behind is swept off first
  {
    const d = fakeEnv();
    const stray = d.doc.createElement('div');
    stray.setAttribute('data-schwab-shot', 'chooser');
    d.doc.body.appendChild(stray);
    const close = showChooser(d.doc, () => {});
    assert.equal(choosersOf(d).length, 1);
    assert.notEqual(choosersOf(d)[0], stray);
    close();
  }

  // a chooser opened without a callback answers without throwing
  {
    const d = fakeEnv();
    showChooser(d.doc);
    const backdrop = choosersOf(d)[0];
    assert.doesNotThrow(() => clickOn(d, backdrop, buttonsOf(backdrop)[0]));
    assert.equal(choosersOf(d).length, 0);
  }

  // a button that cannot take focus is not a crash
  {
    const d = fakeEnv();
    const blind = Object.assign({}, d.doc, {
      createElement(tag) {
        const el = d.doc.createElement(tag);
        delete el.focus;
        return el;
      },
    });
    let close = null;
    assert.doesNotThrow(() => {
      close = showChooser(blind, () => {});
    });
    assert.equal(choosersOf(d).length, 1);
    close();
  }

  // the sheet leaves a message already on the page alone
  {
    const d = fakeEnv();
    showToast(d.doc, TOAST_OK_TEXT);
    const close = showChooser(d.doc, () => {});
    assert.equal(toastsOf(d).length, 1);
    close();
    assert.equal(toastsOf(d).length, 1, 'dismissing the sheet does not clear the message');
    assert.equal(choosersOf(d).length, 0);
  }
});

// The lines the sheet switches, as opposed to the way the card writes them.
// The modes are the older question and stay where they were; these ride above
// them and are what the answer now carries alongside the mode.
test('chooser-toggles', () => {
  assert.deepEqual(CHOOSER_TOGGLES, [
    { id: 'quantity', key: 'showQuantity', label: 'Quantity' },
    { id: 'day', key: 'showDayChange', label: 'Day change' },
    { id: 'overall', key: 'showOverallChange', label: 'Overall change' },
  ], 'the key is the name buildCard reads, so the sheet cannot drift from it');
  assert.equal(CHOOSER_HINT_TEXT, 'Turn on a line to copy');

  // the sheet asks which lines first and how to write them second
  {
    const d = fakeEnv();
    const close = showChooser(d.doc, () => {});
    const backdrop = choosersOf(d)[0];
    const sheet = backdrop.children[0];
    assert.deepEqual(
      sheet.children.map((el) => el.tagName),
      ['DIV', 'DIV', 'BUTTON', 'BUTTON', 'BUTTON', 'BUTTON'],
      'heading, the toggle row, the three modes and cancel',
    );
    const row = togglesOf(backdrop);
    assert.deepEqual(row.map((b) => b.textContent), ['Quantity', 'Day change', 'Overall change']);
    assert.deepEqual(row.map((b) => b.attributes['data-schwab-shot-toggle']), ['quantity', 'day', 'overall']);
    assert.deepEqual(row.map((b) => b.attributes.type), ['button', 'button', 'button']);
    assert.deepEqual(
      row.map((b) => b.attributes['aria-pressed']),
      ['false', 'false', 'true'],
      'the overall change starts on and the other two off',
    );
    assert.deepEqual(
      row.map((b) => b.attributes.style.includes('opacity:.45')),
      [true, true, false],
      'an off line is dimmed, because aria-pressed alone is not visible',
    );
    assert.equal(buttonsOf(backdrop)[0].focused, true, 'percent only is still the default answer');
    close();
  }

  // a mode answers with the toggles beside it, normalized for the builder
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m, o) => picked.push([m, o]));
    const backdrop = choosersOf(d)[0];
    const event = clickOn(d, backdrop, togglesOf(backdrop)[0]);
    assert.equal(event.stoppedImmediately, true, 'a toggle click is swallowed like any other');
    assert.equal(choosersOf(d).length, 1, 'and leaves the sheet up');
    assert.deepEqual(picked, [], 'a toggle is not an answer');
    assert.equal(togglesOf(backdrop)[0].attributes['aria-pressed'], 'true');
    assert.ok(!togglesOf(backdrop)[0].attributes.style.includes('opacity:.45'), 'and is no longer dimmed');

    clickOn(d, backdrop, buttonsOf(backdrop)[1]);
    assert.deepEqual(picked, [['usd', { showQuantity: true, showDayChange: false, showOverallChange: true }]]);
    assert.equal(choosersOf(d).length, 0, 'answering still takes the sheet off the page');
  }

  // a toggle clicked twice is a toggle, and a click inside one is still its own
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m, o) => picked.push([m, o]));
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, togglesOf(backdrop)[1]);
    clickOn(d, backdrop, { parentElement: togglesOf(backdrop)[1] });
    assert.equal(togglesOf(backdrop)[1].attributes['aria-pressed'], 'false');
    clickOn(d, backdrop, buttonsOf(backdrop)[0]);
    assert.deepEqual(picked, [['pct', { showQuantity: false, showDayChange: false, showOverallChange: true }]]);
  }

  // with every line off there is no card to copy, and the sheet says so
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m, o) => picked.push([m, o]));
    const backdrop = choosersOf(d)[0];
    const heading = backdrop.children[0].children[0];
    clickOn(d, backdrop, togglesOf(backdrop)[2]);
    assert.equal(heading.textContent, CHOOSER_HINT_TEXT, 'the heading turns into the hint');
    clickOn(d, backdrop, buttonsOf(backdrop)[2]);
    assert.deepEqual(picked, [], 'a mode cannot copy a card with no numbers on it');
    assert.equal(choosersOf(d).length, 1, 'so the sheet stays up to be answered');

    // cancel is still an answer, whatever the toggles say
    clickOn(d, backdrop, togglesOf(backdrop)[0]);
    assert.equal(heading.textContent, CHOOSER_TITLE, 'one line back on and it is a card again');
    clickOn(d, backdrop, buttonsOf(backdrop)[2]);
    assert.deepEqual(picked, [['both', { showQuantity: true, showDayChange: false, showOverallChange: false }]]);
  }

  // cancel and Esc answer with nothing, and no options to go with it
  for (const answer of ['cancel', 'escape']) {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m, o) => picked.push([m, o]));
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, togglesOf(backdrop)[2]);
    if (answer === 'cancel') {
      clickOn(d, backdrop, buttonsOf(backdrop)[3]);
    } else {
      d.dispatch('keydown', fakeEvent(null, 'Escape'));
    }
    assert.deepEqual(picked, [[null, null]], answer + ' answers with no card and no toggles');
    assert.equal(choosersOf(d).length, 0);
  }

  // the card the user was looking at is the card the clipboard gets
  {
    const d = fakeEnv();
    const picked = [];
    showChooser(d.doc, (m, o) => picked.push([m, o]));
    const backdrop = choosersOf(d)[0];
    clickOn(d, backdrop, togglesOf(backdrop)[1]);
    clickOn(d, backdrop, buttonsOf(backdrop)[0]);
    const snapshot = cardSnapshot({ dayPct: 1.24, dayDollars: 2750 });
    assert.deepEqual(
      cardTexts(buildCard(snapshot, picked[0][0], CARD_NOW, stubMeasure, picked[0][1])),
      ['INTC', 'Performance', '+12.40%', 'Day change +1.24%', 'Share Time: 09/11/2026 07:05', 'ss'],
    );
  }
});

// --- the card the sheet shows before the clipboard gets it -----------------

// The chooser's own page, with every canvas it asks for a recording one of the
// same fake DOM, so a card the preview drew is readable on its own calls
// rather than mixed into the last one's.
function previewEnv(opts) {
  const o = opts || {};
  const d = fakeEnv();
  const canvases = [];
  const element = d.doc.createElement;
  d.doc.createElement = (tag) => {
    const el = element(tag);
    if (tag === 'canvas') {
      el.ctx = fakeCtx();
      el.getContext = (kind) => (kind === '2d' && !o.noContext ? el.ctx : null);
      canvases.push(el);
    }
    return el;
  };
  d.canvases = canvases;
  return d;
}

// The slot the preview hangs in: the sheet's third child, between the toggle
// row and the first mode button. It carries no mark of its own, so its place
// in the sheet is the contract, and reading it positionally is what pins the
// order the sheet is meant to read in.
function previewSlot(backdrop) {
  return backdrop.children[0].children[2];
}

// The strings the latest preview put on its canvas.
function previewTexts(d) {
  return textRuns(d.canvases[d.canvases.length - 1].ctx.calls).map((run) => run.text);
}

// The sheet's mode button for an id, cancel included.
function sheetMode(backdrop, mode) {
  return buttonsOf(backdrop).find((b) => b.attributes['data-schwab-shot-mode'] === mode);
}

test('chooser preview', () => {
  const snapshot = cardSnapshot({ dayPct: 1.24, dayDollars: 2750 });

  // the sheet opens showing the card the focused mode would copy
  {
    const d = previewEnv();
    const close = showChooser(d.doc, () => {}, snapshot);
    const backdrop = choosersOf(d)[0];
    const slot = previewSlot(backdrop);
    assert.equal(d.canvases.length, 1, 'one card is drawn, not one per mode');
    assert.deepEqual(slot.children, [d.canvases[0]], 'and it hangs in the slot above the modes');
    assert.equal(d.canvases[0].width, CARD_W);
    assert.equal(d.canvases[0].height, CARD_H, 'the preview is a full card, held small by CSS alone');
    assert.ok(
      d.canvases[0].attributes.style.includes('width:min(240px,38vh)'),
      'so the pixels it shows are the pixels the clipboard would get',
    );
    const texts = previewTexts(d);
    assert.deepEqual(
      texts.slice(0, 3),
      ['INTC', 'Performance', '+12.40%'],
      'and it is the percent card, because % only is the mode the sheet focuses',
    );
    assert.match(texts[3], /^Share Time: /, 'stamped from the clock, like the card the copy draws');
    assert.deepEqual(texts.slice(4), ['ss'], 'and carrying nothing the copied card would not');
    close();
  }

  // reaching a mode with the pointer redraws the slot for it; the clipboard
  // still waits for the click that follows
  {
    const d = previewEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m), snapshot);
    const backdrop = choosersOf(d)[0];
    const sheet = backdrop.children[0];
    d.dispatchOn(sheet, 'pointerover', fakeEvent(sheetMode(backdrop, 'usd')));
    assert.equal(d.canvases.length, 2, 'the mode under the pointer is drawn');
    assert.deepEqual(previewTexts(d).slice(0, 3), ['INTC', 'Performance', '+$24,800.00']);
    assert.deepEqual(
      previewSlot(backdrop).children,
      [d.canvases[1]],
      'one slot, redrawn, rather than a second card stacked under the first',
    );
    assert.deepEqual(picked, [], 'hovering a mode is a question, not an answer');
    clickOn(d, backdrop, sheetMode(backdrop, 'usd'));
    assert.deepEqual(picked, ['usd'], 'the click is what copies, after the preview showed what');
  }

  // tabbing onto a mode redraws it too, so the keyboard sees what the mouse
  // would have
  {
    const d = previewEnv();
    showChooser(d.doc, () => {}, snapshot);
    const backdrop = choosersOf(d)[0];
    const sheet = backdrop.children[0];
    d.dispatchOn(sheet, 'focusin', fakeEvent(sheetMode(backdrop, 'both')));
    assert.deepEqual(previewTexts(d).slice(0, 4), ['INTC', 'Performance', '+12.40%', '+$24,800.00']);

    // the mode already on the slot and Cancel are both nothing to redraw
    const drawn = d.canvases.length;
    d.dispatchOn(sheet, 'pointerover', fakeEvent(sheetMode(backdrop, 'both')));
    d.dispatchOn(sheet, 'pointerover', fakeEvent(sheetMode(backdrop, 'cancel')));
    d.dispatchOn(sheet, 'pointerover', fakeEvent(backdrop));
    assert.equal(d.canvases.length, drawn, 'a preview is only redrawn when it would change');

    // a line switched on is a different card, and the slot shows that card in
    // the mode it was already showing
    clickOn(d, backdrop, togglesOf(backdrop)[0]);
    assert.equal(d.canvases.length, drawn + 1);
    assert.deepEqual(
      previewTexts(d).slice(0, 5),
      ['INTC', 'Performance', '+12.40%', '+$24,800.00', 'Quantity 1,337'],
      'the toggle redraws the mode the user was looking at',
    );
  }

  // a card that cannot be drawn says so in the slot and copies anyway
  {
    const d = previewEnv();
    const picked = [];
    showChooser(d.doc, (m) => picked.push(m), { instrument: 'INTC', totalPct: null, totalDollars: null });
    const backdrop = choosersOf(d)[0];
    assert.equal(previewSlot(backdrop).textContent, 'No preview');
    assert.deepEqual(previewSlot(backdrop).children, [], 'and hangs no blank canvas beside the words');
    clickOn(d, backdrop, sheetMode(backdrop, 'pct'));
    assert.deepEqual(picked, ['pct'], 'a preview that failed still lets the clipboard be tried');
  }

  // a page that hands back no 2d context is the same kind of failure
  {
    const d = previewEnv({ noContext: true });
    showChooser(d.doc, () => {}, snapshot);
    assert.equal(previewSlot(choosersOf(d)[0]).textContent, 'No preview');
  }

  // no snapshot is no preview: the sheet is the one it has always been
  {
    const d = previewEnv();
    showChooser(d.doc, () => {});
    const sheet = choosersOf(d)[0].children[0];
    assert.equal(d.canvases.length, 0, 'nothing to draw and nothing drawn');
    assert.equal(sheet.children.length, 6, 'a heading, the toggle row, three modes and Cancel');
    assert.ok(!sheet.onpointerover, 'and no handler listening for a mode to preview');
  }

  // closing the sheet takes the preview's handlers with it
  {
    const d = previewEnv();
    const close = showChooser(d.doc, () => {}, snapshot);
    const sheet = choosersOf(d)[0].children[0];
    assert.equal(typeof sheet.onpointerover, 'function');
    assert.ok(d.nodeListeners.some((l) => l.type === 'focusin'), 'and the keyboard is heard too');
    close();
    assert.equal(sheet.onpointerover, null);
    assert.equal(d.nodeListeners.length, 0, 'a dismissed sheet leaves nothing listening');
  }
});

// --- the whole flow, from one click to one PNG on the clipboard ------------

// What the encoder hands the writer on a page where everything works.
const FLOW_BLOB = { type: 'image/png', size: 4096 };

// The page main() runs against: the picker's own fake document taught to
// answer createElement('canvas') with a recording canvas, and one window
// carrying both the picker's timers and the clipboard the writer asks for.
// Everything the flow draws, copies and leaves behind is then readable off a
// single object, which is what lets one assertion block cover a whole run.
// Each canvas is its own recorder because the sheet draws a preview before the
// copy draws anything: d.canvas and d.ctx are the latest of them, which on a
// finished run is the card that reached the clipboard.
function flowEnv(opts) {
  const o = opts || {};
  const d = fakeEnv();
  const canvases = [];
  const unused = fakeCtx();
  const element = d.doc.createElement;
  d.doc.createElement = (tag) => {
    if (tag !== 'canvas') {
      return element(tag);
    }
    const ctx = fakeCtx();
    const canvas = o.noContext ? { getContext: () => null } : fakeCanvas(ctx, 'blob' in o ? o.blob : FLOW_BLOB);
    canvas.ctx = ctx;
    canvases.push(canvas);
    return canvas;
  };
  const win = fakeWin(o);
  win.setTimeout = d.win.setTimeout;
  d.doc.defaultView = win;
  d.canvases = canvases;
  Object.defineProperty(d, 'canvas', { get: () => canvases[canvases.length - 1] });
  Object.defineProperty(d, 'ctx', { get: () => (d.canvas ? d.canvas.ctx : unused) });
  d.win = win;
  return d;
}

// The strings the card put on the canvas, in the order they were drawn.
function flowTexts(d) {
  return textRuns(d.ctx.calls).map((run) => run.text);
}

// A button in the open sheet, found by the mode id the wiring reads.
function modeButton(d, mode) {
  return buttonsOf(choosersOf(d)[0]).find((el) => el.attributes['data-schwab-shot-mode'] === mode);
}

// A click delivered where a real one would land: on a cell inside the row,
// which the picker climbs from.
function clickRow(d, row) {
  d.dispatch('click', fakeEvent(rowCells(row)[0]));
}

test('end-to-end', async () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
  // One macrotask drains every microtask the encode and the write queued.
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const SHARE_TIME = /^Share Time: \d\d\/\d\d\/\d{4} \d\d:\d\d$/;

  const cards = [
    {
      file: 'shares-zork.html',
      instrument: 'ZORK',
      numbers: { pct: ['+12.40%'], usd: ['+$24,800.00'], both: ['+12.40%', '+$24,800.00'] },
    },
    {
      file: 'short-call-acme.html',
      instrument: 'ACME 01/15/2027 50.00 C',
      side: 'sell-to-open',
      numbers: { pct: ['-3.25%'], usd: ['-$65.00'], both: ['-3.25%', '-$65.00'] },
    },
    {
      file: 'long-call-acme.html',
      instrument: 'ACME 12/15/2028 240.00 C',
      side: 'buy-to-open',
      numbers: { pct: ['+41.70%'], usd: ['+$8,340.00'], both: ['+41.70%', '+$8,340.00'] },
    },
  ];

  // three fixtures times three modes: the card carries exactly the words that
  // mode asks for, and exactly one PNG reaches the clipboard
  for (const card of cards) {
    for (const mode of CHOOSER_MODES.map((entry) => entry.id)) {
      const label = card.file + ' as ' + mode;
      const d = flowEnv();
      main(d.doc, d.win);
      assert.equal(d.children.length, 1, label + ': the click arms the picker and nothing else');
      assert.equal(d.children[0].textContent, BANNER_TEXT, label);

      clickRow(d, rowFromHtml(read(card.file)));
      assert.equal(choosersOf(d).length, 1, label + ': a picked row asks which numbers to show');
      assert.equal(overlaysOf(d).length, 0, label + ': and the picker is already down');
      assert.equal(d.win.writes.length, 0, label + ': nothing is copied before a mode is chosen');

      clickOn(d, choosersOf(d)[0], modeButton(d, mode));
      await flush();

      const texts = flowTexts(d);
      // an option row names the side it was opened on, a share row does not
      const head = card.side ? [card.instrument, card.side] : [card.instrument];
      const expected = head.concat(['Performance'], card.numbers[mode]);
      assert.deepEqual(texts.slice(0, expected.length), expected, label);
      assert.equal(texts.length, expected.length + 2, label + ': and nothing else is drawn');
      assert.match(texts[texts.length - 2], SHARE_TIME, label + ': the footer pins when it was shared');
      assert.equal(texts[texts.length - 1], 'ss', label);
      assert.equal(d.canvas.width, CARD_W, label);
      assert.equal(d.canvas.height, CARD_H, label);
      assert.deepEqual(d.canvas.types, ['image/png'], label + ': the card is encoded as a PNG');

      assert.equal(d.win.writes.length, 1, label + ': one write reaches the clipboard');
      assert.equal(d.win.writes[0].length, 1, label + ': carrying one item');
      assert.equal(d.win.writes[0][0], d.win.items[0], label);
      assert.deepEqual(Object.keys(d.win.items[0].parts), ['image/png'], label);
      assert.equal(d.win.items[0].parts['image/png'], FLOW_BLOB, label + ': the encoded blob itself');

      assert.equal(toastsOf(d).length, 1, label + ': the copy reports itself once');
      assert.equal(toastsOf(d)[0].textContent, TOAST_OK_TEXT, label);
      assert.ok(toastsOf(d)[0].attributes.style.includes('#22C55E'), label + ': a copy that worked reads green');
      assert.equal(d.children.length, 1, label + ': the message is all that is left on the page');
      assert.equal(d.children[0], toastsOf(d)[0], label);
      assert.equal(choosersOf(d).length, 0, label + ': no sheet and no backdrop survive the copy');
    }
  }

  // Esc while the picker is armed: nothing drawn, nothing copied, nothing left
  {
    const d = flowEnv();
    main(d.doc, d.win);
    d.dispatch('keydown', fakeEvent(null, 'Escape'));
    await flush();
    assert.equal(d.children.length, 0, 'Esc during the picker leaves the page as it was');
    assert.equal(choosersOf(d).length, 0, 'and never asks for a mode');
    assert.equal(d.ctx.calls.length, 0, 'and paints no card');
    assert.equal(d.win.writes.length, 0);
  }

  // Esc while the sheet is open
  {
    const d = flowEnv();
    main(d.doc, d.win);
    clickRow(d, rowFromHtml(read('shares-zork.html')));
    assert.equal(choosersOf(d).length, 1);
    d.dispatch('keydown', fakeEvent(null, 'Escape'));
    await flush();
    assert.equal(d.children.length, 0, 'Esc during the chooser leaves no backdrop dimming the page');
    assert.equal(toastsOf(d).length, 0, 'a cancel is not a failure worth a message');
    assert.deepEqual(d.canvas.types, [], 'the card the sheet was previewing is never encoded');
    assert.equal(d.win.writes.length, 0);
  }

  // Cancel on the sheet
  {
    const d = flowEnv();
    main(d.doc, d.win);
    clickRow(d, rowFromHtml(read('shares-zork.html')));
    clickOn(d, choosersOf(d)[0], modeButton(d, 'cancel'));
    await flush();
    assert.equal(d.children.length, 0, 'Cancel leaves the page as it was');
    assert.deepEqual(d.canvas.types, [], 'a cancelled card is never encoded');
    assert.equal(d.win.writes.length, 0);
  }

  // a click that landed on no position: the picker says so in its own banner
  {
    const d = flowEnv();
    main(d.doc, d.win);
    d.dispatch('click', fakeEvent(fakeEl('div', ' class="page-chrome"', 'x')));
    await flush();
    assert.equal(choosersOf(d).length, 0, 'a miss asks nothing');
    assert.equal(toastsOf(d).length, 0, 'and does not repeat itself in a toast');
    assert.equal(d.children.length, 1);
    assert.equal(d.children[0].textContent, NO_ROW_TEXT);
    assert.equal(d.win.writes.length, 0);
    d.timers[d.timers.length - 1].fn();
    assert.equal(d.children.length, 0, 'the miss message takes itself away');
  }

  // a row the parser cannot read: the message, and no chooser behind it
  {
    const d = flowEnv();
    main(d.doc, d.win);
    const unreadable = rowFromHtml('<tr app-position-row=""><td> 100 </td></tr>');
    d.dispatch('click', fakeEvent(rowCells(unreadable)[0]));
    await flush();
    assert.equal(choosersOf(d).length, 0, 'an unreadable row never opens the chooser');
    assert.equal(toastsOf(d).length, 1);
    assert.equal(toastsOf(d)[0].textContent, NO_ROW_TEXT);
    assert.ok(toastsOf(d)[0].attributes.style.includes('#EF4444'), 'and says so in the error tone');
    assert.equal(d.ctx.calls.length, 0);
    assert.equal(d.win.writes.length, 0);
  }

  // a clipboard that refuses names the refusal and still clears the sheet
  {
    const refusal = new Error('write blocked');
    refusal.name = 'NotAllowedError';
    const d = flowEnv({ reject: refusal });
    main(d.doc, d.win);
    clickRow(d, rowFromHtml(read('shares-zork.html')));
    clickOn(d, choosersOf(d)[0], modeButton(d, 'both'));
    await flush();
    assert.equal(d.win.writes.length, 1, 'the write was attempted');
    assert.equal(toastsOf(d).length, 1);
    assert.equal(toastsOf(d)[0].textContent, CLIPBOARD_MESSAGES['permission-denied']);
    assert.ok(toastsOf(d)[0].attributes.style.includes('#EF4444'), 'a refusal reads red');
    assert.equal(choosersOf(d).length, 0, 'a refusal must never leave the page dimmed');
    assert.equal(d.children.length, 1);
  }

  // a page that hands back no 2d context is a failed copy, not a blank one
  {
    const d = flowEnv({ noContext: true });
    main(d.doc, d.win);
    clickRow(d, rowFromHtml(read('shares-zork.html')));
    clickOn(d, choosersOf(d)[0], modeButton(d, 'pct'));
    await flush();
    assert.equal(d.win.writes.length, 0, 'nothing is copied when nothing was drawn');
    assert.equal(toastsOf(d)[0].textContent, CLIPBOARD_MESSAGES['write-failed']);
    assert.ok(toastsOf(d)[0].attributes.style.includes('#EF4444'));
    assert.equal(choosersOf(d).length, 0);
  }

  // the seam on its own, where a fixed clock pins the footer the flow cannot
  {
    const d = flowEnv();
    const snapshot = parsePositionRow(rowFromHtml(read('shares-zork.html')));
    assert.deepEqual(await runFlow(d.doc, d.win, snapshot, 'both', CARD_NOW), { ok: true });
    assert.deepEqual(flowTexts(d), [
      'ZORK',
      'Performance',
      '+12.40%',
      '+$24,800.00',
      'Share Time: 09/11/2026 07:05',
      'ss',
    ]);
    assert.equal(toastsOf(d)[0].textContent, TOAST_OK_TEXT);
  }

  // an encode that hands back no image reports the same failure as a refusal
  {
    const d = flowEnv({ blob: null });
    const snapshot = parsePositionRow(rowFromHtml(read('shares-zork.html')));
    assert.deepEqual(
      await runFlow(d.doc, d.win, snapshot, 'pct', CARD_NOW),
      { ok: false, code: 'write-failed', message: CLIPBOARD_MESSAGES['write-failed'] },
    );
    assert.equal(d.win.writes.length, 0, 'an image that does not exist is never written');
    assert.equal(toastsOf(d)[0].textContent, CLIPBOARD_MESSAGES['write-failed']);
  }

  // an http page is refused before the clipboard is asked at all
  {
    const d = flowEnv({ isSecureContext: false });
    const snapshot = parsePositionRow(rowFromHtml(read('shares-zork.html')));
    const outcome = await runFlow(d.doc, d.win, snapshot, 'usd', CARD_NOW);
    assert.equal(outcome.message, CLIPBOARD_MESSAGES['insecure-context']);
    assert.equal(d.win.writes.length, 0);
    assert.equal(toastsOf(d)[0].textContent, CLIPBOARD_MESSAGES['insecure-context']);
  }

  // a mode the chooser never offers draws nothing rather than a blank card
  {
    const d = flowEnv();
    const snapshot = parsePositionRow(rowFromHtml(read('shares-zork.html')));
    assert.equal((await runFlow(d.doc, d.win, snapshot, 'day', CARD_NOW)).ok, false);
    assert.equal(flowTexts(d).length, 0);
    assert.equal(d.win.writes.length, 0);
  }

  // clicking the bookmarklet twice arms one picker, and a page with no body
  // is a no-op rather than a crash
  {
    const d = flowEnv();
    main(d.doc, d.win);
    main(d.doc, d.win);
    assert.equal(d.children.length, 1, 'the second arm replaces the first instead of stacking on it');
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    assert.doesNotThrow(() => main(null, null));
    assert.doesNotThrow(() => main({}, {}));
    assert.doesNotThrow(() => main(), 'no document and no window is simply nothing to do');
  }
});

// --- no-network: the program talks to nothing at all -----------------------

// Names that become traps on globalThis and on the fake window: a getter that
// records the name and throws, so the bookmarklet cannot reach an endpoint by
// either path without failing the test.
const POISONED_GLOBALS = ['fetch', 'XMLHttpRequest', 'XDomainRequest', 'WebSocket', 'EventSource', 'Image', 'Worker', 'SharedWorker', 'RTCPeerConnection', 'indexedDB', 'localStorage', 'sessionStorage', 'caches'];

// The navigator members a page would carry data out through. clipboard is not
// one of them: it is what the user asked for, so it is left working and the
// run has to prove it was the only member touched.
const POISONED_NAVIGATOR = ['sendBeacon', 'serviceWorker', 'geolocation', 'credentials', 'mediaDevices'];

function poison(target, prop, label, log) {
  Object.defineProperty(target, prop, {
    configurable: true,
    enumerable: false,
    get() {
      log.push(label);
      throw new Error('the bookmarklet touched ' + label);
    },
    set() {
      log.push(label);
      throw new Error('the bookmarklet assigned ' + label);
    },
  });
}

// Runs fn with the flow environment d installed as the global document, window
// and navigator and every poisoned name in place, then restores each global
// from the own-property descriptor snapshotted beforehand (names Node never
// had are deleted again). fn is awaited inside the guard, so the traps are
// still up while the encode and the clipboard write settle rather than only
// while the click is delivered. Returns the labels the bookmarklet touched.
// Whatever fn did, throw or return, the page must be left without listeners.
async function withPoisonedGlobals(d, fn) {
  const log = [];
  const names = POISONED_GLOBALS.concat(['navigator', 'document', 'window']);
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const navigator = d.win.navigator;
  for (const prop of POISONED_NAVIGATOR) {
    poison(navigator, prop, 'navigator.' + prop, log);
  }
  for (const name of POISONED_GLOBALS) {
    poison(d.win, name, 'window.' + name, log);
  }
  poison(d.doc, 'cookie', 'document.cookie', log);
  d.win.postMessage = function () {
    log.push('window.postMessage');
    throw new Error('the bookmarklet called window.postMessage');
  };
  const realCreate = d.doc.createElement;
  d.created = [];
  d.doc.createElement = function (tag) {
    d.created.push(String(tag).toLowerCase());
    return realCreate.call(d.doc, tag);
  };
  let failure = null;
  try {
    for (const name of POISONED_GLOBALS) {
      poison(globalThis, name, name, log);
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: navigator });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: d.doc });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: d.win });
    await fn(log);
  } catch (e) {
    failure = e;
  } finally {
    for (const [name, desc] of saved) {
      if (desc) {
        Object.defineProperty(globalThis, name, desc);
      } else {
        delete globalThis[name];
      }
    }
  }
  const leftover = d.listeners.length + d.nodeListeners.length;
  if (failure) {
    if (leftover) {
      failure.message += ' (' + leftover + ' listener(s) left behind)';
    }
    throw failure;
  }
  assert.equal(leftover, 0, 'listeners left behind');
  return log;
}

// The committed bookmarklet, decoded and run the way a browser runs it: a
// plain script in the global scope whose main() falls back to the globals the
// harness installed.
function runBookmarklet() {
  new Function(decodeBookmarklet(readFileSync(OUTPUT_PATH, 'utf8').trim()))();
}

test('no-network-static', () => {
  const stripped = stripModule(readFileSync(MODULE_PATH, 'utf8'));
  const built = decodeBookmarklet(readFileSync(OUTPUT_PATH, 'utf8').trim());
  assert.ok(stripped.length > 5000 && built.length > 5000, 'both texts are the whole program');
  for (const [name, text] of [['module', stripped], ['bookmarklet', built]]) {
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), name + ' contains ' + JSON.stringify(token));
    }
    // Unlike a bookmarklet that links somewhere, this one has no allowed
    // destination at all, so the expected set is empty rather than a subset.
    assert.deepEqual(text.match(SCHEME_URL_RE) || [], [], name + ' names a remote destination');
    assert.deepEqual(text.match(HOSTNAME_RE) || [], [], name + ' hostname literals');
    assert.ok(text.includes('navigator.clipboard'), name + ' still reaches the one allowed capability');
  }

  // the scan bites: each rule catches a planted violation
  assert.ok(FORBIDDEN_TOKENS.some((t) => (stripped + "navigator.sendBeacon('/x')").includes(t)));
  assert.ok(FORBIDDEN_TOKENS.some((t) => (built + "a.style.background='url(x.png)'").includes(t)));
  assert.deepEqual((stripped + " fetch('https://evil.net/x')").match(SCHEME_URL_RE), ['https://evil.net/x']);
  assert.deepEqual([...new Set((built + ' "//cdn.example.com/a.js"').match(HOSTNAME_RE))], ['cdn.example.com']);
  assert.deepEqual('card.mode || hit.constructor'.match(HOSTNAME_RE), null);
});

test('no-network-runtime', async () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
  // One macrotask drains every microtask the encode and the write queued.
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  // the traps are live, the copy path is not trapped, and the harness leaves
  // no trace of itself on the real globals
  {
    const d = flowEnv();
    const log = await withPoisonedGlobals(d, () => {
      assert.throws(() => fetch('/x'), /touched fetch/);
      assert.throws(() => new Image(), /touched Image/);
      assert.throws(() => navigator.sendBeacon('/x'), /navigator\.sendBeacon/);
      assert.throws(() => document.cookie, /document\.cookie/);
      assert.throws(() => window.WebSocket, /window\.WebSocket/);
      assert.throws(() => window.postMessage('x', '*'), /postMessage/);
      assert.equal(document, d.doc);
      assert.equal(window, d.win);
      assert.equal(typeof navigator.clipboard.write, 'function', 'the clipboard is left working');
    });
    assert.deepEqual(log, ['fetch', 'Image', 'navigator.sendBeacon', 'document.cookie', 'window.WebSocket', 'window.postMessage']);
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof fetch, 'function', 'the real fetch is back');
    for (const name of POISONED_GLOBALS) {
      assert.doesNotThrow(() => globalThis[name], name + ' is still trapped');
    }
  }

  // the whole flow, driven through the artifact the user installs
  const d = flowEnv();
  const log = await withPoisonedGlobals(d, async () => {
    runBookmarklet();
    assert.equal(d.children.length, 1, 'the bookmarklet armed the picker');
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    clickRow(d, rowFromHtml(read('shares-zork.html')));
    assert.equal(choosersOf(d).length, 1, 'a picked row asks which numbers to show');
    clickOn(d, choosersOf(d)[0], modeButton(d, 'both'));
    await flush();
  });
  assert.deepEqual(log, [], 'poisoned globals touched');

  // and the run really happened: a PNG on the clipboard, drawn from the row
  assert.equal(d.win.writes.length, 1, 'one write reaches the clipboard');
  assert.equal(d.win.writes[0].length, 1, 'carrying one item');
  assert.equal(d.win.writes[0][0], d.win.items[0]);
  assert.deepEqual(Object.keys(d.win.items[0].parts), ['image/png']);
  assert.equal(d.win.items[0].parts['image/png'], FLOW_BLOB, 'the encoded blob itself');
  assert.deepEqual(d.canvas.types, ['image/png']);
  assert.deepEqual(flowTexts(d).slice(0, 4), ['ZORK', 'Performance', '+12.40%', '+$24,800.00']);
  assert.deepEqual([...new Set(d.created)].sort(), ['button', 'canvas', 'div'], 'nothing that can load a resource is created');
  assert.equal(toastsOf(d).length, 1, 'the copy reports itself once');
  assert.equal(toastsOf(d)[0].textContent, TOAST_OK_TEXT);
  assert.equal(choosersOf(d).length, 0, 'no sheet survives the copy');
  assert.equal(overlaysOf(d).length, 0, 'and the picker is down');
  assert.equal(d.children.length, 1, 'the message is all that is left on the page');
});

// --- readme: the two documents, held to what the program actually does ------

// Spelled in halves on purpose. The publish scan forbids exactly these tokens
// and reads every exported file, so a literal one here would flag the suite
// itself the moment this package is copied into the public tree.
const PRIVATE_MARKERS = ['bookmarklet|s/', 'ort|us', 'bea|ds', 'AGENTS|.md', '.cur|sor'].map((m) => m.replace('|', ''));

test('readme', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = join(HERE, '..', '..');
  // The published text sits under public/ here and at the root of the exported
  // tree, so the suite finds it in either place and this test is a real gate
  // on both sides of the export rather than only on this one.
  const publishedPath = [join(root, 'public', 'README.md'), join(root, 'README.md')].find((p) => existsSync(p));
  assert.ok(publishedPath, 'no published README in either tree');
  const published = readFileSync(publishedPath, 'utf8');

  // both install routes, and the scheme a bookmark manager likes to eat
  assert.ok(published.includes('javascript:'), 'install never names the URL scheme');
  assert.ok(published.includes('src/schwab-share-card/'), 'the public package path is missing');
  assert.ok(published.includes('schwab-screenshotter.bookmarklet.txt'), 'no paste-it-by-hand route');

  // the three modes and the three lines, under the labels the sheet puts in
  // front of the user
  for (const mode of CHOOSER_MODES) {
    assert.ok(published.includes(mode.label), 'undocumented mode: ' + mode.label);
  }
  for (const toggle of CHOOSER_TOGGLES) {
    assert.ok(published.includes(toggle.label), 'undocumented line: ' + toggle.label);
  }
  assert.ok(published.includes(CHOOSER_HINT_TEXT), 'the sheet can say this and the README cannot');
  assert.ok(published.includes(PREVIEW_ERROR), 'the preview can say this and the README cannot');

  // every word the program can say, quoted where a user who saw one can find it
  assert.ok(published.includes(TOAST_OK_TEXT), 'the success message is not quoted');
  for (const message of Object.values(CLIPBOARD_MESSAGES)) {
    assert.ok(published.includes(message), 'unquoted failure message: ' + message);
  }

  // the privacy claim, and the two tests that are the reason it can be made
  assert.ok(/no network requests/i.test(published), 'the no-network claim is missing');
  assert.ok(published.includes('no-network-static'), 'the static scan is not cited');
  assert.ok(published.includes('no-network-runtime'), 'the runtime trap is not cited');

  // the warning, and the two modes that are the reason it exists
  const postAt = published.search(/before it goes anywhere public|before you post/i);
  assert.ok(postAt > 0, 'no review-before-posting warning');
  const warning = published.slice(postAt, postAt + 800);
  assert.ok(warning.includes('$ only'), 'the warning does not call out $ only');
  assert.ok(warning.includes('both'), 'the warning does not call out both');
  for (const field of ['account number', 'cost basis', 'quantity', 'market value']) {
    assert.ok(new RegExp(field, 'i').test(published), 'the card never shows ' + field + ', and says so nowhere');
  }

  // a public reader has an ordinary node and no PATH shim, so the commands differ
  assert.ok(published.includes('node src/schwab-share-card/build.mjs'), 'no public build command');
  assert.ok(
    published.includes('node --test src/schwab-share-card/schwab-screenshotter.test.mjs'),
    'no public test command',
  );

  for (const marker of PRIVATE_MARKERS) {
    assert.ok(!published.toLowerCase().includes(marker.toLowerCase()), 'the published README names ' + marker);
  }

  // The package README is the contributor's document and is dropped by the
  // export, so it is checked only where it exists.
  const packagePath = join(HERE, 'README.md');
  if (existsSync(packagePath)) {
    const pkg = readFileSync(packagePath, 'utf8');
    assert.ok(
      pkg.includes('bash scripts/with-node.sh node src/schwab-share-card/build.mjs'),
      'the package README does not name the build command',
    );
    assert.ok(
      pkg.includes('bash scripts/with-node.sh node --test src/schwab-share-card/schwab-screenshotter.test.mjs'),
      'the package README does not name the test command',
    );
    assert.ok(pkg.includes(String(MAX_BYTES)), 'the package README does not state the byte budget');
  }
});
