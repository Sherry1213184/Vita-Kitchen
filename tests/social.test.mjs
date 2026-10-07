import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.mjs';
import { saveActivity } from '../lib/community.ts';
import { createPoll, vote, setPollClosed, socialData, createMemory, editMemory, readPhoto } from '../lib/social.ts';
const poll = () => ({ title: '哪天有空？', kind: 'date', options: ['周六下午', '周日下午'], activity_id: '', requestId: crypto.randomUUID() });
const memory = () => ({ title: '第一次聚餐', body: '一起做饭很好玩', happened_on: '2026-10-07', activity_id: '', people: ['alice', 'bob'], requestId: crypto.randomUUID() });
const photo = () => new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cM/cAAAAASUVORK5CYII=', 'base64')], 'test.png', { type: 'image/png' });
function storage() { const objects = new Map(); return { objects, async put(key, bytes, metadata) { objects.set(key, { bytes, metadata }); } }; }

test('poll creation is idempotent and rejects changed retries and duplicate options', async t => {
  const { db, sqlite } = database(t), input = poll();
  const results = await Promise.all(Array.from({ length: 5 }, () => createPoll(db, 'alice', input)));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM polls').get().n, 1);
  await assert.rejects(createPoll(db, 'alice', { ...input, options: ['a', 'b'] }), e => e.status === 409);
  for (const options of [['a'], ['a', ' a '], ['', 'b'], Array(11).fill('a'), [null, 'b']]) {
    await assert.rejects(createPoll(db, 'alice', { ...poll(), options }), e => e.status === 400);
  }
});

test('multi-choice ballots count each actor once and support change and withdrawal', async t => {
  const { db } = database(t), { id } = await createPoll(db, 'alice', poll());
  await vote(db, 'alice', { id, user: 'bob', revision: 0, choices: [1, 0] });
  let data = await socialData(db, 'alice');
  assert.equal(data.polls[0].ballots.length, 1);
  assert.equal(data.polls[0].ballots[0].user, 'alice');
  assert.deepEqual(data.polls[0].ballots[0].choices, [0, 1]);
  await vote(db, 'alice', { id, revision: 1, choices: [0] });
  await vote(db, 'bob', { id, revision: 0, choices: [0] });
  await vote(db, 'alice', { id, revision: 2, choices: [] });
  data = await socialData(db, 'alice');
  assert.equal(data.polls[0].ballots.filter(b => b.choices.length).length, 1);
});

