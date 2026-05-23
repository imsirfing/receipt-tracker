import { describe, it, expect } from "vitest";
import { fmtCurrency } from "../utils";

describe("fmtCurrency", () => {
  it("formats whole numbers with two decimal places", () => {
    expect(fmtCurrency(100)).toBe("$100.00");
  });

  it("formats values with cents", () => {
    expect(fmtCurrency(142.5)).toBe("$142.50");
  });

  it("formats large numbers with commas", () => {
    expect(fmtCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(fmtCurrency(0)).toBe("$0.00");
  });

  it("accepts string input", () => {
    expect(fmtCurrency("54.20")).toBe("$54.20");
  });

  it("returns $0.00 for NaN string", () => {
    expect(fmtCurrency("not-a-number")).toBe("$0.00");
  });

  it("handles negative values", () => {
    // toLocaleString: negative sign appears before the dollar sign
    expect(fmtCurrency(-10)).toMatch(/-?\$10\.00|\$-10\.00/);
  });
});
