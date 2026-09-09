# Changelog

All notable changes to the Archivist Sync module will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.3] - 2026-09-09

### Fixed
- Imported Journal sheets rendered their body squeezed into the narrow left
  column instead of the page area. `journal.hbs` has no `<aside>`, but the base
  `.archivist-sheet` grid (`180px 1fr`) still applied, so its lone `<main>` was
  placed in the sidebar track. Recap escaped this via a
  `.archivist-sheet-recap-simple` override that the journal sheet never got.
  Both templates now carry a shared `.archivist-sheet-full` modifier, so any
  future sidebar-less sheet gets the single-column layout by construction.
- Re-running World Setup created a second JournalEntry for every Archivist
  record it had already imported. `createCustomJournalForImport` now adopts an
  existing sheet with the same `archivistId` instead of creating a rival, which
  covers every caller (world setup, sync dialog) at once.
- Deleting a Foundry sheet no longer silently hard-deletes the Archivist record
  it points at. When other sheets still reference the same `archivistId` — the
  duplicate case above — only the local copy is removed. When it is the last
  sheet for that record, the GM is asked first and can keep the Archivist copy.
  Previously, deleting a duplicate destroyed the shared upstream record, and
  the next sync then deleted the surviving sheet as an orphan.
- "Select All" in the sync dialog no longer arms deletion rows; deletions stay
  an explicit per-row choice. Declining the deletion confirmation now applies
  the rest of the sync instead of abandoning the whole run.
- Journal bodies imported as one run-on paragraph with headings and bullets
  lost. The module now requests `format=markdown` from `/journals`, and the
  built-in markdown renderer (used when no `markdown-it` global is present)
  understands headings, ordered/unordered/nested lists, blockquotes, fenced
  code and horizontal rules rather than only paragraphs.
- A Journal's body is read from `content`; the previous
  `description || summary || content` order imported its short `summary` blurb
  as the whole entry.

## [2.0.2] - 2026-09-08

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

## [2.0.1] - 2026-08-05

### Added
- Quest sync parity with the v13 line: full Quests feature, local image upload, and related API augments.
- Dual-track release infrastructure: v14 stable publishes from `main`; manifest URL uses `v14-latest`.

### Changed
- Dual-track release model: v14 stable publishes from `main`; manifest URL uses `v14-latest`.

### Fixed
- Quest ownership leak (F1): related quests filtered by ownership for tab count and empty state.
- Fail closed when a related quest has no local journal (security hardening).
- Release workflow guards and beta CI version detection for Foundry update checks.

## [2.0.0] - 2026-04-05

### Changed
- **Foundry V14 migration**: Module now targets Foundry VTT v14 (minimum 14.359, verified 14.359).
- Updated `module.json` for v14 manifest expectations, including `type: "module"` and v14 compatibility metadata.
- Kept the existing Archivist Chat sidebar implementation, but updated its runtime wiring so the chat button and panel continue to render correctly on v14.
- Updated startup and sidebar initialization logic for v14 while preserving the existing Journals tab controls and chat behavior.
- Updated all Cursor rules from v13 to v14 references with corrected file globs.

### Added
- New Cursor rules for v14 sidebar/pop-out patterns and manifest/public API guidance.
- Migration documentation at `docs/foundry-v14-migration.md`.

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
