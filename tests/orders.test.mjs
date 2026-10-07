import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { personalOrders, placeOrder, advanceOrder, parseOrderCursor } from '../lib/orders.ts';

// Run the production SQL against SQLite with D1's small async result interface.
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  const db = { prepare(sql) {
    return { bind(...args) {
      const statement = sqlite.prepare(sql);
      return {
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      };
    } };
  } };
  return { db, sqlite };
}
const menu = async () => [{ id: 'egg', name: '番茄炒蛋', available: 1 }];
const input = () => ({ requestId: crypto.randomUUID(), name: '小周', room: 'A1', note: '少盐', items: [{ id: 'egg', qty: 2 }] });

test('retries, concurrent submissions and a changed menu create exactly one order', async t => {
  const { db, sqlite } = database(t), body = input();
  const results = await Promise.all(Array.from({ length: 8 }, () => placeOrder(db, 'alice', body, menu)));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
  assert.equal((await placeOrder(db, 'alice', body, async () => [])).id, results[0].id);
  await assert.rejects(placeOrder(db, 'alice', { ...body, note: '不要盐' }, menu), e => e.status === 409);
  await placeOrder(db, 'bob', body, menu);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 2);
});

test('legacy clients and legitimate identical new orders remain supported', async t => {
  const { db, sqlite } = database(t);
  const body = input(); delete body.requestId;
  await placeOrder(db, 'alice', body, menu);
  await placeOrder(db, 'alice', body, menu);
  await placeOrder(db, 'alice', input(), menu);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 3);
});

test('reject invalid, duplicate, unavailable items and oversized notes', async t => {
  const { db, sqlite } = database(t);
  for (const items of [[null], [{ id: 'egg', qty: 0 }], [{ id: 'egg', qty: 21 }],
    [{ id: 'egg', qty: 1.5 }], [{ id: 'egg', qty: 1 }, { id: 'egg', qty: 2 }]]) {
    await assert.rejects(placeOrder(db, 'alice', { ...input(), items }, menu), e => e.status === 400);
  }
  await assert.rejects(placeOrder(db, 'alice', input(), async () => []), e => e.status === 400);
  await assert.rejects(placeOrder(db, 'alice', { ...input(), note: 'a'.repeat(501) }, menu));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
});

test('personal history is isolated and cursor pagination handles equal timestamps and new inserts', async t => {
  const { db, sqlite } = database(t);
  const insert = sqlite.prepare("INSERT INTO orders (id,user,name,room,note,items,total,created) VALUES (?,?,'demo','A1','','[]',0,?)");
  for (let i = 0; i < 245; i++) insert.run(String(i).padStart(4, '0'), i < 45 ? 'alice' : 'bob', '2026-10-07T10:00:00.000Z');
  const first = await personalOrders(db, 'alice');
  assert.equal(first.orders.length, 20);
  insert.run('new', 'alice', '2026-10-07T11:00:00.000Z');
  const second = await personalOrders(db, 'alice', first.ordersNextCursor);
  const third = await personalOrders(db, 'alice', second.ordersNextCursor);
  const rows = [...first.orders, ...second.orders, ...third.orders];
  assert.equal(rows.length, 45);
  assert.equal(new Set(rows.map(o => o.id)).size, 45);
  assert.ok(rows.every(o => o.user === 'alice'));
  assert.equal(third.ordersNextCursor, null);
});

test('review flag is independent of the recent public review feed', async t => {
  const { db, sqlite } = database(t);
  const { id } = await placeOrder(db, 'alice', input(), menu);
  sqlite.prepare("INSERT INTO reviews VALUES ('review',?,'alice','小周',5,'好吃','2020-01-01')").run(id);
  assert.equal((await personalOrders(db, 'alice')).orders[0].hasReview, 1);
});

test('concurrent status updates report conflict; ownership and sequence are enforced', async t => {
  const { db } = database(t);
  const { id } = await placeOrder(db, 'alice', input(), menu);
  const results = await Promise.allSettled([advanceOrder(db, 'alice', true, id, 1), advanceOrder(db, 'bob', true, id, 1)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  await assert.rejects(advanceOrder(db, 'bob', false, id, 2), e => e.status === 403);
  await assert.rejects(advanceOrder(db, 'alice', true, id, 4), e => e.status === 409);
  await advanceOrder(db, 'alice', true, id, 2);
  await advanceOrder(db, 'alice', true, id, 3);
  await advanceOrder(db, 'alice', false, id, 4);
});

test('cursor validation rejects malformed input', () => {
  assert.equal(parseOrderCursor(null), undefined);
  for (const value of ['not-json', 'null', '{}', '{"created":"invalid","id":"x"}']) {
    assert.throws(() => parseOrderCursor(value), e => e.status === 400);
  }
});