test('ballots reject invalid indices, duplicates, stale revisions and concurrent double submission', async t => {
  const { db } = database(t), { id } = await createPoll(db, 'alice', poll());
  for (const choices of [[-1], [2], [0, 0], [0.5], ['0']]) await assert.rejects(vote(db, 'alice', { id, revision: 0, choices }), e => e.status === 400);
  await assert.rejects(vote(db, 'alice', { id, revision: 4, choices: [0] }), e => e.status === 409);
  const results = await Promise.allSettled([0, 1].map(n => vote(db, 'alice', { id, revision: 0, choices: [n] })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});

test('closed polls reject votes and can reopen without losing answers', async t => {
  const { db } = database(t), { id } = await createPoll(db, 'alice', poll());
  await vote(db, 'bob', { id, revision: 0, choices: [1] });
  await setPollClosed(db, { id, revision: 0, closed: true });
  await assert.rejects(vote(db, 'bob', { id, revision: 1, choices: [] }), e => e.status === 409);
  await assert.rejects(setPollClosed(db, { id, revision: 0, closed: false }), e => e.status === 409);
  await setPollClosed(db, { id, revision: 1, closed: false });
  assert.deepEqual((await socialData(db, 'alice')).polls[0].ballots[0].choices, [1]);
});

test('memory text and participant snapshots persist; arbitrary image URLs are never trusted', async t => {
  const { db, sqlite } = database(t), store = storage(), input = memory();
  const { id } = await createMemory(db, store, 'alice', { ...input, image: 'https://invalid.example/photo.jpg' });
  assert.equal(store.objects.size, 0);
  let saved = (await socialData(db, 'alice')).memories[0];
  assert.equal(saved.image, '');
  assert.deepEqual(saved.people.map(p => p.name), ['小周', '小陈']);
  sqlite.prepare("UPDATE profiles SET name='新昵称' WHERE user='bob'").run();
  assert.equal((await createMemory(db, store, 'alice', input)).id, id);
  assert.equal((await socialData(db, 'alice')).memories[0].people[1].name, '小陈');
});

test('photo retries and concurrent requests create one memory and one storage key', async t => {
  const { db, sqlite } = database(t), store = storage(), input = { ...memory(), body: '' };
  const results = await Promise.all(Array.from({ length: 5 }, () => createMemory(db, store, 'alice', input, photo())));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM memories').get().n, 1);
  assert.equal(store.objects.size, 1);
  const saved = (await socialData(db, 'alice')).memories[0];
  assert.match(saved.image, /^\/api\/images\/[a-f0-9-]{36}$/);
  assert.equal(store.objects.get(saved.image.split('/').at(-1)).metadata.httpMetadata.contentType, 'image/png');
  await assert.rejects(createMemory(db, store, 'alice', { ...input, title: '变更内容' }, photo()), e => e.status === 409);
});

test('invalid pictures, oversized uploads, dates and unknown participants leave no records', async t => {
  const { db, sqlite } = database(t), store = storage();
  await assert.rejects(readPhoto(new File(['<svg/>'], 'fake.png', { type: 'image/png' })), e => e.status === 400);
  await assert.rejects(readPhoto(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.jpg')), e => e.status === 400);
  for (const patch of [{ body: '', people: [] }, { happened_on: '2026-02-30' }, { people: ['stranger'] }, { people: ['alice', 'alice'] }, { activity_id: 'missing' }]) {
    await assert.rejects(createMemory(db, store, 'alice', { ...memory(), ...patch }), e => e.status === 400);
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('storage failure does not publish a memory; a database failure can retry the same blob safely', async t => {
  const { db, sqlite } = database(t), input = memory();
  await assert.rejects(createMemory(db, { async put() { throw new Error('offline'); } }, 'alice', input, photo()));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM memories').get().n, 0);
  const store = storage();
  sqlite.exec("CREATE TRIGGER unavailable BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'db offline'); END");
  await assert.rejects(createMemory(db, store, 'alice', input, photo()));
  assert.equal(store.objects.size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM memories').get().n, 0);
  sqlite.exec('DROP TRIGGER unavailable');
  await createMemory(db, store, 'alice', input, photo());
  assert.equal(store.objects.size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM memories').get().n, 1);
});

test('only the author can edit a memory; concurrent stale edits fail and photo is preserved', async t => {
  const { db } = database(t), store = storage(), input = memory();
  const { id } = await createMemory(db, store, 'alice', input, photo());
  const original = (await socialData(db, 'alice')).memories[0];
  await assert.rejects(editMemory(db, 'bob', { ...input, id, revision: 0 }), e => e.status === 403);
  const edits = await Promise.allSettled(['first', 'second'].map(body => editMemory(db, 'alice', { ...input, id, body, revision: 0, image: '' })));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
  const saved = (await socialData(db, 'alice')).memories[0];
  assert.equal(saved.revision, 1);
  assert.equal(saved.image, original.image);
  await createMemory(db, store, 'alice', input, photo());
  assert.equal((await socialData(db, 'alice')).memories[0].body, saved.body);
});

test('activity scope and cursor pagination preserve all memories with equal timestamps', async t => {
  const { db, sqlite } = database(t);
  const { id } = await saveActivity(db, 'alice', { requestId: crypto.randomUUID(), title: '聚会', kind: 'gathering', starts_on: '', ends_on: '', location: '', notes: '', status: 'planning' });
  await createPoll(db, 'alice', { ...poll(), activity_id: id });
  await createPoll(db, 'alice', poll());
  const insert = sqlite.prepare("INSERT INTO memories (id,activity_id,title,body,happened_on,people,image,author,author_name,created,updated,fingerprint) VALUES (?,?,'test','text','2026-10-07','[]','','alice','test','2026-10-07T10:00:00.000Z','2026-10-07T10:00:00.000Z','')");
  for (let i = 0; i < 45; i++) insert.run(String(i).padStart(3, '0'), i < 42 ? id : null);
  const first = await socialData(db, 'alice', id);
  assert.equal(first.polls.length, 1);
  assert.equal(first.memories.length, 20);
  const second = await socialData(db, 'alice', id, first.nextCursor);
  const third = await socialData(db, 'alice', id, second.nextCursor);
  const records = [...first.memories, ...second.memories, ...third.memories];
  assert.equal(new Set(records.map(m => m.id)).size, 42);
  assert.equal(third.nextCursor, null);
  assert.ok(records.every(m => m.activity_id === id));
});
