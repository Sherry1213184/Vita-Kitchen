'use client';
import { useEffect, useRef, useState } from 'react';
import { BarChart3, Camera, Check, ImagePlus, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { kitchenRequest, KitchenRequestError } from '@/lib/kitchen-client';
import type { Memory, Poll, SocialData } from '@/lib/social-types';

const request = (body?: object | FormData, query = '') => kitchenRequest(body, query, '/api/social');
type Sender = (body: Record<string, unknown>, create?: boolean, photo?: File) => Promise<boolean>;
type MemoryDraft = { id?: string; revision?: number; title: string; body: string; happened_on: string; activity_id: string; people: string[]; image?: string };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function PollCard({ poll, me, busy, send }: { poll: Poll; me: string; busy: boolean; send: Sender }) {
  const mine = poll.ballots.find(b => b.user === me);
  const [selected, setSelected] = useState<number[]>(mine?.choices ?? []);
  useEffect(() => { setSelected(mine?.choices ?? []); }, [mine?.revision, poll.closed]);
  const answered = poll.ballots.filter(b => b.choices.length > 0).length;
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...(mine?.choices ?? [])].sort());
  return <article className="poll-card">
    <div className="poll-heading"><span className="social-tag">{poll.kind === 'date' ? '约个时间' : '想去哪里'}</span><span className="poll-state">{poll.closed ? '已结束' : '投票中'}</span></div>
    <h2>{poll.title}</h2><p className="social-muted">{answered} 人已投 · 实名多选，选所有合适的选项</p>
    <div className="poll-options">{poll.options.map((option, i) => {
      const voters = poll.ballots.filter(b => b.choices.includes(i));
      return <div className="poll-option" key={i}>
        <label><input type="checkbox" checked={selected.includes(i)} disabled={!!poll.closed || busy} onChange={e => setSelected(e.target.checked ? [...selected, i] : selected.filter(n => n !== i))}/><span>{option}</span><strong>{voters.length} 票</strong></label>
        <div className="vote-track" aria-hidden="true"><span style={{ width: `${voters.length / Math.max(answered, 1) * 100}%` }}/></div>
        {!!voters.length && <small>{voters.map(v => v.name).join('、')}</small>}
      </div>;
    })}</div>
    <div className="poll-actions">{!poll.closed && <button disabled={busy || !changed} onClick={() => send({ action: 'vote', id: poll.id, revision: mine?.revision ?? 0, choices: selected })}><Check size={15}/>{selected.length ? '保存选择' : '撤回我的选择'}</button>}<button className="text-button" disabled={busy} onClick={() => send({ action: 'poll-status', id: poll.id, revision: poll.revision, closed: !poll.closed })}>{poll.closed ? '重新开放' : '结束投票'}</button></div>
  </article>;
}

