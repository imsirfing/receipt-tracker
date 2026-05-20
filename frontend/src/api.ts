import axios, { AxiosInstance } from "axios";
import { auth } from "./firebase";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const api: AxiosInstance = axios.create({ baseURL });

api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface IngestStarted {
  status: string;
  message: string;
}

export interface IngestStatus {
  running: boolean;
  started_at: string | null;
  last_completed_at: string | null;
  last_processed: number | null;
  last_error: string | null;
}

export const triggerIngest = async (): Promise<IngestStarted> => {
  const res = await api.post<IngestStarted>("/api/ingest");
  return res.data;
};

export const getIngestStatus = async (): Promise<IngestStatus> => {
  const res = await api.get<IngestStatus>("/api/ingest/status");
  return res.data;
};

export interface Receipt {
  id: string;
  payee: string;
  amount: number;
  date: string;
  inferred_purpose: string | null;
  category_variable: string;
  payment_category: string | null;
  payment_detail: string | null;
  recurring_type: "ongoing" | "one_off";
  is_reimbursed: boolean;
  reimbursed_at: string | null;
  raw_email_id: string;
  source: string;
  ingested_at: string | null;
  created_at: string;
  updated_at: string | null;
  attachments: Array<{ id: string; gcs_uri: string; file_type: string }>;
  notes?: string | null;
  is_tax_deductible?: boolean;
  reimbursement_owner?: string | null;
}

export interface AuditEntry {
  id: number;
  receipt_id: string | null;
  event_type: string;
  event_at: string;
  actor: string;
  fields_changed: string[] | null;
  snapshot_before: Record<string, unknown> | null;
  snapshot_after: Record<string, unknown> | null;
  edit_reason: string | null;
  notes: string | null;
}

export interface ReceiptListResponse {
  items: Receipt[];
  total: number;
  limit: number;
  offset: number;
}

export async function listReceipts(
  limit = 50,
  offset = 0,
  category?: string,
  isReimbursed?: boolean,
  search?: string,
): Promise<ReceiptListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (category) params.set("category", category);
  if (isReimbursed !== undefined) params.set("is_reimbursed", String(isReimbursed));
  if (search) params.set("search", search);
  const res = await api.get<ReceiptListResponse>(`/api/receipts?${params.toString()}`);
  return res.data;
}

export const updateReceipt = async (id: string, patch: Partial<Receipt>) => {
  const res = await api.patch<Receipt>(`/api/receipts/${id}`, patch);
  return res.data;
};

export const deleteReceipt = async (id: string): Promise<void> => {
  const res = await fetch(`${baseURL}/api/receipts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
};

export const markReimbursed = async (id: string) => {
  const res = await api.post<Receipt>(`/api/receipts/${id}/reimburse`);
  return res.data;
};

export const getReceipt = async (id: string): Promise<Receipt> => {
  const res = await api.get<Receipt>(`/api/receipts/${id}`);
  return res.data;
};

export const getReceiptAudit = async (id: string): Promise<AuditEntry[]> => {
  const res = await api.get<AuditEntry[]>(`/api/receipts/${id}/audit`);
  return res.data;
};

export interface AttachmentUrl {
  url: string;
  file_type: string;
  filename: string;
}

export const getAttachmentUrl = async (receiptId: string, attachmentId: string): Promise<AttachmentUrl> => {
  const res = await api.get<AttachmentUrl>(`/api/receipts/${receiptId}/attachments/${attachmentId}/url`);
  return res.data;
};

export const requestReport = async (message: string): Promise<{ pdf_url: string }> => {
  const res = await api.post<{ pdf_url: string }>("/api/chat/report", { message });
  return res.data;
};

export interface PendingEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_address: string;
  body_preview: string;
  category_variable: string;
  skip_reason: string;
  received_date: string | null;
  created_at: string;
}

export interface ConvertRequest {
  payee: string;
  amount: number;
  date: string;
  category_variable: string;
  recurring_type: string;
  payment_category?: string;
  payment_detail?: string;
  inferred_purpose?: string;
}

export interface ReceiptCreateRequest {
  payee: string;
  amount: number;
  date: string;
  category_variable: string;
  recurring_type: string;
  payment_category?: string;
  payment_detail?: string;
  inferred_purpose?: string;
  notes?: string;
  is_tax_deductible?: boolean;
  reimbursement_owner?: string;
}

export const createReceipt = async (body: ReceiptCreateRequest): Promise<Receipt> => {
  const res = await fetch(`${baseURL}/api/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export interface PendingListResponse {
  items: PendingEmail[];
  total: number;
  limit: number;
  offset: number;
}

export const listPending = async (
  search?: string,
  limit = 20,
  offset = 0,
): Promise<PendingListResponse> => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set("search", search);
  const res = await api.get<PendingListResponse>(`/api/pending?${params.toString()}`);
  return res.data;
};

export const dismissPending = async (id: string): Promise<void> => {
  await api.delete(`/api/pending/${id}`);
};

export const convertPending = async (id: string, body: ConvertRequest): Promise<Receipt> => {
  const res = await api.post<Receipt>(`/api/pending/${id}/convert`, body);
  return res.data;
};
