import type { Member } from './community-types';
export type Poll = {
  id: string; activity_id: string | null; title: string; kind: 'date' | 'place'; options: string[];
  closed: number; revision: number; created: string;
  ballots: { user: string; name: string; choices: number[]; revision: number }[];
};
export type Memory = {
  id: string; activity_id: string | null; title: string; body: string; happened_on: string;
  people: Member[]; image: string; author: string; author_name: string; created: string;
  updated: string; revision: number;
};
export type SocialData = {
  me: string; members: Member[]; activities: { id: string; title: string }[];
  polls: Poll[]; memories: Memory[]; nextCursor: { created: string; id: string } | null;
};
