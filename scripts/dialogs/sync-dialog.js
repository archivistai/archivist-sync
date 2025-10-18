import { settingsManager } from '../modules/settings-manager.js';
import { archivistApi } from '../services/archivist-api.js';
import { CONFIG } from '../modules/config.js';
import { Utils } from '../modules/utils.js';

/**
 * SyncDialog — Two‑phase reconciliation wizard
 * Phase 1: Diffs for linked sheets (text, image, links, deletions)
 * Phase 2: Unlinked Archivist docs with import options (and optional core Actor/Item/Scene creation)
 */
export class SyncDialog extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    constructor(options = {}) {
        super(options);
        this.isLoading = false;
        this.model = {
            diffs: [], // { type, id, name, journalId, changes: { name?, description?, image?, links? }, deleted?:boolean, selected:boolean }
            imports: [], // { type, id, name, image, description, selected:boolean, createCore:boolean, coreType:'actor'|'item'|'scene'|null }
            stats: { diffs: 0, imports: 0 },
        };
        this._scrollPosition = 0;
    }

    static DEFAULT_OPTIONS = {
        id: 'archivist-sync-dialog',
        window: { title: 'Sync with Archivist', icon: 'fas fa-arrows-rotate', resizable: true },
        position: { width: 900, height: 700 },
        classes: ['archivist-sync-dialog', 'sync-dialog'],
        actions: {
            selectAll: SyncDialog.prototype._onSelectAll,
            selectNone: SyncDialog.prototype._onSelectNone,
            toggleRow: SyncDialog.prototype._onToggleRow,
            toggleCore: SyncDialog.prototype._onToggleCreateCore,
            sync: SyncDialog.prototype._onSync,
            cancel: SyncDialog.prototype._onCancel,
            refresh: SyncDialog.prototype._onRefresh,
        },
    };

    static PARTS = {
        form: { template: 'modules/archivist-sync/templates/sync-dialog.hbs' },
    };

    async _onRender(context, options) {
        await super._onRender?.(context, options);
        // Restore scroll position after render
        const content = this.element?.querySelector?.('.sync-dialog-content');
        if (content && this._scrollPosition !== undefined) {
            content.scrollTop = this._scrollPosition;
        }
    }

    _captureScrollPosition() {
        const content = this.element?.querySelector?.('.sync-dialog-content');
        if (content) {
            this._scrollPosition = content.scrollTop;
        }
    }

    async _prepareContext() {
        // If not initialized, show loading and trigger background fetch
        if (!this._initialized) {
            // Trigger data load in background (don't await here)
            this._loadModel().then(() => {
                this._initialized = true;
                this.render({ force: true });
            });
            // Return loading state immediately
            return {
                isLoading: true,
                diffs: [],
                imports: [],
                stats: { diffs: 0, imports: 0 },
                isGM: game.user?.isGM,
            };
        }
        const ctx = {
            isLoading: this.isLoading,
            diffs: this.model.diffs,
            imports: this.model.imports,
            stats: this.model.stats,
            isGM: game.user?.isGM,
        };
        return ctx;
    }

    async _onSelectAll(event) {
        event.preventDefault();
        const scope = event?.target?.closest?.('[data-scope]')?.dataset?.scope;
        if (!scope) return;
        if (scope === 'diffs') this.model.diffs.forEach(d => d.selected = true);
        if (scope === 'imports') this.model.imports.forEach(i => i.selected = true);
        this._captureScrollPosition();
        await this.render();
    }

    async _onSelectNone(event) {
        event.preventDefault();
        const scope = event?.target?.closest?.('[data-scope]')?.dataset?.scope;
        if (!scope) return;
        if (scope === 'diffs') this.model.diffs.forEach(d => d.selected = false);
        if (scope === 'imports') this.model.imports.forEach(i => i.selected = false);
        this._captureScrollPosition();
        await this.render();
    }

    async _onToggleRow(event) {
        const row = event?.target?.closest?.('tr[data-id]');
        if (!row) return;
        const kind = row?.dataset?.kind;
        const id = String(row?.dataset?.id || '');
        if (kind === 'diff') {
            const diffRow = this.model.diffs.find(x => String(x.id) === id);
            if (diffRow) diffRow.selected = !diffRow.selected;
        } else if (kind === 'import') {
            const importRow = this.model.imports.find(x => String(x.id) === id);
            if (importRow) importRow.selected = !importRow.selected;
        }
        this._captureScrollPosition();
        await this.render();
    }

    async _onToggleCreateCore(event) {
        const tr = event?.target?.closest?.('tr[data-id]');
        if (!tr) return;
        const id = String(tr.dataset.id || '');
        const row = this.model.imports.find(x => String(x.id) === id);
        if (!row || !row.coreType) return;
        row.createCore = !row.createCore;
        this._captureScrollPosition();
        await this.render();
    }

    async _onRefresh(event) {
        event?.preventDefault?.();
        // Set loading state to show the spinner
        this.isLoading = true;
        await this.render();
        try {
            await this._loadModel(true);
        } finally {
            // Loading state will be set to false by _loadModel
            await this.render();
        }
    }

    async _onSync(event) {
        event.preventDefault();
        const apiKey = settingsManager.getApiKey?.();
        const campaignId = settingsManager.getSelectedWorldId?.();
        if (!apiKey || !campaignId) {
            ui.notifications?.warn?.('Archivist world not configured.');
            return;
        }
        const selectedDiffs = this.model.diffs.filter(d => d.selected);
        const selectedImports = this.model.imports.filter(i => i.selected);

        // Show nothing selected warning
        if (selectedDiffs.length === 0 && selectedImports.length === 0) {
            ui.notifications?.warn?.('No items selected to sync.');
            return;
        }

        // Set loading state and render to show spinner
        this.isLoading = true;
        await this.render();

        // CRITICAL: Suppress real-time sync during apply to prevent duplicate POSTs to Archivist
        console.warn('[SyncDialog] ⚠️  Real-time sync DISABLED during manual sync operations');
        try { settingsManager.suppressRealtimeSync?.(); } catch (_) { }

        // Verify suppression is active
        if (!settingsManager.isRealtimeSyncSuppressed?.()) {
            console.error('[SyncDialog] ❌ CRITICAL: Realtime sync suppression FAILED!');
            ui.notifications?.error?.('Critical error: Unable to disable sync during operation.');
            this.isLoading = false;
            await this.render();
            return;
        }
        console.log('[SyncDialog] ✓ Real-time sync successfully suppressed');

        try {
            // Apply diffs
            for (const d of selectedDiffs) {
                try { await this._applyDiff(d); } catch (e) { console.warn('[SyncDialog] applyDiff failed', e); }
            }

            // Apply imports
            for (const i of selectedImports) {
                try { await this._applyImport(i, campaignId, apiKey); } catch (e) { console.warn('[SyncDialog] applyImport failed', e); }
            }

            ui.notifications?.info?.('Archivist sync applied.');
            // Force-refresh core directories and any open Archivist windows so UI reflects new docs
            await this._refreshUIAfterSync?.();
            // Close the dialog after successful sync
            this.close();
        } catch (error) {
            console.error('[SyncDialog] Sync failed:', error);
            ui.notifications?.error?.('Sync failed. See console for details.');
            // On error, reload model and stay open so user can retry
            await this._loadModel(true);
            await this.render();
        } finally {
            // Resume real-time sync after apply
            try {
                settingsManager.resumeRealtimeSync?.();
                console.log('[SyncDialog] ✓ Real-time sync resumed after sync operation');
            } catch (_) { }
        }
    }

    async _onCancel(event) {
        event?.preventDefault?.();
        this.close();
    }

    /** Force-refresh Foundry UI directories and open Archivist windows after a sync */
    async _refreshUIAfterSync() {
        try { await ui?.journal?.render?.({ force: true }); } catch (_) { }
        try { await ui?.actors?.render?.({ force: true }); } catch (_) { }
        try { await ui?.items?.render?.({ force: true }); } catch (_) { }
        try { await ui?.scenes?.render?.({ force: true }); } catch (_) { }
        // Refresh Archivist Hub if it's open
        try { if (window.__ARCHIVIST_HUB__?.rendered) window.__ARCHIVIST_HUB__.render(false); } catch (_) { }
    }

    /**
     * Normalize text for comparison by collapsing whitespace and newlines.
     * This prevents false positives when comparing markdown with different newline styles.
     * @param {string} text - The text to normalize
     * @returns {string} - Normalized text
     */
    _normalizeTextForComparison(text) {
        if (!text) return '';
        return String(text)
            .trim()
            // Normalize line endings to \n
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Collapse multiple consecutive newlines to double newline (paragraph break)
            .replace(/\n{3,}/g, '\n\n')
            // Normalize spaces (collapse multiple spaces to one, but preserve newlines)
            .replace(/[^\S\n]+/g, ' ')
            // Trim whitespace from each line
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    // Build model: diffs and imports
    async _loadModel(force = false) {
        if (this.isLoading && !force) return;
        this.isLoading = true;
        try {
            const apiKey = settingsManager.getApiKey?.();
            const campaignId = settingsManager.getSelectedWorldId?.();
            if (!apiKey || !campaignId) {
                this.model = { diffs: [], imports: [], stats: { diffs: 0, imports: 0 } };
                return;
            }

            const [chars, items, locs, facs, sessions, links] = await Promise.all([
                archivistApi.listCharacters(apiKey, campaignId),
                archivistApi.listItems(apiKey, campaignId),
                archivistApi.listLocations(apiKey, campaignId),
                archivistApi.listFactions(apiKey, campaignId),
                archivistApi.listSessions(apiKey, campaignId),
                archivistApi.listLinks(apiKey, campaignId),
            ]);
            const A = {
                characters: (chars?.success ? chars.data : []) || [],
                items: (items?.success ? items.data : []) || [],
                locations: (locs?.success ? locs.data : []) || [],
                factions: (facs?.success ? facs.data : []) || [],
                sessions: (sessions?.success ? sessions.data : []) || [],
                links: (links?.success ? links.data : []) || [],
            };
            console.log('[SyncDialog] Fetched Archivist data:', {
                characters: A.characters.length,
                items: A.items.length,
                locations: A.locations.length,
                factions: A.factions.length,
                sessions: A.sessions.length,
                links: A.links.length,
            });
            const byId = {
                Character: new Map(A.characters.map(c => [String(c.id), c])),
                Item: new Map(A.items.map(i => [String(i.id), i])),
                Location: new Map(A.locations.map(l => [String(l.id), l])),
                Faction: new Map(A.factions.map(f => [String(f.id), f])),
                Session: new Map(A.sessions.map(s => [String(s.id), s])),
            };

            // Compute outgoing links (from_id => [{ id: to_id, type: to_type }])
            const outgoing = new Map();
            for (const L of A.links) {
                const from = String(L.from_id);
                const to = String(L.to_id);
                const ttype = String(L.to_type || '').trim();
                if (!outgoing.has(from)) outgoing.set(from, []);
                outgoing.get(from).push({ id: to, type: ttype });
            }

            // Phase 1: Diffs for linked journals
            const diffs = [];
            const jAll = game.journal?.contents || [];
            for (const j of jAll) {
                const f = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
                const archId = f.archivistId ? String(f.archivistId) : null;
                const st = String(f.sheetType || '').toLowerCase();
                if (!archId) continue;
                const type = st === 'pc' || st === 'npc' || st === 'character' ? 'Character'
                    : st === 'item' ? 'Item'
                        : st === 'location' ? 'Location'
                            : st === 'faction' ? 'Faction'
                                : (st === 'recap' || st === 'session') ? 'Session'
                                    : null;
                if (!type) continue;
                const arch = byId[type].get(archId) || null;
                if (!arch) {
                    diffs.push({ type, id: archId, name: j.name, journalId: j.id, deleted: true, selected: true, changes: {} });
                    continue;
                }
                const changes = {};
                // Name/title mapping per type
                const archName = type === 'Character' ? (arch.character_name || arch.name)
                    : type === 'Session' ? (arch.title || arch.name || '')
                        : arch.name || arch.title || '';
                if (String(j.name || '').trim() !== String(archName || '').trim()) {
                    changes.name = { from: j.name, to: archName };
                }
                // Description mapping: compare normalized plain text (Foundry HTML vs Archivist Markdown)
                try {
                    const textPage = (j?.pages?.contents || []).find(p => p.type === 'text') || null;
                    const stored = Utils.extractPageHtml(textPage) || '';
                    const foundryPlain = Utils.toMarkdownIfHtml(stored);
                    const archMd = String((arch.description ?? arch.summary) || '');
                    const archHtml = Utils.markdownToStoredHtml(archMd);
                    const archivistPlain = Utils.toMarkdownIfHtml(archHtml);

                    // Normalize both sides for comparison to handle newline/whitespace differences
                    const foundryNormalized = this._normalizeTextForComparison(foundryPlain);
                    const archivistNormalized = this._normalizeTextForComparison(archivistPlain);

                    if (archivistNormalized && foundryNormalized !== archivistNormalized) {
                        changes.description = { from: stored, to: archMd };
                    }
                } catch (_) { /* ignore */ }
                // Image diff: compare against custom sheet's flag image, not journal.img
                const archImg = String(arch.image || '').trim();
                if (archImg) {
                    const jFlags = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
                    const flagImg = String(jFlags.image || '').trim();
                    if (flagImg !== archImg) changes.image = { from: flagImg, to: archImg };
                }
                // Links diff: only outgoing links (from_id == this sheet's archivistId), ignore alias
                try {
                    const wantList = outgoing.get(archId) || [];
                    const wantIds = new Set(wantList.map(x => String(x.id)));
                    // Additions: API wants a link that isn't in our local refs (any bucket)
                    const localRefs = new Set();
                    const refs = (f.archivistRefs || {});
                    Object.values(refs).forEach(arr => { if (Array.isArray(arr)) for (const x of arr) localRefs.add(String(x)); });
                    const toAdd = wantList.filter(x => !localRefs.has(String(x.id)));

                    // Removals: only consider links that this sheet believes are outbound
                    const outbound = f.archivistOutbound || {};
                    const haveOutbound = new Set();
                    Object.values(outbound).forEach(arr => { if (Array.isArray(arr)) for (const x of arr) haveOutbound.add(String(x)); });
                    const toRemove = haveOutbound.size > 0 ? [...haveOutbound].filter(x => !wantIds.has(String(x))) : [];

                    if (toAdd.length || toRemove.length) changes.links = { add: toAdd, remove: toRemove };
                } catch (_) { /* ignore */ }
                if (Object.keys(changes).length > 0) {
                    diffs.push({ type, id: archId, name: archName || j.name, journalId: j.id, changes, selected: true });
                }
            }

            // Phase 2: Imports — Archivist docs without linked journals
            // Build a definitive set of linked Archivist IDs by scanning live world documents
            const linkedIds = new Set();
            const foundryJournalMap = new Map(); // archivistId => journal name (for debugging)
            for (const j of jAll) {
                // Primary: journal-level archivist flags
                const f = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
                if (f.archivistId) {
                    linkedIds.add(String(f.archivistId));
                    foundryJournalMap.set(String(f.archivistId), j.name);
                }
                // Secondary: page-level flags (e.g., Recaps container pages)
                try {
                    const pages = j.pages?.contents || [];
                    for (const p of pages) {
                        const pid = p?.getFlag?.(CONFIG.MODULE_ID, 'archivistId');
                        if (pid) {
                            linkedIds.add(String(pid));
                            foundryJournalMap.set(String(pid), `${j.name} > ${p.name}`);
                        }
                    }
                } catch (_) { /* ignore */ }
            }
            console.log('[SyncDialog] Linked Archivist IDs found in Foundry:', {
                count: linkedIds.size,
                ids: Array.from(linkedIds).slice(0, 10),
                sample: Array.from(foundryJournalMap.entries()).slice(0, 5),
            });

            const imports = [];
            const skipped = []; // for logging
            const pushImport = (type, row) => {
                const id = String(row.id);
                if (linkedIds.has(id)) {
                    skipped.push({ type, id, name: row.character_name || row.name || row.title || 'Untitled' });
                    return;
                }
                // Determine coreType for this import
                const coreType = type === 'Character' ? 'actor'
                    : type === 'Item' ? 'item'
                        : type === 'Location' ? 'scene'
                            : null;
                // For Characters, capture PC vs NPC from Archivist row
                let characterKind = undefined;
                if (type === 'Character') {
                    const raw = String(row.type || row.character_type || '').toUpperCase();
                    characterKind = raw === 'NPC' ? 'NPC' : 'PC';
                }
                imports.push({
                    type,
                    id,
                    name: row.character_name || row.name || row.title || 'Untitled',
                    description: row.description || row.summary || '',
                    image: row.image || '',
                    selected: false,
                    createCore: false,
                    coreType,
                    ...(characterKind ? { characterKind } : {})
                });
            };
            for (const c of A.characters) pushImport('Character', c);
            for (const it of A.items) pushImport('Item', it);
            for (const l of A.locations) pushImport('Location', l);
            for (const f of A.factions) pushImport('Faction', f);
            for (const s of A.sessions) pushImport('Session', s);

            console.log('[SyncDialog] Import candidates:', {
                imports: imports.length,
                skipped: skipped.length,
                importSample: imports.slice(0, 5).map(x => ({ type: x.type, id: x.id, name: x.name })),
                skippedSample: skipped.slice(0, 5),
            });

            this.model = { diffs, imports, stats: { diffs: diffs.length, imports: imports.length } };
        } finally {
            this.isLoading = false;
        }
    }

    async _applyDiff(d) {
        const j = game.journal?.get?.(d.journalId);
        if (!j) return;
        const f = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
        if (d.deleted) {
            await j.delete();
            return;
        }
        const changes = d.changes || {};
        if (changes.name) {
            await j.update({ name: changes.name.to });
        }
        if (changes.description) {
            // Convert markdown to HTML before storing in Foundry
            const markdownContent = String(changes.description.to || '');
            const htmlContent = Utils.markdownToStoredHtml(markdownContent);
            await Utils.ensureJournalTextPage(j, htmlContent);
        }
        if (changes.image) {
            const imageUrl = String(changes.image.to || '');
            await Utils.ensureJournalLeadImage(j, imageUrl);
            // Update the archivist.image flag so diff detection recognizes the change
            const nextFlags = { ...(f || {}) };
            nextFlags.image = imageUrl;
            await j.setFlag(CONFIG.MODULE_ID, 'archivist', nextFlags);
            // Also store on hub flag for sheet previews
            try { await j.setFlag('archivist-hub', 'image', imageUrl); } catch (_) { }
        }
        if (changes.links) {
            const buckets = {
                character: 'characters',
                item: 'items',
                location: 'locationsAssociative',
                faction: 'factions',
                entry: 'entries',
                journal: 'entries',
                journalentry: 'entries',
            };
            const next = { ...(f || {}) };
            next.archivistRefs = next.archivistRefs || { characters: [], items: [], entries: [], factions: [], locationsAssociative: [] };
            next.archivistOutbound = next.archivistOutbound || { characters: [], items: [], entries: [], factions: [], locationsAssociative: [] };
            // Add
            for (const add of (changes.links.add || [])) {
                const bucket = buckets[String(add.type || '').toLowerCase()] || 'entries';
                const arr = Array.isArray(next.archivistRefs[bucket]) ? next.archivistRefs[bucket] : [];
                const sid = String(add.id);
                if (!arr.includes(sid)) arr.push(sid);
                next.archivistRefs[bucket] = arr;
                // Mirror to outbound so future diffs don't consider this a stale outbound mismatch
                const outArr = Array.isArray(next.archivistOutbound[bucket]) ? next.archivistOutbound[bucket] : [];
                if (!outArr.includes(sid)) outArr.push(sid);
                next.archivistOutbound[bucket] = outArr;
            }
            // Remove only from outbound buckets; leave inbound/associative intact
            const removeIds = new Set((changes.links.remove || []).map(x => String(x)));
            const outboundKeys = ['characters', 'items', 'factions', 'locationsAssociative', 'entries'];
            for (const key of outboundKeys) {
                const arr = Array.isArray(next.archivistRefs[key]) ? next.archivistRefs[key] : [];
                next.archivistRefs[key] = arr.filter(x => !removeIds.has(String(x)));
                const outArr = Array.isArray(next.archivistOutbound[key]) ? next.archivistOutbound[key] : [];
                next.archivistOutbound[key] = outArr.filter(x => !removeIds.has(String(x)));
            }
            await j.setFlag(CONFIG.MODULE_ID, 'archivist', next);
        }
    }

    async _applyImport(row, campaignId, apiKey) {
        const sheetType = row.type === 'Character' ? ((String(row.characterKind || '').toUpperCase() === 'NPC') ? 'npc' : 'pc')
            : row.type === 'Item' ? 'item'
                : row.type === 'Location' ? 'location'
                    : row.type === 'Faction' ? 'faction'
                        : row.type === 'Session' ? 'recap'
                            : null;
        if (!sheetType) return;
        // Convert markdown from Archivist to HTML for Foundry storage (sessions use summary)
        const markdownContent = String((row.description || row.summary) || '');
        const htmlContent = Utils.markdownToStoredHtml(markdownContent);

        // For sessions, prefer Recaps folder and preserve session_date ordering
        let folderId = undefined;
        let sort = undefined;
        if (sheetType === 'recap') {
            try { folderId = await Utils.ensureJournalFolder('Recaps'); } catch (_) { }
            if (row.session_date) {
                try { sort = new Date(row.session_date).getTime(); } catch (_) { }
            }
        }

        const journal = await Utils.createCustomJournalForImport({
            name: row.name,
            html: htmlContent,
            imageUrl: String(row.image || ''),
            sheetType,
            archivistId: row.id,
            worldId: campaignId,
            folderId,
            sort,
        });
        if (!journal) return;
        // For sessions, set sessionDate flag for later edits
        if (sheetType === 'recap' && row.session_date) {
            try { await journal.setFlag(CONFIG.MODULE_ID, 'sessionDate', String(row.session_date)); } catch (_) { }
        }
        // Optionally create core docs
        try {
            const flags = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
            flags.foundryRefs = flags.foundryRefs || { actors: [], items: [], scenes: [], journals: [] };
            if (row.createCore && row.coreType === 'actor' && (sheetType === 'pc' || sheetType === 'npc')) {
                const img = String(row.image || '').trim();
                const actor = await Actor.create({ name: row.name, type: sheetType === 'pc' ? 'character' : 'npc', ...(img ? { img } : {}) }, { render: false });
                if (actor?.id) flags.foundryRefs.actors = [actor.id];
            }
            if (row.createCore && row.coreType === 'item' && sheetType === 'item') {
                const img = String(row.image || '').trim();
                const itm = await Item.create({ name: row.name, type: 'loot', ...(img ? { img } : {}) }, { render: false });
                if (itm?.id) flags.foundryRefs.items = [itm.id];
            }
            if (row.createCore && row.coreType === 'scene' && sheetType === 'location') {
                const img = String(row.image || '').trim();
                const sc = await Scene.create({ name: row.name, ...(img ? { thumb: img, img } : {}) }, { render: false });
                if (sc?.id) flags.foundryRefs.scenes = [sc.id];
            }
            await journal.setFlag(CONFIG.MODULE_ID, 'archivist', flags);

            // After creation, hydrate outgoing links from Archivist (from_id == row.id)
            try {
                if (apiKey && campaignId && row.id) {
                    const resp = await archivistApi.listLinksByFromId(apiKey, campaignId, String(row.id));
                    if (resp?.success) {
                        const keyForType = t => {
                            const s = String(t || '').toLowerCase();
                            if (s === 'character') return 'characters';
                            if (s === 'item') return 'items';
                            if (s === 'location') return 'locationsAssociative';
                            if (s === 'faction') return 'factions';
                            if (s === 'entry' || s === 'journal' || s === 'journalentry') return 'entries';
                            return 'entries';
                        };
                        const f2 = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
                        f2.archivistRefs = f2.archivistRefs || { characters: [], items: [], entries: [], factions: [], locationsAssociative: [] };
                        f2.archivistOutbound = f2.archivistOutbound || { characters: [], items: [], entries: [], factions: [], locationsAssociative: [] };
                        for (const L of (resp.data || [])) {
                            const bucket = keyForType(L.to_type);
                            const id = String(L.to_id);
                            const arr = Array.isArray(f2.archivistRefs[bucket]) ? f2.archivistRefs[bucket] : [];
                            if (!arr.includes(id)) arr.push(id);
                            f2.archivistRefs[bucket] = arr;
                            const outArr = Array.isArray(f2.archivistOutbound[bucket]) ? f2.archivistOutbound[bucket] : [];
                            if (!outArr.includes(id)) outArr.push(id);
                            f2.archivistOutbound[bucket] = outArr;
                        }
                        await journal.setFlag(CONFIG.MODULE_ID, 'archivist', f2);
                    }
                }
            } catch (_) { }
        } catch (_) { }
    }
}

export const ArchivistSyncDialog = SyncDialog;


