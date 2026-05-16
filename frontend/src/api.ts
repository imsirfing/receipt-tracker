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

export interface IngestResult {
  processed: number;
  message: string;
}

export const triggerIngest = async (): Promise<IngestResult> => {
  const res = await api.post<IngestResult>("/api/ingest");
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
  created_at: string;
  attachments: Array<{ id: string; gcs_uri: string; file_type: string }>;
  notes?: string | null;
  is_tax_deductible?: boolean;
  reimbursement_owner?: string | null;
}

export interface ReceiptListResponse {
  items: Receipt[];
  total: number;
  limit: number;
  offset: number;
}

export async function listReceipts(limit = 50, offset = 0): Promise<ReceiptListResponse> {
  const res = await api.get<ReceiptListResponse>(`/api/receipts?limit=${limit}&offset=${offset}`);
  return res.data;
}

export const updateReceipt = async (id: string, patch: Partial<Receipt>) => {
  const res = await api.patch<Receipt>(`/api/receipts/${id}`, patch);
  return res.data;
};

export const markReimbursed = async (id: string) => {
  const res = await api.post<Receipt>(`/api/receipts/${id}/reimburse`);
  return res.data;
};

export const getReceipt = async (id: string): Promise<Receipt> => {
  const res = await api.get<Receipt>(`/api/receipts/${id}`);
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

export const listPending = async (): Promise<PendingEmail[]> => {
  const res = await api.get<PendingEmail[]>("/api/pending");
  return res.data;
};

export const dismissPending = async (id: string): Promise<void> => {
  await api.delete(`/api/pending/${id}`);
};

export const convertPending = async (id: string, body: ConvertRequest): Promise<Receipt> => {
  const res = await api.post<Receipt>(`/api/pending/${id}/convert`, body);
  return res.data;
};
