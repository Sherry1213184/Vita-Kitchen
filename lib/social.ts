import { CommunityError } from './community.ts';
import type { Member } from './community-types';
import type { Poll, Memory, SocialData } from './social-types';
type Database = Pick<D1Database, 'prepare' | 'batch'>;
type Storage = Pick<R2Bucket, 'put'>;
type Input = Record<string, unknown>;
const fail = (message: string, status = 400): never => { throw new CommunityError(message, status); };
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) return fail('请检查必填内容与文字长度');
  return value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail('版本无效，请刷新');
  return value as number;
}
async function digest(value: string | ArrayBuffer) {
  const bytes = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function idFor(user: string, requestId: unknown) {
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) return fail('请求编号无效');
  return digest(JSON.stringify([user, requestId]));
}
async function activity(db: Database, value: unknown) {
  const id = text(value, 100) || null;
  if (id && !await db.prepare('SELECT id FROM activities WHERE id=?').bind(id).first()) return fail('关联活动不存在');
  return id;
}
export async function socialData(db: Database, me: string, activityId = '', before?: { created: string; id: string }): Promise<SocialData> {
  const [members, activities, polls, votes, memories] = await Promise.all([
    db.prepare("SELECT user,name FROM profiles WHERE name<>'' ORDER BY name,user").bind().all<Member>(),
    db.prepare('SELECT id,title FROM activities ORDER BY created DESC,id DESC').bind().all<{ id: string; title: string }>(),
    db.prepare('SELECT id,activity_id,title,kind,options,closed,revision,created FROM polls WHERE (?=\'\' OR activity_id=?) ORDER BY created DESC,id DESC').bind(activityId, activityId).all<Omit<Poll, 'options' | 'ballots'> & { options: string }>(),
    db.prepare("SELECT b.*,COALESCE(NULLIF(p.name,''),'未命名朋友') AS name FROM ballots b LEFT JOIN profiles p ON p.user=b.user JOIN polls q ON q.id=b.poll_id WHERE (?='' OR q.activity_id=?) ORDER BY b.user").bind(activityId, activityId).all<{ poll_id: string; user: string; choices: string; name: string; revision: number }>(),
    db.prepare(`SELECT id,activity_id,title,body,happened_on,people,image,author,author_name,created,updated,revision FROM memories WHERE (?='' OR activity_id=?) ${before ? 'AND (created<? OR (created=? AND id<?))' : ''} ORDER BY created DESC,id DESC LIMIT 21`)
      .bind(activityId, activityId, ...(before ? [before.created, before.created, before.id] : [])).all<Omit<Memory, 'people'> & { people: string }>(),
  ]);
  const page = memories.results.slice(0, 20), last = page.at(-1);
  return { me, members: members.results, activities: activities.results,
    polls: polls.results.map(p => ({ ...p, options: JSON.parse(p.options), ballots: votes.results.filter(b => b.poll_id === p.id).map(b => ({ ...b, choices: JSON.parse(b.choices) })) })),
    memories: page.map(m => ({ ...m, people: JSON.parse(m.people) })),
    nextCursor: memories.results.length > 20 && last ? { created: last.created, id: last.id } : null,
  };
}
export async function createPoll(db: Database, user: string, b: Input) {
  const title = text(b.title, 80, true);
  if (b.kind !== 'date' && b.kind !== 'place') return fail('投票类型无效');
  if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 10) return fail('请填写 2–10 个选项');
  const options = b.options.map(o => text(o, 100, true));
  if (new Set(options).size !== options.length) return fail('投票选项不能重复');
  const activityId = await activity(db, b.activity_id), id = await idFor(user, b.requestId);
  const fingerprint = JSON.stringify([title, b.kind, activityId, options]);
  await db.prepare('INSERT INTO polls (id,activity_id,title,kind,options,creator,created,fingerprint) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, activityId, title, b.kind, JSON.stringify(options), user, new Date().toISOString(), fingerprint).run();
  const existing = await db.prepare('SELECT fingerprint FROM polls WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (existing?.fingerprint !== fingerprint) return fail('本次请求内容已改变，请重新打开新建投票', 409);
  return { id };
}
export async function vote(db: Database, user: string, b: Input) {
  const id = text(b.id, 100, true), version = revision(b.revision);
  const poll = await db.prepare('SELECT options FROM polls WHERE id=?').bind(id).first<{ options: string }>();
  if (!poll) return fail('投票不存在', 404);
  const prior = await db.prepare('SELECT revision FROM ballots WHERE poll_id=? AND user=?').bind(id, user).first();
  if (!prior && version !== 0) return fail('答卷版本无效，请刷新', 409);
  const count = JSON.parse(poll.options).length;
  if (!Array.isArray(b.choices) || b.choices.length > count || b.choices.some(n => !Number.isInteger(n) || n < 0 || n >= count) || new Set(b.choices).size !== b.choices.length) return fail('请选择有效且不重复的选项');
  // Empty choices withdraw the ballot. Each person has one versioned response.
  const result = await db.prepare('INSERT INTO ballots (poll_id,user,choices,revision) SELECT id,?,?,1 FROM polls WHERE id=? AND closed=0 ON CONFLICT(poll_id,user) DO UPDATE SET choices=excluded.choices,revision=ballots.revision+1 WHERE ballots.revision=?')
    .bind(user, JSON.stringify([...b.choices].sort((a, c) => a - c)), id, version).run();
  if (!result.meta.changes) return fail('投票已结束或你的答卷已在其他页面更新，请刷新后再试', 409);
}
export async function setPollClosed(db: Database, b: Input) {
  if (typeof b.closed !== 'boolean') return fail('状态无效');
  const result = await db.prepare('UPDATE polls SET closed=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(b.closed ? 1 : 0, text(b.id, 100, true), revision(b.revision)).run();
  if (!result.meta.changes) return fail('投票状态已变化，请刷新', 409);
}
async function memoryFields(db: Database, b: Input) {
  const title = text(b.title, 80, true), body = text(b.body, 2000), happenedOn = text(b.happened_on, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || !Number.isFinite(Date.parse(happenedOn)) || new Date(happenedOn).toISOString().slice(0, 10) !== happenedOn || happenedOn < '2000-01-01' || happenedOn > '2100-12-31') return fail('请填写有效的回忆日期（2000–2100 年）');
  if (!Array.isArray(b.people) || b.people.length > 30 || b.people.some(p => typeof p !== 'string') || new Set(b.people).size !== b.people.length) return fail('同行朋友名单无效');
  const people: Member[] = [];
  for (const user of [...b.people as string[]].sort()) {
    const person = await db.prepare("SELECT user,name FROM profiles WHERE user=? AND name<>''").bind(user).first<Member>();
    if (!person) return fail('同行朋友须先保存昵称，请刷新名单');
    people.push(person);
  }
  return { title, body, happenedOn, people, activityId: await activity(db, b.activity_id) };
}
export async function readPhoto(file?: File) {
  if (!file || !file.size) return null;
  if (file.size > 5 * 1024 * 1024) return fail('请选择不超过 5MB 的 JPG、PNG 或 WebP 图片');
  const bytes = await file.arrayBuffer(), a = new Uint8Array(bytes);
  const type = a.length > 3 && a[0] === 255 && a[1] === 216 && a[2] === 255 ? 'image/jpeg'
    : a.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => a[i] === n) ? 'image/png'
    : a.length > 12 && String.fromCharCode(...a.slice(0, 4)) === 'RIFF' && String.fromCharCode(...a.slice(8, 12)) === 'WEBP' ? 'image/webp' : null;
  if (!type) return fail('仅支持 JPG、PNG、WebP；HEIC 请先转成 JPG');
  return { bytes, type, hash: await digest(bytes) };
}
export async function createMemory(db: Database, storage: Storage, user: string, b: Input, file?: File) {
  const fields = await memoryFields(db, b), photo = await readPhoto(file), id = await idFor(user, b.requestId);
  if (!fields.body && !photo) return fail('写一段小记，或选择一张照片');
  // Fingerprint identities, not mutable nicknames, so a nickname edit cannot break a retry.
  const fingerprint = JSON.stringify([fields.title, fields.body, fields.happenedOn, fields.activityId, fields.people.map(p => p.user), photo?.hash ?? '']);
  const prior = await db.prepare('SELECT fingerprint FROM memories WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (prior) {
    if (prior.fingerprint !== fingerprint) return fail('本次请求内容已改变，请重新打开记录回忆', 409);
    return { id };
  }
  let image = '';
  if (photo) {
    // Deterministic per-request and per-content UUID-shaped key: retries never create extra blobs
    // or overwrite a different photo. D1 references gate access through /api/images.
    const hash = await digest(JSON.stringify([id, photo.hash]));
    const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    await storage.put(key, photo.bytes, { httpMetadata: { contentType: photo.type } });
    image = '/api/images/' + key;
  }
  const author = await db.prepare('SELECT name FROM profiles WHERE user=?').bind(user).first<{ name: string }>();
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO memories (id,activity_id,title,body,happened_on,people,image,author,author_name,created,updated,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(id, fields.activityId, fields.title, fields.body, fields.happenedOn, JSON.stringify(fields.people), image, user, author?.name || '未命名朋友', now, now, fingerprint).run();
  const saved = await db.prepare('SELECT fingerprint FROM memories WHERE id=?').bind(id).first<{ fingerprint: string }>();
  if (saved?.fingerprint !== fingerprint) return fail('本次请求内容已改变，请重新打开记录回忆', 409);
  return { id };
}
export async function editMemory(db: Database, user: string, b: Input) {
  const id = text(b.id, 100, true);
  const previous = await db.prepare('SELECT author,image FROM memories WHERE id=?').bind(id).first<{ author: string; image: string }>();
  if (!previous) return fail('回忆不存在', 404);
  if (previous.author !== user) return fail('只能编辑自己留下的回忆', 403);
  const fields = await memoryFields(db, b);
  if (!fields.body && !previous.image) return fail('请保留一段小记');
  const result = await db.prepare('UPDATE memories SET title=?,body=?,happened_on=?,people=?,activity_id=?,updated=?,revision=revision+1 WHERE id=? AND author=? AND revision=?')
    .bind(fields.title, fields.body, fields.happenedOn, JSON.stringify(fields.people), fields.activityId, new Date().toISOString(), id, user, revision(b.revision)).run();
  if (!result.meta.changes) return fail('回忆已在其他页面更新，请保留输入后关闭、刷新并重新编辑', 409);
}
