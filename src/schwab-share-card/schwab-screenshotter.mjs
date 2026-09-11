// schwab-screenshotter.mjs
// Schwab Positions -> share-card screenshot bookmarklet.
//
// The pure helpers are exported for node:test. A later build.mjs strips the
// export keywords, drops the auto-run guard between the strip markers, wraps
// the rest in an IIFE that ends with main(), and percent-encodes the result.
// Keep this file free of imports, template literals, trailing comments, and
// regex literals that contain quote characters: the squeeze pipeline relies
// on that.

export const MAX_WALK = 8;
export const BANNER_TEXT = 'Click a position (Esc to cancel)';
export const NO_ROW_TEXT = 'No Schwab position found in what you clicked';
export const TOAST_OK_TEXT = 'Copied to clipboard';
export const ACCENT = '#00A0DF';
export const HIGHLIGHT_WIDTH = 2;
export const CARD_W = 1080;
export const CARD_H = 1920;

// The attribute every node this program adds to the page carries, and the one
// the sheet's mode buttons carry instead. Schwab uses neither name, so the
// pair is how the module recognises its own work -- to take a leftover overlay
// or sheet back off, and to read what a click inside the sheet asked for.
const SHOT = 'data-schwab-shot';
const SHOT_MODE = SHOT + '-mode';

// The banner's own box. Fixed and centred by a transform, so its border can
// never reflow what sits underneath it.
const BANNER_STYLE = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:6px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;border:2px solid ' + ACCENT + ';';

// Is this callable? The module never assumes a DOM node, a canvas context or
// a window has the method it is about to reach for, so this question is asked
// more than three dozen times, and spelling it out in full at every one of
// them is the single largest repeated string in the program.
function isFn(value) {
  return typeof value === 'function';
}

export function attrOf(el, name) {
  if (!el || !isFn(el.getAttribute)) {
    return null;
  }
  return el.getAttribute(name);
}

export function textOf(el) {
  if (!el) {
    return '';
  }
  if (typeof el.textContent === 'string') {
    return el.textContent;
  }
  const kids = el.children;
  if (!kids || typeof kids.length !== 'number') {
    return '';
  }
  const parts = [];
  for (let i = 0; i < kids.length; i++) {
    parts.push(textOf(kids[i]));
  }
  return parts.join('\n');
}

export function collapse(s) {
  return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// A click can land on the symbol link, on a button inside the cost basis
// cell, or on a text node, so normalize to an element and climb. The
// app-position-row attribute is the Angular directive marker and is steadier
// than the class, so it wins; the class is the fallback.
export function findPositionRow(start) {
  let el = start && start.nodeType === 1 ? start : (start && start.parentElement) || null;
  for (let i = 0; el && i <= MAX_WALK; i++) {
    if (typeof attrOf(el, 'app-position-row') === 'string') {
      return el;
    }
    const cls = el.className;
    if (typeof cls === 'string' && (cls.indexOf('position-row') >= 0 || cls.indexOf(PARENT_ROW_CLASS) >= 0)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// The row's element children in document order, so the leading th.symbolColumn
// is index 0 and the tds follow. Every column index in this project counts
// from that th, which is what lets a header row align with a body row.
export function rowCells(row) {
  const kids = row ? row.children : null;
  if (!kids || typeof kids.length !== 'number') {
    return [];
  }
  const out = [];
  for (let i = 0; i < kids.length; i++) {
    out.push(kids[i]);
  }
  return out;
}

// Every element under root, breadth-first. Walking children rather than
// calling querySelector is what lets a plain object stand in for a row.
function descendantsOf(root) {
  const queue = rowCells(root);
  for (let i = 0; i < queue.length; i++) {
    const kids = rowCells(queue[i]);
    for (let j = 0; j < kids.length; j++) {
      queue.push(kids[j]);
    }
  }
  return queue;
}

// Those of them whose class names include want, in the same order.
function withClass(root, want) {
  const nodes = descendantsOf(root);
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const cls = nodes[i].className;
    if (typeof cls === 'string' && cls.indexOf(want) >= 0) {
      out.push(nodes[i]);
    }
  }
  return out;
}

// The first link under root as collapsed text, which is how both dialects
// spell an instrument: the symbol is always a link to its quote page.
function linkTextOf(root) {
  const nodes = descendantsOf(root);
  for (let i = 0; i < nodes.length; i++) {
    if (String(nodes[i].tagName).toLowerCase() === 'a') {
      return collapse(textOf(nodes[i]));
    }
  }
  return '';
}

// The symbol cell's link text, which is the card's instrument line verbatim:
// ZORK for shares, ACME 01/15/2027 50.00 C for an option leg.
export function readInstrument(row) {
  const cells = withClass(row, 'symbolColumn');
  return cells.length === 0 ? '' : linkTextOf(cells[0]);
}

// Every other numeric cell in a Schwab row carries a $ or a %, so a bare
// number is the quantity cell.
const QUANTITY_CELL = /^-?[0-9,]+(\.[0-9]+)?$/;

export function readQuantity(row) {
  const cells = rowCells(row);
  for (let i = 0; i < cells.length; i++) {
    const text = collapse(textOf(cells[i]));
    if (QUANTITY_CELL.test(text)) {
      return Number(text.replace(/,/g, ''));
    }
  }
  return null;
}

// Schwab draws the same table a second way. The responsive layout hangs the
// row off tr.positions-parent-row, carries none of the data- attributes the
// markup above is read through, and names each figure for a screen reader
// instead: the cell opens with a span.sr-only saying which column it is. The
// dialect is kept beside the attribute one rather than folded into it, because
// the two share no hook at all.
const PARENT_ROW_CLASS = 'positions-parent-row';
const OPTION_LABEL_CLASS = 'position-options';

export function isParentRow(row) {
  const cls = row ? row.className : null;
  return typeof cls === 'string' && cls.indexOf(PARENT_ROW_CLASS) >= 0;
}

// The instrument line, from the one-line option label. The row carries the
// same symbol twice, and the narrow-screen copy breaks it across three lines,
// where the parts run together into one word; the one-line label is therefore
// what wins whenever both are present. A row with no option label is an equity
// holding, whose symbol cell still holds the ticker as a link.
export function readParentInstrument(row) {
  const labels = withClass(row, OPTION_LABEL_CLASS);
  for (let i = 0; i < labels.length; i++) {
    const text = collapse(textOf(labels[i]));
    if (labels[i].className.indexOf('-three-lines') < 0 && text !== '') {
      return text;
    }
  }
  return linkTextOf(row);
}

// The cell a screen reader would announce under this name, with the name cut
// off the front of its text. Addressing a column by the label it carries is
// what keeps an inserted column from moving the quantity, and it is the only
// handle this dialect offers: its cells are otherwise told apart by layout
// classes that say where a cell sits, never what it holds.
export function readLabeledText(row, label) {
  const cells = rowCells(row);
  for (let i = 0; i < cells.length; i++) {
    const marks = withClass(cells[i], 'sr-only');
    for (let j = 0; j < marks.length; j++) {
      if (collapse(textOf(marks[j])) !== label) {
        continue;
      }
      const text = collapse(textOf(cells[i]));
      return text.indexOf(label) === 0 ? collapse(text.slice(label.length)) : text;
    }
  }
  return null;
}

// The labeled quantity column, or the stacked cell that replaces it on a
// narrow screen, where the quantity sits under the price with no label at all.
export function readParentQuantity(row) {
  const labeled = readLabeledText(row, 'Quantity');
  if (labeled !== null && QUANTITY_CELL.test(labeled)) {
    return Number(labeled.replace(/,/g, ''));
  }
  const stacked = withClass(row, 'priceQuantityStacked');
  for (let i = 0; i < stacked.length; i++) {
    const bottom = withClass(stacked[i], 'stacked-bottom');
    for (let j = 0; j < bottom.length; j++) {
      const text = collapse(textOf(bottom[j]));
      if (QUANTITY_CELL.test(text)) {
        return Number(text.replace(/,/g, ''));
      }
    }
  }
  return null;
}

// A symbol line shaped like an option: ticker, expiry, strike and the call or
// put letter. Its spaces are written as escapes because the build drops a
// space that sits next to punctuation, and a literal one would not survive
// into the bookmarklet.
const OPTION_INSTRUMENT = /^[A-Z.]+\s[0-9]{2}\/[0-9]{2}\/[0-9]{4}\s[0-9,]+(\.[0-9]+)?\s[CP]$/;

// The same identity the attribute dialect yields, read from class names and
// labels. Option-ness has no attribute to come from, so the option label
// decides it and the shape of the symbol line is the second opinion. The OSI
// symbol and the strategy name are absent from this markup and the card
// renders neither, so both stay null rather than being dug out of the link.
export function readParentIdentity(row) {
  const instrument = readParentInstrument(row);
  const quantity = readParentQuantity(row);
  let side = null;
  if (quantity !== null) {
    side = quantity < 0 ? 'short' : 'long';
  }
  return {
    instrument: instrument,
    isOption: withClass(row, OPTION_LABEL_CLASS).length > 0 || OPTION_INSTRUMENT.test(instrument),
    osi: null,
    parentName: null,
    quantity: quantity,
    side: side,
  };
}

// The labeled gain/loss cell holds the whole total pair: dollars, then the
// same move as a percent in brackets, for instance -$150.00 (-60.00%).
const PARENT_TOTAL = /([+-]?\$[+-]?[0-9,]+(\.[0-9]+)?)\s*\(([+-]?[0-9,]+(\.[0-9]+)?%)\)/;

// Who the row is. The side comes from the quantity rather than the cost basis
// because a written call shows a negative basis too, which leaves quantity as
// the single unambiguous signal. osi and parentName are read but, per the
// PRD, never rendered on the v1 card.
export function readRowIdentity(row) {
  if (isParentRow(row)) {
    return readParentIdentity(row);
  }
  const isOption = attrOf(row, 'data-isoption') === 'true';
  const quantity = readQuantity(row);
  let side = null;
  if (quantity !== null) {
    side = quantity < 0 ? 'short' : 'long';
  }
  return {
    instrument: readInstrument(row),
    isOption: isOption,
    osi: isOption ? collapse(attrOf(row, 'data-symbol')) : null,
    parentName: attrOf(row, 'data-parent-name') || null,
    quantity: quantity,
    side: side,
  };
}

// A percent cell reads +8.91%, -7.14% or a bare 8.91%. Anything else is not a
// percent and must come back as null rather than NaN, so a caller can branch.
const PERCENT_TEXT = /^[+-]?[0-9,]+(\.[0-9]+)?%$/;

export function parseSignedPercent(text) {
  const s = collapse(text);
  if (!PERCENT_TEXT.test(s)) {
    return null;
  }
  const n = Number(s.replace(/[+%,]/g, '').replace(/-/g, ''));
  if (n !== n) {
    return null;
  }
  return s.indexOf('-') >= 0 && n !== 0 ? -n : n;
}

// Schwab writes the sign before the dollar sign in the tooltip cells and after
// it in a few older ones, so both are accepted. Exactly zero stays positive
// zero, which keeps a flat position comparable.
const DOLLARS_TEXT = /^[+-]?\$[+-]?[0-9,]+(\.[0-9]+)?$/;

export function parseSignedDollars(text) {
  const s = collapse(text);
  if (!DOLLARS_TEXT.test(s)) {
    return null;
  }
  const n = Number(s.replace(/[$,+]/g, '').replace(/-/g, ''));
  if (n !== n) {
    return null;
  }
  return s.indexOf('-') >= 0 && n !== 0 ? -n : n;
}

// The card's four string formatters. They are pure and locale-independent by
// construction, reaching for no built-in that consults the user's locale and
// for no clock, so a card rendered in a browser and a string asserted in
// node:test are byte-identical.
function pad2(n) {
  const s = String(n);
  return s.length < 2 ? '0' + s : s;
}

// Commas every three digits from the right, done by hand because grouping is
// the one piece of number formatting a locale would otherwise take away.
function groupThousands(intText) {
  const s = String(intText);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) {
      out = out + ',';
    }
    out = out + s.charAt(i);
  }
  return out;
}

// Two decimals and always a sign, so a flat position reads +0.00% rather than
// as a bare number; colour, not the sign, is what marks it flat. A value that
// is not a finite number comes back as null so the caller branches instead of
// drawing NaN%.
export function formatPercent(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return null;
  }
  const sign = value < 0 ? '-' : '+';
  return sign + Math.abs(value).toFixed(2) + '%';
}

