/**
 * Draw Steel published monster/encounter formulas — the SOURCED math.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The monster builder shipped with its own invented numbers (a per-organization
 * `stamina_base + stamina_per_level * level` table, `ev_multiplier * level`,
 * `partySize * partyLevel * 4`, and the level-1 damage table in
 * data/damage-baselines.json, whose own `source` is the string "custom"). Those
 * numbers disagree with the published formulas that now ship in
 * data/monster-building.json and data/encounter-building.json — by up to 2.3x on
 * Stamina and 2.4x on damage tiers — and the widget presented them through a
 * validation panel that called the result balanced.
 *
 * This module is the single place the published formulas are evaluated. It is
 * deliberately NOT the monster engine: the builder and its engine are scheduled
 * for a rewrite (DS-MONSTER-BUILDER-REWORK-R1 / DS-MB-REDO-P01). This file only
 * makes the numbers honest in the meantime.
 *
 * EVERY RETURN CARRIES ITS OWN PROVENANCE. A result is
 *   { value, sourced, source, notes }
 * where `sourced === false` means "the published data does not cover this input"
 * (the Swarm organization is original to this package and has no published
 * modifiers, so it can never be sourced). A caller that renders a value with
 * `sourced === false` MUST say so in the UI — that is the whole point of the
 * flag. Nothing here is allowed to guess: an uncovered input returns a null
 * value, not a plausible one.
 *
 * Loading: attaches the `DrawSteelFormulas` global via the manifest
 * `text_renderers` section (loaded before widget scripts, same seam as
 * MonsterEngine); in Node it exports the same object for `node --test`.
 */
