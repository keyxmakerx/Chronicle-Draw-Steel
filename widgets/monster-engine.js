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

  // formulas() resolves DrawSteelFormulas — the module holding the PUBLISHED
  // Draw Steel math (the DrawSteelFormulas SECTION at the foot of this file,
  // merged from widgets/monster-formulas.js). In the browser it is a global
  // loaded ahead of this file via the manifest's text_renderers section; under
  // `node --test` it is required directly. Resolved lazily so load order in
  // either environment cannot leave this file holding a stale null.
  function formulas() {
    if (typeof DrawSteelFormulas !== 'undefined' && DrawSteelFormulas) return DrawSteelFormulas;
    if (typeof require === 'function') {
      // Merged into this file 2026-08-08 (see the DrawSteelFormulas SECTION below).
      try { return module.exports && module.exports.Formulas ? module.exports.Formulas : null; } catch (e) { return null; }
    }
    return null;
  }

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

  // standardEvPerHeroLevel is NO LONGER part of the budget path — the published
  // encounter-strength formula replaced it (see encounterBudget). It is kept
  // because it is the honest description of the shipped org templates' internal
  // consistency, and its tests document that relationship.
  //
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

  // encounterBudget is the party's PUBLISHED encounter strength: the sum over
  // heroes of 4 + (2 x hero level) (data/encounter-building.json,
  // "encounter-strength"). It is also the floor of the published standard
  // difficulty band, whose ceiling is one more hero's worth of strength —
  // encounterBands() returns the whole ladder.
  //
  // This REPLACES the widget's old `size x level x 4`, which ran 1.67x the
  // published strength at level 10 (160 against 96 for four heroes) and was
  // presented to directors as a balanced budget. `orgTemplates` is accepted for
  // call-site compatibility and no longer read — the published formula depends
  // only on the party.
  function encounterBudget(partySize, partyLevel, orgTemplates) {   // eslint-disable-line no-unused-vars
    var F = formulas();
    if (!F) return 0;
    var es = F.partyEncounterStrength(partySize, partyLevel);
    return es.value === null ? 0 : es.value;
  }

  // encounterBands returns the published difficulty ladder for a party, so the
  // UI can name what a given spend actually is (trivial/easy/standard/hard/
  // extreme) instead of asserting that some number is "balanced". Returns null
  // when the party cannot be read.
  function encounterBands(partySize, partyLevel) {
    var F = formulas();
    if (!F) return null;
    var party = F.partyEncounterStrength(partySize, partyLevel);
    var perHero = F.heroEncounterStrength(partyLevel);
    if (party.value === null || perHero.value === null) return null;
    var bands = F.budgetBands(party.value, perHero.value);
    return bands.value === null ? null : { partyEs: party.value, perHeroEs: perHero.value, bands: bands.value };
  }

  // creatureEV is a single creature's PUBLISHED encounter value:
  //   ((2 x level) + 4) x organization modifier, rounded up.
  // The old `level x ev_multiplier` ran 1.67x high at level 10 (a level 10 solo
  // was priced at 240 against a published 144). Returns 0 — "cannot be priced"
  // — for an organization the published rules do not define, which is how Swarm
  // (original to this package) drops out of the automatic picks rather than
  // being quietly costed with invented math.
  function creatureEV(level, org) {
    var F = formulas();
    if (!F) return 0;
    var ev = F.encounterValue(level, org);
    return ev.value === null ? 0 : ev.value;
  }

  // villainActionCount reads the data-driven villain-action requirement for an
  // org template (leaders/solos = 3, all others = 0). This value replaces the
  // hardcoded 'leader'/'solo' string checks throughout the builder.
  function villainActionCount(org) {
    if (!org || typeof org.villain_action_count !== 'number') return 0;
    return org.villain_action_count;
  }

  // evMeter summarizes one creature's spend against the party's encounter
  // strength for the live "spent X / budget Y" meter. `copies` is arithmetic —
  // how many of this creature spend that strength (>= 1) — and is NOT a balance
  // verdict: the published spending limits (creatures per hero, the
  // six-stat-block cap, minions in fours, star-of-the-show) are checked nowhere.
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

  // ── Phase 2: the suggestion engine ────────────────────────────────────────
  //
  // suggest(partyProfile, intent, data) turns the derived PartyProfile into a
  // fully pre-filled, fully-overridable monster suggestion (redo Q2/Q3, R3).
  // Every filled field carries a `rationale` string (Q2: the chip is mandatory).
  // Potency and intent-scaling are DESCOPED (R3.1/R3.2) — no invented DS math.

  // titleCase upper-cases the first letter of a stat/name for chip display.
  function titleCase(s) {
    if (!s || typeof s !== 'string') return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // roundTo rounds to `dp` decimal places (for readable averages in chips).
  function roundTo(n, dp) {
    var f = Math.pow(10, dp || 0);
    return Math.round(Number(n) * f) / f;
  }

  // normalizeIntent coerces the intent selector value to one of the four known
  // difficulties, defaulting to 'standard'. Intent is RECORDED only — it never
  // scales any number in P2 (R3.2).
  function normalizeIntent(intent) {
    var allowed = { trivial: 1, standard: 1, hard: 1, boss: 1 };
    var v = (typeof intent === 'string') ? intent.toLowerCase() : '';
    return allowed[v] ? v : 'standard';
  }

  // findRoleByStat returns the first role whose primary_stat equals `stat`
  // (data order breaks ties among roles that share a primary_stat), or null.
  function findRoleByStat(roleTemplates, stat) {
    var list = roleTemplates || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].primary_stat === stat) return list[i];
    }
    return null;
  }

  // orderedDefenses returns the party's present defenses as [{stat,value}]
  // sorted weakest-first (null defenses — a stat no hero carries — are skipped).
  function orderedDefenses(defenses) {
    var out = [];
    if (defenses) {
      for (var k in defenses) {
        if (defenses.hasOwnProperty(k) && defenses[k] !== null && isFinite(defenses[k])) {
          out.push({ stat: k, value: defenses[k] });
        }
      }
    }
    out.sort(function (a, b) { return a.value - b.value; });
    return out;
  }

  // pickRole implements the role rule + R3.5 fallback chain:
  //   1. the role whose primary_stat === the party's weakest defense;
  //   2. else walk to the next-weakest defense that HAS a matching role
  //      (substituted = true), naming the substitution;
  //   3. else null (degrade to budget/org-only).
  // The power-roll TARGET is decided separately (always the true weakest).
  function pickRole(partyProfile, roleTemplates) {
    var weakest = partyProfile.weakestDefense;
    if (weakest) {
      var direct = findRoleByStat(roleTemplates, weakest);
      if (direct) return { role: direct, targetedDefense: weakest, substituted: false };
    }
    var ordered = orderedDefenses(partyProfile.defenses);
    for (var i = 0; i < ordered.length; i++) {
      var stat = ordered[i].stat;
      if (stat === weakest) continue; // weakest already tried above
      var r = findRoleByStat(roleTemplates, stat);
      if (r) return { role: r, targetedDefense: stat, substituted: true };
    }
    return { role: null, targetedDefense: null, substituted: false };
  }

  // pickOrganization chooses the single creature that best challenges the party:
  // the org with the LARGEST creature-EV that still fits the total budget (the
  // biggest single monster that fits). Ties break toward more villain actions
  // (the dispatch's "use villain_action_count"), then data order. If nothing
  // fits (a tiny/low party), the lightest org is used instead.
  function pickOrganization(budget, level, orgTemplates) {
    var list = orgTemplates || [];
    var best = null, bestEV = -1, bestVA = -1;
    var smallest = null, smallestEV = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var ev = creatureEV(level, o);
      if (!isFinite(ev) || ev <= 0) continue;
      if (ev < smallestEV) { smallestEV = ev; smallest = o; }
      if (ev <= budget) {
        var va = villainActionCount(o);
        if (ev > bestEV || (ev === bestEV && va > bestVA)) {
          best = o; bestEV = ev; bestVA = va;
        }
      }
    }
    if (best) return { org: best, ev: bestEV, copies: evMeter(bestEV, budget).copies };
    if (smallest) return { org: smallest, ev: smallestEV, copies: 1, overBudget: true };
    return null;
  }

  // pickDamageTypes prefers the party's shared weaknesses and NEVER returns a
  // type in the party's immunity union (Q3). Empty when there is no exploitable
  // weakness — the engine leaves damage untyped rather than invent one.
  function pickDamageTypes(partyProfile) {
    var weaknesses = partyProfile.weaknesses || [];
    var immunities = partyProfile.immunities || [];
    var immuneSet = {};
    for (var i = 0; i < immunities.length; i++) {
      immuneSet[String(immunities[i]).toLowerCase()] = 1;
    }
    var types = [];
    for (var j = 0; j < weaknesses.length; j++) {
      if (!immuneSet[String(weaknesses[j]).toLowerCase()]) types.push(weaknesses[j]);
    }
    var rationale;
    if (types.length) {
      rationale = 'Damage: ' + types.join(', ') + ' — the party is weak to ' +
        (types.length > 1 ? 'these' : 'this') + '; never a type they resist.';
    } else if (weaknesses.length) {
      rationale = 'Damage left untyped — the party’s only weaknesses are also immunities; no safe weakness to lean on.';
    } else {
      rationale = 'Damage left untyped — the party shares no damage weakness to exploit.';
    }
    return { types: types, rationale: rationale };
  }

  // legacyTierValues applies data/damage-baselines.json as
  // tierN + per_level*(level-1). That file's own `source` is the string
  // "custom": the numbers are this package's invention and run as much as 2.4x
  // the published damage formula (a level 8 solo tier 3 of 48 against a
  // published 20). It survives ONLY as the labelled fallback for an
  // organization the published rules do not define, never as a silent default.
  function legacyTierValues(bl, level) {
    var scale = (Number(bl.per_level) || 0) * (level - 1);
    return {
      tier1: Math.round(Number(bl.tier1) + scale),
      tier2: Math.round(Number(bl.tier2) + scale),
      tier3: Math.round(Number(bl.tier3) + scale)
    };
  }

  // addFlat returns a copy of a tier triple with `n` added to every tier — the
  // published "if the ability is a strike, add the monster's highest
  // characteristic" adjustment, kept separate from the baseline so a caller can
  // show both and say which is which.
  function addFlat(tiers, n) {
    if (!tiers) return null;
    return { tier1: tiers.tier1 + n, tier2: tiers.tier2 + n, tier3: tiers.tier3 + n };
  }

  // suggest is the pure entry point. `data` carries { orgTemplates, roleTemplates,
  // baselines } (baselines = the _extractBaselines org->{tier1,tier2,tier3,
  // per_level} map). Returns a MonsterSuggestion; degrades (never guesses) when
  // the party's defenses or levels can't be read.
  function suggest(partyProfile, intent, data) {
    var d = data || {};
    var orgTemplates = d.orgTemplates || [];
    var roleTemplates = d.roleTemplates || [];
    var baselines = d.baselines || {};
    var chosenIntent = normalizeIntent(intent);
    var notes = [];

    if (!partyProfile) {
      return {
        level: null, organization: null, copies: 1, budget: 0, role: null,
        powerRollAttack: null, powerRollTarget: null, damageTypes: [], tiers: null,
        strikeTiers: null, tiersSourced: false, tierNotes: [],
        intent: chosenIntent, immunities: [], rationale: {},
        notes: ['No party profile — nothing to complement (manual build).']
      };
    }

    // Level band ← round(levelAvg); intent does NOT scale it (R3.2).
    var level, levelRationale;
    if (partyProfile.levelAvg !== null && partyProfile.levelAvg !== undefined && isFinite(partyProfile.levelAvg)) {
      level = Math.round(partyProfile.levelAvg);
      if (level < 1) level = 1;
      levelRationale = 'Level ' + level + ' — the party’s mean level (' + roundTo(partyProfile.levelAvg, 1) + ').';
    } else {
      level = 1;
      levelRationale = 'Level 1 — no hero levels found in the party; defaulted.';
      notes.push('No hero levels available; level defaulted to 1.');
    }

    // Budget = the party's PUBLISHED encounter strength, which is also the floor
    // of the published standard difficulty band. Then organization: the biggest
    // single creature that fits. NOTE the honest limit of that second step —
    // "biggest single creature that fits" is the widget's own heuristic, not a
    // published selection rule, so the rationale describes what it did and does
    // not call the result balanced.
    var budget = encounterBudget(partyProfile.size, level, orgTemplates);
    var orgPick = pickOrganization(budget, level, orgTemplates);
    var organization = null, orgRationale = '', copies = 1, orgObj = null;
    if (orgPick && orgPick.org) {
      orgObj = orgPick.org;
      organization = orgPick.org.slug;
      copies = orgPick.copies;
      var va = villainActionCount(orgPick.org);
      if (orgPick.overBudget) {
        orgRationale = titleCase(orgPick.org.name) + ' — the lightest organization; the party’s encounter strength is below even one creature of this level.';
        notes.push('Encounter strength ' + budget + ' is below the lightest creature’s EV; suggested the lightest org.');
      } else {
        orgRationale = titleCase(orgPick.org.name) + ' — the largest single creature that fits the party’s published encounter strength of ' + budget +
          ' (hero ratio ' + (orgPick.org.hero_ratio || '?') + (va > 0 ? ', ' + va + ' villain actions' : '') + '); ' + copies +
          ' of them spend it, which is a standard-difficulty encounter. Creature-count and star-of-the-show limits are not checked here.';
      }
    } else {
      orgRationale = 'No organization could be fit to the party’s encounter strength — choose one manually.';
      notes.push('Could not fit an organization to the party’s encounter strength.');
    }

    // Role ← primary_stat === weakest defense, with the R3.5 fallback chain.
    var roleResult = pickRole(partyProfile, roleTemplates);
    var role = roleResult.role ? roleResult.role.slug : null;
    var roleRationale;
    if (roleResult.role) {
      if (roleResult.substituted) {
        roleRationale = titleCase(roleResult.role.name) + ' — the party’s weakest defense (' + titleCase(partyProfile.weakestDefense) +
          ') has no matching monster role; substituting ' + titleCase(roleResult.targetedDefense) + ', the next-weakest defense a role can target.';
        notes.push('Role substitution: no role targets ' + titleCase(partyProfile.weakestDefense) + '; used ' + titleCase(roleResult.targetedDefense) + '.');
      } else {
        roleRationale = titleCase(roleResult.role.name) + ' — its primary characteristic (' + titleCase(roleResult.targetedDefense) + ') matches the party’s weakest defense.';
      }
    } else {
      roleRationale = 'No role could be matched — choose one manually.';
      if (partyProfile.weakestDefense === null) {
        notes.push('Party defenses unknown (no hero characteristics) — budget/organization/tiers only; pick a role and target manually.');
      } else {
        notes.push('No role matches the party’s defenses; role left for manual choice.');
      }
    }

    // Power-roll TARGET ← always the party's true weakest defense (independent
    // of the role substitution). ATTACK ← the chosen role's primary_stat.
    var powerRollTarget = partyProfile.weakestDefense;
    var powerRollAttack = roleResult.role ? roleResult.role.primary_stat : null;
    var targetRationale;
    if (powerRollTarget) {
      targetRationale = 'Power-roll target: ' + titleCase(powerRollTarget) + ' — the party’s true weakest defense' +
        (isFinite(partyProfile.weakestDefenseValue) ? ' (avg ' + roundTo(partyProfile.weakestDefenseValue, 1) + ')' : '') + '.';
    } else {
      targetRationale = 'Power-roll target unknown — the party’s defenses could not be read.';
    }

    // Damage types ← party weaknesses, never an immunity (Q3).
    var dmg = pickDamageTypes(partyProfile);

    // Ability tiers ← the PUBLISHED damage formula (4 + level + damage modifier)
    // x tier modifier, halved for horde/minion. The suggested ability is
    // authored as a melee strike, so the published "add the highest
    // characteristic" adjustment applies; it is returned as `strikeTiers`
    // ALONGSIDE the baseline rather than folded in, so the UI can show which
    // number is the formula and which is the formula plus an adjustment.
    var F = formulas();
    var tiers = null, strikeTiers = null, tiersSourced = false, tierNotes = [], tiersRationale;
    var published = (F && organization) ? F.damageTiers(level, orgObj, roleResult.role) : null;
    if (published && published.value) {
      tiers = published.value;
      tiersSourced = true;
      tierNotes = published.notes;
      var hc = F.highestCharacteristic(level, orgObj);
      strikeTiers = (hc.value === null) ? null : addFlat(tiers, hc.value);
      tiersRationale = 'Ability damage tiers ' + tiers.tier1 + ' / ' + tiers.tier2 + ' / ' + tiers.tier3 +
        ' — the published formula (4 + level + damage modifier) × tier modifier at level ' + level +
        (strikeTiers ? ('; as a strike, add the highest characteristic (+' + hc.value + ') for ' +
          strikeTiers.tier1 + ' / ' + strikeTiers.tier2 + ' / ' + strikeTiers.tier3) : '') + '.';
    } else if (organization && baselines[organization]) {
      // Fallback: an organization the published rules do not define (Swarm).
      // The numbers are this package's own and are labelled as such.
      tiers = legacyTierValues(baselines[organization], level);
      strikeTiers = tiers;
      tiersSourced = false;
      tierNotes = ['These tiers are the widget’s own baseline table, not published Draw Steel math — “' +
        organization + '” is not a published organization. Pending the builder rework.'];
      tiersRationale = 'Ability damage tiers ' + tiers.tier1 + ' / ' + tiers.tier2 + ' / ' + tiers.tier3 +
        ' — the widget’s own baseline for ' + titleCase(organization) + ', which the published rules do not cover. Unsourced.';
      notes.push('Damage tiers for ' + organization + ' are unsourced — it is not a published organization.');
    } else {
      tiersRationale = 'No damage tiers could be computed for the chosen organization — left blank.';
      if (organization) notes.push('No damage tiers could be computed for organization ' + organization + '.');
    }

    // Intent ← recorded only (R3.2); it changes nothing here.
    var intentRationale = 'Intent recorded: ' + titleCase(chosenIntent) +
      '. Difficulty scaling is pending sourced rules — it does not change these numbers yet.';

    return {
      level: level,
      organization: organization,
      copies: copies,
      budget: budget,
      role: role,
      powerRollAttack: powerRollAttack,
      powerRollTarget: powerRollTarget,
      damageTypes: dmg.types,
      tiers: tiers,
      strikeTiers: strikeTiers,
      tiersSourced: tiersSourced,
      tierNotes: tierNotes,
      intent: chosenIntent,
      immunities: partyProfile.immunities || [],
      rationale: {
        level: levelRationale,
        organization: orgRationale,
        role: roleRationale,
        target: targetRationale,
        damage: dmg.rationale,
        tiers: tiersRationale,
        intent: intentRationale
      },
      notes: notes
    };
  }

  return {
    heroesPerCreature: heroesPerCreature,
    standardEvPerHeroLevel: standardEvPerHeroLevel,
    encounterBudget: encounterBudget,
    encounterBands: encounterBands,
    creatureEV: creatureEV,
    villainActionCount: villainActionCount,
    evMeter: evMeter,
    suggest: suggest
  };
})();