// Sign, then the dollar sign, then the grouped magnitude, which is how Schwab
// writes it in the rows the snapshot came from. Rounding to two decimals
// happens before grouping, so a value that rounds up carries into the commas.
export function formatDollars(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return null;
  }
  const sign = value < 0 ? '-' : '+';
  const body = Math.abs(value).toFixed(2);
  const dot = body.indexOf('.');
  return sign + '$' + groupThousands(body.slice(0, dot)) + body.slice(dot);
}

// The quantity the way the row writes it: a minus only when the position is
// short, and the thousands grouped the way the dollars beside it are. It is
// the one figure on this card that names the size of a holding, which is why
// the sheet leaves it off unless the user asks for it.
export function formatQuantity(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return null;
  }
  const parts = String(value).split('.');
  return groupThousands(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

// Local time on a 24-hour clock, zero-padded. The Date arrives as an argument
// rather than being read from the clock inside, which is what lets a test pin
// the footer line. 24-hour avoids an AM/PM token needing its own footer width.
export function formatShareTime(date) {
  if (!date || !isFn(date.getFullYear)) {
    return null;
  }
  const stamp = date.getTime();
  if (typeof stamp !== 'number' || stamp !== stamp) {
    return null;
  }
  const day = pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + '/' + date.getFullYear();
  const clock = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  return 'Share Time: ' + day + ' ' + clock;
}

// The renderer maps these three names to colours. Classifying here rather than
// in the painter is what lets a card test assert on tone without a canvas.
export function toneOf(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return null;
  }
  if (value > 0) {
    return 'gain';
  }
  if (value < 0) {
    return 'loss';
  }
  return 'flat';
}

// The card's palette, margin and font stack in one named place, so the
// geometry is a decision recorded once rather than literals scattered through
// a painter. The backdrop is the CSS the card's look was specified in, kept
// here in full because a canvas has no stylesheet to read it from and the
// painter below is only an honest reading of it:
//
//   background-color: #172136;
//   opacity: 0.8;
//   background-image: repeating-radial-gradient(circle at 0 0, transparent 0,
//     #172136 9px), repeating-linear-gradient(#8cc7ff55, #8cc7ff);
//   mask-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7) 0%,
//     rgba(0, 0, 0, 0) 75%);
//   mask-size: 100% 100%;
//   mask-repeat: no-repeat;
//
// It stays within what the PRD allows: a flat base under a light-blue wash and
// a ring texture, no figurative art, and nothing a browser canvas or a
// recording test double cannot accept. The wash colours carry that opacity of
// 0.8, times the 0.7 the mask starts from, in their alpha bytes.
export const CARD_THEME = {
  base: '#172136',
  washFrom: '#8CC7FF30',
  washTo: '#8CC7FF8F',
  margin: 96,
  fontStack: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  headline: '#FFFFFF',
  label: '#9FB3D9',
  gain: '#4ADE80',
  loss: '#F87171',
  flat: '#E2E8F0',
  secondary: '#CBD5E1',
  footer: '#8FA3C8',
};

// The small labels that name what each number is. The card carries no mark of
// its own: the footer is the share time, and the corner opposite it is empty.
const CARD_LABEL_TEXT = 'Performance';
const CARD_DAY_LABEL_TEXT = 'Day change';
const CARD_QUANTITY_LABEL_TEXT = 'Quantity';

// The two words an option card can put under its instrument. They name the
// trade that opened the position, not a strategy: a written call and a
// cash-secured put both read sell-to-open, because naming either one of them
// would take a second signal this program never reads.
const CARD_BUY_TO_OPEN_TEXT = 'buy-to-open';
const CARD_SELL_TO_OPEN_TEXT = 'sell-to-open';

