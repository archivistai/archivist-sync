// Projection Adapter Registry
// Provides per-system candidates for where descriptive HTML should be projected

/**
 * @typedef {Object} SlotCandidate
 * @property {string} path - foundry.utils dot path into the document data
 * @property {number} weight - base weight for scoring
 * @property {boolean} [html] - whether the field expects HTML
 */

/** @typedef {"Actor"|"Item"|"Scene"|"JournalEntry"} DocType */

const common = {
  Actor: [
    { path: 'system.details.biography.value', weight: 100, html: true },
    { path: 'system.description.value', weight: 90, html: true },
    { path: 'system.details.notes', weight: 70, html: false },
  ],
  Item: [
    { path: 'system.description.value', weight: 100, html: true },
    { path: 'system.details.description', weight: 90, html: true },
  ],
  Scene: [
    { path: 'description', weight: 80, html: true },
    { path: 'flags.core.summary', weight: 60, html: true },
  ],
  JournalEntry: [{ path: 'pages.0.text.content', weight: 100, html: true }],
};

/** @type {Record<string, { id: string, slots: Record<DocType, SlotCandidate[]> }>} */
const registry = {
  dnd5e: { id: 'dnd5e', slots: common },
  pf2e: {
    id: 'pf2e',
    slots: {
      ...common,
      Actor: [
        // PCs: prefer backstory; NPCs: prefer publicNotes. Since we can't branch here by type,
        // push both higher than common fields and let scoring select based on existing content.
        { path: 'system.details.biography.backstory', weight: 120, html: true },
        { path: 'system.details.publicNotes', weight: 115, html: true },
        ...common.Actor,
      ],
    },
  },
  // Daggerheart (Foundryborne) keeps prose in a different shape than the
  // dnd5e-style `system.details.*` tree: PCs use `system.biography.*`, while
  // every actor type whose data model is flagged isNPC (adversary, npc,
  // environment, party) exposes a bare `system.description` string. None of the
  // `common` paths exist here, so without this adapter projection silently
  // resolves to no slot. Listing both shapes together is safe because the
  // resolver filters candidates through hasProperty() before scoring them.
  daggerheart: {
    id: 'daggerheart',
    slots: {
      ...common,
      Actor: [
        { path: 'system.biography.background', weight: 120, html: true },
        { path: 'system.description', weight: 110, html: true },
        { path: 'system.biography.connections', weight: 90, html: true },
        { path: 'system.notes', weight: 60, html: true },
      ],
      Item: [
        { path: 'system.description', weight: 100, html: true },
        ...common.Item,
      ],
    },
  },
};

export function getAdapter() {
  try {
    const sid = game.system?.id || '';
    console.log('[Projection.AdapterRegistry] getAdapter for system:', sid);
    return registry[sid] || null;
  } catch (_) {
    return null;
  }
}

export function getCandidates(docType) {
  const a = getAdapter();
  const slots = a?.slots?.[docType] || null;
  if (!slots) {
    console.warn('[Projection.AdapterRegistry] No candidates for', {
      system: a?.id,
      docType,
    });
  } else {
    console.log('[Projection.AdapterRegistry] Candidates resolved for', {
      system: a?.id,
      docType,
      count: slots.length,
    });
  }
  return slots;
}

// Allow external modules to register candidates at runtime
Hooks.on('archivist:registerSlot', (systemId, docType, candidate) => {
  try {
    if (!systemId || !docType || !candidate) return;
    const rec = registry[systemId] || {
      id: systemId,
      slots: { Actor: [], Item: [], Scene: [], JournalEntry: [] },
    };
    (rec.slots[docType] ||= []).push(candidate);
    registry[systemId] = rec;
  } catch (_) {
    /* ignore */
  }
});

export const AdapterRegistry = { getAdapter, getCandidates };
