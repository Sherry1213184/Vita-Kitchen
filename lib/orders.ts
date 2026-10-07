/** Shared SQL operations; no platform imports so they can be tested on SQLite. */
type Database = Pick<D1Database, 'prepare'>;
type Item = { id: string; qty: number };
type Dish = { id: string; name: string; available: number };
export type OrderCursor = { created: string; id: string };
export const ORDER_PAGE_SIZE = 20;

export class OrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseOrderCursor(raw: string | null): OrderCursor | undefined {
  if (!raw) return undefined;
  try {
    if (raw.length > 300) throw new Error();
    const value = JSON.parse(raw);
    if (typeof value?.created !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.created) ||
        value.created.length > 40 || !Number.isFinite(Date.parse(value.created)) ||
        typeof value.id !== 'string' || !value.id || value.id.length > 100) throw new Error();
    return { created: value.created, id: value.id };
  } catch {
    throw new OrderError('订单页码无效，请返回最新订单。');
  }
}

export async function personalOrders(database: Database, user: string, before?: OrderCursor) {
  const params = before ? [user, before.created, before.created, before.id] : [user];
  const { results } = await database.prepare(`
    SELECT o.*, EXISTS(SELECT 1 FROM reviews r WHERE r.order_id=o.id) AS hasReview
    FROM orders o WHERE o.user=?
    ${before ? 'AND (o.created < ? OR (o.created = ? AND o.id < ?))' : ''}
    ORDER BY o.created DESC, o.id DESC LIMIT ?
  `).bind(...params, ORDER_PAGE_SIZE + 1).all();
  const orders = results.slice(0, ORDER_PAGE_SIZE);
  const last = orders.at(-1);
  return {
    orders,
    ordersNextCursor: results.length > ORDER_PAGE_SIZE && last
      ? { created: last.created as string, id: last.id as string } : null,
  };
}

function text(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}

function itemSignature(items: Item[]) {
  return JSON.stringify(items.map(({ id, qty }) => ({ id, qty })).sort((a, b) => a.id.localeCompare(b.id)));
}

export async function placeOrder(
  database: Database, user: string, input: Record<string, unknown>, getMenu: () => Promise<Dish[]>,
) {
  const name = text(input.name, 40), room = text(input.room, 20), note = text(input.note, 500);
  const rawItems = input.items;
  if (!name || !room || !Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 30 ||
      (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length > 500))) {
    throw new OrderError('请填写昵称、房间号并选择菜品；备注限 500 字。');
  }
  const ids = new Set<string>();
  const items: Item[] = rawItems.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 ||
        !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20 || ids.has(item.id)) {
      throw new OrderError('菜品或数量无效，请检查点菜单。');
    }
    ids.add(item.id);
    return { id: item.id, qty: item.qty };
  });
  // A user-scoped deterministic primary key makes retries atomic without a schema change.
  // Older clients without requestId still work, but do not receive retry protection.
  let id = crypto.randomUUID() as string;
  if (input.requestId !== undefined) {
    if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) {
      throw new OrderError('提交标识无效，请刷新后重试。');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([user, input.requestId])));
    id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const replay = async () => {
    const existing = await database.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!existing) return false;
    if (existing.user !== user || existing.name !== name || existing.room !== room || existing.note !== note ||
        itemSignature(JSON.parse(existing.items as string)) !== itemSignature(items)) {
      throw new OrderError('这次提交的内容已变化，请重新确认点菜单。', 409);
    }
    return true;
  };
  // Return the original result even if the dish was subsequently made unavailable.
  if (await replay()) return { id, replayed: true };
  const menu = await getMenu();
  const snapshot = items.map(item => {
    const dish = menu.find(d => d.id === item.id);
    if (!dish?.available) throw new OrderError('菜品状态已变化，请刷新菜单后重试。');
    return { ...item, name: dish.name };
  });
  const result = await database.prepare(`
    INSERT INTO orders (id,user,name,room,note,items,total,status,photo,created)
    VALUES (?,?,?,?,?,?,0,0,'',?) ON CONFLICT(id) DO NOTHING
  `).bind(id, user, name, room, note, JSON.stringify(snapshot), new Date().toISOString()).run();
  if (!result.meta.changes) await replay();
  return { id, replayed: !result.meta.changes };
}

export async function advanceOrder(database: Database, user: string, admin: boolean, id: string, status: unknown) {
  const order = await database.prepare('SELECT user,status FROM orders WHERE id=?').bind(id).first();
  if (!order) throw new OrderError('订单不存在。', 404);
  if (!admin && !(order.user === user && status === 4)) throw new OrderError('你没有修改这份订单的权限。', 403);
  if (!Number.isInteger(status) || (status as number) < 1 || (status as number) > 4) {
    throw new OrderError('请按顺序更新订单状态。');
  }
  if (status !== (order.status as number) + 1) throw new OrderError('订单状态已变化，请查看最新进度。', 409);
  const result = await database.prepare('UPDATE orders SET status=? WHERE id=? AND status=?')
    .bind(status, id, order.status).run();
  if (!result.meta.changes) throw new OrderError('朋友刚刚更新了这份订单，请查看最新进度。', 409);
}
