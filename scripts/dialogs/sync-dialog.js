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
    this.syncProgress = null;
    this.model = {
      diffs: [],
      imports: [],
      stats: { diffs: 0, imports: 0 },
    };
    this._scrollPosition = 0;
  }

  static DEFAULT_OPTIONS = {
    id: 'archivist-sync-dialog',
    window: {
      title: 'Sync with Archivist',
      icon: 'fas fa-arrows-rotate',
      resizable: true,
    },
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
    const content = this.element?.querySelector?.('.sync-dialog-content');
    if (content && this._scrollPosition !== undefined) {
      content.scrollTop = this._scrollPosition;
    }
    this._updateSyncButtonState();

    // Shift+click multi-select for checkboxes
    this._lastToggleClick = null;
    const rows = this.element?.querySelectorAll?.('tr[data-id]') || [];
    for (const row of rows) {
      const cb = row.querySelector('input[data-action="toggleRow"]');
      if (!cb) continue;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="toggleCore"]')) return;
        if (!e.shiftKey || !this._lastToggleClick) {
          this._lastToggleClick = row;
          return;
        }
        // Range-select handles the clicked row itself; stop the event here so
        // the root-level toggleRow action doesn't flip it back afterwards.
        e.stopPropagation();
        const allRows = [...this.element.querySelectorAll('tr[data-id]')];
        const startIdx = allRows.indexOf(this._lastToggleClick);
        const endIdx = allRows.indexOf(row);
        if (startIdx < 0 || endIdx < 0) return;
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const targetState = cb.checked;
        for (let i = lo; i <= hi; i++) {
          const r = allRows[i];
          const kind = r.dataset.kind;
          const id = String(r.dataset.id || '');
          let modelRow;
          if (kind === 'diff') modelRow = this.model.diffs.find((x) => String(x.id) === id);
          else if (kind === 'import') modelRow = this.model.imports.find((x) => String(x.id) === id);
          if (modelRow) {
            modelRow.selected = targetState;
            const rCb = r.querySelector('input[data-action="toggleRow"]');
            if (rCb) rCb.checked = targetState;
            r.classList.toggle('selected', targetState);
          }
        }
        this._lastToggleClick = row;
        this._updateSyncButtonState();
      });
    }
  }

  _updateSyncButtonState() {
    const btn = this.element?.querySelector?.('[data-action="sync"]');
    if (!btn) return;
    const hasSelected =
      this.model.diffs.some((d) => d.selected) ||
      this.model.imports.some((i) => i.selected);
    btn.disabled = !hasSelected;
  }

  /**
   * Update the in-progress panel's text directly rather than re-rendering the
   * whole dialog for every synced item. The panel is rendered once before the
   * sync loop begins; a skipped update (panel absent) is corrected by the
   * final render when syncProgress is cleared.
   * @private
   */
  _updateProgressUI() {
    const panel = this.element?.querySelector?.('.loading-panel');
    if (!panel || !this.syncProgress) return;
    const { processed, total, current } = this.syncProgress;
    const textEl = panel.querySelector('.sync-progress-text');
    if (textEl) {
      textEl.textContent = `Processing ${processed} / ${total}…`;
    }
    let detailEl = panel.querySelector('.sync-progress-detail');
    if (current) {
      if (!detailEl) {
        detailEl = document.createElement('span');
        detailEl.className = 'sync-progress-detail';
        panel.appendChild(detailEl);
      }
      detailEl.textContent = current;
    } else if (detailEl) {
      detailEl.remove();
    }
  }

  _captureScrollPosition() {
    const content = this.element?.querySelector?.('.sync-dialog-content');
    if (content) {
      this._scrollPosition = content.scrollTop;
    }
  }

  async _prepareContext() {
    if (!this._initialized) {
      this._loadModel().then(() => {
        this._initialized = true;
        this.render({ force: true });
      });
      return {
        isLoading: true,
        diffs: [],
        imports: [],
        stats: { diffs: 0, imports: 0 },
        syncProgress: null,
      };
    }
    const hasSelected =
      this.model.diffs.some((d) => d.selected) ||
      this.model.imports.some((i) => i.selected);
    return {
      isLoading: this.isLoading,
      diffs: this.model.diffs,
      imports: this.model.imports,
      stats: this.model.stats,
      syncProgress: this.syncProgress || null,
      hasSelected,
    };
  }

  async _onSelectAll(event) {
    event.preventDefault();
    const scope = event?.target?.closest?.('[data-scope]')?.dataset?.scope;
    if (!scope) return;
    // Select All arms updates, never deletions. A deletion is irreversible in
    // both systems, so it stays an explicit per-row choice.
    if (scope === 'diffs')
      this.model.diffs.forEach((d) => (d.selected = !d.deleted));
    if (scope === 'imports')
      this.model.imports.forEach((i) => (i.selected = true));
    this._captureScrollPosition();
    await this.render();
  }

  async _onSelectNone(event) {
    event.preventDefault();
    const scope = event?.target?.closest?.('[data-scope]')?.dataset?.scope;
    if (!scope) return;
    if (scope === 'diffs')
      this.model.diffs.forEach((d) => (d.selected = false));
    if (scope === 'imports')
      this.model.imports.forEach((i) => (i.selected = false));
    this._captureScrollPosition();
    await this.render();
  }

  async _onToggleRow(event) {
    const row = event?.target?.closest?.('tr[data-id]');
    if (!row) return;
    const kind = row?.dataset?.kind;
    const id = String(row?.dataset?.id || '');
    let modelRow;
    if (kind === 'diff') {
      modelRow = this.model.diffs.find((x) => String(x.id) === id);
    } else if (kind === 'import') {
      modelRow = this.model.imports.find((x) => String(x.id) === id);
    }
    if (!modelRow) return;
    modelRow.selected = !modelRow.selected;
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = modelRow.selected;
    row.classList.toggle('selected', modelRow.selected);
    this._updateSyncButtonState();
  }

  async _onToggleCreateCore(event) {
    const tr = event?.target?.closest?.('tr[data-id]');
    if (!tr) return;
    const id = String(tr.dataset.id || '');
    const row = this.model.imports.find((x) => String(x.id) === id);
    if (!row || !row.coreType) return;
    row.createCore = !row.createCore;
  }

  async _onRefresh(event) {
    event?.preventDefault?.();
    this.isLoading = true;
    try {
      await this._loadModel(true);
    } finally {
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
    let selectedDiffs = this.model.diffs.filter((d) => d.selected);
    const selectedImports = this.model.imports.filter((i) => i.selected);

    // Show nothing selected warning
    if (selectedDiffs.length === 0 && selectedImports.length === 0) {
      ui.notifications?.warn?.('No items selected to sync.');
      return;
    }

    // Set loading state and render to show spinner
    this.isLoading = true;
    await this.render();

    // CRITICAL: Suppress real-time sync during apply to prevent duplicate POSTs to Archivist
    console.warn(
      '[SyncDialog] ⚠️  Real-time sync DISABLED during manual sync operations'
    );
    try {
      settingsManager.suppressRealtimeSync?.();
    } catch (_) {}

    // Verify suppression is active
    if (!settingsManager.isRealtimeSyncSuppressed?.()) {
      console.error(
        '[SyncDialog] ❌ CRITICAL: Realtime sync suppression FAILED!'
      );
      ui.notifications?.error?.(
        'Critical error: Unable to disable sync during operation.'
      );
      this.isLoading = false;
      await this.render();
      return;
    }
    console.debug('[SyncDialog] Real-time sync successfully suppressed');

    try {
      // Confirm deletions before proceeding. Declining must not throw away the
      // non-destructive half of the sync, so this is a three-way choice:
      // delete, skip just the deletions, or abandon the run entirely.
      let deleteDiffs = selectedDiffs.filter((d) => d.deleted);
      if (deleteDiffs.length > 0) {
        const names = deleteDiffs
          .map((d) => foundry.utils.escapeHTML(String(d.name ?? '')))
          .join(', ');
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: 'Confirm Deletion' },
          content:
            `<p><strong>${deleteDiffs.length}</strong> Foundry sheet${deleteDiffs.length > 1 ? 's' : ''} will be permanently deleted because ${deleteDiffs.length > 1 ? 'their' : 'its'} Archivist record no longer exists:</p>` +
            `<p>${names}</p>` +
            `<p>This cannot be undone. If ${deleteDiffs.length > 1 ? 'those records were' : 'that record was'} deleted by accident, skip the deletions and restore in Archivist first.</p>`,
          yes: { label: 'Delete them', icon: 'fas fa-trash' },
          no: { label: 'Skip deletions, apply the rest', icon: 'fas fa-forward' },
          defaultYes: false,
          rejectClose: false,
        });
        if (confirmed === null || confirmed === undefined) {
          // Dialog dismissed — abandon the whole run rather than guessing.
          this.isLoading = false;
          await this.render();
          return;
        }
        if (confirmed === false) {
          const skipped = new Set(deleteDiffs.map((d) => d.journalId));
          selectedDiffs = selectedDiffs.filter((d) => !skipped.has(d.journalId));
          deleteDiffs = [];
          for (const d of this.model.diffs) {
            if (skipped.has(d.journalId)) d.selected = false;
          }
        }
      }

      const total = selectedDiffs.length + selectedImports.length;
      let processed = 0;
      let failCount = 0;
      this.syncProgress = { total, processed, current: '' };
      await this.render();

      for (const d of selectedDiffs) {
        this.syncProgress.current = `${d.type}: ${d.name}`;
        this.syncProgress.processed = processed;
        this._updateProgressUI();
        try {
          await this._applyDiff(d);
        } catch (e) {
          failCount++;
          console.warn('[SyncDialog] applyDiff failed', d.name, e);
        }
        processed++;
      }

      for (const i of selectedImports) {
        this.syncProgress.current = `${i.type}: ${i.name}`;
        this.syncProgress.processed = processed;
        this._updateProgressUI();
        try {
          await this._applyImport(i, campaignId, apiKey);
        } catch (e) {
          failCount++;
          console.warn('[SyncDialog] applyImport failed', i.name, e);
        }
        processed++;
      }
      // Reflect the final processed count before the panel is torn down.
      this.syncProgress.processed = processed;
      this._updateProgressUI();

      this.syncProgress = null;

      const hasRecapDiffs = selectedDiffs.some(
        (d) => d.type === 'Session' && d.changes?.sessionDate
      );
      if (hasRecapDiffs || selectedImports.some((i) => i.type === 'Session')) {
        try {
          const recapsFolderId = await Utils.ensureJournalFolder('Recaps');
          const entries = (game.journal?.contents || [])
            .filter((j) => (j.folder?.id || null) === (recapsFolderId || null))
            .filter(
              (j) =>
                String(
                  (j.getFlag(CONFIG.MODULE_ID, 'archivist') || {}).sheetType ||
                    ''
                ) === 'recap'
            );
          const withDates = entries.map((j) => ({
            j,
            dateMs: (() => {
              const iso = String(
                j.getFlag(CONFIG.MODULE_ID, 'sessionDate') || ''
              ).trim();
              const t = iso ? new Date(iso).getTime() : NaN;
              return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
            })(),
          }));
          withDates.sort((a, b) => a.dateMs - b.dateMs);
          let index = 0;
          for (const { j } of withDates) {
            const desired = index * 1000;
            index += 1;
            if (j.sort !== desired) {
              try {
                await j.update({ sort: desired }, { render: false });
              } catch (_) {
                /* ignore */
              }
            }
          }
        } catch (_) {
          /* ignore ordering failures */
        }
      }

      const successCount = total - failCount;
      if (failCount === 0) {
        ui.notifications?.info?.(`Sync complete: ${successCount} item${successCount !== 1 ? 's' : ''} applied.`);
      } else {
        ui.notifications?.warn?.(
          `Sync finished: ${successCount} succeeded, ${failCount} failed. See console for details.`
        );
      }
      await this._refreshUIAfterSync?.();
      await this._loadModel(true);
    } catch (error) {
      console.error('[SyncDialog] Sync failed:', error);
      ui.notifications?.error?.('Sync failed. See console for details.');
      await this._loadModel(true);
    } finally {
      this.syncProgress = null;
      try {
        settingsManager.resumeRealtimeSync?.();
        console.debug('[SyncDialog] Real-time sync resumed after sync operation');
      } catch (_) {}
      await this.render();
    }
  }

  async _onCancel(event) {
    event?.preventDefault?.();
    this.close();
  }

  /** Force-refresh Foundry UI directories and open Archivist windows after a sync */
  async _refreshUIAfterSync() {
    try {
      await ui?.journal?.render?.({ force: true });
    } catch (_) {}
    try {
      await ui?.actors?.render?.({ force: true });
    } catch (_) {}
    try {
      await ui?.items?.render?.({ force: true });
    } catch (_) {}
    try {
      await ui?.scenes?.render?.({ force: true });
    } catch (_) {}
    // Hub removed
  }

  /**
   * Normalize text for comparison by collapsing whitespace and newlines.
   * This prevents false positives when comparing markdown with different newline styles.
   * @param {string} text - The text to normalize
   * @returns {string} - Normalized text
   */
  _normalizeTextForComparison(text) {
    if (!text) return '';
    return (
      String(text)
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
        .map((line) => line.trim())
        .join('\n')
        .trim()
    );
  }

  /**
   * Compare stored HTML while keeping tags, so `# Title` vs `Title` is a
   * real journal change instead of collapsing to the same plain text.
   * @param {string} html
   * @returns {string}
   */
  _normalizeHtmlForComparison(html) {
    const src = String(html ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const parked = [];
    const withoutCode = src.replace(
      /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,
      (m) => `\u0000${parked.push(m) - 1}\u0000`
    );
    const normalized = withoutCode
      .replace(/[^\S\n]+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
    return normalized.replace(
      /\u0000(\d+)\u0000/g,
      (_m, i) => parked[Number(i)] ?? ''
    );
  }

  /** Normalize quest objectives for stable JSON comparison. */
  _normalizeQuestObjectives(arr) {
    return JSON.stringify(
      (Array.isArray(arr) ? arr : []).map((o) => ({
        text: String(o?.text ?? '').trim(),
        status: String(o?.status ?? 'pending'),
      }))
    );
  }

  /** Normalize quest progress log entries for stable JSON comparison. */
  _normalizeQuestProgress(arr) {
    return JSON.stringify(
      (Array.isArray(arr) ? arr : [])
        .map((e) =>
          typeof e === 'string' ? e.trim() : String(e?.text ?? '').trim()
        )
        .filter(Boolean)
    );
  }

  /** Normalize quest relatedEntityRefs for stable JSON comparison. */
  _normalizeQuestRefs(arr) {
    return JSON.stringify(
      (Array.isArray(arr) ? arr : [])
        .map((r) => ({
          entityType: String(r?.entityType ?? '').toLowerCase(),
          entityId: String(r?.entityId ?? ''),
          label: String(r?.label ?? r?.entityNameSnapshot ?? '').trim(),
        }))
        .sort((a, b) =>
          `${a.entityType}:${a.entityId}`.localeCompare(
            `${b.entityType}:${b.entityId}`
          )
        )
    );
  }

  /** Diff local questData flags against Archivist quest payload. */
  _diffQuestData(localQd, arch) {
    const archNorm = archivistApi._normalizeQuestResponse(arch);
    const archQd = {
      status: archNorm.status || 'planned',
      questGiver: archNorm.questGiver || '',
      questCategory: archNorm.questCategory || 'n/a',
      successDefinition: archNorm.successDefinition || '',
      failureConditions: archNorm.failureConditions || '',
      nextAction: archNorm.nextAction || '',
      resolution: archNorm.resolution || '',
      objectives: Array.isArray(archNorm.objectives) ? archNorm.objectives : [],
      progressLog: Array.isArray(archNorm.progressLog)
        ? archNorm.progressLog
        : Array.isArray(archNorm.progress_log)
          ? archNorm.progress_log
          : [],
      relatedEntityRefs: Array.isArray(archNorm.relatedEntityRefs)
        ? archNorm.relatedEntityRefs
        : [],
    };
    const local = localQd || {};
    const questChanges = {};
    for (const field of [
      'status',
      'questGiver',
      'questCategory',
      'successDefinition',
      'failureConditions',
      'nextAction',
      'resolution',
    ]) {
      if (
        String(local[field] ?? '').trim() !== String(archQd[field] ?? '').trim()
      ) {
        questChanges[field] = { from: local[field], to: archQd[field] };
      }
    }
    if (
      this._normalizeQuestObjectives(local.objectives) !==
      this._normalizeQuestObjectives(archQd.objectives)
    ) {
      questChanges.objectives = {
        from: local.objectives || [],
        to: archQd.objectives,
      };
    }
    if (
      this._normalizeQuestProgress(local.progressLog) !==
      this._normalizeQuestProgress(archQd.progressLog)
    ) {
      questChanges.progressLog = {
        from: local.progressLog || [],
        to: archQd.progressLog,
      };
    }
    if (
      this._normalizeQuestRefs(local.relatedEntityRefs) !==
      this._normalizeQuestRefs(archQd.relatedEntityRefs)
    ) {
      questChanges.relatedEntityRefs = {
        from: local.relatedEntityRefs || [],
        to: archQd.relatedEntityRefs,
      };
    }
    return questChanges;
  }

  // Build model: diffs and imports
  async _loadModel(force = false) {
    if (this.isLoading && !force) return;
    this.isLoading = true;
    try {
      const apiKey = settingsManager.getApiKey?.();
      const campaignId = settingsManager.getSelectedWorldId?.();
      if (!apiKey || !campaignId) {
        this.model = {
          diffs: [],
          imports: [],
          stats: { diffs: 0, imports: 0 },
        };
        return;
      }

      const [chars, items, locs, facs, sessions, links, journals, quests] = await Promise.all([
        archivistApi.listCharacters(apiKey, campaignId),
        archivistApi.listItems(apiKey, campaignId),
        archivistApi.listLocations(apiKey, campaignId),
        archivistApi.listFactions(apiKey, campaignId),
        archivistApi.listSessions(apiKey, campaignId),
        archivistApi.listLinks(apiKey, campaignId),
        archivistApi.listJournals(apiKey, campaignId),
        archivistApi.listQuests(apiKey, campaignId),
      ]);
      const A = {
        characters: (chars?.success ? chars.data : []) || [],
        items: (items?.success ? items.data : []) || [],
        locations: (locs?.success ? locs.data : []) || [],
        factions: (facs?.success ? facs.data : []) || [],
        sessions: (sessions?.success ? sessions.data : []) || [],
        links: (links?.success ? links.data : []) || [],
        journals: (journals?.success ? journals.data : []) || [],
        quests: (quests?.success ? quests.data : []) || [],
      };
      console.debug('[SyncDialog] Fetched Archivist data:', {
        characters: A.characters.length,
        items: A.items.length,
        locations: A.locations.length,
        factions: A.factions.length,
        sessions: A.sessions.length,
        links: A.links.length,
        journals: A.journals.length,
        quests: A.quests.length,
      });
      const byId = {
        Character: new Map(A.characters.map((c) => [String(c.id), c])),
        Item: new Map(A.items.map((i) => [String(i.id), i])),
        Location: new Map(A.locations.map((l) => [String(l.id), l])),
        Faction: new Map(A.factions.map((f) => [String(f.id), f])),
        Session: new Map(A.sessions.map((s) => [String(s.id), s])),
        Journal: new Map(A.journals.map((j) => [String(j.id), j])),
        Quest: new Map(
          (quests?.success ? quests.data : []).map((q) => [
            String(q.id),
            archivistApi._normalizeQuestResponse(q),
          ])
        ),
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
        const type =
          st === 'pc' || st === 'npc' || st === 'character'
            ? 'Character'
            : st === 'item'
              ? 'Item'
              : st === 'location'
                ? 'Location'
                : st === 'faction'
                  ? 'Faction'
                  : st === 'recap' || st === 'session'
                    ? 'Session'
                    : st === 'journal'
                      ? 'Journal'
                      : st === 'quest'
                        ? 'Quest'
                        : null;
        if (!type) continue;
        const arch = byId[type].get(archId) || null;
        if (!arch) {
          diffs.push({
            type,
            id: archId,
            name: j.name,
            journalId: j.id,
            deleted: true,
            selected: false,
            changes: {},
          });
          continue;
        }
        const changes = {};
        // Name/title mapping per type
        const archName =
          type === 'Character'
            ? arch.character_name || arch.name
            : type === 'Session' || type === 'Journal'
              ? arch.title || arch.name || ''
              : type === 'Quest'
                ? arch.questName || arch.quest_name || arch.name || ''
                : arch.name || arch.title || '';
        if (String(j.name || '').trim() !== String(archName || '').trim()) {
          changes.name = { from: j.name, to: archName };
        }
        // Description mapping: compare normalized plain text (Foundry HTML vs Archivist Markdown)
        // Quest sheets store structured data in questData, not page body text.
        if (type === 'Quest') {
          try {
            const questChanges = this._diffQuestData(f.questData, arch);
            if (Object.keys(questChanges).length) {
              changes.questData = questChanges;
            }
          } catch (_) {
            /* ignore */
          }
        } else {
          // Description mapping: Foundry HTML vs Archivist Markdown
          try {
            const textPage =
              (j?.pages?.contents || []).find((p) => p.type === 'text') || null;
            const stored = Utils.extractPageHtml(textPage) || '';
            const archMd = Utils.archivistBodyText(type, arch);
            const archHtml = Utils.markdownToStoredHtml(archMd);

            // Journals now arrive as Markdown specifically to restore
            // headings/lists. Compare rendered HTML so `Title` vs `# Title`
            // is a real change, and allow an explicit empty Archivist body
            // to clear a stale Foundry page.
            let differs;
            if (String(type) === 'Journal') {
              differs =
                this._normalizeHtmlForComparison(stored) !==
                this._normalizeHtmlForComparison(archHtml);
            } else {
              const foundryNormalized = this._normalizeTextForComparison(
                Utils.toMarkdownIfHtml(stored)
              );
              const archivistNormalized = this._normalizeTextForComparison(
                Utils.toMarkdownIfHtml(archHtml)
              );
              differs = !!(
                archivistNormalized && foundryNormalized !== archivistNormalized
              );
            }
            if (differs) {
              changes.description = { from: stored, to: archMd };
            }
          } catch (_) {
            /* ignore */
          }
        }
        // Image diff: compare against custom sheet's flag image, not journal.img
        const archImg = String(arch.image || '').trim();
        if (archImg) {
          const jFlags = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
          const flagImg = String(jFlags.image || '').trim();
          if (flagImg !== archImg)
            changes.image = { from: flagImg, to: archImg };
        }
        // Session date diff: compare Archivist session_date with Foundry sessionDate flag
        if (type === 'Session' && arch.session_date) {
          try {
            const currentDate = String(
              j.getFlag(CONFIG.MODULE_ID, 'sessionDate') || ''
            ).trim();
            const archDate = String(arch.session_date || '').trim();
            if (archDate && currentDate !== archDate) {
              changes.sessionDate = { from: currentDate || null, to: archDate };
            }
          } catch (_) {
            /* ignore */
          }
        }
        // Links diff: only outgoing links (from_id == this sheet's archivistId), ignore alias
        // Quest relationships live in relatedEntityRefs, not the generic links table.
        if (type !== 'Quest') {
          try {
            const wantList = outgoing.get(archId) || [];
            const wantIds = new Set(wantList.map((x) => String(x.id)));
            // Additions: API wants a link that isn't in our local refs (any bucket)
            const localRefs = new Set();
            const refs = f.archivistRefs || {};
            Object.values(refs).forEach((arr) => {
              if (Array.isArray(arr))
                for (const x of arr) localRefs.add(String(x));
            });
            const toAdd = wantList.filter((x) => !localRefs.has(String(x.id)));

            // Removals: only consider links that this sheet believes are outbound
            const outbound = f.archivistOutbound || {};
            const haveOutbound = new Set();
            Object.values(outbound).forEach((arr) => {
              if (Array.isArray(arr))
                for (const x of arr) haveOutbound.add(String(x));
            });
            const toRemove =
              haveOutbound.size > 0
                ? [...haveOutbound].filter((x) => !wantIds.has(String(x)))
                : [];

            if (toAdd.length || toRemove.length)
              changes.links = { add: toAdd, remove: toRemove };
          } catch (_) {
            /* ignore */
          }
        }
        if (Object.keys(changes).length > 0) {
          diffs.push({
            type,
            id: archId,
            name: archName || j.name,
            journalId: j.id,
            changes,
            selected: false,
          });
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
        } catch (_) {
          /* ignore */
        }
      }
      console.debug('[SyncDialog] Linked Archivist IDs found in Foundry:', {
        count: linkedIds.size,
        ids: Array.from(linkedIds).slice(0, 10),
        sample: Array.from(foundryJournalMap.entries()).slice(0, 5),
      });

      const imports = [];
      const skipped = []; // for logging
      const pushImport = (type, row) => {
        const id = String(row.id);
        if (linkedIds.has(id)) {
          skipped.push({
            type,
            id,
            name: row.character_name || row.name || row.title || 'Untitled',
          });
          return;
        }
        // Determine coreType for this import
        const coreType =
          type === 'Character'
            ? 'actor'
            : type === 'Item'
              ? 'item'
              : type === 'Location'
                ? 'scene'
                : null;
        // For Characters, capture PC vs NPC from Archivist row
        let characterKind = undefined;
        if (type === 'Character') {
          const raw = String(
            row.type || row.character_type || ''
          ).toUpperCase();
          characterKind = raw === 'NPC' ? 'NPC' : 'PC';
        }
        imports.push({
          type,
          id,
          name: row.character_name || row.name || row.title || 'Untitled',
          description: Utils.archivistBodyText(type, row),
          image: row.image || '',
          selected: false,
          createCore: false,
          coreType,
          ...(characterKind ? { characterKind } : {}),
        });
      };
      for (const c of A.characters) pushImport('Character', c);
      for (const it of A.items) pushImport('Item', it);
      for (const l of A.locations) pushImport('Location', l);
      for (const f of A.factions) pushImport('Faction', f);
      for (const s of A.sessions) pushImport('Session', s);
      for (const j of A.journals) pushImport('Journal', { ...j, name: j.title || 'Untitled' });
      for (const q of A.quests)
        pushImport('Quest', {
          ...q,
          name: q.questName || q.quest_name || 'Quest',
        });

      console.debug('[SyncDialog] Import candidates:', {
        imports: imports.length,
        skipped: skipped.length,
        importSample: imports
          .slice(0, 5)
          .map((x) => ({ type: x.type, id: x.id, name: x.name })),
        skippedSample: skipped.slice(0, 5),
      });

      this.model = {
        diffs,
        imports,
        stats: { diffs: diffs.length, imports: imports.length },
      };
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
      // Hub image flag removed
    }
    if (changes.sessionDate) {
      // Update sessionDate flag to match Archivist session_date (same as world setup)
      const archDate = String(changes.sessionDate.to || '').trim();
      if (archDate) {
        try {
          await j.setFlag(
            CONFIG.MODULE_ID,
            'sessionDate',
            archDate
          );
          // Also update sort order if this is a recap in the Recaps folder
          const sheetType = String(
            (j.getFlag(CONFIG.MODULE_ID, 'archivist') || {}).sheetType || ''
          ).toLowerCase();
          if (sheetType === 'recap' || sheetType === 'session') {
            try {
              const sortValue = new Date(archDate).getTime();
              if (Number.isFinite(sortValue)) {
                await j.update({ sort: sortValue }, { render: false });
              }
            } catch (_) {
              /* ignore sort update failures */
            }
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (changes.questData) {
      const nextFlags = { ...(f || {}) };
      const qd = { ...(nextFlags.questData || {}) };
      for (const [key, diff] of Object.entries(changes.questData)) {
        qd[key] = diff.to;
      }
      nextFlags.questData = qd;
      await j.setFlag(CONFIG.MODULE_ID, 'archivist', nextFlags);
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
      next.archivistRefs = next.archivistRefs || {
        characters: [],
        items: [],
        entries: [],
        factions: [],
        locationsAssociative: [],
      };
      next.archivistOutbound = next.archivistOutbound || {
        characters: [],
        items: [],
        entries: [],
        factions: [],
        locationsAssociative: [],
      };
      // Add
      for (const add of changes.links.add || []) {
        const bucket =
          buckets[String(add.type || '').toLowerCase()] || 'entries';
        const arr = Array.isArray(next.archivistRefs[bucket])
          ? next.archivistRefs[bucket]
          : [];
        const sid = String(add.id);
        if (!arr.includes(sid)) arr.push(sid);
        next.archivistRefs[bucket] = arr;
        // Mirror to outbound so future diffs don't consider this a stale outbound mismatch
        const outArr = Array.isArray(next.archivistOutbound[bucket])
          ? next.archivistOutbound[bucket]
          : [];
        if (!outArr.includes(sid)) outArr.push(sid);
        next.archivistOutbound[bucket] = outArr;
      }
      // Remove only from outbound buckets; leave inbound/associative intact
      const removeIds = new Set(
        (changes.links.remove || []).map((x) => String(x))
      );
      const outboundKeys = [
        'characters',
        'items',
        'factions',
        'locationsAssociative',
        'entries',
      ];
      for (const key of outboundKeys) {
        const arr = Array.isArray(next.archivistRefs[key])
          ? next.archivistRefs[key]
          : [];
        next.archivistRefs[key] = arr.filter((x) => !removeIds.has(String(x)));
        const outArr = Array.isArray(next.archivistOutbound[key])
          ? next.archivistOutbound[key]
          : [];
        next.archivistOutbound[key] = outArr.filter(
          (x) => !removeIds.has(String(x))
        );
      }
      await j.setFlag(CONFIG.MODULE_ID, 'archivist', next);
    }
  }

  async _applyImport(row, campaignId, apiKey) {
    const sheetType =
      row.type === 'Character'
        ? String(row.characterKind || '').toUpperCase() === 'NPC'
          ? 'npc'
          : 'pc'
        : row.type === 'Item'
          ? 'item'
          : row.type === 'Location'
            ? 'location'
            : row.type === 'Faction'
              ? 'faction'
              : row.type === 'Session'
                ? 'recap'
                : row.type === 'Journal'
                  ? 'journal'
                  : row.type === 'Quest'
                    ? 'quest'
                    : null;
    if (!sheetType) return;
    // Convert markdown from Archivist to HTML for Foundry storage (sessions use summary)
    const markdownContent = Utils.archivistBodyText(row.type, row);
    const htmlContent = Utils.markdownToStoredHtml(markdownContent);

    // Determine folder ID based on sheet type using saved destinations
    let folderId = undefined;
    let sort = undefined;

    try {
      const destinations = settingsManager.getJournalDestinations?.() || {};

      if (sheetType === 'pc' && destinations.pc) {
        folderId = destinations.pc;
      } else if (sheetType === 'npc' && destinations.npc) {
        folderId = destinations.npc;
      } else if (sheetType === 'item' && destinations.item) {
        folderId = destinations.item;
      } else if (sheetType === 'location' && destinations.location) {
        folderId = destinations.location;
      } else if (sheetType === 'faction' && destinations.faction) {
        folderId = destinations.faction;
      } else if (sheetType === 'journal') {
        // Worlds set up before journals existed have no saved destination —
        // fall back to ensuring the default folder like recaps do.
        folderId =
          destinations.journal ||
          (await Utils.ensureJournalFolder('Archivist - Journals'));
      } else if (sheetType === 'quest') {
        folderId =
          destinations.quest ||
          (await Utils.ensureJournalFolder('Archivist - Quests'));
      } else if (sheetType === 'recap') {
        // For sessions/recaps, use Recaps folder and preserve session_date ordering
        folderId = await Utils.ensureJournalFolder('Recaps');
        if (row.session_date) {
          try {
            sort = new Date(row.session_date).getTime();
          } catch (_) {}
        }
      }

      console.debug('[SyncDialog] Importing to folder:', {
        sheetType,
        folderId: folderId || 'root',
        name: row.name,
      });
    } catch (e) {
      console.warn('[Sync Dialog] Failed to resolve folder destination:', e);
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
    // For journals, set GM-only default permissions
    if (sheetType === 'journal') {
      try {
        await journal.update(
          { ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } },
          { render: false }
        );
      } catch (_) {}
    }
    // For quests, fetch full quest data and store in flags
    if (sheetType === 'quest' && apiKey && row.id) {
      try {
        let fullQuest = row;
        try {
          const resp = await archivistApi.getQuest(apiKey, row.id);
          if (resp.success && resp.data) fullQuest = resp.data;
        } catch (_) {}
        const flags = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
        flags.questData = {
          questName: fullQuest.questName || fullQuest.quest_name || '',
          questGiver: fullQuest.questGiver || fullQuest.quest_giver || '',
          questCategory:
            fullQuest.questCategory || fullQuest.quest_category || 'n/a',
          status: fullQuest.status || 'planned',
          successDefinition:
            fullQuest.successDefinition || fullQuest.success_definition || '',
          failureConditions:
            fullQuest.failureConditions || fullQuest.failure_conditions || '',
          nextAction: fullQuest.nextAction || fullQuest.next_action || '',
          resolution: fullQuest.resolution || '',
          objectives: Array.isArray(fullQuest.objectives) ? fullQuest.objectives : [],
          progressLog: Array.isArray(fullQuest.progressLog)
            ? fullQuest.progressLog
            : Array.isArray(fullQuest.progress_log)
              ? fullQuest.progress_log
            : Array.isArray(fullQuest.progressLogEntries)
              ? fullQuest.progressLogEntries.map((e) =>
                  typeof e === 'string' ? e : e.text || ''
                )
              : Array.isArray(fullQuest.progress_log_entries)
                ? fullQuest.progress_log_entries.map((e) =>
                    typeof e === 'string' ? e : e.text || ''
                  )
              : [],
          relatedCharacters:
            fullQuest.relatedCharacters || fullQuest.related_characters || [],
          relatedFactions:
            fullQuest.relatedFactions || fullQuest.related_factions || [],
          relatedLocations:
            fullQuest.relatedLocations || fullQuest.related_locations || [],
          relatedItems:
            fullQuest.relatedItems || fullQuest.related_items || [],
          relatedEntityRefs:
            fullQuest.relatedEntityRefs || fullQuest.related_entity_refs || [],
          firstSession: fullQuest.firstSession || fullQuest.first_session || null,
          lastSession: fullQuest.lastSession || fullQuest.last_session || null,
        };
        await journal.setFlag(CONFIG.MODULE_ID, 'archivist', flags);
      } catch (_) {}
    }
    // For locations, set parent relation from Archivist's parent_id
    if (sheetType === 'location' && row.parent_id) {
      try {
        const { setLocationParent } = await import(
          '../modules/links/helpers.js'
        );
        await setLocationParent(journal, String(row.parent_id));
      } catch (_) {
        /* noop */
      }
    }
    // For sessions, set sessionDate flag for later edits
    if (sheetType === 'recap' && row.session_date) {
      try {
        await journal.setFlag(
          CONFIG.MODULE_ID,
          'sessionDate',
          String(row.session_date)
        );
      } catch (_) {}
    }
    // Ensure chronological ordering within the Recaps folder (oldest -> newest)
    if (sheetType === 'recap') {
      try {
        // If we didn't resolve a folder earlier (edge cases), try to find or create one now
        const recapsFolderId =
          folderId || (await Utils.ensureJournalFolder('Recaps'));
        const entries = (game.journal?.contents || [])
          .filter((j) => (j.folder?.id || null) === (recapsFolderId || null))
          .filter(
            (j) =>
              String(
                (j.getFlag(CONFIG.MODULE_ID, 'archivist') || {}).sheetType || ''
              ) === 'recap'
          );
        const withDates = entries.map((j) => ({
          j,
          dateMs: (() => {
            const iso = String(
              j.getFlag(CONFIG.MODULE_ID, 'sessionDate') || ''
            ).trim();
            const t = iso ? new Date(iso).getTime() : NaN;
            return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; // undated go to end
          })(),
        }));
        withDates.sort((a, b) => a.dateMs - b.dateMs);
        let index = 0;
        for (const { j } of withDates) {
          const desired = index * 1000;
          index += 1;
          if (j.sort !== desired) {
            try {
              await j.update({ sort: desired }, { render: false });
            } catch (_) {
              /* ignore */
            }
          }
        }
      } catch (_) {
        /* ignore ordering failures */
      }
    }
    // Optionally create core docs
    try {
      const flags = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      flags.foundryRefs = flags.foundryRefs || {
        actors: [],
        items: [],
        scenes: [],
        journals: [],
      };
      if (
        row.createCore &&
        row.coreType === 'actor' &&
        (sheetType === 'pc' || sheetType === 'npc')
      ) {
        const img = String(row.image || '').trim();
        const actor = await Actor.create(
          {
            name: row.name,
            type: sheetType === 'pc' ? 'character' : 'npc',
            ...(img ? { img } : {}),
          },
          { render: false }
        );
        if (actor?.id) flags.foundryRefs.actors = [actor.id];
      }
      if (row.createCore && row.coreType === 'item' && sheetType === 'item') {
        const img = String(row.image || '').trim();
        const safeType = Utils.resolveItemType({ type: row?.type });
        const itm = await Item.create(
          { name: row.name, type: safeType, ...(img ? { img } : {}) },
          { render: false }
        );
        if (itm?.id) flags.foundryRefs.items = [itm.id];
      }
      if (
        row.createCore &&
        row.coreType === 'scene' &&
        sheetType === 'location'
      ) {
        const img = String(row.image || '').trim();
        const sc = await Scene.create(
          { name: row.name, ...(img ? { thumb: img, img } : {}) },
          { render: false }
        );
        if (sc?.id) flags.foundryRefs.scenes = [sc.id];
      }
      await journal.setFlag(CONFIG.MODULE_ID, 'archivist', flags);

      // After creation, hydrate outgoing links from Archivist (from_id == row.id)
      try {
        if (apiKey && campaignId && row.id) {
          const resp = await archivistApi.listLinksByFromId(
            apiKey,
            campaignId,
            String(row.id)
          );
          if (resp?.success) {
            const keyForType = (t) => {
              const s = String(t || '').toLowerCase();
              if (s === 'character') return 'characters';
              if (s === 'item') return 'items';
              if (s === 'location') return 'locationsAssociative';
              if (s === 'faction') return 'factions';
              if (s === 'entry' || s === 'journal' || s === 'journalentry')
                return 'entries';
              return 'entries';
            };
            const f2 = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
            f2.archivistRefs = f2.archivistRefs || {
              characters: [],
              items: [],
              entries: [],
              factions: [],
              locationsAssociative: [],
            };
            f2.archivistOutbound = f2.archivistOutbound || {
              characters: [],
              items: [],
              entries: [],
              factions: [],
              locationsAssociative: [],
            };
            for (const L of resp.data || []) {
              const bucket = keyForType(L.to_type);
              const id = String(L.to_id);
              const arr = Array.isArray(f2.archivistRefs[bucket])
                ? f2.archivistRefs[bucket]
                : [];
              if (!arr.includes(id)) arr.push(id);
              f2.archivistRefs[bucket] = arr;
              const outArr = Array.isArray(f2.archivistOutbound[bucket])
                ? f2.archivistOutbound[bucket]
                : [];
              if (!outArr.includes(id)) outArr.push(id);
              f2.archivistOutbound[bucket] = outArr;
            }
            await journal.setFlag(CONFIG.MODULE_ID, 'archivist', f2);
          }

          // Project description into core documents if created or bound
          try {
            const projectEnabled =
              settingsManager.getProjectDescriptionsEnabled?.();
            if (projectEnabled) {
              const { SlotResolver } = await import(
                '../modules/projection/slot-resolver.js'
              );
              // If we created a core doc, project into it; otherwise project into the journal page
              let targetDoc = null;
              const flags =
                journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
              const actorId = Array.isArray(flags?.foundryRefs?.actors)
                ? flags.foundryRefs.actors[0]
                : null;
              const itemId = Array.isArray(flags?.foundryRefs?.items)
                ? flags.foundryRefs.items[0]
                : null;
              const sceneId = Array.isArray(flags?.foundryRefs?.scenes)
                ? flags.foundryRefs.scenes[0]
                : null;
              if (actorId) targetDoc = game.actors?.get?.(actorId) || null;
              else if (itemId) targetDoc = game.items?.get?.(itemId) || null;
              else if (sceneId) targetDoc = game.scenes?.get?.(sceneId) || null;

              const md = Utils.archivistBodyText(row.type, row);
              const html = Utils.markdownToStoredHtml(md);

              if (targetDoc) {
                await SlotResolver.projectDescription(targetDoc, html);
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    } catch (_) {}

    // After import, rebuild link index so trees/associations are available
    try {
      const { linkIndexer } = await import('../modules/links/indexer.js');
      linkIndexer.buildFromWorld();
    } catch (_) {}
  }
}
