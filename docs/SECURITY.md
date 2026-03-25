# Security Audit — Chronicle-Draw-Steel

> **Date:** 2026-03-25
> **Scope:** All widget code, manifest, and data files
> **Auditor:** Automated AI review

---

## Overall Assessment: GOOD

The codebase demonstrates strong security practices. XSS protection is consistent, no credentials are hardcoded, no eval/Function usage exists, and DOM manipulation is safe. Several medium-priority issues exist around input validation and API parameter sanitization.

---

## Findings

### HIGH — Missing Input Validation on API Saves

**Files:**
- `widgets/monster-builder.js` ~line 1144–1170 (save method)
- `widgets/bestiary-browser.js` ~line 717 (import to campaign)

**Issue:** Creature data is serialized and sent directly to the API without client-side validation of field ranges or array sizes.

```javascript
// bestiary-browser.js — imports entire creature object as custom_fields
var payload = { name: creature.name, preset: 'drawsteel-creature', custom_fields: creature };
Chronicle.apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
```

**Risk:** Malicious or corrupted creature data (negative stamina, enormous ability arrays, oversized strings) could cause backend errors or resource exhaustion.

**Remediation:** Add validation before API calls:
```javascript
if (cr.level < 1 || cr.level > 20) return alert('Invalid level');
if (cr.abilities.length > 50) return alert('Too many abilities');
if (cr.name.length > 200) return alert('Name too long');
```

**Note:** Server-side validation in Chronicle core is the real defense here. Client-side validation is defense-in-depth. The monster builder's `_validate()` method already checks game rules but doesn't block the save path for bestiary imports.

---

### HIGH — Unsanitized IDs in URL Construction

**Files:**
- `widgets/monster-builder.js` ~line 63, 90
- `widgets/bestiary-browser.js` ~line 54, 71
- `widgets/statblock-renderer.js` ~line 27

**Issue:** `campaignId` and `entityId` from widget config are concatenated directly into API URLs without format validation.

```javascript
var url = '/api/v1/campaigns/' + this.config.campaignId + '/entities/' + this.config.entityId;
```

**Risk:** If IDs contain path traversal characters (`../`) or special characters, requests could target unintended endpoints. Also an IDOR risk if the platform doesn't enforce access control on these IDs.

**Remediation:**
```javascript
function validateId(id) {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid ID format');
  return id;
}
var url = '/api/v1/campaigns/' + validateId(this.config.campaignId) + '/entities/' + validateId(this.config.entityId);
```

**Mitigation:** These IDs come from Chronicle's widget config system (not direct user input), so the attack surface is limited to Chronicle platform vulnerabilities. The backend should enforce campaign membership checks on all entity API calls.

---

### MEDIUM — JSON.parse on Entity Custom Fields Without Schema Validation

**Files:**
- `widgets/monster-builder.js` ~line 108–129
- `widgets/bestiary-browser.js` ~line 126–132
- `widgets/statblock-renderer.js` ~line 64–70

**Issue:** Fields like `abilities_json`, `villain_actions_json`, `traits`, and `keywords` are parsed from JSON strings stored in entity custom_fields. While parsing is wrapped in try-catch, the resulting objects are used without schema validation.

```javascript
self.creature.abilities = JSON.parse(f.abilities_json) || [];
// abilities[i].name, .type, .tier1, etc. assumed to exist
```

**Risk:** A crafted JSON payload in custom_fields could inject unexpected property names or deeply nested structures, potentially causing UI errors or unexpected behavior.

**Remediation:** Validate structure after parsing:
```javascript
var parsed = JSON.parse(f.abilities_json);
if (!Array.isArray(parsed)) parsed = [];
parsed = parsed.filter(function(a) { return a && typeof a.name === 'string'; });
```

---

### LOW — Error Messages May Leak Server Details

**Files:**
- `widgets/monster-builder.js` ~line 1187
- `widgets/bestiary-browser.js` ~line 720

**Issue:** `err.message` from failed API calls is shown directly in alert dialogs.

```javascript
alert('Failed to save creature: ' + err.message);
```

**Risk:** Server error messages could leak implementation details (stack traces, database errors, internal paths).

**Remediation:** Use generic messages for users, log details to console:
```javascript
console.error('Save failed:', err);
alert('Failed to save creature. Please try again.');
```

---

### LOW — Blob URL Lifecycle

**File:** `widgets/bestiary-browser.js` ~line 728–733

**Issue:** Blob URL is created for JSON export downloads.

**Status:** **CLEAN** — `URL.revokeObjectURL()` is called immediately after `a.click()`. Properly implemented.

---

## What's Secure (Passed)

| Area | Status | Notes |
|------|--------|-------|
| **XSS Protection** | PASS | All user data escaped via `Chronicle.escapeHtml()` or `h()` consistently across all 3 widgets |
| **No eval/Function** | PASS | No dynamic code execution anywhere |
| **No hardcoded credentials** | PASS | No API keys, tokens, passwords, or secrets |
| **No sensitive data in storage** | PASS | No localStorage/sessionStorage/cookies used |
| **No document.write** | PASS | All DOM manipulation via createElement or innerHTML with escaping |
| **Modal click-jacking** | PASS | Overlay click handler checks `e.target === overlay` |
| **Download filename sanitization** | PASS | `creature.name.replace(/[^a-z0-9]/gi, '_')` prevents path traversal |
| **Prototype pollution** | PASS | No Object.assign on user input, no recursive merges |
| **Fetch error handling** | PASS | All fetch chains have .catch() handlers |
| **Data attribute safety** | PASS | `data-idx`, `data-step` values come from trusted loop indices |

---

## Recommendations for Phase 3/4 Development

### Phase 3 (Foundry Sync) — Security Considerations
1. The structured sync endpoint (`/sync/creatures/:entityId/statblock`) must enforce campaign membership
2. Statblock assembly/disassembly in Go must validate all fields — don't trust widget-provided data
3. The Foundry module's `Hooks.on('updateActor')` reverse sync should rate-limit to prevent DoS
4. HMAC or similar signing for sync payloads between Chronicle and Foundry

### Phase 4 (Community Bestiary) — Security Considerations
1. **All bestiary API routes need authentication and authorization**
2. Rate limiting per user per endpoint (especially publish, rate, flag)
3. Input sanitization on all text fields (name, description, tags) — prevent stored XSS in the Go backend
4. Self-rating prevention (user can't rate their own creature)
5. IDOR checks on publish/edit/delete — only creator can modify
6. Statblock JSON schema validation before storage
7. Text field size limits (name: 200 chars, description: 5000 chars, etc.)
8. Full-text search must use parameterized queries to prevent SQL injection
9. Moderation action logging with immutable audit trail
10. File upload considerations if creature images are added later

See `docs/implementation-checklist.md` items 4.2.4 (validation.go) and 4.3.3 (middleware.go) for the planned security implementation.

---

## Dependency Security

This package has **zero npm/Go dependencies**. All code is self-contained ES5 JavaScript and JSON. The only external dependency is the Chronicle platform itself (`Chronicle.apiFetch`, `Chronicle.escapeHtml`, `Chronicle.register`).

**Supply chain risk: NONE** for this package.

---

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| Critical | 0 | — |
| High | 2 | Fix before production (ID sanitization + API input validation) |
| Medium | 1 | Fix soon (JSON schema validation) |
| Low | 2 | Fix when convenient (error messages, already-clean blob URL) |
| Info/Pass | 10 | No action needed |

The two HIGH findings are partially mitigated by the fact that widget config comes from the Chronicle platform (not direct user input) and the Chronicle backend should enforce its own access control. However, defense-in-depth demands client-side validation too.
