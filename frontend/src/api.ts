import axios, { AxiosInstance } from "axios";
import { auth } from "./firebase";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const api: AxiosInstance = axios.create({ baseURL });

// Token is pushed here by AuthProvider via setApiToken() on every auth state
// change. auth.currentUser is used as a direct fallback in case the push
// hasn't happened yet (e.g. page load race).
let _apiToken: string | null = null;
export function setApiToken(token: string | null) {
  _apiToken = token;
}

api.interceptors.request.use(async (config) => {
  let token = _apiToken;
  if (!token) {
    // Fallback: get token directly from auth.currentUser.
    await auth.authStateReady();
    const user = auth.currentUser;
    if (user) {
      token = await user.getIdToken();
      _apiToken = token; // cache for subsequent requests
    }
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Catch 401s globally and throw a readable error.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      const detail = err.response?.data?.detail ?? "Session expired";
      return Promise.reject(new Error(`Auth error: ${detail}. Please sign out and sign back in.`));
    }
    if (err?.response?.data?.detail) {
      return Promise.reject(new Error(err.response.data.detail));
    }
    return Promise.reject(err);
  }
);

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
  canonical_payee?: string | null;
  amount: number;
  date: string;
  inferred_purpose: string | null;
  category_variable: string;
  payment_category: string | null;
  payment_detail: string | null;
  recurring_type: "ongoing" | "one_off";
  is_reimbursed: boolean;
  reimbursement_status: 'none' | 'pending' | 'reimbursed';
  reimbursed_at: string | null;
  raw_email_id: string;
  source: string;
  ingested_at: string | null;
  created_at: string;
  updated_at: string | null;
  attachments: Array<{ id: string; gcs_uri: string; file_type: string; filename: string | null }>;
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
  reimbursementStatus?: string,
): Promise<ReceiptListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (category) params.set("category", category);
  if (isReimbursed !== undefined) params.set("is_reimbursed", String(isReimbursed));
  if (reimbursementStatus) params.set("reimbursement_status", reimbursementStatus);
  if (search) params.set("search", search);
  const res = await api.get<ReceiptListResponse>(`/api/receipts?${params.toString()}`);
  return res.data;
}

export const updateReceipt = async (id: string, patch: Partial<Receipt>) => {
  const res = await api.patch<Receipt>(`/api/receipts/${id}`, patch);
  return res.data;
};

export const deleteReceipt = async (id: string): Promise<void> => {
  await api.delete(`/api/receipts/${id}`);
};

export const markReimbursed = async (id: string) => {
  const res = await api.post<Receipt>(`/api/receipts/${id}/reimburse`);
  return res.data;
};

export const bulkMarkReimbursed = async (ids: string[]): Promise<{ updated: number }> => {
  const res = await api.post<{ updated: number }>(`/api/receipts/bulk-reimburse`, { ids });
  return res.data;
};

