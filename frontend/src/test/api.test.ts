/**
 * Unit tests for api.ts helper functions.
 * Mocks axios so no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mock instance so vi.mock factory can reference it ──────────────────
const mockAxiosInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  defaults: { headers: { common: {} } },
}));

// ── Mock axios before importing api.ts ────────────────────────────────────────
vi.mock("axios", () => {
  const create = vi.fn(() => mockAxiosInstance);
  return { default: { create } };
});

// ── Mock firebase auth so api.ts module-level code doesn't fail ───────────────
vi.mock("../firebase", () => ({
  auth: {
    authStateReady: vi.fn().mockResolvedValue(undefined),
    currentUser: null,
  },
}));

// Import after mocks are in place
import {
  listReceipts,
  updateReceipt,
  deleteReceipt,
  bulkSetReimbursementStatus,
  getUnreimbursedReport,
  downloadUnreimbursedReportPdf,
} from "../api";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listReceipts ──────────────────────────────────────────────────────────────

describe("listReceipts", () => {
  it("calls GET /api/receipts with limit and offset", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: { items: [], total: 0, limit: 50, offset: 0 } });
    await listReceipts(50, 0);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/receipts")
    );
    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=0");
  });

  it("appends category param when provided", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: { items: [], total: 0, limit: 50, offset: 0 } });
    await listReceipts(50, 0, "personal");
    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("category=personal");
  });

  it("appends reimbursement_status param when provided", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: { items: [], total: 0, limit: 50, offset: 0 } });
    await listReceipts(50, 0, undefined, undefined, undefined, "pending");
    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("reimbursement_status=pending");
  });

  it("returns the items array from the response", async () => {
    const items = [{ id: "abc", payee: "PG&E", amount: 100 }];
    mockAxiosInstance.get.mockResolvedValue({ data: { items, total: 1, limit: 50, offset: 0 } });
    const result = await listReceipts();
    expect(result.items).toEqual(items);
    expect(result.total).toBe(1);
  });
});

// ── updateReceipt ─────────────────────────────────────────────────────────────

describe("updateReceipt", () => {
  it("calls PATCH /api/receipts/:id with the patch payload", async () => {
    const updated = { id: "r1", payee: "Comcast", amount: 54.20 };
    mockAxiosInstance.patch.mockResolvedValue({ data: updated });
    const result = await updateReceipt("r1", { payee: "Comcast" });
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      "/api/receipts/r1",
      { payee: "Comcast" }
    );
    expect(result).toEqual(updated);
  });
});

// ── deleteReceipt ─────────────────────────────────────────────────────────────

describe("deleteReceipt", () => {
  it("calls DELETE /api/receipts/:id", async () => {
    mockAxiosInstance.delete.mockResolvedValue({});
    await deleteReceipt("r1");
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/api/receipts/r1");
  });
});

// ── bulkSetReimbursementStatus ────────────────────────────────────────────────

describe("bulkSetReimbursementStatus", () => {
  it("posts to bulk-set-reimbursement-status with ids and status", async () => {
    mockAxiosInstance.post.mockResolvedValue({ data: { updated: 3 } });
    const result = await bulkSetReimbursementStatus(["a", "b", "c"], "pending");
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      "/api/receipts/bulk-set-reimbursement-status",
      { ids: ["a", "b", "c"], status: "pending" }
    );
    expect(result.updated).toBe(3);
  });
});

// ── getUnreimbursedReport ─────────────────────────────────────────────────────

describe("getUnreimbursedReport", () => {
  const mockReport = {
    filter_by: null, filter_value: null,
    date_start: null, date_end: null,
    reimbursement_status: null,
    summary: { total: 200, count: 2, avg: 100, oldest_date: null, newest_date: null },
    by_category: [], by_month: [], stacked_by_month: [], categories: [],
    by_payment_category: [], stacked_by_month_payment: [], payment_categories: [],
    receipts: [],
  };

  it("calls GET /api/reports/unreimbursed", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: mockReport });
    await getUnreimbursedReport({});
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/reports/unreimbursed")
    );
  });

  it("appends reimbursement_status param when provided", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: mockReport });
    await getUnreimbursedReport({ reimbursement_status: "pending" });
    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("reimbursement_status=pending");
  });

  it("appends date_start and date_end when provided", async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: mockReport });
    await getUnreimbursedReport({ date_start: "2026-01-01", date_end: "2026-12-31" });
    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("date_start=2026-01-01");
    expect(url).toContain("date_end=2026-12-31");
  });
});

// ── downloadUnreimbursedReportPdf ─────────────────────────────────────────────

describe("downloadUnreimbursedReportPdf", () => {
  it("calls GET /api/reports/unreimbursed/pdf", async () => {
    // Mock blob + URL.createObjectURL (jsdom doesn't have it)
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:fake");
    global.URL.revokeObjectURL = vi.fn();
    // Mock document.createElement to prevent actual link click
    const mockLink = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);

    const fakeBlob = new Blob(["pdf"], { type: "application/pdf" });
    mockAxiosInstance.get.mockResolvedValue({ data: fakeBlob });

    await downloadUnreimbursedReportPdf({ reimbursement_status: "none" });

    const url: string = mockAxiosInstance.get.mock.calls[0][0];
    expect(url).toContain("/api/reports/unreimbursed/pdf");
    expect(url).toContain("reimbursement_status=none");
  });
});
