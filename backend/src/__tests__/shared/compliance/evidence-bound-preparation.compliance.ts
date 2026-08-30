import {
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
} from "vitest";

export interface EvidencePreparationComplianceHarness {
  name: string;

  prepareBoundary: (input: {
    intent: Record<string, unknown>;
    prepare: () => Promise<{
      bundle: unknown;
      metadata: Record<string, unknown>;
    }>;
  }) => Promise<any>;

  intent: Record<string, unknown>;
  bundle: unknown;
  metadata: Record<string, unknown>;

  correlationId: string;
  preparedPayloadHash: string;

  persistIntentMock: Mock;
  persistPreparedMock: Mock;

  reset: () => void;
}

export function defineEvidencePreparationComplianceSuite(
  harness: EvidencePreparationComplianceHarness
): void {
  describe(`${harness.name} evidence preparation compliance`, () => {
    beforeEach(() => {
      harness.reset();
    });

    it("commits intent before transaction preparation and prepared evidence before returning", async () => {
      const events: string[] = [];

      harness.persistIntentMock.mockImplementation(async () => {
        events.push("intent");
      });

      const prepare = async () => {
        events.push("prepare");

        return {
          bundle: harness.bundle,
          metadata: harness.metadata,
        };
      };

      harness.persistPreparedMock.mockImplementation(async () => {
        events.push("prepared-evidence");

        return {
          correlationId: harness.correlationId,
          evidenceVersion: "1.0",
          evidenceEnabled: true,
          preparedPayloadHash: harness.preparedPayloadHash,
        };
      });

      const result = await harness.prepareBoundary({
        intent: harness.intent,
        prepare,
      });

      events.push("returned");

      expect(events).toEqual([
        "intent",
        "prepare",
        "prepared-evidence",
        "returned",
      ]);

      expect(result.bundle).toBe(harness.bundle);
    });

    it("does not expose or prepare an executable bundle when intent persistence fails", async () => {
      const prepare = async () => ({
        bundle: harness.bundle,
        metadata: harness.metadata,
      });

      harness.persistIntentMock.mockRejectedValue(
        new Error("intent persistence failed")
      );

      let preparationCalled = false;

      await expect(
        harness.prepareBoundary({
          intent: harness.intent,
          prepare: async () => {
            preparationCalled = true;
            return prepare();
          },
        })
      ).rejects.toThrow("intent persistence failed");

      expect(preparationCalled).toBe(false);
      expect(harness.persistPreparedMock).not.toHaveBeenCalled();
    });

    it("does not commit prepared evidence when transaction preparation fails", async () => {
      await expect(
        harness.prepareBoundary({
          intent: harness.intent,
          prepare: async () => {
            throw new Error("transaction preparation failed");
          },
        })
      ).rejects.toThrow("transaction preparation failed");

      expect(harness.persistIntentMock).toHaveBeenCalledTimes(1);
      expect(harness.persistPreparedMock).not.toHaveBeenCalled();
    });

    it("does not return an executable bundle when prepared evidence persistence fails", async () => {
      harness.persistPreparedMock.mockRejectedValue(
        new Error("prepared evidence persistence failed")
      );

      await expect(
        harness.prepareBoundary({
          intent: harness.intent,
          prepare: async () => ({
            bundle: harness.bundle,
            metadata: harness.metadata,
          }),
        })
      ).rejects.toThrow("prepared evidence persistence failed");

      expect(harness.persistIntentMock).toHaveBeenCalledTimes(1);
      expect(harness.persistPreparedMock).toHaveBeenCalledTimes(1);
    });

    it("preserves the exact prepared bundle and metadata instances", async () => {
      const result = await harness.prepareBoundary({
        intent: harness.intent,
        prepare: async () => ({
          bundle: harness.bundle,
          metadata: harness.metadata,
        }),
      });

      expect(result.bundle).toBe(harness.bundle);
      expect(result.metadata).toBe(harness.metadata);
    });

    it("returns the committed evidence identity with the executable bundle", async () => {
      const result = await harness.prepareBoundary({
        intent: harness.intent,
        prepare: async () => ({
          bundle: harness.bundle,
          metadata: harness.metadata,
        }),
      });

      expect(result).toMatchObject({
        correlationId: harness.correlationId,
        evidenceEnabled: true,
        preparedPayloadHash: harness.preparedPayloadHash,
      });
    });
  });
}
