/**
 * Draw Steel Monster Party — pure party read + profile derivation.
 *
 * One job: turn the campaign's live hero entities (drawsteel-character) into a
 * PartyProfile the monster builder reasons about. Two parts:
 *   - fetchParty(cid[, apiFetch]) — the two-step syncapi read (resolve the hero
 *     type id, then page through the entities carrying fields_data inline).
 *   - deriveParty(heroes) — PURE: reduce fields_data to a PartyProfile.
 *
 * Redo ruling Q4 (BINDING): heroes missing a stat are skipped PER-STAT and the
 * profile carries an honest `coverage` map — never average nulls as zeros, which
 * would poison weakest-defense targeting. No heroes -> null (manual mode).
 *
 * Loading mirrors DrawSteelRefRenderer: browser attaches the `MonsterParty`
 * global (served via manifest text_renderers, loaded before the widget); Node
 * exports the same object for off-DOM tests.
 */
var MonsterParty = (function () {
  'use strict';

  // The five Draw Steel characteristics; also the party's defenses (a power
  // roll targets one of these), so the lowest average is the "weakest defense".
  var STAT_KEYS = ['might', 'agility', 'reason', 'intuition', 'presence'];

  // fieldsOf accepts either a syncapi entity ({fields_data:{...}}) or a bare
  // fields map, so tests can pass fixtures in either shape.
  function fieldsOf(hero) {
    if (hero && hero.fields_data && typeof hero.fields_data === 'object') return hero.fields_data;
    return hero || {};
  }

  // num coerces a stored field value to a finite number, or null if absent /
  // blank / non-numeric (fields_data often stores numbers as strings). null is
  // the "this hero doesn't have this stat" signal that drives coverage honesty.
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = (typeof v === 'number') ? v : Number(v);
    return isFinite(n) ? n : null;
  }

  function mean(arr) {
    if (!arr || !arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  // collectNumbers gathers the present, numeric values of one field across the
  // party (skipping heroes that lack it) plus a coverage string "have of total".
  function collectNumbers(heroes, key) {
    var vals = [];
    for (var i = 0; i < heroes.length; i++) {
      var n = num(fieldsOf(heroes[i])[key]);
      if (n !== null) vals.push(n);
    }
    return { values: vals, coverage: vals.length + ' of ' + heroes.length };
  }

  // parseDamageList splits a free-text immunities/weaknesses field ("Fire 5,
  // Cold; psychic") into distinct damage-type tokens: strip magnitudes, trim,
  // de-dupe case-insensitively while preserving the first-seen display form.
  function parseDamageList(str) {
    if (!str || typeof str !== 'string') return [];
    var parts = str.split(/[,;\n/]+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      var k = t.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(t); }
    }
    return out;
  }

  // deriveParty reduces the party's fields_data to a PartyProfile (redo §3.1).
  // Returns null for an empty/absent party so the builder shows manual mode.
  function deriveParty(heroes) {
    if (!heroes || !heroes.length) return null;
    var total = heroes.length;
    var coverage = {};

    var levelC = collectNumbers(heroes, 'level');
    coverage.level = levelC.coverage;
    var levelAvg = mean(levelC.values);
    var levelSpread = levelC.values.length
      ? [Math.min.apply(null, levelC.values), Math.max.apply(null, levelC.values)]
      : null;

    var defenses = {};
    var weakestDefense = null;
    var weakestValue = null;
    for (var s = 0; s < STAT_KEYS.length; s++) {
      var key = STAT_KEYS[s];
      var c = collectNumbers(heroes, key);
      coverage[key] = c.coverage;
      var m = mean(c.values);
      defenses[key] = m; // null when no hero carries it — never coerced to 0
      if (m !== null && (weakestValue === null || m < weakestValue)) {
        weakestValue = m;
        weakestDefense = key;
      }
    }

    var staminaC = collectNumbers(heroes, 'stamina_max');
    coverage.stamina_max = staminaC.coverage;
    var speedC = collectNumbers(heroes, 'speed');
    coverage.speed = speedC.coverage;

    var immunities = [];
    var weaknesses = [];
    var immSeen = {};
    var wkSeen = {};
    var sizes = [];
    var sizeSeen = {};
    for (var i = 0; i < heroes.length; i++) {
      var f = fieldsOf(heroes[i]);
      var il = parseDamageList(f.immunities);
      for (var a = 0; a < il.length; a++) {
        var ik = il[a].toLowerCase();
        if (!immSeen[ik]) { immSeen[ik] = 1; immunities.push(il[a]); }
      }
      var wl = parseDamageList(f.weaknesses);
      for (var b = 0; b < wl.length; b++) {
        var wk = wl[b].toLowerCase();
        if (!wkSeen[wk]) { wkSeen[wk] = 1; weaknesses.push(wl[b]); }
      }
      var sz = f.size;
      if (sz && !sizeSeen[String(sz)]) { sizeSeen[String(sz)] = 1; sizes.push(String(sz)); }
    }

    return {
      size: total,
      levelAvg: levelAvg,
      levelSpread: levelSpread,
      defenses: defenses,
      weakestDefense: weakestDefense,
      weakestDefenseValue: weakestValue,
      staminaAvg: mean(staminaC.values),
      speedRange: speedC.values.length
        ? [Math.min.apply(null, speedC.values), Math.max.apply(null, speedC.values)]
        : null,
      immunities: immunities,
      weaknesses: weaknesses,
      sizeSpread: sizes,
      coverage: coverage
    };
  }

  // fetchParty performs the two-step syncapi read as the logged-in director
  // (session cookie via Chronicle.apiFetch, which returns a Response). Resolves
  // to the hero entities (with fields_data). `apiFetch` is injectable for tests;
  // it defaults to Chronicle.apiFetch. Any failure resolves to [] (manual mode).
  function fetchParty(cid, apiFetch) {
    var af = apiFetch || (typeof Chronicle !== 'undefined' ? Chronicle.apiFetch : null);
    if (!cid || typeof af !== 'function') return Promise.resolve([]);
    var base = '/api/v1/campaigns/' + cid;
    return af(base + '/entity-types')
      .then(function (res) { return res.json(); })
      .then(function (env) {
        var types = (env && env.data) || [];
        var typeId = null;
        var i;
        // Prefer the bespoke drawsteel-character slug; fall back to any type
        // whose preset_category is 'character' (adopted hero types).
        for (i = 0; i < types.length; i++) {
          if (types[i] && types[i].slug === 'drawsteel-character') { typeId = types[i].id; break; }
        }
        if (typeId === null || typeId === undefined) {
          for (i = 0; i < types.length; i++) {
            if (types[i] && types[i].preset_category === 'character') { typeId = types[i].id; break; }
          }
        }
        if (typeId === null || typeId === undefined) return [];
        return fetchAllPages(af, base, typeId);
      })
      .catch(function () { return []; });
  }

  // fetchAllPages walks the entities list at per_page=100 (values above 100
  // silently reset to 20 server-side, so we pin 100 and iterate `page` while the
  // envelope's total exceeds what we've collected).
  function fetchAllPages(af, base, typeId) {
    var all = [];
    function page(p) {
      var url = base + '/entities?type_id=' + encodeURIComponent(typeId) + '&per_page=100&page=' + p;
      return af(url)
        .then(function (res) { return res.json(); })
        .then(function (env) {
          var items = (env && env.data) || [];
          all = all.concat(items);
          var total = (env && typeof env.total === 'number') ? env.total : all.length;
          if (items.length > 0 && all.length < total && p < 100) return page(p + 1);
          return all;
        });
    }
    return page(1);
  }

  return {
    STAT_KEYS: STAT_KEYS,
    parseDamageList: parseDamageList,
    deriveParty: deriveParty,
    fetchParty: fetchParty
  };
})();

// Test seam: expose the pure API for Node unit tests. Inert in a browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MonsterParty;
}
