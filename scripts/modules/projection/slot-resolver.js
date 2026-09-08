import { AdapterRegistry } from './adapter-registry.js';
import { mergeArchivistSection, mergeArchivistPlainSection } from './merge.js';
import { CONFIG } from '../config.js';

function defaultHeuristics(doc) {
  return [
    { path: 'system.description.value', weight: 90, html: true },
    { path: 'system.details.description', weight: 85, html: true },
    { path: 'flags.core.summary', weight: 70, html: true },
  ];
}

// Leaf field names we are willing to project prose into when a candidate is
// discovered by schema probing.
const PROSE_LEAF_ALLOW =
  /^(description|biography|bio|background|backstory|notes|publicNotes|appearance|summary|value|public)$/i;
// Generic leaves that are only prose when nested in a known container.
// `system.value` / `system.public` are often mechanical (price, quantity) and
// must not be treated as a sheet description just because Array#every is true
// for an empty ancestor list.
const GENERIC_PROSE_LEAVES = /^(value|public)$/i;
// Containers a prose field may legitimately sit inside. Anything else (an
// action's `attack.description`, an inventory entry, a status effect) is not a
// sheet description and must never be written to, even when its leaf name looks
// right.
const PROSE_CONTAINER_ALLOW =
  /^(details|biography|bio|description|notes|attributes)$/i;
// Never write player-facing content into fields that read as GM-only or as
// system internals.
const PROSE_PATH_DENY =
  /(gm|private|secret|hidden|unidentified|source|formula|uuid|_id)/i;
const MAX_SCHEMA_DEPTH = 3;

/**
 * Discover projectable text fields by walking the document's own DataModel.
 *
 * The registry and defaultHeuristics() both hardcode dnd5e-shaped paths, so a
 * system that stores prose anywhere else resolves to no slot at all. Rather
 * than guess more paths, ask the schema what actually exists. Weights stay
 * below the registered adapters so an explicit adapter always wins.
 *
 * @param {ClientDocument} doc
 * @returns {{ path: string, weight: number, html: boolean }[]}
 */
function schemaHeuristics(doc) {
  const out = [];
  try {
    const fields = foundry?.data?.fields;
    const schema = doc?.system?.schema;
    if (!fields || !schema?.fields) return out;

    const walk = (node, prefix, depth) => {
      if (!node?.fields || depth > MAX_SCHEMA_DEPTH) return;
      for (const [key, field] of Object.entries(node.fields)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (fields.SchemaField && field instanceof fields.SchemaField) {
          walk(field, path, depth + 1);
          continue;
        }
        // v13 systems often wrap nested models in EmbeddedDataField, which is
        // not always instanceof SchemaField. Only descend when the field
        // itself is a plausible prose container so we do not walk into
        // attack / inventory / effect models.
        const embeddedSchema = field?.model?.schema;
        if (embeddedSchema?.fields && PROSE_CONTAINER_ALLOW.test(key)) {
          walk(embeddedSchema, path, depth + 1);
          continue;
        }
        const isHtml = !!(
          fields.HTMLField && field instanceof fields.HTMLField
        );
        const isString = !!(
          fields.StringField && field instanceof fields.StringField
        );
        if (!isHtml && !isString) continue;
        const segments = path.split('.');
        const leaf = segments[segments.length - 1];
        const ancestors = segments.slice(0, -1);
        if (!PROSE_LEAF_ALLOW.test(leaf)) continue;
        if (PROSE_PATH_DENY.test(path)) continue;
        if (GENERIC_PROSE_LEAVES.test(leaf) && !ancestors.length) continue;
        // Every ancestor must be a plausible prose container, so we never
        // target a description belonging to a nested action, item or effect
        // rather than to the sheet itself.
        if (!ancestors.every((seg) => PROSE_CONTAINER_ALLOW.test(seg)))
          continue;
        // Prefer real rich-text fields, and prose-named ones over generic notes.
        let weight = isHtml ? 60 : 40;
        if (/^(description|biography|bio|background|backstory)$/i.test(leaf))
          weight += 20;
        out.push({ path: `system.${path}`, weight, html: isHtml });
      }
    };

    walk(schema, '', 0);
    out.sort((a, b) => b.weight - a.weight);
    if (out.length) {
      console.log('[Projection] Schema-derived candidates', {
        system: game?.system?.id,
        docType: doc?.documentName,
        actorType: doc?.type,
        paths: out.map((c) => c.path),
      });
    }
  } catch (e) {
    console.warn('[Projection] schemaHeuristics failed', e);
  }
  return out;
}

// One toast per system + document type + subtype, so a bulk import cannot spam
// the user with the same finding hundreds of times.
const _noSlotWarned = new Set();

