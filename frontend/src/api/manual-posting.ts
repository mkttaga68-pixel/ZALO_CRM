import { api } from '@/api';

export type PostingKind = 'GROUP' | 'OFFER';
export interface PostingAccount { id: string; displayName: string | null; status: string }
export interface PostingTarget { id: string; name: string }
export interface PostingDraft {
  requestId: string; zaloAccountId: string; kind: PostingKind; targetIds: string[];
  body: string; imageUrls: string[]; delaySeconds: number; confirmed: true;
}
export interface PostingJob {
  id: string; requestId: string; kind: PostingKind; zaloAccountId: string;
  body: string; imageUrls: string[]; status: string; lastError: string | null;
  total?: number; sent?: number; unknown?: number; createdAt: string; updatedAt: string;
}
export interface PostingRecipient { id: string; name: string; status: string; error: string | null; sentAt: string | null }
export const manualPosting = {
  async status() { return (await api.get<{ enabled: boolean; ready: boolean }>('/manual-posting/status')).data; },
  async accounts() { return (await api.get<{ accounts: PostingAccount[] }>('/manual-posting/accounts')).data.accounts; },
  async targets(accountId: string, kind: PostingKind, q: string, offset: number) {
    return (await api.get<{ targets: PostingTarget[]; nextOffset: number | null }>('/manual-posting/targets', { params: { accountId, kind, q, offset } })).data;
  },
  async create(draft: PostingDraft) { return (await api.post<{ job: PostingJob; duplicate: boolean }>('/manual-posting/jobs', draft)).data; },
  async jobs(kind: PostingKind) { return (await api.get<{ jobs: PostingJob[] }>('/manual-posting/jobs', { params: { kind } })).data.jobs; },
  async detail(id: string) { return (await api.get<{ job: PostingJob; recipients: PostingRecipient[] }>(`/manual-posting/jobs/${encodeURIComponent(id)}`)).data; },
  async cancel(id: string) { return (await api.post<{ cancelled: boolean }>(`/manual-posting/jobs/${encodeURIComponent(id)}/cancel`)).data; },
};
