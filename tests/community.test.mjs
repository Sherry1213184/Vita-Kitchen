import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { parseAmount, splitAmount, expenseBalances } from '../lib/community-money.ts';
import { communityData, saveActivity, setAttendance, createExpense, settleShare, voidExpense } from '../lib/community.ts';

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  const db = {
    prepare(sql) { return { bind(...args) {
      const statement = sqlite.prepare(sql);
      return {
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        execute() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
        async run() { return this.execute(); },
      };
    } }; },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  for (const [id, name] of [['alice', '小周'], ['bob', '小陈'], ['cathy', '小林']]) sqlite.prepare('INSERT INTO profiles (user,name) VALUES (?,?)').run(id, name);
  return { db, sqlite };
}
const plan = () => ({ requestId: crypto.randomUUID(), title: '海边周末', kind: 'trip', starts_on: '2026-10-10', ends_on: '2026-10-11', location: '车站', notes: '10:00 集合', status: 'planning' });
const bill = () => ({ requestId: crypto.randomUUID(), title: '火锅', amount: '10.00', currency: 'GBP', payer: 'alice', users: ['bob', 'alice', 'cathy'], activity_id: '', spent_on: '2026-10-07', note: '' });

test('parse money strictly and distribute integer remainders without losing a penny', () => {
  assert.equal(parseAmount('10.01'), 1001);
  assert.equal(parseAmount('0.1'), 10);
  for (const v of ['0', '-1', '1.001', '1e2', ' 1', 'NaN', '1000000.01', 1, null]) assert.equal(parseAmount(v), null);
  assert.deepEqual(splitAmount(1000, ['c', 'a', 'b']), [{ user: 'a', amount: 334 }, { user: 'b', amount: 333 }, { user: 'c', amount: 333 }]);
  for (let n = 1; n <= 10; n++) for (const total of [1, 2, 99, 1000, 100_000_000]) {
    const shares = splitAmount(total, Array.from({ length: n }, (_, i) => String(i)));
    assert.equal(shares.reduce((s, v) => s + v.amount, 0), total);
    assert.ok(Math.max(...shares.map(s => s.amount)) - Math.min(...shares.map(s => s.amount)) <= 1);
  }
});

test('activity retries are idempotent and concurrent edits preserve the winning revision', async t => {
  const { db, sqlite } = database(t), input = plan();
  const results = await Promise.all(Array.from({ length: 5 }, () => saveActivity(db, 'alice', input)));
  const id = results[0].id;
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  const edits = await Promise.allSettled(['新地点1', '新地点2'].map(location => saveActivity(db, 'bob', { ...input, id, revision: 0, location })));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(edits.find(r => r.status === 'rejected').reason.status, 409);
  await saveActivity(db, 'alice', input);
  assert.equal(sqlite.prepare('SELECT revision FROM activities').get().revision, 1);
  await assert.rejects(saveActivity(db, 'alice', { ...input, title: '同编号不同活动' }), e => e.status === 409);
});

test('validate real calendar dates and permit undecided dates without timezone conversion', async t => {
  const { db } = database(t);
  for (const dates of [{ starts_on: '2026-02-30' }, { ends_on: '2026-10-01' }, { starts_on: '', ends_on: '2026-10-11' }, { starts_on: '2026-10-10T10:00:00Z' }]) {
    await assert.rejects(saveActivity(db, 'alice', { ...plan(), ...dates }), e => e.status === 400);
  }
  await saveActivity(db, 'alice', { ...plan(), starts_on: '', ends_on: '' });
  assert.equal((await communityData(db, 'alice')).activities[0].starts_on, '');
});

test('attendance can only set the actor; finished plans reject changes atomically', async t => {
  const { db } = database(t), input = plan();
  const { id } = await saveActivity(db, 'alice', input);
  await setAttendance(db, 'alice', { id, user: 'bob', choice: 'yes' });
  await setAttendance(db, 'alice', { id, choice: 'maybe' });
  let data = await communityData(db, 'alice');
  assert.equal(data.activities[0].attendance.length, 1);
  assert.equal(data.activities[0].attendance[0].user, 'alice');
  assert.equal(data.activities[0].attendance[0].choice, 'maybe');
  await saveActivity(db, 'bob', { ...input, id, revision: 0, status: 'completed' });
  await assert.rejects(setAttendance(db, 'alice', { id, choice: 'yes' }), e => e.status === 409);
});

