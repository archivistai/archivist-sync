/**
 * Archivist Sync Module for Foundry VTT v13
 *
 * A comprehensive module for synchronizing world data with the Archivist API.
 * This is the main orchestrator that coordinates all module components.
 *
 */

// Import all module components
import { CONFIG } from './modules/config.js';
import { settingsManager } from './modules/settings-manager.js';
import { archivistApi } from './services/archivist-api.js';
import { Utils } from './modules/utils.js';
import { linkIndexer } from './modules/links/indexer.js';
import { AskChatWindow } from './dialogs/ask-chat-window.js';
import { ensureChatSlot } from './sidebar/ask-chat-tab.js';
import { SyncDialog } from './dialogs/sync-dialog.js';
import { WorldSetupDialog } from './dialogs/world-setup-dialog.js';
// import { openV2SheetFor } from './modules/sheets/v2-sheets.js';
import { LinkHelpers } from './modules/links/helpers.js';

/**
 * Initialize the module when Foundry VTT is ready
 */

Hooks.once('init', async function () {
  try {
    console.log('[Archivist Sync] init');
  } catch (_) {}
  // Register settings as early as possible so other early hooks can read them
  try {
    settingsManager.registerSettings?.();
  } catch (e) {
    console.warn(
      '[Archivist Sync] Settings registration failed during init',
      e
    );
  }
  // Register custom Journal sheets (v13)
  // Disable V1 DocumentSheet registrations in favor of V2 apps
  // (We rely on directory and TOC intercepts to open V2 sheets.)
  try {
    /* intentionally not registering V1 sheets */
  } catch (e) {
    console.warn(
      '[Archivist Sync] Sheet registration skipped; using V2 sheets only',
      e
    );
  }

  // Register JournalEntry sheet classes with the core sheet registry (V2 DocumentSheet)
  try {
    const {
      EntryPageSheetV2,
      PCPageSheetV2,
      NPCPageSheetV2,
      CharacterPageSheetV2,
      ItemPageSheetV2,
      LocationPageSheetV2,
      FactionPageSheetV2,
      RecapPageSheetV2,
      JournalPageSheetV2,
      QuestPageSheetV2,
    } = await import('./modules/sheets/page-sheet-v2.js');

    const DSC =
      foundry?.applications?.apps?.DocumentSheetConfig || DocumentSheetConfig;
    DSC.registerSheet(JournalEntry, 'archivist-sync', EntryPageSheetV2, {
      label: 'Archivist: Entry',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', PCPageSheetV2, {
      label: 'Archivist: PC',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', NPCPageSheetV2, {
      label: 'Archivist: NPC',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', ItemPageSheetV2, {
      label: 'Archivist: Item',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', LocationPageSheetV2, {
      label: 'Archivist: Location',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', FactionPageSheetV2, {
      label: 'Archivist: Faction',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', RecapPageSheetV2, {
      label: 'Archivist: Recap',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', JournalPageSheetV2, {
      label: 'Archivist: Journal',
      types: ['base'],
      makeDefault: false,
    });
    DSC.registerSheet(JournalEntry, 'archivist-sync', QuestPageSheetV2, {
      label: 'Archivist: Quest',
      types: ['base'],
      makeDefault: false,
    });
  } catch (e) {
    console.error(
      '[Archivist Sync] Failed to register V2 DocumentSheet sheets',
      e
    );
  }
  // Sidebar.TABS registration removed — v14 does not support dynamic tab
  // addition via this API.  The chat button is injected at runtime by
  // updateArchivistChatAvailability() in the ready hook.
});

Hooks.once('setup', function () {
  console.debug('[Archivist Sync] setup');
});

// Register Scene Controls immediately (outside ready) so it's available on reloads
// Scene control buttons no longer used; Hub removed