export default function Social({ signedIn, signIn, initialActivity = '' }: { signedIn: boolean; signIn: string; initialActivity?: string }) {
  const [section, setSection] = useState<'polls' | 'memories'>('polls');
  const [filter, setFilter] = useState(initialActivity), [includeClosed, setIncludeClosed] = useState(false);
  const [data, setData] = useState<SocialData | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [poll, setPoll] = useState<{ title: string; kind: 'date' | 'place'; activity_id: string; options: string } | null>(null);
  const [memory, setMemory] = useState<MemoryDraft | null>(null), [photo, setPhoto] = useState<File | undefined>(), [preview, setPreview] = useState('');
  const [view, setView] = useState<Memory | null>(null);
  const sequence = useRef(0), saving = useRef(false), token = useRef<{ fingerprint: string; id: string } | null>(null), photoVersion = useRef('');
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function load(more = false) {
    const n = ++sequence.current, params = new URLSearchParams({ activity: filter });
    if (more && data?.nextCursor) params.set('before', JSON.stringify(data.nextCursor));
    setLoading(true);
    try {
      const next: SocialData = await request(undefined, '?' + params);
      if (n === sequence.current) {
        setData(previous => more && previous ? { ...next, memories: [...previous.memories, ...next.memories.filter(m => !previous.memories.some(p => p.id === m.id))] } : next);
        setError('');
      }
      return true;
    } catch (e) { if (n === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); return false; }
    finally { if (n === sequence.current) setLoading(false); }
  }
  useEffect(() => { setData(null); if (signedIn) void load(); return () => { sequence.current++; }; }, [signedIn, filter]);
  const send: Sender = async (body, create = false, file) => {
    if (saving.current) return false;
    saving.current = true; setBusy(true);
    const fingerprint = JSON.stringify([body, file ? photoVersion.current : '']);
    if (create && token.current?.fingerprint !== fingerprint) token.current = { fingerprint, id: crypto.randomUUID() };
    const payload = { ...body, ...(create ? { requestId: token.current!.id } : {}) };
    try {
      if (file) { const form = new FormData(); form.set('data', JSON.stringify(payload)); form.set('photo', file); await request(form); }
      else await request(payload);
      if (create) token.current = null;
      const fresh = await load();
      toast.success(fresh ? '已保存' : '已保存，列表暂未更新，请稍后刷新');
      return true;
    } catch (e) {
      if (e instanceof KitchenRequestError && e.status === 409) await load();
      toast.error(e instanceof Error ? e.message : '保存失败'); return false;
    } finally { saving.current = false; setBusy(false); }
  };
  function newPoll() { token.current = null; setPoll({ title: '', kind: 'date', activity_id: filter, options: '' }); }
  function newMemory() { token.current = null; setPhoto(undefined); setMemory({ title: '', body: '', happened_on: today(), activity_id: filter, people: [] }); }
  const activityName = (id: string | null) => data?.activities.find(a => a.id === id)?.title;
  const polls = data?.polls.filter(p => includeClosed || !p.closed) ?? [];
  const closeMemory = () => { if (!busy) { setMemory(null); setPhoto(undefined); } };
  if (!signedIn) return <div className="empty"><h2>一起决定，也一起记得</h2><p>登录后参与投票、查看朋友们留下的回忆。</p><a className="checkout" href={signIn} target="_top">登录后使用</a></div>;

  return <section className="social-space">
    <div className="section-heading community-heading"><div><h1>投票与回忆</h1><p>下一次去哪，一起决定。那些好日子，一起留下。</p></div><div className="community-actions"><button className="secondary-button" disabled={loading || busy} onClick={() => load()}>刷新</button><button disabled={!data || busy} onClick={section === 'polls' ? newPoll : newMemory}><Plus size={17}/>{section === 'polls' ? '发起投票' : '记录回忆'}</button></div></div>
    <div className="community-toolbar"><div className="order-filters" aria-label="朋友空间内容"><button className={section === 'polls' ? 'selected' : ''} aria-pressed={section === 'polls'} onClick={() => setSection('polls')}><BarChart3 size={16}/>一起投票</button><button className={section === 'memories' ? 'selected' : ''} aria-pressed={section === 'memories'} onClick={() => setSection('memories')}><Camera size={16}/>回忆墙</button></div>
      <label className="activity-filter">查看范围<select value={filter} disabled={busy} onChange={e => setFilter(e.target.value)}><option value="">全部活动与日常</option>{data?.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div>
    {error && <div className="error" role="alert">{error}<button onClick={() => load()}>重试</button><a href={signIn} target="_top">重新登录</a></div>}
    {loading && !data && <p role="status">正在加载朋友们的记录…</p>}
    {data && (section === 'polls' ? <>
      <div className="social-scope"><p>勾选后保存；清空选项并保存可撤回。投票结果不自动修改活动日期或报名。</p><label><input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)}/>包含已结束</label></div>
      {polls.length ? <div className="plan-grid">{polls.map(p => <div key={p.id}>{p.activity_id && <p className="social-context">{activityName(p.activity_id)}</p>}<PollCard poll={p} me={data.me} busy={busy} send={send}/></div>)}</div> : <div className="empty"><BarChart3/><h2>把“都可以”变成一个决定</h2><p>列几个日期或目的地，看看大家的选择。</p><button onClick={newPoll}>发起投票</button></div>}
    </> : <>
      <p className="social-scope">最近记录在前 · 照片和小记仅对获邀成员可见 · 每条可附一张照片</p>
      {data.memories.length ? <div className="memory-grid">{data.memories.map(m => <article className="memory-card" key={m.id}>
        {m.image && <button className="memory-photo" onClick={() => setView(m)} aria-label={`查看照片：${m.title}`}><img src={m.image} alt={m.title} loading="lazy"/></button>}
        <div className="memory-content"><p className="memory-date">{m.happened_on}{m.activity_id && ` · ${activityName(m.activity_id)}`}</p><h2>{m.title}</h2>{m.body && <p className="memory-body">{m.body}</p>}
          {!!m.people.length && <p className="memory-people"><Users size={15}/>{m.people.map(p => p.name).join('、')}</p>}
          <div className="memory-footer"><small>{m.author_name} 留下的回忆{m.revision > 0 ? ' · 已编辑' : ''}</small>{m.author === data.me && <button className="text-button" disabled={busy} onClick={() => { setPhoto(undefined); setMemory({ id: m.id, revision: m.revision, title: m.title, body: m.body, happened_on: m.happened_on, activity_id: m.activity_id || '', people: m.people.map(p => p.user), image: m.image }); }}>编辑记录</button>}</div>
        </div>
      </article>)}</div> : <div className="empty"><Camera/><h2>第一段共同回忆</h2><p>一张合照、一顿饭，或者今天的一件小事。</p><button onClick={newMemory}>记录回忆</button></div>}
      {data.nextCursor && <div className="order-pagination"><button disabled={loading || busy} onClick={() => load(true)}>{loading ? '正在加载…' : '更早的回忆'}</button></div>}
    </>)}
    <Dialog open={!!poll} onOpenChange={open => !open && !busy && setPoll(null)}><DialogContent className="community-dialog"><DialogTitle>发起一个小投票</DialogTitle><DialogDescription>每人可选多个选项。日期或时段请写清楚，异地活动注明时区。</DialogDescription>{poll && <form onSubmit={async e => { e.preventDefault(); if (await send({ action: 'poll', ...poll, options: poll.options.split('\n').map(s => s.trim()).filter(Boolean) }, true)) setPoll(null); }}>
      <label>想让大家决定什么<input required maxLength={80} value={poll.title} onChange={e => setPoll({ ...poll, title: e.target.value })} placeholder="哪天方便一起出门？"/></label>
      <label>投票类型<select value={poll.kind} onChange={e => setPoll({ ...poll, kind: e.target.value as 'date' | 'place' })}><option value="date">日期 / 时段</option><option value="place">目的地 / 地点</option></select></label>
      <label>关联活动（可选）<select value={poll.activity_id} onChange={e => setPoll({ ...poll, activity_id: e.target.value })}><option value="">日常讨论</option>{data?.activities.map(a => <option value={a.id} key={a.id}>{a.title}</option>)}</select></label>
      <label>选项（每行一个，2–10 个）<textarea required rows={5} maxLength={1100} value={poll.options} onChange={e => setPoll({ ...poll, options: e.target.value })} placeholder={poll.kind === 'date' ? '10 月 17 日，周六下午\n10 月 18 日，周日下午' : 'Brighton 海边\nCambridge 散步\n留在公寓吃火锅'}/></label>
      <small>发布后选项固定，需要调整时可结束旧投票并重新发起。</small><button disabled={busy} type="submit">{busy ? '正在保存…' : '发布投票'}</button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!memory} onOpenChange={open => !open && closeMemory()}><DialogContent className="community-dialog"><DialogTitle>{memory?.id ? '编辑这段回忆' : '留下一段回忆'}</DialogTitle><DialogDescription>大家都能看见，只有你能编辑自己留下的记录。</DialogDescription>{memory && <form onSubmit={async e => {
      e.preventDefault(); const { image: _, ...fields } = memory;
      if (await send({ action: memory.id ? 'memory-edit' : 'memory', ...fields }, !memory.id, memory.id ? undefined : photo)) { setMemory(null); setPhoto(undefined); }
    }}>
      <label>给这一天一个标题<input required maxLength={80} value={memory.title} onChange={e => setMemory({ ...memory, title: e.target.value })} placeholder="海边的风，和一起迷路的我们"/></label>
      <div className="form-pair"><label>发生日期<input required type="date" min="2000-01-01" max="2100-12-31" value={memory.happened_on} onInput={e => setMemory({ ...memory, happened_on: e.currentTarget.value })} onChange={e => setMemory({ ...memory, happened_on: e.target.value })}/></label><label>关联活动<select value={memory.activity_id} onChange={e => setMemory({ ...memory, activity_id: e.target.value })}><option value="">日常小事</option>{data?.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label></div>
      <label>想记住的事<textarea rows={5} maxLength={2000} value={memory.body} onChange={e => setMemory({ ...memory, body: e.target.value })} placeholder="谁说了一句好笑的话？那天吃了什么？"/></label>
      <fieldset className="members-field"><legend>一起的朋友（可选）</legend><div className="member-options">{data?.members.map(p => <label key={p.user}><input type="checkbox" checked={memory.people.includes(p.user)} onChange={e => setMemory({ ...memory, people: e.target.checked ? [...memory.people, p.user] : memory.people.filter(u => u !== p.user) })}/>{p.name}</label>)}</div><small>朋友先保存昵称，才会出现在名单中。</small></fieldset>
      {!memory.id ? <label className="memory-upload"><span><ImagePlus size={17}/>添加一张照片（可选）</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file && file.size > 5 * 1024 * 1024) { toast.error('请选择不超过 5MB 的图片'); e.target.value = ''; setPhoto(undefined); return; } photoVersion.current = crypto.randomUUID(); setPhoto(file); }}/><small>JPG / PNG / WebP，最多 5MB；HEIC 请先转为 JPG。</small></label> : memory.image && <small>此处修改文字、日期和同行朋友，原照片保留。</small>}
      {(preview || memory.image) && <img className="memory-upload-preview" src={preview || memory.image} alt="回忆照片预览"/>}
      <button disabled={busy || (!memory.body.trim() && !photo && !memory.image)} type="submit">{busy ? '正在保存…' : memory.id ? '保存修改' : '保存回忆'}</button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!view} onOpenChange={open => !open && setView(null)}><DialogContent className="memory-view"><DialogTitle>{view?.title}</DialogTitle><DialogDescription>{view?.happened_on} · {view?.author_name}</DialogDescription>{view && <img src={view.image} alt={view.title}/>}</DialogContent></Dialog>
  </section>;
}
