# Attribution — reference data (`data/*.json`)

## What is reproduced, and from where

The rules text in the following files is **DRAW STEEL** game content, reproduced
from the published Draw Steel 1.0 ruleset (the *Heroes Book*):

| File | Content | Source location |
|------|---------|-----------------|
| `rules-glossary.json` | Conditions, keywords, movement, actions, and other glossary terms | *Heroes Book* ch. 1 (The Basics), ch. 5 (Classes), ch. 10 (Combat) |
| `skills.json` | Skill names and their uses | *Heroes Book* ch. 9 (Tests) |
| `ancestries.json` | The twelve ancestries: signature traits, purchased traits, point costs, and granted abilities | *Heroes Book* ch. 3 (Ancestries) |

It was compiled with reference to the community **Steel Compendium**
(<https://steelcompendium.io>, GitHub `SteelCompendium/data-md`), which publishes
this material under the same Creator License and carries the same attribution
disclaimer. The specific files consulted for `ancestries.json` were
`Rules/Ancestries/*.md` (the twelve per-ancestry files) and
`Rules/Chapters/Ancestries.md`; the glossary additions came from
`Rules/Chapters/Combat.md`, `Rules/Chapters/Classes.md`, and
`Rules/Chapters/The Basics.md`.

## Licence

This package is an independent product published under the **DRAW STEEL Creator
License** and is not affiliated with MCDM Productions, LLC.
**DRAW STEEL © 2024 MCDM Productions, LLC.**

The Draw Steel Creator License (<https://www.mcdmproductions.com/draw-steel-creator-license>)
permits reproducing Draw Steel rules text in third-party products, including
free/open-source ones, provided the above attribution is included and MCDM
endorsement is not implied. No MCDM trademarks, logos, art, or proprietary setting
material are used here — only rules text (condition/keyword/skill/ancestry trait
definitions and their mechanical numbers).

### Setting material deliberately excluded

The published ancestry entries are mostly proprietary setting fiction — narrative
vignettes with named characters, named places, and named gods. **None of that is
reproduced here.** Only the "<Ancestry> Traits" rules sections carry over. Where a
trait's opening flavor sentence named a place or an in-world term, that sentence was
dropped and only the mechanics kept; the affected traits record this in
`properties.omissions` (memonek Keeper of Order / Nonstop / Useful Emotion, and the
dragon knight's Remember Your Oath, whose recited verse is omitted). The mechanics of
every such trait are complete.

## Custom (non-published) content

Anything in `data/` that is **not** reproduced from published Draw Steel rules is
flagged in that entry's `properties`, so it can be told apart from published content
at a glance:

- **`properties.custom_fields`** — lists the fields on that entry that were written
  for this package rather than reproduced. In `ancestries.json`, every entry carries
  `"custom_fields": ["description"]`: because the published ancestry descriptions are
  setting fiction (see above), each `description` is an original, neutral mechanical
  summary written for this package. The `signature_traits` and `purchased_traits`
  on those same entries are published rules text.
- **`properties.source: "custom"`** — marks an entry that is wholly original
  (operator-authored ancestries, creatures, worked examples, derived tables, helper
  entries). Published entries instead carry their real provenance in
  `properties.source`, e.g. `"Draw Steel Heroes Book, ch. 3 (mcdm.heroes.v1), via
  Steel Compendium"`.

Operators adding their own ancestries and creatures should set
`"source": "custom"` on those entries.

## Known inconsistency — to be corrected

`manifest.json`, `README.md`, `data/creatures.json`, `docs/DATA-SCHEMA.md`,
`docs/PROJECT-HANDOFF.md`, and `docs/implementation-checklist.md` currently describe
the Draw Steel content in this package as **CC-BY-4.0**. That is incorrect: MCDM has
not released Draw Steel under Creative Commons, and there is no Draw Steel SRD or
free Basic Rules tier. The Creator License described above is the only permission
this package relies on, and it is the position stated in this file. Those CC-BY
claims should be replaced with the Creator License attribution; they are left
untouched here only because correcting them spans files outside this dataset.