/* ===========================================================================
 * SECTION: DrawSteelFormulas — the PUBLISHED math (merged 2026-08-08)
 * ---------------------------------------------------------------------------
 * THIS SECTION IS NOT PART OF THE ENGINE AND MUST SURVIVE ITS REWRITE.
 *
 * It lived at widgets/monster-formulas.js until Chronicle's manifest validator
 * rejected the package outright: internal/systems/manifest.go caps
 * text_renderers at 5 and registering the formulas as a sixth made the WHOLE
 * package fail to load — no categories, no widgets, no reference data. The
 * package must fit the platform contract, and fitting it here costs the
 * operator nothing, whereas raising Chronicle's cap would cost them a redeploy.
 *
 * The separation the original file argued for is preserved as a SECTION rather
 * than a file: `DrawSteelFormulas` remains its own global with its own API and
 * its own tests, and it is the honest-math layer that the builder and engine
 * (both scheduled for rewrite under DS-MONSTER-BUILDER-REWORK-R1 / DS-MB-REDO-P01)
 * are measured against. When that rewrite lands, lift this section out whole —
 * it is deliberately free of engine state.
 * =========================================================================== */
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



// Test seam: expose both APIs for Node unit tests. Inert in a browser (no
// CommonJS `module`), so the widget runtime is unchanged. DrawSteelFormulas is
// re-exported under its own key so `require('./monster-engine.js').Formulas`
// reaches the published math without importing engine state.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof MonsterEngine !== 'undefined') ? MonsterEngine : {};
  if (typeof DrawSteelFormulas !== 'undefined') {
    module.exports.Formulas = DrawSteelFormulas;
  }
}