function warnNoSlot(doc) {
  const sysId = game?.system?.id || 'unknown';
  const docType = doc?.documentName || 'Document';
  const subtype = doc?.type || '';
  console.warn('[Projection] No viable slot found', {
    system: sysId,
    docType,
    subtype,
    name: doc?.name,
  });
  const key = `${sysId}|${docType}|${subtype}`;
  if (_noSlotWarned.has(key)) return;
  _noSlotWarned.add(key);
  try {
    ui?.notifications?.warn?.(
      `Archivist Sync: no description field found on ${docType}${
        subtype ? ` (${subtype})` : ''
      } for the "${sysId}" system, so descriptions were not written to those sheets. The Archivist journal sheets still have the full text. Filter the console for "[Projection]" for details.`
    );
  } catch (_) {
    /* notifications unavailable */
  }
}

/**
 * Score a candidate list against a document and return its best existing slot.
 * @param {ClientDocument} doc
 * @param {{ path: string, weight: number, html?: boolean }[]} candidates
 * @returns {{ path: string, html: boolean, score: number } | null}
 */
function pickBest(doc, candidates) {
  const viable = (candidates || [])
    .map((c) => ({
      ...c,
      val: foundry.utils.getProperty(doc, c.path),
      has: foundry.utils.hasProperty(doc, c.path),
    }))
    // Only consider paths that exist on the document; prevents writing to non-schema fields (e.g., PF2e NPC backstory)
    .filter((c) => c.has && (typeof c.val === 'string' || c.val == null));
  if (!viable.length) return null;
  return viable
    .map((c) => {
      const s = String(c.val ?? '');
      const html = !!c.html || /<\/?[a-z][\s\S]*>/i.test(s);
      const score = (c.weight || 0) + (s.length ? 15 : 0) + (html ? 10 : 0);
      return { path: c.path, html, score };
    })
    .sort((a, b) => b.score - a.score)[0];
}

// Sidecar journals removed: projection now only targets best-matched fields

/**
 * @param {ClientDocument} doc
 * @returns {Promise<{kind:'field', path:string, html:boolean} | {kind:'journal', entry: JournalEntry}>}
 */
export async function pickDescriptionSlot(doc) {
  try {
    const docType = doc?.documentName;
    const systemId = String(game?.system?.id || '').toLowerCase();
    const actorType = docType === 'Actor' ? String(doc?.type || '') : undefined;
    console.log('[Projection] pickDescriptionSlot for', {
      docType,
      name: doc?.name,
      systemId,
      actorType,
    });

    // Dynamic front-of-queue candidates when we can infer subtype
    /** @type {{ path: string, weight: number, html?: boolean }[]} */
    let dynamic = [];
    if (systemId === 'pf2e' && docType === 'Actor') {
      if (actorType === 'npc') {
        dynamic = [
          { path: 'system.details.publicNotes', weight: 125, html: true },
        ];
      } else if (actorType === 'character') {
        dynamic = [
          {
            path: 'system.details.biography.backstory',
            weight: 125,
            html: true,
          },
        ];
      }
    }

    const reg = AdapterRegistry.getCandidates(docType) || [];
    const declared = dynamic.length
      ? [...dynamic, ...reg]
      : reg.length
        ? reg
        : defaultHeuristics(doc);
    if (!declared.length) {
      console.warn('[Projection] No candidates; using default heuristics only');
    }

    // Tier 1 is the registered adapter (or the dnd5e-shaped defaults); tier 2 is
    // whatever the document's own schema offers. Tier 1 is scored on its own
    // first, so adding the probe cannot change which slot dnd5e/pf2e resolve to.
    for (const tier of [declared, schemaHeuristics(doc)]) {
      const best = pickBest(doc, tier);
      if (best) {
        console.log('[Projection] Selected slot', best);
        return { kind: 'field', path: best.path, html: best.html };
      }
    }

    warnNoSlot(doc);
    return { kind: 'none' };
  } catch (e) {
    console.warn('[Projection] pickDescriptionSlot error:', e);
    return { kind: 'none' };
  }
}

/**
 * Project Archivist HTML into the selected slot. Adds loop-guard flag.
 * @param {ClientDocument} doc
 * @param {string} archivistHtml
 */
export async function projectDescription(doc, archivistHtml) {
  const slot = await pickDescriptionSlot(doc);
  const ts = Date.now();
  const op = foundry.utils?.randomID?.() || Math.random().toString(36).slice(2);
  if (slot.kind !== 'field') return { target: 'none' };
  const current = String(foundry.utils.getProperty(doc, slot.path) ?? '');
  const next = slot.html
    ? mergeArchivistSection(current, String(archivistHtml ?? ''))
    : mergeArchivistPlainSection(current, archivistHtml);
  const update = {
    [slot.path]: next,
    [`flags.${CONFIG.MODULE_ID}.op`]: op,
    [`flags.${CONFIG.MODULE_ID}.lastProjectionAt`]: ts,
  };
  console.log('[Projection] Updating doc field with Archivist content', {
    path: slot.path,
    html: slot.html,
    length: String(next).length,
  });
  await doc.update(update, { render: false });
  return { target: 'field', path: slot.path };
}

export const SlotResolver = { pickDescriptionSlot, projectDescription };
