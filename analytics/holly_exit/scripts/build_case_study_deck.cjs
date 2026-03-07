const pptxgen = require("pptxgenjs");
const path = require("path");

// ====================
// PALETTE & CONSTANTS
// ====================
const C = {
  bg:       "0F1419",   // near-black
  bgCard:   "1B2838",   // dark slate cards
  bgCard2:  "1E3A5F",   // slightly brighter card
  accent:   "F59E0B",   // amber/gold
  green:    "10B981",   // emerald green
  red:      "EF4444",   // red
  white:    "F1F5F9",   // off-white text
  muted:    "B0BEC5",   // muted grey-blue (brightened for contrast)
  dimText:  "7C8DA0",   // dim text (brightened for contrast)
  blue:     "3B82F6",   // blue accent
  teal:     "14B8A6",   // teal
  purple:   "8B5CF6",   // purple
};

const FONT_TITLE = "Georgia";
const FONT_BODY = "Calibri";

const OUTPUT = path.join(__dirname, "..", "output", "reports", "trade_mapping", "case_studies_deck.pptx");

// Helper: fresh shadow objects (pptxgenjs mutates in place)
const cardShadow = () => ({ type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.3 });

// Icon dots — small colored circles with a letter instead of react-icons
function addIconDot(slide, pres, x, y, letter, color) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: 0.3, h: 0.3, fill: { color } });
  slide.addText(letter, { x, y, w: 0.3, h: 0.3, fontSize: 12, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
}

// ====================
// SLIDES
// ====================
async function build() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "Holly Exit Analysis";
  pres.title = "Case Studies: Your Trading vs Holly AI";

  // No icon images needed — using addIconDot() with colored circles

  // ============================================================
  // SLIDE 1: TITLE
  // ============================================================
  let s1 = pres.addSlide();
  s1.background = { color: C.bg };

  // Top accent bar
  s1.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  // Title
  s1.addText("Trade Execution Case Studies", {
    x: 0.8, y: 1.2, w: 8.4, h: 1.2,
    fontSize: 40, fontFace: FONT_TITLE, color: C.white, bold: true, margin: 0
  });

  s1.addText("Your IBKR Fills vs Holly AI Alerts", {
    x: 0.8, y: 2.3, w: 8.4, h: 0.6,
    fontSize: 22, fontFace: FONT_BODY, color: C.accent, margin: 0
  });

  // Divider
  s1.addShape(pres.shapes.LINE, { x: 0.8, y: 3.2, w: 3.5, h: 0, line: { color: C.accent, width: 2 } });

  // Subtitle
  s1.addText("3 trades dissected fill-by-fill to reveal where P&L leaks", {
    x: 0.8, y: 3.5, w: 7, h: 0.5,
    fontSize: 15, fontFace: FONT_BODY, color: C.muted, margin: 0
  });

  // Bottom stats row
  const statsY = 4.4;
  const statsData = [
    { label: "Matched Trades", value: "89", dot: "#", dotColor: C.accent },
    { label: "Same Win Rate", value: "50.6%", dot: "%", dotColor: C.green },
    { label: "Your P&L", value: "-$1,346", dot: "-", dotColor: C.red },
    { label: "Holly P&L", value: "+$37,442", dot: "+", dotColor: C.green },
  ];
  statsData.forEach((st, i) => {
    const sx = 0.8 + i * 2.25;
    s1.addShape(pres.shapes.RECTANGLE, { x: sx, y: statsY, w: 2.0, h: 0.85, fill: { color: C.bgCard }, shadow: cardShadow() });
    addIconDot(s1, pres, sx + 0.12, statsY + 0.15, st.dot, st.dotColor);
    s1.addText(st.value, { x: sx + 0.5, y: statsY + 0.05, w: 1.4, h: 0.4, fontSize: 18, fontFace: FONT_BODY, bold: true, color: C.white, margin: 0 });
    s1.addText(st.label, { x: sx + 0.5, y: statsY + 0.45, w: 1.4, h: 0.3, fontSize: 10, fontFace: FONT_BODY, color: C.muted, margin: 0 });
  });

  // ============================================================
  // SLIDE 2: THE BIG PICTURE
  // ============================================================
  let s2 = pres.addSlide();
  s2.background = { color: C.bg };
  s2.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  s2.addText("The Core Problem", {
    x: 0.8, y: 0.3, w: 8, h: 0.7,
    fontSize: 32, fontFace: FONT_TITLE, color: C.white, bold: true, margin: 0
  });

  s2.addText("Same stock picks. Same win rate. Opposite results.", {
    x: 0.8, y: 0.95, w: 8, h: 0.4,
    fontSize: 16, fontFace: FONT_BODY, color: C.accent, margin: 0
  });

  // Big comparison cards
  // YOUR CARD
  s2.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 1.7, w: 4.0, h: 2.8, fill: { color: C.bgCard }, shadow: cardShadow() });
  s2.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 1.7, w: 4.0, h: 0.06, fill: { color: C.red } });
  s2.addText("YOUR EXECUTION", { x: 0.8, y: 1.85, w: 4.0, h: 0.4, fontSize: 14, fontFace: FONT_BODY, color: C.red, bold: true, align: "center", margin: 0 });
  s2.addText("-$1,346", { x: 0.8, y: 2.3, w: 4.0, h: 0.7, fontSize: 44, fontFace: FONT_TITLE, color: C.red, bold: true, align: "center", margin: 0 });
  s2.addText([
    { text: "Avg Win: $45  |  Avg Loss: $76", options: { breakLine: true, fontSize: 13 } },
    { text: "W:L Ratio: 0.59:1", options: { breakLine: true, fontSize: 13, bold: true } },
    { text: "Hold: exits 129 min before Holly", options: { fontSize: 13 } },
  ], { x: 1.1, y: 3.15, w: 3.5, h: 1.1, fontFace: FONT_BODY, color: C.muted, align: "center", margin: 0 });

  // HOLLY CARD
  s2.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.7, w: 4.0, h: 2.8, fill: { color: C.bgCard }, shadow: cardShadow() });
  s2.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.7, w: 4.0, h: 0.06, fill: { color: C.green } });
  s2.addText("HOLLY AI", { x: 5.2, y: 1.85, w: 4.0, h: 0.4, fontSize: 14, fontFace: FONT_BODY, color: C.green, bold: true, align: "center", margin: 0 });
  s2.addText("+$37,442", { x: 5.2, y: 2.3, w: 4.0, h: 0.7, fontSize: 44, fontFace: FONT_TITLE, color: C.green, bold: true, align: "center", margin: 0 });
  s2.addText([
    { text: "Avg Win: $874  |  Avg Loss: $43", options: { breakLine: true, fontSize: 13 } },
    { text: "W:L Ratio: 20.2:1", options: { breakLine: true, fontSize: 13, bold: true } },
    { text: "Hold: rides full move", options: { fontSize: 13 } },
  ], { x: 5.5, y: 3.15, w: 3.5, h: 1.1, fontFace: FONT_BODY, color: C.muted, align: "center", margin: 0 });

  // Bottom insight
  s2.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 4.6, w: 8.4, h: 0.55, fill: { color: "1E293B" } });
  s2.addText("The gap is NOT stock-picking. It's 3 execution failures: early exits, blown stops, oversizing.", {
    x: 1.0, y: 4.6, w: 8.0, h: 0.55,
    fontSize: 13, fontFace: FONT_BODY, color: C.accent, align: "center", valign: "middle", margin: 0
  });

  // ============================================================
  // SLIDE 3: CASE 1 - BE (Mighty Mouse) - Header
  // ============================================================
  let s3 = pres.addSlide();
  s3.background = { color: C.bg };
  s3.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  // Case badge
  s3.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fill: { color: C.accent } });
  s3.addText("CASE 1", { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fontSize: 14, fontFace: FONT_BODY, color: C.bg, bold: true, align: "center", valign: "middle", margin: 0 });

  s3.addText("BE (Bloom Energy) - Mighty Mouse Long", {
    x: 2.2, y: 0.3, w: 7, h: 0.45,
    fontSize: 24, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  s3.addText("July 9, 2025  |  The Biggest Gap: $4 vs $13,574", {
    x: 2.2, y: 0.8, w: 7, h: 0.35,
    fontSize: 14, fontFace: FONT_BODY, color: C.muted, margin: 0
  });

  // Two-column layout
  // LEFT: Holly Alert
  s3.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 4.3, h: 3.3, fill: { color: C.bgCard }, shadow: cardShadow() });
  s3.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 0.08, h: 3.3, fill: { color: C.green } });
  addIconDot(s3, pres, 0.75, 1.55, "H", C.green);
  s3.addText("Holly's Plan", { x: 1.15, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.green, bold: true, margin: 0 });

  const hollyBE = [
    { text: "Alert:     07:12 AM", options: { breakLine: true } },
    { text: "Entry:     $27.95", options: { breakLine: true } },
    { text: "Stop:      $25.84", options: { breakLine: true } },
    { text: "Risk:      $2.11/share", options: { breakLine: true } },
    { text: "Exit:      $28.45 @ 12:55 PM", options: { breakLine: true } },
    { text: "Hold:      342 minutes", options: { breakLine: true } },
    { text: "P&L:       +$13,574", options: { bold: true, color: C.green } },
  ];
  s3.addText(hollyBE, { x: 0.85, y: 2.1, w: 3.7, h: 2.4, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // RIGHT: Your Execution
  s3.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 4.3, h: 3.3, fill: { color: C.bgCard }, shadow: cardShadow() });
  s3.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 0.08, h: 3.3, fill: { color: C.red } });
  addIconDot(s3, pres, 5.45, 1.55, "Y", C.red);
  s3.addText("Your Execution", { x: 5.85, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.red, bold: true, margin: 0 });

  const yourBE = [
    { text: "Entry:     10:52 AM (3h40m late)", options: { breakLine: true } },
    { text: "BUY:       25 shares @ $27.94", options: { breakLine: true } },
    { text: "Exit:      10:55 AM (3 min hold!)", options: { breakLine: true } },
    { text: "SELL:      25 shares @ $28.19", options: { breakLine: true } },
    { text: "Move:      $0.25/share (49% capture)", options: { breakLine: true } },
    { text: "Re-entry:  14:04 PM (another scalp)", options: { breakLine: true } },
    { text: "P&L:       +$4.14", options: { bold: true, color: C.red } },
  ];
  s3.addText(yourBE, { x: 5.55, y: 2.1, w: 3.7, h: 2.4, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // Bottom callout
  s3.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 4.8, w: 9.0, h: 0.5, fill: { color: "2D1B00" } });
  addIconDot(s3, pres, 0.7, 4.9, "!", C.accent);
  s3.addText("You captured 49% of the per-share move but only 0.03% of total P&L. Size: 25 shares vs Holly's position.", {
    x: 1.1, y: 4.8, w: 8.2, h: 0.5,
    fontSize: 12, fontFace: FONT_BODY, color: C.accent, valign: "middle", margin: 0
  });

  // ============================================================
  // SLIDE 4: CASE 1 - BE Timeline
  // ============================================================
  let s4 = pres.addSlide();
  s4.background = { color: C.bg };
  s4.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  s4.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fill: { color: C.accent } });
  s4.addText("CASE 1", { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fontSize: 12, fontFace: FONT_BODY, color: C.bg, bold: true, align: "center", valign: "middle", margin: 0 });
  s4.addText("BE Timeline: 3-Minute Scalp vs 6-Hour Hold", {
    x: 2.2, y: 0.25, w: 7, h: 0.4, fontSize: 22, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  // Timeline events
  const timelineEvents = [
    { time: "07:12", who: "HOLLY", desc: "Alert fires: Mighty Mouse Long @ $27.95, stop $25.84", color: C.green },
    { time: "", who: "", desc: "3 hours 40 minutes pass...", color: C.dimText },
    { time: "10:52", who: "YOU", desc: "BUY 25 shares @ $27.94 (entry nearly identical)", color: C.blue },
    { time: "10:55", who: "YOU", desc: "SELL 25 shares @ $28.19 (+$0.25/sh, 3 min hold)", color: C.red },
    { time: "", who: "", desc: "3 hours 9 minutes pass...", color: C.dimText },
    { time: "12:55", who: "HOLLY", desc: "Exits @ $28.45 (+$0.50/share, 342 min hold)", color: C.green },
    { time: "14:04", who: "YOU", desc: "Re-enter: BUY again (2nd scalp attempt)", color: C.blue },
    { time: "14:09", who: "YOU", desc: "SELL again (5 min hold, small gain)", color: C.red },
  ];

  const tlStartY = 0.9;
  const tlRowH = 0.45;
  timelineEvents.forEach((evt, i) => {
    const y = tlStartY + i * tlRowH;

    if (evt.who === "") {
      // Gap indicator
      s4.addText(evt.desc, { x: 2.2, y: y, w: 6, h: tlRowH, fontSize: 11, fontFace: FONT_BODY, color: C.dimText, italic: true, valign: "middle", margin: 0 });
      return;
    }

    // Time
    s4.addText(evt.time, { x: 0.8, y: y, w: 0.8, h: tlRowH, fontSize: 13, fontFace: "Consolas", color: C.muted, valign: "middle", margin: 0 });

    // Who badge
    const badgeColor = evt.who === "HOLLY" ? C.green : C.blue;
    s4.addShape(pres.shapes.RECTANGLE, { x: 1.7, y: y + 0.1, w: 0.9, h: 0.3, fill: { color: badgeColor } });
    s4.addText(evt.who, { x: 1.7, y: y + 0.1, w: 0.9, h: 0.3, fontSize: 9, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });

    // Desc
    s4.addText(evt.desc, { x: 2.8, y: y, w: 6.5, h: tlRowH, fontSize: 12, fontFace: FONT_BODY, color: evt.color, valign: "middle", margin: 0 });
  });

  // Lesson card
  const lessonY = tlStartY + timelineEvents.length * tlRowH + 0.15;
  s4.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: lessonY, w: 8.4, h: 0.8, fill: { color: "1E293B" }, shadow: cardShadow() });
  addIconDot(s4, pres, 1.05, lessonY + 0.22, "!", C.red);
  s4.addText([
    { text: "LESSON: ", options: { bold: true, color: C.accent } },
    { text: "Holding just 25 shares for the full move would have yielded $12.50 vs your $4.14. The 3-min scalp captured half the per-share move but missed the extended run." },
  ], { x: 1.5, y: lessonY, w: 7.5, h: 0.8, fontSize: 12, fontFace: FONT_BODY, color: C.muted, valign: "middle", margin: 0 });

  // ============================================================
  // SLIDE 5: CASE 2 - ZONE Header
  // ============================================================
  let s5 = pres.addSlide();
  s5.background = { color: C.bg };
  s5.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.red } });

  s5.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fill: { color: C.red } });
  s5.addText("CASE 2", { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fontSize: 14, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });

  s5.addText("ZONE - The 5 Day Bounce Long", {
    x: 2.2, y: 0.3, w: 7, h: 0.45,
    fontSize: 24, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  s5.addText("ZoneOmics  |  Sept 4, 2025  |  Your Biggest Loss: -$644", {
    x: 2.2, y: 0.8, w: 7, h: 0.35,
    fontSize: 14, fontFace: FONT_BODY, color: C.red, margin: 0
  });

  // LEFT: Holly
  s5.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 4.3, h: 2.5, fill: { color: C.bgCard }, shadow: cardShadow() });
  s5.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 0.08, h: 2.5, fill: { color: C.green } });
  addIconDot(s5, pres, 0.75, 1.55, "H", C.green);
  s5.addText("Holly's Plan", { x: 1.15, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.green, bold: true, margin: 0 });

  s5.addText([
    { text: "Alert:   09:00 AM", options: { breakLine: true } },
    { text: "Entry:   $3.86", options: { breakLine: true } },
    { text: "Stop:    $3.74 (risk: $0.12)", options: { breakLine: true } },
    { text: "Exit:    near stop", options: { breakLine: true } },
    { text: "P&L:     -$11.58 (controlled loss)", options: { bold: true, color: C.muted } },
  ], { x: 0.85, y: 2.1, w: 3.7, h: 1.6, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // RIGHT: Your Execution
  s5.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 4.3, h: 2.5, fill: { color: C.bgCard }, shadow: cardShadow() });
  s5.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 0.08, h: 2.5, fill: { color: C.red } });
  addIconDot(s5, pres, 5.45, 1.55, "Y", C.red);
  s5.addText("Your Execution", { x: 5.85, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.red, bold: true, margin: 0 });

  s5.addText([
    { text: "Entry:   12:12 PM (3h12m late)", options: { breakLine: true } },
    { text: "BUY:     1000 sh @ $3.94 (+2.16% slip)", options: { breakLine: true } },
    { text: "Fills:   7 partial across 3 exchanges", options: { breakLine: true } },
    { text: "Exit:    13:15 STOP @ $3.31", options: { breakLine: true } },
    { text: "P&L:     -$643.67", options: { bold: true, color: C.red } },
  ], { x: 5.55, y: 2.1, w: 3.7, h: 1.6, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // Damage breakdown - 3 cards
  const dmgY = 4.05;
  const dmgData = [
    { label: "Entry Slippage", value: "+2.16%", sub: "$0.08 worse = 0.70R of risk", color: C.accent },
    { label: "Past Stop", value: "$0.43", sub: "Holly stop $3.74, you exited $3.31", color: C.red },
    { label: "Extra Damage", value: "$513", sub: "Loss at stop: -$130, actual: -$644", color: C.red },
  ];
  dmgData.forEach((d, i) => {
    const dx = 0.5 + i * 3.1;
    s5.addShape(pres.shapes.RECTANGLE, { x: dx, y: dmgY, w: 2.8, h: 1.15, fill: { color: C.bgCard }, shadow: cardShadow() });
    s5.addText(d.label, { x: dx + 0.15, y: dmgY + 0.1, w: 2.5, h: 0.25, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });
    s5.addText(d.value, { x: dx + 0.15, y: dmgY + 0.35, w: 2.5, h: 0.35, fontSize: 24, fontFace: FONT_BODY, color: d.color, bold: true, margin: 0 });
    s5.addText(d.sub, { x: dx + 0.15, y: dmgY + 0.75, w: 2.5, h: 0.3, fontSize: 10, fontFace: FONT_BODY, color: C.dimText, margin: 0 });
  });

  // ============================================================
  // SLIDE 6: CASE 2 - ZONE Timeline
  // ============================================================
  let s6 = pres.addSlide();
  s6.background = { color: C.bg };
  s6.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.red } });

  s6.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fill: { color: C.red } });
  s6.addText("CASE 2", { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fontSize: 12, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
  s6.addText("ZONE: Anatomy of a Blown Stop", {
    x: 2.2, y: 0.25, w: 7, h: 0.4, fontSize: 22, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  // Price level visualization
  const priceBarX = 1.0;
  const priceBarW = 8.0;
  const priceBarY = 1.0;

  s6.addText("Price Map (not to scale)", { x: priceBarX, y: priceBarY, w: 4, h: 0.3, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });

  // Price bar background
  s6.addShape(pres.shapes.RECTANGLE, { x: priceBarX, y: priceBarY + 0.35, w: priceBarW, h: 0.6, fill: { color: C.bgCard } });

  // Zone markers - positioned proportionally within the bar
  // Range: $3.31 (your exit) to $3.94 (your entry) = $0.63 range
  // Holly entry $3.86, Holly stop $3.74, Your entry $3.94, Your exit $3.31
  const pMin = 3.25, pMax = 4.00;
  const pScale = (p) => priceBarX + ((p - pMin) / (pMax - pMin)) * priceBarW;

  // Your exit zone (red)
  s6.addShape(pres.shapes.RECTANGLE, { x: pScale(3.31) - 0.02, y: priceBarY + 0.35, w: 0.04, h: 0.6, fill: { color: C.red } });
  s6.addText("Your Exit\n$3.31", { x: pScale(3.31) - 0.6, y: priceBarY + 1.0, w: 1.2, h: 0.4, fontSize: 9, fontFace: FONT_BODY, color: C.red, align: "center", margin: 0 });

  // Holly stop
  s6.addShape(pres.shapes.RECTANGLE, { x: pScale(3.74) - 0.02, y: priceBarY + 0.35, w: 0.04, h: 0.6, fill: { color: C.accent } });
  s6.addText("Holly Stop\n$3.74", { x: pScale(3.74) - 0.6, y: priceBarY + 1.0, w: 1.2, h: 0.4, fontSize: 9, fontFace: FONT_BODY, color: C.accent, align: "center", margin: 0 });

  // Holly entry
  s6.addShape(pres.shapes.RECTANGLE, { x: pScale(3.86) - 0.02, y: priceBarY + 0.35, w: 0.04, h: 0.6, fill: { color: C.green } });
  s6.addText("Holly Entry\n$3.86", { x: pScale(3.86) - 0.6, y: priceBarY + 1.0, w: 1.2, h: 0.4, fontSize: 9, fontFace: FONT_BODY, color: C.green, align: "center", margin: 0 });

  // Your entry
  s6.addShape(pres.shapes.RECTANGLE, { x: pScale(3.94) - 0.02, y: priceBarY + 0.35, w: 0.04, h: 0.6, fill: { color: C.blue } });
  s6.addText("Your Entry\n$3.94", { x: pScale(3.94) - 0.6, y: priceBarY + 1.0, w: 1.2, h: 0.4, fontSize: 9, fontFace: FONT_BODY, color: C.blue, align: "center", margin: 0 });

  // Fill detail table — below price map annotations (which end ~y=1.8)
  const fillY = 2.5;
  s6.addText("Your 7 Partial Fills (1000 shares across 3 exchanges)", {
    x: 0.8, y: fillY, w: 8, h: 0.35, fontSize: 14, fontFace: FONT_BODY, color: C.white, bold: true, margin: 0
  });

  const fillTableHeader = [
    [
      { text: "Time", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
      { text: "B/S", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
      { text: "Qty", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
      { text: "Price", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
      { text: "Exchange", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
      { text: "Type", options: { fill: { color: "1E293B" }, color: C.accent, bold: true, fontSize: 10, fontFace: FONT_BODY } },
    ],
    [
      { text: "12:12:31", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "BUY", options: { fontSize: 10, fontFace: "Consolas", color: C.green } },
      { text: "200", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "$3.94", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "MEMX", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
      { text: "LMT", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
    ],
    [
      { text: "12:12:31", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "BUY", options: { fontSize: 10, fontFace: "Consolas", color: C.green } },
      { text: "300", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "$3.94", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "DRCTEDGE", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
      { text: "LMT", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
    ],
    [
      { text: "12:12:31", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "BUY", options: { fontSize: 10, fontFace: "Consolas", color: C.green } },
      { text: "500", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "$3.94", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "ARCA", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
      { text: "LMT", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
    ],
    [
      { text: "13:15:42", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "SELL", options: { fontSize: 10, fontFace: "Consolas", color: C.red } },
      { text: "1000", options: { fontSize: 10, fontFace: "Consolas", color: C.white } },
      { text: "$3.31", options: { fontSize: 10, fontFace: "Consolas", color: C.red, bold: true } },
      { text: "ARCA", options: { fontSize: 10, fontFace: "Consolas", color: C.muted } },
      { text: "STP", options: { fontSize: 10, fontFace: "Consolas", color: C.red } },
    ],
  ];

  s6.addTable(fillTableHeader, {
    x: 0.8, y: fillY + 0.4, w: 8.4,
    colW: [1.2, 0.7, 0.7, 1.0, 1.4, 0.7],
    border: { pt: 0.5, color: "2D3748" },
    fill: { color: C.bgCard },
    rowH: [0.32, 0.28, 0.28, 0.28, 0.28],
  });

  // Lesson — positioned after table rows
  s6.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 4.35, w: 8.4, h: 0.95, fill: { color: "2D0000" }, shadow: cardShadow() });
  addIconDot(s6, pres, 1.05, 4.5, "!", C.red);
  s6.addText([
    { text: "LESSON: ", options: { bold: true, color: C.red } },
    { text: "3 compounding errors. (1) Entered +2.16% above Holly = 0.70R consumed on entry. (2) Sized 10x Holly at 1000 shares. (3) Exited $0.43 past Holly's stop. At stop, loss = -$130 not -$644." },
  ], { x: 1.5, y: 4.35, w: 7.5, h: 0.95, fontSize: 11, fontFace: FONT_BODY, color: C.muted, valign: "middle", margin: 0 });

  // ============================================================
  // SLIDE 7: CASE 3 - FROG Header
  // ============================================================
  let s7 = pres.addSlide();
  s7.background = { color: C.bg };
  s7.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.green } });

  s7.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fill: { color: C.green } });
  s7.addText("CASE 3", { x: 0.8, y: 0.3, w: 1.2, h: 0.45, fontSize: 14, fontFace: FONT_BODY, color: C.bg, bold: true, align: "center", valign: "middle", margin: 0 });

  s7.addText("FROG (JFrog) - Breakdown Short", {
    x: 2.2, y: 0.3, w: 7, h: 0.45,
    fontSize: 24, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  s7.addText("Feb 13, 2026  |  Your Best Trade, But Holly Made 6x More", {
    x: 2.2, y: 0.8, w: 7, h: 0.35,
    fontSize: 14, fontFace: FONT_BODY, color: C.teal, margin: 0
  });

  // LEFT: Holly
  s7.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 4.3, h: 2.5, fill: { color: C.bgCard }, shadow: cardShadow() });
  s7.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.4, w: 0.08, h: 2.5, fill: { color: C.green } });
  addIconDot(s7, pres, 0.75, 1.55, "H", C.green);
  s7.addText("Holly's Plan", { x: 1.15, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.green, bold: true, margin: 0 });

  s7.addText([
    { text: "Alert:   07:02 AM (pre-market)", options: { breakLine: true } },
    { text: "SHORT:   $53.94", options: { breakLine: true } },
    { text: "Stop:    $55.56 (risk: $1.62)", options: { breakLine: true } },
    { text: "Exit:    $52.07 @ 12:56 PM", options: { breakLine: true } },
    { text: "Gain:    $1.87/share", options: { breakLine: true } },
    { text: "P&L:     +$1,450", options: { bold: true, color: C.green } },
  ], { x: 0.85, y: 2.05, w: 3.7, h: 1.7, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // RIGHT: Your Execution
  s7.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 4.3, h: 2.5, fill: { color: C.bgCard }, shadow: cardShadow() });
  s7.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.4, w: 0.08, h: 2.5, fill: { color: C.teal } });
  addIconDot(s7, pres, 5.45, 1.55, "Y", C.teal);
  s7.addText("Your Execution", { x: 5.85, y: 1.55, w: 3, h: 0.35, fontSize: 16, fontFace: FONT_BODY, color: C.teal, bold: true, margin: 0 });

  s7.addText([
    { text: "Entry:   10:02 AM (3h late)", options: { breakLine: true } },
    { text: "SELL:    100 shares @ $53.88", options: { breakLine: true } },
    { text: "Exit:    10:43 AM", options: { breakLine: true } },
    { text: "BUY:     100 shares @ $51.50", options: { breakLine: true } },
    { text: "Gain:    $2.38/share (127% capture!)", options: { breakLine: true } },
    { text: "P&L:     +$235.98", options: { bold: true, color: C.green } },
  ], { x: 5.55, y: 2.05, w: 3.7, h: 1.7, fontSize: 13, fontFace: "Consolas", color: C.white, margin: 0, paraSpaceAfter: 4 });

  // Comparison metrics
  const metY = 4.15;
  const metData = [
    { label: "Per-Share Capture", yours: "127%", hollys: "100%", winner: "you", note: "You got better /sh price" },
    { label: "Hold Time", yours: "41 min", hollys: "354 min", winner: "holly", note: "Exited 2h12m early" },
    { label: "Total P&L", yours: "+$236", hollys: "+$1,450", winner: "holly", note: "$1,214 left on table" },
  ];
  metData.forEach((m, i) => {
    const mx = 0.5 + i * 3.1;
    s7.addShape(pres.shapes.RECTANGLE, { x: mx, y: metY, w: 2.8, h: 1.15, fill: { color: C.bgCard }, shadow: cardShadow() });
    s7.addText(m.label, { x: mx + 0.15, y: metY + 0.08, w: 2.5, h: 0.25, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });
    const valueColor = m.winner === "you" ? C.green : C.accent;
    s7.addText(`You: ${m.yours}  |  Holly: ${m.hollys}`, { x: mx + 0.15, y: metY + 0.35, w: 2.5, h: 0.3, fontSize: 13, fontFace: FONT_BODY, color: valueColor, bold: true, margin: 0 });
    s7.addText(m.note, { x: mx + 0.15, y: metY + 0.75, w: 2.5, h: 0.3, fontSize: 10, fontFace: FONT_BODY, color: C.dimText, margin: 0 });
  });

  // ============================================================
  // SLIDE 8: CASE 3 - FROG Timeline
  // ============================================================
  let s8 = pres.addSlide();
  s8.background = { color: C.bg };
  s8.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.green } });

  s8.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fill: { color: C.green } });
  s8.addText("CASE 3", { x: 0.8, y: 0.25, w: 1.2, h: 0.4, fontSize: 12, fontFace: FONT_BODY, color: C.bg, bold: true, align: "center", valign: "middle", margin: 0 });
  s8.addText("FROG: Best Execution, Worst Patience", {
    x: 2.2, y: 0.25, w: 7, h: 0.4, fontSize: 22, fontFace: FONT_TITLE, color: C.white, bold: true, valign: "middle", margin: 0
  });

  const frogEvents = [
    { time: "07:02", who: "HOLLY", desc: "Alert fires: Breakdown Short @ $53.94, stop $55.56", color: C.green },
    { time: "", who: "", desc: "3 hours pass...", color: C.dimText },
    { time: "10:02", who: "YOU", desc: "SELL SHORT 100 shares @ $53.88 (better price than Holly!)", color: C.blue },
    { time: "10:43", who: "YOU", desc: "BUY TO COVER 100 sh @ $51.50 (+$2.38/sh, 41 min hold)", color: C.teal },
    { time: "", who: "", desc: "2 hours 12 minutes pass... stock keeps falling...", color: C.dimText },
    { time: "12:56", who: "HOLLY", desc: "Exits @ $52.07 (+$1.87/sh, 354 min hold)", color: C.green },
  ];

  const frogTlY = 0.95;
  frogEvents.forEach((evt, i) => {
    const y = frogTlY + i * 0.55;
    if (evt.who === "") {
      s8.addText(evt.desc, { x: 2.2, y: y, w: 6, h: 0.5, fontSize: 11, fontFace: FONT_BODY, color: C.dimText, italic: true, valign: "middle", margin: 0 });
      return;
    }
    s8.addText(evt.time, { x: 0.8, y: y, w: 0.8, h: 0.5, fontSize: 13, fontFace: "Consolas", color: C.muted, valign: "middle", margin: 0 });
    const bc = evt.who === "HOLLY" ? C.green : C.blue;
    s8.addShape(pres.shapes.RECTANGLE, { x: 1.7, y: y + 0.1, w: 0.9, h: 0.3, fill: { color: bc } });
    s8.addText(evt.who, { x: 1.7, y: y + 0.1, w: 0.9, h: 0.3, fontSize: 9, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
    s8.addText(evt.desc, { x: 2.8, y: y, w: 6.5, h: 0.5, fontSize: 12, fontFace: FONT_BODY, color: evt.color, valign: "middle", margin: 0 });
  });

  // Paradox box
  const paradoxY = 4.1;
  s8.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: paradoxY, w: 8.4, h: 1.1, fill: { color: "0D2818" }, shadow: cardShadow() });
  addIconDot(s8, pres, 1.05, paradoxY + 0.12, "*", C.green);
  s8.addText("THE PARADOX", { x: 1.5, y: paradoxY + 0.05, w: 3, h: 0.35, fontSize: 14, fontFace: FONT_BODY, color: C.green, bold: true, margin: 0 });
  s8.addText([
    { text: "You actually beat Holly per-share ($2.38 vs $1.87 = 127% capture). ", options: {} },
    { text: "Your short entry was better, your exit was more profitable per share. ", options: {} },
    { text: "But you left $1,214 on the table by exiting 2h12m early. ", options: { bold: true, color: C.accent } },
    { text: "This trade proves you CAN execute well. The gap is patience, not skill.", options: {} },
  ], { x: 1.0, y: paradoxY + 0.4, w: 8.0, h: 0.65, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });

  // ============================================================
  // SLIDE 9: PATTERNS ACROSS ALL 3
  // ============================================================
  let s9 = pres.addSlide();
  s9.background = { color: C.bg };
  s9.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  s9.addText("Common Patterns Across All 3 Cases", {
    x: 0.8, y: 0.3, w: 8, h: 0.6,
    fontSize: 28, fontFace: FONT_TITLE, color: C.white, bold: true, margin: 0
  });

  // Pattern cards - 2x2 grid
  const patterns = [
    {
      dot: "T", title: "EARLY EXIT",
      desc: "BE: 3 min hold (Holly: 342 min)\nFROG: 41 min hold (Holly: 354 min)\nYou exit 66% of the time before Holly",
      color: C.accent
    },
    {
      dot: "!", title: "STOP DISCIPLINE",
      desc: "ZONE: $0.43 past Holly's stop\n14 trades total blew through stops\nExtra damage: $919 across portfolio",
      color: C.red
    },
    {
      dot: "S", title: "OVERSIZING ON RISK",
      desc: "ZONE: 1000 shares (Holly: 100)\nBE: 25 shares (missed the upside)\nAvg losers: 246 sh vs winners: 159 sh",
      color: C.red
    },
    {
      dot: "E", title: "ENTRY IS FINE",
      desc: "BE: $27.94 vs Holly $27.95 (perfect)\nFROG: $53.88 vs Holly $53.94 (better!)\nEntry is NOT the problem. Exits are.",
      color: C.green
    },
  ];

  patterns.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const px = 0.5 + col * 4.7;
    const py = 1.1 + row * 2.15;

    s9.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: 4.3, h: 1.85, fill: { color: C.bgCard }, shadow: cardShadow() });
    s9.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: 0.08, h: 1.85, fill: { color: p.color } });
    addIconDot(s9, pres, px + 0.25, py + 0.15, p.dot, p.color);
    s9.addText(p.title, { x: px + 0.65, y: py + 0.12, w: 3.3, h: 0.35, fontSize: 15, fontFace: FONT_BODY, color: p.color, bold: true, margin: 0 });
    s9.addText(p.desc, { x: px + 0.25, y: py + 0.55, w: 3.8, h: 1.05, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });
  });

  // ============================================================
  // SLIDE 10: ACTIONABLE RULES
  // ============================================================
  let s10 = pres.addSlide();
  s10.background = { color: C.bg };
  s10.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  s10.addText("6 Rules From the Data", {
    x: 0.8, y: 0.25, w: 8, h: 0.6,
    fontSize: 28, fontFace: FONT_TITLE, color: C.white, bold: true, margin: 0
  });

  s10.addText("Derived from 89 matched trades, 25 analysis dimensions, 3 case studies", {
    x: 0.8, y: 0.8, w: 8, h: 0.3,
    fontSize: 12, fontFace: FONT_BODY, color: C.muted, margin: 0
  });

  const rules = [
    { num: "1", title: "Hold longer on winners", desc: "Trail stop from Holly's level. Don't discretionary cut.", impact: "+$4,214 what-if", color: C.green },
    { num: "2", title: "Honor Holly's stop price", desc: "Hard stop. No override. 14 blown stops cost $1,978.", impact: "+$919 saved", color: C.red },
    { num: "3", title: "Cap at 100 shares", desc: "Match Holly's sizing until exit discipline improves.", impact: "+$1,347 what-if", color: C.blue },
    { num: "4", title: "Skip stocks under $5", desc: "Penny stocks: 33% WR, -$925 total. Not worth it.", impact: "+$925 saved", color: C.accent },
    { num: "5", title: "Walk away after big loss", desc: "After >$50 loss, WR drops to 23%. Stop for the day.", impact: "Prevents tilt", color: C.purple },
    { num: "6", title: "Focus on 2 strategies", desc: "Mighty Mouse (78% WR) + Breakdown Short (55% WR).", impact: "Reduce noise", color: C.teal },
  ];

  rules.forEach((r, i) => {
    const ry = 1.2 + i * 0.68;
    // Number circle
    s10.addShape(pres.shapes.OVAL, { x: 0.8, y: ry + 0.08, w: 0.42, h: 0.42, fill: { color: r.color } });
    s10.addText(r.num, { x: 0.8, y: ry + 0.08, w: 0.42, h: 0.42, fontSize: 16, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });

    // Title
    s10.addText(r.title, { x: 1.4, y: ry, w: 4.5, h: 0.3, fontSize: 15, fontFace: FONT_BODY, color: C.white, bold: true, margin: 0 });
    // Desc
    s10.addText(r.desc, { x: 1.4, y: ry + 0.3, w: 5.5, h: 0.3, fontSize: 11, fontFace: FONT_BODY, color: C.muted, margin: 0 });
    // Impact badge
    s10.addShape(pres.shapes.RECTANGLE, { x: 7.8, y: ry + 0.1, w: 1.6, h: 0.38, fill: { color: r.color } });
    s10.addText(r.impact, { x: 7.8, y: ry + 0.1, w: 1.6, h: 0.38, fontSize: 10, fontFace: FONT_BODY, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
  });

  // ============================================================
  // SLIDE 11: CLOSING
  // ============================================================
  let s11 = pres.addSlide();
  s11.background = { color: C.bg };
  s11.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });

  s11.addText("The Bottom Line", {
    x: 0.8, y: 0.8, w: 8, h: 0.8,
    fontSize: 36, fontFace: FONT_TITLE, color: C.white, bold: true, margin: 0
  });

  s11.addShape(pres.shapes.LINE, { x: 0.8, y: 1.7, w: 3, h: 0, line: { color: C.accent, width: 2 } });

  s11.addText([
    { text: "You pick winners at the same rate as Holly.\n", options: { fontSize: 20, color: C.white } },
    { text: "The $38,788 gap is entirely exit execution.\n\n", options: { fontSize: 20, color: C.accent, bold: true } },
    { text: "Cut winners early. Let losers run. Oversize on bad trades.\n", options: { fontSize: 16, color: C.muted } },
    { text: "Reverse those three habits and the math flips.\n\n", options: { fontSize: 16, color: C.muted } },
    { text: "FROG proves the skill is there.\n", options: { fontSize: 16, color: C.green, bold: true } },
    { text: "127% per-share capture on your best trade.\n", options: { fontSize: 16, color: C.muted } },
    { text: "The edge isn't picking. It's patience.", options: { fontSize: 18, color: C.accent, bold: true } },
  ], { x: 0.8, y: 2.0, w: 8.4, h: 3.2, fontFace: FONT_BODY, margin: 0, paraSpaceAfter: 2 });

  // Bottom accent
  s11.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.565, w: 10, h: 0.06, fill: { color: C.accent } });

  // ============================================================
  // WRITE FILE
  // ============================================================
  await pres.writeFile({ fileName: OUTPUT });
  console.log("Deck saved to:", OUTPUT);
}

build().catch(err => { console.error(err); process.exit(1); });