var DrawSteelFormulas = (function () {
  'use strict';

  // The one citation every sourced result carries. It names the published
  // chapter these formulas are transcribed from, so a director can check them.
  var SOURCE = 'Draw Steel Monsters Book, ch. 1 (Monster Basics), via Steel Compendium';
  var ENCOUNTER_SOURCE = 'Draw Steel Monsters Book, ch. 8 (Building Encounters), via Steel Compendium';

  // ORG_ROLE_ROW encodes the three organizations that appear in the published
  // Role and Damage Modifier table. Leader and solo "have no additional role, so
  // they appear in this table in place of one" — their row REPLACES the role's.
  // Elite is an organization rather than a role and its +1 damage modifier
  // STACKS with a role that also has +1, for a total of +2.
  var ORG_ROLE_ROW = {
    leader: { role_modifier: 30, damage_modifier: 1, replaces_role: true },
    solo: { role_modifier: 30, damage_modifier: 2, replaces_role: true },
    elite: { role_modifier: 0, damage_modifier: 1, replaces_role: false }
  };

  // Published tier multipliers for the damage formula.
  var TIER_MODIFIER = { tier1: 0.6, tier2: 1.1, tier3: 1.4 };

  // Organizations whose ability damage is halved (published adjustment).
  var HALF_DAMAGE_ORGS = { horde: 1, minion: 1 };

  function slugOf(x) {
    if (!x) return null;
    return (typeof x === 'object') ? (x.slug || null) : String(x);
  }

  function finiteNum(v) {
    var n = Number(v);
    return (v === null || v === undefined || v === '' || !isFinite(n)) ? null : n;
  }

  function result(value, sourced, source, notes) {
    return { value: value, sourced: !!sourced, source: sourced ? source : null, notes: notes || [] };
  }

  // ── Role and damage modifiers ─────────────────────────────────────────────

  // roleModifier resolves the published role modifier that feeds the Stamina
  // formula. Leader/solo supply their own in place of a role's; every other
  // organization takes the chosen role's. With no role chosen and no replacing
  // organization the answer is genuinely unknown (published roles span 10-30),
  // so it is null — NOT a midpoint.
  function roleModifier(org, role) {
    var oslug = slugOf(org);
    var row = ORG_ROLE_ROW[oslug];
    if (row && row.replaces_role) {
      return result(row.role_modifier, true, SOURCE,
        [oslug + ' creatures have no additional role; the published table supplies their role modifier of ' + row.role_modifier + '.']);
    }
    var rm = role && typeof role === 'object' ? finiteNum(role.role_modifier) : null;
    if (rm === null) {
      return result(null, false, null, ['No role chosen, so the published role modifier is unknown (published roles range from 10 to 30).']);
    }
    return result(rm, true, SOURCE, []);
  }

  // damageModifier resolves the published damage modifier that feeds the damage
  // formula, including the elite stack.
  function damageModifier(org, role) {
    var oslug = slugOf(org);
    var row = ORG_ROLE_ROW[oslug];
    if (row && row.replaces_role) {
      return result(row.damage_modifier, true, SOURCE,
        [oslug + ' supplies its own damage modifier of +' + row.damage_modifier + ' in place of a role.']);
    }
    var dm = role && typeof role === 'object' ? finiteNum(role.damage_modifier) : null;
    if (dm === null) {
      return result(null, false, null, ['No role chosen, so the published damage modifier is unknown (published roles are +0 or +1).']);
    }
    if (row) {
      return result(dm + row.damage_modifier, true, SOURCE,
        ['Elite adds +' + row.damage_modifier + ' on top of the role’s +' + dm + '.']);
    }
    return result(dm, true, SOURCE, []);
  }

  // ── Encounter value ───────────────────────────────────────────────────────

  // encounterValue evaluates the published formula
  //   EV = ((2 x level) + 4) x organization modifier, rounded up.
  // The organization modifier is read from the org template's
  // `organization_modifier`; an organization the published rules do not define
  // (Swarm, original to this package) carries null there and is NOT sourced.
  function encounterValue(level, org) {
    var lvl = finiteNum(level);
    var mod = (org && typeof org === 'object') ? finiteNum(org.organization_modifier) : finiteNum(org);
    if (lvl === null || lvl <= 0) {
      return result(null, false, null, ['A level is required to compute encounter value.']);
    }
    if (mod === null) {
      return result(null, false, null,
        ['“' + (slugOf(org) || 'this organization') + '” has no published organization modifier, so its encounter value cannot be computed from the published formula.']);
    }
    var notes = [];
    if (slugOf(org) === 'minion') {
      notes.push('The published EV for minions represents four minions together, not one.');
    }
    return result(Math.ceil(((2 * lvl) + 4) * mod), true, SOURCE, notes);
  }

  // ── Stamina ───────────────────────────────────────────────────────────────

  // stamina evaluates the published formula
  //   Stamina = ((10 x level) + role modifier) x Stamina organization modifier,
  // rounded up. The Stamina-only organization modifier (minion 0.125, solo 5)
  // differs from the EV one, so it is read from `stamina_organization_modifier`.
  function stamina(level, org, role) {
    var lvl = finiteNum(level);
    var som = (org && typeof org === 'object') ? finiteNum(org.stamina_organization_modifier) : null;
    if (lvl === null || lvl <= 0) {
      return result(null, false, null, ['A level is required to compute Stamina.']);
    }
    if (som === null) {
      return result(null, false, null,
        ['“' + (slugOf(org) || 'this organization') + '” has no published Stamina organization modifier, so its Stamina cannot be computed from the published formula.']);
    }
    var rm = roleModifier(org, role);
    if (rm.value === null) {
      return result(null, false, null, rm.notes);
    }
    return result(Math.ceil(((10 * lvl) + rm.value) * som), true, SOURCE, rm.notes.slice());
  }

  // staminaOptionalBonus is the published "if you want more Stamina" top-up:
  // (3 x level) + 3, for any non-minion monster. Returned separately so the
  // baseline is never silently inflated by it.
  function staminaOptionalBonus(level, org) {
    var lvl = finiteNum(level);
    if (lvl === null || lvl <= 0) return result(null, false, null, []);
    if (slugOf(org) === 'minion') {
      return result(null, false, null, ['The optional Stamina bonus does not apply to minions.']);
    }
    return result((3 * lvl) + 3, true, SOURCE, []);
  }

  // ── Damage tiers ──────────────────────────────────────────────────────────

  // damageTiers evaluates the published baseline
  //   (4 + level + damage modifier) x tier modifier, rounded up,
  // then applies the published halving for horde and minion monsters. The two
  // remaining published adjustments are NOT applied here and are returned as
  // notes, because they depend on facts this function is not given: a strike
  // adds the creature's highest characteristic, and an ability that hits more
  // or fewer targets than expected is multiplied by 0.8 / 0.5 / 1.2.
  function damageTiers(level, org, role) {
    var lvl = finiteNum(level);
    if (lvl === null || lvl <= 0) {
      return { value: null, sourced: false, source: null, notes: ['A level is required to compute damage tiers.'] };
    }
    var dm = damageModifier(org, role);
    if (dm.value === null) {
      return { value: null, sourced: false, source: null, notes: dm.notes };
    }
    var base = 4 + lvl + dm.value;
    var oslug = slugOf(org);
    var halve = !!HALF_DAMAGE_ORGS[oslug];
    var tiers = {};
    var keys = ['tier1', 'tier2', 'tier3'];
    for (var i = 0; i < keys.length; i++) {
      var raw = Math.ceil(base * TIER_MODIFIER[keys[i]]);
      // The published text rounds the formula up and THEN says horde and minion
      // monsters "divide the result by 2" — so the halving applies to the
      // rounded baseline, and the halved figure is rounded up in turn to stay a
      // whole number of damage.
      tiers[keys[i]] = halve ? Math.ceil(raw / 2) : raw;
    }
    var notes = dm.notes.slice();
    if (halve) notes.push('Halved: the published rules divide horde and minion ability damage by 2.');
    // The damage formula itself needs only a level and a damage modifier, so it
    // evaluates for an organization the published rules never defined — but the
    // horde/minion halving cannot be judged for such an organization, and the
    // director should know the creature it is attached to is not published.
    if (org && typeof org === 'object' && org.organization_modifier === null) {
      notes.push('“' + (org.name || slugOf(org)) + '” is not a published Draw Steel organization — this package invented it, so the halving rule that applies to horde and minion cannot be judged for it. Treat the figure as unsourced at the organization level.');
    }
    notes.push('If this ability is a strike, add the creature’s highest characteristic to every tier.');
    notes.push('Adjust for target count if the ability does not hit the expected number of targets (x0.8 for one more, x0.5 for two or more, x1.2 for one fewer).');
    return { value: tiers, sourced: true, source: SOURCE, notes: notes };
  }

  // highestCharacteristic is the published "1 + echelon", capped at +5, with the
  // leader/solo +1. Echelon is 1 for levels 1-3, 2 for 4-6, 3 for 7-9, 4 for
  // 10+ in the published progression; a level below 1 has no echelon.
  function echelon(level) {
    var lvl = finiteNum(level);
    if (lvl === null || lvl < 1) return null;
    if (lvl <= 3) return 1;
    if (lvl <= 6) return 2;
    if (lvl <= 9) return 3;
    return 4;
  }

  function highestCharacteristic(level, org) {
    var e = echelon(level);
    if (e === null) return result(null, false, null, ['A level of 1 or more is required.']);
    var oslug = slugOf(org);
    var bonus = (oslug === 'leader' || oslug === 'solo') ? 1 : 0;
    return result(Math.min(5, 1 + e + bonus), true, SOURCE, []);
  }

  // ── Encounter strength and budget ─────────────────────────────────────────

  // heroEncounterStrength is the published per-hero encounter strength:
  // 4 + (2 x hero level). Retainers count as heroes.
  function heroEncounterStrength(level) {
    var lvl = finiteNum(level);
    if (lvl === null || lvl < 1) return result(null, false, null, ['A hero level of 1 or more is required.']);
    return result(4 + (2 * lvl), true, ENCOUNTER_SOURCE, []);
  }

  // partyEncounterStrength sums every hero's encounter strength. Pass either an
  // array of hero levels (exact) or a (size, level) pair for a uniform party.
  function partyEncounterStrength(levelsOrSize, uniformLevel) {
    if (Object.prototype.toString.call(levelsOrSize) === '[object Array]') {
      var total = 0;
      for (var i = 0; i < levelsOrSize.length; i++) {
        var one = heroEncounterStrength(levelsOrSize[i]);
        if (one.value === null) return result(null, false, null, ['A hero level could not be read.']);
        total += one.value;
      }
      if (!levelsOrSize.length) return result(null, false, null, ['An empty party has no encounter strength.']);
      return result(total, true, ENCOUNTER_SOURCE, []);
    }
    var size = finiteNum(levelsOrSize);
    var per = heroEncounterStrength(uniformLevel);
    if (size === null || size < 1 || per.value === null) {
      return result(null, false, null, ['A party size and hero level of 1 or more are required.']);
    }
    return result(size * per.value, true, ENCOUNTER_SOURCE, []);
  }

  // budgetBands returns the published difficulty bands expressed in EV, given a
  // party's encounter strength and one hero's. `upper: null` means unbounded.
  // These mirror data/encounter-building.json's difficulty entries exactly, and
  // tools/test-monster-formulas.mjs pins them against that file.
  function budgetBands(partyEs, oneHeroEs) {
    var p = finiteNum(partyEs);
    var h = finiteNum(oneHeroEs);
    if (p === null || h === null) return result(null, false, null, ['Party and per-hero encounter strength are required.']);
    return result({
      trivial: { lower: null, upper: p - h, upper_inclusive: false },
      easy: { lower: p - h, upper: p, upper_inclusive: false },
      standard: { lower: p, upper: p + h, upper_inclusive: true },
      hard: { lower: p + h, upper: p + (3 * h), upper_inclusive: true },
      extreme: { lower: p + (3 * h), upper: null, upper_inclusive: false }
    }, true, ENCOUNTER_SOURCE, []);
  }

  // difficultyOf names the published band a given spend falls into, so the UI
  // can report what the director has actually built instead of asserting that
  // some number is "balanced".
  function difficultyOf(spent, partyEs, oneHeroEs) {
    var bands = budgetBands(partyEs, oneHeroEs);
    var s = finiteNum(spent);
    if (bands.value === null || s === null) return result(null, false, null, bands.notes);
    var b = bands.value;
    var name;
    if (s < b.easy.lower) name = 'trivial';
    else if (s < b.standard.lower) name = 'easy';
    else if (s <= b.standard.upper) name = 'standard';
    else if (s <= b.hard.upper) name = 'hard';
    else name = 'extreme';
    return result(name, true, ENCOUNTER_SOURCE, []);
  }

  return {
    SOURCE: SOURCE,
    ENCOUNTER_SOURCE: ENCOUNTER_SOURCE,
    TIER_MODIFIER: TIER_MODIFIER,
    roleModifier: roleModifier,
    damageModifier: damageModifier,
    encounterValue: encounterValue,
    stamina: stamina,
    staminaOptionalBonus: staminaOptionalBonus,
    damageTiers: damageTiers,
    echelon: echelon,
    highestCharacteristic: highestCharacteristic,
    heroEncounterStrength: heroEncounterStrength,
    partyEncounterStrength: partyEncounterStrength,
    budgetBands: budgetBands,
    difficultyOf: difficultyOf
  };
})();

// Test seam: expose the pure API for Node unit tests. Inert in a browser (no
// CommonJS `module`), so the widget runtime is unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrawSteelFormulas;
}
