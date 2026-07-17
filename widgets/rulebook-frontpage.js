/**
 * Draw Steel Rulebook Front Page — the editorial spread widget.
 *
 * Ports the SIGNED design contract (Cordinator mockups/rulebook-v10-table.html,
 * v10.1) into a Chronicle widget. This file builds the FROZEN canonical DOM the
 * reusable RulebookFoldEngine wires; it owns rendering only — every fold
 * interaction (wing / flap / reader takeover / search / cross-hops / Esc) is
 * delegated to the engine via the data-attribute contract.
 *
 * Data (fetched at init, defensively unwrapped):
 *   data/rulebook-frontpage.json  — ReferenceItem[] blocks keyed by
 *                                    properties.kind (hero/characteristic/
 *                                    conditions/worked-scene).
 *   data/rules-glossary.json      — condition full text + the rollup roster.
 *
 * ES5 only (var / function expressions; no arrow fns, template literals, or
 * Array.from / Object.assign). Styles inject as ONE scoped <style> (class
 * guard). All data-derived text is escaped before it enters innerHTML.
 *
 * OUT OF SCOPE this slice (clean seams left, no behaviour): the staged example
 * player (example buttons + Lair parts render as inert placeholders), glossary
 * hover-cards, and long-form reader chapters beyond the seed blocks.
 */
