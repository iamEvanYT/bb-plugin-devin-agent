import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_BRIDGE_EXPORT_NAME } from "@get-bb/plugin-sdk/provider-bridge";
import * as host from "../src/host.ts";

test("host entry exports the provider bridge under the SDK's name", () => {
  const bridge = (host as Record<string, unknown>)[
    PROVIDER_BRIDGE_EXPORT_NAME
  ] as { handleLine?: unknown; experimental_apiVersion?: unknown } | undefined;
  assert.equal(typeof bridge?.handleLine, "function");
  assert.equal(bridge?.experimental_apiVersion, 1);
});