export const bulkSetReimbursementStatus = async (ids: string[], status: 'none' | 'pending' | 'reimbursed'): Promise<{ updated: number }> => {
  const res = await api.post<{ updated: number }>('/api/receipts/bulk-set-reimbursement-status', { ids, status });
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

export const downloadAttachment = async (receiptId: string, attachmentId: string, filename: string): Promise<void> => {
  const res = await api.get(`/api/receipts/${receiptId}/attachments/${attachmentId}/download`, {
    responseType: "blob",
  });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
};

export const requestReport = async (message: string): Promise<string> => {
  const res = await api.post("/api/chat/report", { message }, { responseType: "blob" });
  return URL.createObjectURL(res.data);
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
  const res = await api.post<Receipt>("/api/receipts", body);
  return res.data;
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

export interface ParseImageResult {
  payee: string;
  amount: number;
  date: string;
  inferred_purpose: string;
  recurring_type: string;
  payment_category: string;
  payment_detail: string;
  attachment_gcs_uri: string;
  attachment_file_type: string;
  attachment_filename: string | null;
}

export const parseReceiptImage = async (file: File): Promise<ParseImageResult> => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post<ParseImageResult>("/api/receipts/parse-image", formData);
  return res.data;
};

export interface AttachImageRequest {
  gcs_uri: string;
  file_type: string;
  filename?: string;
}

export const attachImage = async (receiptId: string, body: AttachImageRequest): Promise<Receipt> => {
  const res = await api.post<Receipt>(`/api/receipts/${receiptId}/attach-image`, body);
  return res.data;
};

// ---------------------------------------------------------------------------
// Admin / access management
// ---------------------------------------------------------------------------

export interface AccessGrant {
  id: string;
  email: string;
  category: string;
  role: string;
}

export interface MeInfo {
  is_owner: boolean;
  access_categories: string[];   // was access_category: string
  role: string;
}

export const getMe = async (): Promise<MeInfo> => {
  const res = await api.get<MeInfo>("/api/admin/me");
  return res.data;
};

export const listAccess = async (): Promise<AccessGrant[]> => {
  const res = await api.get<AccessGrant[]>("/api/admin/access");
  return res.data;
};

export const grantAccess = async (
  email: string,
  category: string,
  role: string,
): Promise<AccessGrant> => {
  const res = await api.post<AccessGrant>("/api/admin/access", { email, category, role });
  return res.data;
};

export const revokeAccess = async (id: string): Promise<void> => {
  await api.delete(`/api/admin/access/${id}`);
};

// ---------------------------------------------------------------------------
// Unreimbursed report
// ---------------------------------------------------------------------------

export interface ReportSummary {
  total: number;
  count: number;
  avg: number;
  oldest_date: string | null;
  newest_date: string | null;
}

export interface CategoryStat {
  category: string;
  total: number;
  count: number;
  pct: number;
}

export interface MonthStat {
  month: string;
  label: string;
  total: number;
  count: number;
}

export interface ReportReceiptLine {
  id: string;
  payee: string;
  amount: number;
  date: string;
  category_variable: string;
  payment_category: string | null;
  inferred_purpose: string | null;
  notes: string | null;
  reimbursement_owner: string | null;
  reimbursement_note: string | null;
  created_at: string;
}

export interface UnreimbursedReport {
  filter_by: string | null;
  filter_value: string | null;
  date_start: string | null;
  date_end: string | null;
  summary: ReportSummary;
  by_category: CategoryStat[];
  by_month: MonthStat[];
  stacked_by_month: Array<Record<string, string | number>>;
  categories: string[];
  by_payment_category: CategoryStat[];
  stacked_by_month_payment: Array<Record<string, string | number>>;
  payment_categories: string[];
  receipts: ReportReceiptLine[];
}

export async function getUnreimbursedReport(params: {
  filter_by?: string;
  filter_value?: string;
  reimbursement_status?: string;
  date_start?: string;
  date_end?: string;
  limit?: number;
  offset?: number;
}): Promise<UnreimbursedReport> {
  const p = new URLSearchParams();
  if (params.filter_by) p.set("filter_by", params.filter_by);
  if (params.filter_value) p.set("filter_value", params.filter_value);
  if (params.reimbursement_status) p.set("reimbursement_status", params.reimbursement_status);
  if (params.date_start) p.set("date_start", params.date_start);
  if (params.date_end) p.set("date_end", params.date_end);
  if (params.limit !== undefined) p.set("limit", String(params.limit));
  if (params.offset !== undefined) p.set("offset", String(params.offset));
  const res = await api.get<UnreimbursedReport>(`/api/reports/unreimbursed?${p.toString()}`);
  return res.data;
}

export async function downloadUnreimbursedReportPdf(params: {
  filter_by?: string;
  filter_value?: string;
  reimbursement_status?: string;
  date_start?: string;
  date_end?: string;
}): Promise<void> {
  const p = new URLSearchParams();
  if (params.filter_by) p.set("filter_by", params.filter_by);
  if (params.filter_value) p.set("filter_value", params.filter_value);
  if (params.reimbursement_status) p.set("reimbursement_status", params.reimbursement_status);
  if (params.date_start) p.set("date_start", params.date_start);
  if (params.date_end) p.set("date_end", params.date_end);
  const res = await api.get(`/api/reports/unreimbursed/pdf?${p.toString()}`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().split("T")[0];
  a.download = `unreimbursed-report-${ts}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}

export async function downloadEvidencePackage(receiptId: string): Promise<void> {
  const response = await api.get(`/api/receipts/${receiptId}/evidence-package`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `evidence-${receiptId}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Payee normalization
// ---------------------------------------------------------------------------

export interface PayeeAlias {
  id: string;
  pattern: string;
  canonical: string;
  priority: number;
  enabled: boolean;
  note: string | null;
  created_at: string;
}

export interface BuiltinRule {
  priority: number;
  pattern: string;
  canonical: string;
}

export interface NormalizeResult {
  updated: number;
}

export interface PreviewOut {
  raw: string;
  canonical: string | null;
  matched: boolean;
}

export const listPayeeAliases = async (): Promise<PayeeAlias[]> => {
  const res = await api.get<PayeeAlias[]>("/api/payees/aliases");
  return res.data;
};

export const createPayeeAlias = async (body: {
  pattern: string;
  canonical: string;
  priority?: number;
  note?: string;
}): Promise<PayeeAlias> => {
  const res = await api.post<PayeeAlias>("/api/payees/aliases", body);
  return res.data;
};

export const deletePayeeAlias = async (id: string): Promise<void> => {
  await api.delete(`/api/payees/aliases/${id}`);
};

export const togglePayeeAlias = async (id: string, enabled: boolean): Promise<PayeeAlias> => {
  const res = await api.patch<PayeeAlias>(`/api/payees/aliases/${id}`, { enabled });
  return res.data;
};

export const previewNormalize = async (payee: string): Promise<PreviewOut> => {
  const res = await api.post<PreviewOut>("/api/payees/preview", { payee });
  return res.data;
};

export const normalizeAll = async (): Promise<NormalizeResult> => {
  const res = await api.post<NormalizeResult>("/api/payees/normalize-all");
  return res.data;
};

export const listBuiltinRules = async (): Promise<BuiltinRule[]> => {
  const res = await api.get<BuiltinRule[]>("/api/payees/builtin");
  return res.data;
};