Hooks.once('ready', async function () {
  try {
    if (!document.getElementById('sidebar')) {
      await ui.sidebar?.render?.();
    }
  } catch (e) {
    console.error('[Archivist Sync] ready - error rendering sidebar:', e);
  }

  Utils.log('Module initialized');

  // Register module settings and menu
  settingsManager.registerSettings();
  // Ensure organized folders exist (always during ready) so imports land correctly
  try {
    await Utils.ensureArchivistFolders();
  } catch (_) {}

  // Normalize Recaps ordering on ready in case they were imported previously
  try {
    const normalizeRecapsOrdering = async () => {
      try {
        const folder = (game.folders?.contents || []).find(
          (f) =>
            f?.type === 'JournalEntry' &&
            String(f?.name || '').toLowerCase() === 'recaps'
        );
        if (!folder) return;
        if (folder.sorting !== 'm') await folder.update({ sorting: 'm' });
        const entries = (game.journal?.contents || [])
          .filter((j) => (j.folder?.id || null) === folder.id)
          .filter((j) => {
            try {
              const a = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
              return String(a.sheetType || '') === 'recap';
            } catch (_) {
              return false;
            }
          });
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
        let i = 0;
        for (const { j } of withDates) {
          const desired = i * 1000;
          i += 1;
          if (j.sort !== desired)
            await j.update({ sort: desired }, { render: false });
        }
        try {
          ui.journal?.render?.(true);
        } catch (_) {}
      } catch (e) {
        console.warn('[Archivist Sync][Recaps] Ready normalization failed:', e);
      }
    };
    // Run shortly after ready so the directory exists
    setTimeout(() => normalizeRecapsOrdering(), 250);
  } catch (_) {}

  // Ensure world initialization flag exists (but don't auto-initialize)
  try {
    const flagCreated = await settingsManager.ensureWorldInitializationFlag();
    if (flagCreated) {
      Utils.log(
        'Created world initialization flag (set to false - awaiting setup)'
      );
    }
  } catch (error) {
    console.error(
      '[Archivist Sync] Failed to ensure world initialization flag:',
      error
    );
  }

  // Initialize debugging interface
  initializeDebugInterface();

  // Conditionally set up Archivist chat based on availability
  updateArchivistChatAvailability();

  // If world is already initialized, ensure Journal Directory renders with custom elements
  // This handles cases where the directory was rendered before initialization
  if (settingsManager.isWorldInitialized?.() && game.user?.isGM) {
    setTimeout(async () => {
      try {
        await ui?.journal?.render?.({ force: true });
        console.log('[Archivist Sync] Journal Directory re-rendered on ready (world already initialized)');
      } catch (e) {
        console.warn('[Archivist Sync] Failed to re-render Journal Directory on ready', e);
      }
    }, 500); // Delay to ensure everything is fully loaded
  }

  // Delegated renderer: when the archivist tab button is clicked, render chat into panel
  try {
    const sidebar = document.getElementById('sidebar');
    const tabsNav = sidebar?.querySelector?.('#sidebar-tabs, nav.tabs');
    if (tabsNav) {

    const onClick = (ev) => {
      // CRITICAL: Ignore clicks on dice roll cards or any elements inside them
      // This prevents interference with CoC7's dice roll expansion
      const isInDiceRoll = ev.target?.closest?.(
        '.chat-card, .roll-card, .card-buttons, .dice-roll, .dice-result, .dice-formula, .roll-result, .dice-tooltip'
      );
      if (isInDiceRoll) {
        return; // Don't interfere with dice roll interactions
      }

      // Also check if the click is inside the chat content area (not on tab buttons)
      // This ensures we only handle clicks on actual tab navigation buttons
      const isInChatContent = ev.target?.closest?.(
        '#chat, .chat-sidebar, .chat-log, .chat-message, .message-content'
      );
      if (isInChatContent) {
        // Only proceed if we're clicking on a tab button, not on chat content
        const isTabButton = ev.target?.closest?.('button[data-action="tab"]');
        if (!isTabButton) {
          return;
        }
      }

      // Only handle clicks on tab buttons - since we're listening to the nav container,
      // we only need to check if it's a tab button
      const btn = ev.target.closest?.(
        'button[data-action="tab"][data-tab="archivist-chat"]'
      );
      if (!btn) {
        return;
      }

      setTimeout(async () => {
        try {
          const sidebar = document.getElementById('sidebar');
          const panel = sidebar?.querySelector?.('#archivist-chat.tab');
          if (!panel) return;

          // Ensure this panel is visible/active even if core didn't switch
          try {
            const contentWrap = panel.parentElement;
            contentWrap?.querySelectorAll?.('.tab').forEach((el) => {
              el.classList.remove('active');
              el.style.display = 'none';
            });
            panel.style.display = '';
            panel.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            btn.setAttribute('aria-selected', 'true');
            btn.classList?.add?.('active');
          } catch (_) {}

          if (!window.__ARCHIVIST_SIDEBAR_CHAT__) {
            window.__ARCHIVIST_SIDEBAR_CHAT__ = new AskChatWindow({
              popOut: false,
            });
          }
          window.__ARCHIVIST_SIDEBAR_CHAT__._mountEl = panel;
          await window.__ARCHIVIST_SIDEBAR_CHAT__.render(false);
        } catch (e) {
          console.warn('[Archivist Sync] Delegated render failed', e);
        }
      }, 0);
    };
    tabsNav.addEventListener('click', onClick);

    } // end if (tabsNav found for delegated renderer)
  } catch (e) {
    console.error('[Archivist Sync] Failed to install delegated renderer', e);
  }

  // Delegated cleanup: when any other tab is clicked, clear our forced overrides
  try {
    const sidebar = document.getElementById('sidebar');
    const tabsNav = sidebar?.querySelector?.('#sidebar-tabs, nav.tabs');
    if (tabsNav) {

    const onOtherTabClick = (ev) => {
      // CRITICAL: Ignore clicks on dice roll cards or any elements inside them
      // This prevents interference with CoC7's dice roll expansion
      const isInDiceRoll = ev.target?.closest?.(
        '.chat-card, .roll-card, .card-buttons, .dice-roll, .dice-result, .dice-formula, .roll-result, .dice-tooltip'
      );
      if (isInDiceRoll) {
        return; // Don't interfere with dice roll interactions
      }

      // Also check if the click is inside the chat content area (not on tab buttons)
      // This ensures we only handle clicks on actual tab navigation buttons
      const isInChatContent = ev.target?.closest?.(
        '#chat, .chat-sidebar, .chat-log, .chat-message, .message-content'
      );
      if (isInChatContent) {
        // Only proceed if we're clicking on a tab button, not on chat content
        const isTabButton = ev.target?.closest?.('button[data-action="tab"]');
        if (!isTabButton) {
          return;
        }
      }

      // Only handle clicks on tab buttons - check if it's a tab button that's NOT archivist-chat
      const other = ev.target.closest?.('button[data-action="tab"][data-tab]');
      if (!other) {
        return;
      }

      const tabId = other.dataset?.tab;
      if (tabId === 'archivist-chat') {
        return; // our renderer handles the archivist tab
      }

      setTimeout(() => {
        try {
          const sidebar = document.getElementById('sidebar');
          const contentWrap =
            sidebar?.querySelector?.(
              '#sidebar-content, section.content, .content'
            ) || sidebar?.querySelector('section.tab, .tab')?.parentElement;
          if (contentWrap) {
            // Remove inline display overrides so core can manage visibility
            contentWrap.querySelectorAll('.tab').forEach((el) => {
              el.style.display = '';
            });
            const panel = contentWrap.querySelector('#archivist-chat.tab');
            if (panel) panel.classList.remove('active');
          }
          const myBtn = tabsNav?.querySelector?.(
            '[data-action="tab"][data-tab="archivist-chat"]'
          );
          if (myBtn) {
            myBtn.classList?.remove?.('active');
            myBtn.setAttribute('aria-pressed', 'false');
            myBtn.setAttribute('aria-selected', 'false');
          }
        } catch (e) {
          console.warn('[Archivist Sync] Failed clearing overrides', e);
        }
      }, 0);
    };
    tabsNav.addEventListener('click', onOtherTabClick);

    } // end if (tabsNav found for delegated cleanup)
  } catch (e) {
    console.error('[Archivist Sync] Failed to install delegated cleanup', e);
  }

  // Do not force-switch tabs; allow user/system to control active tab

  // Build initial link index from local world flags
  try {
    linkIndexer.buildFromWorld();
  } catch (e) {
    console.warn('[Archivist Sync] Link index build failed', e);
  }

  // Install Real-Time Sync listeners (CRUD) if enabled and world is selected
  try {
    if (
      settingsManager.isWorldSelected() &&
      settingsManager.isRealtimeSyncEnabled?.()
    ) {
      installRealtimeSyncListeners();
      console.log('[Archivist Sync] Real-Time Sync listeners installed');
    } else {
      console.log(
        '[Archivist Sync] Real-Time Sync disabled or no world selected'
      );
    }
  } catch (e) {
    console.warn(
      '[Archivist Sync] Failed to install Real-Time Sync listeners',
      e
    );
  }

  // Inject a Journal Directory header button to open Sync Dialog
  Hooks.on('renderJournalDirectory', (app, html) => {
    try {
      // Only show sync button if world is initialized and GM
      const isWorldInitialized = settingsManager.isWorldInitialized?.();
      if (!isWorldInitialized) return;
      if (!game.user?.isGM) return;

      // V13 ApplicationV2: app.element is the root, fallback to html for compatibility
      const root = app?.element || (html instanceof jQuery ? html[0] : html?.element || html);
      if (!root) return;
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        const header =
          root.querySelector('header.directory-header') ||
          root.querySelector('header.header') ||
          root.querySelector('header') ||
          root.querySelector('.directory-header') ||
          root.querySelector('.header');
        if (!header) return;
        if (header.querySelector?.('.archivist-sync-btn')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'archivist-sync-btn';
        btn.textContent = 'Sync with Archivist';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          try {
            new SyncDialog().render(true);
          } catch (_) {}
        });
        header.appendChild(btn);
      });
    } catch (e) {
      console.warn('[Archivist Sync] Failed to inject sync button', e);
    }
  });

  // Inject quick-create buttons for Archivist sheets in the Journal Directory header
  Hooks.on('renderJournalDirectory', (app, html) => {
    try {
      // Only show create buttons if world is initialized
      const isWorldInitialized = settingsManager.isWorldInitialized?.();
      if (!isWorldInitialized) return;
      if (!game.user?.isGM) return;
      
      // V13 ApplicationV2: app.element is the root, fallback to html for compatibility
      const root = app?.element || (html instanceof jQuery ? html[0] : html?.element || html);
      if (!root) return;
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        const header =
          root.querySelector('header.directory-header') ||
          root.querySelector('header.header') ||
          root.querySelector('header') ||
          root.querySelector('.directory-header') ||
          root.querySelector('.header');
        if (!header) return;
        if (header.querySelector('.archivist-create-buttons')) return;

        const wrap = document.createElement('div');
        wrap.className = 'archivist-create-buttons';
        wrap.style.display = 'flex';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '6px';
        wrap.style.marginTop = '6px';

        const types = [
          { key: 'pc', label: 'PC', icon: 'fa-user', tooltip: 'Create New PC' },
          {
            key: 'npc',
            label: 'NPC',
            icon: 'fa-user-ninja',
            tooltip: 'Create New NPC',
          },
          {
            key: 'item',
            label: 'Item',
            icon: 'fa-gem',
            tooltip: 'Create New Item',
          },
          {
            key: 'location',
            label: 'Location',
            icon: 'fa-location-dot',
            tooltip: 'Create New Location',
          },
          {
            key: 'faction',
            label: 'Faction',
            icon: 'fa-people-group',
            tooltip: 'Create New Faction',
          },
        ];

        const promptForName = async (title) => {
          try {
            const name = await foundry.applications.api.DialogV2.prompt({
              window: { title },
              content: `
                <div class="form-group">
                  <label>Name:</label>
                  <input type="text" name="name" placeholder="Enter name..." autofocus style="width: 100%;" />
                </div>
              `,
              ok: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Create',
                callback: (event, button) => {
                  const enteredName = button.form.elements.name.value.trim();
                  return enteredName || null;
                },
              },
              cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
              rejectClose: true,
            });
            return name;
          } catch (_) {
            return null;
          }
        };

        const makeBtn = (t) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'archivist-create-btn';
          b.innerHTML = `<i class="fas ${t.icon}"></i>`;
          b.title = t.tooltip;
          b.dataset.type = t.key;
          b.addEventListener('click', async (ev) => {
            ev.preventDefault();
            try {
              const worldId = settingsManager.getSelectedWorldId?.();
              const name = await promptForName(`Create ${t.label}`);
              if (!name) return;

              let journal = null;
              if (t.key === 'pc')
                journal = await Utils.createPcJournal({ name, worldId });
              else if (t.key === 'npc')
                journal = await Utils.createNpcJournal({ name, worldId });
              else if (t.key === 'item')
                journal = await Utils.createItemJournal({ name, worldId });
              else if (t.key === 'location')
                journal = await Utils.createLocationJournal({ name, worldId });
              else if (t.key === 'faction')
                journal = await Utils.createFactionJournal({ name, worldId });

              // Open the newly created sheet and bring it to front
              if (journal) {
                journal.sheet?.render?.(true);
                setTimeout(() => journal.sheet?.bringToFront?.(), 50);
              }
            } catch (e) {
              console.warn('[Archivist Sync] create button failed', e);
            }
          });
          return b;
        };

        for (const t of types) wrap.appendChild(makeBtn(t));
        header.appendChild(wrap);
      });
    } catch (e) {
      console.warn('[Archivist Sync] Failed to inject create buttons', e);
    }
  });

  // Add Archivist type selector to Create Journal dialog (optional)
  Hooks.on('renderDialogV2', (dialog, html, data) => {
    try {
      if (dialog.title !== 'Create Journal Entry') return;
      const form = html.querySelector('form');
      if (
        !form ||
        form.querySelector('[name="flags.archivist-sync.archivist.sheetType"]')
      )
        return;
      const sel = document.createElement('div');
      sel.className = 'form-group';
      sel.innerHTML = `
        <label>Archivist Type</label>
        <div class="form-fields">
          <select name="flags.archivist-sync.archivist.sheetType">
            <option value="">Standard</option>
            <optgroup label="Archivist">
              <option value="pc">PC</option>
              <option value="npc">NPC</option>
              <option value="item">Item</option>
              <option value="location">Location</option>
              <option value="faction">Faction</option>
            </optgroup>
          </select>
        </div>`;
      const nameInput = form.querySelector('input[name="name"]');
      if (nameInput)
        nameInput
          .closest('.form-group')
          ?.insertAdjacentElement('afterend', sel);
    } catch (_) {}
  });

  // Auto-place new Archivist journals into organized folders and seed a text page
  Hooks.on('createJournalEntry', async (entry, options, userId) => {
    try {
      if (game.user.id !== userId) return;
      const flags = entry.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      const type = String(flags.sheetType || '').toLowerCase();
      if (!type) return;
      // Move to organized folder when enabled
      try {
        await Utils.moveJournalToTypeFolder(entry);
      } catch (_) {}
      // Ensure it has a text page seeded with a header
      const pages = entry.pages?.contents || [];
      if (!pages.some((p) => p.type === 'text')) {
        await entry.createEmbeddedDocuments('JournalEntryPage', [
          {
            name: 'Overview',
            type: 'text',
            text: {
              content: `<h1>${foundry.utils.escapeHTML(entry.name)}</h1>`,
              markdown: `# ${entry.name}`,
              format: 2,
            },
          },
        ]);
      }
    } catch (e) {
      console.warn('[Archivist Sync] createJournalEntry post-hook failed', e);
    }
  });

  // No auto-switch; DocumentSheet registrations handle sheet selection

  // Keep LinkIndexer current when archivist flags change
  Hooks.on('updateJournalEntry', (doc, changes) => {
    try {
      if (changes?.flags?.[CONFIG.MODULE_ID]?.archivist) {
        try {
          linkIndexer.buildFromWorld();
        } catch (_) {}
      }
    } catch (_) {}
  });
  Hooks.on('updateJournalEntryPage', (page, changes) => {
    try {
      if (changes?.flags?.[CONFIG.MODULE_ID]?.archivist) {
        try {
          linkIndexer.buildFromWorld();
        } catch (_) {}
      }
    } catch (_) {}
  });

  // Canvas drop: place Actor tokens when a UUID or linked Actor is dropped
  Hooks.on('dropCanvasData', async (canvasApp, data) => {
    try {
      const uuid = data?.uuid || data?.data?.uuid;
      if (!uuid) return false;
      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc) return false;

      if (doc.documentName === 'Actor') {
        // Allow Foundry's default actor drop handling to proceed untouched
        return false;
      }

      let actor = null;
      if (doc.documentName === 'JournalEntry') {
        const flags = doc.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
        const actorIds = Array.isArray(flags?.foundryRefs?.actors)
          ? flags.foundryRefs.actors
          : [];
        if (actorIds.length) actor = game.actors.get(actorIds[0]) || null;
      }
      if (!actor) return false;

      if (!canvas?.ready) {
        ui.notifications?.warn?.('Open a Scene first.');
        return false;
      }
      const x = Number.isFinite(data?.x)
        ? data.x
        : canvas.app.renderer.width / 2;
      const y = Number.isFinite(data?.y)
        ? data.y
        : canvas.app.renderer.height / 2;
      const pt = canvas.stage.worldTransform.applyInverse({ x, y });
      const tokenData = await actor.getTokenDocument({ x: pt.x, y: pt.y });
      await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
      return true;
    } catch (e) {
      console.warn('[Archivist Sync] dropCanvasData handler failed', e);
      return false;
    }
  });

  // Remove AppV2 sheet intercepts in favor of registered DocumentSheet V2

  // Scene controls no longer modified by this module

  // Auto-open World Setup wizard for GMs when not initialized
  try {
    if (game.user?.isGM && !settingsManager.isWorldInitialized()) {
      (window.__ARCHIVIST_SETUP__ ||= new WorldSetupDialog()).render(true);
    }
  } catch (_) {}

  // No Hub restoration on canvasReady; feature removed
});