test('expense batch creates one complete bill under retries, preserving later settlements', async t => {
  const { db, sqlite } = database(t), input = bill();
  const results = await Promise.all(Array.from({ length: 6 }, () => createExpense(db, 'alice', input)));
  const id = results[0].id;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expenses').get().n, 1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n,sum(amount) AS total FROM expense_shares').get().n, 3);
  assert.equal(sqlite.prepare('SELECT sum(amount) AS total FROM expense_shares').get().total, 1000);
  await settleShare(db, 'cathy', { id, user: 'bob', revision: 0, settled: true });
  await createExpense(db, 'alice', input);
  assert.equal(sqlite.prepare("SELECT settled FROM expense_shares WHERE user='bob'").get().settled, 1);
  await assert.rejects(createExpense(db, 'alice', { ...input, amount: '15' }), e => e.status === 409);
  const e = (await communityData(db, 'alice')).expenses[0];
  assert.equal(e.shares.find(s => s.user === 'alice').settled, 1);
  assert.equal(e.shares.find(s => s.user === 'bob').settled_by, 'cathy');
});

test('conflicting concurrent requests cannot append a different participant or alter shares', async t => {
  const { db, sqlite } = database(t), input = bill();
  const results = await Promise.allSettled([
    createExpense(db, 'alice', { ...input, users: ['alice', 'bob'] }),
    createExpense(db, 'alice', { ...input, amount: '20.00', users: ['alice', 'cathy'] }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const e = (await communityData(db, 'alice')).expenses[0];
  assert.equal(e.shares.length, 2);
  assert.equal(e.shares.reduce((n, s) => n + s.amount, 0), e.amount);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expenses').get().n, 1);
});

test('invalid amounts, unknown people and missing linked activities do not create bills', async t => {
  const { db, sqlite } = database(t);
  for (const patch of [{ amount: '3.456' }, { currency: 'USD' }, { users: ['alice', 'alice'] }, { users: [] }, { users: ['stranger'] }, { payer: 'stranger' }, { activity_id: 'missing' }, { spent_on: '2026-02-30' }]) {
    await assert.rejects(createExpense(db, 'alice', { ...bill(), ...patch }), e => e.status === 400);
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expenses').get().n, 0);
});

test('failed child insertion rolls back the expense and every share', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec("CREATE TRIGGER fail_share BEFORE INSERT ON expense_shares WHEN NEW.user='bob' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  await assert.rejects(createExpense(db, 'alice', bill()));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expenses').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM expense_shares').get().n, 0);
});

test('settlement detects stale edits, permits undo, and void preserves original records', async t => {
  const { db } = database(t), input = bill();
  const { id } = await createExpense(db, 'alice', input);
  const edits = await Promise.allSettled(['alice', 'bob'].map(user => settleShare(db, user, { id, user: 'bob', revision: 0, settled: true })));
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
  await settleShare(db, 'bob', { id, user: 'bob', revision: 1, settled: false });
  await assert.rejects(settleShare(db, 'bob', { id, user: 'alice', revision: 0, settled: false }), e => e.status === 409);
  await voidExpense(db, 'cathy', { id });
  await createExpense(db, 'alice', input);
  await assert.rejects(settleShare(db, 'bob', { id, user: 'bob', revision: 2, settled: true }), e => e.status === 409);
  const e = (await communityData(db, 'alice')).expenses[0];
  assert.equal(e.voided, 1);
  assert.equal(e.voided_by, 'cathy');
  assert.equal(e.shares.length, 3);
  assert.equal(e.shares.find(s => s.user === 'bob').settled, 0);
});

test('payer may pay only for others; zero penny shares require no transfer; currencies stay distinct', async t => {
  const { db } = database(t);
  await createExpense(db, 'alice', { ...bill(), amount: '0.01', users: ['bob', 'cathy'] });
  await createExpense(db, 'alice', { ...bill(), currency: 'CNY' });
  const data = await communityData(db, 'alice');
  assert.deepEqual([...new Set(data.expenses.map(e => e.currency))].sort(), ['CNY', 'GBP']);
  const tiny = data.expenses.find(e => e.currency === 'GBP');
  assert.equal(tiny.shares.find(s => s.user === 'cathy').amount, 0);
  assert.equal(tiny.shares.find(s => s.user === 'cathy').settled, 1);
});

test('balances separate currencies and exclude own shares, settlements and voided expenses', async t => {
  const { db } = database(t);
  const first = await createExpense(db, 'alice', bill());
  await createExpense(db, 'bob', { ...bill(), payer: 'bob', amount: '9.00' });
  await createExpense(db, 'alice', { ...bill(), currency: 'CNY' });
  const calculate = async () => expenseBalances((await communityData(db, 'alice')).expenses, 'alice');
  assert.deepEqual(await calculate(), [
    { currency: 'GBP', total: 1900, pay: 300, receive: 666 },
    { currency: 'CNY', total: 1000, pay: 0, receive: 666 },
  ]);
  await settleShare(db, 'bob', { id: first.id, user: 'bob', revision: 0, settled: true });
  assert.equal((await calculate())[0].receive, 333);
  await voidExpense(db, 'alice', { id: first.id });
  assert.deepEqual((await calculate())[0], { currency: 'GBP', total: 900, pay: 300, receive: 0 });
});
