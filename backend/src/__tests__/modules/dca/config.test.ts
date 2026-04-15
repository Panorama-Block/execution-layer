import { describe, it, expect } from "vitest";
import { DCA_MIN_REMAINING_SWAPS, DCA_MIN_INTERVAL_SECONDS } from "../../../modules/dca/config/dca.config";

describe("dca config", () => {
  it("DCA_MIN_REMAINING_SWAPS é um número positivo", () => {
    expect(DCA_MIN_REMAINING_SWAPS).toBeGreaterThan(0);
  });

  it("DCA_MIN_INTERVAL_SECONDS é ao menos 1 hora (3600s)", () => {
    expect(DCA_MIN_INTERVAL_SECONDS).toBeGreaterThanOrEqual(3600);
  });

  it("DCA_MIN_REMAINING_SWAPS é um inteiro", () => {
    expect(Number.isInteger(DCA_MIN_REMAINING_SWAPS)).toBe(true);
  });

  it("DCA_MIN_INTERVAL_SECONDS é um inteiro", () => {
    expect(Number.isInteger(DCA_MIN_INTERVAL_SECONDS)).toBe(true);
  });
});
