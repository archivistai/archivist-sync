import assert from 'node:assert/strict';
import test from 'node:test';

import { ArchivistApiService } from '../scripts/services/archivist-api.js';

test('listQuests hydrates summary rows with objectives and progress', async () => {
  const api = new ArchivistApiService();
  const requests = [];
  api._request = async (_apiKey, path) => {
    requests.push(path);
    if (path.startsWith('/quests?')) {
      return {
        data: [{ id: 'quest-1', quest_name: 'Recover the Crown' }],
        pages: 1,
      };
    }
    assert.equal(path, '/quests/quest-1');
    return {
      id: 'quest-1',
      quest_name: 'Recover the Crown',
      objectives: [{ text: 'Find the vault', status: 'in-progress' }],
      progress_log: ['The party found the vault map.'],
    };
  };

  const result = await api.listQuests('key', 'campaign-1');

  assert.equal(result.success, true);
  assert.deepEqual(requests, [
    '/quests?campaign_id=campaign-1&page=1&size=100',
    '/quests/quest-1',
  ]);
  assert.deepEqual(result.data[0].objectives, [
    { text: 'Find the vault', status: 'in-progress' },
  ]);
  assert.deepEqual(result.data[0].progressLog, [
    'The party found the vault map.',
  ]);
});

test('listQuests does not refetch rows that already contain structured details', async () => {
  const api = new ArchivistApiService();
  let requestCount = 0;
  api._request = async () => {
    requestCount += 1;
    return {
      data: [
        {
          id: 'quest-1',
          quest_name: 'Recover the Crown',
          objectives: [],
          progress_log: [],
        },
      ],
      pages: 1,
    };
  };

  const result = await api.listQuests('key', 'campaign-1');

  assert.equal(result.success, true);
  assert.equal(requestCount, 1);
  assert.deepEqual(result.data[0].objectives, []);
  assert.deepEqual(result.data[0].progressLog, []);
});

test('listQuests retains the summary when detail hydration fails', async () => {
  const api = new ArchivistApiService();
  api._request = async (_apiKey, path) => {
    if (path.startsWith('/quests?')) {
      return {
        data: [{ id: 'quest-1', quest_name: 'Recover the Crown' }],
        pages: 1,
      };
    }
    throw new Error('detail unavailable');
  };

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await api.listQuests('key', 'campaign-1');
    assert.equal(result.success, true);
    assert.equal(result.data[0].questName, 'Recover the Crown');
    assert.deepEqual(result.data[0].objectives, undefined);
    assert.deepEqual(result.data[0].progressLog, []);
  } finally {
    console.warn = originalWarn;
  }
});
