import { CONFIG } from './config.js';

/** Daggerheart actor types whose data model exposes a bare `system.description`. */
const DAGGERHEART_DESCRIPTION_TYPES = new Set([
  'adversary',
  'npc',
  'environment',
  'party',
]);

/**
 * Utility functions for Archivist Sync Module
 */
export class Utils {
  /**
   * Return the current system id in lowercase (e.g., "dnd5e", "pf2e").
   */
  static getSystemId() {
    return String(game?.system?.id || '').toLowerCase();
  }

  /**
   * Safely get the first non-empty string value from an object using a list of dot-paths.
   * @param {object} obj
   * @param {string[]} paths
   * @returns {string}
   */
  static pickFirstProperty(obj, paths = []) {
    const get = (o, path) => {
      try {
        if (foundry?.utils?.getProperty)
          return foundry.utils.getProperty(o, path);
      } catch (_) {}
      return String(path)
        .split('.')
        .reduce((acc, k) => (acc && k in acc ? acc[k] : undefined), o);
    };
    for (const p of paths) {
      const v = get(obj, p);
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  }

  /**
   * Compute the preferred READ paths for an Actor description based on system and actor type.
   * @param {Actor} actor
   * @returns {string[]}
   */
  static getActorDescriptionReadPaths(actor) {
    const sysId = this.getSystemId();
    const isPC = String(actor?.type || '').toLowerCase() === 'character';
    const isNPC = String(actor?.type || '').toLowerCase() === 'npc';

    if (sysId === 'dnd5e')
      return [
        'system.details.biography.value',
        'system.details.biography.public',
        'system.description.value',
      ];

    if (sysId === 'pf2e') {
      if (isPC)
        return [
          'system.details.biography.backstory',
          'system.details.publicNotes',
          'system.description.value',
        ];
      if (isNPC)
        return [
          'system.details.publicNotes',
          'system.details.notes.description',
          'system.description.value',
        ];
      return [
        'system.details.biography.backstory',
        'system.details.publicNotes',
        'system.details.notes.description',
        'system.description.value',
      ];
    }

    // Daggerheart (Foundryborne): PCs keep prose under system.biography.*,
    // while the isNPC data models (adversary, npc, environment, party) expose a
    // bare system.description. Companions have neither; do not invent a path.
    if (sysId === 'daggerheart') {
      if (isPC)
        return [
          'system.biography.background',
          'system.biography.connections',
          'system.description',
        ];
      if (
        DAGGERHEART_DESCRIPTION_TYPES.has(
          String(actor?.type || '').toLowerCase()
        )
      )
        return [
          'system.description',
          'system.notes',
          'system.biography.background',
        ];
      return [];
    }

    // Generic fallbacks
    return [
      'system.details.biography.value',
      'system.details.biography.public',
      'system.description.value',
      'system.details.description',
      'system.details.publicNotes',
      'system.description',
    ];
  }

  /**
   * Compute the preferred WRITE path for projecting an Actor description back into the system.
   * @param {Actor} actor
   * @returns {string|null} A dot-path suitable for Actor.update({ [path]: html }), or null when none exists
   */
  static getActorDescriptionWritePath(actor) {
    const sysId = this.getSystemId();
    const isPC = String(actor?.type || '').toLowerCase() === 'character';
    const isNPC = String(actor?.type || '').toLowerCase() === 'npc';

    if (sysId === 'dnd5e') return 'system.details.biography.value';

    if (sysId === 'pf2e') {
      if (isPC) return 'system.details.biography.backstory';
      if (isNPC) return 'system.details.publicNotes';
      return 'system.details.publicNotes';
    }

    // Daggerheart (Foundryborne). Must stay in sync with the projection adapter
    // and with getActorDescriptionReadPaths(), or a write lands somewhere the
    // read never looks. Companions have no prose field — return null so the
    // caller reports that rather than updating a non-schema path.
    if (sysId === 'daggerheart') {
      if (isPC) return 'system.biography.background';
      if (
        DAGGERHEART_DESCRIPTION_TYPES.has(
          String(actor?.type || '').toLowerCase()
        )
      )
        return 'system.description';
      return null;
    }

    // Generic destination
    return 'system.description.value';
  }

  /**
   * Read an Actor description as plain text (Markdown-like) for ingest.
   * @param {Actor} actor
   * @returns {string}
   */
  static readActorDescription(actor) {
    const sysId = this.getSystemId();
    const actorType = String(actor?.type || '').toLowerCase();
    const paths = this.getActorDescriptionReadPaths(actor);
    try {
      console.log(
        '[Utils.readActorDescription] Discovering actor description',
        {
          system: sysId,
          actorId: actor?.id,
          actorName: actor?.name,
          actorType,
          paths,
        }
      );
    } catch (_) {}
    const get = (o, p) => {
      try {
        if (foundry?.utils?.getProperty) return foundry.utils.getProperty(o, p);
      } catch (_) {}
      return String(p)
        .split('.')
        .reduce((acc, k) => (acc && k in acc ? acc[k] : undefined), o);
    };
    let selectedPath = null;
    let raw = '';
    for (const p of paths) {
      const v = get(actor, p);
      if (typeof v === 'string' && v.trim()) {
        selectedPath = p;
        raw = v;
        break;
      }
    }
    try {
      console.log('[Utils.readActorDescription] Selected path', {
        selectedPath: selectedPath || 'none',
        length: String(raw || '').length,
        preview: String(raw || '').slice(0, 120),
      });
    } catch (_) {}
    return this.toMarkdownIfHtml(raw);
  }

  /**
   * Project a description onto an Actor at the proper system path.
   * Accepts Markdown and converts to sanitized HTML for storage.
   * @param {Actor} actor
   * @param {string} markdown
   */
  static async projectActorDescription(actor, markdown) {
    const destPath = this.getActorDescriptionWritePath(actor);
    try {
      console.log(
        '[Utils.projectActorDescription] Projecting actor description',
        {
          system: this.getSystemId(),
          actorId: actor?.id,
          actorName: actor?.name,
          actorType: actor?.type,
          destPath,
          markdownLength: String(markdown ?? '').length,
        }
      );
    } catch (_) {}
    if (!destPath) {
      try {
        console.warn(
          '[Utils.projectActorDescription] No destination field on this actor type',
          {
            system: this.getSystemId(),
            actorType: actor?.type,
          }
        );
      } catch (_) {}
      return null;
    }
    const html = this.markdownToStoredHtml(String(markdown ?? ''));
    await actor.update({ [destPath]: html });
    return destPath;
  }

  /**
   * Resolve a valid Item type for the current system.
   * - Prefer a cached value after first resolution
   * - Fallback to 'loot' if available; otherwise first defined item type
   * @returns {string} valid item type id for Item.create
   */
  static getDefaultItemType() {
    try {
      if (
        this.__defaultItemType &&
        typeof this.__defaultItemType === 'string'
      ) {
        console.log(
          '[Utils.getDefaultItemType] Using cached default type:',
          this.__defaultItemType
        );
        return this.__defaultItemType;
      }
      console.log(
        '[Utils.getDefaultItemType] Discovering system Item types...'
      );
      const types = (() => {
        try {
          const meta = CONFIG?.Item?.documentClass?.metadata?.types;
          console.log(
            '[Utils.getDefaultItemType] CONFIG.Item.documentClass.metadata.types:',
            meta
          );
          if (Array.isArray(meta) && meta.length)
            return meta.map((t) => String(t).toLowerCase());
        } catch (e) {
          console.warn(
            '[Utils.getDefaultItemType] Failed to read CONFIG metadata:',
            e
          );
        }
        try {
          const model = game?.system?.model?.Item;
          const keys = model ? Object.keys(model) : [];
          console.log(
            '[Utils.getDefaultItemType] game.system.model.Item keys:',
            keys
          );
          if (keys.length) return keys.map((t) => String(t).toLowerCase());
        } catch (e) {
          console.warn(
            '[Utils.getDefaultItemType] Failed to read system.model.Item:',
            e
          );
        }
        try {
          const docTypes = game?.system?.documentTypes?.Item;
          console.log(
            '[Utils.getDefaultItemType] game.system.documentTypes.Item:',
            docTypes
          );
          if (Array.isArray(docTypes) && docTypes.length)
            return docTypes.map((t) => String(t).toLowerCase());
          if (docTypes && typeof docTypes === 'object') {
            const keys = Object.keys(docTypes);
            if (keys.length) return keys.map((t) => String(t).toLowerCase());
          }
        } catch (e) {
          console.warn(
            '[Utils.getDefaultItemType] Failed to read system.documentTypes.Item:',
            e
          );
        }
        console.warn(
          '[Utils.getDefaultItemType] No system types found, returning empty array'
        );
        return [];
      })();
      console.log('[Utils.getDefaultItemType] Resolved types array:', types);
      const picked = types[0] || 'loot';
      console.log(
        '[Utils.getDefaultItemType] Picked default type:',
        picked,
        '(will fallback to "loot" if types empty)'
      );
      this.__defaultItemType = picked;
      return picked;
    } catch (e) {
      console.error(
        '[Utils.getDefaultItemType] Outer catch, returning "loot":',
        e
      );
      return 'loot';
    }
  }

  /**
   * Resolve a safe Item type from a source descriptor with fallback to system default.
   * @param {any} source - object that may include type/item_type/category
   * @returns {string} valid item type id
   */
  static resolveItemType(source) {
    try {
      console.log('[Utils.resolveItemType] Called with source:', {
        type: source?.type,
        item_type: source?.item_type,
        category: source?.category,
      });
      const types = (() => {
        try {
          const meta = CONFIG?.Item?.documentClass?.metadata?.types;
          console.log(
            '[Utils.resolveItemType] CONFIG.Item.documentClass.metadata.types:',
            meta
          );
          if (Array.isArray(meta) && meta.length)
            return meta.map((t) => String(t).toLowerCase());
        } catch (_) {}
        try {
          const model = game?.system?.model?.Item;
          const keys = model ? Object.keys(model) : [];
          console.log(
            '[Utils.resolveItemType] game.system.model.Item keys:',
            keys
          );
          if (keys.length) return keys.map((t) => String(t).toLowerCase());
        } catch (_) {}
        try {
          const docTypes = game?.system?.documentTypes?.Item;
          console.log(
            '[Utils.resolveItemType] game.system.documentTypes.Item:',
            docTypes
          );
          if (Array.isArray(docTypes) && docTypes.length)
            return docTypes.map((t) => String(t).toLowerCase());
          if (docTypes && typeof docTypes === 'object') {
            const keys = Object.keys(docTypes);
            if (keys.length) return keys.map((t) => String(t).toLowerCase());
          }
        } catch (_) {}
        return [];
      })();
      console.log('[Utils.resolveItemType] Available system types:', types);
      const typeSet = new Set(types);
      const raw = String(
        source?.type ?? source?.item_type ?? source?.category ?? ''
      )
        .trim()
        .toLowerCase();
      console.log('[Utils.resolveItemType] Raw type from source:', raw);
      if (raw && typeSet.has(raw)) {
        console.log(
          '[Utils.resolveItemType] Raw type is valid, returning:',
          raw
        );
        return raw;
      }

      // Helper: pick the first that exists in current system types
      const pick = (candidates) => {
        for (const c of candidates) {
          const t = String(c).toLowerCase();
          if (typeSet.has(t)) return t;
        }
        return null;
      };

      // Common normalizations and aliases across systems
      // Prefer system-specific types when available (e.g., PF2e uses 'treasure' instead of 'loot')
      const alias = pick(
        [
          // Loot-like
          raw.match(/loot|treasure|generic/) ? 'treasure' : null,
          // Equipment/armor/weapons
          raw.match(/^armor|^equipment/) ? 'equipment' : null,
          raw.match(/weapon/) ? 'weapon' : null,
          // Consumables
          raw.match(/consum/) ? 'consumable' : null,
          // Containers
          raw.match(/pack|bag|backpack/) ? 'backpack' : null,
          // Others
          raw.match(/feat|ability/) ? 'feat' : null,
          raw.match(/tool/) ? 'tool' : null,
          raw.match(/spell/) ? 'spell' : null,
        ].filter(Boolean)
      );
      if (alias) {
        console.log('[Utils.resolveItemType] Found alias match:', alias);
        return alias;
      }

      // As a final attempt, map generic buckets to something safe
      console.log(
        '[Utils.resolveItemType] No alias match, trying generic fallbacks...'
      );
      const generic = pick(['equipment', 'treasure', 'weapon', 'consumable']);
      if (generic) {
        console.log('[Utils.resolveItemType] Found generic fallback:', generic);
        return generic;
      }

      console.log(
        '[Utils.resolveItemType] No generic fallback, getting default type...'
      );
      const deflt = this.getDefaultItemType();
      console.log(
        '[Utils.resolveItemType] Default type:',
        deflt,
        'typeSet size:',
        typeSet.size
      );
      if (!typeSet.size || typeSet.has(deflt)) {
        console.log('[Utils.resolveItemType] Returning default:', deflt);
        return deflt;
      }
      const final = types[0] || deflt || 'equipment';
      console.log('[Utils.resolveItemType] Final fallback:', final);
      return final;
    } catch (e) {
      console.error('[Utils.resolveItemType] Exception, returning default:', e);
      return this.getDefaultItemType();
    }
  }
  /**
   * Convert HTML to Markdown (naive conversion: strip HTML tags, keep text)
   * @param {any} value - The value to convert
   * @returns {string} Plain text
   */
  static toMarkdownIfHtml(value) {
    const s = String(value ?? '');
    if (!s) return '';
    try {
      // Insert explicit newlines for common block elements before stripping tags
      let pre = s
        .replace(/\r\n/g, '\n')
        .replace(/<br\s*\/?>(?!\n)/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n\n')
        .replace(/<\/(div|section|article|header|footer|aside)\s*>/gi, '\n\n')
        .replace(/<li\b[^>]*>/gi, '\n• ')
        .replace(/<\/(h1|h2|h3|h4|h5|h6)\s*>/gi, '\n\n');
      const tmp = document.createElement('div');
      tmp.innerHTML = pre;
      let text = tmp.textContent || tmp.innerText || '';
      // Normalize multiple blank lines to at most two to create paragraphs
      text = text.replace(/\n{3,}/g, '\n\n');
      return text.trim();
    } catch (_) {
      return s;
    }
  }

  static firstPresent(...values) {
    for (const value of values) {
      if (value != null) return String(value);
    }
    return '';
  }

  /**
   * Resolve the prose body for an Archivist record.
   *
   * Field naming differs per type: compendium entities use `description`,
   * Sessions put their recap in `summary`, and Journals keep the body in
   * `content` with `summary` holding only a short blurb — so a single
   * `description || summary || content` chain imports a Journal's blurb as if
   * it were the whole entry. An explicit empty string is kept; only
   * absent/null fields fall through.
   *
   * @param {string} type Archivist record type ('Journal', 'Session', ...)
   * @param {object} row
   * @returns {string}
   */
  static archivistBodyText(type, row) {
    if (!row) return '';
    if (String(type) === 'Journal') {
      return this.firstPresent(row.content, row.description, row.summary);
    }
    return this.firstPresent(row.description, row.summary, row.content);
  }

  /**
   * Allow only http(s), mailto, and in-page fragments in fallback Markdown
   * links. The surrounding text is already HTML-escaped.
   * @param {string} href
   * @returns {string} original escaped href, or empty if rejected
   */
  static _safeMarkdownHref(href) {
    const raw = String(href ?? '').trim();
    if (!raw) return '';
    const decoded = raw.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|#)/i.test(decoded)) return raw;
    return '';
  }

  /**
   * Log messages with module prefix
   * @param {string} message - The message to log
   * @param {string} level - Log level (log, warn, error)
   */
  static log(message) {
    console.log(`${CONFIG.MODULE_TITLE} | ${message}`);
  }

  /**
   * Show notification to user
   * @param {string} message - The message to show
   * @param {string} type - Notification type (info, warn, error)
   */
  static notify(message, type = 'info') {
    ui.notifications[type](message);
  }

  /**
   * Get localized string
   * @param {string} key - The localization key
   * @param {object} data - Data for string interpolation
   * @returns {string} Localized string
   */
  static localize(key, data = {}) {
    return game.i18n.format(key, data);
  }

  /**
   * Convert Markdown to sanitized HTML suitable for storage in Actor/Item fields.
   * - Prefer a global MarkdownIt instance if available
   * - Fall back to a minimal converter for basic syntax
   * - Always sanitize with Foundry's TextEditor.cleanHTML
   * @param {string} markdown
   * @returns {string} sanitized HTML
   */
  /**
   * Scan a Markdown link/image destination starting right after its opening
   * `(`, honoring balanced inner parentheses (e.g.
   * `https://en.wikipedia.org/wiki/Foo_(bar)`) instead of stopping at the
   * first `)`. Also recognizes an optional `"title"` / `&quot;title&quot;`
   * segment, mirroring the destTitle grammar the old regex used.
   * @param {string} str Full inline text being scanned.
   * @param {number} start Index of the first destination character.
   * @returns {{href: string, title?: string, titleEsc?: string, end: number}|null}
   *   `end` is the index just past the closing `)`. Returns null when the
   *   destination is malformed (unterminated, empty, or missing `)`).
   */
  static _scanMarkdownDestination(str, start) {
    const len = str.length;
    let i = start;
    let href;
    if (str.startsWith('&lt;', start)) {
      const closeIdx = str.indexOf('&gt;', start + 4);
      if (closeIdx === -1) return null;
      href = str.slice(start + 4, closeIdx);
      if (!href || href.includes('&lt;')) return null;
      i = closeIdx + 4;
    } else {
      let depth = 0;
      while (i < len) {
        const ch = str[i];
        if (ch === '(') {
          depth += 1;
          i += 1;
          continue;
        }
        if (ch === ')') {
          if (depth === 0) break;
          depth -= 1;
          i += 1;
          continue;
        }
        if (/\s/.test(ch)) break;
        i += 1;
      }
      if (i === start) return null; // destination must be non-empty
      href = str.slice(start, i);
    }

    // Optional `\s+("title"|&quot;title&quot;)` — only consumed as a unit;
    // if it doesn't fully match, no whitespace is consumed and `)` must
    // follow the destination directly.
    let idx = i;
    let title;
    let titleEsc;
    let j = i;
    let sawSpace = false;
    while (j < len && /\s/.test(str[j])) {
      j += 1;
      sawSpace = true;
    }
    if (sawSpace && str[j] === '"') {
      const closeIdx = str.indexOf('"', j + 1);
      if (closeIdx !== -1) {
        title = str.slice(j + 1, closeIdx);
        idx = closeIdx + 1;
      }
    } else if (sawSpace && str.startsWith('&quot;', j)) {
      const closeIdx = str.indexOf('&quot;', j + 6);
      if (closeIdx !== -1) {
        titleEsc = str.slice(j + 6, closeIdx);
        idx = closeIdx + 6;
      }
    }

    if (str[idx] !== ')') return null;
    return { href, title, titleEsc, end: idx + 1 };
  }

  /**
   * Replace `![alt](dest "title")` or `[label](dest "title")` occurrences
   * with a parked `<img>`/`<a>` tag, using {@link _scanMarkdownDestination}
   * so a destination with balanced inner parentheses is captured in full
   * rather than truncated at the first `)`.
   * @param {string} str
   * @param {boolean} isImage
   * @param {(value: string) => string} park
   * @returns {string}
   */
  static _replaceMarkdownLinks(str, isImage, park) {
    const marker = isImage ? '![' : '[';
    let out = '';
    let i = 0;
    while (i < str.length) {
      const idx = str.indexOf(marker, i);
      if (idx === -1) {
        out += str.slice(i);
        break;
      }
      out += str.slice(i, idx);
      const labelStart = idx + marker.length;
      const labelEnd = this._scanMarkdownLabelEnd(str, labelStart);
      const validLabel = isImage
        ? labelEnd !== -1
        : labelEnd !== -1 && labelEnd > labelStart;
      if (!validLabel || str[labelEnd + 1] !== '(') {
        out += marker[0];
        i = idx + 1;
        continue;
      }
      const label = str.slice(labelStart, labelEnd);
      const dest = this._scanMarkdownDestination(str, labelEnd + 2);
      if (!dest) {
        out += marker[0];
        i = idx + 1;
        continue;
      }
      const safe = this._safeMarkdownHref(dest.href);
      if (!safe) {
        // Syntactically valid but disallowed href — keep the whole span
        // literal and resume scanning after it, matching how a failed
        // regex-callback substitution left the original text in place.
        out += str.slice(idx, dest.end);
        i = dest.end;
        continue;
      }
      const title = dest.title || dest.titleEsc;
      const titleAttr = title ? ' title="' + title + '"' : '';
      if (isImage) {
        out += park(
          '<img src="' + safe + '" alt="' + label + '"' + titleAttr + '>'
        );
      } else {
        // Link labels support the same emphasis syntax as surrounding inline
        // text. Existing parked code/escape tokens are restored after the
        // complete anchor is restored, so they remain isolated here.
        const renderedLabel = this._formatMarkdownInline(label);
        out += park(
          '<a href="' + safe + '"' + titleAttr + '>' + renderedLabel + '</a>'
        );
      }
      i = dest.end;
    }
    return out;
  }

  /** Find the closing bracket paired with a Markdown link/image label. */
  static _scanMarkdownLabelEnd(str, start) {
    let depth = 0;
    for (let i = start; i < str.length; i += 1) {
      if (str[i] === '[') {
        depth += 1;
      } else if (str[i] === ']') {
        if (depth === 0) return i;
        depth -= 1;
      }
    }
    return -1;
  }

  /** Apply the non-structural emphasis passes used by the inline fallback. */
  static _formatMarkdownInline(text) {
    return String(text ?? '')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/(?<!\w)[*_](?=\S)(.+?)(?<=\S)[*_](?!\w)/g, '<em>$1</em>');
  }

  /** Replace code spans whose opening and closing backtick runs match. */
  static _replaceMarkdownCodeSpans(str, park) {
    let out = '';
    let i = 0;
    while (i < str.length) {
      let openIdx = str.indexOf('`', i);
      while (openIdx !== -1) {
        let slashes = 0;
        for (let j = openIdx - 1; j >= 0 && str[j] === '\\'; j -= 1) {
          slashes += 1;
        }
        if (slashes % 2 === 0) break;
        openIdx = str.indexOf('`', openIdx + 1);
      }
      if (openIdx === -1) {
        out += str.slice(i);
        break;
      }
      out += str.slice(i, openIdx);
      let openEnd = openIdx;
      while (str[openEnd] === '`') openEnd += 1;
      const delimiterLength = openEnd - openIdx;

      let searchIdx = openEnd;
      let closeIdx = -1;
      let closeEnd = -1;
      while (searchIdx < str.length) {
        const candidate = str.indexOf('`', searchIdx);
        if (candidate === -1) break;
        let candidateEnd = candidate;
        while (str[candidateEnd] === '`') candidateEnd += 1;
        if (candidateEnd - candidate === delimiterLength) {
          closeIdx = candidate;
          closeEnd = candidateEnd;
          break;
        }
        searchIdx = candidateEnd;
      }

      if (closeIdx === -1) {
        out += str.slice(openIdx, openEnd);
        i = openEnd;
        continue;
      }
      out += park(
        '<code>' +
          foundry.utils.escapeHTML(str.slice(openEnd, closeIdx)) +
          '</code>'
      );
      i = closeEnd;
    }
    return out;
  }

  /**
   * Render inline markdown (emphasis, code, backslash escapes) to HTML.
   * Protects Markdown escapes before HTML encoding so escaped angle brackets
   * cannot be mistaken for autolinks.
   * @param {string} text
   * @returns {string}
   */
  static _renderMarkdownInline(text) {
    // Park backslash-escapes and code spans so later emphasis passes cannot
    // see their punctuation (code like **literal** in backticks stays literal).
    // Private-use delimiters keep ordinary journal text out of the restore pass.
    const parked = [];
    const park = (value) => '\uE000' + (parked.push(value) - 1) + '\uE001';
    const withoutCode = this._replaceMarkdownCodeSpans(
      String(text ?? ''),
      park
    );
    const protectedEscapes = withoutCode.replace(
      /\\([\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E])/g,
      (_m, ch) => park(foundry.utils.escapeHTML(ch))
    );
    const protectedReferences = protectedEscapes.replace(
      /&(?:#\d{1,7}|#x[\da-f]{1,6}|[a-z][a-z\d]{1,31});/gi,
      (reference) => park(reference)
    );
    const escaped = foundry.utils.escapeHTML(protectedReferences);
    const withoutImages = this._replaceMarkdownLinks(escaped, true, park);
    const withoutLinks = this._replaceMarkdownLinks(withoutImages, false, park);
    const withoutAutolinks = withoutLinks.replace(
      /&lt;([^\s<>]+?)&gt;/gi,
      (m, value) => {
        const isHttp = /^https?:\/\//i.test(value);
        const isMailto = /^mailto:/i.test(value);
        const isEmail = !isMailto && /^[^@\s<>]+@[^@\s<>]+$/.test(value);
        if (!isHttp && !isMailto && !isEmail) return m;
        const href = isEmail ? 'mailto:' + value : value;
        const safe = this._safeMarkdownHref(href);
        if (!safe) return m;
        const linkText = isEmail ? value : safe;
        return park('<a href="' + safe + '">' + linkText + '</a>');
      }
    );
    const formatted = this._formatMarkdownInline(withoutAutolinks);

    // Parked constructs may contain earlier tokens (for example a backslash
    // escape inside a code span or link). Restore until no token remains;
    // each token can only reference an earlier entry, so this is bounded by
    // the number of parked values and cannot cycle.
    const token = /\uE000(\d+)\uE001/g;
    let restored = formatted;
    for (let pass = 0; pass <= parked.length; pass += 1) {
      const next = restored.replace(token, (_m, i) => parked[Number(i)] ?? '');
      if (next === restored) break;
      restored = next;
    }
    return restored;
  }

  /**
   * Block-level markdown renderer used when no markdown-it global is present.
   * Covers the subset Archivist emits: ATX headings, bullet/ordered lists,
   * blockquotes, fenced code, horizontal rules and paragraphs. A
   * paragraph-only fallback rendered these as literal '# ' and '- ' text.
   * @param {string} markdown
   * @returns {string}
   */
  static _renderMarkdownFallback(markdown) {
    const lines = String(markdown ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    const out = [];
    let i = 0;

    const isBlank = (l) => !String(l).trim();
    // CommonMark-ish fence: 3+ backticks or tildes, optional info string
    // (`c++`, `objective-c`, ` ``` rust,ignore `). Must match isBlockStart or
    // the paragraph loop consumes nothing and the outer loop never advances.
    const fenceOpen = (l) => String(l).match(/^\s*([`~]{3,})(.*)$/);
    const isBlockStart = (l) =>
      /^\s*(?:#{1,6}\s|>)/.test(l) ||
      !!fenceOpen(l) ||
      /^\s*(?:[-*+]|\d+[.)])\s+/.test(l) ||
      /^\s*(?:[-*_]\s*){3,}$/.test(l);

    while (i < lines.length) {
      const line = lines[i];

      if (isBlank(line)) {
        i += 1;
        continue;
      }

      // Fenced code — verbatim, no inline processing.
      const fence = fenceOpen(line);
      if (fence) {
        const marker = fence[1][0];
        const fenceLen = fence[1].length;
        const info = String(fence[2] || '').trim().split(/\s+/)[0] || '';
        const isClose = (l) => {
          const m = String(l).match(/^\s*([`~]+)\s*$/);
          return !!(m && m[1][0] === marker && m[1].length >= fenceLen);
        };
        const body = [];
        i += 1;
        while (i < lines.length && !isClose(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1; // closing fence
        const lang = info.replace(/[^\w+#.-]/g, '');
        const cls = lang ? ' class="language-' + lang + '"' : '';
        out.push(
          '<pre><code' +
            cls +
            '>' +
            foundry.utils.escapeHTML(body.join('\n')) +
            '</code></pre>'
        );
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(
          '<h' +
            level +
            '>' +
            this._renderMarkdownInline(heading[2].trim()) +
            '</h' +
            level +
            '>'
        );
        i += 1;
        continue;
      }

      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          body.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push(
          '<blockquote>' +
            this._renderMarkdownFallback(body.join('\n')) +
            '</blockquote>'
        );
        continue;
      }

      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
        out.push(this._renderMarkdownList(lines, i, 0));
        i = this._lastListIndex;
        continue;
      }

      // Paragraph: accumulate until a blank line or the start of another block.
      // If a block-start form is not handled above, still advance so a future
      // syntax cannot freeze import/sync the way unmatched ```c++ did.
      const body = [];
      const paraStart = i;
      while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i === paraStart) i += 1;
      out.push(
        '<p>' +
          this._renderMarkdownInline(body.join('\n')).replace(/\n/g, '<br>') +
          '</p>'
      );
    }

    return out.join('');
  }

  /**
   * Render a (possibly nested) markdown list starting at `start`.
   * Sets `_lastListIndex` to the first line after the list.
   * @param {string[]} lines
   * @param {number} start
   * @param {number} depth
   * @returns {string}
   */
  static _renderMarkdownList(lines, start, depth) {
    let i = start;
    const first = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+/);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = [];

    // Guard against a malformed document nesting without end.
    if (depth > 8) {
      this._lastListIndex = i + 1;
      return '';
    }

    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m) {
        // Soft-wrapped item: indented text with no new marker stays in the
        // current <li>. A less-indented or blank line ends the list.
        const cont = String(lines[i]).match(/^(\s+)(\S.*)$/);
        if (
          items.length &&
          cont &&
          cont[1].length > baseIndent &&
          !/^\s*(?:#{1,6}\s|>|```|~~~)/.test(lines[i])
        ) {
          items[items.length - 1] +=
            '<br>' + this._renderMarkdownInline(cont[2].trim());
          i += 1;
          continue;
        }
        break;
      }
      const indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        // Nested list — fold it into the item just opened.
        const nested = this._renderMarkdownList(lines, i, depth + 1);
        i = this._lastListIndex;
        if (items.length) items[items.length - 1] += nested;
        else items.push(nested);
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      items.push(this._renderMarkdownInline(m[3].trim()));
      i += 1;
    }

