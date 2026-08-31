import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const CORRELATION_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const USER =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const DEST_TOKEN =
  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";

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
  beginAvaxBridgeDestinationEvidence,
  commitAvaxBridgeDestinationEvidence,
} from "../../../modules/avax-swap/services/bridge-evidence.service";

describe(
  "Avalanche bridge destination evidence boundary",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mockCreateEvidenceCorrelation
        .mockReturnValue({
          correlationId: CORRELATION_ID,
          evidenceVersion: "1.0",
          enabled: true,
        });

      mockPersistEvidenceIntent
        .mockResolvedValue(undefined);

      mockPersistPreparedEvidence
        .mockResolvedValue({
          correlationId: CORRELATION_ID,
          evidenceVersion: "1.0",
          evidenceEnabled: true,
          preparedPayloadHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        });
    });

    it(
      "persists an Avalanche destination intent bound to its source chain",
      async () => {
        await beginAvaxBridgeDestinationEvidence({
          userAddress: USER,
          sourceChainId: 1,
          destinationToken: DEST_TOKEN,
          amountRaw: "1000000",
        });

        expect(
          mockPersistEvidenceIntent
        ).toHaveBeenCalledTimes(1);

        expect(
          mockPersistEvidenceIntent
            .mock.calls[0][0]
        ).toMatchObject({
          correlationId: CORRELATION_ID,
          action: "bridge-destination:1",
          chainId: 43114,
          network: "avalanche-c-chain",
          walletAddress: USER,
          assetOut: DEST_TOKEN,
          amountRaw: "1000000",
        });
      }
    );

    it(
      "commits only ordered Avalanche destination transactions",
      async () => {
        mockGetTransactionEvidence
          .mockResolvedValue({
            evidence: {
              correlationId: CORRELATION_ID,
              action: "bridge-destination:1",
              chainId: 43114,
              network: "avalanche-c-chain",
              walletAddress:
                USER.toLowerCase(),
              assetOut:
                DEST_TOKEN.toLowerCase(),
              amountRaw: "1000000",
              createdAt:
                "2026-08-30T21:00:00.000Z",
              status: "intent-recorded",
            },
            steps: [],
          });

        const steps = [
          {
            to:
              "0x2222222222222222222222222222222222222222",
            data: "0x12345678",
            value: "0",
            chainId: 43114,
            description:
              "Bridge destination transaction",
          },
        ];

        await commitAvaxBridgeDestinationEvidence({
          correlationId: CORRELATION_ID,
          sourceChainId: 1,
          provider: "thirdweb",
          steps,
        });

        const [
          persistedIntent,
          persistedBundle,
          metadata,
        ] =
          mockPersistPreparedEvidence
            .mock.calls[0];

        expect(persistedIntent)
          .toMatchObject({
            action:
              "bridge-destination:1",
            chainId: 43114,
          });

        expect(persistedBundle.steps)
          .toEqual(steps);

        expect(metadata)
          .toMatchObject({
            action:
              "bridge-destination",
            sourceChainId: 1,
            provider: "thirdweb",
          });
      }
    );

    it(
      "rejects a source chain that does not match the persisted destination intent",
      async () => {
        mockGetTransactionEvidence
          .mockResolvedValue({
            evidence: {
              correlationId: CORRELATION_ID,
              action: "bridge-destination:10",
              chainId: 43114,
              network: "avalanche-c-chain",
              walletAddress: USER,
              assetOut: DEST_TOKEN,
              amountRaw: "1000000",
              createdAt:
                "2026-08-30T21:00:00.000Z",
              status: "intent-recorded",
            },
            steps: [],
          });

        await expect(
          commitAvaxBridgeDestinationEvidence({
            correlationId: CORRELATION_ID,
            sourceChainId: 1,
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
          "Bridge source does not match persisted destination evidence intent"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "rejects destination evidence outside intent-recorded lifecycle state",
      async () => {
        mockGetTransactionEvidence
          .mockResolvedValue({
            evidence: {
              correlationId: CORRELATION_ID,
              action: "bridge-destination:1",
              chainId: 43114,
              network: "avalanche-c-chain",
              walletAddress: USER,
              assetOut: DEST_TOKEN,
              amountRaw: "1000000",
              createdAt:
                "2026-08-30T21:00:00.000Z",
              status: "prepared",
            },
            steps: [],
          });

        await expect(
          commitAvaxBridgeDestinationEvidence({
            correlationId: CORRELATION_ID,
            sourceChainId: 1,
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
          "Bridge destination evidence cannot be prepared from status prepared"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "rejects destination evidence that already contains prepared steps",
      async () => {
        mockGetTransactionEvidence
          .mockResolvedValue({
            evidence: {
              correlationId: CORRELATION_ID,
              action: "bridge-destination:1",
              chainId: 43114,
              network: "avalanche-c-chain",
              walletAddress: USER,
              assetOut: DEST_TOKEN,
              amountRaw: "1000000",
              createdAt:
                "2026-08-30T21:00:00.000Z",
              status: "intent-recorded",
            },
            steps: [
              {
                stepIndex: 0,
                chainId: 43114,
              },
            ],
          });

        await expect(
          commitAvaxBridgeDestinationEvidence({
            correlationId: CORRELATION_ID,
            sourceChainId: 1,
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
          "Bridge destination evidence already contains prepared transaction steps"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "rejects non-Avalanche destination steps",
      async () => {
        await expect(
          commitAvaxBridgeDestinationEvidence({
            correlationId:
              CORRELATION_ID,
            sourceChainId: 1,
            provider: "thirdweb",
            steps: [
              {
                to:
                  "0x2222222222222222222222222222222222222222",
                data: "0x12345678",
                value: "0",
                chainId: 1,
              },
            ],
          })
        ).rejects.toThrow(
          "Avalanche bridge destination evidence may only commit chain 43114 transactions"
        );

        expect(
          mockPersistPreparedEvidence
        ).not.toHaveBeenCalled();
      }
    );
  }
);