// Where each line sits and how big it starts, in card pixels. The primary
// number starts smaller in dollars than in percent because a dollar string is
// the longer of the two and would otherwise need shrinking on every card.
const CARD_INSTRUMENT_Y = 300;
const CARD_INSTRUMENT_PX = 96;
const CARD_SIDE_Y = 414;
const CARD_SIDE_PX = 48;
const CARD_LABEL_Y = 436;
const CARD_LABEL_PX = 44;
// Where the label drops to when an opening side stands between it and the
// instrument, which is the one case the two lines would otherwise overlap in.
const CARD_SIDE_LABEL_Y = 498;
const CARD_PRIMARY_Y = 900;
const CARD_PCT_PX = 190;
const CARD_USD_PX = 150;
const CARD_SECONDARY_Y = 1000;
const CARD_SECONDARY_PX = 72;
// The stack under the headline number, where every line the toggles add goes,
// one step apart. A card with no metric on it at all starts the stack at the
// headline's own baseline instead, so a quantity-only card reads as a card
// rather than as an empty one with a caption low on the page.
const CARD_EXTRA_Y = 1120;
const CARD_EXTRA_STEP = 88;
const CARD_EXTRA_PX = 56;
const CARD_FOOTER_Y = 1824;
const CARD_FOOTER_PX = 40;

// How fitFont steps down, and the size it refuses to go below: past the floor
// the line stops being readable on a phone, so overflowing the margin is the
// better of the two failures.
const FIT_STEP_PX = 8;
const FIT_MIN_PX = 64;
// A supporting line is read next to a headline that already sets the size, so
// it is allowed past that floor rather than being left to run off the margin.
const FIT_EXTRA_MIN_PX = 32;
const FONT_PX = /([0-9]+)px/;

function fontSizeOf(font) {
  const found = FONT_PX.exec(String(font));
  return found ? Number(found[1]) : null;
}

function withFontSize(font, size) {
  return String(font).replace(FONT_PX, size + 'px');
}

function cardFont(weight, size, theme) {
  return weight + ' ' + size + 'px ' + theme.fontStack;
}

// What a line would measure with no canvas to ask: 0.58 of the font size per
// character, which is close enough to keep a headless caller from throwing.
// The wiring hands in a real measurer and this estimate goes unused there.
function estimateWidth(text, font) {
  const size = fontSizeOf(font);
  return String(text).length * (size === null ? 0 : size) * 0.58;
}

// The largest size at or below the font's own at which text fits maxWidth,
// stepping down by FIT_STEP_PX and stopping at minPx, which defaults to the
// readable floor a headline keeps. The measurer is the caller's, which is what
// keeps the card builder pure: the wiring passes one backed by ctx.measureText
// and a test passes a stub.
export function fitFont(measure, text, font, maxWidth, minPx) {
  const width = isFn(measure) ? measure : estimateWidth;
  const floor = typeof minPx === 'number' ? minPx : FIT_MIN_PX;
  let size = fontSizeOf(font);
  if (size === null) {
    return font;
  }
  let out = font;
  while (size > floor && width(text, out) > maxWidth) {
    size = size - FIT_STEP_PX;
    if (size < floor) {
      size = floor;
    }
    out = withFontSize(out, size);
  }
  return out;
}

function textOp(text, x, y, font, fill, align, baseline) {
  return { op: 'text', text: text, x: x, y: y, font: font, fill: fill, align: align, baseline: baseline };
}

// Which of the three metric lines a card carries. The toggles arrive as one
// object so a caller can name only what it changes, and what it does not name
// falls back to the card this program drew before they existed: the overall
// change, alone.
export function cardOptions(options) {
  const o = options || {};
  return {
    showQuantity: o.showQuantity === true,
    showDayChange: o.showDayChange === true,
    showOverallChange: o.showOverallChange !== false,
  };
}

// Whether that set is worth copying. Every line switched off would leave an
// instrument over a timestamp, which is not a share card, so the sheet says so
// rather than the builder inventing a line to fill it.
export function canBuildCard(options) {
  const show = cardOptions(options);
  return show.showQuantity || show.showDayChange || show.showOverallChange;
}

// One gain/loss pair as the strings a card can draw, in the tone its dollars
// carry, or null when the mode asks for a figure the formatters refuse. A row
// whose day change the parser could not find arrives here as a pair of nulls
// and answers null, which is how that line drops out rather than drawing a
// word the card has no room to explain.
function cardMetric(label, pct, usd, mode) {
  const percentText = formatPercent(pct);
  const dollarText = formatDollars(usd);
  const primary = mode === 'usd' ? dollarText : percentText;
  if (primary === null || (mode === 'both' && dollarText === null)) {
    return null;
  }
  const tone = toneOf(usd);
  return {
    label: label,
    text: primary,
    extra: mode === 'both' ? dollarText : null,
    fill: tone === 'gain' ? CARD_THEME.gain : tone === 'loss' ? CARD_THEME.loss : CARD_THEME.flat,
  };
}

// How the position was opened, in the words the card carries, or null when it
// has nothing to say. Only an option has an opening side worth naming, and
// only the sign of the quantity names it: a written call and a bought one
// differ nowhere else on the row, since a short position shows a negative cost
// basis as readily as a long one shows a positive. A quantity the parser could
// not read, or a flat zero, leaves the line off rather than picking a side on
// the reader's behalf. Which strategy the trade belongs to is not decided
// here: sell-to-open covers the covered call and the cash-secured put alike.
export function openingSideLabel(snapshot) {
  const quantity = snapshot && snapshot.isOption === true ? snapshot.quantity : null;
  if (typeof quantity !== 'number' || !isFinite(quantity) || quantity === 0) {
    return null;
  }
  return quantity < 0 ? CARD_SELL_TO_OPEN_TEXT : CARD_BUY_TO_OPEN_TEXT;
}

