import type { Currency } from './community-money';
export type Member = { user: string; name: string };
export type Activity = {
  id: string; title: string; kind: 'gathering' | 'trip'; starts_on: string; ends_on: string;
  location: string; notes: string; status: 'planning' | 'confirmed' | 'completed' | 'cancelled';
  revision: number; updated: string; creator: string;
  attendance: { user: string; name: string; choice: 'yes' | 'maybe' | 'no' }[];
};
export type Share = Member & { amount: number; settled: number; revision: number; settled_by: string | null; settled_at: string | null };
export type Expense = {
  id: string; title: string; amount: number; currency: Currency; payer: string; payer_name: string;
  activity_id: string | null; spent_on: string; note: string; created: string; voided: number;
  voided_by: string | null; voided_at: string | null; shares: Share[];
};
export type CommunityData = { me: string; members: Member[]; activities: Activity[]; expenses: Expense[] };
