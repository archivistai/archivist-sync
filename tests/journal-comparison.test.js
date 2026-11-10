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

test('journal sync ignores other equivalent character references', () => {
  const normalize = (html) =>
    SyncDialog.prototype._normalizeHtmlForComparison(html);
  const same = (a, b) => assert.equal(normalize(a), normalize(b));
  same("<p>it's</p>", '<p>it&apos;s</p>');
  same('<p>say "hi"</p>', '<p>say &quot;hi&quot;</p>');
  same('<p>say "hi"</p>', '<p>say &#34;hi&#x22;</p>');
  same('<p>it’s</p>', '<p>it&#8217;s</p>');
  // A curly apostrophe is a different character from ASCII '.
  assert.notEqual(normalize("<p>it's</p>"), normalize('<p>it&#8217;s</p>'));
  // Markup-significant references stay escaped, so text never becomes tags.
  assert.notEqual(normalize('<p>a<b</p>'), normalize('<p>a&lt;b</p>'));
  assert.notEqual(normalize('<p>&lt;b&gt;</p>'), normalize('<p><b></p>'));
  assert.notEqual(normalize('<p>&#60;b&#62;</p>'), normalize('<p><b></p>'));
  // Escaped entity text is still distinct from the character it names.
  assert.notEqual(normalize("<p>'</p>"), normalize('<p>&amp;#39;</p>'));
  // Named references are case-sensitive in HTML, so unknown variants remain
  // literal text rather than matching their decoded counterparts.
  assert.notEqual(normalize("<p>it's</p>"), normalize('<p>it&APOS;s</p>'));
  // The non-browser fallback never decodes markup, including attributes,
  // where doing so could move an attribute boundary.
  assert.notEqual(
    normalize('<p title="a&quot; style=&quot;color:red">x</p>'),
    normalize('<p title="a" style="color:red">x</p>')
  );
});

test('journal sync keeps non-collapsing Unicode spaces distinct', () => {
  const normalize = (html) =>
    SyncDialog.prototype._normalizeHtmlForComparison(html);
  assert.notEqual(normalize('<p>A&#8195;B</p>'), normalize('<p>A B</p>'));
  assert.notEqual(normalize('<p>A B</p>'), normalize('<p>A B</p>'));
  assert.equal(normalize('<p>A&#8195;B</p>'), normalize('<p>A B</p>'));
  // Collapsible HTML whitespace still folds.
  assert.equal(
    normalize('<p>A \t B</p>\n<p>C</p>'),
    normalize('<p>A B</p><p>C</p>')
  );
});

test('journal sync keeps whitespace written as a reference', () => {
  const normalize = (html) =>
    SyncDialog.prototype._normalizeHtmlForComparison(html);
  assert.notEqual(
    normalize('<strong>A</strong>&#32;<em>B</em>'),
    normalize('<strong>A</strong><em>B</em>')
  );
  assert.notEqual(
    normalize('<a href="https://example.com/a&#32;&#32;b">x</a>'),
    normalize('<a href="https://example.com/a&#32;b">x</a>')
  );
});