// The whole card as an ordered display list of two op kinds: one backdrop and
// a handful of text runs. Describing it this thinly is what makes the painter
// a short loop and lets the PRD's per-mode rules be asserted on data instead
// of on pixels. Nothing here reads a clock, a global or a canvas. What it
// reads of the snapshot is what the toggles allow: the instrument and the
// enabled metrics, the quantity only when the user turned that line on, and
// the cost basis and the market value never. An option's opening side is the
// one line no toggle governs, because it says how the position was entered
// rather than how it is doing, and it carries no figure of its own.
export function buildCard(snapshot, mode, now, measure, options) {
  if (!snapshot) {
    return null;
  }
  if (mode !== 'pct' && mode !== 'usd' && mode !== 'both') {
    return null;
  }
  const theme = CARD_THEME;
  const show = cardOptions(options);
  let head = show.showOverallChange ? cardMetric(CARD_LABEL_TEXT, snapshot.totalPct, snapshot.totalDollars, mode) : null;
  let day = show.showDayChange ? cardMetric(CARD_DAY_LABEL_TEXT, snapshot.dayPct, snapshot.dayDollars, mode) : null;
  // With the overall change switched off the day change is promoted into the
  // headline, rather than left as a caption under a card with no number on it.
  if (head === null) {
    head = day;
    day = null;
  }
  const quantityText = show.showQuantity ? formatQuantity(snapshot.quantity) : null;
  // Nothing readable to show is not a card. Returning null here is what keeps
  // a blank image off the clipboard rather than painting one.
  if (head === null && quantityText === null) {
    return null;
  }
  const left = theme.margin;
  const maxWidth = CARD_W - 2 * theme.margin;
  const instrument = snapshot.instrument ? String(snapshot.instrument) : '';
  const stamp = formatShareTime(now);
  const ops = [];
  ops.push({ op: 'backdrop', x: 0, y: 0, w: CARD_W, h: CARD_H, base: theme.base, from: theme.washFrom, to: theme.washTo });
  ops.push(textOp(instrument, left, CARD_INSTRUMENT_Y, fitFont(measure, instrument, cardFont('700', CARD_INSTRUMENT_PX, theme), maxWidth), theme.headline, 'left', 'top'));
  // The opening side belongs to the instrument rather than to any one metric,
  // so it sits directly under it and every mode carries it alike.
  const openingSide = openingSideLabel(snapshot);
  if (openingSide !== null) {
    ops.push(textOp(openingSide, left, CARD_SIDE_Y, cardFont('500', CARD_SIDE_PX, theme), theme.secondary, 'left', 'top'));
  }
  let y = CARD_PRIMARY_Y;
  if (head !== null) {
    const primaryFont = fitFont(measure, head.text, cardFont('700', mode === 'usd' ? CARD_USD_PX : CARD_PCT_PX, theme), maxWidth);
    ops.push(textOp(head.label, left, openingSide === null ? CARD_LABEL_Y : CARD_SIDE_LABEL_Y, cardFont('400', CARD_LABEL_PX, theme), theme.label, 'left', 'top'));
    ops.push(textOp(head.text, left, CARD_PRIMARY_Y, primaryFont, head.fill, 'left', 'alphabetic'));
    if (head.extra !== null) {
      ops.push(textOp(head.extra, left, CARD_SECONDARY_Y, cardFont('500', CARD_SECONDARY_PX, theme), theme.secondary, 'left', 'alphabetic'));
    }
    y = CARD_EXTRA_Y;
  }
  // Whatever the headline did not take, each named on a line of its own so a
  // reader can tell a day change from a total without counting the numbers.
  if (day !== null) {
    const line = day.label + ' ' + (day.extra === null ? day.text : day.text + ' (' + day.extra + ')');
    ops.push(textOp(line, left, y, fitFont(measure, line, cardFont('500', CARD_EXTRA_PX, theme), maxWidth, FIT_EXTRA_MIN_PX), day.fill, 'left', 'alphabetic'));
    y = y + CARD_EXTRA_STEP;
  }
  if (quantityText !== null) {
    const line = CARD_QUANTITY_LABEL_TEXT + ' ' + quantityText;
    ops.push(textOp(line, left, y, fitFont(measure, line, cardFont('500', CARD_EXTRA_PX, theme), maxWidth, FIT_EXTRA_MIN_PX), theme.secondary, 'left', 'alphabetic'));
  }
  ops.push(textOp(stamp === null ? '' : stamp, left, CARD_FOOTER_Y, cardFont('400', CARD_FOOTER_PX, theme), theme.footer, 'left', 'alphabetic'));
  return { width: CARD_W, height: CARD_H, ops: ops };
}

// The one string a failed encode reports, kept beside the encoder so the
// clipboard issue and its tests quote the same words.
const CARD_BLOB_ERROR = 'canvas produced no image';

// Replays a display list against a 2D context and answers how many ops it
// painted. Deliberately dumb: there is no layout arithmetic here at all, which
// is what keeps every geometry decision inside buildCard where a test can read
// it off the data. An op kind this painter does not know is skipped rather
// than thrown on, so a card built by a newer module still renders the parts an
// older painter understands.
export function paintCard(ctx, card) {
  if (!ctx || !card || !card.ops) {
    return 0;
  }
  const guarded = isFn(ctx.save) && isFn(ctx.restore);
  if (guarded) {
    ctx.save();
  }
  let painted = 0;
  for (const op of card.ops) {
    if (op.op === 'backdrop') {
      // The op's own box and base colour, read once: this branch names them
      // thirty times over and the built bookmarklet pays for every character.
      const { base, x, y, w, h } = op;
      // The base goes down opaque across the whole box. The CSS fades its
      // patterned layer out towards the edges, and a card that faded out to
      // nothing would carry transparent corners into the PNG, so this fill is
      // both the colour under the pattern and what the fade lands on.
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, h);
      // The wash, top to bottom of the op's own box rather than of the card,
      // so a future banded backdrop behaves the same way. Its two colours and
      // the rings below carry the CSS layer opacity of 0.8, times the 0.7 its
      // mask starts from, already multiplied into their alpha bytes, which is
      // what spares the painter a globalAlpha of its own on every fill.
      let fill = ctx.createLinearGradient(x, y, x, y + h);
      fill.addColorStop(0, op.from);
      fill.addColorStop(1, op.to);
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      // The rings the CSS stacks over that wash: the base colour again, drawn
      // as one radial gradient carrying a clear-to-ring pair of stops for each
      // nine pixels out from the corner. A period's closing stop sits at the
      // offset the next period's opening one takes, which is what keeps every
      // ring edge hard. The gradient reaches the two sides added rather than
      // the diagonal, so it clears the far corner without a square root, and
      // the pitch stays nine pixels either way.
      fill = ctx.createRadialGradient(x, y, 0, x, y, w + h);
      for (let r = 9; r <= w + h; r = r + 9) {
        fill.addColorStop((r - 9) / (w + h), base + '00');
        fill.addColorStop(r / (w + h), base + '8F');
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      // The mask, painted rather than masked: the base colour once more, clear
      // at the centre and solid three quarters of the way out, which hides the
      // pattern towards the edges by the same linear ramp the CSS ellipse
      // applies. Those three quarters are of the farthest-corner ellipse,
      // whose x radius is half the width times the square root of two, so 0.53
      // of the width. The transform is what turns the circular gradient a
      // canvas offers into that ellipse; it is set and cleared rather than
      // saved, because the only caller paints onto a canvas still at the
      // identity, and the text runs after it must not inherit a scale.
      ctx.setTransform(1, 0, 0, h / w, x + w / 2, y + h / 2);
      fill = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.53);
      fill.addColorStop(0, base + '00');
      fill.addColorStop(1, base);
      ctx.fillStyle = fill;
      ctx.fillRect(-w / 2, -w / 2, w, w);
      ctx.resetTransform();
      painted = painted + 1;
    } else if (op.op === 'text') {
      // Every one of the four is set for every run. A canvas draws with the
      // font current at fillText time, so inheriting one from the previous op
      // would paint the right string at the wrong size.
      ctx.font = op.font;
      ctx.fillStyle = op.fill;
      ctx.textAlign = op.align;
      ctx.textBaseline = op.baseline;
      ctx.fillText(op.text, op.x, op.y);
      painted = painted + 1;
    }
  }
  if (guarded) {
    ctx.restore();
  }
  return painted;
}

// A canvas of exactly CARD_W by CARD_H device pixels carrying the painted
// card, or null when there is nothing to paint. Width and height are set as
// properties rather than as CSS because the backing store is what the PNG
// carries; no devicePixelRatio scaling applies to an image meant to be posted
// rather than laid out on a screen. A detached document hands back no 2D
// context, and a snapshot the builder refuses is no card, so both answer null
// and let the caller report a clean failure instead of copying a blank image.
export function renderCard(doc, snapshot, mode, now, options) {
  if (!doc || !isFn(doc.createElement)) {
    return null;
  }
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = isFn(canvas.getContext) ? canvas.getContext('2d') : null;
  if (!ctx) {
    return null;
  }
  // The real measurer the fitting wants: a size is only meaningful for the
  // font it was measured under, so the font is assigned before the question.
  const measure = function (text, font) {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const card = buildCard(snapshot, mode, now, measure, options);
  if (!card) {
    return null;
  }
  paintCard(ctx, card);
  return canvas;
}

// The card as an image/png Blob, which is the shape the async clipboard takes.
// toBlob rather than toDataURL: a data URL round trip would cost twice the
// memory for a 1080 by 1920 image and then have to be parsed back. No quality
// argument, because PNG ignores one. A null blob is a real outcome under
// memory pressure, so it rejects with a reason worth showing rather than
// resolving with nothing.
export function canvasToPngBlob(canvas) {
  return new Promise(function (resolve, reject) {
    if (!canvas || !isFn(canvas.toBlob)) {
      reject(new Error(CARD_BLOB_ERROR));
      return;
    }
    canvas.toBlob(function (blob) {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(CARD_BLOB_ERROR));
      }
    }, 'image/png');
  });
}

// The exact words each clipboard refusal shows. Four codes and no free text
// anywhere else: a message that names which of the four things went wrong is
// the difference between a user fixing the page URL and giving up on the
// bookmarklet.
export const CLIPBOARD_MESSAGES = {
  'insecure-context': 'Clipboard needs a secure page (https)',
  unsupported: 'This browser cannot copy images',
  'permission-denied': 'Clipboard permission denied',
  'write-failed': 'Could not copy the card',
};

