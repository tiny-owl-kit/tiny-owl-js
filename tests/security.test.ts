/**
 * HMAC parity vectors shared with the Python and PHP SDKs.
 *
 * Do not change these constants. v2 is copied into the Python (026.9) and
 * PHP (026.10) SDK tests, so any change here breaks wire parity.
 */

import { signPayload } from "../src/security.js";

const SECRET = "super-secret-project-key-for-testing";
const NONCE = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const TIMESTAMP = "2026-08-19T10:20:30.000Z";

describe("HMAC parity vectors (do not change these constants)", () => {
  it("v1 matches the canonical signature without service/environment", () => {
    const payload = {
      message: "Payment processed",
      severity: "info",
      context: { order_id: "ORD-9", amount: 49.99 },
      traceId: "req-abc-123",
      timestamp: TIMESTAMP,
      nonce: NONCE,
    };

    expect(signPayload(payload, SECRET)).toBe(
      "cee771d25dcfb623fcefe37860dbac955fa10bf717e1de789cbbf2865a59b3e8",
    );
  });

  it("v2 matches the canonical signature with service/environment", () => {
    const payload = {
      message: "Payment processed",
      severity: "info",
      context: { order_id: "ORD-9", amount: 49.99 },
      traceId: "req-abc-123",
      service: "checkout-api",
      environment: "production",
      timestamp: TIMESTAMP,
      nonce: NONCE,
    };

    expect(JSON.stringify(payload)).toBe(
      '{"message":"Payment processed","severity":"info","context":{"order_id":"ORD-9","amount":49.99},"traceId":"req-abc-123","service":"checkout-api","environment":"production","timestamp":"2026-08-19T10:20:30.000Z","nonce":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"}',
    );
    expect(signPayload(payload, SECRET)).toBe(
      "55df60dfd253e50fe5357784b245bb9279d33ec06626eb555a6caceff49c02c4",
    );
  });
});