(function () {
  'use strict';

  // ── escaping / text helpers ──────────────────────────────────────────────

  // esc HTML-escapes & < > using Chronicle's helper when present, else a local
  // fallback. The single choke point for text entering innerHTML.
  function esc(s) {
    if (typeof Chronicle !== 'undefined' && Chronicle && typeof Chronicle.escapeHtml === 'function') {
      return Chronicle.escapeHtml(s == null ? '' : String(s));
    }
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // escAttr additionally neutralises the attribute-value delimiter.
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  // rich escapes FIRST, then promotes **bold** -> <b> — safe because the markup
  // is introduced only after the source text is inert.
  function rich(s) {
    return esc(s).replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  }

  function isArr(x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  }

  // unwrap accepts a bare array OR an envelope ({data|results|entries:[...]}).
  function unwrap(x) {
    if (isArr(x)) return x;
    if (x && isArr(x.data)) return x.data;
    if (x && isArr(x.results)) return x.results;
    if (x && isArr(x.entries)) return x.entries;
    return [];
  }

  // slugify makes a safe id fragment from a display name.
  function slugify(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // orderOf reads properties.order (defaulting last-ish) for stable sorting.
  function orderOf(item) {
    return item && item.properties && typeof item.properties.order === 'number'
      ? item.properties.order : 9999;
  }

  // ── stylesheet ────────────────────────────────────────────────────────────

  // css returns the full scoped stylesheet. Dark editorial tokens are declared
  // ON .rb-root so the signed look renders regardless of the host page theme.
  function css() {
    var s = [];
    // Tokens (copied from the mockup :root.dark) + base, scoped to .rb-root.
    s.push(
      '.rb-root{' +
        '--rb-bg:#0d1017;--rb-box:#131722;--rb-box2:#1a2030;--rb-box3:#222a3d;' +
        '--rb-edge:#262c3d;--rb-edge2:#1f2534;--rb-ink:#f2f4fa;--rb-ink2:#c9d0e0;' +
        '--rb-mut:#8a93a8;--rb-mut2:#5d6579;--rb-pur:#a78bfa;--rb-pur2:#8b5cf6;' +
        '--rb-grn:#34d399;--rb-gold:#fbbf24;--rb-cond:#f06d6d;--rb-combat:#f0a12e;' +
        '--rb-move:#38bdf8;--rb-spring:cubic-bezier(.34,1.3,.4,1);' +
        '--rb-sh:0 18px 50px rgba(0,0,0,.65);' +
        'background:var(--rb-bg);color:var(--rb-ink);' +
        'font:13.5px/1.5 Inter,system-ui,sans-serif;position:relative;' +
        '-webkit-font-smoothing:antialiased}',
      '.rb-root *{box-sizing:border-box}',
      '.rb-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:left}',
      '.rb-root input{font:inherit;color:inherit;background:none;border:0;outline:none}',
      // Keyboard focus rings (T-B3). The engine makes the div-based fold
      // triggers operable (role=button + tabindex + Enter/Space); these give
      // them, the search box, and every button a visible focus indicator.
      '.rb-root [data-rb-wing]:focus-visible,.rb-root [data-rb-reader]:focus-visible,' +
        '.rb-root button:focus-visible{outline:2px solid var(--tc,var(--rb-pur));outline-offset:2px;border-radius:8px}',
      '.rb-searchbox:focus-within{border-color:color-mix(in srgb,var(--rb-pur) 55%,var(--rb-edge))}',
      // Sticky header + brand + searchbox.
      '.rb-top{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:14px;' +
        'padding:9px 18px;background:color-mix(in srgb,var(--rb-bg) 90%,transparent);' +
        'backdrop-filter:blur(10px);border-bottom:1px solid var(--rb-edge2)}',
      '.rb-brand{display:flex;align-items:center;gap:9px;font-weight:800}',
      '.rb-brand .rb-mark{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;' +
        'font-size:15px;background:linear-gradient(135deg,var(--rb-pur2),#6d28d9)}',
      '.rb-brand small{display:block;font:600 9.5px/1 inherit;color:var(--rb-mut)}',
      '.rb-searchbox{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--rb-box);' +
        'border:1px solid var(--rb-edge);border-radius:10px;padding:8px 12px;min-width:270px}',
      '.rb-searchbox input{flex:1;font-size:12px;min-width:0}',
      '.rb-searchbox input::placeholder{color:var(--rb-mut)}',
      '.rb-searchbox kbd{font:700 10px/1 ui-monospace,monospace;color:var(--rb-mut);background:var(--rb-box2);' +
        'border:1px solid var(--rb-edge);border-bottom-width:2px;padding:3px 6px;border-radius:5px}',
      '.rb-searchbox .rb-hint{font:600 9.5px/1 inherit;color:var(--rb-mut2);white-space:nowrap}',
      // Wrap, masthead, legend.
      '.rb-wrap{max-width:1140px;margin:0 auto;padding:0 18px 26px}',
      '.rb-mast{display:flex;align-items:baseline;gap:14px;margin:20px 0 4px;' +
        'border-bottom:3px double var(--rb-edge);padding-bottom:9px}',
      '.rb-mast h1{margin:0;font-size:28px;font-weight:900;letter-spacing:-.02em}',
      '.rb-mast p{margin:0;color:var(--rb-mut);font-size:11.5px;flex:1}',
      '.rb-legend{display:flex;gap:15px;flex-wrap:wrap;margin:8px 0 12px;' +
        'font:600 10.5px/1.5 inherit;color:var(--rb-mut)}',
      '.rb-legend b{color:var(--rb-ink2)}',
      // Editorial spread grid + block chrome + deal-in / breathe keyframes.
      '.rb-grid{display:grid;grid-template-columns:1.55fr 1fr;' +
        'grid-template-areas:"hero chars" "conds lair";gap:14px}',
      '@media(max-width:880px){.rb-grid{grid-template-columns:1fr;' +
        'grid-template-areas:"hero" "chars" "conds" "lair"}.rb-searchbox{min-width:0;flex:1}}',
      '.rb-blk{border:1px solid var(--rb-edge);border-radius:16px;background:var(--rb-box);position:relative;' +
        'animation:rb-deal .55s var(--rb-spring) both;animation-delay:calc(var(--i)*90ms)}',
      '@keyframes rb-deal{from{opacity:0;transform:translateY(28px) rotate(var(--rot,1.2deg)) scale(.96)}to{opacity:1;transform:none}}',
      '@keyframes rb-breathe{0%,100%{transform:none;opacity:.7}50%{transform:scale(1.1);opacity:1}}',
      '.rb-hero{grid-area:hero}.rb-chars{grid-area:chars}.rb-conds{grid-area:conds}.rb-lair{grid-area:lair}',
      '.rb-blk.rb-dimmed{opacity:.32;filter:saturate(.55);transition:opacity .3s,filter .3s}',
      '[data-rb-block].rb-nomatch{opacity:.35;transition:opacity .3s}',
      '.rb-kick{font:800 9.5px/1 inherit;letter-spacing:.12em;color:var(--bc);display:flex;align-items:center;gap:7px}',
      '.rb-kick .rb-no{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:10px;' +
        'color:#fff;background:linear-gradient(135deg,var(--bc),color-mix(in srgb,var(--bc) 70%,#000 15%))}',
      '.rb-openmark{position:absolute;top:12px;right:13px;font:800 10px/1 inherit;color:var(--bc);' +
        'display:flex;gap:5px;align-items:center;animation:rb-breathe 2.6s ease-in-out infinite;z-index:2}'
    );
    // Hero (reader trigger) block.
    s.push(
      '.rb-hero{padding:17px 20px;cursor:pointer;overflow:hidden;' +
        'transition:transform .2s,border-color .2s,box-shadow .2s}',
      '.rb-hero:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--bc) 50%,var(--rb-edge));' +
        'box-shadow:0 8px 22px rgba(0,0,0,.35)}',
      '.rb-hero h2{margin:9px 0 4px;font-size:24px;font-weight:900}',
      '.rb-stand{font:500 12.5px/1.6 inherit;color:var(--rb-ink2);max-width:52ch}',
      '.rb-tiers{display:flex;gap:8px;margin-top:12px}',
      '.rb-t{flex:1;border:1px solid var(--rb-edge2);border-radius:11px;background:var(--rb-box2);' +
        'padding:8px 11px;position:relative;overflow:hidden}',
      '.rb-t::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3.5px;' +
        'background:var(--bc,var(--rb-combat));opacity:var(--o,.6)}',
      '.rb-t b{display:block;font-size:14px}',
      '.rb-t span{font:600 9.5px/1.3 inherit;color:var(--rb-mut)}',
      '.rb-table{margin-top:12px;border:1px dashed color-mix(in srgb,var(--bc) 40%,var(--rb-edge));' +
        'border-radius:11px;padding:9px 12px;display:flex;gap:9px;align-items:center;flex-wrap:wrap}',
      '.rb-tlbl{font:800 9px/1 inherit;letter-spacing:.09em;color:var(--bc,var(--rb-combat))}',
      '.rb-table .rb-note2{font:600 10.5px/1.4 inherit;color:var(--rb-mut)}',
      '.rb-readme{margin-top:12px;font:750 11.5px/1 inherit;color:var(--bc,var(--rb-combat))}',
      // Characteristics block + tiles.
      '.rb-chars{padding:13px 15px}',
      '.rb-minigrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}',
      '.rb-tile{border:1px solid var(--rb-edge);border-radius:12px;background:var(--rb-box2);' +
        'padding:10px 12px;position:relative;cursor:pointer;' +
        'transition:transform .2s,border-color .2s,box-shadow .2s,opacity .25s}',
      '.rb-tile:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--tc) 50%,var(--rb-edge))}',
      '.rb-tile.is-open{cursor:default;z-index:46}',
      '.rb-tile.is-open:hover{transform:none}',
      '.rb-tn{font:800 12.5px/1.2 inherit;display:flex;align-items:center;gap:7px}',
      '.rb-td{font:500 10.5px/1.4 inherit;color:var(--rb-mut);margin-top:4px}',
      '.rb-unf{position:absolute;top:8px;right:9px;font:800 9px/1 inherit;color:var(--tc);' +
        'animation:rb-breathe 2.6s ease-in-out infinite}',
      '.rb-exn{margin-top:7px;display:inline-flex;font:800 8px/1 inherit;color:var(--tc);' +
        'border:1px solid color-mix(in srgb,var(--tc) 35%,transparent);padding:2.5px 5px;border-radius:99px}',
      // Face-down search flip (card back).
      '.rb-tile.rb-facedown{transform:rotateY(180deg);cursor:default;pointer-events:none}',
      '.rb-tile.rb-facedown>*{opacity:0}',
      '.rb-tile.rb-facedown .rb-unf{animation:none;opacity:0}',
      '.rb-tile.rb-facedown::after{content:"🛡";position:absolute;inset:0;display:grid;place-items:center;' +
        'font-size:20px;opacity:.25;transform:rotateY(180deg);border-radius:12px;' +
        'background:repeating-linear-gradient(45deg,var(--rb-box3) 0 9px,var(--rb-box2) 9px 18px)}',
      '[data-rb-wing-group].rb-dimmed [data-rb-wing]:not(.is-open){opacity:.32;filter:saturate(.55)}'
    );
    // The hinged wing: a panel attached to a card folds out OVER neighbours.
    // Base width is a fallback — the engine may set an inline width, so no
    // !important here.
    s.push(
      '.rb-veil{position:fixed;inset:0;z-index:60;background:rgba(4,6,11,.5);backdrop-filter:blur(2.5px);' +
        'opacity:0;pointer-events:none;transition:opacity .35s}',
      '.rb-root.rb-reading .rb-veil{opacity:1;pointer-events:auto}',
      '.rb-wing{position:absolute;z-index:45;top:-1px;left:calc(100% - 3px);width:340px;max-height:66vh;' +
        'overflow:auto;background:var(--rb-box);cursor:default;padding:12px 15px;' +
        'border:1.5px solid color-mix(in srgb,var(--tc,var(--bc)) 55%,var(--rb-edge));' +
        'border-radius:0 14px 14px 14px;box-shadow:26px 26px 60px rgba(0,0,0,.68);' +
        'transform:perspective(1100px) rotateY(-88deg);transform-origin:left center;' +
        'opacity:0;pointer-events:none;transition:transform .55s var(--rb-spring),opacity .3s}',
      '.rb-wing::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;' +
        'background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--tc,var(--bc)) 60%,transparent),transparent)}',
      '.rb-wing--wide{width:540px;max-height:74vh}',
      // Left-hinged variant (right-column cards + the Lair).
      '[data-rb-side="left"] .rb-wing{left:auto;right:calc(100% - 3px);border-radius:14px 0 14px 14px;' +
        'transform-origin:right center;transform:perspective(1100px) rotateY(88deg);' +
        'box-shadow:-26px 26px 60px rgba(0,0,0,.68)}',
      '[data-rb-side="left"] .rb-wing::before{left:auto;right:0}',
      // Open state (engine adds .is-open to the [data-rb-wing] host).
      '[data-rb-wing].is-open>.rb-wing{transform:none;opacity:1;pointer-events:auto}',
      '[data-rb-wing].is-open{z-index:46;box-shadow:0 0 0 1.5px color-mix(in srgb,var(--tc,var(--bc)) 40%,transparent);' +
        'border-color:color-mix(in srgb,var(--tc,var(--bc)) 65%,var(--rb-edge))}',
      '[data-rb-wing].is-open .rb-unf,[data-rb-wing].is-open .rb-openmark{animation:none;opacity:.4}',
      // Crease (sticky header inside the wing) + close chip + body text + foldnote.
      '.rb-crease{position:sticky;top:-12px;margin:-12px -15px 8px;padding:8px 15px;display:flex;' +
        'align-items:center;gap:8px;z-index:2;font:800 9.5px/1 inherit;letter-spacing:.1em;' +
        'color:var(--tc,var(--bc));background:color-mix(in srgb,var(--tc,var(--bc)) 9%,var(--rb-box));' +
        'border-bottom:1px dashed color-mix(in srgb,var(--tc,var(--bc)) 35%,var(--rb-edge))}',
      '.rb-x2{margin-left:auto;width:25px;height:25px;border-radius:7px;display:grid;place-items:center;' +
        'background:var(--rb-box3);border:1px solid var(--rb-edge);font-size:10px;color:var(--rb-ink)}',
      '.rb-wing p{margin:8px 0;font:500 12.5px/1.65 inherit;color:var(--rb-ink2)}',
      '.rb-wing b{color:var(--rb-ink)}',
      '.rb-foldnote{font:650 10px/1 inherit;color:var(--rb-mut2);margin-top:10px}'
    );
    // Conditions block: flap rows that slide DOWN over the rows beneath.
    s.push(
      '.rb-conds{padding:13px 15px}',
      '.rb-crows{margin-top:9px}',
      '.rb-crow{position:relative;border:1px solid var(--rb-edge);border-radius:11px;' +
        'background:var(--rb-box2);margin:0 0 7px;transition:opacity .3s,filter .3s}',
      '[data-rb-flap-group].rb-flapopen [data-rb-flap]:not(.is-open){opacity:.35;filter:saturate(.6)}',
      '.rb-ch{display:flex;align-items:center;gap:9px;width:100%;padding:9px 12px}',
      '.rb-cg{font-size:13px}',
      '.rb-nm{font:750 12px/1.2 inherit;min-width:86px}',
      '.rb-crow .rb-d{font:500 10.5px/1.35 inherit;color:var(--rb-mut);flex:1}',
      '.rb-fold{font:800 9.5px/1 inherit;color:var(--rb-cond);animation:rb-breathe 2.6s ease-in-out infinite}',
      '.rb-crow.is-open .rb-fold{animation:none}',
      '.rb-flap{position:absolute;top:calc(100% - 3px);left:6px;right:6px;z-index:35;' +
        'background:var(--rb-box2);border-radius:0 0 13px 13px;padding:12px 14px;' +
        'border:1px solid color-mix(in srgb,var(--rb-cond) 45%,var(--rb-edge));' +
        'box-shadow:0 22px 50px rgba(0,0,0,.7);' +
        'transform:perspective(1000px) rotateX(-88deg);transform-origin:top center;' +
        'opacity:0;pointer-events:none;transition:transform .55s var(--rb-spring),opacity .3s}',
      '.rb-crow.is-open .rb-flap{transform:none;opacity:1;pointer-events:auto}',
      '.rb-crow.is-open{z-index:36;border-color:color-mix(in srgb,var(--rb-cond) 50%,var(--rb-edge))}',
      '.rb-flap p{margin:6px 0;font:500 12px/1.6 inherit;color:var(--rb-ink2)}',
      '.rb-flap b{color:var(--rb-ink)}',
      '.rb-fx{display:flex;align-items:center;gap:8px;font:800 9px/1 inherit;letter-spacing:.1em;' +
        'color:var(--rb-cond);margin-bottom:4px}',
      // Worked-scene (Lair) block.
      '.rb-lair{padding:13px 15px;cursor:pointer;transition:transform .2s,border-color .2s,box-shadow .2s;' +
        'background:linear-gradient(160deg,color-mix(in srgb,var(--rb-grn) 8%,var(--rb-box)),var(--rb-box) 60%)}',
      '.rb-lair:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--bc) 50%,var(--rb-edge))}',
      '.rb-lair.is-open{cursor:default}.rb-lair.is-open:hover{transform:none}',
      '.rb-lair h3{margin:8px 0 3px;font-size:15px;font-weight:850}',
      '.rb-lair .rb-d{font:500 11px/1.5 inherit;color:var(--rb-mut)}',
      '.rb-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}',
      '.rb-chip{font:700 10px/1 inherit;color:var(--rb-ink2);background:var(--rb-box2);' +
        'border:1px solid var(--rb-edge);padding:5px 9px;border-radius:99px}',
      '.rb-parts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}',
      '.rb-part{display:flex;align-items:center;gap:9px;border:1px solid var(--rb-edge);border-radius:11px;' +
        'background:var(--rb-box2);padding:9px 11px;transition:border-color .2s,transform .2s}',
      '.rb-part:hover{border-color:var(--rb-grn);transform:translateY(-2px)}',
      '.rb-pn{font:750 11.5px/1.2 inherit}',
      '.rb-pd{font:500 10px/1.35 inherit;color:var(--rb-mut);flex:1}'
    );
    // Reader takeover (FLIP: engine sets inline left/top/width/height) + veil.
    s.push(
      '.rb-reader{position:fixed;z-index:70;border:1px solid var(--rb-edge);border-radius:18px;' +
        'background:var(--rb-box);box-shadow:var(--rb-sh);opacity:0;pointer-events:none;overflow:auto;' +
        'transition:left .55s var(--rb-spring),top .55s var(--rb-spring),width .55s var(--rb-spring),' +
        'height .55s var(--rb-spring),opacity .25s}',
      '.rb-root.rb-reading .rb-reader{opacity:1;pointer-events:auto}',
      '.rb-rh{display:flex;align-items:center;gap:10px;padding:11px 16px;position:sticky;top:0;z-index:2;' +
        'border-bottom:1px solid var(--rb-edge2);background:var(--rb-box2)}',
      '.rb-rope{font:700 11.5px/1 inherit;color:var(--rb-mut);padding:6px 10px;' +
        'border:1px solid var(--rb-edge);border-radius:9px;background:var(--rb-box)}',
      '.rb-rope b{color:var(--rb-ink)}',
      '.rb-crumb{font:650 11px/1 inherit;color:var(--rb-mut2)}',
      '.rb-rx{margin-left:auto;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;' +
        'background:var(--rb-box3);border:1px solid var(--rb-edge)}',
      '.rb-rbody{padding:14px 22px 24px;font:500 13px/1.7 inherit;color:var(--rb-ink2)}',
      '.rb-rbody h2{margin:0 0 6px;color:var(--rb-ink);font-size:20px;font-weight:900}',
      '.rb-rbody h3{margin:14px 0 5px;color:var(--rb-ink);font:800 10.5px/1 inherit;letter-spacing:.09em}',
      '.rb-rbody p{margin:7px 0}.rb-rbody b{color:var(--rb-ink)}',
      '.rb-rcols{column-width:36ch;column-gap:32px;column-rule:1px solid var(--rb-edge2)}',
      // Example (placeholder) buttons + related cross-hop chips.
      '.rb-exrow{display:flex;gap:8px;flex-wrap:wrap;margin:11px 0 4px}',
      '.rb-exbtn{display:inline-flex;align-items:center;gap:7px;font:750 11.5px/1 inherit;' +
        'color:var(--tc,var(--rb-combat));border-radius:9px;padding:8px 12px;' +
        'background:color-mix(in srgb,var(--tc,var(--rb-combat)) 9%,transparent);' +
        'border:1px solid color-mix(in srgb,var(--tc,var(--rb-combat)) 32%,transparent)}',
      '.rb-exbtn.rb-ghost{color:var(--rb-mut);background:var(--rb-box2);border-color:var(--rb-edge)}',
      '.rb-relrow{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;padding-top:10px;' +
        'border-top:1px dashed var(--rb-edge);align-items:center}',
      '.rb-rellbl{font:800 9px/1 inherit;letter-spacing:.1em;color:var(--rb-mut2)}',
      '.rb-rel{font:700 10.5px/1 inherit;color:var(--rb-ink2);background:var(--rb-box2);' +
        'border:1px solid var(--rb-edge);padding:6px 10px;border-radius:99px}',
      '.rb-rel:hover{border-color:var(--tc,var(--rb-combat));color:var(--rb-ink)}',
      // Loading skeleton + error panel.
      '.rb-load{padding:22px 20px}',
      '.rb-sk{border:1px solid var(--rb-edge);border-radius:14px;background:var(--rb-box);' +
        'height:120px;margin:12px 0;position:relative;overflow:hidden}',
      '.rb-sk::after{content:"";position:absolute;inset:0;' +
        'background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--rb-box2) 70%,transparent),transparent);' +
        'transform:translateX(-100%);animation:rb-shimmer 1.3s infinite}',
      '@keyframes rb-shimmer{100%{transform:translateX(100%)}}',
      '.rb-err{margin:20px;padding:16px 18px;border:1px solid color-mix(in srgb,var(--rb-cond) 45%,var(--rb-edge));' +
        'border-radius:12px;background:color-mix(in srgb,var(--rb-cond) 8%,var(--rb-box));color:var(--rb-ink2)}',
      '.rb-err b{color:var(--rb-ink);display:block;margin-bottom:5px;font-size:14px}',
      '.rb-err code{font:600 11px/1.5 ui-monospace,monospace;color:var(--rb-mut)}',
      // Mobile: wings fold DOWN full-width instead of sideways.
      '@media(max-width:640px){' +
        '.rb-wing.rb-wing--down{left:0;right:0;width:auto;top:calc(100% - 3px);' +
          'transform:perspective(1000px) rotateX(-88deg);transform-origin:top center;' +
          'border-radius:0 0 14px 14px;box-shadow:0 22px 50px rgba(0,0,0,.7)}' +
        '[data-rb-side="left"] .rb-wing.rb-wing--down{right:0}' +
        '.rb-tile.is-open>.rb-wing.rb-wing--down,.rb-lair.is-open>.rb-wing.rb-wing--down{transform:none}}',
      '@media (prefers-reduced-motion:reduce){.rb-root *,.rb-root *::before,.rb-root *::after{' +
        'animation:none!important;transition:none!important}}'
    );
    return s.join('\n');
  }

  // ── render: static chrome ───────────────────────────────────────────────

  function buildLoading() {
    return buildTop() +
      '<div class="rb-wrap"><div class="rb-mast"><h1>The Rules</h1>' +
        '<p>loading the front page…</p></div>' +
        '<div class="rb-load"><div class="rb-sk"></div><div class="rb-sk"></div>' +
        '<div class="rb-sk"></div></div></div>';
  }

  function buildError(msg) {
    return buildTop() +
      '<div class="rb-wrap"><div class="rb-err">' +
        '<b>The rulebook front page could not load.</b>' +
        '<div>Check that the Draw Steel extension assets are installed and reachable, ' +
        'then reload this page. If it persists, reinstall the extension.</div>' +
        '<div style="margin-top:8px"><code>' + esc(msg) + '</code></div>' +
      '</div></div>';
  }

  function buildTop() {
    return '<div class="rb-top">' +
        '<div class="rb-brand"><span class="rb-mark">🛡</span>' +
          '<div>Rulebook<small>DRAW STEEL</small></div></div>' +
        '<div class="rb-searchbox"><span>🔎</span>' +
          '<input data-rb-search type="search" aria-label="Search the rulebook" ' +
            'placeholder="Search — cards that don\'t match fold face-down…">' +
          '<kbd>/</kbd><span class="rb-hint">press / anytime</span></div>' +
      '</div>';
  }

  // ── render: blocks ───────────────────────────────────────────────────────

  // tierCells renders a row of accent-barred cells (hero tiers / modifiers).
  // Tiers carry their own `o` opacity; modifiers default to a soft accent.
  function tierCells(list, isMod) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var t = list[i] || {};
      var o = isMod ? 0.5 : (typeof t.o === 'number' ? t.o : 0.6);
      html += '<div class="rb-t" style="--o:' + Number(o) + '">' +
        '<b>' + esc(t.label) + '</b><span>' + esc(t.note) + '</span></div>';
    }
    return html;
  }

  function buildHero(hero) {
    var p = hero.properties || {};
    var tiers = isArr(p.tiers) ? p.tiers : [];
    var mods = isArr(p.modifiers) ? p.modifiers : [];
    return '<div class="rb-blk rb-hero" data-rb-block data-rb-reader ' +
        'style="--i:0;--rot:-1deg;--bc:var(--rb-combat)">' +
        '<span class="rb-openmark">⤢ read</span>' +
        '<div class="rb-kick"><span class="rb-no">' + esc(p.kickerNo) + '</span>' +
          esc(p.kicker) + '</div>' +
        '<h2>' + esc(hero.name) + '</h2>' +
        '<div class="rb-stand">' + rich(hero.description) + '</div>' +
        '<div class="rb-tiers">' + tierCells(tiers, false) + '</div>' +
        '<div class="rb-tiers" style="margin-top:10px">' + tierCells(mods, true) + '</div>' +
        '<div class="rb-table"><span class="rb-tlbl">⚔️ AT THE TABLE</span>' +
          '<span class="rb-note2">the worked example opens inside the reading sheet</span></div>' +
        '<div class="rb-readme">▶ ' + esc(p.readerLede) + '</div>' +
      '</div>';
  }

  // relChips renders functional cross-hop chips. The engine wires the
  // data-rb-goto-* attributes; we only emit them.
  function relChips(list) {
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var attr = '';
      if (r.goto === 'reader') attr = 'data-rb-goto-reader';
      else if (r.goto === 'flap') attr = 'data-rb-goto-flap="' + escAttr(r.target) + '"';
      else if (r.goto === 'card') attr = 'data-rb-goto-card="' + escAttr(r.target) + '"';
      html += '<button class="rb-rel" type="button" ' + attr + '>' +
        esc(r.icon) + ' ' + esc(r.label) + '</button>';
    }
    return html;
  }

  // buildTile renders one characteristic card + its hinged wing. idx decides the
  // hinge side (even column wings right, odd column wings left). Example buttons
  // are inert placeholders (seam: data-rb-example); related chips are live.
  function buildTile(item, idx) {
    var p = item.properties || {};
    var side = (idx % 2 === 1) ? 'left' : 'right';
    var marker = side === 'left' ? '⤪' : '⤢';
    var color = String(p.color || 'pur').replace(/[^a-z0-9]/gi, '') || 'pur';
    var id = 't-' + slugify(item.name);
    var examples = isArr(p.examples) ? p.examples : [];
    var related = isArr(p.related) ? p.related : [];

    var ex = '';
    for (var e = 0; e < examples.length; e++) {
      var x = examples[e] || {};
      ex += '<button class="rb-exbtn" type="button" data-rb-example>' +
        esc(x.icon) + ' ' + esc(x.label) + '</button>';
    }
    ex += '<button class="rb-exbtn rb-ghost" type="button">📖 ' +
      esc(p.chapterLabel || 'Full chapter') + '</button>';

    var rel = related.length
      ? '<div class="rb-relrow"><span class="rb-rellbl">RELATED →</span>' + relChips(related) + '</div>'
      : '';

    return '<div class="rb-tile" id="' + escAttr(id) + '" data-rb-wing data-rb-tile ' +
        'data-rb-side="' + side + '" data-rb-tags="' + escAttr(p.tags) + '" ' +
        'style="--tc:var(--rb-' + color + ')">' +
        '<div class="rb-tn">' + esc(p.emoji) + ' ' + esc(item.name) + '</div>' +
        '<div class="rb-td">' + esc(p.tagline) + '</div>' +
        '<span class="rb-unf">' + marker + '</span>' +
        '<span class="rb-exn">▶ ' + examples.length + '</span>' +
        '<div class="rb-wing">' +
          '<div class="rb-crease">' + esc(p.emoji) + ' ' +
            esc(String(item.name).toUpperCase()) + ' · UNFOLDED ' +
            '<button class="rb-x2" data-rb-close-wing>✕</button></div>' +
          '<p>' + rich(item.description) + '</p>' +
          '<div class="rb-exrow">' + ex + '</div>' +
          rel +
          '<div class="rb-foldnote">✕ · Esc · outside → folds back</div>' +
        '</div>' +
      '</div>';
  }

  function buildChars(chars) {
    var tiles = '';
    for (var i = 0; i < chars.length; i++) tiles += buildTile(chars[i], i);
    return '<div class="rb-blk rb-chars" data-rb-block style="--i:1;--rot:1.5deg;--bc:var(--rb-pur)">' +
        '<div class="rb-kick"><span class="rb-no">2</span>' +
          'CHARACTERISTICS · tap a card — its wing slides out over the others</div>' +
        '<div class="rb-minigrid" data-rb-wing-group>' + tiles + '</div>' +
      '</div>';
  }

  function capitalize(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // glossaryMap indexes glossary entries by slug for O(1) condition lookups.
  function glossaryMap(glossary) {
    var m = {};
    for (var i = 0; i < glossary.length; i++) {
      var g = glossary[i];
      if (g && g.slug) m[g.slug] = g;
    }
    return m;
  }

  // remainingConditions is the rollup roster: every glossary condition NOT
  // featured, comma-joined by display name.
  function remainingConditions(glossary, featuredSlugs) {
    var names = [];
    for (var i = 0; i < glossary.length; i++) {
      var g = glossary[i];
      if (!g || !g.properties || g.properties.category !== 'condition') continue;
      if (!featuredSlugs[g.slug]) names.push(g.name);
    }
    return names.join(', ');
  }

  // crow renders one condition flap row. bodyHtml is already escaped/safe.
  function crow(id, emoji, name, tagline, bodyHtml) {
    return '<div class="rb-crow" id="' + escAttr(id) + '" data-rb-flap>' +
        '<button class="rb-ch" data-rb-flap-trigger>' +
          '<span class="rb-cg">' + esc(emoji) + '</span>' +
          '<span class="rb-nm">' + esc(name) + '</span>' +
          '<span class="rb-d">' + esc(tagline) + '</span>' +
          '<span class="rb-fold">⤵</span>' +
        '</button>' +
        '<div class="rb-flap">' +
          '<div class="rb-fx">⤵ UNFOLDED · ' + esc(String(name).toUpperCase()) + ' ' +
            '<button class="rb-x2" data-rb-close-flap>✕</button></div>' +
          '<p>' + bodyHtml + '</p>' +
        '</div>' +
      '</div>';
  }

  function buildConds(conds, glossary) {
    var p = conds.properties || {};
    var featured = isArr(p.featured) ? p.featured : [];
    var map = glossaryMap(glossary);
    var featSet = {};
    var rows = '';
    for (var i = 0; i < featured.length; i++) {
      var f = featured[i] || {};
      featSet[f.slug] = true;
      var g = map[f.slug];
      var nm = g && g.name ? g.name : capitalize(f.slug);
      var text = g && g.description ? g.description : (f.tagline || '');
      rows += crow('cond-' + f.slug, f.emoji, nm, f.tagline, esc(text));
    }
    var roll = p.rollup || {};
    rows += crow('cond-more', roll.emoji, roll.name, roll.tagline,
      esc(remainingConditions(glossary, featSet)));

    return '<div class="rb-blk rb-conds" data-rb-block ' +
        'style="--i:2;--rot:-1.5deg;--bc:var(--rb-cond)">' +
        '<div class="rb-kick"><span class="rb-no">' + esc(p.kickerNo) + '</span>' +
          'CONDITIONS · tap a row, its flap slides down over the rest</div>' +
        '<div class="rb-crows" data-rb-flap-group>' + rows + '</div>' +
      '</div>';
  }

  // buildLair renders the worked-scene block whose wide wing folds left over the
  // Conditions block (data-rb-dim=".rb-conds"). Part buttons are inert
  // placeholders (seam: data-rb-part) — the staged player is out of scope.
  function buildLair(scene) {
    var p = scene.properties || {};
    var chips = isArr(p.chips) ? p.chips : [];
    var parts = isArr(p.parts) ? p.parts : [];

    var chipHtml = '';
    for (var c = 0; c < chips.length; c++) {
      chipHtml += '<span class="rb-chip">' + esc(chips[c]) + '</span>';
    }
    var partHtml = '';
    for (var i = 0; i < parts.length; i++) {
      var pt = parts[i] || {};
      partHtml += '<button class="rb-part" type="button" data-rb-part>' +
        '<span>' + esc(pt.emoji) + '</span>' +
        '<span class="rb-pn">' + esc(pt.name) + '</span>' +
        '<span class="rb-pd">' + esc(pt.note) + '</span>' +
        '<span>▶</span></button>';
    }

    return '<div class="rb-blk rb-lair" id="t-lair" data-rb-block data-rb-wing ' +
        'data-rb-side="left" data-rb-dim=".rb-conds" data-rb-wing-max="540" ' +
        'data-rb-tags="lich lair adventure worked scene boss minions montage" ' +
        'style="--i:3;--rot:1deg;--bc:var(--rb-grn);--tc:var(--rb-grn)">' +
        '<span class="rb-openmark">⤪ play</span>' +
        '<div class="rb-kick"><span class="rb-no">' + esc(p.kickerNo) + '</span>' +
          esc(p.kicker) + '</div>' +
        '<h3>' + esc(p.emoji) + ' ' + esc(scene.name) + '</h3>' +
        '<div class="rb-d">' + esc(scene.description) + '</div>' +
        '<div class="rb-chips">' + chipHtml + '</div>' +
        '<div class="rb-wing rb-wing--wide">' +
          '<div class="rb-crease">' + esc(p.emoji) + ' ' +
            esc(String(scene.name).toUpperCase()) + ' · UNFOLDED ' +
            '<button class="rb-x2" data-rb-close-wing>✕</button></div>' +
          '<p>' + esc(p.intro) + '</p>' +
          '<div class="rb-parts">' + partHtml + '</div>' +
          '<div class="rb-foldnote">✕ · Esc · outside → folds back</div>' +
        '</div>' +
      '</div>';
  }

  // ── render: reader takeover + veil overlays ──────────────────────────────

  // buildReader renders the fixed veil + reading-sheet overlays. The hero's
  // reader[] blocks flow into the multi-column body; the "Watch the table play
  // it" button is an inert seam (staged player out of scope). Returns just the
  // veil when there is no hero to read.
  function buildReader(hero) {
    var veil = '<div class="rb-veil" data-rb-veil data-rb-close-reader></div>';
    if (!hero) return veil;

    var p = hero.properties || {};
    var blocks = isArr(p.reader) ? p.reader : [];
    var body = '';
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i] || {};
      if (b.type === 'h3') body += '<h3>' + rich(b.text) + '</h3>';
      else body += '<p>' + rich(b.text) + '</p>';
    }

    return veil +
      '<div class="rb-reader" data-rb-reader-sheet>' +
        '<div class="rb-rh">' +
          '<button class="rb-rope" data-rb-close-reader>← Back to <b>the front page</b></button>' +
          '<span class="rb-crumb">' + esc(p.readCrumb) + '</span>' +
          '<button class="rb-rx" data-rb-close-reader>✕</button>' +
        '</div>' +
        '<div class="rb-rbody">' +
          '<h2>' + esc(hero.name) + '</h2>' +
          '<div class="rb-rcols">' + body + '</div>' +
          '<div class="rb-exrow"><button class="rb-exbtn" type="button" data-rb-example>' +
            '▶ Watch the table play it</button></div>' +
          '<div class="rb-relrow"><span class="rb-rellbl">RELATED →</span>' +
            '<button class="rb-rel" type="button" data-rb-goto-card="t-might">💪 Might (the card)</button>' +
            '<button class="rb-rel" type="button" data-rb-goto-flap="cond-grabbed">🩸 Grabbed (the flap)</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // buildContent buckets the blocks by kind, orders them, and assembles the
  // frozen canonical DOM (top / wrap[mast,legend,grid] / overlays).
  function buildContent(items, glossary) {
    var sorted = items.slice().sort(function (a, b) { return orderOf(a) - orderOf(b); });
    var hero = null, chars = [], conds = null, scene = null;
    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      var kind = it && it.properties && it.properties.kind;
      if (kind === 'hero') { if (!hero) hero = it; }
      else if (kind === 'characteristic') { chars.push(it); }
      else if (kind === 'conditions') { if (!conds) conds = it; }
      else if (kind === 'worked-scene') { if (!scene) scene = it; }
    }

    var legend =
      '<div class="rb-legend">' +
        '<span><b>⤢/⤪ small cards</b> → a wing stays hinged to the card and slides out OVER its neighbors</span>' +
        '<span><b>⤵ list rows</b> → a flap slides down over the rows beneath</span>' +
        '<span><b>⤢ the lead story</b> → unfolds into the reading sheet</span>' +
        '<span><b>✕ / Esc / outside</b> → always folds back</span>' +
      '</div>';

    return buildTop() +
      '<div class="rb-wrap">' +
        '<div class="rb-mast"><h1>The Rules</h1>' +
          '<p>the front page of the book — every block folds out its own way</p></div>' +
        legend +
        '<div class="rb-grid">' +
          (hero ? buildHero(hero) : '') +
          (chars.length ? buildChars(chars) : '') +
          (conds ? buildConds(conds, glossary) : '') +
          (scene ? buildLair(scene) : '') +
        '</div>' +
      '</div>' +
      buildReader(hero);
  }

  // ── widget registration ──────────────────────────────────────────────────

  Chronicle.register('rulebook-frontpage', {
    init: function (el, config) {
      var self = this;
      this.el = el;
      this.config = config || {};
      el.classList.add('rb-root');
      this._injectStyles(el);
      this._setBody(buildLoading());

      var cid = this.config.campaignId;
      var base = cid
        ? '/api/v1/campaigns/' + cid + '/extensions/drawsteel/assets/'
        : '/extensions/drawsteel/assets/';

      function getJson(path) {
        return fetch(base + path).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
          return r.json();
        });
      }

      Promise.all([
        getJson('data/rulebook-frontpage.json'),
        getJson('data/rules-glossary.json')
      ]).then(function (res) {
        var items = unwrap(res[0]);
        var glossary = unwrap(res[1]);
        if (!items.length) throw new Error('rulebook-frontpage.json was empty');
        self._setBody(buildContent(items, glossary));
        self._mountEngine(el);
      }).catch(function (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('Rulebook Front Page: load failed', err);
        }
        self._setBody(buildError(err && err.message ? err.message : 'unknown error'));
      });
    },

    destroy: function (el) {
      if (this._fold && typeof this._fold.destroy === 'function') {
        try { this._fold.destroy(); } catch (e) { /* ignore */ }
      }
      this._fold = null;
      if (el) el.innerHTML = '';
    },

    // _mountEngine hands the built DOM to the shared fold engine when present;
    // absent the global, the static spread stays readable (graceful degrade).
    _mountEngine: function (el) {
      if (typeof RulebookFoldEngine !== 'undefined' && RulebookFoldEngine &&
          typeof RulebookFoldEngine.mount === 'function') {
        try { this._fold = RulebookFoldEngine.mount(el, {}); } catch (e) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Rulebook Front Page: fold engine mount failed', e);
          }
        }
      }
    },

    // _injectStyles adds the scoped stylesheet once (class guard).
    _injectStyles: function (el) {
      if (el.querySelector('style.rb-fp-styles')) return;
      var style = document.createElement('style');
      style.className = 'rb-fp-styles';
      style.textContent = css();
      el.insertBefore(style, el.firstChild);
    },

    // _setBody swaps the body markup while preserving the injected <style> node,
    // keeping .rb-top / .rb-wrap / overlays as direct children of .rb-root.
    _setBody: function (html) {
      var el = this.el;
      for (var i = el.childNodes.length - 1; i >= 0; i--) {
        var n = el.childNodes[i];
        if (n.nodeName !== 'STYLE') el.removeChild(n);
      }
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      while (tmp.firstChild) el.appendChild(tmp.firstChild);
    }
  });
})();