    this._lastListIndex = i;
    const tag = ordered ? 'ol' : 'ul';
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const startAttr =
      ordered && Number.isFinite(startNum) && startNum !== 1
        ? ` start="${startNum}"`
        : '';
    return (
      '<' +
      tag +
      startAttr +
      '>' +
      items.map((it) => '<li>' + it + '</li>').join('') +
      '</' +
      tag +
      '>'
    );
  }

  /** Return only text that is outside complete HTML elements. */
  static _textOutsideHtmlElements(text) {
    const source = String(text ?? '').replace(/<!--[\s\S]*?-->/g, (comment) =>
      comment.replace(/[^\n]/g, '')
    );
    const voidTags = new Set([
      'area',
      'base',
      'br',
      'col',
      'embed',
      'hr',
      'img',
      'input',
      'link',
      'meta',
      'param',
      'source',
      'track',
      'wbr',
    ]);
    const tag = /<\/?([a-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const stack = [];
    let outside = '';
    let cursor = 0;
    for (const match of source.matchAll(tag)) {
      const between = source.slice(cursor, match.index);
      outside += stack.length ? between.replace(/[^\n]/g, '') : between;
      const name = match[1].toLowerCase();
      if (/^<\//.test(match[0])) {
        const openIdx = stack.lastIndexOf(name);
        if (openIdx !== -1) stack.length = openIdx;
      } else if (!voidTags.has(name) && !/\/\s*>$/.test(match[0])) {
        stack.push(name);
      }
      cursor = match.index + match[0].length;
    }
    const tail = source.slice(cursor);
    outside += stack.length ? tail.replace(/[^\n]/g, '') : tail;
    return outside;
  }

  /**
   * True for stored Foundry HTML, not for Markdown that happens to contain
   * angle brackets or an inline tag. `<https://example.com>` is a CommonMark
   * autolink, and `# Title` plus a `<span>` is still Markdown — both must go
   * through the renderer. The old `startsWith('<')` heuristic treated any
   * angle bracket as HTML, skipped rendering, and let cleanHTML drop it.
   * @param {string} text
   * @returns {boolean}
   */
  static looksLikeStoredHtml(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    const decoded = raw
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    const withoutAutolinks = decoded
      .replace(/<https?:\/\/[^>\s]+>/gi, ' ')
      .replace(/<mailto:[^>\s]+>/gi, ' ')
      .replace(/<[^\s<>]+@[^\s<>]+>/g, ' ');
    const outsideHtmlElements = this._textOutsideHtmlElements(withoutAutolinks);
    const hasMarkdownBlock = outsideHtmlElements
      .split('\n')
      .some((line) =>
        /^\s*(?:#{1,6}\s|>|(?:[-*+]|\d+[.)])\s+|[`~]{3,}|(?:[-*_]\s*){3,}\s*$)/.test(
          line
        )
      );
    if (hasMarkdownBlock) return false;
    const startsWithHtmlTag =
      /^\s*<\/?(?:p|div|span|br|hr|h[1-6]|ul|ol|li|pre|code|blockquote|strong|em|a|img|table|thead|tbody|tr|td|th|section|article|header|footer|main|aside|figure|figcaption)\b/i.test(
        withoutAutolinks
      );
    // Complete HTML elements (including pre/code contents) were removed before
    // checking for Markdown blocks, so a leading inline tag cannot conceal a
    // later heading, list, quote, rule, or fence.
    if (startsWithHtmlTag) return true;
    // Markdown with an incidental inline tag (`# Title` plus a <span>) must
    // still go through the renderer. A document that doesn't open with an
    // HTML tag is never treated as stored HTML, so it falls through here.
    return false;
  }

  static markdownToStoredHtml(markdown) {
    const md = String(markdown ?? '');
    try {
      if (this.looksLikeStoredHtml(md)) {
        return foundry?.utils?.TextEditor?.cleanHTML
          ? foundry.utils.TextEditor.cleanHTML(md)
          : md;
      }

      let rawHtml = '';
      const MarkdownItCtor = globalThis.MarkdownIt || window?.MarkdownIt;
      if (MarkdownItCtor) {
        const mdIt = new MarkdownItCtor({
          html: false,
          linkify: true,
          breaks: true,
        });
        rawHtml = mdIt.render(md);
      } else if (typeof globalThis.markdownit === 'function') {
        const mdIt = globalThis.markdownit({
          html: false,
          linkify: true,
          breaks: true,
        });
        rawHtml = mdIt.render(md);
      } else {
        // Minimal fallback for worlds where no markdown-it global exists. It has
        // to cover block syntax, not just paragraphs: Archivist journals use
        // headings and bullet lists, and a paragraph-only renderer emitted
        // those as literal '# ' and '- ' text.
        rawHtml = this._renderMarkdownFallback(md);
      }
      return foundry?.utils?.TextEditor?.cleanHTML
        ? foundry.utils.TextEditor.cleanHTML(rawHtml)
        : rawHtml;
    } catch (_) {
      return String(markdown || '');
    }
  }

  /**
   * Get current Foundry world information
   * @returns {object} World information object
   */
  static getFoundryWorldInfo() {
    return {
      id: game.world.id,
      title: game.world.title,
      description: game.world.description || 'No description',
    };
  }

  /**
   * Get character actors from the current world
   * @returns {Array} Array of character and NPC actors
   */
  static getCharacterActors() {
    return game.actors.contents.filter(
      (actor) => actor.type === 'character' || actor.type === 'npc'
    );
  }

  /**
   * Get journal entries that likely represent Factions (by folder name or flag)
   * @returns {Array<JournalEntry>}
   */
  static getFactionJournals() {
    const entries = game.journal?.contents || [];
    const factionFolder = this._findFolderByNameInsensitive(
      'Archivist - Factions'
    );
    return entries.filter((j) => {
      const flagged =
        j.getFlag(CONFIG.MODULE_ID, 'archivistType') === 'faction';
      const inFolder = factionFolder && j.folder?.id === factionFolder.id;
      return flagged || inFolder;
    });
  }

  /**
   * Get journal entries that likely represent Locations (by folder name or flag)
   * @returns {Array<JournalEntry>}
   */
  static getLocationJournals() {
    const entries = game.journal?.contents || [];
    const locationFolder = this._findFolderByNameInsensitive(
      'Archivist - Locations'
    );
    return entries.filter((j) => {
      const flagged =
        j.getFlag(CONFIG.MODULE_ID, 'archivistType') === 'location';
      const inFolder = locationFolder && j.folder?.id === locationFolder.id;
      return flagged || inFolder;
    });
  }

  /**
   * Find a folder by name (case-insensitive)
   * @param {string} name
   * @returns {Folder | undefined}
   */
  static _findFolderByNameInsensitive(name) {
    const folders = game.folders?.contents || [];
    return folders.find(
      (f) =>
        f.type === 'JournalEntry' &&
        f.name.toLowerCase() === String(name).toLowerCase()
    );
  }

  /**
   * Transform actor data for API synchronization
   * @param {Array} actors - Array of Foundry actor objects
   * @returns {Array} Array of transformed character data
   */
  static transformActorsForSync(actors) {
    return actors.map((actor) => {
      const desc = this.readActorDescription(actor);
      return {
        foundryId: actor.id,
        name: actor.name,
        type: actor.type,
        description: desc,
        level: actor.system?.details?.level || 1,
        race: actor.system?.details?.race || '',
        class: actor.system?.details?.class || '',
      };
    });
  }

  /**
   * Build Archivist Character payload from a Foundry Actor
   * @param {Actor} actor
   * @param {string} worldId
   */
  static toApiCharacterPayload(actor, worldId) {
    const isPC = actor.type === 'character';
    const sysId = this.getSystemId();
    const description = this.readActorDescription(actor);
    try {
      console.log('[Utils.toApiCharacterPayload] Built description for actor', {
        system: sysId,
        actorId: actor?.id,
        actorName: actor?.name,
        actorType: actor?.type,
        descriptionLength: String(description || '').length,
      });
    } catch (_) {}
    return {
      character_name: actor.name,
      player_name: actor?.system?.details?.player || '',
      description,
      type: isPC ? 'PC' : 'NPC',
      campaign_id: worldId,
    };
  }

  /**
   * Build Archivist Faction payload from a JournalEntry
   * @param {JournalEntry} journal
   * @param {string} worldId
   */
  static toApiFactionPayload(journal, worldId) {
    const raw = String(journal?.img || '').trim();
    const image = raw.startsWith('https://') ? raw : undefined;
    const text = this._extractJournalText(journal);
    // Strip leading image since we set it as a separate property
    const cleanedText = this.stripLeadingImage(text);
    return {
      name: journal.name,
      // Journal pages store HTML — convert to Markdown for API
      description: this.toMarkdownIfHtml(cleanedText),
      ...(image ? { image } : {}),
      campaign_id: worldId,
    };
  }

  /**
   * Build Archivist Location payload from a JournalEntry
   * @param {JournalEntry} journal
   * @param {string} worldId
   */
  static toApiLocationPayload(journal, worldId) {
    const raw = String(journal?.img || '').trim();
    const image = raw.startsWith('https://') ? raw : undefined;
    const text = this._extractJournalText(journal);
    // Strip leading image since we set it as a separate property
    const cleanedText = this.stripLeadingImage(text);
    return {
      name: journal.name,
      description: this.toMarkdownIfHtml(cleanedText),
      ...(image ? { image } : {}),
      campaign_id: worldId,
    };
  }

  /**
   * Extract text content from a JournalEntry (first text page)
   * @param {JournalEntry} journal
   * @returns {string}
   */
  static _extractJournalText(journal) {
    const pages = journal.pages?.contents || journal.pages || [];
    const textPage = pages.find((p) => p.type === 'text');
    // Foundry v10+ stores text in page.text.content
    return textPage?.text?.content || journal.content || '';
  }

  /**
   * Remove a single leading image from Markdown or HTML at the top of text.
   * Handles patterns like: \n![alt](url)\n, <img ...>, or wrapped in <p>.
   * @param {string} text
   * @returns {string}
   */
  static stripLeadingImage(text) {
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
   * Ensure a journal has a single primary text page with provided content.
   * Works across Foundry versions (v10+ with pages collection).
   * @param {JournalEntry} journal
   * @param {string} content
   */
  static async ensureJournalTextPage(journal, content) {
    // v10+ API: JournalEntryPage documents under journal.pages
    const pagesCollection = journal.pages;
    const safeContent = String(content ?? '');
    const isProbablyHtml = this.looksLikeStoredHtml(safeContent);

    console.log(`[Utils] ensureJournalTextPage:`, {
      journalId: journal?.id,
      journalName: journal?.name,
      contentLength: safeContent.length,
      contentPreview: safeContent.substring(0, 100),
    });

    if (pagesCollection) {
      const pages =
        pagesCollection.contents ??
        (Array.isArray(pagesCollection) ? pagesCollection : []);
      const textPage = pages.find((p) => p.type === 'text');
      if (textPage) {
        if (isProbablyHtml) {
          await textPage.update({ text: { content: safeContent, format: 1 } });
        } else {
          await textPage.update({ text: { markdown: safeContent, format: 2 } });
        }
      } else {
        if (isProbablyHtml) {
          await journal.createEmbeddedDocuments('JournalEntryPage', [
            {
              name: 'Description',
              type: 'text',
              text: { content: safeContent, format: 1 },
            },
          ]);
        } else {
          await journal.createEmbeddedDocuments('JournalEntryPage', [
            {
              name: 'Description',
              type: 'text',
              text: { markdown: safeContent, format: 2 },
            },
          ]);
        }
      }
      return;
    }
    // Fallback (older Foundry versions) — use JournalEntry content
    await journal.update({ content: safeContent });
  }

  /**
   * Set a journal's thumbnail image (img property) to the provided URL.
   * Does not modify journal content or pages.
   * @param {JournalEntry} journal
   * @param {string} imageUrl
   */
  static async ensureJournalLeadImage(journal, imageUrl) {
    try {
      const url = String(imageUrl || '').trim();
      if (!url) return;
      console.debug('[Archivist Sync] ensureJournalLeadImage()', {
        journalId: journal?.id,
        url,
      });
      // Set the journal thumbnail so it shows in lists
      try {
        await journal.update({ img: url });
      } catch (e) {
        console.debug('[Archivist Sync] journal img update failed', e);
      }
    } catch (e) {
      console.warn('[Archivist Sync] Failed to set journal lead image:', e);
    }
  }

  /**
   * Flags helpers for mapping Archivist IDs
   */
  static getActorArchivistId(actor) {
    return actor.getFlag(CONFIG.MODULE_ID, 'archivistId');
  }

  static async setActorArchivistId(actor, id, worldId) {
    await actor.setFlag(CONFIG.MODULE_ID, 'archivistId', id);
    if (worldId)
      await actor.setFlag(CONFIG.MODULE_ID, 'archivistWorldId', worldId);
    return true;
  }

  static getJournalArchivistMeta(journal) {
    return {
      id: journal.getFlag(CONFIG.MODULE_ID, 'archivistId') || null,
      type: journal.getFlag(CONFIG.MODULE_ID, 'archivistType') || null,
      worldId: journal.getFlag(CONFIG.MODULE_ID, 'archivistWorldId') || null,
    };
  }

  static async setJournalArchivistMeta(journal, id, type, worldId) {
    await journal.setFlag(CONFIG.MODULE_ID, 'archivistId', id);
    if (type) await journal.setFlag(CONFIG.MODULE_ID, 'archivistType', type);
    if (worldId)
      await journal.setFlag(CONFIG.MODULE_ID, 'archivistWorldId', worldId);
  }

  /**
   * Get Archivist metadata from a JournalEntryPage
   * @param {JournalEntryPage} page
   */
  static getPageArchivistMeta(page) {
    return {
      id: page?.getFlag?.(CONFIG.MODULE_ID, 'archivistId') || null,
      type: page?.getFlag?.(CONFIG.MODULE_ID, 'archivistType') || null,
      worldId: page?.getFlag?.(CONFIG.MODULE_ID, 'archivistWorldId') || null,
    };
  }

  /**
   * Set Archivist metadata on a JournalEntryPage
   * @param {JournalEntryPage} page
   * @param {string} id
   * @param {string} type
   * @param {string} worldId
   */
  static async setPageArchivistMeta(page, id, type, worldId) {
    if (!page) return;
    if (id) await page.setFlag(CONFIG.MODULE_ID, 'archivistId', id);
    if (type) await page.setFlag(CONFIG.MODULE_ID, 'archivistType', type);
    if (worldId)
      await page.setFlag(CONFIG.MODULE_ID, 'archivistWorldId', worldId);
  }

  /**
   * Ensure a single root-level JournalEntry exists as a container
   * @param {string} name
   * @returns {Promise<JournalEntry>}
   */
  static async ensureRootJournalContainer(name) {
    const journals = game.journal?.contents || [];
    let j = journals.find((x) => x.name === name && !x.folder);
    if (j) return j;
    j = await JournalEntry.create(
      { name, folder: null, pages: [] },
      { render: false }
    );
    return j;
  }

  /**
   * Create or update a text page within a container journal
   * Returns the page document. If creating multiple, call with items pre-sorted, as creation order defines index.
   * @param {JournalEntry} container
   * @param {object} opts { name, html, imageUrl, flags }
   */
  static async upsertContainerTextPage(
    container,
    { name, html, imageUrl, flags } = {}
  ) {
    const pages = container.pages?.contents || [];
    // Prefer matching by Archivist ID if provided via flags
    let page = null;
    if (flags?.archivistId) {
      page = pages.find(
        (p) => this.getPageArchivistMeta(p).id === flags.archivistId
      );
    }
    if (!page) page = pages.find((p) => p.name === name && p.type === 'text');
    const baseMd = String(html || '');
    if (page) {
      await page.update({
        name,
        type: 'text',
        text: { content: baseMd, markdown: baseMd, format: 2 },
      });
    } else {
      const created = await container.createEmbeddedDocuments(
        'JournalEntryPage',
        [
          {
            name,
            type: 'text',
            text: { content: baseMd, markdown: baseMd, format: 2 },
          },
        ]
      );
      page = created?.[0] || null;
    }
    if (page && flags) {
      await this.setPageArchivistMeta(
        page,
        flags.archivistId,
        flags.archivistType,
        flags.archivistWorldId
      );
    }
    return page;
  }

  /**
   * Sort pages within a container using comparator over page docs
   * Applies increasing sort values to match comparator order.
   * @param {JournalEntry} container
   * @param {(a: JournalEntryPage, b: JournalEntryPage) => number} comparator
   */
  static async sortContainerPages(container, comparator) {
    const pages = (container.pages?.contents || []).slice().sort(comparator);
    let sort = 0;
    const updates = pages.map((p) => ({ _id: p.id, sort: (sort += 100) }));
    if (updates.length)
      await container.updateEmbeddedDocuments('JournalEntryPage', updates);
  }

  /**
   * Extract HTML text content from a JournalEntryPage
   * @param {JournalEntryPage} page
   */
  static extractPageHtml(page) {
    if (!page) return '';
    if (page.type === 'text') {
      const fmt = Number(page?.text?.format ?? 0);
      const md = page?.text?.markdown;
      if (fmt === 2 && typeof md === 'string') return String(md);
      return String(page?.text?.content || md || '');
    }
    return '';
  }

  /**
   * Validate API key format
   * @param {string} apiKey - The API key to validate
   * @returns {boolean} True if API key appears valid
   */
  static validateApiKey(apiKey) {
    return apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0;
  }

  /**
   * Safely parse JSON response
   * @param {string} jsonString - JSON string to parse
   * @returns {object|null} Parsed object or null if parsing fails
   */
  static safeJsonParse(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      this.log(`Failed to parse JSON: ${error.message}`, 'warn');
      return null;
    }
  }

  /**
   * Debounce function to limit rapid successive calls
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @param {boolean} immediate - Whether to trigger on leading edge
   * @returns {Function} Debounced function
   */
  static debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func.apply(this, args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(this, args);
    };
  }

  /**
   * Check if user is a GM
   * @returns {boolean} True if current user is a GM
   */
  static isGM() {
    return game.user.isGM;
  }

  /**
   * Ensure a folder exists for JournalEntries by name; returns folder id or null
   * @param {string} name
   * @param {object} options - Optional folder configuration
   * @param {string} options.sorting - Folder sorting mode: "m" (manual by sort field), "a" (alphabetical)
   */
  static async ensureJournalFolder(name, options = {}) {
    const existing = this._findFolderByNameInsensitive(name);
    if (existing) {
      // Update sorting if specified and different
      if (options.sorting && existing.sorting !== options.sorting) {
        await existing.update({ sorting: options.sorting });
      }
      return existing.id;
    }
    const folderData = { name, type: 'JournalEntry' };
    if (options.sorting) {
      folderData.sorting = options.sorting;
    }
    const created = await Folder.create(folderData);
    return created?.id || null;
  }

  /** Ensure top-level organized folders exist for Archivist types */
  static async ensureArchivistFolders() {
    try {
      const folders = {
        pc: 'Archivist - PCs',
        npc: 'Archivist - NPCs',
        item: 'Archivist - Items',
        location: 'Archivist - Locations',
        faction: 'Archivist - Factions',
        journal: 'Archivist - Journals',
        quest: 'Archivist - Quests',
      };

      console.log(
        '[Archivist Sync] Ensuring organized folders:',
        Object.values(folders)
      );
      for (const name of Object.values(folders)) {
        await this.ensureJournalFolder(name);
      }
    } catch (e) {
      console.warn('[Archivist Sync] ensureArchivistFolders failed:', e);
    }
  }

  /** Get the organized folder for a given Archivist sheet type */
  static getArchivistFolder(type) {
    try {
      console.log('[Archivist Sync] getArchivistFolder called:', {
        type,
      });

      const map = {
        pc: 'Archivist - PCs',
        npc: 'Archivist - NPCs',
        item: 'Archivist - Items',
        location: 'Archivist - Locations',
        faction: 'Archivist - Factions',
        journal: 'Archivist - Journals',
        quest: 'Archivist - Quests',
      };
      const name = map[String(type || '').toLowerCase()];

      if (!name) {
        console.log('[Archivist Sync] No folder name mapped for type:', type);
        return null;
      }

      const folders = game.folders?.contents || [];
      const found =
        folders.find((f) => f.type === 'JournalEntry' && f.name === name) ||
        null;

      console.log('[Archivist Sync] Folder lookup result:', {
        searchingFor: name,
        found: found?.name || 'none',
        foundId: found?.id || 'none',
      });

      return found;
    } catch (e) {
      console.warn('[Archivist Sync] getArchivistFolder failed:', e);
      return null;
    }
  }

  /** Move a JournalEntry into its organized folder based on flags.archivist.sheetType */
  static async moveJournalToTypeFolder(journal) {
    try {
      const flags = journal.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
      const type = String(flags.sheetType || '').toLowerCase();
      const folder = this.getArchivistFolder(type);
      if (!folder) return false;
      if (journal.folder?.id === folder.id) return false;
      await journal.update({ folder: folder.id });
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Registered ApplicationV2 sheet classes by Archivist sheet type */
  static ARCHIVIST_SHEET_CLASS_MAP = {
    pc: 'archivist-sync.PCPageSheetV2',
    npc: 'archivist-sync.NPCPageSheetV2',
    item: 'archivist-sync.ItemPageSheetV2',
    location: 'archivist-sync.LocationPageSheetV2',
    faction: 'archivist-sync.FactionPageSheetV2',
    recap: 'archivist-sync.RecapPageSheetV2',
    journal: 'archivist-sync.JournalPageSheetV2',
    quest: 'archivist-sync.QuestPageSheetV2',
  };

  /**
   * Normalize quest progress log arrays from API response shapes.
   * @param {object} q
   * @returns {Array|null} null when the source row omitted progress log fields
   */
  static _normalizeQuestProgressLog(q) {
    if (!q) return null;
    if (Array.isArray(q.progressLog)) return q.progressLog;
    if (Array.isArray(q.progress_log)) return q.progress_log;
    if (Array.isArray(q.progressLogEntries)) {
      return q.progressLogEntries.map((e) =>
        typeof e === 'string' ? e : e.text || ''
      );
    }
    if (Array.isArray(q.progress_log_entries)) {
      return q.progress_log_entries.map((e) =>
        typeof e === 'string' ? e : e.text || ''
      );
    }
    return null;
  }

  /**
   * Build the flags.archivist.questData shape from an Archivist quest row.
   * Array fields are only overwritten when the source row actually provides them.
   * @param {object} fullQuest
   * @param {object} [existing={}]
   * @returns {object}
   */
  static buildQuestDataFromApi(fullQuest, existing = {}) {
    const q = fullQuest || {};
    const data = { ...(existing || {}) };

    data.questName = q.questName ?? q.quest_name ?? data.questName ?? '';
    data.questGiver = q.questGiver ?? q.quest_giver ?? data.questGiver ?? '';
    data.questCategory =
      q.questCategory ?? q.quest_category ?? data.questCategory ?? 'n/a';
    data.status = q.status ?? data.status ?? 'planned';
    data.successDefinition =
      q.successDefinition ?? q.success_definition ?? data.successDefinition ?? '';
    data.failureConditions =
      q.failureConditions ?? q.failure_conditions ?? data.failureConditions ?? '';
    data.nextAction = q.nextAction ?? q.next_action ?? data.nextAction ?? '';
    data.resolution = q.resolution ?? data.resolution ?? '';

    const progressLog = Utils._normalizeQuestProgressLog(q);
    if (progressLog !== null) data.progressLog = progressLog;

    const arrayFields = [
      ['objectives', 'objectives'],
      ['relatedCharacters', 'related_characters'],
      ['relatedFactions', 'related_factions'],
      ['relatedLocations', 'related_locations'],
      ['relatedItems', 'related_items'],
      ['relatedEntityRefs', 'related_entity_refs'],
    ];
    for (const [camel, snake] of arrayFields) {
      const src = q[camel] ?? q[snake];
      if (Array.isArray(src)) data[camel] = src;
      else if (!(camel in data)) data[camel] = [];
    }

    if (q.firstSession !== undefined || q.first_session !== undefined) {
      data.firstSession = q.firstSession ?? q.first_session ?? null;
    } else if (!('firstSession' in data)) {
      data.firstSession = null;
    }
    if (q.lastSession !== undefined || q.last_session !== undefined) {
      data.lastSession = q.lastSession ?? q.last_session ?? null;
    } else if (!('lastSession' in data)) {
      data.lastSession = null;
    }

    return data;
  }

  /** Create a custom sheet JournalEntry for an imported Archivist entity */
  /**
   * Find the JournalEntry that represents a given Archivist record, if any.
   * @param {string} archivistId
   * @returns {JournalEntry|null}
   */
  static findJournalByArchivistId(archivistId) {
    const wanted = String(archivistId || '');
    if (!wanted) return null;
    try {
      for (const j of game.journal?.contents || []) {
        const flags = j.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
        if (String(flags.archivistId || '') === wanted) return j;
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  /** Find a legacy JournalEntryPage representation of an Archivist record. */
  static findJournalPageByArchivistId(archivistId) {
    const wanted = String(archivistId || '');
    if (!wanted) return null;
    try {
      for (const journal of game.journal?.contents || []) {
        for (const page of journal.pages?.contents || []) {
          if (String(this.getPageArchivistMeta(page).id || '') === wanted) {
            return page;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  /**
   * True if this journal or any of its pages represents the Archivist record.
   * Legacy location/faction imports lived as JournalEntryPages; a standalone
   * sheet delete must not treat those pages as absent.
   * @param {JournalEntry} journal
   * @param {string} archivistId
   * @returns {boolean}
   */
  static journalReferencesArchivistId(journal, archivistId) {
    const wanted = String(archivistId || '');
    if (!wanted || !journal) return false;
    try {
      const flags = journal.getFlag?.(CONFIG.MODULE_ID, 'archivist') || {};
      if (String(flags.archivistId || '') === wanted) return true;
      for (const page of journal.pages?.contents || []) {
        if (String(this.getPageArchivistMeta(page).id || '') === wanted)
          return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  /** True if any linked Actor, Item, or Scene still references this record. */
  static coreDocumentReferencesArchivistId(archivistId) {
    const wanted = String(archivistId || '');
    if (!wanted) return false;
    try {
      for (const collection of [game.actors, game.items, game.scenes]) {
        for (const doc of collection?.contents || []) {
          const id = doc?.getFlag?.(CONFIG.MODULE_ID, 'archivistId');
          if (String(id || '') === wanted) return true;
        }
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  static async createCustomJournalForImport({
    name,
    html = '',
    imageUrl,
    sheetType,
    archivistId,
    worldId,
    folderId,
    sort,
  }) {
    try {
      console.log(`[Archivist Sync] createCustomJournalForImport called:`, {
        name,
        sheetType,
        archivistId,
        providedFolderId: folderId,
        sort,
      });

      await this.ensureArchivistFolders();
      const folder = this.getArchivistFolder(sheetType);
      const normalizedType = String(sheetType || '').toLowerCase();
      const sheetClass = Utils.ARCHIVIST_SHEET_CLASS_MAP[normalizedType] || '';

      console.log(`[Archivist Sync] Folder lookup results:`, {
        sheetType,
        foundFolder: folder?.name || 'none',
        foundFolderId: folder?.id || 'none',
        providedFolderId: folderId || 'none',
        willUseFolderId: folderId || folder?.id || 'none (root)',
      });

      const targetFolderId = folderId || folder?.id || null;

      // An Archivist id identifies exactly one sheet. Re-running World Setup
      // used to create a second JournalEntry for every record it had already
      // imported, and because both copies carried the same archivistId,
      // deleting either duplicate cascaded a delete of the shared Archivist
      // record. Adopt the existing sheet instead of creating a rival.
      const existing = archivistId
        ? this.findJournalByArchivistId(archivistId)
        : null;
      if (existing) {
        console.log('[Archivist Sync] Reusing existing journal for import:', {
          journalId: existing.id,
          archivistId,
          sheetType: normalizedType,
        });
        const updates = {};
        if (name && existing.name !== name) updates.name = name;
        // `imageUrl === undefined` means the caller omitted it. null/'' means
        // Archivist has no image and a reused sheet must drop the stale one.
        if (imageUrl !== undefined) {
          const nextImg = imageUrl || null;
          if (nextImg && existing.img !== nextImg) updates.img = nextImg;
          if (!nextImg && existing.img) updates.img = null;
        }
        if (typeof sort === 'number' && existing.sort !== sort) updates.sort = sort;
        if (targetFolderId && (existing.folder?.id || null) !== targetFolderId) {
          updates.folder = targetFolderId;
        }
        if (sheetClass) {
          const core = existing.flags?.core || {};
          if (core.sheetClass !== sheetClass || core.sheet !== sheetClass) {
            updates['flags.core.sheetClass'] = sheetClass;
            updates['flags.core.sheet'] = sheetClass;
          }
        }
        if (Object.keys(updates).length) {
          await existing.update(updates, { render: false });
        }
        await this.ensureJournalTextPage(existing, html);
        const priorFlags = existing.getFlag(CONFIG.MODULE_ID, 'archivist') || {};
        await existing.setFlag(CONFIG.MODULE_ID, 'archivist', {
          ...priorFlags,
          sheetType: normalizedType,
          archivistId,
          archivistWorldId: worldId || priorFlags.archivistWorldId || null,
          image:
            imageUrl !== undefined ? imageUrl || null : priorFlags.image || null,
        });
        return existing;
      }

      // Legacy location/faction imports store the Archivist id on a page in
      // a shared journal. Treat that page as an existing import, but do not
      // repurpose its parent journal as a standalone custom sheet.
      const legacyPage = archivistId
        ? this.findJournalPageByArchivistId(archivistId)
        : null;
      const migrateLegacyPage =
        legacyPage && ['location', 'faction'].includes(normalizedType);
      if (legacyPage && !migrateLegacyPage) {
        console.log(
          '[Archivist Sync] Skipping standalone import; legacy journal page already represents record:',
          { pageId: legacyPage.id, archivistId, sheetType: normalizedType }
        );
        return null;
      }
      if (migrateLegacyPage) {
        console.log(
          '[Archivist Sync] Migrating legacy journal page to standalone sheet:',
          { pageId: legacyPage.id, archivistId, sheetType: normalizedType }
        );
      }

      const createData = {
        name,
        folder: targetFolderId,
        ...(imageUrl ? { img: imageUrl } : {}),
        ...(typeof sort === 'number' ? { sort } : {}),
        flags: {
          core: { sheetClass, sheet: sheetClass },
        },
      };

      const journal = await JournalEntry.create(createData, { render: false });

      console.log(`[Archivist Sync] Journal created:`, {
        journalId: journal.id,
        journalName: journal.name,
        assignedFolderId: targetFolderId,
        actualFolderId: journal.folder?.id || 'none (root)',
        actualFolderName: journal.folder?.name || 'none (root)',
      });

      await this.ensureJournalTextPage(journal, html);
      // Hub image flag removed
      await journal.setFlag(CONFIG.MODULE_ID, 'archivist', {
        sheetType: normalizedType,
        archivistId: archivistId || null,
        archivistWorldId: worldId || null,
        image: imageUrl || null,
        archivistRefs: {
          characters: [],
          items: [],
          entries: [],
          factions: [],
          locationsAssociative: [],
        },
        foundryRefs: { actors: [], items: [], scenes: [], journals: [] },
      });

      if (migrateLegacyPage) {
        try {
          // Clear the remote identity before deletion so realtime hooks do not
          // interpret this local representation migration as an Archivist delete.
          await legacyPage.unsetFlag(CONFIG.MODULE_ID, 'archivistId');
          await legacyPage.unsetFlag(CONFIG.MODULE_ID, 'archivistType');
          await legacyPage.unsetFlag(CONFIG.MODULE_ID, 'archivistWorldId');
          await legacyPage.delete();
        } catch (migrationError) {
          console.warn(
            '[Archivist Sync] Standalone sheet created, but legacy page cleanup failed:',
            migrationError
          );
        }
      }

      console.log(
        `[Archivist Sync] Journal finalized with flags, final location:`,
        {
          journalId: journal.id,
          folderId: journal.folder?.id || 'root',
          folderName: journal.folder?.name || 'root',
        }
      );

      return journal;
    } catch (e) {
      console.warn('[Archivist Sync] createCustomJournalForImport failed', e);
      return null;
    }
  }

  /** Create a new Archivist journal with flags and initial text page */
  static async createArchivistJournal({
    name,
    sheetType,
    archivistId,
    worldId,
    folderName,
    text = '',
    sort,
  }) {
    const folder = folderName
      ? await this.ensureJournalFolder(folderName)
      : null;
    const normalizedType = String(sheetType || '').toLowerCase();
    const sheetClass = Utils.ARCHIVIST_SHEET_CLASS_MAP[normalizedType] || '';
    // Provide our archivist flags at creation so createJournalEntry hook can POST immediately
    const initialArchivistFlags = {
      sheetType: normalizedType,
      archivistId: archivistId || null,
      archivistWorldId: worldId || null,
      archivistRefs: {
        characters: [],
        items: [],
        entries: [],
        factions: [],
        locationsAssociative: [],
      },
      foundryRefs: { actors: [], items: [], scenes: [], journals: [] },
    };
    const createData = {
      name,
      folder,
      ...(typeof sort === 'number' ? { sort } : {}),
      flags: {
        core: { sheetClass, sheet: sheetClass },
        [CONFIG.MODULE_ID]: { archivist: initialArchivistFlags },
      },
    };
    const journal = await JournalEntry.create(createData, { render: false });
    await this.ensureJournalTextPage(journal, text);
    // Flags were provided at creation; no need to set again here
    return journal;
  }

  static createPcJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'pc',
      folderName: 'Archivist - PCs',
    });
  }
  static createNpcJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'npc',
      folderName: 'Archivist - NPCs',
    });
  }
  static createItemJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'item',
      folderName: 'Archivist - Items',
    });
  }
  static createLocationJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'location',
      folderName: 'Archivist - Locations',
    });
  }
  static createFactionJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'faction',
      folderName: 'Archivist - Factions',
    });
  }
  static createRecapJournal(opts) {
    return this.createArchivistJournal({
      ...opts,
      sheetType: 'recap',
      folderName: 'Recaps',
    });
  }

  /**
   * Deep clone an object
   * @param {object} obj - Object to clone
   * @returns {object} Cloned object
   */
  static deepClone(obj) {
    return foundry.utils.deepClone(obj);
  }

  /**
   * Merge objects using Foundry's utility
   * @param {object} original - Original object
   * @param {object} other - Object to merge
   * @returns {object} Merged object
   */
  static mergeObject(original, other) {
    return foundry.utils.mergeObject(original, other);
  }

  /**
   * Generate a random ID
   * @param {number} length - Length of the ID
   * @returns {string} Random ID string
   */
  static generateId(length = 8) {
    return foundry.utils.randomID(length);
  }

  /**
   * Format error message for display
   * @param {Error|string} error - Error object or message
   * @returns {string} Formatted error message
   */
  static formatError(error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Check if a string is empty or whitespace only
   * @param {string} str - String to check
   * @returns {boolean} True if string is empty or whitespace
   */
  static isEmpty(str) {
    return !str || str.trim().length === 0;
  }

  /**
   * Capitalize first letter of a string
   * @param {string} str - String to capitalize
   * @returns {string} Capitalized string
   */
  static capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
