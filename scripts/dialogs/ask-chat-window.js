import { CONFIG, SETTINGS } from '../modules/config.js';
import { settingsManager } from '../modules/settings-manager.js';
import { archivistApi } from '../services/archivist-api.js';
// Hub removed

/**
 * Standalone Archivist Chat window (per-user)
 * Stores each user's chat history by campaign and trims it when sending.
 */
export class AskChatWindow {
  constructor(options = {}) {
    this._messages = this._loadHistory();
    this._streamAbort = null;
    this._isStreaming = false;
    this._mountEl = null; // optional host element when embedding in sidebar
    this._md = null; // optional cached markdown parser instance
  }

  _loadHistory() {
    try {
      const enabled = !!game.settings.get(
        CONFIG.MODULE_ID,
        SETTINGS.CHAT_HISTORY_ENABLED.key
      );
      if (!enabled) return [];
      const history = game.settings.get(
        CONFIG.MODULE_ID,
        SETTINGS.USER_CHAT_HISTORY.key
      );
      const campaign = this._historyCampaign();
      // An empty array is intentional after a user clears their history.
      if (Array.isArray(history?.[campaign])) return history[campaign];
      const raw =
        game.settings.get(CONFIG.MODULE_ID, SETTINGS.CHAT_HISTORY.key) || '{}';
      const byUser = JSON.parse(raw);
      const key = this._historyKey();
      return Array.isArray(byUser[key]) ? byUser[key] : [];
    } catch (_) {
      return [];
    }
  }

  async _saveHistory() {
    try {
      const enabled = !!game.settings.get(
        CONFIG.MODULE_ID,
        SETTINGS.CHAT_HISTORY_ENABLED.key
      );
      if (!enabled) return;
      const history = game.settings.get(
        CONFIG.MODULE_ID,
        SETTINGS.USER_CHAT_HISTORY.key
      );
      await game.settings.set(
        CONFIG.MODULE_ID,
        SETTINGS.USER_CHAT_HISTORY.key,
        { ...history, [this._historyCampaign()]: this._messages.slice(-40) }
      );
    } catch (e) {
      console.warn('[Archivist Sync] Failed saving chat history', e);
    }
  }

  _historyKey() {
    const uid = game.user?.id || 'anon';
    return `${uid}:${this._historyCampaign()}`;
  }

  _historyCampaign() {
    return settingsManager.getSelectedWorldId() || 'no-world';
  }

  async getData() {
    try {
      console.log('[Archivist Sync][AskChatWindow] getData()', {
        messages: this._messages?.length ?? 0,
        isStreaming: this._isStreaming,
      });
    } catch (_) {}
    // Markdown → HTML → Foundry enrichHTML for assistant messages
    const enriched = [];
    for (const m of this._messages) {
      if (m.role === 'assistant' && !m.typing) {
        const html = await this._enrichMarkdown(String(m.content ?? ''));
        enriched.push({ ...m, html });
      } else {
        enriched.push(m);
      }
    }
    return {
      messages: enriched,
      isStreaming: this._isStreaming,
      placeholder: game.i18n.localize('ARCHIVIST_SYNC.chat.placeholder'),
    };
  }

