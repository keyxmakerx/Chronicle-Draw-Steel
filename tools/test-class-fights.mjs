// test-class-fights.mjs — the class pop-up books pay and spend each Heroic
// Resource exactly as data/class-fights.json says, and the data's rules,
// examples and the widget agree with each other.
//
// Run: node --test tools/test-class-fights.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const F = require('../widgets/class-fights.js');
const DATA = JSON.parse(readFileSync(new URL('../data/class-fights.json', import.meta.url), 'utf8'));
const ABILITIES = JSON.parse(readFileSync(new URL('../data/abilities.json', import.meta.url), 'utf8'));
const WIDGET = readFileSync(new URL('../widgets/class-fights.js', import.meta.url), 'utf8');
const R = F.rulesFrom(DATA);
const NINE = ['censor', 'conduit', 'elementalist', 'fury', 'null', 'shadow', 'tactician', 'talent', 'troubadour'];
const entry = (slug) => DATA.find((e) => e.slug === slug);
const rules = (id) => entry('class-resource-' + id).properties;
const cls = (id) => R.classes.find((c) => c.id === id);
// Dice that come up in the given order, then repeat the last one.
const loaded = (...rolls) => { let i = 0; return () => rolls[Math.min(i++, rolls.length - 1)]; };
const fight = (id, rand) => { const S = F.newFight(R, cls(id), rand || loaded(5)); F.start(S); return S; };
const actNamed = (S, re) => S.sc.acts.findIndex((a) => re.test(a.b));
const logs = (E) => E.filter((e) => e.t === 'log').map((e) => e.text);

test('the rules come from class-fights.json, and a missing rule means no fights', () => {
  assert.ok(R);
  assert.deepEqual(R.classes.map((c) => c.id), NINE);
  const roll = entry('power-roll').properties;
  assert.deepEqual(R.roll, { dice: roll.dice, die: roll.die, t1: roll.tier1_max, t2: roll.tier2_max, edge: roll.edge_bonus });
  assert.equal(R.winded, entry('winded-and-dying').properties.winded_fraction);
  assert.equal(F.rulesFrom(DATA.filter((e) => e.slug !== 'power-roll')), null);
  assert.equal(F.rulesFrom(DATA.filter((e) => e.slug !== 'winded-and-dying')), null);
  assert.equal(F.rulesFrom(null), null);
});

test('a class whose scene names a trigger it does not have is left out, not played wrong', () => {
  const bad = JSON.parse(JSON.stringify(DATA));
  bad.find((e) => e.slug === 'example-fight-censor').properties.acts[0].trig = ['no-such-trigger'];
  const R2 = F.rulesFrom(bad);
  assert.deepEqual(R2.classes.map((c) => c.id), NINE.filter((id) => id !== 'censor'));
  const noScene = F.rulesFrom(DATA.filter((e) => e.slug !== 'example-fight-fury'));
  assert.ok(!noScene.classes.some((c) => c.id === 'fury'));
});

test('power roll tiers break where the data says, and an edge adds its bonus', () => {
  assert.deepEqual([11, 12, 16, 17].map((t) => F.tierOf(R, t)), [1, 2, 2, 3]);
  const S = fight('shadow', loaded(5));
  F.act(S, actNamed(S, /^Slip into the shadows/));
  const E = F.act(S, actNamed(S, /^A 3-insight strike/));
  assert.ok(logs(E).some((l) => l.includes('5 + 5 + 2 + ' + R.roll.edge + ' for the edge = **14**, tier 2')), logs(E).join('\n'));
});

test('a fight opens with your Victories, and each turn pays the class\'s gain', () => {
  for (const id of NINE) {
    const S = fight(id, loaded(2));
    assert.equal(S.r, S.sc.hero.victories, id);
    F.turn(S);
    const g = rules(id).turn_gain;
    assert.equal(S.r, S.sc.hero.victories + (g === 'd3' ? 2 : g), id);
  }
});

test('a once-a-round trigger pays once a round, then says it was already paid', () => {
  const S = fight('censor');
  const strike = actNamed(S, /^Strike the heretic/);
  let E = F.act(S, strike);
  assert.equal(S.r, S.vic + 1);
  E = F.act(S, strike);
  assert.equal(S.r, S.vic + 1);
  assert.ok(logs(E).some((l) => /No wrath for “you damage a judged creature”: already paid this round/.test(l)));
  F.turn(S);
  const before = S.r;
  F.act(S, strike);
  assert.equal(S.r, before + 1, 'a new round pays again');
});

test('a once-a-fight trigger pays once a fight, even across rounds', () => {
  const S = fight('fury', loaded(3));
  const club = actNamed(S, /^The ogre clubs you/);
  const r0 = S.r;
  assert.equal(rules('fury').triggers.find((x) => x.id === 'winded-or-dying').per, 'fight');
  F.act(S, club); F.act(S, club);
  assert.equal(S.r, r0 + 1, 'hurt twice in one round pays once');
  while (S.hp > S.sc.hero.stamina * R.winded) F.act(S, club);
  assert.equal(S.r, r0 + 1 + 3, 'becoming winded pays its 1d3');
  F.turn(S);
  const r1 = S.r;
  let E = [];
  while (S.hp > 0) E = E.concat(F.act(S, club));
  assert.ok(logs(E).some((l) => l.includes('“you become winded or are dying”: already paid this fight')), logs(E).join('\n'));
  assert.equal(S.r, r1 + 1, 'dying later in the fight pays nothing more');
});

