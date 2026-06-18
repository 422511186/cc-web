import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { RTCPeerConnection } from "werift";

const DEFAULT_HOST_ID = "coderelay-host-e2e";
const DEFAULT_CLIENT_ID = "coderelay-client-e2e";
const DEFAULT_CONNECTION_ID = "coderelay-cross-machine";
const DEFAULT_SIGNAL_PORT = 39001;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const DATA_CHANNEL_LABEL = "coderelay-cross-machine";

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    role: undefined,
    signalUrl: undefined,
    bindHost: "0.0.0.0",
    port: DEFAULT_SIGNAL_PORT,
    hostId: DEFAULT_HOST_ID,
    clientId: DEFAULT_CLIENT_ID,
    connectionId: DEFAULT_CONNECTION_ID,
    localAddresses: [],
    iceServers: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    message: "coderelay-cross-machine-ping",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--role":
        options.role = nextValue(argv, ++index, arg);
        break;
      case "--signal":
        options.signalUrl = nextValue(argv, ++index, arg);
        break;
      case "--bind-host":
        options.bindHost = nextValue(argv, ++index, arg);
        break;
      case "--port":
        options.port = Number.parseInt(nextValue(argv, ++index, arg), 10);
        break;
      case "--host-id":
        options.hostId = nextValue(argv, ++index, arg);
        break;
      case "--client-id":
        options.clientId = nextValue(argv, ++index, arg);
        break;
      case "--connection-id":
        options.connectionId = nextValue(argv, ++index, arg);
        break;
      case "--local-address":
        options.localAddresses.push(nextValue(argv, ++index, arg));
        break;
      case "--ice-server":
        options.iceServers.push({ urls: nextValue(argv, ++index, arg) });
        break;
      case "--timeout-ms":
        options.timeoutMs = Number.parseInt(nextValue(argv, ++index, arg), 10);
        break;
      case "--message":
        options.message = nextValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["signal", "host", "client"].includes(options.role ?? "")) {
    throw new Error("--role must be one of: signal, host, client");
  }

  if ((options.role === "host" || options.role === "client") && !options.signalUrl) {
    throw new Error("--signal is required for host and client roles");
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }

  return options;
}

export function createPeerConfig({ localAddresses = [], iceServers = [] } = {}) {
  return {
    iceTransportPolicy: "all",
    iceServers: iceServers.length > 0 ? iceServers : DEFAULT_ICE_SERVERS,
    iceAdditionalHostAddresses: [...localAddresses],
    iceUseIpv4: true,
    iceUseIpv6: false,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);

  if (options.role === "signal") {
    await runSignal(options);
    return;
  }

  if (options.role === "host") {
    await runHost(options);
    return;
  }

  await runClient(options);
}

