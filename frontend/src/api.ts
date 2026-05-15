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
}

export const listReceipts = async (params?: {
  category?: string;
  is_reimbursed?: boolean;
}): Promise<Receipt[]> => {
  const res = await api.get<Receipt[]>("/api/receipts", { params });
  return res.data;
};

export const updateReceipt = async (id: string, patch: Partial<Receipt>) => {
  const res = await api.patch<Receipt>(`/api/receipts/${id}`, patch);
  return res.data;
};

export const markReimbursed = async (id: string) => {
  const res = await api.post<Receipt>(`/api/receipts/${id}/reimburse`);
  return res.data;
};

export const requestReport = async (message: string): Promise<{ pdf_url: string }> => {
  const res = await api.post<{ pdf_url: string }>("/api/chat/report", { message });
  return res.data;
};