// The refusal a page carries before the clipboard is even asked, or null when
// the write may proceed. The secure context is tested first on purpose: an
// http page hides the clipboard API altogether, and reporting that absence as
// unsupported would send the user hunting a browser problem that is really a
// page-URL problem. Reading navigator and ClipboardItem off the window
// argument rather than off globals is what lets a test supply both.
export function clipboardBlocker(win) {
  if (!win) {
    return 'unsupported';
  }
  if (win.isSecureContext === false) {
    return 'insecure-context';
  }
  const nav = win.navigator;
  if (!nav || !nav.clipboard || !isFn(nav.clipboard.write)) {
    return 'unsupported';
  }
  if (!isFn(win.ClipboardItem)) {
    return 'unsupported';
  }
  return null;
}

// The outcome object a code turns into, so all four failures are shaped alike
// and the words can only ever come from the table above.
function clipboardFailure(code) {
  return { ok: false, code: code, message: CLIPBOARD_MESSAGES[code] };
}

// Which of the two failures a thrown write was. A browser that refused the
// permission says so by name; one that says it only in prose is read for the
// words, because a user gesture that expired while the card rendered arrives
// the same way and is worth telling apart from a clipboard that simply broke.
function clipboardErrorCode(err) {
  const name = err && err.name ? String(err.name) : '';
  if (name === 'NotAllowedError') {
    return 'permission-denied';
  }
  const text = err && err.message ? String(err.message).toLowerCase() : '';
  if (text.indexOf('denied') >= 0 || text.indexOf('permission') >= 0) {
    return 'permission-denied';
  }
  return 'write-failed';
}

// The card on the system clipboard, or the reason it is not there. Resolves
// { ok: true } or { ok: false, code, message } and never throws, so a caller
// can branch on ok and hand the message straight to a toast. image/png is the
// literal MIME key because it is the only image type Chrome and Edge accept,
// and the Blob goes in directly rather than as a promise for one. The write
// runs inside the chooser click handler's task, which is what keeps the user
// gesture the clipboard requires alive. Nothing here ever reads.
export async function writePngToClipboard(win, blob) {
  const blocked = clipboardBlocker(win);
  if (blocked) {
    return clipboardFailure(blocked);
  }
  if (!blob) {
    return clipboardFailure('write-failed');
  }
  try {
    const item = new win.ClipboardItem({ 'image/png': blob });
    await win.navigator.clipboard.write([item]);
    return { ok: true };
  } catch (err) {
    return clipboardFailure(clipboardErrorCode(err));
  }
}

// The header row of the table the row sits in: the first descendant tr whose
// children are all th, as collapsed texts. An empty array means there is no
// header to align to, which is the case for a bare captured tr.
export function readHeaderTexts(row) {
  let table = row;
  for (let i = 0; table && i <= MAX_WALK; i++) {
    if (String(table.tagName).toLowerCase() === 'table') {
      break;
    }
    table = table.parentElement;
  }
  if (!table || String(table.tagName).toLowerCase() !== 'table') {
    return [];
  }
  const queue = rowCells(table);
  for (let i = 0; i < queue.length; i++) {
    if (String(queue[i].tagName).toLowerCase() !== 'tr') {
      const kids = rowCells(queue[i]);
      for (let j = 0; j < kids.length; j++) {
        queue.push(kids[j]);
      }
      continue;
    }
    const cells = rowCells(queue[i]);
    let allHeader = cells.length > 0;
    for (let j = 0; j < cells.length; j++) {
      if (String(cells[j].tagName).toLowerCase() !== 'th') {
        allHeader = false;
      }
    }
    if (allHeader) {
      const texts = [];
      for (let j = 0; j < cells.length; j++) {
        texts.push(collapse(textOf(cells[j])));
      }
      return texts;
    }
  }
  return [];
}

const DOLLAR_START = /^[+-]?\$/;

// The row's tooltip cells in document order. The first of them is the total
// percent, and the cells after it repeat the day and the total figures both
// ways round, which is the ambiguity the two rules below resolve.
function tooltipCells(row) {
  const cells = rowCells(row);
  const tips = [];
  for (let i = 0; i < cells.length; i++) {
    const cls = cells[i].className;
    if (typeof cls === 'string' && cls.indexOf('tooltip-column') >= 0) {
      tips.push(cells[i]);
    }
  }
  return tips;
}

// The one seam for Schwab column churn on the total pair, never the day one.
// Header names win when the table has a header row, because a name survives a
// column reorder; the tooltip rule below is what works on today's markup. Both
// count from the leading th, which is what lets a header row address a body row.
export function findTotalCells(row) {
  // The responsive dialect has neither a header row nor a tooltip cell, and
  // the column beside its total holds a day change that reads as a far larger
  // percent, so the labeled cell is the only safe answer there.
  if (isParentRow(row)) {
    const labeled = readLabeledText(row, 'Gain Loss');
    const found = labeled === null ? null : PARENT_TOTAL.exec(labeled);
    return found ? { pct: found[3], usd: found[1] } : null;
  }
  const cells = rowCells(row);
  const headers = readHeaderTexts(row);
  let pctAt = -1;
  let usdAt = -1;
  for (let i = 0; i < headers.length; i++) {
    const head = headers[i].toLowerCase();
    if (head.indexOf('day') === 0 || head.indexOf('gain/loss') < 0) {
      continue;
    }
    const last = head.charAt(head.length - 1);
    if (pctAt < 0 && last === '%') {
      pctAt = i;
    }
    if (usdAt < 0 && last === '$') {
      usdAt = i;
    }
  }
  if (pctAt >= 0 && usdAt >= 0 && pctAt < cells.length && usdAt < cells.length) {
    return { pct: collapse(textOf(cells[pctAt])), usd: collapse(textOf(cells[usdAt])) };
  }
  const tips = tooltipCells(row);
  if (tips.length === 0) {
    return null;
  }
  // The first tooltip cell is the total percent and its title is the total
  // dollars. A later cell that repeats the pair the other way round confirms
  // it; requiring its title to equal the percent is what rejects the trailing
  // cell that repeats the day figures.
  const pct = collapse(textOf(tips[0]));
  let usd = '';
  for (let i = 1; i < tips.length; i++) {
    const text = collapse(textOf(tips[i]));
    if (DOLLAR_START.test(text) && collapse(attrOf(tips[i], 'title')) === pct) {
      usd = text;
      break;
    }
  }
  if (usd === '') {
    usd = collapse(attrOf(tips[0], 'title'));
  }
  return { pct: pct, usd: usd };
}

// The day pair, in its own seam so that a change to one pair can never quietly
// move the other. The responsive dialect keeps the day change in a stacked
// cell of its own, under a market value the pattern passes over. Everywhere
// else it is read off the tooltip cells, where the day dollars are the first
// that are not the total's: the cell whose title repeats the total percent is
// the total, and a dollar cell titled with any other percent is the day. A row
// that offers neither has no day change to show, and the card drops that line
// rather than guessing at a neighbouring column.
export function findDayCells(row) {
  if (isParentRow(row)) {
    const stacked = withClass(row, 'dayChangeStacked');
    const found = stacked.length === 0 ? null : PARENT_TOTAL.exec(collapse(textOf(stacked[0])));
    return found ? { pct: found[3], usd: found[1] } : null;
  }
  const tips = tooltipCells(row);
  if (tips.length === 0) {
    return null;
  }
  const total = collapse(textOf(tips[0]));
  for (let i = 1; i < tips.length; i++) {
    const text = collapse(textOf(tips[i]));
    const title = collapse(attrOf(tips[i], 'title'));
    if (DOLLAR_START.test(text) && PERCENT_TEXT.test(title) && title !== total) {
      return { pct: title, usd: text };
    }
  }
  return null;
}

