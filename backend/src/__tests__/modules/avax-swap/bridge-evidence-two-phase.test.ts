import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const CORRELATION_ID =
  "99999999-aaaa-4bbb-8ccc-eeeeeeeeeeee";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const SOURCE_TOKEN =
  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

const DEST_TOKEN =
  "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const {
  mockCreateEvidenceCorrelation,
  mockPersistEvidenceIntent,
  mockPersistPreparedEvidence,
  mockGetTransactionEvidence,
} = vi.hoisted(() => ({
  mockCreateEvidenceCorrelation: vi.fn(),
  mockPersistEvidenceIntent: vi.fn(),
  mockPersistPreparedEvidence: vi.fn(),
  mockGetTransactionEvidence: vi.fn(),
}));

vi.mock(
  "../../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation:
      mockCreateEvidenceCorrelation,
    persistEvidenceIntent:
      mockPersistEvidenceIntent,
    persistPreparedEvidence:
      mockPersistPreparedEvidence,
    getTransactionEvidence:
      mockGetTransactionEvidence,
  })
);

import {
  beginAvaxBridgeEvidence,
  commitAvaxBridgeEvidence,
} from "../../../modules/avax-swap/services/bridge-evidence.service";

describe(
  "Avalanche bridge source two-phase evidence boundary",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mockCreateEvidenceCorrelation.mockReturnValue({
        correlationId: CORRELATION_ID,
        evidenceVersion: "1.0",
        enabled: true,
      });

      mockPersistEvidenceIntent.mockResolvedValue(
        undefined
      );

      mockPersistPreparedEvidence.mockResolvedValue({
        correlationId: CORRELATION_ID,
        evidenceVersion: "1.0",
        evidenceEnabled: true,
        preparedPayloadHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
    });

    it(
      "persists the Avalanche bridge intent before returning a correlation",
      async () => {
        const result =
          await beginAvaxBridgeEvidence({
            userAddress: USER,
            destinationChainId: 1,
            sourceToken: SOURCE_TOKEN,
            destinationToken: DEST_TOKEN,
            amountRaw: "1000000",
          });

        expect(
          mockPersistEvidenceIntent
        ).toHaveBeenCalledTimes(1);

        const persisted =
          mockPersistEvidenceIntent.mock.calls[0][0];

        expect(persisted).toMatchObject({
          correlationId: CORRELATION_ID,
          action: "bridge-source:1",
          chainId: 43114,
          network: "avalanche-c-chain",
          walletAddress: USER,
          assetIn: SOURCE_TOKEN,
          assetOut: DEST_TOKEN,
          amountRaw: "1000000",
        });

        expect(result).toEqual({
          correlationId: CORRELATION_ID,
          evidenceVersion: "1.0",
          evidenceEnabled: true,
        });
      }
    );

    it(
      "reloads the persisted intent and commits the exact ordered Avalanche bundle",
      async () => {
        mockGetTransactionEvidence.mockResolvedValue({
          evidence: {
            correlationId: CORRELATION_ID,
            evidenceVersion: "1.0",
            action: "bridge-source:1",
            chainId: 43114,
            network: "avalanche-c-chain",
            walletAddress: USER.toLowerCase(),
            assetIn: SOURCE_TOKEN.toLowerCase(),
            assetOut: DEST_TOKEN.toLowerCase(),
            amountRaw: "1000000",
            createdAt:
              "2026-08-30T20:00:00.000Z",
            status: "intent-recorded",
          },
          steps: [],
        });

        const steps = [
          {
            to: SOURCE_TOKEN,
            data:
              "0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000",
            value: "0",
            chainId: 43114,
            description:
              "Reset bridge allowance",
          },
          {
            to: SOURCE_TOKEN,
            data:
              "0x095ea7b30000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000f4240",
            value: "0",
            chainId: 43114,
            description:
              "Approve bridge",
          },
          {
            to:
              "0x2222222222222222222222222222222222222222",
            data: "0x12345678",
            value: "0",
            chainId: 43114,
            description:
              "Bridge source transaction",
          },
        ];

        const result =
          await commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 1,
            provider: "thirdweb",
            steps,
          });

        expect(
          mockGetTransactionEvidence
        ).toHaveBeenCalledWith(
          CORRELATION_ID
        );

        expect(
          mockPersistPreparedEvidence
        ).toHaveBeenCalledTimes(1);

        const [
          persistedIntent,
          persistedBundle,
          metadata,
        ] =
          mockPersistPreparedEvidence.mock.calls[0];

        expect(persistedIntent).toMatchObject({
          correlationId: CORRELATION_ID,
          action: "bridge-source:1",
          chainId: 43114,
          network: "avalanche-c-chain",
          walletAddress: USER.toLowerCase(),
          amountRaw: "1000000",
        });

        expect(persistedBundle.steps)
          .toEqual(steps);

        expect(persistedBundle.totalSteps)
          .toBe(3);

        expect(metadata).toMatchObject({
          action: "bridge-source",
          destinationChainId: 1,
          provider: "thirdweb",
        });

        expect(result.preparedPayloadHash)
          .toMatch(/^0x[a-fA-F0-9]{64}$/);
      }
    );

    it(
      "refuses to commit a bundle containing a non-Avalanche source transaction",
      async () => {
        mockGetTransactionEvidence.mockResolvedValue({
          evidence: {
            correlationId: CORRELATION_ID,
            action: "bridge-source:1",
            chainId: 43114,
            network: "avalanche-c-chain",
            walletAddress: USER.toLowerCase(),
            assetIn: SOURCE_TOKEN.toLowerCase(),
            assetOut: DEST_TOKEN.toLowerCase(),
            amountRaw: "1000000",
            createdAt:
              "2026-08-30T20:00:00.000Z",
            status: "intent-recorded",
          },
          steps: [],
        });

        await expect(
          commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 1,
            provider: "thirdweb",
            steps: [
              {
                to:
                  "0x2222222222222222222222222222222222222222",
                data: "0x12345678",
                value: "0",
                chainId: 1,
                description: "Wrong-chain step",
              },
            ],
          })
        ).rejects.toThrow(
          "Avalanche bridge source evidence may only commit chain 43114 transactions"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "refuses to prepare an empty Avalanche source bundle",
      async () => {
        await expect(
          commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 1,
            provider: "thirdweb",
            steps: [],
          })
        ).rejects.toThrow(
          "Avalanche bridge source evidence requires at least one transaction"
        );

        expect(
          mockGetTransactionEvidence
        ).not.toHaveBeenCalled();

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "refuses to prepare bridge evidence that already contains prepared steps",
      async () => {
        mockGetTransactionEvidence.mockResolvedValue({
          evidence: {
            correlationId: CORRELATION_ID,
            action: "bridge-source:1",
            chainId: 43114,
            network: "avalanche-c-chain",
            walletAddress: USER.toLowerCase(),
            assetIn: SOURCE_TOKEN.toLowerCase(),
            assetOut: DEST_TOKEN.toLowerCase(),
            amountRaw: "1000000",
            createdAt:
              "2026-08-30T20:00:00.000Z",
            status: "intent-recorded",
          },
          steps: [
            {
              correlationId: CORRELATION_ID,
              stepIndex: 0,
              chainId: 43114,
            },
          ],
        });

        await expect(
          commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 1,
            provider: "thirdweb",
            steps: [
              {
                to:
                  "0x2222222222222222222222222222222222222222",
                data: "0x12345678",
                value: "0",
                chainId: 43114,
              },
            ],
          })
        ).rejects.toThrow(
          "Bridge evidence already contains prepared transaction steps"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "refuses to prepare bridge evidence outside the intent-recorded state",
      async () => {
        mockGetTransactionEvidence.mockResolvedValue({
          evidence: {
            correlationId: CORRELATION_ID,
            action: "bridge-source:1",
            chainId: 43114,
            network: "avalanche-c-chain",
            walletAddress: USER.toLowerCase(),
            assetIn: SOURCE_TOKEN.toLowerCase(),
            assetOut: DEST_TOKEN.toLowerCase(),
            amountRaw: "1000000",
            createdAt:
              "2026-08-30T20:00:00.000Z",
            status: "prepared",
          },
          steps: [],
        });

        await expect(
          commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 1,
            provider: "thirdweb",
            steps: [
              {
                to:
                  "0x2222222222222222222222222222222222222222",
                data: "0x12345678",
                value: "0",
                chainId: 43114,
              },
            ],
          })
        ).rejects.toThrow(
          "Bridge evidence cannot be prepared from status prepared"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "refuses a destination chain that does not match the persisted bridge intent",
      async () => {
        mockGetTransactionEvidence.mockResolvedValue({
          evidence: {
            correlationId: CORRELATION_ID,
            action: "bridge-source:1",
            chainId: 43114,
            network: "avalanche-c-chain",
            walletAddress: USER.toLowerCase(),
            assetIn: SOURCE_TOKEN.toLowerCase(),
            assetOut: DEST_TOKEN.toLowerCase(),
            amountRaw: "1000000",
            createdAt:
              "2026-08-30T20:00:00.000Z",
            status: "intent-recorded",
          },
          steps: [],
        });

        await expect(
          commitAvaxBridgeEvidence({
            correlationId: CORRELATION_ID,
            destinationChainId: 8453,
            provider: "thirdweb",
            steps: [
              {
                to:
                  "0x2222222222222222222222222222222222222222",
                data: "0x12345678",
                value: "0",
                chainId: 43114,
              },
            ],
          })
        ).rejects.toThrow(
          "Bridge destination does not match persisted evidence intent"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );
  }
);
