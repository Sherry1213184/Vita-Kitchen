import { currencies, parseAmount, splitAmount } from './community-money.ts';
import type { Activity, Expense, Member, Share, CommunityData } from './community-types';
type Database = Pick<D1Database, 'prepare' | 'batch'>;
type Input = Record<string, unknown>;
export class CommunityError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new CommunityError('请检查必填内容和文字长度');
  }
  return value.trim();
}
function date(value: unknown, required = false) {
  const result = text(value, 10, required);
  if (!result && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result || result < '2000-01-01' || result > '2100-12-31') {
    throw new CommunityError('请填写 2000–2100 年之间的有效日期');
  }
  return result;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CommunityError('版本无效，请刷新');
  return value as number;
}
async function creationId(user: string, requestId: unknown) {
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new CommunityError('请求编号无效');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([user, requestId])));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function members(db: Database) {
  return (await db.prepare("SELECT user,name FROM profiles WHERE name<>'' ORDER BY name,user").bind().all<Member>()).results;
}
export async function communityData(db: Database, me: string): Promise<CommunityData> {
  const [people, plans, rsvps, bills, shares] = await Promise.all([
    members(db), db.prepare('SELECT id,title,kind,starts_on,ends_on,location,notes,status,revision,updated,creator FROM activities ORDER BY CASE WHEN starts_on=\'\' THEN 1 ELSE 0 END, starts_on,id').bind().all<Omit<Activity, 'attendance'>>(),
    db.prepare("SELECT a.activity_id,a.user,a.choice,COALESCE(NULLIF(p.name,''),'未命名朋友') AS name FROM attendance a LEFT JOIN profiles p ON p.user=a.user").bind().all<{ activity_id: string } & Activity['attendance'][number]>(),
    db.prepare('SELECT id,title,amount,currency,payer,payer_name,activity_id,spent_on,note,created,voided,voided_by,voided_at FROM expenses ORDER BY spent_on DESC,created DESC,id DESC').bind().all<Omit<Expense, 'shares'>>(),
    db.prepare('SELECT * FROM expense_shares ORDER BY user').bind().all<Share & { expense_id: string }>(),
  ]);
  return { me, members: people,
    activities: plans.results.map(a => ({ ...a, attendance: rsvps.results.filter(r => r.activity_id === a.id) })),
    expenses: bills.results.map(e => ({ ...e, shares: shares.results.filter(s => s.expense_id === e.id) })),
  };
}
export async function saveActivity(db: Database, user: string, b: Input) {
  const title = text(b.title, 80, true), location = text(b.location, 200), notes = text(b.notes, 3000);
  const startsOn = date(b.starts_on), endsOn = date(b.ends_on);
  if (endsOn && (!startsOn || endsOn < startsOn)) throw new CommunityError('结束日期不能早于开始日期');
  if (b.kind !== 'gathering' && b.kind !== 'trip') throw new CommunityError('活动类型无效');
  if (!['planning', 'confirmed', 'completed', 'cancelled'].includes(String(b.status))) throw new CommunityError('活动状态无效');
  const now = new Date().toISOString();
  const values = [title, b.kind, startsOn, endsOn, location, notes, b.status];
  if (b.id) {
    const id = text(b.id, 100, true);
    const result = await db.prepare('UPDATE activities SET title=?,kind=?,starts_on=?,ends_on=?,location=?,notes=?,status=?,updated=?,revision=revision+1 WHERE id=? AND revision=?')
      .bind(...values, now, id, revision(b.revision)).run();
    if (!result.meta.changes) throw new CommunityError('活动已被朋友更新。请先保留需要的输入，再关闭编辑框、刷新并重新打开最新计划。', 409);
    return { id };
  }
  const id = await creationId(user, b.requestId), fingerprint = JSON.stringify(values);
  await db.prepare('INSERT INTO activities (id,title,kind,starts_on,ends_on,location,notes,status,creator,created,updated,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, ...values, user, now, now, fingerprint).run();
  const saved = await db.prepare('SELECT fingerprint FROM activities WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (saved?.fingerprint !== fingerprint) throw new CommunityError('此次请求内容已改变，请重新打开新建活动', 409);
  return { id };
}
export async function setAttendance(db: Database, user: string, b: Input) {
  if (!['yes', 'maybe', 'no'].includes(String(b.choice))) throw new CommunityError('报名选项无效');
  const result = await db.prepare("INSERT INTO attendance (activity_id,user,choice) SELECT id,?,? FROM activities WHERE id=? AND status IN ('planning','confirmed') ON CONFLICT(activity_id,user) DO UPDATE SET choice=excluded.choice")
    .bind(user, b.choice, text(b.id, 100, true)).run();
  if (!result.meta.changes) throw new CommunityError('活动已结束或取消，请刷新查看', 409);
}
export async function createExpense(db: Database, user: string, b: Input) {
  const title = text(b.title, 80, true), note = text(b.note, 500), spentOn = date(b.spent_on, true);
  const amount = parseAmount(b.amount), payer = text(b.payer, 200, true);
  if (amount === null || !currencies.includes(b.currency as typeof currencies[number])) throw new CommunityError('金额须大于 0、最多两位小数，最高 1,000,000；请选择支持的币种');
  if (!Array.isArray(b.users) || !b.users.length || b.users.length > 30 || b.users.some(u => typeof u !== 'string') || new Set(b.users).size !== b.users.length) throw new CommunityError('请选择 1–30 位分摊成员，不可重复');
  const users = [...b.users as string[]].sort(), activityId = text(b.activity_id, 100) || null;
  const fingerprint = JSON.stringify([title, amount, b.currency, payer, activityId, spentOn, note, users]);
  const id = await creationId(user, b.requestId);
  const previous = await db.prepare('SELECT fingerprint FROM expenses WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new CommunityError('此次请求内容已改变，请重新打开记账', 409);
    return { id }; // A retry never recreates settled or voided bills.
  }
  const people = await members(db), names = new Map(people.map(p => [p.user, p.name]));
  if (!names.has(payer) || users.some(u => !names.has(u))) throw new CommunityError('请让参与者先在“朋友 / 我的资料”保存昵称，再刷新记账');
  if (activityId && !await db.prepare('SELECT id FROM activities WHERE id=?').bind(activityId).first()) throw new CommunityError('关联的活动不存在');
  const now = new Date().toISOString();
  // D1 batch is atomic. Conditional child inserts also protect conflicting concurrent retries.
  await db.batch([
    db.prepare('INSERT INTO expenses (id,title,amount,currency,payer,payer_name,activity_id,spent_on,note,creator,created,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id, title, amount, b.currency, payer, names.get(payer), activityId, spentOn, note, user, now, fingerprint),
    ...splitAmount(amount, users).map(s => db.prepare('INSERT INTO expense_shares (expense_id,user,name,amount,settled) SELECT id,?,?,?,? FROM expenses WHERE id=? AND fingerprint=? ON CONFLICT(expense_id,user) DO NOTHING')
      .bind(s.user, names.get(s.user), s.amount, s.user === payer || s.amount === 0 ? 1 : 0, id, fingerprint)),
  ]);
  const saved = await db.prepare('SELECT fingerprint FROM expenses WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (saved?.fingerprint !== fingerprint) throw new CommunityError('此次请求内容已改变，请重新打开记账', 409);
  return { id };
}
export async function settleShare(db: Database, user: string, b: Input) {
  if (typeof b.settled !== 'boolean') throw new CommunityError('结清状态无效');
  const id = text(b.id, 100, true), member = text(b.user, 200, true);
  const result = await db.prepare('UPDATE expense_shares SET settled=?,settled_by=?,settled_at=?,revision=revision+1 WHERE expense_id=? AND user=? AND revision=? AND amount>0 AND EXISTS (SELECT 1 FROM expenses e WHERE e.id=expense_id AND e.voided=0 AND e.payer<>?)')
    .bind(b.settled ? 1 : 0, user, new Date().toISOString(), id, member, revision(b.revision), member).run();
  if (!result.meta.changes) throw new CommunityError('账单状态已变化，请刷新后核对', 409);
}
export async function voidExpense(db: Database, user: string, b: Input) {
  const id = text(b.id, 100, true);
  // Keep the bill and all settlement records for later checking; no hard deletion.
  await db.prepare('UPDATE expenses SET voided=1,voided_by=?,voided_at=? WHERE id=? AND voided=0')
    .bind(user, new Date().toISOString(), id).run();
  if (!await db.prepare('SELECT id FROM expenses WHERE id=?').bind(id).first()) throw new CommunityError('账单不存在', 404);
}
