import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TransactionBundle } from "../../../types/transaction";

const {
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
} = vi.hoisted(() => ({
  mockCreateEvidenceCorrelation: vi.fn(),
  mockPersistEvidenceIntent: vi.fn(),
  mockPersistPreparedEvidence: vi.fn(),
}));

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation: mockCreateEvidenceCorrelation,
    persistEvidenceIntent: mockPersistEvidenceIntent,
    persistPreparedEvidence: mockPersistPreparedEvidence,
  })
);

import {
  prepareEvidenceBoundBundle,
} from "../../../shared/services/evidence-bound-preparation.service";

const CORRELATION_ID =
  "11111111-2222-4333-8444-555555555555";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const TOKEN_IN =
  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

const TOKEN_OUT =
  "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

const EXECUTOR =
  "0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12";

const bundle: TransactionBundle = {
  steps: [
    {
      to: EXECUTOR,
      data: "0x12345678",
      value: "0",
      chainId: 43114,
      description: "Swap",
    },
  ],
  totalSteps: 1,
  summary: "Swap USDC to AVAX",
};

const metadata = {
  service: "SWAP",
  selectedProvider: "traderjoe",
};

const intent = {
  action: "swap",
  chainId: 43114,
  network: "avalanche-c-chain",
  walletAddress: USER,
  assetIn: TOKEN_IN,
  assetOut: TOKEN_OUT,
  amountRaw: "1000000",
  slippageBps: 50,
};

describe("prepareEvidenceBoundBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateEvidenceCorrelation.mockReturnValue({
      correlationId: CORRELATION_ID,
      evidenceVersion: "1.0",
      enabled: true,
    });

    mockPersistEvidenceIntent.mockResolvedValue(undefined);

    mockPersistPreparedEvidence.mockResolvedValue({
      correlationId: CORRELATION_ID,
      evidenceVersion: "1.0",
      evidenceEnabled: true,
      preparedPayloadHash: `0x${"ab".repeat(32)}`,
    });
  });

  it("persists intent before transaction preparation starts", async () => {
    const events: string[] = [];

    mockPersistEvidenceIntent.mockImplementation(async () => {
      events.push("intent");
    });

    const prepare = vi.fn(async () => {
      events.push("prepare");
      return { bundle, metadata };
    });

    mockPersistPreparedEvidence.mockImplementation(async () => {
      events.push("prepared-evidence");

      return {
        correlationId: CORRELATION_ID,
        evidenceVersion: "1.0",
        evidenceEnabled: true,
        preparedPayloadHash: `0x${"ab".repeat(32)}`,
      };
    });

    await prepareEvidenceBoundBundle({
      intent,
      prepare,
    });

    expect(events).toEqual([
      "intent",
      "prepare",
      "prepared-evidence",
    ]);
  });

  it("creates the correlation and timestamps the evidence intent", async () => {
    await prepareEvidenceBoundBundle({
      intent,
      prepare: async () => ({ bundle, metadata }),
    });

    expect(mockCreateEvidenceCorrelation).toHaveBeenCalledTimes(1);

    expect(mockPersistEvidenceIntent).toHaveBeenCalledTimes(1);

    const persistedIntent =
      mockPersistEvidenceIntent.mock.calls[0][0];

    expect(persistedIntent).toMatchObject({
      ...intent,
      correlationId: CORRELATION_ID,
    });

    expect(
      Number.isNaN(Date.parse(persistedIntent.createdAt))
    ).toBe(false);
  });

  it("persists the exact prepared bundle and metadata", async () => {
    await prepareEvidenceBoundBundle({
      intent,
      prepare: async () => ({ bundle, metadata }),
    });

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][1]
    ).toBe(bundle);

    expect(
      mockPersistPreparedEvidence.mock.calls[0][2]
    ).toBe(metadata);
  });

  it("returns the exact bundle and metadata without mutation", async () => {
    const bundleSnapshot = structuredClone(bundle);
    const metadataSnapshot = structuredClone(metadata);

    const result = await prepareEvidenceBoundBundle({
      intent,
      prepare: async () => ({ bundle, metadata }),
    });

    expect(result.bundle).toBe(bundle);
    expect(result.metadata).toBe(metadata);

    expect(bundle).toEqual(bundleSnapshot);
    expect(metadata).toEqual(metadataSnapshot);
  });

  it("returns the prepared evidence identity with the bundle", async () => {
    const result = await prepareEvidenceBoundBundle({
      intent,
      prepare: async () => ({ bundle, metadata }),
    });

    expect(result).toMatchObject({
      correlationId: CORRELATION_ID,
      evidenceVersion: "1.0",
      evidenceEnabled: true,
      preparedPayloadHash: `0x${"ab".repeat(32)}`,
    });
  });

  it("does not prepare or return a bundle when intent persistence fails", async () => {
    const prepare = vi.fn(async () => ({
      bundle,
      metadata,
    }));

    mockPersistEvidenceIntent.mockRejectedValue(
      new Error("intent persistence failed")
    );

    await expect(
      prepareEvidenceBoundBundle({
        intent,
        prepare,
      })
    ).rejects.toThrow("intent persistence failed");

    expect(prepare).not.toHaveBeenCalled();

    expect(mockPersistPreparedEvidence)
      .not.toHaveBeenCalled();
  });

  it("does not persist prepared evidence when preparation fails", async () => {
    const prepare = vi.fn(async () => {
      throw new Error("preparation failed");
    });

    await expect(
      prepareEvidenceBoundBundle({
        intent,
        prepare,
      })
    ).rejects.toThrow("preparation failed");

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .not.toHaveBeenCalled();
  });

  it("does not return a bundle when prepared evidence persistence fails", async () => {
    mockPersistPreparedEvidence.mockRejectedValue(
      new Error("prepared persistence failed")
    );

    await expect(
      prepareEvidenceBoundBundle({
        intent,
        prepare: async () => ({
          bundle,
          metadata,
        }),
      })
    ).rejects.toThrow("prepared persistence failed");

    expect(mockPersistEvidenceIntent)
      .toHaveBeenCalledTimes(1);

    expect(mockPersistPreparedEvidence)
      .toHaveBeenCalledTimes(1);
  });
});
