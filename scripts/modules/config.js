/**
 * Configuration constants for Archivist Sync Module
 */
export const CONFIG = {
  MODULE_ID: 'archivist-sync',
  MODULE_TITLE: 'Archivist Sync',
  API_BASE_URL: 'https://api.myarchivist.ai/v1',
};

/**
 * Module setting keys and their configurations
 */
export const SETTINGS = {
  API_KEY: {
    key: 'apiKey',
    name: 'ARCHIVIST_SYNC.Settings.ApiKey.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ApiKey.Hint',
    scope: 'world',
    config: false, // Hidden from normal settings; use menu instead
    type: String,
    default: '',
  },

  // Set when a GM explicitly clears the key, so the browser copy is not
  // restored into this world afterwards.
  API_KEY_CLEARED: {
    key: 'apiKeyCleared',
    name: 'ARCHIVIST_SYNC.Settings.ApiKey.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ApiKey.Hint',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  },

  // Browser copy of the API key. Foundry allows one scope per key, so this
  // client setting carries the key across worlds. The world setting above
  // remains the secret value stored for the current world.
  API_KEY_CLIENT: {
    key: 'apiKeyClient',
    name: 'ARCHIVIST_SYNC.Settings.ApiKey.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ApiKey.Hint',
    scope: 'client',
    config: false,
    type: String,
    default: '',
  },

  SELECTED_WORLD_ID: {
    key: 'selectedWorldId',
    name: 'ARCHIVIST_SYNC.Settings.SelectedWorld.Name',
    hint: 'ARCHIVIST_SYNC.Settings.SelectedWorld.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: '',
  },

  SELECTED_WORLD_NAME: {
    key: 'selectedWorldName',
    name: 'ARCHIVIST_SYNC.Settings.SelectedWorldName.Name',
    hint: 'ARCHIVIST_SYNC.Settings.SelectedWorldName.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: 'None selected',
  },
  // Import config setting removed

  WORLD_INITIALIZED: {
    key: 'worldInitialized',
    name: 'ARCHIVIST_SYNC.Settings.WorldInitialized.Name',
    hint: 'ARCHIVIST_SYNC.Settings.WorldInitialized.Hint',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
  },

  // Auto-sort setting removed; sorting is always enabled

  HIDE_BY_OWNERSHIP: {
    key: 'hideByOwnership',
    name: 'ARCHIVIST_SYNC.Settings.HideByOwnership.Name',
    hint: 'ARCHIVIST_SYNC.Settings.HideByOwnership.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  },

  // Organize folders setting removed

  // Max location depth setting removed

  REALTIME_SYNC_ENABLED: {
    key: 'realtimeSyncEnabled',
    name: 'ARCHIVIST_SYNC.Settings.RealtimeSync.Name',
    hint: 'ARCHIVIST_SYNC.Settings.RealtimeSync.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  },

  JOURNAL_DESTINATIONS: {
    key: 'journalDestinations',
    name: 'Journal Folder Destinations',
    hint: 'Folder IDs for organizing Archivist journals by type',
    scope: 'world',
    config: false,
    type: Object,
    default: { pc: '', npc: '', item: '', location: '', faction: '', journal: '', quest: '' },
  },

  CHAT_HISTORY: {
    key: 'chatHistory',
    name: 'ARCHIVIST_SYNC.Settings.ChatHistory.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ChatHistory.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: '[]',
  },

  USER_CHAT_HISTORY: {
    key: 'userChatHistory',
    scope: 'user',
    config: false,
    type: Object,
    default: {},
  },

  CHAT_HISTORY_ENABLED: {
    key: 'chatHistoryEnabled',
    name: 'ARCHIVIST_SYNC.Settings.ChatHistoryEnabled.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ChatHistoryEnabled.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  },

  CHAT_VISIBILITY: {
    key: 'chatVisibility',
    name: 'ARCHIVIST_SYNC.Settings.ChatVisibility.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ChatVisibility.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'all', // 'all' | 'gm' | 'none'
  },

  CHAT_GM_PERMISSIONS: {
    key: 'chatGmPermissions',
    name: 'ARCHIVIST_SYNC.Settings.ChatGmPermissions.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ChatGmPermissions.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  },

  PROJECT_DESCRIPTIONS: {
    key: 'projectDescriptions',
    name: 'ARCHIVIST_SYNC.Settings.ProjectDescriptions.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ProjectDescriptions.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  },

  PROJECTION_LOOP_GUARD_MS: {
    // deprecated: retained only to avoid runtime errors if referenced
    key: 'projectionLoopGuardMs',
    name: 'ARCHIVIST_SYNC.Settings.ProjectionLoopGuardMs.Name',
    hint: 'ARCHIVIST_SYNC.Settings.ProjectionLoopGuardMs.Hint',
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  },

  // Semantic mapping setting removed
};

/**
 * Menu configuration
 */

const ICON = 'modules/archivist-sync/assets/icons/archivist.svg';

export const MENU_CONFIG = {
  UPDATE_API_KEY: {
    key: 'updateApiKey',
    name: 'ARCHIVIST_SYNC.Menu.UpdateApiKey.Name',
    label: 'ARCHIVIST_SYNC.Menu.UpdateApiKey.Label',
    hint: 'ARCHIVIST_SYNC.Menu.UpdateApiKey.Hint',
    icon: 'fas fa-key',
    restricted: true,
  },
  RUN_SETUP_AGAIN: {
    key: 'runSetupAgain',
    name: 'ARCHIVIST_SYNC.Menu.RunSetup.Name',
    label: 'ARCHIVIST_SYNC.Menu.RunSetup.Label',
    hint: 'ARCHIVIST_SYNC.Menu.RunSetup.Hint',
    icon: 'fas fa-wand-magic-sparkles',
    restricted: true,
  },
  DOCUMENTATION: {
    key: 'documentation',
    name: 'ARCHIVIST_SYNC.Menu.Documentation.Name',
    label: 'ARCHIVIST_SYNC.Menu.Documentation.Label',
    hint: 'ARCHIVIST_SYNC.Menu.Documentation.Hint',
    icon: 'fas fa-book',
    restricted: false,
  },
};

/**
 * Dialog configuration
 */
export const DIALOG_CONFIG = {};

/**
 * Tab configuration
 */
export const TABS = {};
