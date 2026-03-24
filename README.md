# Chronicle - Draw Steel System Pack

Game system content pack for Chronicle providing Draw Steel RPG reference data, entity presets, and Foundry VTT integration.

## Contents

- **Reference Data**: Abilities, ancestries, kits, and creatures (stub data - to be populated)
- **Entity Presets**: Hero (with Foundry VTT sync) and creature templates
- **Relation Types**: Ally, enemy, patron, mentor, has-item (with quantity/equipped metadata)
- **Foundry VTT Integration**: foundry_path annotations for automatic sync with the Draw Steel Foundry system

## Installation

### Via Package Manager (Recommended)
1. Go to Admin > Packages
2. Add this repository URL
3. Install the latest version
4. Enable the Draw Steel addon in your campaign settings

### Via Manual Upload
1. Download the latest release ZIP
2. Go to Campaign Settings > Content Packs > Upload System
3. Upload the ZIP and verify the validation report

## License

Content is licensed under CC-BY-4.0. Draw Steel is a product of MCDM Productions.
See LICENSE for details.

## Contributing

To add reference content:
1. Add entries to the appropriate data/*.json file
2. Follow the Chronicle system data format (id, name, summary, description, properties, tags, source)
3. Ensure all content is from CC-BY-4.0 licensed sources
4. Include source attribution on every entry