/**
 * Update Archivist chat availability based on current settings
 * Shows or hides the sidebar tab and updates UI accordingly
 */
function updateArchivistChatAvailability() {
  const isAvailable = settingsManager.isArchivistChatAvailable();

  if (isAvailable) {
    // Ensure visibility of the nav button and panel if already rendered
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const tabsNav = sidebar.querySelector('#sidebar-tabs, nav.tabs');
      const tabButton = sidebar.querySelector('[data-tab="archivist-chat"]');
      let tabPanel = sidebar.querySelector('#archivist-chat.tab');
      if (tabButton) {
        tabButton.style.display = '';
        const label =
          game.i18n?.localize?.('ARCHIVIST_SYNC.Menu.AskChat.Label') ||
          'Archivist Chat';
        tabButton.setAttribute('title', label);
        tabButton.setAttribute('data-tooltip', label);
        tabButton.setAttribute('data-tooltip-direction', 'LEFT');
      }
      if (tabPanel) tabPanel.style.display = '';

      // Ensure a content panel exists (template slot or create one)
      try {
        ensureChatSlot();
      } catch (_) {}
      if (!tabPanel) {
        const contentWrap =
          sidebar.querySelector(
            '#sidebar-content, section.content, .content'
          ) || sidebar.querySelector('section.tab, .tab')?.parentElement;
        if (contentWrap && !contentWrap.querySelector('#archivist-chat.tab')) {
          const panel = document.createElement('section');
          panel.id = 'archivist-chat';
          panel.className = 'tab sidebar-tab';
          panel.dataset.tab = 'archivist-chat';
          panel.style.height = '100%';
          panel.style.overflow = 'hidden auto';
          contentWrap.appendChild(panel);
          tabPanel = panel;
        }
      }

      // Fallback: if the core Sidebar did not render the nav button, inject a compatible button
      if (!tabButton && tabsNav) {
        try {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ui-control plain icon';
          btn.setAttribute('data-action', 'tab');
          btn.setAttribute('role', 'tab');
          btn.setAttribute('aria-controls', 'archivist-chat');
          btn.setAttribute(
            'data-group',
            tabsNav.getAttribute('data-group') || 'primary'
          );
          btn.dataset.tab = 'archivist-chat';
          btn.setAttribute(
            'aria-label',
            game.i18n?.localize?.('ARCHIVIST_SYNC.Menu.AskChat.Label') ||
              'Archivist Chat'
          );
          btn.setAttribute(
            'data-tooltip',
            game.i18n?.localize?.('ARCHIVIST_SYNC.Menu.AskChat.Label') ||
              'Archivist Chat'
          );
          btn.setAttribute('data-tooltip-direction', 'RIGHT');
          const i = document.createElement('i');
          i.className = 'fa-solid fa-sparkles';
          btn.appendChild(i);
          btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const isActive = ui.sidebar?.activeTab === 'archivist-chat';
            const isExpanded = ui.sidebar?._expanded;
            if (isActive && isExpanded) {
              try {
                ui.sidebar?.collapse?.();
              } catch (_) {}
            } else {
              try {
                ui.sidebar?.expand?.();
              } catch (_) {}
              try {
                ui.sidebar?.changeTab?.('archivist-chat');
              } catch (_) {}
              // Ensure panel exists and render the chat UI as a fallback
              const sb = document.getElementById('sidebar');
              let panel = sb?.querySelector?.('#archivist-chat.tab');
              if (!panel) {
                const contentWrap =
                  sb?.querySelector(
                    '#sidebar-content, section.content, .content'
                  ) || sb?.querySelector('section.tab, .tab')?.parentElement;
                if (contentWrap) {
                  panel = document.createElement('section');
                  panel.id = 'archivist-chat';
                  panel.className = 'tab sidebar-tab active';
                  panel.dataset.tab = 'archivist-chat';
                  panel.style.height = '100%';
                  panel.style.overflow = 'hidden auto';
                  contentWrap.appendChild(panel);
                }
              }
              if (panel) {
                try {
                  if (!window.__ARCHIVIST_SIDEBAR_CHAT__) {
                    window.__ARCHIVIST_SIDEBAR_CHAT__ = new AskChatWindow({
                      popOut: false,
                    });
                  }
                  window.__ARCHIVIST_SIDEBAR_CHAT__._mountEl = panel;
                  await window.__ARCHIVIST_SIDEBAR_CHAT__.render(false);
                } catch (e) {
                  console.warn(
                    '[Archivist Sync] Fallback chat render failed',
                    e
                  );
                }
              }
            }
          });
          li.appendChild(btn);
          const menu = tabsNav.querySelector('menu.flexcol') || tabsNav;
          const beforeNode = menu.lastElementChild;
          if (beforeNode) {
            menu.insertBefore(li, beforeNode);
          } else {
            menu.appendChild(li);
          }
        } catch (e) {
          console.warn(
            '[Archivist Sync] Failed to inject fallback Sidebar tab button',
            e
          );
        }
      }
    }
    // DON'T re-render sidebar - this causes CoC7's click handlers to fire twice!
    // Instead, we've manually updated the DOM above which is sufficient
    // The sidebar will naturally update on its next render cycle
  } else {
    // Hide/remove sidebar tab if conditions are not met
    try {
      // Hide existing tab button and panel if they exist
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        const tabButton = sidebar.querySelector('[data-tab="archivist-chat"]');
        const tabPanel = sidebar.querySelector('#archivist-chat.tab');
        if (tabButton) tabButton.style.display = 'none';
        if (tabPanel) {
          tabPanel.style.display = 'none';
          tabPanel.classList.remove('active');
        }
      }
      // DON'T re-render sidebar - this causes CoC7's click handlers to fire twice!
      // Instead, we've manually hidden the tab above which is sufficient
      // The sidebar will naturally update on its next render cycle
    } catch (e) {
      console.warn('[Archivist Sync] Failed to hide chat tab:', e);
    }
  }

  // Update scene controls (they will be re-evaluated on next render)
  try {
    ui.controls?.render?.(true);
  } catch (_) {}

  Utils.log(`Archivist chat availability updated: ${isAvailable}`);
}

