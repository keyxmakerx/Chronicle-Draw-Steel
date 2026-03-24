# Foundry VTT Creature Sync — Design Document

> **Status:** Draft
> **Author:** Chronicle Team
> **Last Updated:** 2026-03-24
> **Related:** [Monster Builder](./monster-builder.md) | [Community Bestiary](../../Chronicle/docs/bestiary/design.md)

---

## 1. Overview

Draw Steel creatures built in Chronicle need to sync to Foundry VTT as proper NPC actors, compatible with the existing Draw Steel Foundry system's monster/NPC sheets. This document specifies how creature data maps to Foundry's data model and what Chronicle core changes are needed.

### Goals

- Creatures appear in Foundry as fully functional NPC actors with the Draw Steel system's monster sheet
- All stats, abilities, villain actions, and traits are populated
- Bi-directional sync: changes in Foundry reflect back to Chronicle
- Compatible with the current Draw Steel Foundry system (not a custom sheet)

### Constraints

- Chronicle's current sync API handles **flat key-value fields** via `foundry_path` annotations
- Draw Steel creatures have **structured arrays** (abilities, villain actions, traits) that don't fit the flat model
- The Draw Steel Foundry system expects specific data structures for its NPC sheet rendering

---

## 2. Current Sync Architecture

### 2.1 How Flat Field Sync Works Today

```
Chronicle Entity                    Foundry VTT Actor
┌─────────────────┐               ┌──────────────────────┐
│ Custom Fields:   │    sync      │ system data:          │
│  level: 5       │ ──────────▶  │  system.details.level │
│  might: +3      │              │  system.characteristics│
│  stamina: 50    │              │    .might: 3          │
│  speed: 5       │              │  system.stamina.max: 50│
└─────────────────┘              │  system.movement.speed │
                                 └──────────────────────┘
```

Each entity preset field with a `foundry_path` is read/written individually via the sync API. The Foundry module iterates over fields and updates actor data one path at a time.

### 2.2 The Problem with Structured Data

Abilities and villain actions are **arrays of objects**, not flat fields:

```json
// What Foundry expects for abilities:
{
  "system": {
    "abilities": [
      {
        "name": "Inferno Bite",
        "type": "signature",
        "keywords": ["Attack", "Melee", "Fire"],
        "distance": "Melee",
        "target": "1 creature",
        "powerRoll": {
          "characteristic": "might",
          "against": "agility"
        },
        "tiers": {
          "1": { "text": "8 fire damage" },
          "2": { "text": "14 fire damage" },
          "3": { "text": "20 fire damage; burning (EoT)" }
        }
      }
    ],
    "villainActions": [
      { "name": "Ember Storm", "order": 1, ... },
      { "name": "Ash Cloud", "order": 2, ... },
      { "name": "Extinction Breath", "order": 3, ... }
    ]
  }
}
```

You can't represent this with flat `foundry_path` annotations like `system.abilities[0].name`.

---

## 3. Solution: Structured Creature Sync Endpoint

### 3.1 New API Endpoint

**Chronicle Core** adds a new sync endpoint specifically for creature entities:

```
GET /api/v1/campaigns/:campaignId/sync/creatures/:entityId/statblock
```