test('an every-time trigger pays every time', () => {
  const S = fight('troubadour', loaded(10));
  const dice = actNamed(S, /^Someone rolls the dice/);
  const n = rules('troubadour').triggers.find((t) => t.id === 'natural-19-20').amount;
  const r0 = S.r;
  F.act(S, dice); F.act(S, dice); F.act(S, dice);
  assert.equal(S.r, r0 + 3 * n);
});

test('the talent can spend clarity down to minus (1 + Reason), and strain hurts at the end of the turn', () => {
  const S = fight('talent');
  const five = actNamed(S, /^A 5-clarity strike/);
  const floorBase = rules('talent').strain.floor_base;
  assert.equal(F.floorOf(S), -(floorBase + S.reason));
  S.r = F.floorOf(S) + 5;
  assert.ok(F.canAct(S, S.sc.acts[five]));
  S.r = F.floorOf(S) + 4;
  assert.ok(!F.canAct(S, S.sc.acts[five]), 'one past the floor is refused');
  S.r = -2;
  const hp = S.hp;
  F.endTurn(S);
  assert.equal(S.hp, hp - 2 * rules('talent').strain.damage_per_point);
});

test('the troubadour dies for drama and rises once there is enough of it', () => {
  const S = fight('troubadour');
  const d = rules('troubadour').death;
  const stab = actNamed(S, /^The duke runs you through/);
  while (!S.dead) F.act(S, stab);
  assert.ok(S.hp <= 0);
  S.r = d.rise_at - 1;
  assert.ok(!F.canRise(S));
  S.r = d.rise_at;
  assert.ok(F.canRise(S));
  F.rise(S);
  assert.equal(S.dead, false);
  assert.equal(S.hp, d.rise_stamina);
  assert.equal(S.r, d.resource_after_rising);
  const died = fight('troubadour');
  died.hp = 1;
  const r = died.r;
  F.act(died, stab);
  assert.ok(died.r >= r + d.gain, 'dying pays the death drama');
});

test('the conduit\'s prayer pays by the d3 it rolls, and a 1 angers the gods', () => {
  const p = rules('conduit').prayer;
  for (const g of [1, 2, 3]) {
    const S = fight('conduit', loaded(g, 4));
    S.pray = true;
    const r = S.r, hp = S.hp;
    F.turn(S);
    assert.equal(S.r - r, g + p[String(g)].extra, 'rolled ' + g);
    if (g === 1) assert.equal(hp - S.hp, 4 + S.sc.hero.level);
    else assert.equal(S.hp, hp);
  }
});

test('every fight can be won, and winning ends it', () => {
  for (const id of NINE) {
    const S = fight(id, loaded(6));
    for (let n = 0; S.fight && n < 300; n++) {
      const dmg = S.sc.acts.map((a, i) => i).filter((i) => S.sc.acts[i].to && F.canAct(S, S.sc.acts[i]));
      dmg.sort((a, b) => (S.sc.acts[b].cost || 0) - (S.sc.acts[a].cost || 0));
      const hungry = S.sc.acts.some((a) => a.cost && a.to && S.foe[a.to] > 0 && !F.canAct(S, a));
      if (dmg.length && (S.sc.acts[dmg[0]].cost || !hungry || n % 3)) F.act(S, dmg[0]); else F.turn(S);
    }
    assert.ok(S.won && !S.fight, id + ' was not won');
    assert.equal(S.r, 0, id + ' keeps no resource after the fight');
    assert.ok(S.sc.foes.every((f) => S.foe[f.id] === 0));
  }
});

test('the data: rules cite Draw Steel, examples are flagged custom, and the two agree', () => {
  for (const id of NINE) {
    const e = entry('class-resource-' + id), sc = entry('example-fight-' + id);
    assert.match(e.source, /^Draw Steel Heroes Book, ch\. 5/);
    assert.equal(sc.source, 'custom');
    const p = e.properties;
    assert.ok(p.gain_text.includes(p.turn_gain === 'd3' ? '1d3' : String(p.turn_gain)), id + ' gain text and number disagree');
    for (const t of p.triggers) {
      const used = sc.properties.acts.some((a) => (a.trig || []).includes(t.id) || a.d20 === t.id) ||
        sc.properties.on_hurt === t.id || sc.properties.on_winded === t.id;
      assert.ok(used, id + ': trigger ' + t.id + ' is never set off');
    }
    for (const a of sc.properties.acts.filter((x) => x.cost)) {
      assert.ok(a.b.includes(a.cost + '-' + p.resource.toLowerCase()), id + ': "' + a.b + '" does not name its cost');
    }
    for (const cost of p.heroic_ability_costs) {
      const found = ABILITIES.some((x) => x.properties.class === p.class_name && x.properties.type === 'heroic' &&
        x.properties.cost_amount === cost && (x.properties.levels || [x.properties.level]).includes(1));
      assert.ok(found, id + ' has no 1st-level heroic ability costing ' + cost);
    }
  }
  for (const s of ['power-roll', 'winded-and-dying']) assert.match(entry(s).source, /^Draw Steel Heroes Book/);
});

test('rules text lives in the data, not in the widget', () => {
  for (const id of NINE) {
    const p = rules(id);
    for (const text of [p.gain_text, p.unique_text, p.quote].concat(p.triggers.map((t) => t.text))) {
      assert.ok(!WIDGET.includes(text), id + ': the widget repeats "' + text.slice(0, 40) + '…"');
    }
  }
  assert.ok(!/<=\s*11|<=\s*16|>=\s*17/.test(WIDGET), 'the widget hard-codes a tier break');
});