/**
 * Initialize global debugging interface
 * Makes key components available in the console for debugging
 */
function initializeDebugInterface() {
  window.ARCHIVIST_SYNC = {
    CONFIG,
    settingsManager,
    archivistApi,
    updateChatAvailability: updateArchivistChatAvailability,
    installRealtimeSyncListeners,
    Utils,
    AskChatWindow,
    async projection() {
      const { SlotResolver } = await import(
        './modules/projection/slot-resolver.js'
      );
      return SlotResolver;
    },
  };

  Utils.log(
    'Debug interface initialized. Use window.ARCHIVIST_SYNC to access module components.'
  );
}

// Export main components for potential use by other modules
export { CONFIG, settingsManager, archivistApi, Utils };

/**
 * Real-Time Sync: listen to Foundry CRUD and POST/PATCH/DELETE to Archivist
 * Only runs for GMs and when a world is selected & setting enabled.
 */
function installRealtimeSyncListeners() {
  const isGM = game.user?.isGM;
  if (!isGM) return; // Only the GM client should perform API writes

  const apiKey = settingsManager.getApiKey();
  const worldId = settingsManager.getSelectedWorldId();
  if (!apiKey || !worldId) return;

  const toItemPayload = (item) => {
    const name = item?.name || 'Item';
    const rawImg = String(item?.img || '').trim();
    const image = rawImg.startsWith('https://') ? rawImg : undefined;
    const desc = String(
      item?.system?.description?.value || item?.system?.description || ''
    );
    return {
      name,
      description: Utils.toMarkdownIfHtml?.(desc) || desc,
      ...(image ? { image } : {}),
      campaign_id: worldId,
    };
  };

  const toCharacterPayload = (actor) =>
    Utils.toApiCharacterPayload(actor, worldId);
  const toFactionPayload = (page) => {
    const name = page?.name || 'Faction';
    const html = Utils.extractPageHtml(page);
    // Strip leading image since it's stored separately in the image property
    const cleaned = Utils.stripLeadingImage?.(html) ?? html;
    const rawImg = String(page?.parent?.img || '').trim();
    const image = rawImg.startsWith('https://') ? rawImg : undefined;
    return {
      name,
      description: Utils.toMarkdownIfHtml?.(cleaned) || cleaned,
      ...(image ? { image } : {}),
      campaign_id: worldId,
    };
  };
  const toLocationPayload = (page) => {
    const name = page?.name || 'Location';
    const html = Utils.extractPageHtml(page);
    // Strip leading image since it's stored separately in the image property
    const cleaned = Utils.stripLeadingImage?.(html) ?? html;
    const rawImg = String(page?.parent?.img || '').trim();
    const image = rawImg.startsWith('https://') ? rawImg : undefined;
    return {
      name,
      description: Utils.toMarkdownIfHtml?.(cleaned) || cleaned,
      ...(image ? { image } : {}),
      campaign_id: worldId,
    };
  };

  // Helpers to scope realtime side-effects to Archivist-managed documents
  const getPageMeta = (page) => Utils.getPageArchivistMeta(page) || {};
  const getPageMetaType = (page) =>
    String(getPageMeta(page)?.type || '').toLowerCase();

  // Create
  Hooks.on('createActor', async (doc) => {
    try {
      // Always-on realtime rules; respect suppression during bulk ops
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      // Do not auto-create Archivist Characters from Foundry actor creations
      return;
    } catch (e) {
      console.warn('[RTS] createActor failed', e);
    }
  });

  // JournalEntry create - create Archivist entities when a custom page-based sheet is created
  Hooks.on('createJournalEntry', async (entry, options, userId) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      if (game.user.id !== userId) return;

      // Determine sheet type from flags set at creation time
      const flags = entry.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      const sheetType = String(flags.sheetType || '').toLowerCase();
      if (!sheetType) return;

      // Skip if already linked
      if (flags.archivistId) return;

      const apiKey = settingsManager.getApiKey();
      const worldId = settingsManager.getSelectedWorldId();
      if (!apiKey || !worldId) return;

      // Gather description from first text page
      const pages = entry.pages?.contents || [];
      const textPage = pages.find((p) => p.type === 'text') || pages[0];
      const html = textPage?.text?.content || '';
      const description = Utils.toMarkdownIfHtml?.(html) || html || '';

      let res = { success: false, data: null };
      if (
        sheetType === 'pc' ||
        sheetType === 'npc' ||
        sheetType === 'character'
      ) {
        const payload = {
          character_name: entry.name || 'Character',
          description,
          type: sheetType === 'npc' ? 'NPC' : 'PC',
          campaign_id: worldId,
        };
        res = await archivistApi.createCharacter(apiKey, payload);
      } else if (sheetType === 'item') {
        res = await archivistApi.createItem(apiKey, {
          name: entry.name || 'Item',
          description,
          campaign_id: worldId,
        });
      } else if (sheetType === 'location') {
        const rawImg = String(entry?.img || '').trim();
        const image = rawImg.startsWith('https://') ? rawImg : undefined;
        res = await archivistApi.createLocation(apiKey, {
          name: entry.name || 'Location',
          description,
          ...(image ? { image } : {}),
          campaign_id: worldId,
        });
      } else if (sheetType === 'faction') {
        const rawImg = String(entry?.img || '').trim();
        const image = rawImg.startsWith('https://') ? rawImg : undefined;
        res = await archivistApi.createFaction(apiKey, {
          name: entry.name || 'Faction',
          description,
          ...(image ? { image } : {}),
          campaign_id: worldId,
        });
      } else if (sheetType === 'quest') {
        res = await archivistApi.createQuest(apiKey, {
          worldId,
          questName: entry.name || 'Quest',
        });
      } else if (sheetType === 'journal') {
        res = await archivistApi.createJournal(apiKey, {
          world_id: worldId,
          title: entry.name || 'Journal',
          content: description,
        });
      }

      if (res.success && res.data?.id) {
        await entry.setFlag(CONFIG.MODULE_ID, 'archivist', {
          sheetType,
          archivistId: res.data.id,
          archivistWorldId: worldId,
          archivistRefs: {
            characters: [],
            items: [],
            entries: [],
            factions: [],
            locationsAssociative: [],
          },
          foundryRefs: { actors: [], items: [], scenes: [], journals: [] },
        });
      }
    } catch (e) {
      console.warn('[RTS] createJournalEntry (flags) failed', e);
    }
  });

  // Update
  Hooks.on('updateActor', async (doc, changes) => {
    try {
      // Always-on realtime rules; respect suppression during bulk ops
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      // Do not PATCH Archivist Characters from Foundry actor updates
      return;
    } catch (e) {
      console.warn('[RTS] updateActor failed', e);
    }
  });
  Hooks.on('updateItem', async (doc, changes) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      const id = doc.getFlag(CONFIG.MODULE_ID, 'archivistId');
      if (!id) return;
      const res = await archivistApi.updateItem(apiKey, id, toItemPayload(doc));
      if (!res?.success) {
        if (res.isDescriptionTooLong) {
          ui.notifications?.error?.(
            `Failed to sync ${res.entityName || doc?.name}: Description exceeds the maximum length of 10,000 characters. Please shorten the description and try again.`,
            { permanent: true }
          );
        } else {
          console.warn('[RTS] updateItem failed');
        }
      }
    } catch (e) {
      console.warn('[RTS] updateItem failed', e);
    }
  });
  Hooks.on('updateJournalEntryPage', async (page, changes) => {
    try {
      // Always-on realtime rules; respect suppression during bulk ops
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      // Op marker: ignore our projection-originated write operations
      try {
        const mod = changes?.flags?.[CONFIG.MODULE_ID];
        if (mod && Object.prototype.hasOwnProperty.call(mod, 'op')) return;
      } catch (_) {}
      const meta = getPageMeta(page);
      const metaType = getPageMetaType(page);
      let res;
      if (meta?.id && metaType === 'faction') {
        res = await archivistApi.updateFaction(
          apiKey,
          meta.id,
          toFactionPayload(page)
        );
        if (!res?.success && res?.isDescriptionTooLong) {
          ui.notifications?.error?.(
            `Failed to sync ${res.entityName || page?.name}: Description exceeds the maximum length of 10,000 characters. Please shorten the description and try again.`,
            { permanent: true }
          );
        }
        return;
      }
      if (meta?.id && metaType === 'location') {
        res = await archivistApi.updateLocation(
          apiKey,
          meta.id,
          toLocationPayload(page)
        );
        if (!res?.success && res?.isDescriptionTooLong) {
          ui.notifications?.error?.(
            `Failed to sync ${res.entityName || page?.name}: Description exceeds the maximum length of 10,000 characters. Please shorten the description and try again.`,
            { permanent: true }
          );
        }
        return;
      }
      if (meta?.id && metaType === 'recap') {
        const title = page.name;
        const html = Utils.extractPageHtml(page);
        await archivistApi.updateSession(apiKey, meta.id, {
          title,
          summary: Utils.toMarkdownIfHtml?.(html) || html,
        });
        return;
      }

      const parent = page?.parent;
      const flags = parent?.getFlag?.(CONFIG.MODULE_ID, 'archivist') || {};
      const sheetType = String(flags?.sheetType || '').toLowerCase();
      if (!sheetType || !flags.archivistId) return;

      const html = Utils.extractPageHtml(page);
      const payload = { description: Utils.toMarkdownIfHtml?.(html) || html };

      if (
        sheetType === 'pc' ||
        sheetType === 'npc' ||
        sheetType === 'character'
      ) {
        res = await archivistApi.updateCharacter(
          apiKey,
          flags.archivistId,
          payload
        );
      } else if (sheetType === 'item') {
        res = await archivistApi.updateItem(apiKey, flags.archivistId, payload);
      } else if (sheetType === 'location') {
        res = await archivistApi.updateLocation(
          apiKey,
          flags.archivistId,
          payload
        );
      } else if (sheetType === 'faction') {
        res = await archivistApi.updateFaction(
          apiKey,
          flags.archivistId,
          payload
        );
      } else if (sheetType === 'recap') {
        await archivistApi.updateSession(apiKey, flags.archivistId, {
          title: parent?.name || page.name,
          summary: payload.description,
        });
        return;
      } else if (sheetType === 'quest') {
        // Quest page content is not a synced API field (quests use structured
        // fields like successDefinition, not a free description), and name
        // changes are handled by the updateJournalEntry title-sync hook. So a
        // page-content edit has nothing to push — skip the redundant PATCH.
        return;
      } else if (sheetType === 'journal') {
        res = await archivistApi.updateJournal(apiKey, {
          id: flags.archivistId,
          title: parent?.name || page.name,
          content: Utils.toMarkdownIfHtml?.(html) || html,
        });
        return;
      }

      if (res && !res?.success && res?.isDescriptionTooLong) {
        ui.notifications?.error?.(
          `Failed to sync ${res.entityName || parent?.name}: Description exceeds the maximum length of 10,000 characters. Please shorten the description and try again.`,
          { permanent: true }
        );
      }
    } catch (e) {
      console.warn('[RTS] updateJournalEntryPage failed', e);
    }
  });

  // When a sheet's title changes, PATCH the corresponding Archivist entity name/title
  Hooks.on('updateJournalEntry', async (entry, diff) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      // Op marker: ignore projection-originated writes
      try {
        const mod = diff?.flags?.[CONFIG.MODULE_ID];
        if (mod && Object.prototype.hasOwnProperty.call(mod, 'op')) return;
      } catch (_) {}
      const flags = entry.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      const id = flags?.archivistId;
      const st = String(flags?.sheetType || '');
      if (!id || !diff?.name) return;
      const name = String(diff.name);
      const isCharacter = st === 'pc' || st === 'npc' || st === 'character';
      if (isCharacter) {
        await archivistApi.updateCharacter(apiKey, id, {
          character_name: name,
        });
      } else if (st === 'item') {
        await archivistApi.updateItem(apiKey, id, { name });
      } else if (st === 'location') {
        await archivistApi.updateLocation(apiKey, id, { name });
      } else if (st === 'faction') {
        await archivistApi.updateFaction(apiKey, id, { name });
      } else if (st === 'quest') {
        await archivistApi.updateQuest(apiKey, id, { questName: name });
      } else if (st === 'journal') {
        await archivistApi.updateJournal(apiKey, { id, title: name });
      }
    } catch (e) {
      console.warn('[RTS] updateJournalEntry (title sync) failed', e);
    }
  });

  // Delete (preDelete to capture flags before doc vanishes)
  Hooks.on('preDeleteActor', async (doc) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      const id = doc.getFlag(CONFIG.MODULE_ID, 'archivistId');
      if (!id) return;
      // No deleteCharacter API currently; we skip or could introduce one in API later
    } catch (e) {
      console.warn('[RTS] preDeleteActor failed', e);
    }
  });
  Hooks.on('preDeleteItem', async (doc) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      const id = doc.getFlag(CONFIG.MODULE_ID, 'archivistId');
      if (!id) return;
      if (archivistApi.deleteItem) await archivistApi.deleteItem(apiKey, id);
    } catch (e) {
      console.warn('[RTS] preDeleteItem failed', e);
    }
  });
  Hooks.on('preDeleteJournalEntryPage', async (page) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      const meta = getPageMeta(page);
      const metaType = getPageMetaType(page);
      if (!meta?.id) return;
      if (metaType === 'recap') return; // Recaps still managed elsewhere
      if (metaType === 'faction' && archivistApi.deleteFaction) {
        await archivistApi.deleteFaction(apiKey, meta.id);
      } else if (metaType === 'location' && archivistApi.deleteLocation) {
        await archivistApi.deleteLocation(apiKey, meta.id);
      }
    } catch (e) {
      console.warn('[RTS] preDeleteJournalEntryPage failed', e);
    }
  });

  // Delete custom sheets when the JournalEntry itself is deleted.
  // Defer the Archivist-side decision until every preDelete in this turn has
  // registered. A bulk delete of duplicate sheets otherwise sees each sibling
  // still in game.journal and skips the remote delete for all of them.
  const pendingSheetDeletes = new Map();
  let flushChain = Promise.resolve();

  const flushArchivistSheetDelete = async (archivistId, bucket) => {
    const survivors = (game.journal?.contents || []).filter((j) => {
      if (bucket.ids.has(String(j.id))) return false;
      return Utils.journalReferencesArchivistId(j, archivistId);
    });
    // World Setup can give a linked Actor, Item, or Scene the same
    // archivistId as this journal sheet. That core document isn't in
    // game.journal, so it wouldn't show up as a survivor above — check it
    // separately before treating this as the last Foundry sheet.
    const hasLinkedCoreDocument =
      Utils.coreDocumentReferencesArchivistId(archivistId);
    if (survivors.length || hasLinkedCoreDocument) {
      console.log(
        '[RTS] Skipping Archivist delete: other sheets still reference this record',
        { archivistId, remaining: survivors.length, hasLinkedCoreDocument }
      );
      ui.notifications?.info?.(
        survivors.length
          ? `Removed the duplicate sheet. "${bucket.name}" is still in Archivist — ${survivors.length} other sheet${survivors.length > 1 ? 's' : ''} still reference${survivors.length > 1 ? '' : 's'} it.`
          : `Removed the duplicate sheet. "${bucket.name}" is still in Archivist — a linked Actor, Item, or Scene still references it.`
      );
      return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Delete from Archivist?' },
      content:
        `<p>This is the only Foundry sheet for <strong>${foundry.utils.escapeHTML(bucket.name || 'this record')}</strong>.</p>` +
        `<p>Deleting it here also <strong>permanently deletes it from Archivist</strong> for everyone in the campaign. This cannot be undone.</p>` +
        `<p>Delete from Archivist too, or keep the Archivist record and only remove the Foundry sheet?</p>`,
      yes: { label: 'Delete from Archivist', icon: 'fa-solid fa-trash' },
      no: { label: 'Keep in Archivist', icon: 'fa-solid fa-cloud' },
      defaultYes: false,
      rejectClose: false,
    });
    if (!confirmed) {
      console.log('[RTS] GM kept the Archivist record; only the Foundry sheet is removed', {
        archivistId,
      });
      return;
    }

    const st = bucket.sheetType;
    if (
      (st === 'pc' || st === 'npc' || st === 'character') &&
      archivistApi.deleteCharacter
    ) {
      await archivistApi.deleteCharacter(apiKey, archivistId);
    } else if (st === 'item' && archivistApi.deleteItem) {
      await archivistApi.deleteItem(apiKey, archivistId);
    } else if (st === 'location' && archivistApi.deleteLocation) {
      await archivistApi.deleteLocation(apiKey, archivistId);
    } else if (st === 'faction' && archivistApi.deleteFaction) {
      await archivistApi.deleteFaction(apiKey, archivistId);
    } else if (st === 'quest') {
      await archivistApi.deleteQuest(apiKey, archivistId);
    } else if (st === 'journal') {
      await archivistApi.deleteJournal(apiKey, archivistId);
    }
  };

  Hooks.on('preDeleteJournalEntry', (entry) => {
    try {
      if (
        !settingsManager.isRealtimeSyncEnabled?.() ||
        settingsManager.isRealtimeSyncSuppressed?.()
      )
        return;
      const flags = entry.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      const id = flags?.archivistId;
      const st = String(flags?.sheetType || '').toLowerCase();
      if (!id) return;
      if (st === 'recap') return; // Never create/delete recaps

      let bucket = pendingSheetDeletes.get(id);
      if (!bucket) {
        bucket = {
          ids: new Set(),
          sheetType: st,
          name: entry.name || 'this record',
        };
        pendingSheetDeletes.set(id, bucket);
        queueMicrotask(() => {
          pendingSheetDeletes.delete(id);
          // Distinct records each get their own bucket; run their confirms
          // one after another so a multi-select delete does not open a
          // stack of destructive DialogV2 windows at once.
          flushChain = flushChain
            .catch(() => {})
            .then(() => flushArchivistSheetDelete(id, bucket))
            .catch((e) => console.warn('[RTS] preDeleteJournalEntry failed', e));
        });
      }
      bucket.ids.add(String(entry.id));
      if (entry.name) bucket.name = entry.name;
    } catch (e) {
      console.warn('[RTS] preDeleteJournalEntry failed', e);
    }
  });
}

