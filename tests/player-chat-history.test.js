import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AskChatWindow } from '../scripts/dialogs/ask-chat-window.js';
import { SETTINGS } from '../scripts/modules/config.js';

test('a player can save and clear history without writing a world setting', async (t) => {
  const legacy = [{ role: 'user', content: 'Previous question' }];
  const settings = {
    [SETTINGS.SELECTED_WORLD_ID.key]: 'campaign',
    [SETTINGS.CHAT_HISTORY_ENABLED.key]: true,
    [SETTINGS.CHAT_HISTORY.key]: JSON.stringify({ 'player:campaign': legacy }),
    [SETTINGS.USER_CHAT_HISTORY.key]: { other: legacy },
  };
  const writes = [];
  t.mock.method(console, 'warn', () => {});
  globalThis.game = {
    user: { id: 'player', isGM: false },
    settings: {
      get: (_module, key) => settings[key],
      set: async (_module, key, value) => {
        if (key !== SETTINGS.USER_CHAT_HISTORY.key) throw new Error('World write denied');
        writes.push(key);
        settings[key] = value;
      },
    },
  };
  t.after(() => delete globalThis.game);
  assert.equal(SETTINGS.USER_CHAT_HISTORY.scope, 'user');
  const chat = new AskChatWindow();
  assert.deepEqual(chat._messages, legacy);

  const message = { role: 'assistant', content: 'New answer' };
  chat._messages = [...chat._messages, message];
  await chat._saveHistory();
  assert.deepEqual(new AskChatWindow()._messages, [...legacy, message]);

  chat._messages = [];
  await chat._saveHistory();
  assert.deepEqual(new AskChatWindow()._messages, []);
  assert.deepEqual(settings[SETTINGS.USER_CHAT_HISTORY.key].other, legacy);
  assert.equal(writes.length, 2);
});
