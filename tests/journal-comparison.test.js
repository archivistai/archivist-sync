import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => Base,
    },
  },
};
const { SyncDialog } = await import('../scripts/dialogs/sync-dialog.js');

test('journal sync ignores equivalent apostrophe encodings but detects edits and formatting', () => {
  const normalize = (html) =>
    SyncDialog.prototype._normalizeHtmlForComparison(html);
  const saved = "<h1>Journal</h1><p>The captain's ship</p>";
  assert.equal(
    normalize(saved),
    normalize('<h1>Journal</h1><p>The captain&#39;s ship</p>')
  );
  assert.equal(
    normalize(saved),
    normalize('<h1>Journal</h1><p>The captain&#x27;s ship</p>')
  );
  assert.notEqual(
    normalize(saved),
    normalize('<p>Journal</p><p>The captain&#39;s ship</p>')
  );
  assert.notEqual(
    normalize(saved),
    normalize('<h1>Journal</h1><p>The captain&#39;s sword</p>')
  );
});