// Header controls (v13): add quick-create buttons to Journal Directory
Hooks.on('getJournalDirectoryHeaderButtons', (app, buttons) => {
  try {
    // Only show create buttons if world is initialized
    const isWorldInitialized = settingsManager.isWorldInitialized?.();
    if (!isWorldInitialized) return;
    if (!game.user?.isGM) return;

    const promptForName = async (title) => {
      try {
        const name = await foundry.applications.api.DialogV2.prompt({
          window: { title },
          content: `
            <div class="form-group">
              <label>Name:</label>
              <input type="text" name="name" placeholder="Enter name..." autofocus style="width: 100%;" />
            </div>
          `,
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Create',
            callback: (event, button) => {
              const enteredName = button.form.elements.name.value.trim();
              return enteredName || null;
            },
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
          rejectClose: true,
        });
        return name;
      } catch (_) {
        return null;
      }
    };

    const make = (key, label, icon) => ({
      class: `archivist-header-create-${key}`,
      label,
      icon,
      onclick: async (ev) => {
        ev?.preventDefault?.();
        try {
          const worldId = settingsManager.getSelectedWorldId?.();
          const name = await promptForName(`Create ${label}`);
          if (!name) return;
          let journal = null;
          if (key === 'pc')
            journal = await Utils.createPcJournal({ name, worldId });
          else if (key === 'npc')
            journal = await Utils.createNpcJournal({ name, worldId });
          else if (key === 'item')
            journal = await Utils.createItemJournal({ name, worldId });
          else if (key === 'location')
            journal = await Utils.createLocationJournal({ name, worldId });
          else if (key === 'faction')
            journal = await Utils.createFactionJournal({ name, worldId });
          // Open the newly created sheet and bring it to front
          if (journal) {
            journal.sheet?.render?.(true);
            setTimeout(() => journal.sheet?.bringToFront?.(), 50);
          }
        } catch (e) {
          console.warn('[Archivist Sync] header create failed', e);
        }
      },
    });

    // Add buttons to the left of default controls (unshift to place first)
    buttons.unshift(make('faction', 'Faction', 'fas fa-people-group'));
    buttons.unshift(make('location', 'Location', 'fas fa-location-dot'));
    buttons.unshift(make('item', 'Item', 'fas fa-gem'));
    buttons.unshift(make('npc', 'NPC', 'fas fa-user-ninja'));
    buttons.unshift(make('pc', 'PC', 'fas fa-user'));
  } catch (e) {
    console.warn('[Archivist Sync] getJournalDirectoryHeaderButtons failed', e);
  }
});