// The two numbers one pair carries, with the percent made to agree with the
// dollars. Both come from the same cell pair and the dollars are what a
// dollars-only card shows, so a disagreement in sign is the percent to lose.
function parsePair(pair) {
  const usd = pair ? parseSignedDollars(pair.usd) : null;
  let pct = pair ? parseSignedPercent(pair.pct) : null;
  if (usd !== null && pct !== null && ((usd < 0 && pct > 0) || (usd > 0 && pct < 0))) {
    pct = -pct;
  }
  return { pct: pct, usd: usd };
}

// The whole snapshot the card renders from. It carries no cost basis, market
// value or price by construction, which makes the PRD rule that account
// figures stay off a shareable card structural rather than a rendering habit.
// A row can have a day change the parser cannot find while its total is plain,
// so the day numbers come back as nulls rather than as a reason to refuse the
// row, and it is the card that decides what a missing pair means.
export function parsePositionRow(row) {
  if (!row || findPositionRow(row) !== row) {
    return null;
  }
  const total = parsePair(findTotalCells(row));
  if (total.pct === null || total.usd === null) {
    return null;
  }
  const day = parsePair(findDayCells(row));
  const identity = readRowIdentity(row);
  return {
    instrument: identity.instrument,
    totalPct: total.pct,
    totalDollars: total.usd,
    dayPct: day.pct,
    dayDollars: day.usd,
    isOption: identity.isOption,
    osi: identity.osi,
    parentName: identity.parentName,
    quantity: identity.quantity,
    side: identity.side,
  };
}

// The element's viewport rect, or null when the node cannot give one. A row
// that is hidden or detached measures nothing, and that null is what keeps a
// stray frame off the page.
export function rectOf(el) {
  if (!el || !isFn(el.getBoundingClientRect)) {
    return null;
  }
  const r = el.getBoundingClientRect();
  if (!r || typeof r.left !== 'number' || typeof r.top !== 'number' || typeof r.width !== 'number' || typeof r.height !== 'number') {
    return null;
  }
  return r;
}

// Where the hover frame goes for a row's rect: HIGHLIGHT_WIDTH px outside the
// row on every side, so the frame sits just clear of the row and the row's own
// style is never written to, which is the PRD rule.
export function highlightRect(rect) {
  const w = HIGHLIGHT_WIDTH;
  return { left: rect.left - w, top: rect.top - w, width: rect.width + 2 * w, height: rect.height + 2 * w };
}

// How long the miss message stays up after a click that hit no position.
const NO_ROW_MS = 1800;

