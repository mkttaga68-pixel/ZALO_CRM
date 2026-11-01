export type PostingKind = 'GROUP' | 'OFFER';
export interface PostingViewer { id: string; orgId: string; role: string }
export interface PostingTarget { id: string; threadId: string; name: string; contactId?: string }
export interface PostingDraft {
  requestId: string; zaloAccountId: string; kind: PostingKind; targetIds: string[];
  body: string; imageUrls: string[]; delaySeconds: number; confirmed: true;
}
export interface PostingJob {
  id: string; org_id: string; created_by_id: string; zalo_account_id: string; request_id: string;
  fingerprint: string; kind: PostingKind; body: string; image_urls: string[]; delay_seconds: number;
  status: string; worker_id: string | null; lease_until: Date | null; last_error: string | null;
  created_at: Date; updated_at: Date;
}
export interface PostingRecipient {
  id: string; org_id: string; job_id: string; target_ref: string; thread_id: string;
  display_name: string; ordinal: number; status: string; error: string | null; sent_at: Date | null;
}
export class PostingError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