  /**
   * Convert Markdown text to enriched, sanitized HTML using a tiny local pipeline.
   * Prefers markdown-it, falls back to marked, else a minimal formatter.
   * @param {string} markdown
   * @returns {Promise<string>} enriched HTML string safe to inject
   */
  async _enrichMarkdown(markdown) {
    const TextEditorImpl =
      foundry?.applications?.ux?.TextEditor?.implementation ||
      globalThis.TextEditor;
    // Initialize parser once if available
    if (!this._md && globalThis.markdownit) {
      try {
        this._md = globalThis.markdownit({ linkify: true, breaks: true });
      } catch (_) {
        this._md = null;
      }
    }
    const mdToHtml = (src) => {
      const s = String(src ?? '');
      if (this._md) return this._md.render(s);
      if (globalThis.marked?.parse) return globalThis.marked.parse(s);
      // Minimal fallback: images and links, code, and line breaks
      let out = s
        .replace(
          /```([\s\S]*?)```/g,
          (m, code) =>
            `<pre><code>${foundry.utils.escapeHTML(code)}</code></pre>`
        ) // fenced code
        .replace(
          /`([^`]+)`/g,
          (m, code) => `<code>${foundry.utils.escapeHTML(code)}</code>`
        ) // inline code
        // Images: allow optional whitespace/newline between ] and (
        .replace(/!\[([^\]]*)\]\s*\(([^)]+)\)/gm, (m, alt, inside) => {
          let url = inside.trim();
          let title = '';
          const titleMatch = url.match(/^(\S+)(?:\s+\"([^\"]+)\")?$/);
          if (titleMatch) {
            url = titleMatch[1];
            title = titleMatch[2] || '';
          }
          return `<img src="${foundry.utils.escapeHTML(url)}" alt="${foundry.utils.escapeHTML(alt || '')}"${title ? ` title="${foundry.utils.escapeHTML(title)}"` : ''}>`;
        })
        // Links: allow optional whitespace/newline between ] and (
        .replace(
          /\[([^\]]+)\]\s*\(([^)]+)\)/gm,
          (m, text, url) =>
            `<a href="${foundry.utils.escapeHTML(url.trim())}">${foundry.utils.escapeHTML(text)}</a>`
        ); // links
      // Simple lists
      out = out.replace(/(?:^|\n)([-*+]\s.+(?:\n[-*+]\s.+)*)/g, (m, list) => {
        const items = list
          .split(/\n/)
          .map((l) => l.replace(/^[-*+]\s+/, ''))
          .map((li) => `<li>${li}</li>`)
          .join('');
        return `\n<ul>${items}</ul>`;
      });
      return out.replaceAll('\n', '<br/>');
    };
    const rawHtml = mdToHtml(markdown);
    return await TextEditorImpl.enrichHTML(rawHtml, { async: true });
  }

  activateListeners(html) {
    const root = html?.[0] ?? html ?? this._mountEl; // support jQuery or HTMLElement or mounted host
    const form = root?.querySelector?.('.ask-form');
    const input = root?.querySelector?.('.ask-input');
    const clearBtn = root?.querySelector?.('.chat-clear-btn');
    // Hub removed
    const handleCopyClick = async (e) => {
      const btn = e.target?.closest?.('.copy-btn');
      if (!btn) return;
      e.preventDefault();
      try {
        const msg = btn.closest('.msg');
        const bubble = msg?.querySelector?.('.bubble');
        const text = bubble?.innerText || bubble?.textContent || '';
        if (text) {
          await navigator.clipboard?.writeText?.(text);
          ui.notifications?.info?.(
            game.i18n.localize('ARCHIVIST_SYNC.chat.copied') || 'Copied'
          );
        }
      } catch (err) {
        console.warn('[Archivist Sync] Copy failed', err);
      }
    };
    root?.addEventListener?.('click', handleCopyClick);
    // Submit on Enter, newline on Shift+Enter within the composer
    const handleComposerKeydown = (e) => {
      try {
        if (!e) return;
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          const text = input?.value?.trim();
          if (!text) return;
          if (form?.requestSubmit) {
            form.requestSubmit();
          } else {
            form?.dispatchEvent(
              new Event('submit', { cancelable: true, bubbles: true })
            );
          }
        }
      } catch (_) {
        /* no-op */
      }
    };
    input?.addEventListener?.('keydown', handleComposerKeydown);
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input?.value?.trim();
      if (text) {
        this._onSend(text);
        if (input) input.value = '';
      }
    });

    clearBtn?.addEventListener('click', async () => {
      let ok = false;
      try {
        const DialogV2 = foundry?.applications?.api?.DialogV2;
        ok = await DialogV2.confirm({
          header: game.i18n.localize('ARCHIVIST_SYNC.chat.clear'),
          content: `<p>${game.i18n.localize('ARCHIVIST_SYNC.chat.clearConfirm')}</p>`,
          yes: { label: game.i18n.localize('Yes') || 'Yes' },
          no: { label: game.i18n.localize('No') || 'No' },
          modal: true,
        });
      } catch (e) {
        console.warn(
          '[Archivist Sync] Dialog confirm failed, defaulting to cancel',
          e
        );
        ok = false;
      }
      if (!ok) return;
      this._messages = [];
      this._saveHistory();
      this.render(false);
    });

    // No hub button handler
  }

  async render(_force) {
    try {
      console.log('[Archivist Sync][AskChatWindow] render()', {
        hasMount: !!this._mountEl,
      });
    } catch (_) {}
    if (!this._mountEl) return;
    const data = await this.getData();
    const html = await foundry.applications.handlebars.renderTemplate(
      'modules/archivist-sync/templates/ask-chat-window.hbs',
      data
    );
    this._mountEl.innerHTML = html;
    this.activateListeners(this._mountEl);
    try {
      const msgList = this._mountEl.querySelector?.('.messages');
      if (msgList) msgList.scrollTop = msgList.scrollHeight;
      console.log('[Archivist Sync][AskChatWindow] render() complete');
    } catch (_) {}
  }

  async _onSend(text) {
    if (!settingsManager.isApiConfigured()) {
      return ui.notifications?.warn(
        game.i18n.localize('ARCHIVIST_SYNC.chat.noApi')
      );
    }
    if (!settingsManager.isWorldSelected()) {
      return ui.notifications?.warn(
        game.i18n.localize('ARCHIVIST_SYNC.chat.noWorld')
      );
    }
    if (!settingsManager.isWorldInitialized()) {
      return ui.notifications?.warn(
        game.i18n.localize('ARCHIVIST_SYNC.chat.notInitialized')
      );
    }

    const userMsg = { role: 'user', content: text, from: 'me', at: Date.now() };
    this._messages.push(userMsg);
    // Append a placeholder assistant message for streaming; typing indicator inline
    const assistantMsg = {
      role: 'assistant',
      content: '',
      from: 'assistant',
      at: Date.now(),
      typing: true,
    };
    this._messages.push(assistantMsg);
    this.render(false);
    this._saveHistory();

    // Prepare last 10 messages in API schema (role/content only)
    const recent = this._messages
      .map((m) => ({ role: m.role, content: String(m.content ?? '') }))
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10);

    const apiKey = settingsManager.getApiKey();
    const worldId = settingsManager.getSelectedWorldId();
    const gmPermissions =
      !!game.user?.isGM && !!settingsManager.getChatGmPermissionsEnabled?.();
    this._isStreaming = true;
    this.render(false);
    const controller = new AbortController();
    this._streamAbort = controller;
    try {
      await archivistApi.askStream(
        apiKey,
        worldId,
        recent,
        gmPermissions,
        (chunk) => {
          if (assistantMsg.typing) assistantMsg.typing = false;
          assistantMsg.content += chunk;
          // Try incremental DOM update to avoid full re-render jank
          let updated = false;
          try {
            const host = this._mountEl || this.element || this.element?.[0];
            const container = host?.querySelector?.('.messages');
            const rows = container?.querySelectorAll?.('.msg');
            const lastRow = rows?.[rows.length - 1];
            const bubble = lastRow?.querySelector?.('.bubble');
            if (bubble) {
              // Render partial markdown to HTML, then enrich for inline update
              // Avoid blocking too often: keep simple for now, renderer is fast
              this._enrichMarkdown(String(assistantMsg.content))
                .then((html) => {
                  bubble.innerHTML = html;
                  container.scrollTop = container.scrollHeight;
                })
                .catch(() => {
                  bubble.textContent = String(assistantMsg.content);
                  container.scrollTop = container.scrollHeight;
                });
              container.scrollTop = container.scrollHeight;
              updated = true;
            }
          } catch (_) {}
          if (!updated) {
            this.render(false);
          }
        },
        () => {
          this._isStreaming = false;
          this._streamAbort = null;
          this._saveHistory();
          this.render(false); // final render to enrich markdown
        },
        controller.signal
      );
    } catch (e) {
      console.error('[Archivist Sync] Chat error', e);
      this._isStreaming = false;
      this._streamAbort = null;
      ui.notifications?.error(game.i18n.localize('ARCHIVIST_SYNC.chat.error'));
      this.render(false);
    }
  }

  _stopStream() {
    if (this._streamAbort) {
      try {
        this._streamAbort.abort();
      } catch (_) {}
      this._isStreaming = false;
      this._streamAbort = null;
      this.render(false);
    }
  }
}

export default AskChatWindow;
