'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, MapPin, Plus, Wallet, Users, Check, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { kitchenRequest, KitchenRequestError } from '@/lib/kitchen-client';
import { currencies, money, parseAmount, splitAmount, expenseBalances, type Currency } from '@/lib/community-money';
import type { Activity, CommunityData, Expense } from '@/lib/community-types';

const states = { planning: '一起商量', confirmed: '已定好', completed: '已结束', cancelled: '已取消' };
const choices = { yes: '我参加', maybe: '待确定', no: '这次不去' };
const request = (body?: object) => kitchenRequest(body, '', '/api/community');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
type ActivityDraft = Pick<Activity, 'title' | 'kind' | 'starts_on' | 'ends_on' | 'location' | 'notes' | 'status'> & { id?: string; revision?: number };
type ExpenseDraft = { title: string; amount: string; currency: Currency; payer: string; users: string[]; activity_id: string; spent_on: string; note: string };
const openActivity = (a: Activity) => a.status === 'planning' || a.status === 'confirmed';
const outstanding = (e: Expense) => !e.voided && e.shares.some(s => s.user !== e.payer && s.amount > 0 && !s.settled);

export default function Community({ section, signedIn, signIn, onProfile }: {
  section: 'activities' | 'ledger'; signedIn: boolean; signIn: string; onProfile: () => void;
}) {
  const [data, setData] = useState<CommunityData | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false), [activityFilter, setActivityFilter] = useState('');
  const [plan, setPlan] = useState<ActivityDraft | null>(null), [bill, setBill] = useState<ExpenseDraft | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const sequence = useRef(0), saving = useRef(false), token = useRef<{ fingerprint: string; id: string } | null>(null);

  async function refresh() {
    const n = ++sequence.current;
    setLoading(true);
    try { const next = await request(); if (n === sequence.current) { setData(next); setError(''); } return true; }
    catch (e) { if (n === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); return false; }
    finally { if (n === sequence.current) setLoading(false); }
  }
  useEffect(() => { if (signedIn) void refresh(); else setLoading(false); return () => { sequence.current++; }; }, [signedIn]);

  async function send(body: Record<string, unknown>, create = false) {
    if (saving.current) return false;
    saving.current = true; setBusy(true);
    const fingerprint = JSON.stringify(body);
    if (create && token.current?.fingerprint !== fingerprint) token.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await request({ ...body, ...(create ? { requestId: token.current!.id } : {}) });
      if (create) token.current = null;
      const fresh = await refresh();
      toast.success(fresh ? '已保存' : '已保存；列表暂未更新，请稍后刷新');
      return true;
    } catch (e) {
      if (e instanceof KitchenRequestError && e.status === 409) await refresh();
      toast.error(e instanceof Error ? e.message : '保存失败'); return false;
    }
    finally { saving.current = false; setBusy(false); }
  }
  function newBill(activity = '') {
    if (!data) return;
    token.current = null;
    setBill({ title: '', amount: '', currency: 'GBP', payer: data.members.some(p => p.user === data.me) ? data.me : '',
      users: data.members.map(p => p.user), activity_id: activity, spent_on: today(), note: '' });
  }
  function newPlan() {
    token.current = null;
    setPlan({ title: '', kind: 'gathering', starts_on: '', ends_on: '', location: '', notes: '', status: 'planning' });
  }
  const scoped = data?.expenses.filter(e => !activityFilter || e.activity_id === activityFilter) ?? [];
  const shownBills = scoped.filter(e => all || outstanding(e));
  const shownPlans = data?.activities.filter(a => all || openActivity(a)) ?? [];
  const balances = expenseBalances(scoped, data?.me || '');
  const amount = bill ? parseAmount(bill.amount) : null;
  const preview = amount && bill?.users.length ? splitAmount(amount, bill.users) : [];
  const memberName = (user: string) => data?.members.find(m => m.user === user)?.name || '未命名朋友';

  if (!signedIn) return <div className="empty"><h2>和朋友一起安排下一次相聚</h2><p>登录后查看活动、报名和共享账本。</p><a className="checkout" href={signIn} target="_top">登录后使用</a></div>;
  return <section className="community">
    <div className="section-heading community-heading"><div><p className="eyebrow">{section === 'activities' ? 'MAKE TIME TOGETHER' : 'SHARED MOMENTS, SHARED COSTS'}</p><h1>{section === 'activities' ? '活动与出游' : '共享账本'}</h1><p>{section === 'activities' ? '从一顿聚餐，到一个周末。把下一次见面安排好。' : '谁先垫付、谁还没付，一眼就清楚。'}</p></div><div className="community-actions"><button className="secondary-button" disabled={loading || busy} onClick={refresh}>刷新</button><button disabled={!data || busy} onClick={section === 'activities' ? newPlan : () => newBill(activityFilter)}><Plus size={17}/>{section === 'activities' ? '发起活动' : '记一笔'}</button></div></div>
    {error && <div role="alert" className="error">{error}<a href={signIn} target="_top">重新登录</a></div>}
    {loading && !data && <p role="status">正在加载大家的记录…</p>}
    {data && <>
      {section === 'activities' ? <>
        <div className="community-toolbar"><div className="order-filters">{[[false, '进行中的计划'], [true, '全部记录']].map(([v, label]) => <button key={String(v)} className={all === v ? 'selected' : ''} aria-pressed={all === v} onClick={() => setAll(v as boolean)}>{label as string}</button>)}</div><small>获邀的朋友共同编辑 · 报名只代表自己</small></div>
        {shownPlans.length ? <div className="plan-grid">{shownPlans.map(a => <article className="plan-card" key={a.id}>
          <div className="plan-top"><div className="date-tile">{a.starts_on ? <><span>{Number(a.starts_on.slice(5, 7))} 月</span><strong>{Number(a.starts_on.slice(8, 10))}</strong></> : <><CalendarDays size={24}/><span>日期待定</span></>}</div><div className="plan-title"><div className="plan-tags"><span>{a.kind === 'trip' ? '出游' : '聚会'}</span><span className={'plan-status ' + a.status}>{states[a.status]}</span></div><h2>{a.title}</h2></div></div>
          <div className="plan-details"><p><CalendarDays size={16}/>{a.starts_on || '日期一起商量'}{a.ends_on && a.ends_on !== a.starts_on ? ` 至 ${a.ends_on}` : ''}</p><p><MapPin size={16}/>{a.location || '地点待定'}</p></div>
          {a.notes && <details className="itinerary"><summary>行程与备忘</summary><p>{a.notes}</p></details>}
          <div className="rsvp-summary"><Users size={16}/><span>{a.attendance.filter(r => r.choice === 'yes').length} 人参加 · {a.attendance.filter(r => r.choice === 'maybe').length} 人待定</span></div>
          {!!a.attendance.length && <p className="rsvp-names">{a.attendance.map(r => `${r.name}（${r.choice === 'yes' ? '参加' : r.choice === 'maybe' ? '待定' : '不去'}）`).join('、')}</p>}
          {openActivity(a) && <div className="rsvp-buttons" aria-label={`报名 ${a.title}`}>{Object.entries(choices).map(([choice, label]) => <button key={choice} disabled={busy} aria-pressed={a.attendance.some(r => r.user === data.me && r.choice === choice)} onClick={() => send({ action: 'attendance', id: a.id, choice })}>{label}</button>)}</div>}
          <div className="plan-footer"><button className="secondary-button" disabled={busy} onClick={() => setPlan({ id: a.id, revision: a.revision, title: a.title, kind: a.kind, starts_on: a.starts_on, ends_on: a.ends_on, location: a.location, notes: a.notes, status: a.status })}>编辑计划</button><button className="text-button" disabled={busy} onClick={() => newBill(a.id)}>为活动记账 <ArrowUpRight size={15}/></button></div>
        </article>)}</div> : <div className="empty"><CalendarDays/><h2>下一次，去哪里？</h2><p>先写下想法，日期和地点都可以稍后商量。</p><button onClick={newPlan}>发起第一个计划</button></div>}
      </> : <>
        <div className="community-toolbar"><label className="activity-filter">账本范围<select value={activityFilter} onChange={e => setActivityFilter(e.target.value)}><option value="">所有活动与日常开销</option>{data.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><small>默认 GBP · 不同币种分别统计</small></div>
        <div className="balance-grid">{balances.map(b => <div className="balance-card" key={b.currency}><span className="balance-currency">{b.currency}</span><div><span><ArrowUpRight size={16}/>我待付</span><strong>{money(b.pay, b.currency)}</strong></div><div><span><ArrowDownLeft size={16}/>我待收</span><strong>{money(b.receive, b.currency)}</strong></div><small>当前范围总开销 {money(b.total, b.currency)}</small></div>)}</div>
        <div className="community-toolbar"><div className="order-filters">{[[false, '待结清'], [true, '全部账单']].map(([v, label]) => <button key={String(v)} className={all === v ? 'selected' : ''} aria-pressed={all === v} onClick={() => setAll(v as boolean)}>{label as string}</button>)}</div><small>共同记账，标记结清不会执行转账</small></div>
        {shownBills.length ? <div className="expense-list">{shownBills.map(e => <article key={e.id} className={'expense-card ' + (e.voided ? 'voided' : '')}>
          <div className="expense-top"><div><p className="expense-date">{e.spent_on}{e.activity_id && ` · ${data.activities.find(a => a.id === e.activity_id)?.title || '关联活动'}`}</p><h2>{e.title}</h2><p>{e.payer_name} 垫付 · {e.shares.length} 人分摊</p></div><div className="expense-amount"><strong>{money(e.amount, e.currency)}</strong><span>{e.currency} · {e.voided ? '已作废' : outstanding(e) ? '待结清' : '已结清'}</span></div></div>
          {e.note && <p className="note">{e.note}</p>}
          <div className="share-list">{e.shares.map(s => <div key={s.user} className="share-row"><div><strong>{s.name}{s.user === data.me ? '（我）' : ''}</strong><small>{e.voided ? `原分摊记录 · ${s.settled ? '已结清' : '未结清'}（账单已作废）` : s.user === e.payer ? '垫付者自己的份额' : s.amount === 0 ? '无需付款' : `${s.settled ? '已付给' : '待付给'} ${e.payer_name}`}{s.settled_at && ` · ${memberName(s.settled_by || '')}${s.settled ? '标记结清' : '撤销结清'}`}</small></div><span>{money(s.amount, e.currency)}</span>{!e.voided && s.user !== e.payer && s.amount > 0 && <button className={s.settled ? 'text-button' : 'secondary-button'} disabled={busy} onClick={() => send({ action: 'settle', id: e.id, user: s.user, revision: s.revision, settled: !s.settled })}>{s.settled ? <><Check size={14}/>撤销结清</> : '标记结清'}</button>}</div>)}</div>
          <div className="expense-footer">{e.voided ? <small>由 {memberName(e.voided_by || '')} 作废，原始记录保留。</small> : <button className="text-button" disabled={busy} onClick={() => setVoiding(e)}>记错了？作废账单</button>}</div>
        </article>)}</div> : <div className="empty"><Wallet/><h2>{all ? '第一笔开销，从这里记起' : '目前没有待结清的账单'}</h2><p>{all ? '选好垫付者和参与者，我们帮你算清楚。' : '已结清的记录可以在“全部账单”查看。'}</p><button onClick={() => newBill(activityFilter)}>记一笔</button></div>}
      </>}
    </>}
    <Dialog open={!!plan} onOpenChange={v => !v && !busy && setPlan(null)}><DialogContent className="community-dialog"><DialogTitle>{plan?.id ? '编辑计划' : '发起活动'}</DialogTitle><DialogDescription>先有一个想法也可以。日期、地点和行程都能随时补充。</DialogDescription>{plan && <form onSubmit={async e => { e.preventDefault(); if (await send({ action: 'activity', ...plan }, !plan.id)) setPlan(null); }}>
      <label>活动名称<input required maxLength={80} value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })} placeholder="周末去海边 / 周五火锅局"/></label>
      <div className="form-pair"><label>类型<select value={plan.kind} onChange={e => setPlan({ ...plan, kind: e.target.value as Activity['kind'] })}><option value="gathering">聚会与玩乐</option><option value="trip">出游计划</option></select></label><label>状态<select value={plan.status} onChange={e => setPlan({ ...plan, status: e.target.value as Activity['status'] })}>{Object.entries(states).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label></div>
      <div className="form-pair"><label>开始日期<input type="date" min="2000-01-01" max="2100-12-31" value={plan.starts_on} onInput={e => setPlan({ ...plan, starts_on: e.currentTarget.value })} onChange={e => setPlan({ ...plan, starts_on: e.target.value })}/></label><label>结束日期（可选）<input type="date" min={plan.starts_on || '2000-01-01'} max="2100-12-31" value={plan.ends_on} onInput={e => setPlan({ ...plan, ends_on: e.currentTarget.value })} onChange={e => setPlan({ ...plan, ends_on: e.target.value })}/></label></div>
      <label>地点 / 集合点<input maxLength={200} value={plan.location} onChange={e => setPlan({ ...plan, location: e.target.value })} placeholder="可以稍后决定"/></label><label>行程与备忘<textarea rows={5} maxLength={3000} value={plan.notes} onChange={e => setPlan({ ...plan, notes: e.target.value })} placeholder={'例如：\n10:00 车站集合\n带上雨伞、充电宝\n订票前一起确认时间'}/></label>
      <small>日期按活动当地日历记录；具体时间和时区可写在备忘里。</small><button disabled={busy} type="submit">{busy ? '正在保存…' : '保存计划'}</button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!bill} onOpenChange={v => !v && !busy && setBill(null)}><DialogContent className="community-dialog"><DialogTitle>记一笔共同开销</DialogTitle><DialogDescription>按勾选的参与者均分。核对下方明细后保存。</DialogDescription>{bill && data && <form onSubmit={async e => { e.preventDefault(); if (await send({ action: 'expense', ...bill }, true)) setBill(null); }}>
      <label>这笔钱花在哪<input required maxLength={80} value={bill.title} onChange={e => setBill({ ...bill, title: e.target.value })} placeholder="火锅食材 / 火车票 / 民宿"/></label>
      <div className="form-pair"><label>总金额<input required inputMode="decimal" placeholder="0.00" value={bill.amount} maxLength={10} onChange={e => setBill({ ...bill, amount: e.target.value })}/></label><label>币种<select value={bill.currency} onChange={e => setBill({ ...bill, currency: e.target.value as Currency })}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label></div>
      {bill.amount && amount === null && <p role="status" className="amount-hint">金额须大于 0、最多两位小数，最高 1,000,000（例如 12.50）。</p>}
      <div className="form-pair"><label>谁先垫付<select required value={bill.payer} onChange={e => setBill({ ...bill, payer: e.target.value })}><option value="" disabled>请选择垫付者</option>{data.members.map(m => <option value={m.user} key={m.user}>{m.name}{m.user === data.me ? '（我）' : ''}</option>)}</select></label><label>开销日期<input required type="date" min="2000-01-01" max="2100-12-31" value={bill.spent_on} onInput={e => setBill({ ...bill, spent_on: e.currentTarget.value })} onChange={e => setBill({ ...bill, spent_on: e.target.value })}/></label></div>
      <label>关联活动（可选）<select value={bill.activity_id} onChange={e => setBill({ ...bill, activity_id: e.target.value })}><option value="">日常开销，不关联活动</option>{data.activities.map(a => <option value={a.id} key={a.id}>{a.title}</option>)}</select></label>
      <fieldset className="members-field"><legend>谁一起分摊 · 已选 {bill.users.length} 人</legend><div className="member-options">{data.members.map(m => <label key={m.user}><input type="checkbox" checked={bill.users.includes(m.user)} onChange={e => setBill({ ...bill, users: e.target.checked ? [...bill.users, m.user] : bill.users.filter(u => u !== m.user) })}/>{m.name}{m.user === data.me ? '（我）' : ''}</label>)}</div><small>缺少朋友？请 TA 先在“我的资料”保存昵称，再刷新账本。</small>{!data.members.some(m => m.user === data.me) && <button type="button" className="text-button" onClick={() => { setBill(null); onProfile(); }}>去填写我的昵称</button>}</fieldset>
      {!!preview.length && <div className="split-preview"><strong>分摊预览</strong>{preview.map(s => <p key={s.user}><span>{memberName(s.user)}{s.user === bill.payer ? '（自付）' : ''}</span><span>{money(s.amount, bill.currency)}</span></p>)}<small>精确到分；不能整除的尾差按固定成员顺序分配。</small></div>}
      <label>备注（可选）<textarea rows={2} maxLength={500} value={bill.note} onChange={e => setBill({ ...bill, note: e.target.value })} placeholder="例如：含服务费，饮料另算"/></label><button type="submit" disabled={busy || !amount || !bill.users.length || !bill.payer}>{busy ? '正在保存…' : '确认记账'}</button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!voiding} onOpenChange={v => !v && !busy && setVoiding(null)}><DialogContent><DialogTitle>作废这笔账单？</DialogTitle><DialogDescription>“{voiding?.title}”将不再计入应收、应付和总开销。原始金额及结清记录仍保留。若已有实际转账，请先和朋友核对；记错的金额可重新记一笔。</DialogDescription><div className="community-actions"><button className="secondary-button" disabled={busy} onClick={() => setVoiding(null)}>保留账单</button><button disabled={busy} onClick={async () => { if (voiding && await send({ action: 'void', id: voiding.id })) setVoiding(null); }}>确认作废</button></div></DialogContent></Dialog>
  </section>;
}