// Inject inline visibility toggle buttons (GM-only) into Journal Directory rows
Hooks.on('renderJournalDirectory', (app, html) => {
  try {
    if (!game.user?.isGM) return;
    if (!settingsManager.isWorldInitialized?.()) return;
    
    // V13 ApplicationV2: app.element is the root, fallback to html for compatibility
    const root = app?.element || (html instanceof jQuery ? html[0] : html?.element || html);
    if (!root) return;
    
    // Retry mechanism: try multiple times with increasing delays to handle async rendering
    const injectEyeButtons = (attempt = 0) => {
      const maxAttempts = 5;
      const delay = attempt * 100; // 0ms, 100ms, 200ms, 300ms, 400ms
      
      requestAnimationFrame(() => {
        setTimeout(() => {
          const list =
            root.querySelector('ol.directory-list') ||
            root.querySelector('.directory-list') ||
            root;
          const items = list.querySelectorAll(
            'li[data-document-id], li.directory-item, li.document, li.journal-entry'
          );
          
          // If no items found and we haven't exhausted retries, try again
          if (items.length === 0 && attempt < maxAttempts) {
            injectEyeButtons(attempt + 1);
            return;
          }
          
          const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
          const NON = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
          items.forEach((li) => {
            try {
              const id =
                li.getAttribute('data-document-id') ||
                li.getAttribute('data-entry-id');
              if (!id) return;
              if (li.querySelector('.archivist-eye')) return;
              const j = game.journal?.get?.(id);
              if (!j) return;
              // Only render for Archivist custom sheets (identified by our flags)
              let isCustom = false;
              try {
                const f = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
                isCustom = !!(f.archivistId || f.sheetType);
              } catch (_) {
                isCustom = false;
              }
              if (!isCustom) return;
              const cur = Number(j?.ownership?.default ?? NON);
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'archivist-eye';
              const icon = document.createElement('i');
              icon.className = cur >= OBS ? 'fas fa-eye' : 'fas fa-eye-slash';
              btn.title = cur >= OBS ? 'Hide from Players' : 'Show to Players';
              btn.appendChild(icon);
              btn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try {
                  const now = Number(j?.ownership?.default ?? NON);
                  const next = now >= OBS ? NON : OBS;
                  await j.update({ ownership: { default: next } });
                  icon.className = next >= OBS ? 'fas fa-eye' : 'fas fa-eye-slash';
                  btn.title = next >= OBS ? 'Hide from Players' : 'Show to Players';
                } catch (_) {}
              });
              // Append to the end of the row
              li.appendChild(btn);
            } catch (_) {}
          });
        }, delay);
      });
    };
    
    injectEyeButtons();
  } catch (e) {
    console.warn('[Archivist Sync] Failed to inject eye buttons', e);
  }
});
