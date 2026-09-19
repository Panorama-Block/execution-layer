import { describe, expect, it } from "vitest";
import { avaxSwapRoutes } from "../avax-swap.routes";

describe("user estate administrative evidence route", () => {
  it("registers the authenticated administrative user-estate export endpoint", () => {
    const route = (avaxSwapRoutes as any).stack.find(
      (layer: any) =>
        layer.route?.path ===
          "/evidence/admin/user-estate/export/:userAddress" &&
        layer.route?.methods?.get === true
    );

    expect(route).toBeDefined();

    const handlerNames = route.route.stack.map(
      (layer: any) => layer.handle?.name
    );

    expect(handlerNames).toContain("requireWalletAuth");
  });
});
