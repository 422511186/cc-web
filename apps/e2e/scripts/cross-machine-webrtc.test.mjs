import assert from "node:assert/strict";
import { test } from "node:test";
import { createPeerConfig, parseCliArgs } from "./cross-machine-webrtc.mjs";

test("parseCliArgs parses role, signal URL, ids, and repeated local ICE addresses", () => {
  const options = parseCliArgs([
    "--role",
    "client",
    "--signal",
    "ws://172.30.1.102:39001/",
    "--host-id",
    "host-e2e",
    "--client-id",
    "phone-e2e",
    "--local-address",
    "172.30.1.2",
    "--local-address",
    "10.70.198.189",
  ]);

  assert.equal(options.role, "client");
  assert.equal(options.signalUrl, "ws://172.30.1.102:39001/");
  assert.equal(options.hostId, "host-e2e");
  assert.equal(options.clientId, "phone-e2e");
  assert.deepEqual(options.localAddresses, ["172.30.1.2", "10.70.198.189"]);
});

test("createPeerConfig includes explicit host addresses and default STUN", () => {
  const config = createPeerConfig({
    localAddresses: ["172.30.1.2"],
    iceServers: [],
  });

  assert.deepEqual(config.iceAdditionalHostAddresses, ["172.30.1.2"]);
  assert.equal(config.iceTransportPolicy, "all");
  assert.deepEqual(config.iceServers, [{ urls: "stun:stun.l.google.com:19302" }]);
});
