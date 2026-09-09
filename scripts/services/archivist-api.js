import { CONFIG } from '../modules/config.js';
import { Utils } from '../modules/utils.js';

/**
 * Service class for handling all Archivist API interactions
 */
export class ArchivistApiService {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    /** @type {number} */
    this._lastWriteAtMs = 0;
    /** @type {number} */
    this._requestCount = 0;
    /** @type {number} */
    this._batchStartTime = 0;
  }

  /**
   * Sanitize a text field to Markdown (convert HTML if needed).
   * @param {any} value
   * @returns {string}
   */
  _sanitizeText(value) {
    try {
      return Utils.toMarkdownIfHtml?.(value) ?? '';
    } catch (_) {
      return String(value ?? '');
    }
  }

  /**
   * Remove a single leading image from Markdown or HTML at the top of description.
   * Handles patterns like: \n![alt](url)\n, <img ...>, or wrapped in <p>.
   * @param {string} text
   * @returns {string}
   */
  _stripLeadingImage(text) {
    const s = String(text || '');
    if (!s) return '';
    // Common patterns: Markdown image at start, possibly followed by blank line
    const mdImg = /^(?:\s*)!\[[^\]]*\]\([^\)]+\)\s*(?:\n+)?/;
    if (mdImg.test(s)) return s.replace(mdImg, '').trimStart();
    // HTML <img> possibly wrapped in <p> at the very start
    const htmlImgP = /^(?:\s*)<p[^>]*>\s*<img\b[^>]*>\s*<\/p>\s*/i;
    if (htmlImgP.test(s)) return s.replace(htmlImgP, '').trimStart();
    const htmlImg = /^(?:\s*)<img\b[^>]*>\s*/i;
    if (htmlImg.test(s)) return s.replace(htmlImg, '').trimStart();
    return s;
  }

  /**
   * Normalize payload text fields to Markdown and optionally strip leading image.
   * - Converts known text fields that can contain rich text (description, summary)
   * - Optionally removes leading image for faction/location descriptions
   * @param {object} payload
   * @param {{ stripImageFromDescription?: boolean }} opts
   * @returns {object}
   */
  _normalizePayload(payload, opts = {}) {
    const p = payload ? { ...payload } : {};
    if ('description' in p) {
      p.description = this._sanitizeText(p.description);
      if (opts.stripImageFromDescription) {
        p.description = this._stripLeadingImage(p.description);
      }
    }
    if ('summary' in p) {
      p.summary = this._sanitizeText(p.summary);
    }
    if ('content' in p) {
      p.content = this._sanitizeText(p.content);
    }
    if ('title' in p && typeof p.title === 'string') {
      p.title = String(p.title);
    }
    if ('name' in p && typeof p.name === 'string') {
      p.name = String(p.name);
    }
    if ('character_name' in p && typeof p.character_name === 'string') {
      p.character_name = String(p.character_name);
    }
    return p;
  }

  /**
   * Normalize Quest API payloads from snake_case to the camelCase shape used in the module.
   * Preserve original keys as well so older call sites continue to work.
   * @param {object} quest
   * @returns {object}
   */
  _normalizeQuestResponse(quest) {
    const q = quest ? { ...quest } : {};
    q.questName = q.questName ?? q.quest_name ?? '';
    q.questGiver = q.questGiver ?? q.quest_giver ?? '';
    q.questGiverId = q.questGiverId ?? q.quest_giver_id ?? null;
    q.questCategory = q.questCategory ?? q.quest_category ?? 'n/a';
    q.successDefinition =
      q.successDefinition ?? q.success_definition ?? '';
    q.failureConditions =
      q.failureConditions ?? q.failure_conditions ?? '';
    q.nextAction = q.nextAction ?? q.next_action ?? '';
    q.progressLog = q.progressLog ?? q.progress_log ?? [];
    q.progressLogEntries =
      q.progressLogEntries ?? q.progress_log_entries ?? [];
    q.relatedCharacters =
      q.relatedCharacters ?? q.related_characters ?? [];
    q.relatedFactions = q.relatedFactions ?? q.related_factions ?? [];
    q.relatedLocations =
      q.relatedLocations ?? q.related_locations ?? [];
    q.relatedItems = q.relatedItems ?? q.related_items ?? [];
    q.relatedEntityRefs =
      q.relatedEntityRefs ?? q.related_entity_refs ?? [];
    q.firstSession = q.firstSession ?? q.first_session ?? null;
    q.lastSession = q.lastSession ?? q.last_session ?? null;
    return q;
  }

  /**
   * Normalize quest writes to the API's snake_case contract.
   * @param {object} payload
   * @returns {object}
   */
  _normalizeQuestPayload(payload) {
    const p = payload ? { ...payload } : {};
    const out = {};

    // The API's QuestCreate/QuestUpdate schemas declare `extra="forbid"`, so
    // any key they don't recognize rejects the whole request with a 422. Build
    // a strict whitelist of writable fields only — read-only response fields
    // (questGiverId, progressLogEntries, firstSession, lastSession, counts,
    // orderIndex, timestamps) must never leak into a write payload.

    // campaign/world id is accepted on create only (QuestUpdate has no such
    // field); only forward it when a caller actually supplied one.
    const campaignId = p.campaign_id ?? p.campaignId ?? p.worldId;
    if (campaignId !== undefined) out.campaign_id = campaignId;

    // Scalar text / enum fields.
    const scalars = {
      quest_name: p.quest_name ?? p.questName,
      quest_giver: p.quest_giver ?? p.questGiver,
      quest_category: p.quest_category ?? p.questCategory,
      status: p.status,
      success_definition: p.success_definition ?? p.successDefinition,
      failure_conditions: p.failure_conditions ?? p.failureConditions,
      next_action: p.next_action ?? p.nextAction,
      resolution: p.resolution,
    };
    for (const [key, value] of Object.entries(scalars)) {
      if (value !== undefined) out[key] = value;
    }

    // Objectives → [{ text, status }] (drop server-managed id/order). The
    // API requires text with min_length=1 and rejects the whole request
    // otherwise, so drop entries with empty text.
    const objectives = p.objectives;
    if (Array.isArray(objectives)) {
      out.objectives = objectives
        .map((o) =>
          typeof o === 'string'
            ? { text: o.trim(), status: 'pending' }
            : {
                text: String(o?.text ?? '').trim(),
                status: o?.status ?? 'pending',
              }
        )
        .filter((o) => o.text.length > 0);
    }

    // Progress log → [str].
    const progressLog = p.progress_log ?? p.progressLog;
    if (Array.isArray(progressLog)) {
      out.progress_log = progressLog.map((e) =>
        typeof e === 'string' ? e : e?.text ?? ''
      );
    }

    // Related entity name lists → [str].
    const relatedLists = {
      related_characters: p.related_characters ?? p.relatedCharacters,
      related_factions: p.related_factions ?? p.relatedFactions,
      related_locations: p.related_locations ?? p.relatedLocations,
      related_items: p.related_items ?? p.relatedItems,
    };
    for (const [key, value] of Object.entries(relatedLists)) {
      if (Array.isArray(value)) out[key] = value;
    }

    // Structured related refs pass through untouched.
    const refs = p.related_entity_refs ?? p.relatedEntityRefs;
    if (Array.isArray(refs)) out.related_entity_refs = refs;

    return out;
  }

  /**
   * Internal fetch helper
   * @param {string} apiKey
   * @param {string} path - path starting with '/'
   * @param {RequestInit} options
   * @returns {Promise<any>}
   */
  async _request(apiKey, path, options = {}) {
    const headers = this._createHeaders(apiKey, options);
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    const maxRetries = 10;

    // Simple client-side throttle for write-heavy operations
    const method = String(options?.method || 'GET').toUpperCase();
    const isWrite =
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE';

    if (isWrite) {
      const now = Date.now();

      // Initialize batch tracking if needed
      if (this._batchStartTime === 0) {
        this._batchStartTime = now;
        this._requestCount = 0;
      }

      // Progressive throttling - more aggressive throttling as we make more requests
      const batchElapsedMs = now - this._batchStartTime;
      const requestsPerSecond = this._requestCount / (batchElapsedMs / 1000);

      let minSpacingMs = 250; // Base spacing
      if (requestsPerSecond > 3) {
        minSpacingMs = 500; // Slow down if we're going too fast
      }
      if (requestsPerSecond > 2) {
        minSpacingMs = 350; // Moderate slowdown
      }

      const waitMs = Math.max(0, this._lastWriteAtMs + minSpacingMs - now);
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }

      this._lastWriteAtMs = Date.now();
      this._requestCount++;

      // Reset batch tracking every 30 seconds
      if (batchElapsedMs > 30000) {
        this._batchStartTime = Date.now();
        this._requestCount = 0;
      }
    }

    // keepalive lets in-flight writes survive page unload, but Chromium
    // rejects keepalive requests whose body exceeds 64 KiB — skip it for
    // large payloads (e.g. long journal content) so they still send.
    const bodySize =
      typeof options?.body === 'string'
        ? new TextEncoder().encode(options.body).length
        : 0;
    const useKeepalive = isWrite && bodySize < 60000;

    while (attempt <= maxRetries) {
      try {
        const fetchOptions = {
          ...options,
          headers,
          mode: 'cors',
          cache: 'no-store',
        };
        if (useKeepalive) fetchOptions.keepalive = true;
        const response = await fetch(url, fetchOptions);

        // Handle successful responses (non-429)
        if (response.status !== 429) {
          return this._handleResponse(response);
        }

        // 429 handling with exponential backoff and jitter; respect Retry-After
        attempt += 1;

        if (attempt > maxRetries) {
          console.error(
            `${CONFIG.MODULE_TITLE} | Max retries (${maxRetries}) exceeded for ${method} ${path}`
          );
          throw new Error(
            `API request failed: 429 rate limited after ${maxRetries} retries`
          );
        }

        // Calculate retry delay
        const ra = response.headers.get('Retry-After');
        let retryMs = 0;
        if (ra) {
          const n = Number(ra);
          // If small value, assume seconds; if large, assume milliseconds
          if (isFinite(n)) {
            retryMs = n < 100 ? Math.max(1000, n * 1000) : n;
          }
        }

        // Exponential backoff: start at 1s, max 30s
        const baseDelay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 500); // 0-500ms jitter
        const delay = Math.max(retryMs || 0, baseDelay + jitter);

        console.warn(
          `${CONFIG.MODULE_TITLE} | Rate limited (429) on ${method} ${path}, attempt ${attempt}/${maxRetries}, retrying in ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
      } catch (error) {
        if (
          error.name === 'TypeError' &&
          error.message.includes('Failed to fetch')
        ) {
          // Network error - retry with exponential backoff
          attempt += 1;
          if (attempt > maxRetries) {
            console.error(
              `${CONFIG.MODULE_TITLE} | Network error after ${maxRetries} retries for ${method} ${path}:`,
              error
            );
            throw new Error(
              `Network error after ${maxRetries} retries: ${error.message}`
            );
          }

          const delay =
            Math.min(30000, 1000 * Math.pow(2, attempt - 1)) +
            Math.floor(Math.random() * 500);
          console.warn(
            `${CONFIG.MODULE_TITLE} | Network error on ${method} ${path}, attempt ${attempt}/${maxRetries}, retrying in ${delay}ms:`,
            error.message
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          // Other errors should not be retried
          throw error;
        }
      }
    }
  }

  /**
   * Create headers for API requests
   * @param {string} apiKey - The API key for authentication
   * @returns {object} Headers object
   */
  _createHeaders(apiKey, options = {}) {
    const method = String(options?.method || '').toUpperCase();
    const h = {
      Accept: '*/*',
      'x-api-key': apiKey,
      'X-Requested-With': 'XMLHttpRequest',
    };
    // Only set Content-Type when we actually send a body (avoids preflight on simple GETs)
    const hasBody =
      !!options?.body ||
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH';
    if (hasBody) h['Content-Type'] = 'application/json';
    return h;
  }

  /**
   * Handle API response and check for errors
   * @param {Response} response - Fetch response object
   * @returns {Promise<object>} Parsed JSON response
   * @throws {Error} If response is not ok
   */
  async _handleResponse(response) {
    if (!response.ok) {
      let detail = '';
      let errorData = null;
      try {
        const data = await response.clone().json();
        errorData = data;
        detail = data?.detail || data?.message || '';
      } catch (_) {
        try {
          detail = await response.clone().text();
        } catch (_) {
          /* ignore */
        }
      }

      // Check for description length validation error (422)
      if (response.status === 422) {
        const detailStr = String(detail).toLowerCase();
        const isDescriptionTooLong =
          detailStr.includes('description') &&
          (detailStr.includes('too long') ||
            detailStr.includes('exceeds') ||
            detailStr.includes('maximum') ||
            detailStr.includes('10000') ||
            detailStr.includes('10,000'));

        if (isDescriptionTooLong) {
          const error = new Error(
            `Description exceeds maximum length (10,000 characters)`
          );
          error.status = 422;
          error.isDescriptionTooLong = true;
          error.detail = errorData;
          throw error;
        }
      }

      const suffix = detail ? ` — ${String(detail).slice(0, 300)}` : '';
      const error = new Error(
        `API request failed: ${response.status} ${response.statusText}${suffix}`
      );
      error.status = response.status;
      error.detail = errorData;
      throw error;
    }
    // 204 No Content returns no body, don't try to parse JSON
    if (response.status === 204) {
      return { success: true };
    }
    return await response.json();
  }

  /**
   * Derive root API base (without version path like /v1) for non-versioned endpoints
   * @returns {string}
   */
  _rootBase() {
    // Strip trailing /v1 or /v1/ from API_BASE_URL
    return this.baseUrl.replace(/\/?v1\/?$/, '');
  }

  /**
   * Fetch campaigns list from the Archivist API
   * @param {string} apiKey - The API key for authentication
   * @returns {Promise<object>} Object with success flag and data array
   */
  async fetchCampaignsList(apiKey) {
    try {
      const data = await this._request(apiKey, `/campaigns`, { method: 'GET' });

      // Handle different possible response formats
      let campaigns = [];
      if (Array.isArray(data)) {
        campaigns = data;
      } else if (data.campaigns && Array.isArray(data.campaigns)) {
        campaigns = data.campaigns;
      } else if (data.data && Array.isArray(data.data)) {
        campaigns = data.data;
      } else {
        throw new Error('Unexpected API response format');
      }

      return {
        success: true,
        data: campaigns,
      };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to fetch campaigns:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to fetch campaigns from API',
      };
    }
  }

  /**
   * Create a new campaign in Archivist
   * @param {string} apiKey
   * @param {{title:string, description?:string}} payload
   */
  async createCampaign(apiKey, payload) {
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/campaigns`, {
        method: 'POST',
        body: JSON.stringify({
          title: norm.title,
          description: norm.description || '',
        }),
      });
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to create campaign:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to create campaign',
      };
    }
  }

  /**
   * Fetch detailed information for a specific campaign
   * @param {string} apiKey - The API key for authentication
   * @param {string} campaignId - The campaign ID to fetch details for
   * @returns {Promise<object>} Object with success flag and campaign data
   */
  async fetchCampaignDetails(apiKey, campaignId) {
    console.log('fetchCampaignDetails called with:', {
      apiKey: apiKey ? '***' + apiKey.slice(-4) : 'none',
      campaignId,
    });
    try {
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: 'GET',
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to fetch campaign details:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to fetch campaign details from API',
      };
    }
  }

  /**
   * Sync campaign title to Archivist API
   * @param {string} apiKey - The API key for authentication
   * @param {string} campaignId - The campaign ID to sync to
   * @param {object} titleData - Object containing title and description
   * @returns {Promise<object>} Object with success flag and response data
   */
  async syncCampaignTitle(apiKey, campaignId, titleData) {
    try {
      const norm = this._normalizePayload(titleData);
      const requestData = {
        title: norm.title,
        description: norm.description || '',
      };
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(requestData),
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to sync campaign title:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to sync campaign title',
      };
    }
  }

  /**
   * List all characters for a campaign (auto-paginate)
   * @param {string} apiKey
   * @param {string} campaignId
   * @returns {Promise<{success:boolean,data:Array}>>}
   */
  async listCharacters(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/characters?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items.map((quest) => this._normalizeQuestResponse(quest)));
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to list characters:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to list characters',
      };
    }
  }

  /**
   * Create a character
   * @param {string} apiKey
   * @param {object} payload
   */
  async createCharacter(apiKey, payload) {
    const entityName =
      payload?.character_name || payload?.name || 'Unknown Character';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/characters`, {
        method: 'POST',
        body: JSON.stringify(norm),
      });
      return { success: true, data: this._normalizeQuestResponse(data) };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      const isDescriptionTooLong = error.isDescriptionTooLong === true;

      console.error(`${CONFIG.MODULE_TITLE} | Failed to create character:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
        isDescriptionTooLong,
      });

      return {
        success: false,
        message: error.message || 'Failed to create character',
        retryable: isRateLimited || isNetworkError,
        isDescriptionTooLong,
        entityName,
        entityType: 'Character',
      };
    }
  }

  /**
   * Update a character
   * @param {string} apiKey
   * @param {string} characterId
   * @param {object} payload
   */
  async updateCharacter(apiKey, characterId, payload) {
    const entityName =
      payload?.character_name || payload?.name || 'Unknown Character';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(
        apiKey,
        `/characters/${encodeURIComponent(characterId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      const isDescriptionTooLong = error.isDescriptionTooLong === true;
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update character:`, {
        error: error.message,
        entityName,
        isDescriptionTooLong,
      });
      return {
        success: false,
        message: error.message || 'Failed to update character',
        isDescriptionTooLong,
        entityName,
        entityType: 'Character',
      };
    }
  }

  /**
   * Delete a character
   * @param {string} apiKey
   * @param {string} characterId
   */
  async deleteCharacter(apiKey, characterId) {
    try {
      const data = await this._request(
        apiKey,
        `/characters/${encodeURIComponent(characterId)}`,
        {
          method: 'DELETE',
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to delete character:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to delete character',
      };
    }
  }

  /**
   * List all factions for a campaign
   */
  async listFactions(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/factions?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to list factions:`, error);
      return {
        success: false,
        message: error.message || 'Failed to list factions',
      };
    }
  }

  async createFaction(apiKey, payload) {
    const entityName = payload?.name || 'Unknown Faction';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/factions`, {
        method: 'POST',
        body: JSON.stringify(norm),
      });
      return { success: true, data };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      const isDescriptionTooLong = error.isDescriptionTooLong === true;

      console.error(`${CONFIG.MODULE_TITLE} | Failed to create faction:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
        isDescriptionTooLong,
      });

      return {
        success: false,
        message: error.message || 'Failed to create faction',
        retryable: isRateLimited || isNetworkError,
        isDescriptionTooLong,
        entityName,
        entityType: 'Faction',
      };
    }
  }

  async updateFaction(apiKey, factionId, payload) {
    const entityName = payload?.name || 'Unknown Faction';
    try {
      const norm = this._normalizePayload(payload, {
        stripImageFromDescription: true,
      });
      const data = await this._request(
        apiKey,
        `/factions/${encodeURIComponent(factionId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      const isDescriptionTooLong = error.isDescriptionTooLong === true;
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update faction:`, {
        error: error.message,
        entityName,
        isDescriptionTooLong,
      });
      return {
        success: false,
        message: error.message || 'Failed to update faction',
        isDescriptionTooLong,
        entityName,
        entityType: 'Faction',
      };
    }
  }

  async deleteFaction(apiKey, factionId) {
    try {
      const data = await this._request(
        apiKey,
        `/factions/${encodeURIComponent(factionId)}`,
        {
          method: 'DELETE',
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to delete faction:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to delete faction',
      };
    }
  }

  /**
   * List all locations for a world
   */
  async listLocations(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/locations?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to list locations:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to list locations',
      };
    }
  }

  /**
   * List all game sessions for a campaign
   */
  async listSessions(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/sessions?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to list sessions:`, error);
      return {
        success: false,
        message: error.message || 'Failed to list sessions',
      };
    }
  }

  /**
   * Update a game session (recap)
   * @param {string} apiKey
   * @param {string} sessionId
   * @param {{title?:string, summary?:string}} payload
   */
  async updateSession(apiKey, sessionId, payload) {
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(
        apiKey,
        `/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to update session:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to update session',
      };
    }
  }

  async createLocation(apiKey, payload) {
    const entityName = payload?.name || 'Unknown Location';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/locations`, {
        method: 'POST',
        body: JSON.stringify(norm),
      });
      return { success: true, data };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      const isDescriptionTooLong = error.isDescriptionTooLong === true;

      console.error(`${CONFIG.MODULE_TITLE} | Failed to create location:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
        isDescriptionTooLong,
      });

      return {
        success: false,
        message: error.message || 'Failed to create location',
        retryable: isRateLimited || isNetworkError,
        isDescriptionTooLong,
        entityName,
        entityType: 'Location',
      };
    }
  }

  async updateLocation(apiKey, locationId, payload) {
    const entityName = payload?.name || 'Unknown Location';
    try {
      const norm = this._normalizePayload(payload, {
        stripImageFromDescription: true,
      });
      const data = await this._request(
        apiKey,
        `/locations/${encodeURIComponent(locationId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      const isDescriptionTooLong = error.isDescriptionTooLong === true;
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update location:`, {
        error: error.message,
        entityName,
        isDescriptionTooLong,
      });
      return {
        success: false,
        message: error.message || 'Failed to update location',
        isDescriptionTooLong,
        entityName,
        entityType: 'Location',
      };
    }
  }

  async deleteLocation(apiKey, locationId) {
    try {
      const data = await this._request(
        apiKey,
        `/locations/${encodeURIComponent(locationId)}`,
        {
          method: 'DELETE',
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to delete location:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to delete location',
      };
    }
  }

  /**
   * List all items for a campaign
   */
  async listItems(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/items?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to list items:`, error);
      return {
        success: false,
        message: error.message || 'Failed to list items',
      };
    }
  }

  /**
   * Create an item
   */
  async createItem(apiKey, payload) {
    const entityName = payload?.name || 'Unknown Item';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/items`, {
        method: 'POST',
        body: JSON.stringify(norm),
      });
      return { success: true, data };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      const isDescriptionTooLong = error.isDescriptionTooLong === true;

      console.error(`${CONFIG.MODULE_TITLE} | Failed to create item:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
        isDescriptionTooLong,
      });

      return {
        success: false,
        message: error.message || 'Failed to create item',
        retryable: isRateLimited || isNetworkError,
        isDescriptionTooLong,
        entityName,
        entityType: 'Item',
      };
    }
  }

  /**
   * Update an item
   */
  async updateItem(apiKey, itemId, payload) {
    const entityName = payload?.name || 'Unknown Item';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(
        apiKey,
        `/items/${encodeURIComponent(itemId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      const isDescriptionTooLong = error.isDescriptionTooLong === true;
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update item:`, {
        error: error.message,
        entityName,
        isDescriptionTooLong,
      });
      return {
        success: false,
        message: error.message || 'Failed to update item',
        isDescriptionTooLong,
        entityName,
        entityType: 'Item',
      };
    }
  }

  async deleteItem(apiKey, itemId) {
    try {
      const data = await this._request(
        apiKey,
        `/items/${encodeURIComponent(itemId)}`,
        {
          method: 'DELETE',
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to delete item:`, error);
      return {
        success: false,
        message: error.message || 'Failed to delete item',
      };
    }
  }

  /**
   * List all journals for a campaign (auto-paginate)
   * @param {string} apiKey
   * @param {string} campaignId
   * @returns {Promise<{success:boolean,data:Array}>}
   */
  // `format=markdown` keeps headings, lists and paragraph breaks in `content`.
  // The default `text` form flattens the Lexical document to bare lines and
  // concatenates list items with no separator, so an imported journal arrived
  // in Foundry as one run-on paragraph. Older API builds ignore the unknown
  // query param and simply return the flattened form as before.
  async listJournals(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/journals?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}&format=markdown`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        if (items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to list journals:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to list journals',
      };
    }
  }

  /**
   * Get a single journal entry by ID
   * @param {string} apiKey
   * @param {string} journalId
   * @returns {Promise<{success:boolean,data?:object}>}
   */
  async getJournal(apiKey, journalId) {
    try {
      const data = await this._request(
        apiKey,
        `/journals/${encodeURIComponent(journalId)}?format=markdown`,
        { method: 'GET' }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to get journal:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to get journal',
      };
    }
  }

  /**
   * Create a journal entry
   * @param {string} apiKey
   * @param {object} payload - { world_id, title, content?, ... }
   */
  async createJournal(apiKey, payload) {
    const entityName = payload?.title || 'Unknown Journal';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/journals`, {
        method: 'POST',
        body: JSON.stringify(norm),
      });
      return { success: true, data };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      console.error(`${CONFIG.MODULE_TITLE} | Failed to create journal:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
      });
      return {
        success: false,
        message: error.message || 'Failed to create journal',
        retryable: isRateLimited || isNetworkError,
        entityName,
        entityType: 'Journal',
      };
    }
  }

  /**
   * Update a journal entry (PUT — full replace)
   * @param {string} apiKey
   * @param {object} payload - { id, title?, content?, ... }
   */
  async updateJournal(apiKey, payload) {
    const entityName = payload?.title || 'Unknown Journal';
    try {
      const norm = this._normalizePayload(payload);
      const data = await this._request(apiKey, `/journals`, {
        method: 'PUT',
        body: JSON.stringify(norm),
      });
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update journal:`, {
        error: error.message,
        entityName,
      });
      return {
        success: false,
        message: error.message || 'Failed to update journal',
        entityName,
        entityType: 'Journal',
      };
    }
  }

  /**
   * Delete a journal entry
   * @param {string} apiKey
   * @param {string} journalId
   */
  async deleteJournal(apiKey, journalId) {
    try {
      const data = await this._request(
        apiKey,
        `/journals?id=${encodeURIComponent(journalId)}`,
        { method: 'DELETE' }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to delete journal:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to delete journal',
      };
    }
  }

  /**
   * List all journal folders for a campaign (no pagination — returns all)
   * @param {string} apiKey
   * @param {string} campaignId
   * @returns {Promise<{success:boolean,data:Array}>}
   */
  async listJournalFolders(apiKey, campaignId) {
    try {
      const data = await this._request(
        apiKey,
        `/journal-folders?campaign_id=${encodeURIComponent(campaignId)}`,
        { method: 'GET' }
      );
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.data)
          ? data.data
          : [];
      return { success: true, data: items };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to list journal folders:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to list journal folders',
      };
    }
  }

  /**
   * List all quests for a campaign (auto-paginate)
   * @param {string} apiKey
   * @param {string} campaignId
   * @returns {Promise<{success:boolean,data:Array}>}
   */
  async listQuests(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/quests?campaign_id=${encodeURIComponent(campaignId)}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to list quests:`, error);
      return {
        success: false,
        message: error.message || 'Failed to list quests',
      };
    }
  }

  /**
   * Get a single quest by ID (full QuestRead with objectives, progress, etc.)
   * @param {string} apiKey
   * @param {string} questId
   * @returns {Promise<{success:boolean,data?:object}>}
   */
  async getQuest(apiKey, questId) {
    try {
      const data = await this._request(
        apiKey,
        `/quests/${encodeURIComponent(questId)}`,
        { method: 'GET' }
      );
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to get quest:`, error);
      return {
        success: false,
        message: error.message || 'Failed to get quest',
      };
    }
  }

  /**
   * Create a quest
   * @param {string} apiKey
   * @param {object} payload - { worldId, questName, ... }
   */
  async createQuest(apiKey, payload) {
    const normalized = this._normalizeQuestPayload(payload);
    const entityName =
      normalized?.quest_name || payload?.questName || 'Unknown Quest';
    try {
      const data = await this._request(apiKey, `/quests`, {
        method: 'POST',
        body: JSON.stringify(normalized),
      });
      return { success: true, data: this._normalizeQuestResponse(data) };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      console.error(`${CONFIG.MODULE_TITLE} | Failed to create quest:`, {
        error: error.message,
        payload: entityName,
        isRateLimited,
        isNetworkError,
      });
      return {
        success: false,
        message: error.message || 'Failed to create quest',
        retryable: isRateLimited || isNetworkError,
        entityName,
        entityType: 'Quest',
      };
    }
  }

  /**
   * Update a quest (PATCH)
   * @param {string} apiKey
   * @param {string} questId
   * @param {object} payload
   */
  async updateQuest(apiKey, questId, payload) {
    const normalized = this._normalizeQuestPayload(payload);
    const entityName =
      normalized?.quest_name || payload?.questName || 'Unknown Quest';
    try {
      const data = await this._request(
        apiKey,
        `/quests/${encodeURIComponent(questId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(normalized),
        }
      );
      return { success: true, data: this._normalizeQuestResponse(data) };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update quest:`, {
        error: error.message,
        entityName,
      });
      return {
        success: false,
        message: error.message || 'Failed to update quest',
        entityName,
        entityType: 'Quest',
      };
    }
  }

  /**
   * Delete a quest
   * @param {string} apiKey
   * @param {string} questId
   */
  async deleteQuest(apiKey, questId) {
    try {
      const data = await this._request(
        apiKey,
        `/quests/${encodeURIComponent(questId)}`,
        { method: 'DELETE' }
      );
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to delete quest:`, error);
      return {
        success: false,
        message: error.message || 'Failed to delete quest',
      };
    }
  }

  /**
   * List Links for a campaign
   * @param {string} apiKey
   * @param {string} campaignId
   * @returns {Promise<{success:boolean,data:Array}>>}
   */
  async listLinks(apiKey, campaignId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      while (true) {
        const data = await this._request(
          apiKey,
          `/campaigns/${encodeURIComponent(campaignId)}/links?page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to list links:`, error);
      return {
        success: false,
        message: error.message || 'Failed to list links',
      };
    }
  }

  /**
   * List Links for a campaign filtered by from_id
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {string} fromId
   * @returns {Promise<{success:boolean,data:Array}>>}
   */
  async listLinksByFromId(apiKey, campaignId, fromId) {
    try {
      let page = 1;
      const size = 100;
      const all = [];
      const fid = encodeURIComponent(fromId);
      while (true) {
        const data = await this._request(
          apiKey,
          `/campaigns/${encodeURIComponent(campaignId)}/links?from_id=${fid}&page=${page}&size=${size}`,
          { method: 'GET' }
        );
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        all.push(...items);
        const totalPages =
          typeof data.pages === 'number'
            ? data.pages
            : items.length < size
              ? page
              : page + 1;
        if (page >= totalPages || items.length < size) break;
        page += 1;
      }
      return { success: true, data: all };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to list links by from_id:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to list links by from_id',
      };
    }
  }

  /**
   * Create a Link in a campaign
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {{from_id:string,from_type:string,to_id:string,to_type:string,alias?:string}} payload
   */
  async createLink(apiKey, campaignId, payload) {
    try {
      const norm = { ...payload };
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}/links`,
        {
          method: 'POST',
          body: JSON.stringify(norm),
        }
      );
      return { success: true, data };
    } catch (error) {
      const isRateLimited =
        error.message?.includes('429') ||
        error.message?.includes('rate limited');
      const isNetworkError =
        error.message?.includes('Network error') ||
        error.message?.includes('Failed to fetch');
      console.error(`${CONFIG.MODULE_TITLE} | Failed to create link:`, {
        error: error.message,
        from: `${payload?.from_type}:${payload?.from_id}`,
        to: `${payload?.to_type}:${payload?.to_id}`,
        isRateLimited,
        isNetworkError,
      });
      return {
        success: false,
        message: error.message || 'Failed to create link',
        retryable: isRateLimited || isNetworkError,
      };
    }
  }

  /**
   * Delete a Link in a campaign
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {string} linkId
   */
  async deleteLink(apiKey, campaignId, linkId) {
    try {
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}/links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' }
      );
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to delete link:`, error);
      return {
        success: false,
        message: error.message || 'Failed to delete link',
      };
    }
  }

  /**
   * Update a Link's alias in a campaign (PATCH).
   * Prefer this over delete+recreate when only the alias/label changes and the
   * from/to endpoints stay the same.
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {string} linkId
   * @param {{alias?: string}} payload
   */
  async updateLink(apiKey, campaignId, linkId, payload) {
    try {
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}/links/${encodeURIComponent(linkId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | Failed to update link:`, error);
      return {
        success: false,
        message: error.message || 'Failed to update link',
      };
    }
  }

  /**
   * Step 1 of the local-image-upload flow: request a presigned upload URL.
   * Supported entity types: character, faction, location, item (NOT quest —
   * the API has no image support for Quest).
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {{entityType:string, entityId:string, fileName:string, contentType:string}} params
   * @returns {Promise<{success:boolean, data?:{object_key:string, upload_url:string, public_url:string, expires_in_seconds:number}}>}
   */
  async initImageUpload(
    apiKey,
    campaignId,
    { entityType, entityId, fileName, contentType }
  ) {
    try {
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}/images/init`,
        {
          method: 'POST',
          body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            file_name: fileName,
            content_type: contentType,
          }),
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to init image upload:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to init image upload',
      };
    }
  }

  /**
   * Step 2: PUT the raw image bytes directly to the presigned R2 URL from initImageUpload.
   * This does NOT go through _request (no api key / json headers — the presigned
   * URL carries its own auth).
   * @param {string} uploadUrl
   * @param {Blob|ArrayBuffer} bytes
   * @param {string} contentType
   */
  async uploadImageBytes(uploadUrl, bytes, contentType) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
    });
    if (!res.ok) {
      throw new Error(`Image upload PUT failed: HTTP ${res.status}`);
    }
    return true;
  }

  /**
   * Step 3: tell the API the upload finished so it can validate + attach the image.
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {{objectKey:string, entityType:string, entityId:string, attach?:boolean}} params
   * @returns {Promise<{success:boolean, data?:{url:string, attached:boolean}}>}
   */
  async completeImageUpload(
    apiKey,
    campaignId,
    { objectKey, entityType, entityId, attach = true }
  ) {
    try {
      const data = await this._request(
        apiKey,
        `/campaigns/${encodeURIComponent(campaignId)}/images/complete`,
        {
          method: 'POST',
          body: JSON.stringify({
            object_key: objectKey,
            entity_type: entityType,
            entity_id: entityId,
            attach,
          }),
        }
      );
      return { success: true, data };
    } catch (error) {
      console.error(
        `${CONFIG.MODULE_TITLE} | Failed to complete image upload:`,
        error
      );
      return {
        success: false,
        message: error.message || 'Failed to complete image upload',
      };
    }
  }

  /**
   * Convenience wrapper: run the full init -> PUT -> complete flow for a local
   * Foundry image (read via Utils.fetchLocalImageBytes or similar).
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {{entityType:string, entityId:string, fileName:string, contentType:string, bytes:Blob|ArrayBuffer}} params
   * @returns {Promise<{success:boolean, url?:string, message?:string}>}
   */
  async uploadEntityImage(
    apiKey,
    campaignId,
    { entityType, entityId, fileName, contentType, bytes }
  ) {
    const init = await this.initImageUpload(apiKey, campaignId, {
      entityType,
      entityId,
      fileName,
      contentType,
    });
    if (!init.success) return init;
    try {
      await this.uploadImageBytes(
        init.data.upload_url,
        bytes,
        contentType
      );
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to upload image bytes',
      };
    }
    const complete = await this.completeImageUpload(apiKey, campaignId, {
      objectKey: init.data.object_key,
      entityType,
      entityId,
      attach: true,
    });
    if (!complete.success) return complete;
    return { success: true, url: complete.data?.url };
  }

  /**
   * Ask (RAG chat) — non-streaming
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {Array<{role:'user'|'assistant',content:string}>} messages
   * @param {boolean} gmPermissions
   * @returns {Promise<{success:boolean, answer?:string, monthlyTokensRemaining?:number, hourlyTokensRemaining?:number, message?:string}>}
   */
  async ask(apiKey, campaignId, messages, gmPermissions = false) {
    try {
      const url = `${this._rootBase()}/v1/ask`;
      const headers = {
        ...this._createHeaders(apiKey, { method: 'POST', body: '1' }),
      };
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          campaign_id: campaignId,
          messages,
          gm_permissions: !!gmPermissions,
        }),
      });
      const data = await this._handleResponse(r);
      return {
        success: true,
        answer: data?.answer ?? '',
        monthlyTokensRemaining: data?.monthlyTokensRemaining,
        hourlyTokensRemaining: data?.hourlyTokensRemaining,
      };
    } catch (error) {
      console.error(`${CONFIG.MODULE_TITLE} | /ask failed:`, error);
      return { success: false, message: error.message || 'Ask failed' };
    }
  }

  /**
   * Ask (RAG chat) — streaming
   * @param {string} apiKey
   * @param {string} campaignId
   * @param {Array<{role:'user'|'assistant',content:string}>} messages
   * @param {boolean} gmPermissions
   * @param {(chunk:string)=>void} onChunk
   * @param {(final:{text:string, monthlyTokensRemaining?:number, hourlyTokensRemaining?:number})=>void} onDone
   * @param {AbortSignal} [signal]
   */
  async askStream(
    apiKey,
    campaignId,
    messages,
    gmPermissions,
    onChunk,
    onDone,
    signal
  ) {
    if (typeof gmPermissions === 'function') {
      signal = onDone;
      onDone = onChunk;
      onChunk = gmPermissions;
      gmPermissions = false;
    }
    const url = `${this._rootBase()}/v1/ask`;
    const headers = {
      ...this._createHeaders(apiKey, { method: 'POST', body: '1' }),
    };
    // Accept any stream; some servers send text/plain for streaming
    headers['Accept'] = '*/*';
    const body = JSON.stringify({
      campaign_id: campaignId,
      messages,
      stream: true,
      gm_permissions: !!gmPermissions,
    });
    const resp = await fetch(url, { method: 'POST', headers, body, signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `Ask stream failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`
      );
    }
    const monthly =
      Number(resp.headers.get('X-Monthly-Remaining-Tokens') || '') || undefined;
    const hourly =
      Number(resp.headers.get('X-Hourly-Remaining-Tokens') || '') || undefined;
    const reader = resp.body?.getReader?.();
    if (!reader) {
      // Fallback: try parse as JSON answer
      try {
        const data = await resp.clone().json();
        const answer = data?.answer || '';
        if (answer) onChunk?.(answer);
        onDone?.({
          text: answer,
          monthlyTokensRemaining: monthly,
          hourlyTokensRemaining: hourly,
        });
        return;
      } catch (_) {
        const text = await resp.text();
        if (text) onChunk?.(text);
        onDone?.({
          text,
          monthlyTokensRemaining: monthly,
          hourlyTokensRemaining: hourly,
        });
        return;
      }
    }
    const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        fullText += chunk;
        onChunk?.(chunk);
      }
    }
    onDone?.({
      text: fullText,
      monthlyTokensRemaining: monthly,
      hourlyTokensRemaining: hourly,
    });
  }

  /**
   * Test API connectivity
   * @param {string} apiKey - The API key for authentication
   * @returns {Promise<boolean>} True if connection is successful
   */
  async testConnection(apiKey) {
    try {
      await this.fetchCampaignsList(apiKey);
      return true;
    } catch (error) {
      console.warn(
        `${CONFIG.MODULE_TITLE} | API connection test failed:`,
        error
      );
      return false;
    }
  }
}

// Create singleton instance
export const archivistApi = new ArchivistApiService();
