/**
 * Draw Steel Handbook Credits Widget
 *
 * The Handbook's last chapter: a cut-paper stage where the nine classes, in
 * plain white masks, take a bow for the team that made the game; the MCDM
 * team by role; where to buy the books; the Creator License notice word for
 * word; where the rules come from; and who made this package. "Roll the
 * credits" plays it as film end titles over the whole Chronicle window.
 *
 * The names and the rule counts come from data/credits.json. All art is drawn
 * for this package: no MCDM art or logo appears, and nothing here may suggest
 * the package is official. The pure helpers live in `Credits` below and are
 * exported for tools/test-handbook-credits.mjs.
 */
(function () {
  'use strict';

  var SHOP = 'https://shop.mcdmproductions.com/collections/draw-steel';
  var LICENCE = 'https://www.mcdmproductions.com/draw-steel-creator-license';
  // The Creator License asks for this notice word for word; never reword it.
  var NOTICE = 'Chronicle Draw Steel is an independent product published under the DRAW STEEL Creator License ' +
    'and is not affiliated with MCDM Productions, LLC. DRAW STEEL © 2026 MCDM Productions, LLC.';
  // End titles move at a steady reading speed, so a longer roll takes longer, not faster.
  var PX_PER_S = 70;
  var FAST = 5;

  function teamFrom(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(function (it) {
      return it && it.properties && it.properties.group === 'mcdm-team' && typeof it.name === 'string' && it.name &&
        typeof it.properties.role === 'string' && it.properties.role;
    }).sort(function (a, b) { return (a.properties.order || 0) - (b.properties.order || 0); })
      .map(function (it) { return { name: it.name, role: it.properties.role }; });
  }

  function tallyFrom(data) {
    var row = null;
    if (Array.isArray(data)) {
      data.forEach(function (it) { if (it && it.slug === 'rules-tally' && it.properties) row = it.properties; });
    }
    if (!row) return null;
    var keys = ['abilities', 'ancestries', 'kits', 'animal_traits'];
    for (var i = 0; i < keys.length; i++) {
      if (typeof row[keys[i]] !== 'number' || row[keys[i]] < 0) return null;
    }
    return { abilities: row.abilities, ancestries: row.ancestries, kits: row.kits, animalTraits: row.animal_traits };
  }

  var Credits = { teamFrom: teamFrom, tallyFrom: tallyFrom, NOTICE: NOTICE, SHOP: SHOP, PX_PER_S: PX_PER_S, FAST: FAST };
  if (typeof window !== 'undefined') window.ChronicleDrawSteelCredits = Credits;
  if (typeof module !== 'undefined' && module.exports) module.exports = Credits;

  // ── UI ──────────────────────────────────────────────────────

  if (typeof Chronicle === 'undefined' || !Chronicle || typeof Chronicle.register !== 'function') return;

  var STYLE_ID = 'hbc-style';
  var DEFS_ID = 'hbc-defs';
  // Gradients, filters and the nine masked figures, shared by every stage.
  var DEFS = '<linearGradient id="hbc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22103e"/><stop offset="' +
    '.38" stop-color="#7a2459"/><stop offset=".62" stop-color="#e0573a"/><stop offset=".8" stop-color="#f6a23a"/></' +
    'linearGradient><radialGradient id="hbc-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff2b0"/><sto' +
    'p offset=".55" stop-color="#ffd04a"/><stop offset="1" stop-color="#ffb43a" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="hbc-blade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd27a"/><stop offset' +
    '="1" stop-color="#ffffff"/></linearGradient><radialGradient id="hbc-spot" cx=".5" cy="1" r=".75"><stop offset=' +
    '"0" stop-color="#ffe7a0" stop-opacity=".55"/><stop offset="1" stop-color="#ffe7a0" stop-opacity="0"/></radialG' +
    'radient><linearGradient id="hbc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1428"/><stop' +
    ' offset="1" stop-color="#3a1c2c"/></linearGradient><linearGradient id="hbc-drape" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#5e0f19"/><stop offset=".5" stop-color="#b22533"/><stop offset="1" stop-color="#5' +
    'e0f19"/></linearGradient><filter id="hbc-cut" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2' +
    '.5" dy="3" stdDeviation=".8" flood-color="#000" flood-opacity=".55"/></filter><filter id="hbc-glow" x="-80%" y' +
    '="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode/><feMergeNode in="S' +
    'ourceGraphic"/></feMerge></filter><!-- the nine classes in masks: the team behind the game, taking a bow --><s' +
    'ymbol id="hbc-m-censor-legs" overflow="visible"><rect x="-11" y="0" width="9" height="46" fill="#2a2230"/><rec' +
    't x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v8h-15zM1 42h12l3 8H1z" fill="#15171d"/' +
    '></symbol><symbol id="hbc-m-censor-top" overflow="visible"><path d="M-17 -58h34l7 58h-48z" fill="#b8862a"/><pa' +
    'th d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#b8862a"/><rect x="-17" y="-8" width="34" height="' +
    '5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBox="0 0 100 100"><circle cx="50" cy="50" r=' +
    '"30" fill="#f0bb4f"/><g fill="#f0bb4f"><path d="M50 6l5 14H45z"/><path d="M50 94l-5-14h10z"/><path d="M6 50l14' +
    '-5v10z"/><path d="M94 50l-14 5V45z"/></g><path d="M28 50c8-12 36-12 44 0-8 12-36 12-44 0z" fill="#fff8e6"/><ci' +
    'rcle cx="50" cy="50" r="8" fill="#3d0b15"/></svg><circle cy="-72" r="11" fill="#c99a74"/><path d="M-11 -76c0-6' +
    ' 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stro' +
    'ke-width="2.2" stroke-linecap="round"/><path d="M-2 -84c4-14 16-16 20-10-8 0-14 4-16 12z" fill="#c22f39"/></sy' +
    'mbol><symbol id="hbc-m-conduit-legs" overflow="visible"><rect x="-11" y="0" width="9" height="46" fill="#2a223' +
    '0"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v8h-15zM1 42h12l3 8H1z" fill="#' +
    '15171d"/></symbol><symbol id="hbc-m-conduit-top" overflow="visible"><path d="M-17 -58h34l7 58h-48z" fill="#d0a' +
    '23a"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#d0a23a"/><rect x="-17" y="-8" width="34"' +
    ' height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBox="0 0 100 100"><path d="M50 8l8 ' +
    '28 28 8-28 8-8 28-8-28-28-8 28-8z" fill="#ffe27a"/><circle cx="50" cy="44" r="10" fill="#fff8e6"/><path d="M30' +
    ' 92c4-16 36-16 40 0z" fill="#d0a23a"/></svg><circle cy="-72" r="11" fill="#e8b48f"/><path d="M-11 -76c0-6 22-6' +
    ' 22 0 0 9-5 14-11 14s-11-5-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-wi' +
    'dth="2.2" stroke-linecap="round"/><circle cy="-74" r="17" fill="none" stroke="#f0bb4f" stroke-width="3" filter' +
    '="url(#hbc-glow)"/></symbol><symbol id="hbc-m-elementalist-legs" overflow="visible"><rect x="-11" y="0" width=' +
    '"9" height="46" fill="#2a2230"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v8h' +
    '-15zM1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-elementalist-top" overflow="visible"><path d="' +
    'M-17 -58h34l7 58h-48z" fill="#1d8f80"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#1d8f80"' +
    '/><rect x="-17" y="-8" width="34" height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBo' +
    'x="0 0 100 100"><path d="M50 8c14 18 26 30 26 50a26 26 0 0 1-52 0c0-10 6-18 12-24 0 10 4 16 10 18-4-16 0-30 4-' +
    '44z" fill="#4fc0bf"/><path d="M50 46c8 10 12 16 12 24a12 12 0 0 1-24 0c0-8 6-14 12-24z" fill="#f6a23a"/></svg>' +
    '<circle cy="-72" r="11" fill="#8d5a3b"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" fill="#f4' +
    'f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-linecap="round"/><path d="M' +
    '26 -30c-8-6-4-14 0-20 2 6 8 10 0 20z" fill="#4fc0bf" filter="url(#hbc-glow)"/></symbol><symbol id="hbc-m-fury-' +
    'legs" overflow="visible"><rect x="-11" y="0" width="9" height="46" fill="#2a2230"/><rect x="2" y="0" width="9"' +
    ' height="46" fill="#2a2230"/><path d="M-13 42h12v8h-15zM1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="h' +
    'bc-m-fury-top" overflow="visible"><path d="M-17 -58h34l7 58h-48z" fill="#c22f39"/><path d="M-17 -56l-7 44 6 2 ' +
    '6-30zM17 -56l7 44-6 2-6-30z" fill="#c22f39"/><rect x="-17" y="-8" width="34" height="5" fill="#2a2230"/><svg x' +
    '="-9" y="-48" width="18" height="18" viewBox="0 0 100 100"><g fill="#e2545d"><path d="M22 12l14 4-6 74-10-4z"/' +
    '><path d="M46 8l14 4-6 82-10-4z"/><path d="M70 12l12 6-10 70-8-4z"/></g></svg><circle cy="-72" r="11" fill="#d' +
    '9b48f"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -7' +
    '4l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-linecap="round"/><path d="M-10 -82l-8-12 12 6zM10 -82l8-12-' +
    '12 6z" fill="#e8e2d6"/></symbol><symbol id="hbc-m-null-legs" overflow="visible"><rect x="-11" y="0" width="9" ' +
    'height="46" fill="#2a2230"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v8h-15z' +
    'M1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-null-top" overflow="visible"><path d="M-17 -58h34l' +
    '7 58h-48z" fill="#5d6f8c"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#5d6f8c"/><rect x="-' +
    '17" y="-8" width="34" height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBox="0 0 100 1' +
    '00"><circle cx="50" cy="50" r="38" fill="none" stroke="#a7b4cc" stroke-width="7"/><path d="M34 70V36c0-4 6-4 6' +
    ' 0v18-24c0-4 6-4 6 0v24-28c0-4 6-4 6 0v28-24c0-4 6-4 6 0v30c0 10-6 18-14 18-6 0-12-4-16-12z" fill="#e8ebf0"/><' +
    '/svg><circle cy="-72" r="11" fill="#b07a52"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" fill' +
    '="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-linecap="round"/><path' +
    ' d="M-14 -66c-4-22 6-32 14-32s18 10 14 32l-4-14h-20z" fill="#3c4a63"/></symbol><symbol id="hbc-m-shadow-legs" ' +
    'overflow="visible"><rect x="-11" y="0" width="9" height="46" fill="#2a2230"/><rect x="2" y="0" width="9" heigh' +
    't="46" fill="#2a2230"/><path d="M-13 42h12v8h-15zM1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-s' +
    'hadow-top" overflow="visible"><path d="M-17 -58h34l7 58h-48z" fill="#4a3d6e"/><path d="M-17 -56l-7 44 6 2 6-30' +
    'zM17 -56l7 44-6 2-6-30z" fill="#4a3d6e"/><rect x="-17" y="-8" width="34" height="5" fill="#2a2230"/><svg x="-9' +
    '" y="-48" width="18" height="18" viewBox="0 0 100 100"><path d="M64 14a34 34 0 1 0 22 54A28 28 0 1 1 64 14z" f' +
    'ill="#c9b8f0"/><path d="M30 82l34-46 4 4-34 46z" fill="#e8ebf0"/><path d="M26 86l6-10 6 4-6 10z" fill="#3a2a1e' +
    '"/></svg><circle cy="-72" r="11" fill="#e8c3a0"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" ' +
    'fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-linecap="round"/><' +
    'path d="M-15 -64c-4-24 7-36 15-36s19 12 15 36l-5-16h-20z" fill="#2a2140"/><path d="M-24 -20l-6 18" stroke="#e8' +
    'ebf0" stroke-width="3"/></symbol><symbol id="hbc-m-tactician-legs" overflow="visible"><rect x="-11" y="0" widt' +
    'h="9" height="46" fill="#2a2230"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v' +
    '8h-15zM1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-tactician-top" overflow="visible"><path d="M' +
    '-17 -58h34l7 58h-48z" fill="#2f6fae"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#2f6fae"/' +
    '><rect x="-17" y="-8" width="34" height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBox' +
    '="0 0 100 100"><path d="M28 8h6v86h-6z" fill="#e8ebf0"/><path d="M34 12h46l-10 14 10 14H34z" fill="#2f6fae"/><' +
    'path d="M34 12h46l-10 14 10 14H34z" fill="none" stroke="#f0bb4f" stroke-width="3"/><circle cx="56" cy="26" r="' +
    '5" fill="#f0bb4f"/></svg><circle cy="-72" r="11" fill="#6e4428"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 1' +
    '4s-11-5-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-li' +
    'necap="round"/><path d="M20 -100v70" stroke="#8a6a4a" stroke-width="3"/><path d="M21 -100h18l-5 7 5 7h-18z" fi' +
    'll="#2f6fae"/></symbol><symbol id="hbc-m-talent-legs" overflow="visible"><rect x="-11" y="0" width="9" height=' +
    '"46" fill="#2a2230"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="M-13 42h12v8h-15zM1 42h1' +
    '2l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-talent-top" overflow="visible"><path d="M-17 -58h34l7 58h' +
    '-48z" fill="#7a4d8f"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fill="#7a4d8f"/><rect x="-17" y' +
    '="-8" width="34" height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height="18" viewBox="0 0 100 100"><' +
    'circle cx="50" cy="52" r="16" fill="#e7d4ff"/><circle cx="50" cy="52" r="6" fill="#3a2350"/><g fill="none" str' +
    'oke="#c9a8ef" stroke-width="4"><circle cx="50" cy="52" r="27"/><circle cx="50" cy="52" r="38" stroke-dasharray' +
    '="6 7"/></g></svg><circle cy="-72" r="11" fill="#c99a74"/><path d="M-11 -76c0-6 22-6 22 0 0 9-5 14-11 14s-11-5' +
    '-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418" stroke-width="2.2" stroke-linecap="' +
    'round"/><g fill="#e7d4ff" filter="url(#hbc-glow)"><circle cx="-16" cy="-98" r="3"/><circle cy="-104" r="3"/><c' +
    'ircle cx="16" cy="-98" r="3"/></g></symbol><symbol id="hbc-m-troubadour-legs" overflow="visible"><rect x="-11"' +
    ' y="0" width="9" height="46" fill="#2a2230"/><rect x="2" y="0" width="9" height="46" fill="#2a2230"/><path d="' +
    'M-13 42h12v8h-15zM1 42h12l3 8H1z" fill="#15171d"/></symbol><symbol id="hbc-m-troubadour-top" overflow="visible' +
    '"><path d="M-17 -58h34l7 58h-48z" fill="#cf6a1a"/><path d="M-17 -56l-7 44 6 2 6-30zM17 -56l7 44-6 2-6-30z" fil' +
    'l="#cf6a1a"/><rect x="-17" y="-8" width="34" height="5" fill="#2a2230"/><svg x="-9" y="-48" width="18" height=' +
    '"18" viewBox="0 0 100 100"><path d="M20 22c18 6 40 6 58 0 0 30-8 52-29 58C28 74 20 52 20 22z" fill="#f4f1ea"/>' +
    '<path d="M34 40c4-4 10-4 12 0M54 40c4-4 10-4 12 0" stroke="#3d0b15" stroke-width="4" fill="none" stroke-lineca' +
    'p="round"/><path d="M36 58c8 10 20 10 28 0" stroke="#3d0b15" stroke-width="4" fill="none" stroke-linecap="roun' +
    'd"/><path d="M78 22l10-8 2 12z" fill="#cf6a1a"/></svg><circle cy="-72" r="11" fill="#e8b48f"/><path d="M-11 -7' +
    '6c0-6 22-6 22 0 0 9-5 14-11 14s-11-5-11-14z" fill="#f4f1ea"/><path d="M-7 -74l5 1M7 -74l-5 1" stroke="#1c1418"' +
    ' stroke-width="2.2" stroke-linecap="round"/><path d="M-16 -82h32l-4-8h-24z" fill="#cf6a1a"/><path d="M8 -90c8-' +
    '12 18-14 22-12-8 2-14 8-18 14z" fill="#f4f1ea"/></symbol><!-- the lit stage, shared by the page and the end of' +
    ' the roll -->';
  // The stage: drapes, footlights, the banner and the cast taking a bow.
  var STAGE = '<rect width="640" height="440" fill="url(#hbc-wall)"/><g class="hbc-beams"><path d="M150 0L60 392h190z" fill="' +
    'url(#hbc-spot)" opacity=".5"/><path d="M320 0L220 392h200z" fill="url(#hbc-spot)" opacity=".7"/><path d="M490 ' +
    '0L390 392h190z" fill="url(#hbc-spot)" opacity=".5"/></g><path d="M0 392h640v48H0z" fill="#3b2a22"/><path d="M0' +
    ' 392h640" stroke="#e1a32c" stroke-width="3"/><g stroke="#2a1d17" stroke-width="2"><path d="M0 408h640M0 424h64' +
    '0M80 392v16M210 408v16M350 392v16M470 408v16M590 392v16M140 424v16M420 424v16"/></g><ellipse cx="320" cy="396"' +
    ' rx="250" ry="10" fill="#000" opacity=".35"/><g filter="url(#hbc-cut)" text-anchor="middle" font-family="Big S' +
    'houlders Display, Oswald, Impact, sans-serif" font-weight="900"><text x="320" y="152" font-size="18" letter-sp' +
    'acing="8" fill="#f0bb4f">THE PEOPLE WHO MADE</text><text x="320" y="206" font-size="56" letter-spacing="3" fil' +
    'l="#f4f1ea">THE GAME</text><path d="M236 222h168" stroke="#c22f39" stroke-width="4"/><text x="320" y="250" fon' +
    't-size="19" letter-spacing="6" fill="#f4f1ea">MCDM PRODUCTIONS</text><g fill="#f0bb4f"><path d="M170 176l5 10 ' +
    '11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z"/><path d="M470 176l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z"/></g><' +
    '/g><g class="hbc-cast"><g transform="translate(124 340) scale(.92)"><use href="#hbc-m-censor-legs" filter="url' +
    '(#hbc-cut)"/><g class="hbc-bow" style="--d:0.00s"><use href="#hbc-m-censor-top" filter="url(#hbc-cut)"/></g></' +
    'g><g transform="translate(173 340) scale(.92)"><use href="#hbc-m-conduit-legs" filter="url(#hbc-cut)"/><g clas' +
    's="hbc-bow" style="--d:0.10s"><use href="#hbc-m-conduit-top" filter="url(#hbc-cut)"/></g></g><g transform="tra' +
    'nslate(222 340) scale(.92)"><use href="#hbc-m-elementalist-legs" filter="url(#hbc-cut)"/><g class="hbc-bow" st' +
    'yle="--d:0.20s"><use href="#hbc-m-elementalist-top" filter="url(#hbc-cut)"/></g></g><g transform="translate(27' +
    '1 340) scale(.92)"><use href="#hbc-m-fury-legs" filter="url(#hbc-cut)"/><g class="hbc-bow" style="--d:0.30s"><' +
    'use href="#hbc-m-fury-top" filter="url(#hbc-cut)"/></g></g><g transform="translate(320 340) scale(.92)"><use h' +
    'ref="#hbc-m-null-legs" filter="url(#hbc-cut)"/><g class="hbc-bow" style="--d:0.40s"><use href="#hbc-m-null-top' +
    '" filter="url(#hbc-cut)"/></g></g><g transform="translate(369 340) scale(.92)"><use href="#hbc-m-shadow-legs" ' +
    'filter="url(#hbc-cut)"/><g class="hbc-bow" style="--d:0.50s"><use href="#hbc-m-shadow-top" filter="url(#hbc-cu' +
    't)"/></g></g><g transform="translate(418 340) scale(.92)"><use href="#hbc-m-tactician-legs" filter="url(#hbc-c' +
    'ut)"/><g class="hbc-bow" style="--d:0.60s"><use href="#hbc-m-tactician-top" filter="url(#hbc-cut)"/></g></g><g' +
    ' transform="translate(467 340) scale(.92)"><use href="#hbc-m-talent-legs" filter="url(#hbc-cut)"/><g class="hb' +
    'c-bow" style="--d:0.70s"><use href="#hbc-m-talent-top" filter="url(#hbc-cut)"/></g></g><g transform="translate' +
    '(516 340) scale(.92)"><use href="#hbc-m-troubadour-legs" filter="url(#hbc-cut)"/><g class="hbc-bow" style="--d' +
    ':0.80s"><use href="#hbc-m-troubadour-top" filter="url(#hbc-cut)"/></g></g></g><g filter="url(#hbc-cut)"><path ' +
    'd="M0 0h96c-10 120 6 260 -20 392H0z" fill="url(#hbc-drape)"/><path d="M28 0c4 140 -6 260 6 392M60 0c-6 130 8 2' +
    '60 -4 392" stroke="#4a0b14" stroke-width="3" fill="none"/><path d="M640 0H544c10 120 -6 260 20 392h76z" fill="' +
    'url(#hbc-drape)"/><path d="M612 0c-4 140 6 260 -6 392M580 0c6 130 -8 260 4 392" stroke="#4a0b14" stroke-width=' +
    '"3" fill="none"/><path d="M0 0h640v34c-20 0-20 18-40 18s-20-18-40-18-20 18-40 18-20-18-40-18-20 18-40 18-20-18' +
    '-40-18-20 18-40 18-20-18-40-18-20 18-40 18-20-18-40-18-20 18-40 18-20-18-40-18-20 18-40 18-20-18-40-18-20 18-4' +
    '0 18-20-18-40-18-20 18-40 18z" fill="#8e1f28"/><path d="M0 34c20 0 20 18 40 18s20-18 40-18 20 18 40 18 20-18 4' +
    '0-18 20 18 40 18 20-18 40-18 20 18 40 18 20-18 40-18 20 18 40 18 20-18 40-18 20 18 40 18 20-18 40-18 20 18 40 ' +
    '18 20-18 40-18 20 18 40 18 20-18 40-18" stroke="#e1a32c" stroke-width="3" fill="none"/></g><g filter="url(#hbc' +
    '-cut)" transform="translate(320 92)"><path d="M-200 -26h400l-18 26 18 26h-400l18-26z" fill="#e9b84a"/><path d=' +
    '"M-176 -20h352v40h-352z" fill="none" stroke="#7a4b08" stroke-width="1.5" stroke-dasharray="5 4"/><text y="13" ' +
    'text-anchor="middle" font-family="Big Shoulders Display, Oswald, Impact, sans-serif" font-weight="900" font-si' +
    'ze="32" letter-spacing="5" fill="#3d0b15">THANK YOU, MCDM</text></g><g class="hbc-confetti"><rect class="hbc-c' +
    '" x="275" y="168" width="8" height="5" fill="#f4f1ea" style="--d:3.88s;--x:13px" transform="rotate(114 275 168' +
    ')"/><rect class="hbc-c" x="134" y="148" width="9" height="3" fill="#f4f1ea" style="--d:4.30s;--x:26px" transfo' +
    'rm="rotate(171 134 148)"/><rect class="hbc-c" x="297" y="279" width="5" height="5" fill="#f4f1ea" style="--d:0' +
    '.14s;--x:-1px" transform="rotate(90 297 279)"/><rect class="hbc-c" x="219" y="139" width="5" height="4" fill="' +
    '#e9b84a" style="--d:3.67s;--x:1px" transform="rotate(15 219 139)"/><rect class="hbc-c" x="324" y="147" width="' +
    '6" height="3" fill="#e9b84a" style="--d:4.61s;--x:-22px" transform="rotate(63 324 147)"/><rect class="hbc-c" x' +
    '="392" y="238" width="5" height="5" fill="#e2545d" style="--d:2.35s;--x:25px" transform="rotate(127 392 238)"/' +
    '><rect class="hbc-c" x="173" y="187" width="9" height="3" fill="#f0bb4f" style="--d:1.00s;--x:-5px" transform=' +
    '"rotate(140 173 187)"/><rect class="hbc-c" x="405" y="279" width="8" height="3" fill="#f4f1ea" style="--d:5.30' +
    's;--x:22px" transform="rotate(110 405 279)"/><rect class="hbc-c" x="223" y="141" width="9" height="3" fill="#4' +
    'fc0bf" style="--d:1.67s;--x:-4px" transform="rotate(91 223 141)"/><rect class="hbc-c" x="258" y="237" width="6' +
    '" height="5" fill="#e2545d" style="--d:5.75s;--x:-21px" transform="rotate(21 258 237)"/><rect class="hbc-c" x=' +
    '"170" y="276" width="7" height="5" fill="#e9b84a" style="--d:0.91s;--x:12px" transform="rotate(59 170 276)"/><' +
    'rect class="hbc-c" x="527" y="304" width="6" height="3" fill="#f0bb4f" style="--d:2.91s;--x:7px" transform="ro' +
    'tate(46 527 304)"/><rect class="hbc-c" x="407" y="276" width="6" height="4" fill="#f4f1ea" style="--d:1.69s;--' +
    'x:-21px" transform="rotate(107 407 276)"/><rect class="hbc-c" x="159" y="270" width="5" height="5" fill="#4fc0' +
    'bf" style="--d:2.22s;--x:6px" transform="rotate(81 159 270)"/><rect class="hbc-c" x="140" y="288" width="6" he' +
    'ight="4" fill="#e9b84a" style="--d:4.14s;--x:2px" transform="rotate(158 140 288)"/><rect class="hbc-c" x="458"' +
    ' y="266" width="8" height="4" fill="#f0bb4f" style="--d:2.74s;--x:25px" transform="rotate(174 458 266)"/><rect' +
    ' class="hbc-c" x="348" y="279" width="8" height="4" fill="#4fc0bf" style="--d:2.35s;--x:-5px" transform="rotat' +
    'e(100 348 279)"/><rect class="hbc-c" x="263" y="193" width="6" height="5" fill="#f0bb4f" style="--d:2.89s;--x:' +
    '-5px" transform="rotate(15 263 193)"/><rect class="hbc-c" x="509" y="192" width="5" height="5" fill="#e9b84a" ' +
    'style="--d:0.40s;--x:-17px" transform="rotate(112 509 192)"/><rect class="hbc-c" x="263" y="264" width="8" hei' +
    'ght="4" fill="#e9b84a" style="--d:0.66s;--x:8px" transform="rotate(13 263 264)"/><rect class="hbc-c" x="483" y' +
    '="244" width="7" height="5" fill="#f0bb4f" style="--d:0.00s;--x:-21px" transform="rotate(137 483 244)"/><rect ' +
    'class="hbc-c" x="147" y="160" width="9" height="4" fill="#f0bb4f" style="--d:5.69s;--x:9px" transform="rotate(' +
    '6 147 160)"/><rect class="hbc-c" x="194" y="323" width="7" height="3" fill="#f0bb4f" style="--d:5.25s;--x:9px"' +
    ' transform="rotate(96 194 323)"/><rect class="hbc-c" x="360" y="237" width="5" height="5" fill="#e9b84a" style' +
    '="--d:3.81s;--x:-8px" transform="rotate(154 360 237)"/><rect class="hbc-c" x="149" y="325" width="9" height="5' +
    '" fill="#f4f1ea" style="--d:2.84s;--x:-23px" transform="rotate(124 149 325)"/><rect class="hbc-c" x="514" y="3' +
    '54" width="7" height="4" fill="#e2545d" style="--d:2.88s;--x:-11px" transform="rotate(21 514 354)"/><rect clas' +
    's="hbc-c" x="465" y="219" width="9" height="4" fill="#e9b84a" style="--d:0.61s;--x:-9px" transform="rotate(67 ' +
    '465 219)"/><rect class="hbc-c" x="406" y="334" width="8" height="3" fill="#e2545d" style="--d:4.97s;--x:-20px"' +
    ' transform="rotate(132 406 334)"/><rect class="hbc-c" x="157" y="199" width="8" height="5" fill="#f0bb4f" styl' +
    'e="--d:1.23s;--x:30px" transform="rotate(135 157 199)"/><rect class="hbc-c" x="450" y="146" width="5" height="' +
    '5" fill="#f4f1ea" style="--d:0.88s;--x:4px" transform="rotate(6 450 146)"/></g>';

  function esc(s) { return Chronicle.escapeHtml(s == null ? '' : String(s)); }
  function calm() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function css() {
    return '.hbc { --hbc-ink: var(--rb-ink, #15171d); --hbc-ink2: var(--rb-ink2, #4b5261); --hbc-box: var(--rb-box, #fff); --hbc-rule: var(--rb-edge, #cbd1da); --hbc-red: var(--rb-acc, #c22f39); --hbc-steel: #232833; --hbc-gold: #e1a32c;\n' +
      '  --hbc-head: var(--rb-head, "Big Shoulders Display", Impact, sans-serif); --hbc-body: var(--rb-body, Georgia, serif); --hbc-ui: "Barlow Semi Condensed", var(--rb-ui, system-ui, sans-serif);\n' +
      '  container-type: inline-size; color: var(--hbc-ink); font: 16px/1.55 var(--hbc-body); }\n' +
      '.hbc * { box-sizing: border-box; }\n' +
      '.hbc-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; align-items: start; }\n' +
      '@container (max-width: 760px) { .hbc-grid { grid-template-columns: minmax(0, 1fr); } }\n' +
      '.hbc-call { position: relative; aspect-ratio: 16 / 11; max-width: 100%; border-radius: 4px; overflow: hidden; background: #14121a; }\n' +
      '.hbc-call svg, .hbc-rstage svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n' +
      '.hbc-opener { display: grid; gap: 10px; padding-top: 16px; }\n' +
      '.hbc-kicker { font: 700 12px/1 var(--hbc-ui); letter-spacing: .3em; text-transform: uppercase; color: var(--hbc-red); }\n' +
      '.hbc-opener h3 { margin: 0; font: 900 clamp(48px, 9cqi, 84px)/.85 var(--hbc-head); text-transform: uppercase; letter-spacing: .01em; color: var(--hbc-ink); }\n' +
      '.hbc-opener p { margin: 0; max-width: 46ch; color: var(--hbc-ink2); }\n' +
      '.hbc-rollbtn { justify-self: start; display: inline-flex; gap: 10px; align-items: center; font: 700 15px/1 var(--hbc-ui); letter-spacing: .14em; text-transform: uppercase; background: var(--hbc-red); color: #fff; border: 0; padding: 14px 20px 14px 16px; border-radius: 3px; cursor: pointer; box-shadow: 4px 4px 0 var(--hbc-steel); transition: transform .15s, box-shadow .15s; }\n' +
      '.hbc-rollbtn:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--hbc-steel); }\n' +
      '.hbc-rollbtn:focus-visible, .hbc a:focus-visible, .hbc-roll button:focus-visible, .hbc-roll a:focus-visible { outline: 3px solid var(--hbc-gold); outline-offset: 2px; }\n' +
      '.hbc-rollbtn svg { width: 18px; height: 18px; }\n' +
      '.hbc-sec { padding: 20px 0 6px; border-top: 1px solid var(--hbc-rule); display: grid; gap: 8px; }\n' +
      '.hbc-sec:first-child { border-top: 0; padding-top: 0; }\n' +
      '.hbc-sec h4 { margin: 0; font: 900 26px/1 var(--hbc-head); text-transform: uppercase; letter-spacing: .02em; display: flex; gap: 10px; align-items: baseline; color: var(--hbc-ink); }\n' +
      '.hbc-sec h4 .hbc-n { font: 700 12px/1 var(--hbc-ui); letter-spacing: .2em; color: var(--hbc-red); }\n' +
      '.hbc-sec p { margin: 0; max-width: 62ch; }\n' +
      '.hbc-quiet { color: var(--hbc-ink2); font-size: 14.5px; }\n' +
      '.hbc a { color: inherit; text-decoration-color: var(--hbc-gold); text-underline-offset: 3px; }\n' +
      '.hbc-thanks { font-size: 19px; line-height: 1.5; }\n' +
      '.hbc-team { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 6px 0 4px; }\n' +
      '@container (max-width: 420px) { .hbc-team { grid-template-columns: minmax(0, 1fr); } }\n' +
      '.hbc-tm { display: grid; gap: 3px; align-content: start; }\n' +
      '.hbc-tm span { font: 700 11px/1.3 var(--hbc-ui); letter-spacing: .16em; text-transform: uppercase; color: var(--hbc-red); }\n' +
      '.hbc-tm b { font: 800 23px/1.05 var(--hbc-head); text-transform: uppercase; letter-spacing: .02em; }\n' +
      '.hbc-buy { display: flex; align-items: center; justify-content: space-between; gap: 14px; text-decoration: none; background: var(--hbc-red); color: #fff !important; padding: 14px 18px; border-radius: 3px; box-shadow: 4px 4px 0 var(--hbc-steel); transition: transform .15s, box-shadow .15s; }\n' +
      '.hbc-buy:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--hbc-steel); }\n' +
      '.hbc-buy small { display: block; font: 700 11px/1 var(--hbc-ui); letter-spacing: .22em; text-transform: uppercase; opacity: .85; }\n' +
      '.hbc-buy b { display: block; font: 900 30px/1 var(--hbc-head); text-transform: uppercase; margin: 4px 0 2px; }\n' +
      '.hbc-buy i { font: 600 13px/1 var(--hbc-ui); font-style: normal; letter-spacing: .06em; opacity: .9; }\n' +
      '.hbc-buy svg { width: 28px; height: 28px; flex: none; }\n' +
      '.hbc-notice { position: relative; background: var(--hbc-steel); color: #f4f1ea; padding: 18px 20px 18px 24px; border-radius: 3px; font: 600 15.5px/1.5 var(--hbc-ui); }\n' +
      '.hbc-notice::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--hbc-gold); border-radius: 3px 0 0 3px; }\n' +
      '.hbc-notice span { display: block; font: 700 11px/1 var(--hbc-ui); letter-spacing: .24em; text-transform: uppercase; color: #f0bb4f; margin-bottom: 8px; }\n' +
      '.hbc-books { display: flex; flex-wrap: wrap; gap: 8px; }\n' +
      '.hbc-tag { font: 700 12px/1 var(--hbc-ui); letter-spacing: .1em; text-transform: uppercase; padding: 7px 10px; border-radius: 2px; background: var(--hbc-box); border: 1px solid var(--hbc-rule); }\n' +
      '.hbc-tally { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 4px 0; }\n' +
      '@container (max-width: 420px) { .hbc-tally { grid-template-columns: repeat(2, minmax(0, 1fr)); } }\n' +
      '.hbc-tally div { border: 1.5px solid var(--hbc-ink); border-radius: 3px; padding: 8px 8px 7px; text-align: center; }\n' +
      '.hbc-tally b { display: block; font: 900 30px/1 var(--hbc-head); font-variant-numeric: tabular-nums; }\n' +
      '.hbc-tally span { font: 600 11px/1.2 var(--hbc-ui); letter-spacing: .1em; text-transform: uppercase; color: var(--hbc-ink2); }\n' +
      '.hbc-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }\n' +
      '@container (max-width: 420px) { .hbc-split { grid-template-columns: minmax(0, 1fr); } }\n' +
      '.hbc-split div { background: var(--hbc-box); border: 1px solid var(--hbc-rule); border-radius: 3px; padding: 10px 12px; font-size: 14.5px; }\n' +
      '.hbc-split b { display: block; font: 700 12px/1.2 var(--hbc-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--hbc-red); margin-bottom: 4px; }\n' +
      '.hbc-fonts { display: grid; gap: 4px; }\n' +
      '.hbc-fonts span { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px dashed var(--hbc-rule); padding: 4px 0; font-size: 17px; }\n' +
      '.hbc-fonts i { font: 600 12px/1.6 var(--hbc-ui); font-style: normal; letter-spacing: .08em; text-transform: uppercase; color: var(--hbc-ink2); }\n' +
      '.hbc-f1 { font: 900 20px/1.2 var(--hbc-head) !important; text-transform: uppercase; }\n' +
      '.hbc-f2 { font-family: var(--hbc-ui) !important; font-weight: 600; }\n' +
      '.hbc-problem { color: var(--hbc-ink2); font-style: italic; }\n' +
      '.hbc-confetti .hbc-c { animation: hbc-fall 6s linear var(--d) infinite; opacity: 0; }\n' +
      '@keyframes hbc-fall { 0% { transform: translate(0, -160px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translate(var(--x), 60px); opacity: 0; } }\n' +
      '.hbc-beams { animation: hbc-sweep 7s ease-in-out infinite alternate; }\n' +
      '@keyframes hbc-sweep { from { opacity: .75; } to { opacity: 1; } }\n' +
      '.hbc-roll { --hbc-head: "Big Shoulders Display", Oswald, Impact, sans-serif; --hbc-ui: "Barlow Semi Condensed", system-ui, sans-serif; --hbc-body: "Source Serif 4", Georgia, serif;\n' +
      '  position: fixed; inset: 0; z-index: 2147483000; background: #07080b; color: #ece8df; overflow: hidden; animation: hbc-in .5s ease both; }\n' +
      '.hbc-roll[hidden] { display: none; }\n' +
      '@keyframes hbc-in { from { opacity: 0; } }\n' +
      '.hbc-bar { position: absolute; top: env(safe-area-inset-top, 0px); right: 0; left: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 14px 16px; z-index: 2; }\n' +
      '.hbc-bar button { font: 700 12px/1 var(--hbc-ui); letter-spacing: .16em; text-transform: uppercase; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .25); color: #ece8df; padding: 9px 12px; border-radius: 3px; cursor: pointer; }\n' +
      '.hbc-bar button:hover { background: rgba(255, 255, 255, .16); }\n' +
      '.hbc-bar button[aria-pressed="true"] { background: #f0bb4f; color: #1a1420; border-color: #f0bb4f; }\n' +
      '.hbc-roll::before, .hbc-roll::after { content: ""; position: absolute; left: 0; right: 0; height: 18vh; z-index: 1; pointer-events: none; }\n' +
      '.hbc-roll::before { top: 0; background: linear-gradient(#07080b, transparent); }\n' +
      '.hbc-roll::after { bottom: 0; background: linear-gradient(transparent, #07080b); }\n' +
      '.hbc-reel { position: absolute; left: 0; right: 0; top: 0; padding: 0 16px; display: grid; justify-items: center; text-align: center; will-change: transform; }\n' +
      '.hbc-reel > * { max-width: 640px; width: 100%; }\n' +
      '.hbc-ropen { padding-top: 22vh; padding-bottom: 14vh; }\n' +
      '.hbc-ropen small { font: 700 13px/1 var(--hbc-ui); letter-spacing: .4em; text-transform: uppercase; color: #f0bb4f; }\n' +
      '.hbc-ropen h2 { margin: 14px 0 0; font: 900 clamp(64px, 14vw, 140px)/.85 var(--hbc-head); text-transform: uppercase; letter-spacing: .02em; color: #ece8df; }\n' +
      '.hbc-rb { padding: 7vh 0; display: grid; gap: 10px; }\n' +
      '.hbc-rteam { display: grid; gap: 5vh; }\n' +
      '.hbc-rg { display: grid; gap: 6px; }\n' +
      '.hbc-role { font: 700 12px/1.2 var(--hbc-ui); letter-spacing: .34em; text-transform: uppercase; color: #9aa3b3; }\n' +
      '.hbc-name { font: 900 clamp(34px, 6vw, 56px)/.95 var(--hbc-head); text-transform: uppercase; letter-spacing: .02em; }\n' +
      '.hbc-rg .hbc-name { font-size: clamp(28px, 4.6vw, 44px); }\n' +
      '.hbc-gold { color: #f0bb4f; }\n' +
      '.hbc-line { font: 400 clamp(17px, 2.2vw, 21px)/1.5 var(--hbc-body); color: #d6d1c6; max-width: 34em; margin: 0 auto; }\n' +
      '.hbc-line em { color: #fff; }\n' +
      '.hbc-rule { width: 64px; height: 4px; background: #c22f39; margin: 0 auto; }\n' +
      '.hbc-end { padding: 10vh 0 18vh; display: grid; gap: 22px; justify-items: center; }\n' +
      '.hbc-rstage { position: relative; width: min(640px, 100%); aspect-ratio: 16 / 11; border-radius: 4px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255, 255, 255, .08), 0 30px 80px rgba(194, 47, 57, .25); }\n' +
      '.hbc-rbuy { display: inline-flex; gap: 10px; align-items: center; font: 700 15px/1 var(--hbc-ui); letter-spacing: .14em; text-transform: uppercase; color: #1a1420; background: #f0bb4f; padding: 13px 18px; border-radius: 3px; text-decoration: none; }\n' +
      '.hbc-rnotice { font: 600 14px/1.55 var(--hbc-ui); color: #b9b3a6; max-width: 46em; margin: 0; }\n' +
      '.hbc-again { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }\n' +
      '.hbc-again button { font: 700 14px/1 var(--hbc-ui); letter-spacing: .14em; text-transform: uppercase; border-radius: 3px; padding: 12px 16px; cursor: pointer; border: 1.5px solid #ece8df; background: transparent; color: #ece8df; }\n' +
      '.hbc-again button.hbc-p { background: #c22f39; border-color: #c22f39; }\n' +
      '@media (prefers-reduced-motion: reduce) {\n' +
      '  .hbc-confetti .hbc-c, .hbc-beams { animation: none; }\n' +
      '  .hbc-confetti .hbc-c { opacity: .9; }\n' +
      '  .hbc-rollbtn, .hbc-buy { transition: none; }\n' +
      '  .hbc-roll { animation: none; overflow-y: auto; }\n' +
      '  .hbc-reel { position: static; transform: none !important; }\n' +
      '  .hbc-roll::before, .hbc-roll::after { display: none; }\n' +
      '}\n';
  }

  function injectStyles() {
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    if (!document.getElementById(DEFS_ID)) {
      var holder = document.createElement('div');
      holder.innerHTML = '<svg id="' + DEFS_ID + '" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' + DEFS + '</defs></svg>';
      document.body.appendChild(holder.firstChild);
    }
  }

  function stageSVG() {
    return '<svg viewBox="0 0 640 440" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">' + STAGE + '</svg>';
  }

  // The bow is SMIL rather than CSS: CSS transforms on SVG groups don't repaint
  // reliably everywhere. Reduced motion leaves the cast standing.
  function bow(root) {
    if (calm()) return;
    var bows = root.querySelectorAll('.hbc-bow');
    for (var i = 0; i < bows.length; i++) {
      var g = bows[i];
      var d = parseFloat(g.style.getPropertyValue('--d')) || 0;
      var a = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
      a.setAttribute('attributeName', 'transform');
      a.setAttribute('type', 'scale');
      a.setAttribute('values', '1 1;1 1;1 .7;1 .7;1 1;1 1');
      a.setAttribute('keyTimes', '0;.3;.45;.62;.76;1');
      a.setAttribute('calcMode', 'spline');
      a.setAttribute('keySplines', '0 0 1 1;.5 0 .3 1;0 0 1 1;.5 0 .3 1;0 0 1 1');
      a.setAttribute('dur', '5.5s');
      a.setAttribute('begin', d + 's');
      a.setAttribute('repeatCount', 'indefinite');
      g.appendChild(a);
    }
  }

  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 5l7 7-7 7-1.4-1.4 4.6-4.6H4v-2h12.2l-4.6-4.6z"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l12.5-7.5z"/></svg>';

  function pageHTML(team, tally) {
    var people = team.map(function (p) {
      return '<div class="hbc-tm"><span>' + esc(p.role) + '</span><b>' + esc(p.name) + '</b></div>';
    }).join('');
    var counts = tally ? '<div class="hbc-tally">' +
      '<div><b>' + tally.abilities + '</b><span>Abilities</span></div>' +
      '<div><b>' + tally.ancestries + '</b><span>Ancestries</span></div>' +
      '<div><b>' + tally.kits + '</b><span>Kits</span></div>' +
      '<div><b>' + tally.animalTraits + '</b><span>Animal traits</span></div></div>' : '';
    return '<div class="hbc-grid"><div>' +
        '<div class="hbc-call">' + stageSVG() + '</div>' +
        '<div class="hbc-opener"><span class="hbc-kicker">Thank you, MCDM</span><h3>Credits</h3>' +
        '<p>Draw Steel was made by the team at MCDM Productions. Their names come first, as MCDM print them.</p>' +
        '<button class="hbc-rollbtn" type="button" data-a="roll" aria-haspopup="dialog">' + PLAY + 'Roll the credits</button></div>' +
      '</div><div>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">I</span>The team at MCDM</h4>' +
          '<p class="hbc-quiet">The MCDM Productions team, each with their role, as MCDM print them on the credits page of <i>Draw Steel: Encounters</i>.</p>' +
          '<div class="hbc-team">' + people + '</div>' +
          '<p class="hbc-thanks">To all of you: thank you for a game this fun to run and this good to read, and for the Creator License, which lets fans like us build tools for it and share them.</p>' +
          '<p class="hbc-quiet">This package was made by fans. It isn’t made, checked or endorsed by MCDM.</p></section>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">II</span>Get the books</h4>' +
          '<p>This Handbook is a quick reference. The full game, with every rule, the art and the setting, is in MCDM’s books, and buying them is the best way to thank the team.</p>' +
          '<a class="hbc-buy" href="' + SHOP + '" target="_blank" rel="noopener"><span><small>MCDM’s official shop</small><b>Get Draw Steel</b><i>Heroes, Monsters and more</i></span>' + ARROW + '</a>' +
          '<p class="hbc-quiet">shop.mcdmproductions.com</p></section>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">III</span>The licence notice</h4>' +
          '<div class="hbc-notice"><span>Word for word, as the licence requires</span>' + esc(NOTICE) + '</div>' +
          '<p class="hbc-quiet">Read the licence itself at <a href="' + LICENCE + '" target="_blank" rel="noopener">mcdmproductions.com/draw-steel-creator-license</a>.</p></section>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">IV</span>Where the rules come from</h4>' +
          '<p>Every rule in this Handbook and in the package’s reference data is reproduced from two published books.</p>' +
          '<div class="hbc-books"><span class="hbc-tag">Heroes Book</span><span class="hbc-tag">Monsters Book</span></div>' + counts +
          '<p>They were gathered with the help of the <a href="https://steelcompendium.io" target="_blank" rel="noopener">Steel Compendium</a>, a community project that publishes the books’ rules under the same licence. A big thank-you to its volunteers too.</p></section>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">V</span>This package</h4>' +
          '<p>Chronicle Draw Steel is built and maintained by the Chronicle team, for running Draw Steel in <a href="https://github.com/keyxmakerx/Chronicle" target="_blank" rel="noopener">Chronicle</a>.</p>' +
          '<div class="hbc-split"><div><b>The rules text</b>MCDM’s, reproduced under the DRAW STEEL Creator License. We can’t relicense it.</div>' +
          '<div><b>Everything we made</b>This package\u2019s widgets, tools, docs, art and own entries, under CC-BY-4.0.</div></div></section>' +
        '<section class="hbc-sec"><h4><span class="hbc-n">VI</span>Art and type</h4>' +
          '<p>The cover, the pop-up books and this stage are cut-paper art drawn for this package. The type is three open-source faces, each under the SIL Open Font License.</p>' +
          '<div class="hbc-fonts"><span class="hbc-f1">Big Shoulders Display <i>Headings</i></span>' +
          '<span class="hbc-f2">Barlow Semi Condensed <i>Labels</i></span>' +
          '<span>Source Serif 4 <i>Reading text</i></span></div></section>' +
      '</div></div>';
  }

  function rollHTML(team, tally) {
    var people = team.map(function (p) {
      return '<div class="hbc-rg"><span class="hbc-role">' + esc(p.role) + '</span><span class="hbc-name">' + esc(p.name) + '</span></div>';
    }).join('');
    var counts = tally ? '<span class="hbc-line">' + tally.abilities + ' abilities, ' + tally.ancestries + ' ancestries, ' +
      tally.kits + ' kits and ' + tally.animalTraits + ' animal traits, reproduced from the books.</span>' : '';
    return '<div class="hbc-bar"><button type="button" data-a="pause">Pause</button>' +
      '<button type="button" data-a="fast" aria-pressed="false">Fast forward ⏩</button>' +
      '<button type="button" data-a="skip">Skip to the end</button><button type="button" data-a="close">Close · Esc</button></div>' +
      '<div class="hbc-reel" data-n="reel">' +
      '<div class="hbc-ropen"><small>Draw Steel Handbook</small><h2>Credits</h2></div>' +
      '<div class="hbc-rb"><span class="hbc-role">The game</span><span class="hbc-name hbc-gold">Draw Steel</span><span class="hbc-line">was made by these people at <em>MCDM Productions</em></span></div>' +
      '<div class="hbc-rb hbc-rteam">' + people + '</div>' +
      '<div class="hbc-rb"><span class="hbc-line">Thank you for a game this fun to run and this good to read, and for the Creator License, which lets fans build tools like this one and share them.</span></div>' +
      '<div class="hbc-rule"></div>' +
      '<div class="hbc-rb"><span class="hbc-role">The rules on these pages</span><span class="hbc-name">Heroes Book</span><span class="hbc-name">Monsters Book</span>' + counts + '</div>' +
      '<div class="hbc-rb"><span class="hbc-role">Gathered with the help of</span><span class="hbc-name">The Steel Compendium</span><span class="hbc-line">and the volunteers who keep it.</span></div>' +
      '<div class="hbc-rule"></div>' +
      '<div class="hbc-rb"><span class="hbc-role">This package</span><span class="hbc-name hbc-gold">Chronicle Draw Steel</span><span class="hbc-line">built and kept by the Chronicle team, for running Draw Steel in Chronicle</span></div>' +
      '<div class="hbc-rb"><span class="hbc-role">Art</span><span class="hbc-line">Cut-paper pictures drawn for this package. No MCDM art or logos.</span></div>' +
      '<div class="hbc-rb"><span class="hbc-role">Type</span><span class="hbc-line">Big Shoulders Display, Barlow Semi Condensed and Source Serif 4, under the SIL Open Font License</span></div>' +
      '<div class="hbc-end" data-n="end"><span class="hbc-name hbc-gold">Thank you, MCDM</span>' +
      '<div class="hbc-rstage">' + stageSVG() + '</div>' +
      '<span class="hbc-line">Get the books from MCDM’s official shop</span>' +
      '<a class="hbc-rbuy" href="' + SHOP + '" target="_blank" rel="noopener">Get Draw Steel →</a>' +
      '<p class="hbc-rnotice">' + esc(NOTICE) + '</p>' +
      '<div class="hbc-again"><button type="button" class="hbc-p" data-a="again">Watch again</button><button type="button" data-a="close">Back to the book</button></div></div>' +
      '</div>';
  }

  // One View per mounted element: boot.js calls init/destroy on the shared
  // registration object, so per-mount state lives here.
  function View(el, campaignId) {
    this.el = el;
    this.cid = campaignId;
    this.team = [];
    this.tally = null;
    this.box = null;
    this.anim = null;
    this.opener = null;
    this.onKey = null;
  }

  View.prototype.mount = function () {
    var self = this;
    injectStyles();
    if (!this.cid) {
      this.el.innerHTML = '<div class="hbc"><p class="hbc-problem">The Credits page needs a campaign to read the names from.</p></div>';
      return;
    }
    var url = '/campaigns/' + encodeURIComponent(this.cid) + '/systems/drawsteel/data/credits.json';
    var fetchFn = (typeof Chronicle.apiFetch === 'function') ? Chronicle.apiFetch : window.fetch.bind(window);
    fetchFn(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!self.el) return;
      self.team = teamFrom(data);
      self.tally = tallyFrom(data);
      if (!self.team.length) throw new Error('no names');
      self.el.innerHTML = '<div class="hbc">' + pageHTML(self.team, self.tally) + '</div>';
      bow(self.el);
      self.el.querySelector('[data-a="roll"]').addEventListener('click', function () { self.open(); });
    }).catch(function () {
      if (!self.el) return;
      self.el.innerHTML = '<div class="hbc"><p class="hbc-problem">The Credits page could not load the names, so it stays blank. The licence notice still applies: ' + esc(NOTICE) + '</p></div>';
    });
  };

  View.prototype.q = function (sel) { return this.box.querySelector(sel); };

  View.prototype.endY = function () {
    var end = this.q('[data-n="end"]');
    return -(end.offsetTop + end.offsetHeight - window.innerHeight);
  };

  View.prototype.play = function () {
    if (this.anim) this.anim.cancel();
    this.anim = null;
    var reel = this.q('[data-n="reel"]');
    if (calm() || typeof reel.animate !== 'function') { this.box.scrollTop = 0; return; }
    var from = window.innerHeight * 0.4, to = this.endY();
    this.anim = reel.animate([{ transform: 'translateY(' + from + 'px)' }, { transform: 'translateY(' + to + 'px)' }],
      { duration: Math.max(1000, (from - to) / PX_PER_S * 1000), easing: 'linear', fill: 'forwards' });
    this.q('[data-a="pause"]').textContent = 'Pause';
    this.setFast(false);
  };

  View.prototype.setFast = function (on) {
    this.q('[data-a="fast"]').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (this.anim) this.anim.playbackRate = on ? FAST : 1;
  };

  View.prototype.togglePause = function () {
    if (!this.anim) return;
    var btn = this.q('[data-a="pause"]');
    if (this.anim.playState === 'running') { this.anim.pause(); btn.textContent = 'Play'; }
    else if (this.anim.playState === 'paused') { this.anim.play(); btn.textContent = 'Pause'; }
  };

  View.prototype.skip = function () {
    if (this.anim) { this.anim.finish(); return; }
    var end = this.q('[data-n="end"]');
    if (end.scrollIntoView) end.scrollIntoView();
  };

  // The roll plays over the whole site, so it lives on <body>, not in the page.
  View.prototype.open = function () {
    var self = this;
    if (this.box) return;
    this.opener = document.activeElement;
    var box = document.createElement('div');
    box.className = 'hbc hbc-roll';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'The credits');
    box.tabIndex = -1;
    box.innerHTML = rollHTML(this.team, this.tally);
    document.body.appendChild(box);
    this.box = box;
    bow(box);
    if (calm()) {
      this.q('[data-a="pause"]').hidden = true;
      this.q('[data-a="fast"]').hidden = true;
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a]') : null;
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'close') self.close();
      else if (a === 'pause') self.togglePause();
      else if (a === 'fast') self.setFast(b.getAttribute('aria-pressed') !== 'true');
      else if (a === 'skip') self.skip();
      else if (a === 'again') self.play();
    });
    // Captured on window so the book underneath never sees keys meant for the roll.
    this.onKey = function (e) { self.key(e); };
    window.addEventListener('keydown', this.onKey, true);
    this.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    this.play();
    this.q('[data-a="close"]').focus();
  };

  View.prototype.key = function (e) {
    if (!this.box) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key === ' ' && (e.target === this.box || !e.target.closest('button, a'))) { e.preventDefault(); this.togglePause(); return; }
    if (e.key === 'Tab') {
      var f = [].filter.call(this.box.querySelectorAll('button, a[href]'), function (b) { return !b.hidden; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !this.box.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !this.box.contains(at))) { e.preventDefault(); first.focus(); }
    }
  };

  View.prototype.close = function () {
    if (!this.box) return;
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    this.onKey = null;
    if (this.box.parentNode) this.box.parentNode.removeChild(this.box);
    this.box = null;
    document.documentElement.style.overflow = this.prevOverflow || '';
    var o = this.opener;
    this.opener = null;
    if (o && o.focus && document.body.contains(o)) o.focus();
  };

  View.prototype.destroy = function () {
    this.close();
    if (this.el) this.el.innerHTML = '';
    this.el = null;
  };

  Chronicle.register('handbook-credits', {
    init: function (el, config) {
      var ds = el.dataset || {};
      config = config || {};
      if (el.__hbc) el.__hbc.destroy();
      el.__hbc = new View(el, config.campaign_id || config.campaignId || ds.campaignId || '');
      el.__hbc.mount();
    },
    destroy: function (el) {
      if (el && el.__hbc) { el.__hbc.destroy(); el.__hbc = null; }
    }
  });
})();