**Response:**
```json
{
  "entity_id": "uuid",
  "entity_name": "Ashen Wyrm",
  "system_id": "drawsteel",
  "foundry_actor_type": "npc",
  "statblock": {
    "name": "Ashen Wyrm",
    "level": 8,
    "organization": "solo",
    "role": "brute",
    "ev": 192,
    "keywords": ["dragon", "beast"],
    "size": "H",
    "stamina": { "max": 240, "winded": 120 },
    "movement": { "speed": 7 },
    "stability": { "value": 3 },
    "characteristics": {
      "might": 4,
      "agility": 1,
      "reason": -1,
      "intuition": 2,
      "presence": 3
    },
    "immunities": [
      { "type": "Fire", "value": 5 }
    ],
    "freeStrike": "12 fire damage",
    "traits": [
      {
        "name": "Ember Aura",
        "description": "Any creature that starts its turn within 2 squares takes 5 fire damage."
      }
    ],
    "abilities": [
      {
        "name": "Inferno Bite",
        "type": "signature",
        "keywords": ["Attack", "Melee", "Fire"],
        "distance": "Melee",
        "target": "1 creature",
        "powerRoll": {
          "characteristic": "might",
          "against": "agility"
        },
        "tiers": {
          "1": { "text": "8 fire damage" },
          "2": { "text": "14 fire damage" },
          "3": { "text": "20 fire damage; burning (EoT)" }
        },
        "effect": null,
        "trigger": null,
        "vpCost": null
      }
    ],
    "villainActions": [
      {
        "name": "Ember Storm",
        "order": 1,
        "description": "The Ashen Wyrm beats its wings...",
        "keywords": ["Area", "Fire"],
        "distance": "Area 3",
        "target": "All creatures in area"
      },
      {
        "name": "Ash Cloud",
        "order": 2,
        "description": "A choking cloud of ash fills...",
        "keywords": ["Area", "Fire"]
      },
      {
        "name": "Extinction Breath",
        "order": 3,
        "description": "The Ashen Wyrm exhales...",
        "keywords": ["Area", "Fire"]
      }
    ]
  }
}
```

### 3.2 How It Works

1. **Chronicle stores** abilities and villain actions as JSON strings in entity custom fields (`abilities_json`, `villain_actions_json`)
2. **The sync endpoint** reads these JSON strings, parses them, and restructures them into the format the Draw Steel Foundry system expects
3. **The Foundry module** calls this endpoint (instead of generic field sync) for creature-type entities
4. **The Foundry module** creates/updates the NPC actor with the full structured payload

### 3.3 Reverse Sync (Foundry → Chronicle)

When a creature is modified in Foundry:

```
POST /api/v1/campaigns/:campaignId/sync/creatures/:entityId/statblock
```

Request body: Same format as the GET response's `statblock` object.

Chronicle parses the structured data back into:
- Flat custom fields (level, stamina, speed, characteristics, etc.)
- JSON string fields (`abilities_json`, `villain_actions_json`)

---

## 4. Foundry Data Model Mapping

### 4.1 Draw Steel Foundry System NPC Data Structure

Based on the Draw Steel Foundry system's expected NPC actor schema:

| Chronicle Field | Foundry Path | Type | Notes |
|---|---|---|---|
| `name` | `name` | string | Actor name |
| `level` | `system.details.level` | number | |
| `organization` | `system.details.organization` | string | |
| `role` | `system.details.role` | string | |
| `ev` | `system.details.ev` | number | |
| `keywords` | `system.details.keywords` | string[] | |
| `size` | `system.details.size` | string | |
| `stamina` | `system.stamina.max` | number | |
| `winded` | `system.stamina.winded` | number | |
| `speed` | `system.movement.speed` | number | |
| `stability` | `system.stability.value` | number | |
| `might` | `system.characteristics.might` | number | |
| `agility` | `system.characteristics.agility` | number | |
| `reason` | `system.characteristics.reason` | number | |
| `intuition` | `system.characteristics.intuition` | number | |
| `presence` | `system.characteristics.presence` | number | |
| `immunities` | `system.immunities` | object[] | Structured array |
| `free_strike` | `system.combat.freeStrike` | string | |
| `traits` | `system.traits` | object[] | Structured array |
| `abilities` | `system.abilities` | object[] | Structured array |
| `villain_actions` | `system.villainActions` | object[] | Structured array |

### 4.2 Ability Mapping Detail

Chronicle ability format → Foundry ability format:

```json
// Chronicle (stored in abilities_json)
{
  "name": "Inferno Bite",
  "type": "signature",
  "keywords": ["Attack", "Melee", "Fire"],
  "distance": "Melee",
  "target": "1 creature",
  "power_roll": "Might vs. Agility",
  "tier1_result": "8 fire damage",
  "tier2_result": "14 fire damage",
  "tier3_result": "20 fire damage; burning (EoT)",
  "effect": null,
  "trigger": null,
  "vp_cost": null
}

// Foundry (NPC actor system data)
{
  "name": "Inferno Bite",
  "type": "signature",
  "keywords": ["Attack", "Melee", "Fire"],
  "distance": "Melee",
  "target": "1 creature",
  "powerRoll": {
    "characteristic": "might",
    "against": "agility"
  },
  "tiers": {
    "1": { "text": "8 fire damage" },
    "2": { "text": "14 fire damage" },
    "3": { "text": "20 fire damage; burning (EoT)" }
  },
  "effect": null,
  "trigger": null,
  "vpCost": null
}
```

