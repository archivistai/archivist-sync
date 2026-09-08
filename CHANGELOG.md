# Changelog

All notable changes to the Archivist Sync module will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.15] - 2026-09-08

### Fixed
- Description projection now resolves a slot on systems other than dnd5e and
  pf2e. The adapter registry only knew those two, and the fallback heuristics
  were themselves dnd5e-shaped, so on any other system every candidate path
  failed `hasProperty()` and projection silently wrote nothing. Adds a
  Daggerheart adapter (`system.biography.background` for PCs, bare
  `system.description` for the isNPC actor types and for items) plus a
  schema-probing fallback tier that walks the document's own DataModel instead
  of guessing paths. Generic leaves (`value`, `public`) are only accepted
  inside a known prose container, so a root-level mechanical `system.value`
  is never treated as a description. The probe also descends into
  `EmbeddedDataField` models when the field itself is a prose container.
  Slot selection for dnd5e and pf2e is unchanged.
- Projection no longer fails silently: when no slot resolves, the GM gets one
  notification per system and document type instead of a lone `console.warn`
  swallowed by the caller's `catch`.
- `Utils.getActorDescriptionReadPaths()` / `getActorDescriptionWritePath()` know
  about Daggerheart, so a projected description is read back from the same field
  it was written to. Companion actors, which have no prose field, now return
  no path instead of writing to a non-existent `system.description`.

### Removed
- Dead `SystemAdapter` module (`scripts/modules/adapters/system-adapter.js`) and
  its `esmodules` entry. Nothing imported it, and it held a third divergent copy
  of the per-system description path guesses.

## [1.3.14] - 2026-08-05

### Added
- Quest sync parity with v14 line (from #48).
- Dual-track release infrastructure: `v13-latest` moving manifest URL.

### Changed
- Release workflow now publishes from `release/v13` with version-family guards.
- Manifest URL in published builds points at `v13-latest` (not `/releases/latest`).

### Fixed
- Stable release guards and Latest-badge ownership hardened.
- Beta version written into `module.json` for Foundry update detection (CI).

## [1.3.13] - 2026-04-13

### Added
- Release to fix the release flow. 

## [1.3.12] - 2026-01-12

### Added
- New GM-only setting to allow private journal context in Archivist Chat; GM requests now send `gm_permissions` to `/v1/ask` when enabled.

## [1.3.11] - 2025-01-15

### Fixed
- When syncing existing Session Recaps via the "Sync with Archivist" button, the `sessionDate` flag is now properly detected and updated when the `session_date` changes in Archivist, ensuring correct date display and chronological sorting in the Recaps folder.

## [1.3.10] - 2025-01-15

### Fixed
- Custom elements (sync button, create buttons, eye toggle buttons) in the Journals tab now mount immediately after world setup completes, without requiring a manual refresh. Fixed V13 ApplicationV2 element access and added automatic re-render triggers when world initialization completes.
- Improved robustness of Journal Directory hooks with retry mechanisms to handle asynchronous DOM rendering.

### Changed
- Recap custom sheet now displays the session date as MM/DD/YYYY.
- After importing Recaps via the Sync dialog, Recaps in the Recaps folder are normalized to sort by the `sessionDate` flag ascending (oldest → newest); undated Recaps are placed at the end.

## [1.3.9] - 2025-12-06

### Fixed
- Recap “lock” (save) action could wipe the summary in Foundry and on the Archivist API if the editor selector failed to resolve; editor detection has been made robust for the Recap layout, local page updates only occur when content is actually read, and the API summary field is only included when content is present.

## [1.3.7] - 2025-12-05

### Fixed
- Realtime sync hooks now ignore core Foundry documents and third-party imports unless they carry Archivist flags, preventing conflicts with modules like PopOut and stopping unintended API POSTs for unrelated items/journals.

### Changed
- World Setup and manual Sync dialogs now start with no rows selected so GMs must explicitly opt in to each import/diff, preventing accidental bulk operations.

## [1.3.6] - 2025-11-19

### Fixed
- CoC7 conflict with roll result chat card

## [1.3.5] - 2025-11-11

### Fixed
- Token duplication when drag and dropping.
- Adjustments to the sync 

## [1.3.4] - 2025-10-21

### Changed
- Recaps Journal folder entries are now sorted chronologically

## [1.3.3] - 2025-10-21

### Added
- If the counts for documents being imported into Archivist during the initial world setup exceed 100 for any of the categories, we format those values in red and display a conditional warning to users not to import generic compendium items into their Archivist campaigns.

### Changed
- Moved visibility toggle icon buttons to in-line actions for list items in Journals tab
- Replaced "Archivist Hub" button in Journals tab with "Sync with Archivist" button
- We no longer overwrite the `img` property of existing Actors/Items if they are mapped to an Archivist record during initial sync. We'll only set that property if we're creating a new object for the user and we have a non-null Archivist `image` value.

### Removed
- Archivist Hub Dialog
- Archivist Hub Scene controls button
- Archivist Hub buttons in Journal tab and Archivist chat tab

### Fixed
- Updating descriptions through Archivist sync now used proper html formatting so the html renders correctly in the Info tab
- Using "Place on Scene" button for Actors only fires once

## [1.3.2] - 2025-10-21

### Added
- New "Chat Visibility" setting allows GMs to control who can see the Archivist Chat sidebar tab (All users, GM only, or None)

### [1.3.1] - 2025-10-20

### Changed
- Standardized class names

### Removed
- Send to Player button

## [1.3.0] - 2025-10-20

### Added
- Projection/Ingestion for Actor/Item descriptions with improved heuristics to determine the most likely property paths
- Setting to toggle real-time syncing on/off
- Setting to toggle projection on/off

### Changed
- "Run World Setup Again" now completely clears Archivist journal directories

### Fixed
- UI re-render bug fixes

### Notes
- Projection/Ingest has been tested for dnd 5e and pf2e but not for other systems yet.

## [1.2.2] - 2025-10-16

## Fixed
- Merged CSS files
- World setup tabs no longer auto switch when selecting a checkbox

## [1.2.0] - 2025-10-16

## Added
- New release workflow
- completley new UI
- Built to be system agnostic

## [1.2.0] - 2025-10-15

### Added
- 

### Changed
- 

### Fixed
- 

## [1.0.1] - 2025-10-17

### Added
- Initial release of Archivist Sync module
- Basic data synchronization functionality
- Manual export feature for game archives
- Scene control tools for GM access
- Configurable sync intervals (60-3600 seconds)
- Automatic monitoring of actor and item creation
- English localization support
- Foundry VTT v13 compatibility
- Module settings panel integration
- Console logging for debugging and monitoring
- Responsive UI design
- Custom CSS styling for module elements

### Features
- **Data Sync**: Automatic and manual synchronization of game data
- **Archive Export**: Download game state as JSON file
- **GM Tools**: Scene control integration for easy access
- **Settings**: Configurable sync behavior and intervals
- **Monitoring**: Real-time logging of sync operations
- **Localization**: Support for multiple languages (English included)

### Technical Details
- Compatible with Foundry VTT v12+ (verified for v13)
- Uses ES modules for modern JavaScript support
- Implements Foundry VTT hooks for seamless integration
- Responsive design for various screen sizes
- No external dependencies required

---

## Template for Future Releases

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Now removed features

### Fixed
- Any bug fixes

### Security
- In case of vulnerabilities