// One-shot picker: the next click anywhere is swallowed in the capture phase
// before Schwab's own row handlers can see it, and the position row it landed
// in is handed to onPick. Esc cancels. While armed, the row under the mouse is
// framed by a separate fixed overlay, never by writing to the row. Arming
// again replaces the previous arm instead of stacking listeners.
export function armPicker(doc, win, onPick) {
  if (!doc || !win || !doc.body) {
    throw new Error('armPicker needs a document with a body and a window');
  }
  const prev = win.__schwabShot;
  if (prev && isFn(prev.cleanup)) {
    prev.cleanup();
  }
  const pick = isFn(onPick) ? onPick : function () {};
  const body = doc.body;
  const banner = doc.createElement('div');
  banner.textContent = BANNER_TEXT;
  banner.setAttribute('style', BANNER_STYLE);
  body.appendChild(banner);
  const overlay = doc.createElement('div');
  overlay.setAttribute(SHOT, 'highlight');
  overlay.setAttribute('style', 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;box-sizing:border-box;border:' + HIGHLIGHT_WIDTH + 'px solid ' + ACCENT + ';border-radius:4px;background:transparent;pointer-events:none;z-index:2147483646;');
  const prevCursor = body.style.cursor;
  body.style.cursor = 'crosshair';
  let active = true;
  let hovered = null;
  let frame = 0;
  const state = { cleanup: cleanup };
  function removeBanner() {
    if (banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }
  function hideHighlight() {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }
  // A row with no measurable box gets no frame at all, so a collapsed or
  // scrolled-away row cannot leave one behind.
  function showHighlight(row) {
    const rect = rectOf(row);
    if (!rect) {
      hideHighlight();
      return;
    }
    const box = highlightRect(rect);
    overlay.style.left = box.left + 'px';
    overlay.style.top = box.top + 'px';
    overlay.style.width = box.width + 'px';
    overlay.style.height = box.height + 'px';
    if (!overlay.parentNode) {
      body.appendChild(overlay);
    }
  }
  function track() {
    frame = 0;
    if (!active) {
      return;
    }
    showHighlight(findPositionRow(hovered));
  }
  // Re-measuring on every move is also what keeps the frame aligned when the
  // row moves under the mouse, which is why there is no scroll listener.
  function onMove(event) {
    if (!active) {
      return;
    }
    hovered = event ? event.target : null;
    if (isFn(win.requestAnimationFrame)) {
      if (!frame) {
        frame = win.requestAnimationFrame(track);
      }
      return;
    }
    track();
  }
  function cleanup() {
    if (!active) {
      return;
    }
    active = false;
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    if (frame && isFn(win.cancelAnimationFrame)) {
      win.cancelAnimationFrame(frame);
    }
    frame = 0;
    hideHighlight();
    removeBanner();
    body.style.cursor = prevCursor;
    if (win.__schwabShot === state) {
      delete win.__schwabShot;
    }
  }
  function onKey(event) {
    if (!active || !event || (event.key !== 'Escape' && event.key !== 'Esc')) {
      return;
    }
    if (isFn(event.preventDefault)) {
      event.preventDefault();
    }
    if (isFn(event.stopPropagation)) {
      event.stopPropagation();
    }
    cleanup();
    pick(null);
  }
  // Swallow first, stand down second, decide third: whatever the row turns out
  // to be, the page must never receive this click.
  function onClick(event) {
    if (!active) {
      return;
    }
    if (event && isFn(event.preventDefault)) {
      event.preventDefault();
    }
    if (event && isFn(event.stopPropagation)) {
      event.stopPropagation();
    }
    if (event && isFn(event.stopImmediatePropagation)) {
      event.stopImmediatePropagation();
    }
    cleanup();
    const row = findPositionRow(event ? event.target : null);
    if (row) {
      pick(row);
      return;
    }
    // A miss says so and stays down. Re-arming here would let a second stray
    // click copy a position the user never meant to share.
    banner.textContent = NO_ROW_TEXT;
    body.appendChild(banner);
    if (isFn(win.setTimeout)) {
      win.setTimeout(removeBanner, NO_ROW_MS);
    } else {
      removeBanner();
    }
    pick(null);
  }
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  win.__schwabShot = state;
  return state;
}

// How long a toast stays up before it takes itself away.
const TOAST_MS = 3200;

// The toast's own box: a fixed pill at the bottom centre, tinted only by a
// left border so both tones read as the same message with a different edge.
// pointer-events:none matters more here than on the banner, because a toast
// lands right after a click on a live brokerage page and must never swallow
// the next one.
const TOAST_STYLE = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:8px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;border-left:2px solid ';
const TOAST_OK_BORDER = '#22C55E';
const TOAST_ERROR_BORDER = '#EF4444';

// Whatever the module left on the page as a toast, taken off. Scanning the
// body's own children rather than asking querySelector is what lets a test
// hand in a plain object as the document.
function removeToasts(body) {
  const kids = body.children;
  if (!kids || typeof kids.length !== 'number' || !isFn(body.removeChild)) {
    return;
  }
  for (let i = kids.length - 1; i >= 0; i--) {
    if (attrOf(kids[i], SHOT) === 'toast') {
      body.removeChild(kids[i]);
    }
  }
}

// A short message over the page: the success tone by default, the error tone
// when kind is error. Only ever one toast at a time, because a second message
// supersedes the first rather than stacking under it. Returns a remove() a
// caller can use to dismiss the message sooner; it is safe to call at any
// time, including after the timeout already fired.
export function showToast(doc, text, kind) {
  const body = doc && doc.body;
  if (!body || !isFn(doc.createElement) || !isFn(body.appendChild)) {
    return function () {};
  }
  removeToasts(body);
  const el = doc.createElement('div');
  el.setAttribute(SHOT, 'toast');
  el.setAttribute('role', 'status');
  el.setAttribute('style', TOAST_STYLE + (kind === 'error' ? TOAST_ERROR_BORDER : TOAST_OK_BORDER) + ';');
  el.textContent = text == null ? '' : String(text);
  body.appendChild(el);
  // remove closes over this element and asks whether it is still attached, so
  // a timer left pending by an older toast cannot take the newer one down.
  function remove() {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }
  const view = doc.defaultView;
  if (view && isFn(view.setTimeout)) {
    view.setTimeout(remove, TOAST_MS);
  } else if (isFn(setTimeout)) {
    setTimeout(remove, TOAST_MS);
  }
  return remove;
}

// The three ways the card can show the number, in the order the sheet offers
// them. The ids are the vocabulary the renderer and the wiring read; the
// labels are the only strings a user ever sees.
export const CHOOSER_TITLE = 'Share card';
export const CHOOSER_MODES = [{ id: 'pct', label: '% only' }, { id: 'usd', label: '$ only' }, { id: 'both', label: 'both' }];

// The lines the card may carry, in the order the sheet offers them, each with
// the state it starts in. The overall change is on because it is the card this
// program has always drawn; the other two are off because one names the size
// of a holding and the other is the figure a row is most likely to be missing.
// The key is the name buildCard reads, so the sheet and the builder cannot
// drift into two vocabularies.
export const CHOOSER_TOGGLES = [
  { id: 'quantity', key: 'showQuantity', label: 'Quantity' },
  { id: 'day', key: 'showDayChange', label: 'Day change' },
  { id: 'overall', key: 'showOverallChange', label: 'Overall change' },
];

// What the sheet says when every line is off, and the reason it says anything
// at all: a copy with no numbers on it is one the user cannot tell from a bug.
export const CHOOSER_HINT_TEXT = 'Turn on a line to copy';

// The dimmed page behind the sheet, one z-index below it so the sheet always
// sits on top of its own backdrop.
const CHOOSER_BACKDROP_STYLE = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);';
const CHOOSER_SHEET_STYLE = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;padding:20px 24px;border-radius:12px;background:#111;color:#fff;font:15px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);text-align:center;border:1px solid ' + ACCENT + ';';
const CHOOSER_HEADING_STYLE = 'margin:0 0 14px;font-weight:700;';
const CHOOSER_BUTTON_STYLE = 'margin:0 4px;padding:8px 14px;border-radius:8px;background:#1b1b1b;color:#fff;font:15px/1.4 system-ui,sans-serif;cursor:pointer;border:1px solid ' + ACCENT + ';';
// Cancel is a mode button that has been talked down: it keeps the corner
// radius and the pointer cursor of the row above it and overrides the rest.
// Every declaration here is written after the one it replaces, which is what
// makes the composed string render exactly as the full one used to.
const CHOOSER_CANCEL_STYLE = CHOOSER_BUTTON_STYLE + 'display:block;width:100%;margin:16px 0 0;padding:6px 12px;border:1px solid #444;background:transparent;color:#bbb;font:14px/1.4 system-ui,sans-serif;';
const CHOOSER_CANCEL_LABEL = 'Cancel';
// A toggle is a mode button wearing its state: dimmed when the line it names
// is off, because an aria attribute alone is not something a user can see.
const CHOOSER_TOGGLE_OFF_STYLE = 'opacity:.45;';
// The preview's own box. A card is 1080 by 1920, so fixing the width fixes the
// height with it, and the viewport unit is what keeps a portrait card whole on
// a short screen. Scaling is CSS only: the canvas keeps the pixels the
// clipboard is going to get, and the sheet only shows them smaller.
const PREVIEW_STYLE = 'display:block;margin:12px auto;width:min(240px,38vh);';
// What the slot says when the card could not be drawn. It is a line of text
// rather than a refusal, because a snapshot the builder turns down is still
// one the modes may click through to the clipboard's own message.
export const PREVIEW_ERROR = 'No preview';

// The whole point of the capture phase: whatever the event turns out to mean,
// Schwab's own handlers must never see it.
function swallow(event) {
  if (!event) {
    return;
  }
  if (isFn(event.preventDefault)) {
    event.preventDefault();
  }
  if (isFn(event.stopPropagation)) {
    event.stopPropagation();
  }
  if (isFn(event.stopImmediatePropagation)) {
    event.stopImmediatePropagation();
  }
}

// A sheet button. The type attribute is set on every one of them, which is
// what guarantees none can submit a Schwab form even if the sheet were ever
// reparented inside one.
function chooserButton(doc, label, attr, value, style) {
  const button = doc.createElement('button');
  button.setAttribute('type', 'button');
  button.setAttribute(attr, value);
  button.setAttribute('style', style);
  button.textContent = label;
  return button;
}

// What a click landed on: the value of name on the nearest element at or above
// the target that carries it. The backdrop and the sheet's padding carry
// neither attribute, so both answer null.
function chooserAttrOf(start, name) {
  let el = start && isFn(start.getAttribute) ? start : (start && start.parentElement) || null;
  for (let i = 0; el && i <= MAX_WALK; i++) {
    const value = attrOf(el, name);
    if (typeof value === 'string' && value !== '') {
      return value;
    }
    el = el.parentElement;
  }
  return null;
}

// Whatever the module left on the page as a chooser, taken off. Scanning the
// body's own children rather than asking querySelector is what lets a test
// hand in a plain object as the document.
function removeChoosers(body) {
  const kids = body.children;
  if (!kids || typeof kids.length !== 'number' || !isFn(body.removeChild)) {
    return;
  }
  for (let i = kids.length - 1; i >= 0; i--) {
    if (attrOf(kids[i], SHOT) === 'chooser') {
      body.removeChild(kids[i]);
    }
  }
}

// One chooser at a time, module-wide. Remembering the live one is what lets a
// second call take the first one's document listener down with it; sweeping
// the body afterwards catches a backdrop some earlier page state left behind.
let openChooser = null;

// Which numbers go on the card, asked over a dimmed page. The toggles along
// the top pick which lines the card carries and the buttons under them pick
// how each line is written, with % only focused. A mode button answers with
// its id and the toggle state beside it; Cancel, Esc and a click on the dimmed
// page around the sheet answer with null. onPick runs exactly once and only
// after the sheet is off the page. The returned close() dismisses the sheet
// without answering and is safe to call twice. A snapshot is what buys the
// preview between the two rows of buttons; a caller with none still gets the
// sheet, without a slot for a card it cannot draw.
export function showChooser(doc, onPick, snapshot) {
  const body = doc && doc.body;
  if (!body || !isFn(doc.createElement) || !isFn(body.appendChild) || !isFn(doc.addEventListener)) {
    return function () {};
  }
  if (openChooser) {
    openChooser();
  }
  removeChoosers(body);
  const pick = isFn(onPick) ? onPick : function () {};
  const backdrop = doc.createElement('div');
  backdrop.setAttribute(SHOT, 'chooser');
  backdrop.setAttribute('style', CHOOSER_BACKDROP_STYLE);
  const sheet = doc.createElement('div');
  sheet.setAttribute(SHOT, 'chooser-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('style', CHOOSER_SHEET_STYLE);
  const heading = doc.createElement('div');
  heading.textContent = CHOOSER_TITLE;
  heading.setAttribute('style', CHOOSER_HEADING_STYLE);
  sheet.appendChild(heading);
  // The toggles sit in a row of their own above the modes, so the sheet reads
  // top to bottom as which lines, then how they are written. show is the state
  // the answer carries: it starts at the builder's own defaults and only
  // flip() moves it.
  const show = cardOptions(null);
  const row = doc.createElement('div');
  row.setAttribute(SHOT, 'chooser-toggles');
  for (let i = 0; i < CHOOSER_TOGGLES.length; i++) {
    row.appendChild(chooserButton(doc, CHOOSER_TOGGLES[i].label, 'data-schwab-shot-toggle', CHOOSER_TOGGLES[i].id, CHOOSER_BUTTON_STYLE));
    dress(i);
  }
  sheet.appendChild(row);
  // The card itself, small, between the toggles and the modes, so the sheet
  // reads top to bottom as which lines, then what they come out looking like,
  // then how to copy them. at is the mode on the slot right now: it starts at
  // the mode the sheet focuses and it is what lets a toggle redraw the card
  // the user is looking at without being told which one that is. The hover
  // handler is a property rather than a listener because this sheet is the
  // program's own node and nothing else can be listening on it, while focusin
  // has no property form an engine is obliged to offer.
  let at = 'pct';
  const preview = doc.createElement('div');
  if (snapshot) {
    sheet.appendChild(preview);
    sheet.onpointerover = onHover;
    sheet.addEventListener('focusin', onHover, true);
    drawPreview(at);
  }
  let firstMode = null;
  for (let i = 0; i < CHOOSER_MODES.length; i++) {
    const button = chooserButton(doc, CHOOSER_MODES[i].label, SHOT_MODE, CHOOSER_MODES[i].id, CHOOSER_BUTTON_STYLE);
    if (!firstMode) {
      firstMode = button;
    }
    sheet.appendChild(button);
  }
  sheet.appendChild(chooserButton(doc, CHOOSER_CANCEL_LABEL, SHOT_MODE, 'cancel', CHOOSER_CANCEL_STYLE));
  backdrop.appendChild(sheet);
  body.appendChild(backdrop);
  let active = true;
  function close() {
    if (!active) {
      return;
    }
    active = false;
    doc.removeEventListener('keydown', onKey, true);
    sheet.onpointerover = null;
    sheet.removeEventListener('focusin', onHover, true);
    sheet.removeEventListener('click', onClick, true);
    backdrop.removeEventListener('click', onClick, true);
    if (backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
    if (openChooser === close) {
      openChooser = null;
    }
  }
  // Off the page first, answer second, so a callback that opens its own
  // overlay cannot find this one still standing. The toggles ride along with
  // the mode, normalized, so the card the user was looking at is the card the
  // clipboard gets.
  function resolve(mode) {
    if (!active) {
      return;
    }
    close();
    pick(mode, mode ? cardOptions(show) : null);
  }

  // The one preview surface, redrawn for a mode rather than added to. The
  // clock is read here and read again when a mode is clicked, which is a
  // second of drift on the share time and cheaper than holding one Date open
  // across a sheet the user may leave standing. A card the builder refuses
  // leaves the slot saying so, and the modes stay clickable behind it.
  function drawPreview(mode) {
    at = mode;
    const canvas = renderCard(doc, snapshot, mode, new Date(), show);
    preview.textContent = canvas ? '' : PREVIEW_ERROR;
    if (canvas) {
      canvas.setAttribute('style', PREVIEW_STYLE);
      preview.appendChild(canvas);
    }
  }

  // Reaching a mode with the mouse or with the keyboard is not an answer, only
  // a question about what that mode looks like, so it redraws and nothing
  // else: the clipboard still waits for the click. Cancel is no card and the
  // mode already on the slot is no change, so both leave the preview alone.
  function onHover(event) {
    const mode = chooserAttrOf(event ? event.target : null, SHOT_MODE);
    if (mode && mode !== 'cancel' && mode !== at) {
      drawPreview(mode);
    }
  }

  // A toggle wears its state twice over: dimmed for the eye, aria-pressed for
  // a screen reader.
  function dress(i) {
    const on = show[CHOOSER_TOGGLES[i].key];
    row.children[i].setAttribute('style', CHOOSER_BUTTON_STYLE + (on ? '' : CHOOSER_TOGGLE_OFF_STYLE));
    row.children[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // The one place a toggle changes anything: the state the modes answer with,
  // the button that shows it, the heading, which becomes the hint while there
  // is nothing left to copy, and the preview, because a line switched off
  // while the card is on screen would otherwise still be on the card.
  function flip(id) {
    for (let i = 0; i < CHOOSER_TOGGLES.length; i++) {
      if (CHOOSER_TOGGLES[i].id === id) {
        show[CHOOSER_TOGGLES[i].key] = !show[CHOOSER_TOGGLES[i].key];
        dress(i);
      }
    }
    heading.textContent = canBuildCard(show) ? CHOOSER_TITLE : CHOOSER_HINT_TEXT;
    drawPreview(at);
  }
  function onKey(event) {
    if (!active || !event || (event.key !== 'Escape' && event.key !== 'Esc')) {
      return;
    }
    swallow(event);
    resolve(null);
  }
  // Registered on the sheet and on the backdrop, so whichever of the two the
  // click reaches first answers it. The backdrop is the sheet's ancestor, so
  // in a browser that is the backdrop's copy, and the climb from the target is
  // what tells a button apart from the dimmed page.
  function onClick(event) {
    if (!active) {
      return;
    }
    swallow(event);
    const target = event ? event.target : null;
    const toggle = chooserAttrOf(target, 'data-schwab-shot-toggle');
    if (toggle) {
      flip(toggle);
      return;
    }
    const mode = chooserAttrOf(target, SHOT_MODE);
    if (mode === 'cancel') {
      resolve(null);
      return;
    }
    if (mode) {
      // Every line off is not a card, so the sheet stays up and says so rather
      // than putting an instrument over a timestamp on the clipboard.
      if (!canBuildCard(show)) {
        heading.textContent = CHOOSER_HINT_TEXT;
        return;
      }
      resolve(mode);
      return;
    }
    // The sheet's own padding is not an answer; only the page around it is.
    if (event && event.target === backdrop) {
      resolve(null);
    }
  }
  sheet.addEventListener('click', onClick, true);
  backdrop.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKey, true);
  if (firstMode && isFn(firstMode.focus)) {
    firstMode.focus();
  }
  openChooser = close;
  return close;
}

// The one place an outcome becomes words on the page. Success is the same
// sentence every time; a failure shows the code's own message in the error
// tone, so the four clipboard refusals and a card that could not be drawn all
// reach the user as one kind of event with four different reasons.
function reportFlow(doc, outcome) {
  showToast(doc, outcome.ok ? TOAST_OK_TEXT : outcome.message, outcome.ok ? 'ok' : 'error');
  return outcome;
}

// A chosen mode all the way to the clipboard: render, encode, write, report.
// Returns the clipboard outcome and never throws, which is what lets the
// chooser's click handler start it and walk away. Rendering happens here
// rather than before the sheet opens because the card's content depends on the
// mode and on the toggles beside it, and pre-rendering every combination would
// cost a card apiece for the one the user ever sees. Nothing on this path defers to a timer or an animation
// frame: the write has to stay inside the task the mode click started,
// because that task is the user gesture the clipboard demands.
export async function runFlow(doc, win, snapshot, mode, now, options) {
  const canvas = renderCard(doc, snapshot, mode, now, options);
  if (!canvas) {
    return reportFlow(doc, clipboardFailure('write-failed'));
  }
  let blob = null;
  try {
    blob = await canvasToPngBlob(canvas);
  } catch (err) {
    return reportFlow(doc, clipboardFailure('write-failed'));
  }
  return reportFlow(doc, await writePngToClipboard(win, blob));
}

// One click, the whole flow. Arming the picker is all this does directly;
// every later stage is a callback, because each waits on a user action that
// may never come. A cancel at any stage simply stops, because the stage that
// was cancelled has already taken itself off the page, which is also why at
// most one overlay is ever up and Esc can never be ambiguous.
export function main(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win || !doc.body) {
    return;
  }
  armPicker(doc, win, function (row) {
    // Esc and a click that landed on no position both arrive as null and the
    // picker has already said so on the page, so a message here would only
    // repeat one the user is already reading.
    if (!row) {
      return;
    }
    const snapshot = parsePositionRow(row);
    if (!snapshot) {
      showToast(doc, NO_ROW_TEXT, 'error');
      return;
    }
    // The snapshot rather than the row is what crosses into the chooser: it
    // holds no DOM reference, so Schwab re-rendering the table while the
    // sheet is open cannot pin the card to a row that is no longer there.
    showChooser(doc, function (mode, options) {
      if (!mode) {
        return;
      }
      runFlow(doc, win, snapshot, mode, new Date(), options);
    }, snapshot);
  });
}

// @bookmarklet-strip-start
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  main();
}
// @bookmarklet-strip-end
