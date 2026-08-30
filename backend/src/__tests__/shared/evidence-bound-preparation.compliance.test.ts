import {
  vi,
} from "vitest";

import type { TransactionBundle } from "../../types/transaction";

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
  "../../shared/services/transaction-evidence.service",
  () => ({
    createEvidenceCorrelation: mockCreateEvidenceCorrelation,
    persistEvidenceIntent: mockPersistEvidenceIntent,
    persistPreparedEvidence: mockPersistPreparedEvidence,
  })
);

import {
  prepareEvidenceBoundBundle,
} from "../../shared/services/evidence-bound-preparation.service";

import {
  defineEvidencePreparationComplianceSuite,
} from "./compliance/evidence-bound-preparation.compliance";

const CORRELATION_ID =
  "11111111-2222-4333-8444-555555555555";

const PREPARED_PAYLOAD_HASH =
  `0x${"ab".repeat(32)}`;

const bundle: TransactionBundle = {
  steps: [
    {
      to: "0xc35059D1BC395Ff0F6fDcEA1b7F365E3aa7C1D12",
      data: "0xdeadbeef",
      value: "123456789",
      chainId: 43114,
      description: "Evidence compliance transaction",
    },
  ],
  totalSteps: 1,
  summary: "Evidence compliance bundle",
};

const metadata = {
  service: "COMPLIANCE",
  selectedProvider: "test-provider",
};

const intent = {
  action: "compliance",
  chainId: 43114,
  network: "avalanche-c-chain",
  walletAddress:
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
};

defineEvidencePreparationComplianceSuite({
  name: "generic preparation boundary",

  prepareBoundary: prepareEvidenceBoundBundle as any,

  intent,
  bundle,
  metadata,

  correlationId: CORRELATION_ID,
  preparedPayloadHash: PREPARED_PAYLOAD_HASH,

  persistIntentMock: mockPersistEvidenceIntent,
  persistPreparedMock: mockPersistPreparedEvidence,

  reset: () => {
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
      preparedPayloadHash: PREPARED_PAYLOAD_HASH,
    });
  },
});