**Transformation logic:**
1. Parse `power_roll` string ("Might vs. Agility") into `{ characteristic, against }` object
2. Map `tier1_result`/`tier2_result`/`tier3_result` into `tiers` object with numeric keys
3. Rename `vp_cost` → `vpCost` (camelCase for Foundry JS conventions)
4. Rename `power_roll` → `powerRoll`

### 4.3 Villain Action Mapping

```json
// Chronicle
{
  "name": "Ember Storm",
  "order": "opener",
  "description": "...",
  "keywords": ["Area", "Fire"]
}

// Foundry
{
  "name": "Ember Storm",
  "order": 1,           // opener=1, crowd-control=2, ultimate=3
  "description": "...",
  "keywords": ["Area", "Fire"]
}
```

**Transformation:** Map order string to integer (opener=1, crowd-control=2, ultimate=3).

---

## 5. Foundry Module Changes

### 5.1 Creature Sync Handler

The Chronicle Foundry module (`Chronicle-Foundry-Module`) needs a new handler:

```javascript
// In the Foundry module's sync logic
async function syncCreature(entityId, campaignId) {
  // 1. Call the structured creature endpoint
  const response = await chronicleAPI.get(
    `/api/v1/campaigns/${campaignId}/sync/creatures/${entityId}/statblock`
  );

  const { statblock, foundry_actor_type } = response.data;

  // 2. Find or create the Foundry actor
  let actor = game.actors.find(a =>
    a.getFlag('chronicle', 'entityId') === entityId
  );

  if (!actor) {
    actor = await Actor.create({
      name: statblock.name,
      type: foundry_actor_type, // "npc"
      flags: { chronicle: { entityId, campaignId } }
    });
  }

  // 3. Update actor with structured data
  await actor.update({
    name: statblock.name,
    system: {
      details: {
        level: statblock.level,
        organization: statblock.organization,
        role: statblock.role,
        ev: statblock.ev,
        keywords: statblock.keywords,
        size: statblock.size
      },
      stamina: {
        max: statblock.stamina.max,
        winded: statblock.stamina.winded
      },
      movement: { speed: statblock.movement.speed },
      stability: { value: statblock.stability.value },
      characteristics: statblock.characteristics,
      immunities: statblock.immunities,
      combat: { freeStrike: statblock.freeStrike },
      traits: statblock.traits,
      abilities: statblock.abilities,
      villainActions: statblock.villainActions
    }
  });

  return actor;
}
```

### 5.2 Detection Logic

The Foundry module needs to detect creature entities vs character entities:

```javascript
function isCreatureEntity(entity) {
  // Check entity type slug or category
  return entity.type_slug === 'drawsteel-creature'
    || entity.category === 'creature';
}

async function syncEntity(entity) {
  if (isCreatureEntity(entity)) {
    return syncCreature(entity.id, entity.campaign_id);
  } else {
    return syncCharacter(entity); // Existing flat-field sync
  }
}
```

### 5.3 Reverse Sync (Foundry → Chronicle)

When an NPC actor is modified in Foundry, the module pushes changes back:

```javascript
Hooks.on('updateActor', async (actor, changes, options) => {
  if (actor.type !== 'npc') return;

  const entityId = actor.getFlag('chronicle', 'entityId');
  if (!entityId) return;

  // Reconstruct statblock from actor data
  const statblock = {
    name: actor.name,
    level: actor.system.details.level,
    organization: actor.system.details.organization,
    role: actor.system.details.role,
    ev: actor.system.details.ev,
    keywords: actor.system.details.keywords,
    size: actor.system.details.size,
    stamina: actor.system.stamina,
    movement: actor.system.movement,
    stability: actor.system.stability,
    characteristics: actor.system.characteristics,
    immunities: actor.system.immunities,
    freeStrike: actor.system.combat?.freeStrike,
    traits: actor.system.traits,
    abilities: actor.system.abilities,
    villainActions: actor.system.villainActions
  };

  await chronicleAPI.post(
    `/api/v1/campaigns/${campaignId}/sync/creatures/${entityId}/statblock`,
    { statblock }
  );
});
```

