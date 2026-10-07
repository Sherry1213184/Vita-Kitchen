import { db, identity, SignInRequired } from '@/lib/kitchen';
import { CommunityError, communityData, saveActivity, setAttendance, createExpense, settleShare, voidExpense } from '@/lib/community';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(e: unknown) {
  if (e instanceof SignInRequired) return json({ error: '请重新登录。' }, 401);
  if (e instanceof CommunityError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: '暂时无法连接，请稍后重试。你的输入仍然保留。' }, 503);
}
export async function GET() {
  try { const u = await identity(); return json(await communityData(db(), u.userId)); }
  catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    const u = await identity();
    if (req.headers.get('origin') && new URL(req.url).origin !== req.headers.get('origin')) return json({ error: '无效请求' }, 403);
    let input: unknown;
    try { input = await req.json(); } catch { return json({ error: '请求格式无效' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: '请求格式无效' }, 400);
    const b = input as Record<string, unknown>;
    switch (b.action) {
      case 'activity': return json({ ok: true, ...await saveActivity(db(), u.userId, b) });
      case 'attendance': await setAttendance(db(), u.userId, b); break;
      case 'expense': return json({ ok: true, ...await createExpense(db(), u.userId, b) });
      case 'settle': await settleShare(db(), u.userId, b); break;
      case 'void': await voidExpense(db(), u.userId, b); break;
      default: return json({ error: '无效操作' }, 400);
    }
    return json({ ok: true });
  } catch (e) { return failure(e); }
}
