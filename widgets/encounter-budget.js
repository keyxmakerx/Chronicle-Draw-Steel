/**
 * Draw Steel encounter budget — the panel inside Chronicle's encounter builder.
 *
 * Chronicle's builder fires `chronicle:encounter-draft` on document after every
 * change, with the draft and an empty slot element. This script listens from
 * the moment it loads and fills the slot with the party's Strength, the EV
 * spent against the published difficulty bands, the guideline checks and each
 * initiative group's EV.
 *
 * Every figure comes from DrawSteelFormulas (monster-engine.js) or the shipped
 * data/encounter-building.json. A figure those cannot cover (a creature typed
 * by name, a page with no EV, a hero with no level) is said to be missing and
 * left out of the total; nothing is guessed. Like the monster builder's checks,
 * the panel reports what the published guidelines say and is not a balance check.
 *
 * Strength counts the heroes' Victories as the rules do. The director may also
 * count the party a hero or two stronger or weaker; that one number is kept in
 * the campaign-wide system state and the panel always marks it as theirs.
 *
 * Layout: pure maths first (exported for node tests), then the page glue.
 */
var EncounterBudget = (function () {
  'use strict';

  var MINION_SET = 4;
  // The director may count the party as one or two heroes stronger or weaker
  // than the rules say; the panel always marks the result as changed by them.
  var MAX_NUDGE = 2;
  // Cached pages are re-read after this long so a hero levelling up shows
  // without a reload; the stale figure is drawn meanwhile.
  var PAGE_TTL_MS = 60000;

  function F() {
    if (typeof DrawSteelFormulas !== 'undefined' && DrawSteelFormulas) return DrawSteelFormulas;
    if (typeof require === 'function') {
      try { return require('./monster-engine.js').Formulas || null; } catch (e) { return null; }
    }
    return null;
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = (typeof v === 'number') ? v : Number(v);
    return isFinite(n) ? n : null;
  }

  function slug(v) { return String(v || '').trim().toLowerCase(); }

  function fieldsOf(entity) {
    return (entity && (entity.fields_data || entity.custom_fields)) || {};
  }

  function findBySlug(list, s) {
    if (!Array.isArray(list) || !s) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].slug === s) return list[i];
    return null;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // rulesFrom reads the guideline numbers out of data/encounter-building.json
  // so no limit is written into this file. A rule the data lacks yields null
  // and its check is left out.
  function rulesFrom(data) {
    var r = { maxAbove: null, maxAboveSolo: null, maxAboveVictories: null, widerLimitVictories: null,
      maxPerHero: null, minionMajorityPerHero: null, maxKinds: null, minionSet: MINION_SET, minionMinSets: null, victories: {} };
    function props(s) { var x = findBySlug(data, s); return (x && x.properties) || {}; }
    var lv = props('creature-level-limits');
    r.maxAbove = num(lv.max_levels_above_party);
    r.maxAboveSolo = num(lv.max_levels_above_party_solo);
    r.maxAboveVictories = num(lv.max_levels_above_party_with_6_victories);
    r.widerLimitVictories = num(lv.victories_for_wider_limit);
    var nc = props('number-of-creatures');
    r.maxPerHero = num(nc.max_creatures_per_hero);
    r.minionMajorityPerHero = num(nc.minion_majority_threshold_per_hero);
    r.maxKinds = num(nc.max_distinct_stat_blocks);
    var mf = props('minions-come-in-fours');
    r.minionSet = num(mf.purchase_multiple) || MINION_SET;
    r.minionMinSets = num(mf.recommended_minimum_sets);
    ['trivial', 'easy', 'standard', 'hard', 'extreme'].forEach(function (d) {
      var v = props('difficulty-' + d).victories;
      if (v !== undefined && v !== null) r.victories[d] = String(v);
    });
    return r;
  }

  // victoriesText turns the data's victories string ("0", "1", "2 or more")
  // into the line under the difficulty label.
  function victoriesText(v) {
    if (v === undefined || v === null) return '';
    if (v === '0') return 'Worth no Victories';
    if (v === '1') return 'Worth 1 Victory';
    return 'Worth ' + v + ' Victories';
  }

  // readHero turns a hero page's state into a level and Victories, or says
  // why there is no level. Victories is null when the page has none.
  function readHero(hero, entry) {
    var out = { id: hero.id, name: hero.name || '', level: null, victories: null, reason: '' };
    if (!entry || entry.status === 'loading') { out.reason = 'Reading its page'; return out; }
    if (entry.status !== 'ok') { out.reason = 'Its page could not be read'; return out; }
    var f = fieldsOf(entry.entity);
    var lvl = num(f.level);
    if (lvl === null || lvl < 1) { out.reason = 'No level on its page'; return out; }
    out.level = lvl;
    var v = num(f.victories);
    out.victories = (v !== null && v >= 0) ? v : null;
    return out;
  }

  // clampNudge keeps the director's stored adjustment a whole number of
  // heroes within the range the panel offers; anything else reads as none.
  function clampNudge(n) {
    var v = num(n);
    if (v === null || Math.floor(v) !== v) return 0;
    return Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, v));
  }

  // nudgeFrom reads the adjustment out of the campaign document's gm half.
  function nudgeFrom(doc) {
    return clampNudge(doc && doc.gm && doc.gm.extraHeroes);
  }

  // readCreature prices one creature row. state is 'priced', 'loading' or
  // 'missing'; only 'priced' rows enter the total. A page's own EV wins (the
  // director may have set it); with none, the published formula is used when
  // level and organization are both on the page, and the row says so.
  function readCreature(row, entry, orgs) {
    var out = {
      id: row.id, name: row.name || '', count: Math.max(1, num(row.count) || 1), group: row.group || 'A',
      state: 'missing', reason: '', level: null, organization: '', unitEv: null, evFrom: '', note: ''
    };
    if (!row.entityId) {
      out.reason = 'No page, so no EV. Add its creature page to count it.';
      return out;
    }
    if (!entry || entry.status === 'loading') { out.state = 'loading'; out.reason = 'Reading its page'; return out; }
    if (entry.status !== 'ok') { out.reason = 'Its page could not be read, so it is left out.'; return out; }
    var f = fieldsOf(entry.entity), Fm = F();
    out.level = num(f.level);
    out.organization = slug(f.organization);
    var org = findBySlug(orgs, out.organization);
    var formula = (Fm && org) ? Fm.encounterValue(out.level, org) : null;
    var stored = num(f.ev);
    if (stored !== null && stored > 0) {
      out.unitEv = stored; out.evFrom = 'page'; out.state = 'priced';
      if (formula && formula.sourced && formula.value !== stored) {
        out.note = 'EV ' + stored + ' is set on the page; the published formula gives ' + formula.value + '.';
      }
    } else if (formula && formula.sourced) {
      out.unitEv = formula.value; out.evFrom = 'formula'; out.state = 'priced';
      out.note = 'No EV on the page; this is the published formula for level ' + out.level + ' ' + out.organization + '.';
    } else {
      out.reason = 'No EV on this page yet.' + (formula && formula.notes && formula.notes[0] ? ' ' + formula.notes[0] : '');
    }
    return out;
  }

  // costOf is what a row spends. Minions are bought in sets of four, so a row
  // of five buys two sets.
  function costOf(c, setSize) {
    if (c.state !== 'priced') return null;
    if (c.organization === 'minion') {
      c.sets = Math.ceil(c.count / setSize);
      return c.sets * c.unitEv;
    }
    c.sets = null;
    return c.count * c.unitEv;
  }

  // compute turns the draft plus whatever pages have been read into the
  // panel's model. inp = { heroes: [{id, name, entry}], creatures: [{row, entry}],
  // orgs, rules }. Pure: no DOM, no fetching.
  function compute(inp) {
    var Fm = F(), rules = inp.rules || rulesFrom([]);
    var m = {
      ready: !!Fm, party: null, heroes: [], creatures: [], total: 0, unpriced: 0, difficulty: null,
      victories: '', bands: null, max: 0, groups: [], checks: []
    };
    if (!Fm) return m;

    var levels = [], vsum = 0, noVictories = [];
    (inp.heroes || []).forEach(function (h) {
      var r = readHero(h, h.entry);
      m.heroes.push(r);
      if (r.level === null) return;
      levels.push(r.level);
      if (r.victories !== null) vsum += r.victories; else noVictories.push(r.name);
    });
    if (levels.length) {
      var sum = 0;
      levels.forEach(function (l) { sum += l; });
      var avg = Math.round(sum / levels.length);
      var pes = Fm.partyEncounterStrength(levels);
      var one = Fm.heroEncounterStrength(avg);
      // A hero with no Victories on their page adds none to the average.
      var avgV = vsum / levels.length;
      var xv = Fm.victoriesExtraHeroes(avgV);
      if (pes.value !== null && one.value !== null && xv.value !== null) {
        var rulesEs = pes.value + (xv.value * one.value);
        var nudge = clampNudge(inp.nudge);
        // However far the director nudges, the party is never weaker than one hero.
        var es = Math.max(one.value, rulesEs + (nudge * one.value));
        var b = Fm.budgetBands(es, one.value);
        m.party = {
          es: es, rulesEs: rulesEs, one: one.value, count: levels.length, avgLevel: avg,
          avgVictories: Math.round(avgV * 10) / 10, victoryHeroes: xv.value, nudge: nudge,
          noVictories: noVictories, source: pes.source
        };
        m.bands = b.value;
        m.max = b.value.extreme.lower + (2 * one.value);
      }
    }

    (inp.creatures || []).forEach(function (cr) {
      var c = readCreature(cr.row, cr.entry, inp.orgs);
      c.cost = costOf(c, rules.minionSet);
      if (c.cost !== null) m.total += c.cost; else m.unpriced += c.count;
      m.creatures.push(c);
    });

    if (m.party) {
      var d = Fm.difficultyOf(m.total, m.party.es, m.party.one);
      m.difficulty = d.value;
      if (d.value) m.victories = victoriesText(rules.victories[d.value]);
    }
    m.groups = groupsOf(m.creatures, m.party);
    m.checks = checksOf(m, inp.heroes || [], rules);
    return m;
  }

  // groupsOf sums each initiative group. The published guideline asks for a
  // group between one hero's strength and two; it lets a single creature
  // exceed that, and a group with unpriced members is judged only where the
  // priced part already settles it.
  function groupsOf(creatures, party) {
    var by = {}, order = [];
    creatures.forEach(function (c) {
      if (!by[c.group]) { by[c.group] = { group: c.group, ev: 0, creatures: 0, unpriced: 0 }; order.push(c.group); }
      var g = by[c.group];
      g.creatures += c.count;
      if (c.cost !== null) g.ev += c.cost; else g.unpriced += c.count;
    });
    order.sort();
    return order.map(function (k) {
      var g = by[k];
      g.band = party ? [party.one, 2 * party.one] : null;
      g.off = false;
      if (party && g.creatures > 1) {
        if (g.ev > 2 * party.one) g.off = true;
        else if (g.ev < party.one && g.unpriced === 0) g.off = true;
      }
      return g;
    });
  }

  function names(list) { return list.join(', '); }

  // checksOf lists the published guidelines the draft can be held against.
  // A guideline the data does not carry, or the draft cannot be measured
  // against yet, is left out rather than passed.
  function checksOf(m, heroes, rules) {
    var out = [];
    function add(ok, text) { out.push({ ok: ok, text: text }); }

    var noLevel = m.heroes.filter(function (h) { return h.level === null; });
    if (heroes.length && noLevel.length) {
      add(false, names(noLevel.map(function (h) { return h.name; })) + ': ' + noLevel[0].reason.toLowerCase() +
        (noLevel.length > 1 ? ' (and the others listed)' : '') + ', so ' + (noLevel.length === 1 ? 'that hero is' : 'those heroes are') +
        ' left out of Strength. Set it yourself on the hero page.');
    }
    var unpriced = m.creatures.filter(function (c) { return c.state === 'missing'; });
    unpriced.forEach(function (c) { add(false, c.name + ': ' + c.reason); });

    var party = m.party;
    if (party && party.noVictories.length && party.noVictories.length < party.count) {
      add(false, names(party.noVictories) + ': no Victories on ' + (party.noVictories.length === 1 ? 'that hero page' : 'those hero pages') +
        ', so counted as 0. Set it yourself on the hero page.');
    }
    if (party && rules.maxAbove !== null) {
      // The published limit widens once the heroes average enough Victories;
      // solos keep their own, tighter limit either way.
      var wide = rules.maxAboveVictories !== null && rules.widerLimitVictories !== null &&
        party.avgVictories >= rules.widerLimitVictories;
      var maxAbove = wide ? rules.maxAboveVictories : rules.maxAbove;
      var over = [];
      m.creatures.forEach(function (c) {
        if (c.level === null) return;
        var limit = (c.organization === 'solo' && rules.maxAboveSolo !== null) ? rules.maxAboveSolo : maxAbove;
        if (c.level - party.avgLevel > limit) over.push(c.name + ' (level ' + c.level + (c.organization === 'solo' ? ', solo' : '') + ')');
      });
      var withV = wide ? ' with ' + rules.widerLimitVictories + ' or more Victories' : '';
      if (over.length) add(false, 'Above the published level limit for heroes of level ' + party.avgLevel + withV + ': ' + names(over) + '.');
      else if (m.creatures.some(function (c) { return c.level !== null; })) {
        add(true, 'No creature is more than ' + maxAbove + ' levels above the heroes' + (wide ? ', who have ' + rules.widerLimitVictories + ' or more Victories' : '') +
          ' (solos ' + (rules.maxAboveSolo !== null ? rules.maxAboveSolo : maxAbove) + ').');
      }
    }

    var minions = m.creatures.filter(function (c) { return c.organization === 'minion'; });
    if (minions.length) {
      var odd = minions.filter(function (c) { return c.count % rules.minionSet !== 0; });
      if (odd.length) {
        add(false, names(odd.map(function (c) { return c.name; })) + ': minions are bought ' + rules.minionSet +
          ' at a time, so ' + names(odd.map(function (c) { return plural(c.count, 'minion', 'minions') + ' count as ' + plural(c.sets, 'set', 'sets'); })) + '.');
      } else {
        add(true, 'Minions come in fours.');
      }
      var sets = 0;
      minions.forEach(function (c) { sets += Math.ceil(c.count / rules.minionSet); });
      if (rules.minionMinSets !== null && sets < rules.minionMinSets) {
        add(false, 'Minions are not effective in small numbers; the published advice is at least ' + rules.minionMinSets + ' sets.');
      }
    }

    var total = 0, minionTotal = 0;
    m.creatures.forEach(function (c) { total += c.count; if (c.organization === 'minion') minionTotal += c.count; });
    if (heroes.length && rules.maxPerHero !== null && total > 0) {
      var cap = rules.maxPerHero * heroes.length;
      add(total <= cap, plural(total, 'creature', 'creatures') + (total <= cap ? ', within ' : ', over ') + rules.maxPerHero + ' per hero (' + cap + ' for ' + plural(heroes.length, 'hero', 'heroes') + ').');
      if (rules.minionMajorityPerHero !== null && total > rules.minionMajorityPerHero * heroes.length) {
        if (minionTotal * 2 < total) {
          add(false, 'More than ' + rules.minionMajorityPerHero + ' creatures per hero, so at least half should be minions.');
        }
      }
    }
    if (rules.maxKinds !== null && m.creatures.length > rules.maxKinds) {
      add(false, plural(m.creatures.length, 'different stat block', 'different stat blocks') + '; the published advice is no more than ' + rules.maxKinds + '.');
    }
    return out;
  }

  // draftOf builds compute's input from the event detail and the page cache.
  // cache maps entity id to {status, entity}; a missing id is still loading.
  function draftOf(detail, cache, orgs, rules, nudge) {
    var enc = (detail && detail.encounter) || {};
    return {
      heroes: (enc.heroes || []).map(function (h) { return { id: h.id, name: h.name, entry: cache[h.id] || null }; }),
      creatures: (enc.creatures || []).map(function (c) { return { row: c, entry: c.entityId ? (cache[c.entityId] || null) : null }; }),
      orgs: orgs || [],
      rules: rules || rulesFrom([]),
      nudge: clampNudge(nudge)
    };
  }

  // partyText is the line saying where Strength comes from, before the
  // director's adjustment: "4 heroes + 1 for Victories".
  function partyText(p) {
    var t = plural(p.count, 'hero', 'heroes');
    if (p.victoryHeroes > 0) return t + ' + ' + p.victoryHeroes + ' for Victories';
    if (p.avgVictories > 0) return t + ' (averaging ' + plural(p.avgVictories, 'Victory', 'Victories') + '; the rules add a hero per ' + victoriesPerHero() + ')';
    return t;
  }

  function victoriesPerHero() {
    var Fm = F();
    return Fm && Fm.VICTORIES_PER_EXTRA_HERO;
  }

  // nudgeText names the director's adjustment in the stepper.
  function nudgeText(n) {
    if (!n) return 'the rules say';
    return (n > 0 ? '+' : '−') + plural(Math.abs(n), 'hero', 'heroes');
  }

  // changedText marks a Strength the director moved off the rules' figure.
  function changedText(p) {
    if (!p || p.es === p.rulesEs) return '';
    return 'Changed by you (the rules give ' + p.rulesEs + ').';
  }

  var API = {
    MINION_SET: MINION_SET, MAX_NUDGE: MAX_NUDGE, PAGE_TTL_MS: PAGE_TTL_MS,
    rulesFrom: rulesFrom, victoriesText: victoriesText, readHero: readHero, readCreature: readCreature,
    clampNudge: clampNudge, nudgeFrom: nudgeFrom, partyText: partyText, nudgeText: nudgeText, changedText: changedText,
    costOf: costOf, compute: compute, groupsOf: groupsOf, checksOf: checksOf, draftOf: draftOf
  };

  // ── The page ───────────────────────────────────────────────────────────────

  var CSS = [
    '.ds-eb{display:flex;flex-direction:column;gap:10px;color:var(--color-text-body,#374151);font-size:13px;line-height:1.45}',
    '.ds-eb-lab{margin:0;display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb-lab b{font-size:13px;letter-spacing:0;text-transform:none;color:var(--color-text-primary,#111827)}',
    '.ds-eb-top{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}',
    '.ds-eb-total{font-size:22px;font-weight:700;color:var(--color-text-primary,#111827);font-variant-numeric:tabular-nums}',
    '.ds-eb-total small{font-size:12px;font-weight:500;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb-diff{font-size:12px;font-weight:700;padding:1px 9px;border-radius:999px;border:1px solid currentColor}',
    '.ds-eb-diff[data-d=trivial]{color:#64748b}.ds-eb-diff[data-d=easy]{color:#15803d}.ds-eb-diff[data-d=standard]{color:#4f46e5}.ds-eb-diff[data-d=hard]{color:#b45309}.ds-eb-diff[data-d=extreme]{color:#b91c1c}',
    '.ds-eb-sub{font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb-barwrap{position:relative;padding-top:3px}',
    '.ds-eb-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--color-bg-tertiary,#f3f4f6)}',
    '.ds-eb-bar span{height:100%;opacity:.6}',
    '.ds-eb-bar span[data-d=trivial]{background:#94a3b8}.ds-eb-bar span[data-d=easy]{background:#22c55e}.ds-eb-bar span[data-d=standard]{background:#6366f1}.ds-eb-bar span[data-d=hard]{background:#f59e0b}.ds-eb-bar span[data-d=extreme]{background:#ef4444}',
    '.ds-eb-mark{position:absolute;top:0;width:3px;height:18px;border-radius:2px;background:var(--color-text-primary,#111827);transition:left .25s ease}',
    '@media (prefers-reduced-motion:reduce){.ds-eb-mark{transition:none}}',
    '.ds-eb-scale{display:flex;justify-content:space-between;font-size:11px;font-variant-numeric:tabular-nums;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}',
    '.ds-eb li{display:flex;gap:8px}',
    '.ds-eb li i{font-style:normal;font-weight:700;width:1em;flex-shrink:0}',
    '.ds-eb li.ok i{color:#15803d}.ds-eb li.warn i{color:#b45309}',
    '.ds-eb-cost{justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}',
    '.ds-eb-cost span:first-child{min-width:0;overflow-wrap:anywhere}',
    '.ds-eb-cost .none{color:var(--color-text-secondary,#6b7280);text-align:right}',
    '.ds-eb-groups{display:flex;flex-wrap:wrap;gap:6px}',
    '.ds-eb-chip{font-size:12px;padding:2px 9px;border-radius:8px;border:1px solid var(--color-border,#e5e7eb);background:var(--color-card-bg,#fff);font-variant-numeric:tabular-nums}',
    '.ds-eb-chip b{color:var(--color-text-primary,#111827)}',
    '.ds-eb-chip.off{border-color:#b45309}',
    '.ds-eb-note{margin:0;font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb-note.err{color:var(--color-danger,#b91c1c)}',
    '.ds-eb-party{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:var(--color-text-secondary,#6b7280)}',
    '.ds-eb-step{display:inline-flex;align-items:center;border:1px solid var(--color-border,#e5e7eb);border-radius:999px;background:var(--color-card-bg,#fff)}',
    '.ds-eb .ds-eb-step button{all:unset;box-sizing:border-box;width:28px;height:26px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;font-weight:700;color:var(--color-text-primary,#111827);border-radius:999px}',
    '.ds-eb .ds-eb-step button:hover{background:var(--color-bg-tertiary,#f3f4f6)}',
    '.ds-eb .ds-eb-step button:focus-visible{outline:2px solid var(--color-accent,#4f46e5);outline-offset:1px}',
    '.ds-eb .ds-eb-step button[disabled]{opacity:.35;cursor:default;background:none}',
    '.ds-eb-step output{padding:0 4px;min-width:6.5em;text-align:center;font-weight:600;color:var(--color-text-primary,#111827);font-variant-numeric:tabular-nums}',
    '.ds-eb-step.moved{border-color:var(--color-accent,#4f46e5)}'
  ].join('');

  function injectStyles() {
    if (typeof document === 'undefined' || !document.head || document.querySelector('style[data-ds-encounter-budget]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-ds-encounter-budget', 'true');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // h builds an element; text always goes in as textContent.
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null && text !== '') el.textContent = text;
    return el;
  }

  function line(list, ok, text) {
    var li = h('li', ok ? 'ok' : 'warn');
    li.appendChild(h('i', '', ok ? '✓' : '!'));
    li.appendChild(h('span', '', text));
    list.appendChild(li);
  }

  // costText is the right-hand column of the "how it adds up" list.
  function costText(c, setSize) {
    if (c.state === 'loading') return 'Reading its page';
    if (c.state !== 'priced') return 'Not counted';
    if (c.organization === 'minion') {
      return plural(c.sets, 'set', 'sets') + ' × ' + c.unitEv + ' = ' + c.cost + ' EV';
    }
    return (c.count > 1 ? c.count + ' × ' + c.unitEv + ' = ' : '') + c.cost + ' EV';
  }

  // draw paints the model into the slot. Called synchronously from cache on
  // every draft event and again whenever a fetch lands.
  function draw(slot, m, ctx) {
    injectStyles();
    slot.textContent = '';
    var root = h('div', 'ds-eb');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Draw Steel encounter budget');
    slot.appendChild(root);

    if (!m.ready) {
      root.appendChild(h('p', 'ds-eb-note', 'The Draw Steel formulas did not load, so there is no budget to show.'));
      return;
    }
    var lab = h('p', 'ds-eb-lab', 'Budget');
    if (m.party) lab.appendChild(h('b', '', 'Strength ' + m.party.es));
    root.appendChild(lab);
    if (m.party) drawParty(root, m.party, ctx);

    if (!m.party) {
      var anyLoading = m.heroes.some(function (x) { return x.reason === 'Reading its page'; });
      root.appendChild(h('p', 'ds-eb-note', m.heroes.length
        ? (anyLoading ? 'Reading the heroes’ pages…' : 'None of the ticked heroes has a level on its page, so there is no Strength to budget against. Set it yourself on a hero page.')
        : 'Tick the heroes who are fighting to see the budget.'));
    } else {
      var top = h('div', 'ds-eb-top');
      var tot = h('span', 'ds-eb-total', String(m.total));
      tot.appendChild(h('small', '', ' EV spent'));
      top.appendChild(tot);
      if (m.difficulty) {
        var dl = m.difficulty.charAt(0).toUpperCase() + m.difficulty.slice(1);
        var chip = h('span', 'ds-eb-diff', dl);
        chip.setAttribute('data-d', m.difficulty);
        top.appendChild(chip);
        if (m.victories) top.appendChild(h('span', 'ds-eb-sub', m.victories));
      }
      root.appendChild(top);
      if (m.unpriced) {
        root.appendChild(h('p', 'ds-eb-note', 'Priced creatures only; ' + plural(m.unpriced, 'creature is', 'creatures are') + ' not counted yet.'));
      }
      drawBar(root, m);
    }

    if (m.creatures.length) {
      var costs = h('ul', 'ds-eb-costs');
      costs.setAttribute('aria-label', 'What each creature costs');
      m.creatures.forEach(function (c) {
        var li = h('li', 'ds-eb-cost');
        li.appendChild(h('span', '', c.name));
        li.appendChild(h('span', c.state === 'priced' ? '' : 'none', costText(c, ctx.rules.minionSet)));
        costs.appendChild(li);
      });
      root.appendChild(costs);
    }

    if (m.checks.length) {
      var list = h('ul', 'ds-eb-checks');
      m.checks.forEach(function (c) { line(list, c.ok, c.text); });
      root.appendChild(list);
    }

    if (m.groups.length) {
      var gl = h('p', 'ds-eb-lab', 'Initiative groups');
      if (m.party) gl.appendChild(h('b', '', 'each about ' + m.party.one + ' to ' + (2 * m.party.one) + ' EV for this party'));
      root.appendChild(gl);
      var wrap = h('div', 'ds-eb-groups');
      m.groups.forEach(function (g) {
        var chip2 = h('span', 'ds-eb-chip' + (g.off ? ' off' : ''));
        chip2.appendChild(document.createTextNode('Group ' + g.group + ' '));
        chip2.appendChild(h('b', '', g.ev + ' EV'));
        var extra = '';
        if (g.unpriced) extra += ' + ' + plural(g.unpriced, 'creature', 'creatures') + ' not counted';
        if (g.off && g.band) extra += ' · outside ' + g.band[0] + ' to ' + g.band[1];
        if (extra) chip2.appendChild(document.createTextNode(extra));
        wrap.appendChild(chip2);
      });
      root.appendChild(wrap);
    }

    root.appendChild(h('p', 'ds-eb-note', 'These checks follow the published guidelines (' +
      (F() ? F().ENCOUNTER_SOURCE : 'Draw Steel Monsters Book') + '). They are not a balance check.'));
  }

  // drawParty is the line under the label: where Strength comes from and the
  // director's stepper. Without a store to save to, the stepper is left out
  // and the line says why.
  function drawParty(root, p, ctx) {
    var st = ctx.store || { status: 'ok', msg: '' };
    var row = h('div', 'ds-eb-party');
    var canStep = st.status === 'ok' || st.status === 'loading';
    row.appendChild(h('span', '', partyText(p) + (canStep ? ', and you count them as' : '')));
    if (canStep) {
      var step = h('span', 'ds-eb-step' + (p.nudge ? ' moved' : ''));
      step.setAttribute('role', 'group');
      step.setAttribute('aria-label', 'Count the party stronger or weaker than the rules say');
      var minus = h('button', '', '−');
      minus.type = 'button';
      minus.setAttribute('data-step', '-1');
      minus.setAttribute('aria-label', 'One hero weaker');
      minus.disabled = st.status !== 'ok' || p.nudge <= -MAX_NUDGE;
      var out = h('output', '', st.status === 'loading' ? '…' : nudgeText(p.nudge));
      out.setAttribute('aria-live', 'polite');
      var plus = h('button', '', '+');
      plus.type = 'button';
      plus.setAttribute('data-step', '1');
      plus.setAttribute('aria-label', 'One hero stronger');
      plus.disabled = st.status !== 'ok' || p.nudge >= MAX_NUDGE;
      [minus, plus].forEach(function (b) {
        b.addEventListener('click', function () {
          if (ctx.onStep) ctx.onStep(Number(b.getAttribute('data-step')));
        });
      });
      step.appendChild(minus);
      step.appendChild(out);
      step.appendChild(plus);
      row.appendChild(step);
    }
    root.appendChild(row);
    var changed = changedText(p);
    if (changed) root.appendChild(h('p', 'ds-eb-note', changed));
    if (st.msg) root.appendChild(h('p', 'ds-eb-note' + (st.err ? ' err' : ''), st.msg));
  }

  function drawBar(root, m) {
    var wrap = h('div', 'ds-eb-barwrap');
    var bar = h('div', 'ds-eb-bar');
    bar.setAttribute('aria-hidden', 'true');
    var b = m.bands, one = m.party.one;
    var edges = [
      ['trivial', 0, Math.max(b.trivial.upper, 0)], ['easy', Math.max(b.easy.lower, 0), b.easy.upper],
      ['standard', b.standard.lower, b.standard.upper], ['hard', b.hard.lower, b.hard.upper], ['extreme', b.extreme.lower, m.max]
    ];
    edges.forEach(function (e) {
      var s = h('span');
      s.setAttribute('data-d', e[0]);
      s.style.width = (Math.max(e[2] - e[1], 0) / m.max * 100) + '%';
      bar.appendChild(s);
    });
    var mark = h('div', 'ds-eb-mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.style.left = 'calc(' + (Math.min(m.total, m.max) / m.max * 100) + '% - 1px)';
    wrap.appendChild(bar);
    wrap.appendChild(mark);
    root.appendChild(wrap);
    var scale = h('div', 'ds-eb-scale');
    scale.setAttribute('aria-hidden', 'true');
    [0, b.easy.lower, b.standard.lower, b.hard.lower, b.extreme.lower].forEach(function (v) {
      scale.appendChild(h('span', '', String(Math.max(v, 0))));
    });
    root.appendChild(scale);
    // The bar is decorative; the band edges are also said in words.
    root.appendChild(h('p', 'ds-eb-note', 'Standard is ' + b.standard.lower + ' to ' + b.standard.upper + ' EV; hard is up to ' + b.hard.upper +
      '; one hero is worth ' + one + '.'));
  }

  // ── Fetching and the draft listener ────────────────────────────────────────

  // Pages and package data are cached for the life of the page: the draft
  // event fires on every keystroke of the encounter's name, so a render must
  // never wait on, or repeat, a fetch.
  var pages = {};      // 'cid/id' -> {status, entity, at, inflight}
  var refs = {};       // cid -> {orgs, rules, status}
  var party = {};      // cid -> the director's adjustment: {status, value, preview, at, inflight, saving, msg, err, chain}
  var focusStep = 0;   // the stepper button to refocus after a redraw, by direction
  var current = null;  // the latest event detail; its slot is the only one alive

  function getJSON(url) {
    return Chronicle.apiFetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  }

  function unwrap(d) {
    if (Array.isArray(d)) return d;
    return (d && (d.data || d.results)) || [];
  }

  function rerender() {
    if (!current || !current.slot || !current.slot.isConnected) return;
    show(current);
  }

  // A failed read is retried once its TTL passes rather than kept for the
  // life of the page, so one network blip doesn't leave the budget without
  // its organization templates and rules.
  function ensureRefs(cid) {
    var r0 = refs[cid];
    if (r0 && !(r0.status === 'failed' && (Date.now() - r0.at) >= PAGE_TTL_MS)) return;
    refs[cid] = { status: 'loading', orgs: r0 ? r0.orgs : [], rules: r0 ? r0.rules : rulesFrom([]) };
    var base = '/campaigns/' + encodeURIComponent(cid) + '/systems/drawsteel/data/';
    function one(f) { return getJSON(base + f).then(function (d) { return Array.isArray(d) ? d : unwrap(d); }, function () { return null; }); }
    Promise.all([one('organization-templates.json'), one('encounter-building.json')]).then(function (r) {
      var failed = r[0] === null || r[1] === null;
      refs[cid] = { status: failed ? 'failed' : 'ok', at: Date.now(), orgs: r[0] || [], rules: rulesFrom(r[1] || []) };
      rerender();
    });
  }

  function partyUrl(cid) {
    return '/campaigns/' + encodeURIComponent(cid) + '/campaign-system-state/drawsteel/party';
  }

  function partyOf(cid) {
    return party[cid] || (party[cid] = {
      status: 'loading', value: 0, preview: null, at: 0, inflight: false, saving: 0, msg: '', err: false,
      chain: Promise.resolve()
    });
  }

  // ensureParty reads the director's adjustment, again after the TTL so a
  // co-director's change shows. A Chronicle without the campaign-wide store
  // answers 404 (or 405); the panel then follows the rules and says so.
  function ensureParty(cid) {
    var p = partyOf(cid);
    if (p.inflight || p.saving || (p.at && (Date.now() - p.at) < PAGE_TTL_MS)) return;
    p.inflight = true;
    Chronicle.apiFetch(partyUrl(cid)).then(function (r) {
      if (r.status === 404 || r.status === 405) { p.status = 'unsupported'; p.msg = 'This Chronicle cannot save an adjustment yet, so Strength follows the rules.'; return null; }
      if (!r.ok) throw new Error('party -> ' + r.status);
      return r.json().then(function (doc) { p.status = 'ok'; p.value = nudgeFrom(doc); p.msg = ''; p.err = false; });
    }).catch(function () {
      // A failed read keeps an earlier good answer rather than blanking it.
      if (p.status !== 'ok') { p.status = 'failed'; p.msg = 'Could not read your adjustment, so Strength follows the rules.'; p.err = true; }
    }).then(function () {
      p.inflight = false; p.at = Date.now();
      rerender();
    });
  }

  // step saves the stepper's new value. Saves run one after another, so a
  // quick second click can never land before the first and be overwritten.
  function step(cid, by) {
    var p = partyOf(cid);
    if (p.status !== 'ok') return;
    var from = p.preview !== null ? p.preview : p.value;
    var next = clampNudge(from + by);
    if (next === from) return;
    focusStep = by;
    p.preview = next; p.saving++; p.msg = ''; p.err = false;
    rerender();
    var body = { gm: next ? { extraHeroes: next } : {} };
    p.chain = p.chain.then(function () {
      return Chronicle.apiFetch(partyUrl(cid), { method: 'PUT', body: body }).then(function (res) {
        if (res.status === 403) throw new Error('forbidden');
        if (!res.ok) throw new Error('save -> ' + res.status);
        return res.json();
      }).then(function (doc) {
        p.value = nudgeFrom(doc); p.at = Date.now();
        if (p.saving === 1) p.preview = null;
      }, function (e) {
        p.preview = null;
        p.msg = (e && e.message === 'forbidden') ? 'Only the director can change this.' : 'Could not save your adjustment. Try again.';
        p.err = true;
      }).then(function () {
        p.saving--;
        rerender();
      });
    });
  }

  function ensurePage(cid, id) {
    var key = cid + '/' + id, e = pages[key];
    if (e && (e.inflight || (Date.now() - e.at) < PAGE_TTL_MS)) return;
    if (!e) e = pages[key] = { status: 'loading', entity: null, at: Date.now(), inflight: false };
    e.inflight = true;
    getJSON('/api/v1/campaigns/' + encodeURIComponent(cid) + '/entities/' + encodeURIComponent(id)).then(function (entity) {
      e.status = 'ok'; e.entity = entity;
    }, function () {
      // A failed read keeps an earlier good answer rather than blanking it.
      if (e.status !== 'ok') e.status = 'failed';
    }).then(function () {
      e.inflight = false; e.at = Date.now();
      rerender();
    });
  }

  function show(detail) {
    var cid = String(detail.campaignId || '');
    var r = refs[cid] || { orgs: [], rules: rulesFrom([]) };
    var cache = {};
    var enc = detail.encounter || {};
    (enc.heroes || []).forEach(function (x) { cache[x.id] = pages[cid + '/' + x.id] || null; });
    (enc.creatures || []).forEach(function (x) { if (x.entityId) cache[x.entityId] = pages[cid + '/' + x.entityId] || null; });
    var p = partyOf(cid);
    var nudge = p.status === 'ok' ? (p.preview !== null ? p.preview : p.value) : 0;
    var m = compute(draftOf(detail, cache, r.orgs, r.rules, nudge));
    draw(detail.slot, m, {
      rules: r.rules, store: p,
      onStep: function (by) { step(cid, by); }
    });
    restoreFocus(detail.slot);
  }

  // The panel is redrawn from scratch, so a stepper click drops focus to the
  // page; put it back on the same button, or its twin once that end is
  // reached. Focus the director has since moved elsewhere is left alone.
  function restoreFocus(slot) {
    if (!focusStep || !slot.querySelector) return;
    var active = document.activeElement;
    if (active && active !== document.body && !slot.contains(active)) { focusStep = 0; return; }
    var want = slot.querySelector('.ds-eb-step button[data-step="' + focusStep + '"]');
    var other = slot.querySelector('.ds-eb-step button[data-step="' + (-focusStep) + '"]');
    var b = (want && !want.disabled) ? want : other;
    if (b && !b.disabled && b.focus) b.focus();
  }

  function onDraft(ev) {
    var d = ev && ev.detail;
    if (!d || !d.slot || !d.campaignId || typeof Chronicle === 'undefined') return;
    current = d;
    var cid = String(d.campaignId), enc = d.encounter || {};
    ensureRefs(cid);
    ensureParty(cid);
    (enc.heroes || []).forEach(function (x) { if (x.id) ensurePage(cid, x.id); });
    (enc.creatures || []).forEach(function (x) { if (x.entityId) ensurePage(cid, x.entityId); });
    show(d);
  }

  // ── Forms for the builder's stages ────────────────────────────────────────

  // The builder asks which other forms each creature page has (the stat
  // block's forms, in the page's system state) so a stage can name one. Only
  // the director reaches the builder, and only the gm half lists the forms.
  var FORM_ID = /^[a-z0-9]{1,24}$/;
  var formsCache = {};

  function stateUrl(cid, eid, key) {
    return '/campaigns/' + encodeURIComponent(cid) + '/entities/' + encodeURIComponent(eid) + '/system-state/drawsteel/' + key;
  }

  function getState(url) {
    return Chronicle.apiFetch(url).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  }

  // pageForms is [{id, name}] in the director's order; [] when the page has
  // none or they could not be read.
  function pageForms(cid, eid) {
    var key = cid + '/' + eid, hit = formsCache[key];
    if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.p;
    var p = getState(stateUrl(cid, eid, 'forms')).then(function (doc) {
      var order = (doc && doc.gm && Array.isArray(doc.gm.order) ? doc.gm.order : []).filter(function (id) {
        return typeof id === 'string' && FORM_ID.test(id);
      }).slice(0, 12);
      return Promise.all(order.map(function (id) {
        return getState(stateUrl(cid, eid, 'form-' + id)).then(function (d) {
          var f = d && d.gm;
          if (!f || f.id !== id) return null;
          return { id: id, name: String(f.name || '').trim().slice(0, 80) || 'Unnamed form' };
        });
      }));
    }).then(function (list) { return list.filter(Boolean); });
    formsCache[key] = { at: Date.now(), p: p };
    return p;
  }

  function onForms(ev) {
    var d = ev && ev.detail;
    if (!d || typeof d.reply !== 'function' || !d.campaignId || typeof Chronicle === 'undefined') return;
    var cid = String(d.campaignId);
    var ids = (Array.isArray(d.entityIds) ? d.entityIds : []).map(String).filter(Boolean).slice(0, 30);
    Promise.all(ids.map(function (eid) { return pageForms(cid, eid); })).then(function (lists) {
      var out = {};
      ids.forEach(function (eid, i) { out[eid] = lists[i]; });
      d.reply(out);
    });
  }

  if (typeof document !== 'undefined' && document.addEventListener && typeof Chronicle !== 'undefined') {
    document.addEventListener('chronicle:encounter-draft', onDraft);
    document.addEventListener('chronicle:encounter-forms', onForms);
  }

  API.onDraft = onDraft;
  API.onForms = onForms;
  return API;
})();

// The manifest needs a registered widget; this one has nothing to mount. The
// panel arrives through the builder's draft event, listened for above.
if (typeof Chronicle !== 'undefined' && Chronicle && Chronicle.register) {
  Chronicle.register('encounter-budget', {
    init: function () {},
    destroy: function () {}
  });
}

// Test seam: expose the pure API for Node unit tests. Inert in a browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EncounterBudget;
}