---

## 6. Chronicle Core Changes Required

### 6.1 New Sync Endpoint

**File:** `internal/plugins/syncapi/creature_routes.go` (new file)

```go
// Routes
group.GET("/sync/creatures/:entityId/statblock", h.getCreatureStatblock)
group.POST("/sync/creatures/:entityId/statblock", h.updateCreatureStatblock)
```

### 6.2 Statblock Assembly Logic

**File:** `internal/plugins/syncapi/creature_statblock.go` (new file)

The handler:
1. Loads the entity and its custom fields
2. Reads flat fields (level, stamina, characteristics, etc.)
3. Parses `abilities_json` and `villain_actions_json` string fields
4. Transforms to Foundry-expected format (see §4.2, §4.3)
5. Returns structured response

### 6.3 Statblock Disassembly Logic (Reverse Sync)

The POST handler:
1. Receives structured statblock
2. Extracts flat fields → updates entity custom fields
3. Serializes abilities array → `abilities_json` string field
4. Serializes villain actions array → `villain_actions_json` string field
5. Saves entity

### 6.4 Permission Check

Both endpoints reuse existing sync API permissions:
- Requires valid API key with `sync` permission for the campaign
- Entity must belong to the specified campaign (IDOR check)
- Entity must be a creature type (category check)

---

## 7. Compatibility Notes

### 7.1 Draw Steel Foundry System Versions

The sync adapter should be resilient to minor schema changes in the Draw Steel Foundry system:

- **Unknown fields** in Foundry data are preserved (don't strip them during reverse sync)
- **Missing fields** default to null/empty (don't error on missing optional data)
- **Version detection:** If the Foundry system version changes significantly, the module can check `game.system.version` and adjust mapping

### 7.2 Backward Compatibility

- Existing character sync (heroes) is unchanged — flat field sync continues to work
- The creature sync endpoint is additive — no existing endpoints are modified
- Creature entities without `abilities_json` populated still sync flat fields normally

### 7.3 Migration Path

For creatures created before the builder exists (manually created entities):
- Flat fields (level, stamina, etc.) sync normally via existing `foundry_path` annotations
- Structured fields (abilities, villain actions) are empty until populated via the builder
- No data loss or breaking changes

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Statblock assembly from entity fields
- Statblock disassembly to entity fields
- Power roll string parsing ("Might vs. Agility" → `{ characteristic, against }`)
- Villain action order mapping (string ↔ integer)
- JSON validation of abilities/villain actions
- Edge cases: empty abilities, missing villain actions for non-leaders

### 8.2 Integration Tests

- Full round-trip: create creature in Chronicle → sync to Foundry → modify in Foundry → sync back
- Permission checks: wrong campaign, wrong API key, non-creature entity
- IDOR: attempt to access creature from different campaign

### 8.3 Manual Testing

- Create creature with Monster Builder → verify it appears in Foundry as NPC
- Open the NPC sheet in Foundry → verify all stats, abilities, villain actions render correctly
- Modify NPC in Foundry → verify changes sync back to Chronicle
- Import from Bestiary → sync imported creature → verify Foundry NPC

---

## 9. Open Questions

1. **Foundry item system:** Does the Draw Steel Foundry system represent abilities as embedded Items on the Actor, or as system data arrays? This affects the sync approach significantly. If Items, we need to create/update embedded documents, not just actor system data.

2. **Token configuration:** Should creature sync also set token defaults (size, disposition, vision)? The Draw Steel system may auto-configure these from organization/size.

3. **Artwork sync:** Should creature artwork from Chronicle's media system sync to Foundry actor images?

4. **Batch sync:** Should there be a batch endpoint for syncing multiple creatures at once (useful for encounter prep)?

5. **Conflict resolution:** If a creature is modified simultaneously in Chronicle and Foundry, which wins? Current character sync uses "last write wins" — is that acceptable for creatures?