async function runSignal(options) {
  const { startSignalServer } = await import("../../signal/dist/index.js");
  const server = await startSignalServer({ host: options.bindHost, port: options.port });
  console.log(
    JSON.stringify({
      event: "signal.ready",
      bindHost: options.bindHost,
      port: options.port,
      url: server.url,
    }),
  );

  await new Promise((resolve) => {
    const close = async () => {
      await server.close();
      resolve();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function runHost(options) {
  const signal = await openSignalClient(options.signalUrl);
  const peer = createPeer(options);
  const candidateHandler = createRemoteCandidateHandler(peer);
  const channelPromise = new Promise((resolve) => {
    peer.ondatachannel = (event) => resolve(event.channel);
  });
  const completed = new Deferred();

  signal.onMessage((message) => {
    if (isWebRtcCandidate(message, options.connectionId)) {
      void candidateHandler.handle(message.candidate);
    }
  });

  signal.send({ type: "host.online", hostId: options.hostId });
  const connect = await signal.waitFor(
    (message) =>
      message.type === "client.connect" &&
      message.hostId === options.hostId &&
      message.clientId === options.clientId,
    options.timeoutMs,
    "Timed out waiting for client.connect",
  );

  signal.send({
    type: "connection.accept",
    requestId: connect.requestId,
    connectionId: options.connectionId,
    clientId: options.clientId,
  });
  wireIce(peer, signal, options.connectionId);

  const offer = await signal.waitFor(
    (message) => message.type === "webrtc.offer" && message.connectionId === options.connectionId,
    options.timeoutMs,
    "Timed out waiting for WebRTC offer",
  );
  await peer.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  await candidateHandler.flush();
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  signal.send({
    type: "webrtc.answer",
    connectionId: options.connectionId,
    sdp: peer.localDescription?.sdp ?? answer.sdp,
  });

  const channel = await withTimeout(channelPromise, options.timeoutMs, "Timed out waiting for host DataChannel");
  channel.onmessage = (event) => {
    const payload = parseJson(event.data);
    channel.send(
      JSON.stringify({
        type: "coderelay.cross.pong",
        hostId: options.hostId,
        echo: payload,
      }),
    );
    completed.resolve(payload);
  };
  await waitForChannelOpen(channel, options.timeoutMs);

  const payload = await withTimeout(completed.promise, options.timeoutMs, "Timed out waiting for DataChannel ping");
  console.log(
    JSON.stringify({
      event: "host.ok",
      connectionId: options.connectionId,
      received: payload,
    }),
  );

  await sleep(250);
  await closePeer(peer, signal);
}

async function runClient(options) {
  const signal = await openSignalClient(options.signalUrl);
  const peer = createPeer(options);
  const candidateHandler = createRemoteCandidateHandler(peer);
  const nonce = randomUUID();

  signal.onMessage((message) => {
    if (isWebRtcCandidate(message, options.connectionId)) {
      void candidateHandler.handle(message.candidate);
    }
  });

  signal.send({
    type: "client.connect",
    requestId: `connect-${nonce}`,
    hostId: options.hostId,
    clientId: options.clientId,
    clientPublicKeyFingerprint: `cross-machine-${options.clientId}`,
  });

  const accepted = await signal.waitFor(
    (message) => message.type === "connection.accepted" && message.clientId === options.clientId,
    options.timeoutMs,
    "Timed out waiting for connection.accepted",
  );
  const connectionId = accepted.connectionId;
  wireIce(peer, signal, connectionId);

  const channel = peer.createDataChannel(DATA_CHANNEL_LABEL);
  const responsePromise = waitForDataChannelMessage(channel, options.timeoutMs);
  const channelOpenPromise = waitForChannelOpen(channel, options.timeoutMs);
  const answerPromise = signal.waitFor(
    (message) => message.type === "webrtc.answer" && message.connectionId === connectionId,
    options.timeoutMs,
    "Timed out waiting for WebRTC answer",
  );

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  signal.send({
    type: "webrtc.offer",
    connectionId,
    sdp: peer.localDescription?.sdp ?? offer.sdp,
  });

  const answer = await answerPromise;
  await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  await candidateHandler.flush();
  await channelOpenPromise;

  const payload = {
    type: "coderelay.cross.ping",
    clientId: options.clientId,
    nonce,
    text: options.message,
  };
  channel.send(JSON.stringify(payload));
  const response = await responsePromise;

  if (response.type !== "coderelay.cross.pong") {
    throw new Error(`Unexpected DataChannel response type: ${response.type}`);
  }
  if (response.echo?.nonce !== nonce) {
    throw new Error("DataChannel response did not echo the client nonce");
  }

  console.log(
    JSON.stringify({
      event: "client.ok",
      connectionId,
      nonce,
      response,
    }),
  );
  console.log("CROSS_MACHINE_WEBRTC_OK");

  await closePeer(peer, signal);
}

function createPeer(options) {
  return new RTCPeerConnection(
    createPeerConfig({
      localAddresses: options.localAddresses,
      iceServers: options.iceServers,
    }),
  );
}

function wireIce(peer, signal, connectionId) {
  peer.onicecandidate = ({ candidate }) => {
    if (candidate) {
      signal.send({ type: "webrtc.candidate", connectionId, candidate });
    }
  };
}

function createRemoteCandidateHandler(peer) {
  const pending = [];
  let remoteDescriptionSet = false;

  return {
    async handle(candidate) {
      if (!candidate) {
        return;
      }

      if (!remoteDescriptionSet) {
        pending.push(candidate);
        return;
      }

      await peer.addIceCandidate(candidate);
    },
    async flush() {
      remoteDescriptionSet = true;
      while (pending.length > 0) {
        await peer.addIceCandidate(pending.shift());
      }
    },
  };
}

async function openSignalClient(url) {
  const socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
  const listeners = new Set();
  const queued = [];
  const waiters = new Set();

  socket.on("message", (data) => {
    const message = parseJson(data.toString());
    for (const listener of listeners) {
      listener(message);
    }

    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        return;
      }
    }
    queued.push(message);
  });

  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waitFor(predicate, timeoutMs, errorMessage) {
      const existingIndex = queued.findIndex(predicate);
      if (existingIndex >= 0) {
        const [message] = queued.splice(existingIndex, 1);
        return Promise.resolve(message);
      }

      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(errorMessage));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    close() {
      socket.close();
    },
  };
}

function waitForChannelOpen(channel, timeoutMs) {
  if (channel.readyState === "open") {
    return Promise.resolve();
  }

  return withTimeout(
    new Promise((resolve, reject) => {
      channel.onopen = () => resolve();
      channel.onerror = (error) => reject(error instanceof Error ? error : new Error("DataChannel error"));
      channel.onclose = () => reject(new Error("DataChannel closed before opening"));
    }),
    timeoutMs,
    "Timed out waiting for DataChannel to open",
  );
}

function waitForDataChannelMessage(channel, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      channel.onmessage = (event) => {
        try {
          resolve(parseJson(event.data));
        } catch (error) {
          reject(error);
        }
      };
      channel.onerror = (error) => reject(error instanceof Error ? error : new Error("DataChannel error"));
      channel.onclose = () => reject(new Error("DataChannel closed before response"));
    }),
    timeoutMs,
    "Timed out waiting for DataChannel response",
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function parseJson(data) {
  return JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
}

async function closePeer(peer, signal) {
  signal.close();
  await peer.close();
}

function nextValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function isWebRtcCandidate(message, connectionId) {
  return message.type === "webrtc.candidate" && message.connectionId === connectionId;
}

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
