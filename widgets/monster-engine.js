/**
 * Draw Steel Monster Engine — pure encounter math for the monster builder.
 *
 * Phase 1 scope: the grounded EV budget only (party size + level -> EV budget).
 * Every number traces to docs/monster-builder.md's encounter rules and the
 * organization templates (data/organization-templates.json). NO Draw Steel math
 * is invented here.
 *
 * Later phases (suggestion engine, potency, tier fill) extend this module rather
 * than relocate it, so it is created now as the single home for builder math.
 *
 * Loading: in the browser this attaches the `MonsterEngine` global, served via
 * the manifest `text_renderers` section which loads BEFORE widget scripts (the
 * same seam DrawSteelRefRenderer uses). In Node it exports the same object so the
 * math is unit-tested off-DOM (tools/test-*.mjs, `node --test`).
 */
var MonsterEngine = (function () {
  'use strict';

  // heroesPerCreature parses an org template's `hero_ratio`, written
  // "creatures:heroes" (minion "8:1" = 8 creatures per 1 hero; solo "1:6" = 1
  // creature per 6 heroes), into the number of heroes ONE creature of that org
  // is worth. Returns null for a malformed ratio.
  function heroesPerCreature(ratio) {
    if (typeof ratio !== 'string') return null;
    var parts = ratio.split(':');
    if (parts.length !== 2) return null;
    var creatures = parseFloat(parts[0]);
    var heroes = parseFloat(parts[1]);
    if (!isFinite(creatures) || !isFinite(heroes) || creatures <= 0) return null;
    return heroes / creatures;
  }

  // standardEvPerHeroLevel derives, straight from the org templates, the EV a
  // single hero-level is worth against a "standard" (1:1) opponent. For every
  // org tier `ev_multiplier / heroesPerCreature` equals the Platoon multiplier
  // of 4 (Platoon is the 1:1 "standard" org, docs/monster-builder.md §2.1/§4.1)
  // — EXCEPT the Minion, whose squad EV is an intentional outlier. We take the
  // MEDIAN of that ratio across all orgs so the Minion cannot skew it. The
  // result (4 for the shipped data) is the grounded "EV per hero per level".
  function standardEvPerHeroLevel(orgTemplates) {
    var ratios = [];
    var list = orgTemplates || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var hpc = heroesPerCreature(o && o.hero_ratio);
      if (hpc === null || hpc <= 0) continue;
      var mult = Number(o.ev_multiplier);
      if (!isFinite(mult)) continue;
      ratios.push(mult / hpc);
    }
    if (!ratios.length) return null;
    ratios.sort(function (a, b) { return a - b; });
    var mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  }

  // encounterBudget grounds the total EV a director may spend against a party:
  //   party size x party level x standard EV-per-hero-level.
  // This replaces the builder's old crude `partySize * partyLevel`. Returns 0
  // when the org data is unavailable (caller falls back to a plain display).
  function encounterBudget(partySize, partyLevel, orgTemplates) {
    var size = Number(partySize);
    var level = Number(partyLevel);
    if (!isFinite(size) || !isFinite(level) || size <= 0 || level <= 0) return 0;
    var per = standardEvPerHeroLevel(orgTemplates);
    if (per === null) return 0;
    return Math.round(size * level * per);
  }

  // creatureEV is a single creature's encounter value: level x its org's
  // ev_multiplier (docs/monster-builder.md §4.1). `org` may be the template
  // object or a raw multiplier number.
  function creatureEV(level, org) {
    var lvl = Number(level);
    var mult = (org && typeof org === 'object') ? Number(org.ev_multiplier) : Number(org);
    if (!isFinite(lvl) || !isFinite(mult)) return 0;
    return lvl * mult;
  }

  // villainActionCount reads the data-driven villain-action requirement for an
  // org template (leaders/solos = 3, all others = 0). This value replaces the
  // hardcoded 'leader'/'solo' string checks throughout the builder.
  function villainActionCount(org) {
    if (!org || typeof org.villain_action_count !== 'number') return 0;
    return org.villain_action_count;
  }

  // evMeter summarizes one creature's spend against the party budget for the
  // live "spent X / budget Y" meter. `copies` is the balanced multiple of this
  // creature that fills the budget (>= 1) — the bridge to Phase 3 encounter
  // assembly (many creatures against one budget).
  function evMeter(creatureEv, budget) {
    var ev = Number(creatureEv);
    var b = Number(budget);
    var safeEv = (isFinite(ev) && ev > 0) ? ev : 0;
    var safeB = (isFinite(b) && b > 0) ? b : 0;
    if (!safeEv || !safeB) {
      return { spent: safeEv, budget: safeB, copies: 1, ratio: 0 };
    }
    return { spent: safeEv, budget: safeB, copies: Math.max(1, Math.round(safeB / safeEv)), ratio: safeEv / safeB };
  }

  return {
    heroesPerCreature: heroesPerCreature,
    standardEvPerHeroLevel: standardEvPerHeroLevel,
    encounterBudget: encounterBudget,
    creatureEV: creatureEV,
    villainActionCount: villainActionCount,
    evMeter: evMeter
  };
})();

// Test seam: expose the pure API for Node unit tests. Inert in a browser (no
// CommonJS `module`), so the widget runtime is unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MonsterEngine;
}
