import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportTransactionEvidenceAdmin,
  exportTransactionEvidenceByWallet,
} from "../../../shared/services/transaction-evidence.service";

const WALLET_A =
  "0x1111111111111111111111111111111111111111";

const WALLET_B =
  "0x2222222222222222222222222222222222222222";

const response = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as Response);

const parent = (
  correlationId: string,
  walletAddress: string,
  chainId: number
) => ({
  correlationId,
  evidenceVersion: "1.0",
  action: "test",
  chainId,
  network: chainId === 43114 ? "avalanche" : "base",
  walletAddress,
  intent: {},
  preparedPayloadHash: "0xprepared",
  preparedAt: "2026-08-30T08:00:00.000Z",
  preparedMetadata: {
    totalSteps: 1,
  },
  status: "verified",
  verificationStatus: "verified",
  createdAt: "2026-08-30T08:00:00.000Z",
  updatedAt: "2026-08-30T08:01:00.000Z",
  verifiedAt: "2026-08-30T08:01:00.000Z",
});

const step = (
  correlationId: string,
  stepIndex: number,
  chainId: number
) => ({
  id: `${correlationId}:${stepIndex}`,
  correlationId,
  stepIndex,
  action: "swap",
  chainId,
  toAddress:
    "0x3333333333333333333333333333333333333333",
  value: "0",
  dataHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  preparedStepHash:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  preparedAt: "2026-08-30T08:00:00.000Z",
  txHash:
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  submittedAt: "2026-08-30T08:00:30.000Z",
  verified: true,
  chainMatchesExpected: true,
});

describe("transaction evidence chain participation export", () => {
  beforeEach(() => {
    process.env.PHASE2_EVIDENCE_ENABLED = "true";
    process.env.DB_GATEWAY_URL = "http://gateway.test";
    process.env.DB_GATEWAY_SERVICE_TOKEN = "test-token";
    process.env.DB_GATEWAY_TENANT_ID = "panorama-test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("includes a correlation when Avalanche participates in a step even if the parent chain is Base", async () => {
    const mixedParent = parent("corr-mixed", WALLET_A, 8453);
    const mixedStep = step("corr-mixed", 0, 43114);

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/v1/transaction-evidence-steps?")) {
        return response({
          data: [mixedStep],
        });
      }

      if (url.endsWith("/v1/transaction-evidence/corr-mixed")) {
        return response({
          data: mixedParent,
        });
      }

      if (
        url.endsWith(
          "/v1/transaction-evidence-steps/corr-mixed%3A0"
        )
      ) {
        return response({
          data: mixedStep,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const exported =
      await exportTransactionEvidenceAdmin(43114);

    expect(exported.records).toHaveLength(1);
    expect(exported.records[0].correlationId).toBe(
      "corr-mixed"
    );
    expect(exported.records[0].intent.chainId).toBe(8453);
    expect(exported.records[0].steps[0].chainId).toBe(43114);
  });

  it("deduplicates correlations with multiple Avalanche steps", async () => {
    const record = {
      ...parent("corr-multi", WALLET_A, 8453),
      preparedMetadata: {
        totalSteps: 2,
      },
    };

    const step0 = step("corr-multi", 0, 43114);
    const step1 = step("corr-multi", 1, 43114);

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/v1/transaction-evidence-steps?")) {
        return response({
          data: [step0, step1],
        });
      }

      if (url.endsWith("/v1/transaction-evidence/corr-multi")) {
        return response({
          data: record,
        });
      }

      if (
        url.endsWith(
          "/v1/transaction-evidence-steps/corr-multi%3A0"
        )
      ) {
        return response({
          data: step0,
        });
      }

      if (
        url.endsWith(
          "/v1/transaction-evidence-steps/corr-multi%3A1"
        )
      ) {
        return response({
          data: step1,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const exported =
      await exportTransactionEvidenceAdmin(43114);

    expect(exported.records).toHaveLength(1);
    expect(exported.summary.correlationCount).toBe(1);
    expect(exported.summary.stepCount).toBe(2);
  });

  it("preserves parent wallet filtering after chain-participation discovery", async () => {
    const parentA = parent("corr-a", WALLET_A, 8453);
    const parentB = parent("corr-b", WALLET_B, 8453);
    const stepA = step("corr-a", 0, 43114);
    const stepB = step("corr-b", 0, 43114);

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/v1/transaction-evidence-steps?")) {
        return response({
          data: [stepA, stepB],
        });
      }

      if (url.endsWith("/v1/transaction-evidence/corr-a")) {
        return response({
          data: parentA,
        });
      }

      if (url.endsWith("/v1/transaction-evidence/corr-b")) {
        return response({
          data: parentB,
        });
      }

      if (
        url.endsWith(
          "/v1/transaction-evidence-steps/corr-a%3A0"
        )
      ) {
        return response({
          data: stepA,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const exported =
      await exportTransactionEvidenceByWallet(
        WALLET_A,
        43114
      );

    expect(exported.records).toHaveLength(1);
    expect(exported.records[0].correlationId).toBe("corr-a");
    expect(exported.records[0].intent.walletAddress).toBe(
      WALLET_A
    );
  });

  it("returns no correlations when no step participates in the requested chain", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/v1/transaction-evidence-steps?")) {
        return response({
          data: [],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const exported =
      await exportTransactionEvidenceAdmin(43114);

    expect(exported.records).toEqual([]);
    expect(exported.summary.correlationCount).toBe(0);
    expect(exported.summary.stepCount).toBe(0);
  });
});
