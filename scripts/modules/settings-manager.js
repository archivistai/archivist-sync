import { CONFIG, SETTINGS, MENU_CONFIG } from './config.js';
import { Utils } from './utils.js';

/**
 * Settings Manager for Archivist Sync Module
 * Handles registration and management of all module settings
 */
export class SettingsManager {
  constructor() {
    this.moduleId = CONFIG.MODULE_ID;
    this.moduleTitle = CONFIG.MODULE_TITLE;
    // Counter-based suppression for realtime sync (supports nesting)
    this._realtimeSuppressed = 0;
  }

  /**
   * Register all module settings
   */
  registerSettings() {
    if (this._settingsRegistered) return;
    this._registerApiKey();
    this._registerSelectedWorldId();
    this._registerSelectedWorldName();
    this._registerWorldInitialized();
    this._registerJournalDestinations();
    // Auto-sort removed; sorting is always enabled
    this._registerHideByOwnership();
    this._registerRealtimeSync();
    this._registerChatHistory();
    this._registerChatVisibility();
    this._registerChatGmPermissions();
    this._registerUpdateApiKeyMenu();
    this._registerRunSetupAgainMenu();
    this._registerDocumentationMenu();
    this._registerProjectionSettings();
    this._settingsRegistered = true;
  }

  /**
   * Register API Key setting
   * @private
   */
  _registerApiKey() {
    const setting = SETTINGS.API_KEY;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
      secret: true,
      onChange: () => {
        console.log(`${this.moduleTitle} | API Key updated`);
        this._onChatAvailabilityChange();
      },
    });

    const clearedSetting = SETTINGS.API_KEY_CLEARED;
    game.settings.register(this.moduleId, clearedSetting.key, {
      scope: clearedSetting.scope,
      config: clearedSetting.config,
      type: clearedSetting.type,
      default: clearedSetting.default,
    });

    const clientSetting = SETTINGS.API_KEY_CLIENT;
    game.settings.register(this.moduleId, clientSetting.key, {
      name: game.i18n.localize(clientSetting.name),
      hint: game.i18n.localize(clientSetting.hint),
      scope: clientSetting.scope,
      config: clientSetting.config,
      type: clientSetting.type,
      default: clientSetting.default,
      onChange: () => {
        this._onChatAvailabilityChange();
      },
    });
  }

  // Semantic mapping setting removed

  /**
   * Register AI provider API keys
   * @private
   */
  // AI provider settings removed

  /**
   * Register default MCP scopes
   * @private
   */
  // MCP scopes setting removed

  // Mapping override setting removed

  // Import configuration setting removed

  /**
   * Register Selected World ID setting
   * @private
   */
  _registerSelectedWorldId() {
    const setting = SETTINGS.SELECTED_WORLD_ID;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
      onChange: (value) => {
        console.log(`${this.moduleTitle} | Selected world ID: ${value}`);
        this._onChatAvailabilityChange();
      },
    });
  }

  /**
   * Register Selected World Name setting
   * @private
   */
  _registerSelectedWorldName() {
    const setting = SETTINGS.SELECTED_WORLD_NAME;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
      onChange: (value) => {
        console.log(`${this.moduleTitle} | Selected world: ${value}`);
        this._onChatAvailabilityChange();
      },
    });
  }

  /**
   * Register Journal Destinations setting
   * @private
   */
  _registerJournalDestinations() {
    const setting = SETTINGS.JOURNAL_DESTINATIONS;
    game.settings.register(this.moduleId, setting.key, {
      name: setting.name,
      hint: setting.hint,
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
      onChange: (value) => {
        console.log(
          `${this.moduleTitle} | Journal destinations updated:`,
          value
        );
      },
    });
  }

  /**
   * Register Update API Key menu
   * @private
   */
  _registerUpdateApiKeyMenu() {
    game.settings.registerMenu(this.moduleId, MENU_CONFIG.UPDATE_API_KEY.key, {
      name: game.i18n.localize(MENU_CONFIG.UPDATE_API_KEY.name),
      label: game.i18n.localize(MENU_CONFIG.UPDATE_API_KEY.label),
      hint: game.i18n.localize(MENU_CONFIG.UPDATE_API_KEY.hint),
      icon: MENU_CONFIG.UPDATE_API_KEY.icon,
      type: class extends foundry.applications.api.ApplicationV2 {
        static DEFAULT_OPTIONS = foundry.utils.mergeObject(
          foundry.utils.deepClone(super.DEFAULT_OPTIONS),
          {
            id: 'archivist-update-api-key',
            window: {
              title: game.i18n.localize(
                'ARCHIVIST_SYNC.Menu.UpdateApiKey.Title'
              ),
            },
          }
        );
        async render(force = false, options = {}) {
          const result = await foundry.applications.api.DialogV2.prompt({
            window: {
              title: game.i18n.localize(
                'ARCHIVIST_SYNC.Menu.UpdateApiKey.Title'
              ),
              minimizable: false,
            },
            position: { width: 480 },
            content: `
              <p style="margin-bottom: 1rem;">${game.i18n.localize('ARCHIVIST_SYNC.Menu.UpdateApiKey.Description')}</p>
              <div class="form-group">
                <input 
                  type="password" 
                  name="apiKey" 
                  placeholder="${game.i18n.localize('ARCHIVIST_SYNC.Menu.UpdateApiKey.Placeholder')}"
                  style="width: 100%; padding: 0.5rem; font-family: monospace;"
                  autofocus
                />
              </div>
            `,
            ok: {
              label: game.i18n.localize(
                'ARCHIVIST_SYNC.Menu.UpdateApiKey.Update'
              ),
              icon: 'fas fa-check',
              callback: (event, button) => {
                const form = button.form;
                return new FormData(form).get('apiKey');
              },
            },
            cancel: {
              label: game.i18n.localize(
                'ARCHIVIST_SYNC.Menu.UpdateApiKey.Cancel'
              ),
              icon: 'fas fa-times',
            },
            rejectClose: false,
          });

          if (result != null) {
            const newApiKey = String(result).trim();
            try {
              const { settingsManager } = await import(
                './settings-manager.js'
              );
              const hadKey = !!settingsManager.getApiKey();
              await settingsManager.setApiKey(newApiKey);
              if (newApiKey && !hadKey) {
                try {
                  if (
                    settingsManager.isWorldSelected?.() &&
                    settingsManager.isRealtimeSyncEnabled?.()
                  ) {
                    window.ARCHIVIST_SYNC?.installRealtimeSyncListeners?.();
                  }
                } catch (_) {}
              }
              ui.notifications.info(
                game.i18n.localize(
                  newApiKey
                    ? 'ARCHIVIST_SYNC.Menu.UpdateApiKey.Success'
                    : 'ARCHIVIST_SYNC.Menu.UpdateApiKey.Cleared'
                )
              );
            } catch (e) {
              console.error('[Archivist Sync] Failed to update API key', e);
              ui.notifications.error('Failed to update API key');
            }
          }
          return this;
        }
      },
      restricted: MENU_CONFIG.UPDATE_API_KEY.restricted,
    });
  }

  /**
   * Register Documentation menu
   * @private
   */
  _registerDocumentationMenu() {
    game.settings.registerMenu(this.moduleId, MENU_CONFIG.DOCUMENTATION.key, {
      name: game.i18n.localize(MENU_CONFIG.DOCUMENTATION.name),
      label: game.i18n.localize(MENU_CONFIG.DOCUMENTATION.label),
      hint: game.i18n.localize(MENU_CONFIG.DOCUMENTATION.hint),
      icon: MENU_CONFIG.DOCUMENTATION.icon,
      type: class extends foundry.applications.api.ApplicationV2 {
        static DEFAULT_OPTIONS = foundry.utils.mergeObject(
          foundry.utils.deepClone(super.DEFAULT_OPTIONS),
          {
            id: 'archivist-documentation-menu',
            window: {
              title: game.i18n.localize(
                'ARCHIVIST_SYNC.Menu.Documentation.Title'
              ),
            },
          }
        );
        async render(force = false, options = {}) {
          try {
            const { DocumentationWindow } = await import(
              '../dialogs/documentation-window.js'
            );
            (window.__ARCHIVIST_DOCS__ ||= new DocumentationWindow()).render(
              true
            );
          } catch (e) {
            console.error(
              '[Archivist Sync] Failed to open documentation window',
              e
            );
            ui.notifications?.error?.('Failed to open documentation window');
          }
          return this;
        }
      },
      restricted: MENU_CONFIG.DOCUMENTATION.restricted,
    });
  }

  /**
   * Register settings menu
   * @private
   */
  _registerRunSetupAgainMenu() {
    game.settings.registerMenu(this.moduleId, MENU_CONFIG.RUN_SETUP_AGAIN.key, {
      name: game.i18n.localize(MENU_CONFIG.RUN_SETUP_AGAIN.name),
      label: game.i18n.localize(MENU_CONFIG.RUN_SETUP_AGAIN.label),
      hint: game.i18n.localize(MENU_CONFIG.RUN_SETUP_AGAIN.hint),
      icon: MENU_CONFIG.RUN_SETUP_AGAIN.icon,
      type: class extends foundry.applications.api.ApplicationV2 {
        static DEFAULT_OPTIONS = foundry.utils.mergeObject(
          foundry.utils.deepClone(super.DEFAULT_OPTIONS),
          {
            id: 'archivist-run-setup',
            window: {
              title: game.i18n.localize('ARCHIVIST_SYNC.Menu.RunSetup.Title'),
            },
          }
        );
        async render(force = false, options = {}) {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: {
              title: game.i18n.localize('ARCHIVIST_SYNC.Menu.RunSetup.Title'),
            },
            content: `<p>${game.i18n.localize('ARCHIVIST_SYNC.Menu.RunSetup.Confirm')}</p>`,
          });
          if (confirmed) {
            try {
              const { settingsManager } = await import('./settings-manager.js');
              const MODULE_ID =
                settingsManager.moduleId ||
                (await import('./config.js')).CONFIG.MODULE_ID;

              console.warn(
                '[Archivist Sync] ⚠️  RE-INITIALIZATION STARTED: Real-time sync will be DISABLED to prevent data loss'
              );
              ui.notifications?.info?.('Resetting Archivist setup...');

              // CRITICAL: Suppress realtime sync to prevent cascading deletions to Archivist backend
              try {
                settingsManager.suppressRealtimeSync?.();
              } catch (_) {}

              // Verify suppression is active
              if (!settingsManager.isRealtimeSyncSuppressed?.()) {
                console.error(
                  '[Archivist Sync] ❌ CRITICAL: Realtime sync suppression FAILED!'
                );
                ui.notifications?.error?.(
                  'Critical error: Unable to disable sync. Aborting to prevent data loss.'
                );
                return this;
              }
              console.log(
                '[Archivist Sync] ✓ Real-time sync successfully suppressed'
              );

              // 1) Delete Archivist custom sheets (JournalEntries) flagged with our sheetType
              try {
                const journals = game.journal?.contents || [];
                const toDelete = [];
                for (const j of journals) {
                  const flags = j.getFlag(MODULE_ID, 'archivist') || {};
                  const st = String(flags.sheetType || '').toLowerCase();
                  if (
                    st === 'pc' ||
                    st === 'npc' ||
                    st === 'character' ||
                    st === 'item' ||
                    st === 'location' ||
                    st === 'faction' ||
                    st === 'recap'
                  ) {
                    toDelete.push(j);
                  }
                }
                if (toDelete.length) {
                  await Promise.allSettled(
                    toDelete.map((j) => j.delete({ render: false }))
                  );
                }
              } catch (e) {
                console.warn(
                  '[Archivist Sync] Cleanup: failed deleting custom sheets',
                  e
                );
              }

              // 2) Remove Archivist flags from core Actors, Items, Scenes (but do not delete the docs)
              try {
                const actors = game.actors?.contents || [];
                await Promise.allSettled(
                  actors.map((a) => a?.unsetFlag?.(MODULE_ID, 'archivistId'))
                );
              } catch (e) {
                console.warn(
                  '[Archivist Sync] Cleanup: actors unsetFlag failed',
                  e
                );
              }
              try {
                const items = game.items?.contents || [];
                await Promise.allSettled(
                  items.map((i) => i?.unsetFlag?.(MODULE_ID, 'archivistId'))
                );
              } catch (e) {
                console.warn(
                  '[Archivist Sync] Cleanup: items unsetFlag failed',
                  e
                );
              }
              try {
                const scenes = game.scenes?.contents || [];
                await Promise.allSettled(
                  scenes.map((s) => s?.unsetFlag?.(MODULE_ID, 'archivistId'))
                );
              } catch (e) {
                console.warn(
                  '[Archivist Sync] Cleanup: scenes unsetFlag failed',
                  e
                );
              }

              // 3) Mark world uninitialized
              await settingsManager.setWorldInitialized(false);
              ui.notifications?.info?.(
                game.i18n.localize(
                  'ARCHIVIST_SYNC.messages.worldInitializedReset'
                )
              );
              console.log(
                '[Archivist Sync] Re-initialization complete. Reloading...'
              );
              // Reload to trigger setup flow again (suppression will be cleared on reload)
              window.location.reload();
            } catch (e) {
              console.error(
                '[Archivist Sync] ❌ Failed to reset world initialization',
                e
              );
              ui.notifications?.error?.(
                game.i18n.localize('ARCHIVIST_SYNC.errors.resetFailed') ||
                  'Reset failed'
              );
            } finally {
              // Resume realtime sync if we didn't reload (error case)
              try {
                settingsManager.resumeRealtimeSync?.();
                console.log(
                  '[Archivist Sync] Real-time sync resumed after error'
                );
              } catch (_) {}
            }
          }
          return this;
        }
      },
      restricted: MENU_CONFIG.RUN_SETUP_AGAIN.restricted,
    });
  }

  /**
   * Get a setting value
   * @param {string} key - The setting key
   * @returns {*} The setting value
   */
  getSetting(key) {
    return game.settings.get(this.moduleId, key);
  }

  /**
   * Set a setting value
   * @param {string} key - The setting key
   * @param {*} value - The setting value
   * @returns {Promise<*>} Promise that resolves when setting is saved
   */
  async setSetting(key, value) {
    return await game.settings.set(this.moduleId, key, value);
  }

  /**
   * Read a stored API key, treating missing and blank values as empty.
   * @param {string} key
   * @returns {string}
   * @private
   */
  _readApiKey(key) {
    try {
      const value = this.getSetting(key);
      return typeof value === 'string' ? value.trim() : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * True when this user may write world-scoped settings.
   * @returns {boolean}
   * @private
   */
  _canModifyWorldSettings() {
    try {
      return !!game.user?.can?.('SETTINGS_MODIFY');
    } catch (_) {
      return !!game.user?.isGM;
    }
  }

  /**
   * Save the API key to this world and to this browser.
   * An empty value clears both. World writes are skipped when this user
   * cannot modify world settings; the browser copy is still saved.
   * @param {string} value
   * @returns {Promise<void>}
   */
  async setApiKey(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (this._canModifyWorldSettings()) {
      await this.setSetting(SETTINGS.API_KEY_CLEARED.key, !key);
      await this.setSetting(SETTINGS.API_KEY.key, key);
    }
    await this.setSetting(SETTINGS.API_KEY_CLIENT.key, key);
  }

  /**
   * True when a GM explicitly cleared the key for this world.
   * @returns {boolean}
   * @private
   */
  _isApiKeyCleared() {
    try {
      return !!this.getSetting(SETTINGS.API_KEY_CLEARED.key);
    } catch (_) {
      return false;
    }
  }

  /**
   * Fill an empty API key store from the one that has a value.
   * Only users who can modify world settings persist the cross-world copy.
   * When both are set, leave them unchanged even if they differ.
   * @returns {Promise<void>}
   */
  async syncApiKeyStores() {
    const world = this._readApiKey(SETTINGS.API_KEY.key);
    const client = this._readApiKey(SETTINGS.API_KEY_CLIENT.key);

    if (!client && world && this._canModifyWorldSettings()) {
      await this.setSetting(SETTINGS.API_KEY_CLIENT.key, world);
      return;
    }

    if (
      !world &&
      client &&
      !this._isApiKeyCleared() &&
      this._canModifyWorldSettings()
    ) {
      await this.setSetting(SETTINGS.API_KEY.key, client);
    }
  }

  /**
   * Get API key. Prefers the world value, then the browser copy.
   * @returns {string} The API key
   */
  getApiKey() {
    const world = this._readApiKey(SETTINGS.API_KEY.key);
    if (world) return world;
    if (this._isApiKeyCleared()) return '';
    return this._readApiKey(SETTINGS.API_KEY_CLIENT.key);
  }

  // AI settings and mapping override getters removed

  /**
   * Get selected world ID
   * @returns {string} The selected world ID
   */
  getSelectedWorldId() {
    return this.getSetting(SETTINGS.SELECTED_WORLD_ID.key);
  }

  /**
   * Get selected world name
   * @returns {string} The selected world name
   */
  getSelectedWorldName() {
    return this.getSetting(SETTINGS.SELECTED_WORLD_NAME.key);
  }

  /**
   * Set selected world
   * @param {string} worldId - The world ID
   * @param {string} worldName - The world name
   * @returns {Promise<void>}
   */
  async setSelectedWorld(worldId, worldName) {
    await this.setSetting(SETTINGS.SELECTED_WORLD_ID.key, worldId);
    await this.setSetting(SETTINGS.SELECTED_WORLD_NAME.key, worldName);
  }

  // Import configuration helpers removed

  /**
   * Check if API is configured
   * @returns {boolean} True if API key is set
   */
  isApiConfigured() {
    const apiKey = this.getApiKey();
    return apiKey && apiKey.length > 0;
  }

  /**
   * Check if world is selected
   * @returns {boolean} True if world is selected
   */
  isWorldSelected() {
    const worldId = this.getSelectedWorldId();
    return worldId && worldId.length > 0;
  }

  /**
   * Check if Archivist chat should be available
   * Requires both API configuration with world selection AND world initialization
   * @returns {boolean} True if chat should be available
   */
  isArchivistChatAvailable() {
    // Respect the Chat Visibility policy first
    try {
      const visibility = String(
        this.getSetting(SETTINGS.CHAT_VISIBILITY.key) || 'all'
      );
      if (visibility === 'none') return false;
      if (visibility === 'gm' && !game.user?.isGM) return false;
    } catch (_) {
      /* setting may not exist yet during early init */
    }

    // Condition 1: API key configured and world selected
    const hasValidWorldSelection =
      this.isApiConfigured() && this.isWorldSelected();
    // Condition 2: World has been initialized with Archivist
    const isInitialized = this.isWorldInitialized();
    return hasValidWorldSelection && isInitialized;
  }

  /**
   * Check if GM-only private journal context is enabled for chat
   * @returns {boolean}
   */
  getChatGmPermissionsEnabled() {
    try {
      return !!this.getSetting(SETTINGS.CHAT_GM_PERMISSIONS.key);
    } catch (_) {
      return true;
    }
  }

  /**
   * Check if world is initialized with Archivist
   * @returns {boolean} True if world has been initialized
   */
  isWorldInitialized() {
    return this.getSetting(SETTINGS.WORLD_INITIALIZED.key);
  }

  /**
   * Set world initialization status
   * @param {boolean} initialized - Whether the world is initialized
   * @returns {Promise<void>}
   */
  async setWorldInitialized(initialized = true) {
    await this.setSetting(SETTINGS.WORLD_INITIALIZED.key, initialized);
    Utils.log(`World initialization status set to: ${initialized}`);
  }

  /**
   * Ensure world initialization flag exists and is properly set
   * Only sets up the flag structure, does not mark as initialized
   * @returns {Promise<boolean>} True if flag was created, false if already existed
   */
  async ensureWorldInitializationFlag() {
    // Check if the setting already has a value (including false)
    const currentValue = this.getSetting(SETTINGS.WORLD_INITIALIZED.key);

    // If it's undefined (first time), set it to false
    if (currentValue === undefined || currentValue === null) {
      Utils.log('Setting up world initialization flag for first time (false)');
      await this.setSetting(SETTINGS.WORLD_INITIALIZED.key, false);
      return true;
    }

    Utils.log(`World initialization flag already exists: ${currentValue}`);
    return false;
  }

  /**
   * Complete world initialization (called when user finishes setup wizard)
   * @returns {Promise<void>}
   */
  async completeWorldInitialization() {
    Utils.log('Completing world initialization through setup wizard');
    await this.setWorldInitialized(true);

    // Perform any additional setup completion tasks here
    // For example: set default import config, create initial folders, etc.

    ui.notifications.info(
      game.i18n.localize('ARCHIVIST_SYNC.messages.worldInitialized')
    );
  }

  /**
   * Reset world initialization (for testing/development purposes)
   * @returns {Promise<void>}
   */
  async resetWorldInitialization() {
    Utils.log('Resetting world initialization flag to false');
    await this.setWorldInitialized(false);
    ui.notifications.warn(
      'World initialization has been reset. The setup wizard will appear again.'
    );
  }

  /**
   * Get journal folder destinations for organizing Archivist journals
   * @returns {{ pc: string, npc: string, item: string, location: string, faction: string }}
   */
  getJournalDestinations() {
    return (
      this.getSetting(SETTINGS.JOURNAL_DESTINATIONS.key) || {
        pc: '',
        npc: '',
        item: '',
        location: '',
        faction: '',
      }
    );
  }

  /**
   * Set journal folder destinations
   * @param {{ pc?: string, npc?: string, item?: string, location?: string, faction?: string }} destinations
   * @returns {Promise<void>}
   */
  async setJournalDestinations(destinations) {
    const current = this.getJournalDestinations();
    const updated = { ...current, ...destinations };
    await this.setSetting(SETTINGS.JOURNAL_DESTINATIONS.key, updated);
    Utils.log('Journal destinations updated:', updated);
  }

  /**
   * Refresh settings UI
   */
  refreshSettingsUi() {
    if (ui.settings && ui.settings.rendered) {
      ui.settings.render();
    }
  }

  _registerChatHistory() {
    const setting = SETTINGS.CHAT_HISTORY;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
    });

    const { key, ...userHistory } = SETTINGS.USER_CHAT_HISTORY;
    game.settings.register(this.moduleId, key, userHistory);

    const enabled = SETTINGS.CHAT_HISTORY_ENABLED;
    game.settings.register(this.moduleId, enabled.key, {
      name: game.i18n.localize(enabled.name),
      hint: game.i18n.localize(enabled.hint),
      scope: enabled.scope,
      config: enabled.config,
      type: enabled.type,
      default: enabled.default,
    });
  }

  _registerChatVisibility() {
    const setting = SETTINGS.CHAT_VISIBILITY;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      choices: {
        all: game.i18n.localize(
          'ARCHIVIST_SYNC.Settings.ChatVisibility.Options.All'
        ),
        gm: game.i18n.localize(
          'ARCHIVIST_SYNC.Settings.ChatVisibility.Options.GMOnly'
        ),
        none: game.i18n.localize(
          'ARCHIVIST_SYNC.Settings.ChatVisibility.Options.None'
        ),
      },
      default: setting.default,
      onChange: () => this._onChatAvailabilityChange(),
    });
  }

  _registerChatGmPermissions() {
    const setting = SETTINGS.CHAT_GM_PERMISSIONS;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
    });
  }

  /**
   * Handle changes that affect chat availability
   * @private
   */
  _onChatAvailabilityChange() {
    // Defer to next tick to ensure all settings have been updated
    setTimeout(() => {
      if (
        typeof window !== 'undefined' &&
        window.ARCHIVIST_SYNC?.updateChatAvailability
      ) {
        window.ARCHIVIST_SYNC.updateChatAvailability();
      }
    }, 0);
  }

  /**
   * Register World Initialized setting
   * @private
   */
  _registerWorldInitialized() {
    const setting = SETTINGS.WORLD_INITIALIZED;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
      onChange: (value) => {
        console.log(`${this.moduleTitle} | World initialized: ${value}`);
        this._onChatAvailabilityChange();
        // Trigger Journal Directory re-render when world initialization changes
        // This ensures custom elements mount immediately after setup
        if (value) {
          setTimeout(async () => {
            try {
              await ui?.journal?.render?.({ force: true });
              console.log('[Archivist Sync] Journal Directory re-rendered after world initialization change');
            } catch (e) {
              console.warn('[Archivist Sync] Failed to re-render Journal Directory on setting change', e);
            }
          }, 100);
        }
      },
    });
  }

  /**
   * Register Real-Time Sync world toggle
   * @private
   */
  _registerRealtimeSync() {
    const setting = SETTINGS.REALTIME_SYNC_ENABLED;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
    });
  }

  // _registerAutoSort removed

  _registerHideByOwnership() {
    const setting = SETTINGS.HIDE_BY_OWNERSHIP;
    game.settings.register(this.moduleId, setting.key, {
      name: game.i18n.localize(setting.name),
      hint: game.i18n.localize(setting.hint),
      scope: setting.scope,
      config: setting.config,
      type: setting.type,
      default: setting.default,
    });
  }

  _registerProjectionSettings() {
    const proj = SETTINGS.PROJECT_DESCRIPTIONS;
    game.settings.register(this.moduleId, proj.key, {
      name: game.i18n.localize(proj.name),
      hint: game.i18n.localize(proj.hint),
      scope: proj.scope,
      config: proj.config,
      type: proj.type,
      default: proj.default,
    });
  }

  getProjectDescriptionsEnabled() {
    return !!this.getSetting(SETTINGS.PROJECT_DESCRIPTIONS.key);
  }

  getProjectionLoopGuardMs() {
    return 0; // Deprecated; retained for backward compatibility where referenced
  }

  // getAutoSort removed

  getHideByOwnership() {
    return !!this.getSetting(SETTINGS.HIDE_BY_OWNERSHIP.key);
  }

  // Organize folders setting removed

  // Max location depth setting removed

  isRealtimeSyncEnabled() {
    try {
      return !!this.getSetting(SETTINGS.REALTIME_SYNC_ENABLED.key);
    } catch (_) {
      return true;
    }
  }

  /**
   * Temporarily suppress realtime sync hooks (non-persistent, session-only)
   * Use for bulk operations like initial world setup to prevent unintended API writes.
   */
  suppressRealtimeSync() {
    this._realtimeSuppressed =
      Math.max(0, Number(this._realtimeSuppressed || 0)) + 1;
  }

  /**
   * Resume realtime sync hooks after suppression.
   */
  resumeRealtimeSync() {
    this._realtimeSuppressed = Math.max(
      0,
      Number(this._realtimeSuppressed || 0) - 1
    );
  }

  /**
   * Returns true if realtime sync is currently suppressed.
   */
  isRealtimeSyncSuppressed() {
    return Number(this._realtimeSuppressed || 0) > 0;
  }
}

// Create singleton instance
export const settingsManager = new SettingsManager();
