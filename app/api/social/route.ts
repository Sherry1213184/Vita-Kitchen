import { db, bucket, identity, SignInRequired } from '@/lib/kitchen';
import { CommunityError } from '@/lib/community';
import { OrderError, parseOrderCursor } from '@/lib/orders';
import { socialData, createPoll, vote, setPollClosed, createMemory, editMemory } from '@/lib/social';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(e: unknown) {
  if (e instanceof SignInRequired) return json({ error: '请重新登录。' }, 401);
  if (e instanceof CommunityError || e instanceof OrderError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: '暂时无法保存或加载，请稍后重试。输入仍然保留。' }, 503);
}
export async function GET(req: Request) {
  try {
    const u = await identity(), search = new URL(req.url).searchParams;
    const activityId = search.get('activity') || '';
    if (activityId.length > 100) return json({ error: '活动编号无效' }, 400);
    return json(await socialData(db(), u.userId, activityId, parseOrderCursor(search.get('before'))));
  } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    const u = await identity();
    if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return json({ error: '无效请求' }, 403);
    let input: unknown, file: File | undefined;
    try {
      if (req.headers.get('content-type')?.includes('multipart/form-data')) {
        const form = await req.formData(), photo = form.get('photo');
        input = JSON.parse(String(form.get('data')));
        if (photo !== null && !(photo instanceof File)) return json({ error: '图片格式无效' }, 400);
        file = photo instanceof File ? photo : undefined;
      } else input = await req.json();
    } catch { return json({ error: '请求格式无效' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: '请求格式无效' }, 400);
    const b = input as Record<string, unknown>;
    switch (b.action) {
      case 'poll': return json({ ok: true, ...await createPoll(db(), u.userId, b) });
      case 'vote': await vote(db(), u.userId, b); break;
      case 'poll-status': await setPollClosed(db(), b); break;
      case 'memory': return json({ ok: true, ...await createMemory(db(), bucket(), u.userId, b, file) });
      case 'memory-edit': await editMemory(db(), u.userId, b); break;
      default: return json({ error: '无效操作' }, 400);
    }
    return json({ ok: true });
  } catch (e) { return failure(e); }
}
