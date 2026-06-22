// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// ../msgpackr-extract-stub/index.cjs
var require_msgpackr_extract_stub = __commonJS((exports, module) => {
  module.exports = false;
});

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/require-bun.js
if (typeof globalThis.Bun === "undefined") {
  throw new Error("bunqueue is Bun-only and requires the Bun runtime (https://bun.sh). " + "Node.js is not supported: install Bun and run your program with `bun`.");
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/backup/s3BackupConfig.js
var DEFAULTS = {
  intervalMs: 6 * 60 * 60 * 1000,
  retention: 7,
  prefix: "backups/",
  region: "us-east-1"
};
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/types.js
var DEFAULT_CONNECTION = {
  host: "localhost",
  port: 6789,
  token: "",
  tls: false,
  maxReconnectAttempts: Infinity,
  reconnectDelay: 100,
  maxReconnectDelay: 30000,
  connectTimeout: 5000,
  commandTimeout: 30000,
  autoReconnect: true,
  pingInterval: 30000,
  maxPingFailures: 3,
  maxCommandTimeouts: 3,
  pipelining: true,
  maxInFlight: 100
};
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/health.js
var DEFAULT_MAX_COMMAND_TIMEOUTS = 3;

class HealthTracker {
  config;
  consecutivePingFailures = 0;
  consecutiveCommandTimeouts = 0;
  lastSuccessAt = null;
  lastErrorAt = null;
  connectedAt = null;
  totalCommands = 0;
  totalErrors = 0;
  latencyHistory = [];
  pingTimer = null;
  static MAX_LATENCY_HISTORY = 10;
  constructor(config) {
    this.config = config;
  }
  recordSuccess(latencyMs) {
    this.lastSuccessAt = Date.now();
    this.totalCommands++;
    this.consecutiveCommandTimeouts = 0;
    this.recordLatency(latencyMs);
  }
  recordError() {
    this.lastErrorAt = Date.now();
    this.totalErrors++;
  }
  recordCommandSent() {
    this.totalCommands++;
  }
  recordConnected() {
    this.connectedAt = Date.now();
    this.consecutivePingFailures = 0;
    this.consecutiveCommandTimeouts = 0;
  }
  recordPingSuccess(latencyMs) {
    this.consecutivePingFailures = 0;
    this.consecutiveCommandTimeouts = 0;
    this.recordLatency(latencyMs);
  }
  recordPingFailure() {
    this.consecutivePingFailures++;
    this.lastErrorAt = Date.now();
    this.totalErrors++;
    return this.consecutivePingFailures >= this.config.maxPingFailures;
  }
  recordCommandTimeout() {
    const max = this.config.maxCommandTimeouts ?? DEFAULT_MAX_COMMAND_TIMEOUTS;
    if (max <= 0)
      return false;
    this.consecutiveCommandTimeouts++;
    return this.consecutiveCommandTimeouts >= max;
  }
  getHealth(state) {
    const avgLatency = this.latencyHistory.length > 0 ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length : 0;
    return {
      healthy: state === "connected" && this.consecutivePingFailures < this.config.maxPingFailures,
      state,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      consecutivePingFailures: this.consecutivePingFailures,
      consecutiveCommandTimeouts: this.consecutiveCommandTimeouts,
      totalCommands: this.totalCommands,
      totalErrors: this.totalErrors,
      uptimeMs: this.connectedAt ? Date.now() - this.connectedAt : 0
    };
  }
  startPing(pingFn) {
    if (this.config.pingInterval <= 0)
      return;
    this.stopPing();
    this.pingTimer = setInterval(() => {
      pingFn();
    }, this.config.pingInterval);
  }
  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  recordLatency(latencyMs) {
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > HealthTracker.MAX_LATENCY_HISTORY) {
      this.latencyHistory.shift();
    }
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/reconnect.js
import { EventEmitter } from "events";

class ReconnectManager extends EventEmitter {
  config;
  on(event, listener) {
    return super.on(event, listener);
  }
  once(event, listener) {
    return super.once(event, listener);
  }
  reconnectAttempts = 0;
  reconnectTimer = null;
  closed = false;
  constructor(config) {
    super();
    this.config = config;
  }
  setClosed(closed) {
    this.closed = closed;
    if (closed) {
      this.cancelReconnect();
    }
  }
  isClosed() {
    return this.closed;
  }
  reset() {
    this.reconnectAttempts = 0;
  }
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  canReconnect() {
    return this.config.autoReconnect && !this.closed;
  }
  scheduleReconnect(connectFn) {
    if (this.reconnectTimer || this.closed)
      return false;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      this.emit("maxReconnectAttemptsReached");
      return false;
    }
    const baseDelay = Math.min(this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.config.maxReconnectDelay);
    const jitter = Math.random() * 0.3 * baseDelay;
    const delay = baseDelay + jitter;
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      connectFn().catch(() => {});
    }, delay);
    return true;
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/webhookValidation.js
function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}
function checkPrivateIpv4(hostname) {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m)
    return null;
  const [, a, b] = m.map(Number);
  if (a === 10)
    return "Webhook URL cannot point to private IP";
  if (a === 172 && b >= 16 && b <= 31)
    return "Webhook URL cannot point to private IP";
  if (a === 192 && b === 168)
    return "Webhook URL cannot point to private IP";
  if (a === 169 && b === 254)
    return "Webhook URL cannot point to link-local IP";
  if (a === 0)
    return "Webhook URL cannot point to unspecified IP";
  if (a === 127)
    return "Webhook URL cannot point to loopback IP";
  return null;
}
function isCloudMetadata(hostname) {
  return hostname === "169.254.169.254" || hostname === "metadata.google.internal" || hostname.endsWith(".internal");
}
function validateWebhookUrl(url) {
  if (!url || url.length === 0)
    return "Webhook URL is required";
  if (url.length > 2048)
    return "Webhook URL too long (max 2048 characters)";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Webhook URL must use http or https protocol";
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isLocalhost(hostname))
    return "Webhook URL cannot point to localhost";
  const ipError = checkPrivateIpv4(hostname);
  if (ipError)
    return ipError;
  if (isCloudMetadata(hostname))
    return "Webhook URL cannot point to cloud metadata endpoints";
  return null;
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/server/protocol.js
var MAX_FRAME_SIZE = 64 * 1024 * 1024;

class FrameSizeError extends Error {
  requestedSize;
  maxSize;
  constructor(requestedSize, maxSize) {
    super(`Frame size ${requestedSize} exceeds maximum allowed size ${maxSize}`);
    this.requestedSize = requestedSize;
    this.maxSize = maxSize;
    this.name = "FrameSizeError";
  }
}

class FrameParser {
  buffer = new Uint8Array(0);
  maxFrameSize;
  constructor(maxFrameSize = MAX_FRAME_SIZE) {
    this.maxFrameSize = maxFrameSize;
  }
  addData(data) {
    const newBuffer = new Uint8Array(this.buffer.length + data.length);
    newBuffer.set(this.buffer);
    newBuffer.set(data, this.buffer.length);
    this.buffer = newBuffer;
    const frames = [];
    while (this.buffer.length >= 4) {
      const length = (this.buffer[0] << 24 | this.buffer[1] << 16 | this.buffer[2] << 8 | this.buffer[3]) >>> 0;
      if (length > this.maxFrameSize) {
        this.buffer = new Uint8Array(0);
        throw new FrameSizeError(length, this.maxFrameSize);
      }
      if (this.buffer.length < 4 + length) {
        break;
      }
      frames.push(this.buffer.slice(4, 4 + length));
      this.buffer = this.buffer.slice(4 + length);
    }
    return frames;
  }
  get bufferedBytes() {
    return this.buffer.length;
  }
  get hasPartialFrame() {
    return this.buffer.length > 0;
  }
  clear() {
    this.buffer = new Uint8Array(0);
  }
  static frame(data) {
    const frame = new Uint8Array(4 + data.length);
    frame[0] = data.length >> 24 & 255;
    frame[1] = data.length >> 16 & 255;
    frame[2] = data.length >> 8 & 255;
    frame[3] = data.length & 255;
    frame.set(data, 4);
    return frame;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/connection.js
function buildClientTls(tls) {
  if (!tls)
    return;
  if (tls === true)
    return true;
  return {
    ...tls.rejectUnauthorized !== undefined && { rejectUnauthorized: tls.rejectUnauthorized },
    ...tls.caFile !== undefined && { ca: Bun.file(tls.caFile) }
  };
}
async function createConnection(target, connectTimeout, events) {
  return new Promise((resolve, reject) => {
    const socketData = {
      write: () => {},
      end: () => {},
      frameParser: new FrameParser
    };
    let connectionResolved = false;
    let timeoutId = null;
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const targetDesc = `${target.host}:${target.port}`;
    const socketHandlers = {
      data(_sock, data) {
        let frames;
        try {
          frames = socketData.frameParser.addData(new Uint8Array(data));
        } catch (err) {
          if (err instanceof FrameSizeError) {
            events.onError(new Error(`Frame too large: ${err.requestedSize} bytes exceeds maximum ${err.maxSize}`));
            return;
          }
          throw err;
        }
        for (const frame of frames) {
          events.onData(frame);
        }
      },
      open(sock) {
        cleanup();
        try {
          sock.setKeepAlive?.(true, 15000);
        } catch {}
        socketData.write = (d) => sock.write(d);
        socketData.end = () => sock.end();
        connectionResolved = true;
        resolve({ socket: socketData, cleanup });
      },
      close() {
        if (!connectionResolved) {
          connectionResolved = true;
          cleanup();
          reject(new Error("Connection closed"));
        }
        events.onClose();
      },
      error(_sock, error2) {
        if (!connectionResolved) {
          connectionResolved = true;
          cleanup();
          reject(new Error(`Connection error: ${error2.message}`));
        }
        events.onError(error2);
      },
      connectError(_sock, error2) {
        if (!connectionResolved) {
          connectionResolved = true;
          cleanup();
          reject(new Error(`Failed to connect to ${targetDesc}: ${error2.message}`));
        }
      }
    };
    const tlsValue = buildClientTls(target.tls);
    Bun.connect({
      hostname: target.host ?? "localhost",
      port: target.port ?? 6789,
      ...tlsValue !== undefined && { tls: tlsValue },
      socket: socketHandlers
    }).catch((error2) => {
      if (!connectionResolved) {
        connectionResolved = true;
        cleanup();
        const message = error2 instanceof Error ? error2.message : String(error2);
        reject(new Error(`Failed to connect to ${targetDesc}: ${message}`));
      }
    });
    timeoutId = setTimeout(() => {
      if (!connectionResolved) {
        connectionResolved = true;
        reject(new Error(`Connection timeout to ${targetDesc}`));
      }
    }, connectTimeout);
  });
}

class CommandQueue {
  pendingCommands = new Map;
  pendingQueue = [];
  currentCommand = null;
  commandIdCounter = 0;
  inFlightByReqId = new Map;
  getCurrentCommand() {
    return this.currentCommand;
  }
  setCurrentCommand(cmd) {
    this.currentCommand = cmd;
  }
  hasPending() {
    return this.pendingCommands.size > 0;
  }
  getInFlightCount() {
    return this.inFlightByReqId.size;
  }
  canSendMore(maxInFlight) {
    return this.inFlightByReqId.size < maxInFlight;
  }
  addInFlight(command) {
    this.inFlightByReqId.set(command.reqId, command);
  }
  getByReqId(reqId) {
    return this.inFlightByReqId.get(reqId);
  }
  removeByReqId(reqId) {
    const cmd = this.inFlightByReqId.get(reqId);
    if (cmd) {
      this.inFlightByReqId.delete(reqId);
    }
    return cmd;
  }
  enqueue(command) {
    this.pendingCommands.set(command.id, command);
    this.pendingQueue.push(command.id);
  }
  nextId() {
    return ++this.commandIdCounter;
  }
  dequeue() {
    const nextId = this.pendingQueue.shift();
    if (nextId === undefined)
      return null;
    const next = this.pendingCommands.get(nextId);
    if (!next)
      return null;
    this.pendingCommands.delete(nextId);
    return next;
  }
  remove(id) {
    if (!this.pendingCommands.has(id))
      return false;
    this.pendingCommands.delete(id);
    const queueIdx = this.pendingQueue.indexOf(id);
    if (queueIdx !== -1) {
      this.pendingQueue.splice(queueIdx, 1);
    }
    return true;
  }
  rejectAll(error2) {
    for (const cmd of this.pendingCommands.values()) {
      clearTimeout(cmd.timeout);
      cmd.promise?.catch(() => {});
      cmd.reject(error2);
    }
    this.pendingCommands.clear();
    this.pendingQueue = [];
    for (const cmd of this.inFlightByReqId.values()) {
      clearTimeout(cmd.timeout);
      cmd.promise?.catch(() => {});
      cmd.reject(error2);
    }
    this.inFlightByReqId.clear();
    if (this.currentCommand) {
      clearTimeout(this.currentCommand.timeout);
      this.currentCommand.reject(error2);
      this.currentCommand = null;
    }
  }
  clearCurrent(error2) {
    if (this.currentCommand) {
      clearTimeout(this.currentCommand.timeout);
      if (error2) {
        this.currentCommand.reject(error2);
      }
      this.currentCommand = null;
    }
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/client.js
import { EventEmitter as EventEmitter2 } from "events";

// ../../node_modules/.bun/msgpackr@1.12.1/node_modules/msgpackr/unpack.js
var decoder;
try {
  decoder = new TextDecoder;
} catch (error2) {}
var src;
var srcEnd;
var position = 0;
var EMPTY_ARRAY = [];
var strings = EMPTY_ARRAY;
var stringPosition = 0;
var currentUnpackr = {};
var currentStructures;
var srcString;
var srcStringStart = 0;
var srcStringEnd = 0;
var bundledStrings;
var referenceMap;
var currentExtensions = [];
var dataView;
var defaultOptions = {
  useRecords: false,
  mapsAsObjects: true
};

class C1Type {
}
var C1 = new C1Type;
C1.name = "MessagePack 0xC1";
var sequentialMode = false;
var inlineObjectReadThreshold = 2;
var readStruct;
var onLoadedStructures;
var onSaveState;
class Unpackr {
  constructor(options) {
    if (options) {
      if (options.useRecords === false && options.mapsAsObjects === undefined)
        options.mapsAsObjects = true;
      if (options.sequential && options.trusted !== false) {
        options.trusted = true;
        if (!options.structures && options.useRecords != false) {
          options.structures = [];
          if (!options.maxSharedStructures)
            options.maxSharedStructures = 0;
        }
      }
      if (options.structures)
        options.structures.sharedLength = options.structures.length;
      else if (options.getStructures) {
        (options.structures = []).uninitialized = true;
        options.structures.sharedLength = 0;
      }
      if (options.int64AsNumber) {
        options.int64AsType = "number";
      }
    }
    Object.assign(this, options);
  }
  unpack(source, options) {
    if (src) {
      return saveState(() => {
        clearSource();
        return this ? this.unpack(source, options) : Unpackr.prototype.unpack.call(defaultOptions, source, options);
      });
    }
    if (!source.buffer && source.constructor === ArrayBuffer)
      source = typeof Buffer !== "undefined" ? Buffer.from(source) : new Uint8Array(source);
    if (typeof options === "object") {
      srcEnd = options.end || source.length;
      position = options.start || 0;
    } else {
      position = 0;
      srcEnd = options > -1 ? options : source.length;
    }
    stringPosition = 0;
    srcStringEnd = 0;
    srcString = null;
    strings = EMPTY_ARRAY;
    bundledStrings = null;
    src = source;
    try {
      dataView = source.dataView || (source.dataView = new DataView(source.buffer, source.byteOffset, source.byteLength));
    } catch (error2) {
      src = null;
      if (source instanceof Uint8Array)
        throw error2;
      throw new Error("Source must be a Uint8Array or Buffer but was a " + (source && typeof source == "object" ? source.constructor.name : typeof source));
    }
    if (this instanceof Unpackr) {
      currentUnpackr = this;
      if (this.structures) {
        currentStructures = this.structures;
        return checkedRead(options);
      } else if (!currentStructures || currentStructures.length > 0) {
        currentStructures = [];
      }
    } else {
      currentUnpackr = defaultOptions;
      if (!currentStructures || currentStructures.length > 0)
        currentStructures = [];
    }
    return checkedRead(options);
  }
  unpackMultiple(source, forEach) {
    let values, lastPosition = 0;
    try {
      sequentialMode = true;
      let size = source.length;
      let value = this ? this.unpack(source, size) : defaultUnpackr.unpack(source, size);
      if (forEach) {
        if (forEach(value, lastPosition, position) === false)
          return;
        while (position < size) {
          lastPosition = position;
          if (forEach(checkedRead(), lastPosition, position) === false) {
            return;
          }
        }
      } else {
        values = [value];
        while (position < size) {
          lastPosition = position;
          values.push(checkedRead());
        }
        return values;
      }
    } catch (error2) {
      error2.lastPosition = lastPosition;
      error2.values = values;
      throw error2;
    } finally {
      sequentialMode = false;
      clearSource();
    }
  }
  _mergeStructures(loadedStructures, existingStructures) {
    if (onLoadedStructures)
      loadedStructures = onLoadedStructures.call(this, loadedStructures);
    loadedStructures = loadedStructures || [];
    if (Object.isFrozen(loadedStructures))
      loadedStructures = loadedStructures.map((structure) => structure.slice(0));
    for (let i = 0, l = loadedStructures.length;i < l; i++) {
      let structure = loadedStructures[i];
      if (structure) {
        structure.isShared = true;
        if (i >= 32)
          structure.highByte = i - 32 >> 5;
      }
    }
    loadedStructures.sharedLength = loadedStructures.length;
    for (let id in existingStructures || []) {
      if (id >= 0) {
        let structure = loadedStructures[id];
        let existing = existingStructures[id];
        if (existing) {
          if (structure)
            (loadedStructures.restoreStructures || (loadedStructures.restoreStructures = []))[id] = structure;
          loadedStructures[id] = existing;
        }
      }
    }
    return this.structures = loadedStructures;
  }
  decode(source, options) {
    return this.unpack(source, options);
  }
}
function checkedRead(options) {
  try {
    if (!currentUnpackr.trusted && !sequentialMode) {
      let sharedLength = currentStructures.sharedLength || 0;
      if (sharedLength < currentStructures.length)
        currentStructures.length = sharedLength;
    }
    let result;
    if (currentUnpackr.randomAccessStructure && src[position] < 64 && src[position] >= 32 && readStruct) {
      result = readStruct(src, position, srcEnd, currentUnpackr);
      src = null;
      if (!(options && options.lazy) && result)
        result = result.toJSON();
      position = srcEnd;
    } else
      result = read();
    if (bundledStrings) {
      position = bundledStrings.postBundlePosition;
      bundledStrings = null;
    }
    if (sequentialMode)
      currentStructures.restoreStructures = null;
    if (position == srcEnd) {
      if (currentStructures && currentStructures.restoreStructures)
        restoreStructures();
      currentStructures = null;
      src = null;
      if (referenceMap)
        referenceMap = null;
    } else if (position > srcEnd) {
      throw new Error("Unexpected end of MessagePack data");
    } else if (!sequentialMode) {
      let jsonView;
      try {
        jsonView = JSON.stringify(result, (_, value) => typeof value === "bigint" ? `${value}n` : value).slice(0, 100);
      } catch (error2) {
        jsonView = "(JSON view not available " + error2 + ")";
      }
      throw new Error("Data read, but end of buffer not reached " + jsonView);
    }
    return result;
  } catch (error2) {
    if (currentStructures && currentStructures.restoreStructures)
      restoreStructures();
    clearSource();
    if (error2 instanceof RangeError || error2.message.startsWith("Unexpected end of buffer") || position > srcEnd) {
      error2.incomplete = true;
    }
    throw error2;
  }
}
function restoreStructures() {
  for (let id in currentStructures.restoreStructures) {
    currentStructures[id] = currentStructures.restoreStructures[id];
  }
  currentStructures.restoreStructures = null;
}
function read() {
  let token = src[position++];
  if (token < 160) {
    if (token < 128) {
      if (token < 64)
        return token;
      else {
        let structure = currentStructures[token & 63] || currentUnpackr.getStructures && loadStructures()[token & 63];
        if (structure) {
          if (!structure.read) {
            structure.read = createStructureReader(structure, token & 63);
          }
          return structure.read();
        } else
          return token;
      }
    } else if (token < 144) {
      token -= 128;
      if (currentUnpackr.mapsAsObjects) {
        let object = {};
        for (let i = 0;i < token; i++) {
          let key = readKey();
          if (key === "__proto__")
            key = "__proto_";
          object[key] = read();
        }
        return object;
      } else {
        let map = new Map;
        for (let i = 0;i < token; i++) {
          map.set(read(), read());
        }
        return map;
      }
    } else {
      token -= 144;
      let array = new Array(token);
      for (let i = 0;i < token; i++) {
        array[i] = read();
      }
      if (currentUnpackr.freezeData)
        return Object.freeze(array);
      return array;
    }
  } else if (token < 192) {
    let length = token - 160;
    if (srcStringEnd >= position) {
      return srcString.slice(position - srcStringStart, (position += length) - srcStringStart);
    }
    if (srcStringEnd == 0 && srcEnd < 140) {
      let string = length < 16 ? shortStringInJS(length) : longStringInJS(length);
      if (string != null)
        return string;
    }
    return readFixedString(length);
  } else {
    let value;
    switch (token) {
      case 192:
        return null;
      case 193:
        if (bundledStrings) {
          value = read();
          if (value > 0)
            return bundledStrings[1].slice(bundledStrings.position1, bundledStrings.position1 += value);
          else
            return bundledStrings[0].slice(bundledStrings.position0, bundledStrings.position0 -= value);
        }
        return C1;
      case 194:
        return false;
      case 195:
        return true;
      case 196:
        value = src[position++];
        if (value === undefined)
          throw new Error("Unexpected end of buffer");
        return readBin(value);
      case 197:
        value = dataView.getUint16(position);
        position += 2;
        return readBin(value);
      case 198:
        value = dataView.getUint32(position);
        position += 4;
        return readBin(value);
      case 199:
        return readExt(src[position++]);
      case 200:
        value = dataView.getUint16(position);
        position += 2;
        return readExt(value);
      case 201:
        value = dataView.getUint32(position);
        position += 4;
        return readExt(value);
      case 202:
        value = dataView.getFloat32(position);
        if (currentUnpackr.useFloat32 > 2) {
          let multiplier = mult10[(src[position] & 127) << 1 | src[position + 1] >> 7];
          position += 4;
          return (multiplier * value + (value > 0 ? 0.5 : -0.5) >> 0) / multiplier;
        }
        position += 4;
        return value;
      case 203:
        value = dataView.getFloat64(position);
        position += 8;
        return value;
      case 204:
        return src[position++];
      case 205:
        value = dataView.getUint16(position);
        position += 2;
        return value;
      case 206:
        value = dataView.getUint32(position);
        position += 4;
        return value;
      case 207:
        if (currentUnpackr.int64AsType === "number") {
          value = dataView.getUint32(position) * 4294967296;
          value += dataView.getUint32(position + 4);
        } else if (currentUnpackr.int64AsType === "string") {
          value = dataView.getBigUint64(position).toString();
        } else if (currentUnpackr.int64AsType === "auto") {
          value = dataView.getBigUint64(position);
          if (value <= BigInt(2) << BigInt(52))
            value = Number(value);
        } else
          value = dataView.getBigUint64(position);
        position += 8;
        return value;
      case 208:
        return dataView.getInt8(position++);
      case 209:
        value = dataView.getInt16(position);
        position += 2;
        return value;
      case 210:
        value = dataView.getInt32(position);
        position += 4;
        return value;
      case 211:
        if (currentUnpackr.int64AsType === "number") {
          value = dataView.getInt32(position) * 4294967296;
          value += dataView.getUint32(position + 4);
        } else if (currentUnpackr.int64AsType === "string") {
          value = dataView.getBigInt64(position).toString();
        } else if (currentUnpackr.int64AsType === "auto") {
          value = dataView.getBigInt64(position);
          if (value >= BigInt(-2) << BigInt(52) && value <= BigInt(2) << BigInt(52))
            value = Number(value);
        } else
          value = dataView.getBigInt64(position);
        position += 8;
        return value;
      case 212:
        value = src[position++];
        if (value == 114) {
          return recordDefinition(src[position++] & 63);
        } else {
          let extension = currentExtensions[value];
          if (extension) {
            if (extension.read) {
              position++;
              return extension.read(read());
            } else if (extension.noBuffer) {
              position++;
              return extension();
            } else
              return extension(src.subarray(position, ++position));
          } else
            throw new Error("Unknown extension " + value);
        }
      case 213:
        value = src[position];
        if (value == 114) {
          position++;
          return recordDefinition(src[position++] & 63, src[position++]);
        } else
          return readExt(2);
      case 214:
        return readExt(4);
      case 215:
        return readExt(8);
      case 216:
        return readExt(16);
      case 217:
        value = src[position++];
        if (srcStringEnd >= position) {
          return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
        }
        return readString8(value);
      case 218:
        value = dataView.getUint16(position);
        position += 2;
        if (srcStringEnd >= position) {
          return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
        }
        return readString16(value);
      case 219:
        value = dataView.getUint32(position);
        position += 4;
        if (srcStringEnd >= position) {
          return srcString.slice(position - srcStringStart, (position += value) - srcStringStart);
        }
        return readString32(value);
      case 220:
        value = dataView.getUint16(position);
        position += 2;
        return readArray(value);
      case 221:
        value = dataView.getUint32(position);
        position += 4;
        return readArray(value);
      case 222:
        value = dataView.getUint16(position);
        position += 2;
        return readMap(value);
      case 223:
        value = dataView.getUint32(position);
        position += 4;
        return readMap(value);
      default:
        if (token >= 224)
          return token - 256;
        if (token === undefined) {
          let error2 = new Error("Unexpected end of MessagePack data");
          error2.incomplete = true;
          throw error2;
        }
        throw new Error("Unknown MessagePack token " + token);
    }
  }
}
var validName = /^[a-zA-Z_$][a-zA-Z\d_$]*$/;
function createStructureReader(structure, firstId) {
  function readObject() {
    if (readObject.count++ > inlineObjectReadThreshold) {
      let optimizedReadObject;
      try {
        optimizedReadObject = structure.read = new Function("r", "return function(){return " + (currentUnpackr.freezeData ? "Object.freeze" : "") + "({" + structure.map((key) => key === "__proto__" ? "__proto_:r()" : validName.test(key) ? key + ":r()" : "[" + JSON.stringify(key) + "]:r()").join(",") + "})}")(read);
      } catch (error2) {
        inlineObjectReadThreshold = Infinity;
        return readObject();
      }
      structure.read0 = optimizedReadObject;
      if (structure.highByte === 0)
        structure.read = createSecondByteReader(firstId, structure.read);
      return optimizedReadObject();
    }
    let object = {};
    for (let i = 0, l = structure.length;i < l; i++) {
      let key = structure[i];
      if (key === "__proto__")
        key = "__proto_";
      object[key] = read();
    }
    if (currentUnpackr.freezeData)
      return Object.freeze(object);
    return object;
  }
  readObject.count = 0;
  structure.read0 = readObject;
  if (structure.highByte === 0) {
    return createSecondByteReader(firstId, readObject);
  }
  return readObject;
}
var createSecondByteReader = (firstId, read0) => {
  return function() {
    let highByte = src[position++];
    if (highByte === 0)
      return read0();
    let id = firstId < 32 ? -(firstId + (highByte << 5)) : firstId + (highByte << 5);
    let structure = currentStructures[id] || loadStructures()[id];
    if (!structure) {
      throw new Error("Record id is not defined for " + id);
    }
    if (!structure.read)
      structure.read = createStructureReader(structure, firstId);
    return structure.read();
  };
};
function loadStructures() {
  let loadedStructures = saveState(() => {
    src = null;
    return currentUnpackr.getStructures();
  });
  return currentStructures = currentUnpackr._mergeStructures(loadedStructures, currentStructures);
}
var readFixedString = readStringJS;
var readString8 = readStringJS;
var readString16 = readStringJS;
var readString32 = readStringJS;
var isNativeAccelerationEnabled = false;
function setExtractor(extractStrings) {
  isNativeAccelerationEnabled = true;
  readFixedString = readString(1);
  readString8 = readString(2);
  readString16 = readString(3);
  readString32 = readString(5);
  function readString(headerLength) {
    return function readString2(length) {
      let string = strings[stringPosition++];
      if (string == null) {
        if (bundledStrings)
          return readStringJS(length);
        let byteOffset = src.byteOffset;
        let extraction = extractStrings(position - headerLength + byteOffset, srcEnd + byteOffset, src.buffer);
        if (typeof extraction == "string") {
          string = extraction;
          strings = EMPTY_ARRAY;
        } else {
          strings = extraction;
          stringPosition = 1;
          srcStringEnd = 1;
          string = strings[0];
          if (string === undefined)
            throw new Error("Unexpected end of buffer");
        }
      }
      let srcStringLength = string.length;
      if (srcStringLength <= length) {
        position += length;
        return string;
      }
      srcString = string;
      srcStringStart = position;
      srcStringEnd = position + srcStringLength;
      position += length;
      return string.slice(0, length);
    };
  }
}
function readStringJS(length) {
  let result;
  if (length < 16) {
    if (result = shortStringInJS(length))
      return result;
  }
  if (length > 64 && decoder)
    return decoder.decode(src.subarray(position, position += length));
  const end = position + length;
  const units = [];
  result = "";
  while (position < end) {
    const byte1 = src[position++];
    if ((byte1 & 128) === 0) {
      units.push(byte1);
    } else if ((byte1 & 224) === 192) {
      const byte2 = src[position++] & 63;
      const codePoint = (byte1 & 31) << 6 | byte2;
      if (codePoint < 128) {
        units.push(65533);
      } else {
        units.push(codePoint);
      }
    } else if ((byte1 & 240) === 224) {
      const byte2 = src[position++] & 63;
      const byte3 = src[position++] & 63;
      const codePoint = (byte1 & 31) << 12 | byte2 << 6 | byte3;
      if (codePoint < 2048 || codePoint >= 55296 && codePoint <= 57343) {
        units.push(65533);
      } else {
        units.push(codePoint);
      }
    } else if ((byte1 & 248) === 240) {
      const byte2 = src[position++] & 63;
      const byte3 = src[position++] & 63;
      const byte4 = src[position++] & 63;
      let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
      if (unit < 65536 || unit > 1114111) {
        units.push(65533);
      } else if (unit > 65535) {
        unit -= 65536;
        units.push(unit >>> 10 & 1023 | 55296);
        unit = 56320 | unit & 1023;
        units.push(unit);
      } else {
        units.push(unit);
      }
    } else {
      units.push(65533);
    }
    if (units.length >= 4096) {
      result += fromCharCode.apply(String, units);
      units.length = 0;
    }
  }
  if (units.length > 0) {
    result += fromCharCode.apply(String, units);
  }
  return result;
}
function readString(source, start, length) {
  let existingSrc = src;
  src = source;
  position = start;
  try {
    return readStringJS(length);
  } finally {
    src = existingSrc;
  }
}
function readArray(length) {
  let array = new Array(length);
  for (let i = 0;i < length; i++) {
    array[i] = read();
  }
  if (currentUnpackr.freezeData)
    return Object.freeze(array);
  return array;
}
function readMap(length) {
  if (currentUnpackr.mapsAsObjects) {
    let object = {};
    for (let i = 0;i < length; i++) {
      let key = readKey();
      if (key === "__proto__")
        key = "__proto_";
      object[key] = read();
    }
    return object;
  } else {
    let map = new Map;
    for (let i = 0;i < length; i++) {
      map.set(read(), read());
    }
    return map;
  }
}
var fromCharCode = String.fromCharCode;
function longStringInJS(length) {
  let start = position;
  let bytes = new Array(length);
  for (let i = 0;i < length; i++) {
    const byte = src[position++];
    if ((byte & 128) > 0) {
      position = start;
      return;
    }
    bytes[i] = byte;
  }
  return fromCharCode.apply(String, bytes);
}
function shortStringInJS(length) {
  if (length < 4) {
    if (length < 2) {
      if (length === 0)
        return "";
      else {
        let a = src[position++];
        if ((a & 128) > 1) {
          position -= 1;
          return;
        }
        return fromCharCode(a);
      }
    } else {
      let a = src[position++];
      let b = src[position++];
      if ((a & 128) > 0 || (b & 128) > 0) {
        position -= 2;
        return;
      }
      if (length < 3)
        return fromCharCode(a, b);
      let c = src[position++];
      if ((c & 128) > 0) {
        position -= 3;
        return;
      }
      return fromCharCode(a, b, c);
    }
  } else {
    let a = src[position++];
    let b = src[position++];
    let c = src[position++];
    let d = src[position++];
    if ((a & 128) > 0 || (b & 128) > 0 || (c & 128) > 0 || (d & 128) > 0) {
      position -= 4;
      return;
    }
    if (length < 6) {
      if (length === 4)
        return fromCharCode(a, b, c, d);
      else {
        let e = src[position++];
        if ((e & 128) > 0) {
          position -= 5;
          return;
        }
        return fromCharCode(a, b, c, d, e);
      }
    } else if (length < 8) {
      let e = src[position++];
      let f = src[position++];
      if ((e & 128) > 0 || (f & 128) > 0) {
        position -= 6;
        return;
      }
      if (length < 7)
        return fromCharCode(a, b, c, d, e, f);
      let g = src[position++];
      if ((g & 128) > 0) {
        position -= 7;
        return;
      }
      return fromCharCode(a, b, c, d, e, f, g);
    } else {
      let e = src[position++];
      let f = src[position++];
      let g = src[position++];
      let h = src[position++];
      if ((e & 128) > 0 || (f & 128) > 0 || (g & 128) > 0 || (h & 128) > 0) {
        position -= 8;
        return;
      }
      if (length < 10) {
        if (length === 8)
          return fromCharCode(a, b, c, d, e, f, g, h);
        else {
          let i = src[position++];
          if ((i & 128) > 0) {
            position -= 9;
            return;
          }
          return fromCharCode(a, b, c, d, e, f, g, h, i);
        }
      } else if (length < 12) {
        let i = src[position++];
        let j = src[position++];
        if ((i & 128) > 0 || (j & 128) > 0) {
          position -= 10;
          return;
        }
        if (length < 11)
          return fromCharCode(a, b, c, d, e, f, g, h, i, j);
        let k = src[position++];
        if ((k & 128) > 0) {
          position -= 11;
          return;
        }
        return fromCharCode(a, b, c, d, e, f, g, h, i, j, k);
      } else {
        let i = src[position++];
        let j = src[position++];
        let k = src[position++];
        let l = src[position++];
        if ((i & 128) > 0 || (j & 128) > 0 || (k & 128) > 0 || (l & 128) > 0) {
          position -= 12;
          return;
        }
        if (length < 14) {
          if (length === 12)
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l);
          else {
            let m = src[position++];
            if ((m & 128) > 0) {
              position -= 13;
              return;
            }
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m);
          }
        } else {
          let m = src[position++];
          let n = src[position++];
          if ((m & 128) > 0 || (n & 128) > 0) {
            position -= 14;
            return;
          }
          if (length < 15)
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n);
          let o = src[position++];
          if ((o & 128) > 0) {
            position -= 15;
            return;
          }
          return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o);
        }
      }
    }
  }
}
function readOnlyJSString() {
  let token = src[position++];
  let length;
  if (token < 192) {
    length = token - 160;
  } else {
    switch (token) {
      case 217:
        length = src[position++];
        break;
      case 218:
        length = dataView.getUint16(position);
        position += 2;
        break;
      case 219:
        length = dataView.getUint32(position);
        position += 4;
        break;
      default:
        throw new Error("Expected string");
    }
  }
  return readStringJS(length);
}
function readBin(length) {
  return currentUnpackr.copyBuffers ? Uint8Array.prototype.slice.call(src, position, position += length) : src.subarray(position, position += length);
}
function readExt(length) {
  let type = src[position++];
  if (currentExtensions[type]) {
    let end;
    return currentExtensions[type](src.subarray(position, end = position += length), (readPosition) => {
      position = readPosition;
      try {
        return read();
      } finally {
        position = end;
      }
    });
  } else
    throw new Error("Unknown extension type " + type);
}
var keyCache = new Array(4096);
function readKey() {
  let length = src[position++];
  if (length >= 160 && length < 192) {
    length = length - 160;
    if (srcStringEnd >= position)
      return srcString.slice(position - srcStringStart, (position += length) - srcStringStart);
    else if (!(srcStringEnd == 0 && srcEnd < 180))
      return readFixedString(length);
  } else {
    position--;
    return asSafeString(read());
  }
  let key = (length << 5 ^ (length > 1 ? dataView.getUint16(position) : length > 0 ? src[position] : 0)) & 4095;
  let entry = keyCache[key];
  let checkPosition = position;
  let end = position + length - 3;
  let chunk;
  let i = 0;
  if (entry && entry.bytes == length) {
    while (checkPosition < end) {
      chunk = dataView.getUint32(checkPosition);
      if (chunk != entry[i++]) {
        checkPosition = 1879048192;
        break;
      }
      checkPosition += 4;
    }
    end += 3;
    while (checkPosition < end) {
      chunk = src[checkPosition++];
      if (chunk != entry[i++]) {
        checkPosition = 1879048192;
        break;
      }
    }
    if (checkPosition === end) {
      position = checkPosition;
      return entry.string;
    }
    end -= 3;
    checkPosition = position;
  }
  entry = [];
  keyCache[key] = entry;
  entry.bytes = length;
  while (checkPosition < end) {
    chunk = dataView.getUint32(checkPosition);
    entry.push(chunk);
    checkPosition += 4;
  }
  end += 3;
  while (checkPosition < end) {
    chunk = src[checkPosition++];
    entry.push(chunk);
  }
  let string = length < 16 ? shortStringInJS(length) : longStringInJS(length);
  if (string != null)
    return entry.string = string;
  return entry.string = readFixedString(length);
}
function asSafeString(property) {
  if (typeof property === "string")
    return property;
  if (typeof property === "number" || typeof property === "boolean" || typeof property === "bigint")
    return property.toString();
  if (property == null)
    return property + "";
  if (currentUnpackr.allowArraysInMapKeys && Array.isArray(property) && property.flat().every((item) => ["string", "number", "boolean", "bigint"].includes(typeof item))) {
    return property.flat().toString();
  }
  throw new Error(`Invalid property type for record: ${typeof property}`);
}
var recordDefinition = (id, highByte) => {
  let structure = read().map(asSafeString);
  let firstByte = id;
  if (highByte !== undefined) {
    id = id < 32 ? -((highByte << 5) + id) : (highByte << 5) + id;
    structure.highByte = highByte;
  }
  let existingStructure = currentStructures[id];
  if (existingStructure && (existingStructure.isShared || sequentialMode)) {
    (currentStructures.restoreStructures || (currentStructures.restoreStructures = []))[id] = existingStructure;
  }
  currentStructures[id] = structure;
  structure.read = createStructureReader(structure, firstByte);
  return (structure.read0 || structure.read)();
};
currentExtensions[0] = () => {};
currentExtensions[0].noBuffer = true;
currentExtensions[66] = (data) => {
  let headLength = data.byteLength % 8 || 8;
  let head = BigInt(data[0] & 128 ? data[0] - 256 : data[0]);
  for (let i = 1;i < headLength; i++) {
    head <<= BigInt(8);
    head += BigInt(data[i]);
  }
  if (data.byteLength !== headLength) {
    let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let decode = (start, end) => {
      let length = end - start;
      if (length <= 40) {
        let out = view.getBigUint64(start);
        for (let i = start + 8;i < end; i += 8) {
          out <<= BigInt(64);
          out |= view.getBigUint64(i);
        }
        return out;
      }
      let middle = start + (length >> 4 << 3);
      let left = decode(start, middle);
      let right = decode(middle, end);
      return left << BigInt((end - middle) * 8) | right;
    };
    head = head << BigInt((view.byteLength - headLength) * 8) | decode(headLength, view.byteLength);
  }
  return head;
};
var errors = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  AggregateError: typeof AggregateError === "function" ? AggregateError : null
};
currentExtensions[101] = () => {
  let data = read();
  if (!errors[data[0]]) {
    let error2 = Error(data[1], { cause: data[2] });
    error2.name = data[0];
    return error2;
  }
  return errors[data[0]](data[1], { cause: data[2] });
};
currentExtensions[105] = (data) => {
  if (currentUnpackr.structuredClone === false)
    throw new Error("Structured clone extension is disabled");
  let id = dataView.getUint32(position - 4);
  if (!referenceMap)
    referenceMap = new Map;
  let token = src[position];
  let target;
  if (token >= 144 && token < 160 || token == 220 || token == 221)
    target = [];
  else if (token >= 128 && token < 144 || token == 222 || token == 223)
    target = new Map;
  else if ((token >= 199 && token <= 201 || token >= 212 && token <= 216) && src[position + 1] === 115)
    target = new Set;
  else
    target = {};
  let refEntry = { target };
  referenceMap.set(id, refEntry);
  let targetProperties = read();
  if (!refEntry.used) {
    return refEntry.target = targetProperties;
  } else {
    Object.assign(target, targetProperties);
  }
  if (target instanceof Map)
    for (let [k, v] of targetProperties.entries())
      target.set(k, v);
  if (target instanceof Set)
    for (let i of Array.from(targetProperties))
      target.add(i);
  return target;
};
currentExtensions[112] = (data) => {
  if (currentUnpackr.structuredClone === false)
    throw new Error("Structured clone extension is disabled");
  let id = dataView.getUint32(position - 4);
  let refEntry = referenceMap.get(id);
  refEntry.used = true;
  return refEntry.target;
};
currentExtensions[115] = () => new Set(read());
var typedArrays = ["Int8", "Uint8", "Uint8Clamped", "Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64", "BigInt64", "BigUint64"].map((type) => type + "Array");
var glbl = typeof globalThis === "object" ? globalThis : window;
currentExtensions[116] = (data) => {
  let typeCode = data[0];
  let buffer = Uint8Array.prototype.slice.call(data, 1).buffer;
  let typedArrayName = typedArrays[typeCode];
  if (!typedArrayName) {
    if (typeCode === 16)
      return buffer;
    if (typeCode === 17)
      return new DataView(buffer);
    throw new Error("Could not find typed array for code " + typeCode);
  }
  return new glbl[typedArrayName](buffer);
};
currentExtensions[120] = () => {
  let data = read();
  return new RegExp(data[0], data[1]);
};
var TEMP_BUNDLE = [];
currentExtensions[98] = (data) => {
  let dataSize = (data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3];
  let dataPosition = position;
  position += dataSize - data.length;
  bundledStrings = TEMP_BUNDLE;
  bundledStrings = [readOnlyJSString(), readOnlyJSString()];
  bundledStrings.position0 = 0;
  bundledStrings.position1 = 0;
  bundledStrings.postBundlePosition = position;
  position = dataPosition;
  return read();
};
currentExtensions[255] = (data) => {
  if (data.length == 4)
    return new Date((data[0] * 16777216 + (data[1] << 16) + (data[2] << 8) + data[3]) * 1000);
  else if (data.length == 8)
    return new Date(((data[0] << 22) + (data[1] << 14) + (data[2] << 6) + (data[3] >> 2)) / 1e6 + ((data[3] & 3) * 4294967296 + data[4] * 16777216 + (data[5] << 16) + (data[6] << 8) + data[7]) * 1000);
  else if (data.length == 12)
    return new Date(((data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3]) / 1e6 + ((data[4] & 128 ? -281474976710656 : 0) + data[6] * 1099511627776 + data[7] * 4294967296 + data[8] * 16777216 + (data[9] << 16) + (data[10] << 8) + data[11]) * 1000);
  else
    return new Date("invalid");
};
function saveState(callback) {
  if (onSaveState)
    onSaveState();
  let savedSrcEnd = srcEnd;
  let savedPosition = position;
  let savedStringPosition = stringPosition;
  let savedSrcStringStart = srcStringStart;
  let savedSrcStringEnd = srcStringEnd;
  let savedSrcString = srcString;
  let savedStrings = strings;
  let savedReferenceMap = referenceMap;
  let savedBundledStrings = bundledStrings;
  let savedSrc = new Uint8Array(src.slice(0, srcEnd));
  let savedStructures = currentStructures;
  let savedStructuresContents = currentStructures.slice(0, currentStructures.length);
  let savedPackr = currentUnpackr;
  let savedSequentialMode = sequentialMode;
  let value = callback();
  srcEnd = savedSrcEnd;
  position = savedPosition;
  stringPosition = savedStringPosition;
  srcStringStart = savedSrcStringStart;
  srcStringEnd = savedSrcStringEnd;
  srcString = savedSrcString;
  strings = savedStrings;
  referenceMap = savedReferenceMap;
  bundledStrings = savedBundledStrings;
  src = savedSrc;
  sequentialMode = savedSequentialMode;
  currentStructures = savedStructures;
  currentStructures.splice(0, currentStructures.length, ...savedStructuresContents);
  currentUnpackr = savedPackr;
  dataView = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return value;
}
function clearSource() {
  src = null;
  referenceMap = null;
  currentStructures = null;
}
var mult10 = new Array(147);
for (let i = 0;i < 256; i++) {
  mult10[i] = +("1e" + Math.floor(45.15 - i * 0.30103));
}
var defaultUnpackr = new Unpackr({ useRecords: false });
var unpack = defaultUnpackr.unpack;
var unpackMultiple = defaultUnpackr.unpackMultiple;
var decode = defaultUnpackr.unpack;
var f32Array = new Float32Array(1);
var u8Array = new Uint8Array(f32Array.buffer, 0, 4);
function setReadStruct(updatedReadStruct, loadedStructs, saveState2) {
  readStruct = updatedReadStruct;
  onLoadedStructures = loadedStructs;
  onSaveState = saveState2;
}
// ../../node_modules/.bun/msgpackr@1.12.1/node_modules/msgpackr/pack.js
var textEncoder;
try {
  textEncoder = new TextEncoder;
} catch (error2) {}
var extensions;
var extensionClasses;
var hasNodeBuffer = typeof Buffer !== "undefined";
var ByteArrayAllocate = hasNodeBuffer ? function(length) {
  return Buffer.allocUnsafeSlow(length);
} : Uint8Array;
var ByteArray = hasNodeBuffer ? Buffer : Uint8Array;
var MAX_BUFFER_SIZE = hasNodeBuffer ? 4294967296 : 2144337920;
var target;
var keysTarget;
var targetView;
var position2 = 0;
var safeEnd;
var bundledStrings2 = null;
var writeStructSlots;
var MAX_BUNDLE_SIZE = 21760;
var hasNonLatin = /[\u0080-\uFFFF]/;
var RECORD_SYMBOL = Symbol("record-id");

class Packr extends Unpackr {
  constructor(options) {
    super(options);
    this.offset = 0;
    let typeBuffer;
    let start;
    let hasSharedUpdate;
    let structures;
    let referenceMap2;
    let encodeUtf8 = ByteArray.prototype.utf8Write ? function(string, position3) {
      return target.utf8Write(string, position3, target.byteLength - position3);
    } : textEncoder && textEncoder.encodeInto ? function(string, position3) {
      return textEncoder.encodeInto(string, target.subarray(position3)).written;
    } : false;
    let packr = this;
    if (!options)
      options = {};
    let isSequential = options && options.sequential;
    let hasSharedStructures = options.structures || options.saveStructures;
    let maxSharedStructures = options.maxSharedStructures;
    if (maxSharedStructures == null)
      maxSharedStructures = hasSharedStructures ? 32 : 0;
    if (maxSharedStructures > 8160)
      throw new Error("Maximum maxSharedStructure is 8160");
    if (options.structuredClone && options.moreTypes == undefined) {
      this.moreTypes = true;
    }
    let maxOwnStructures = options.maxOwnStructures;
    if (maxOwnStructures == null)
      maxOwnStructures = hasSharedStructures ? 32 : 64;
    if (!this.structures && options.useRecords != false)
      this.structures = [];
    let useTwoByteRecords = maxSharedStructures > 32 || maxOwnStructures + maxSharedStructures > 64;
    let sharedLimitId = maxSharedStructures + 64;
    let maxStructureId = maxSharedStructures + maxOwnStructures + 64;
    if (maxStructureId > 8256) {
      throw new Error("Maximum maxSharedStructure + maxOwnStructure is 8192");
    }
    let recordIdsToRemove = [];
    let transitionsCount = 0;
    let serializationsSinceTransitionRebuild = 0;
    this.pack = this.encode = function(value, encodeOptions) {
      if (!target) {
        target = new ByteArrayAllocate(8192);
        targetView = target.dataView || (target.dataView = new DataView(target.buffer, 0, 8192));
        position2 = 0;
      }
      safeEnd = target.length - 10;
      if (safeEnd - position2 < 2048) {
        target = new ByteArrayAllocate(target.length);
        targetView = target.dataView || (target.dataView = new DataView(target.buffer, 0, target.length));
        safeEnd = target.length - 10;
        position2 = 0;
      } else
        position2 = position2 + 7 & 2147483640;
      start = position2;
      if (encodeOptions & RESERVE_START_SPACE)
        position2 += encodeOptions & 255;
      referenceMap2 = packr.structuredClone ? new Map : null;
      if (packr.bundleStrings && typeof value !== "string") {
        bundledStrings2 = [];
        bundledStrings2.size = Infinity;
      } else
        bundledStrings2 = null;
      structures = packr.structures;
      if (structures) {
        if (structures.uninitialized)
          structures = packr._mergeStructures(packr.getStructures());
        let sharedLength = structures.sharedLength || 0;
        if (sharedLength > maxSharedStructures) {
          throw new Error("Shared structures is larger than maximum shared structures, try increasing maxSharedStructures to " + structures.sharedLength);
        }
        if (!structures.transitions) {
          structures.transitions = Object.create(null);
          for (let i = 0;i < sharedLength; i++) {
            let keys = structures[i];
            if (!keys)
              continue;
            let nextTransition, transition = structures.transitions;
            for (let j = 0, l = keys.length;j < l; j++) {
              let key = keys[j];
              nextTransition = transition[key];
              if (!nextTransition) {
                nextTransition = transition[key] = Object.create(null);
              }
              transition = nextTransition;
            }
            transition[RECORD_SYMBOL] = i + 64;
          }
          this.lastNamedStructuresLength = sharedLength;
        }
        if (!isSequential) {
          structures.nextId = sharedLength + 64;
        }
      }
      if (hasSharedUpdate)
        hasSharedUpdate = false;
      let encodingError;
      try {
        if (packr.randomAccessStructure && !packr.readOnlyStructures && value && typeof value === "object") {
          if (value.constructor === Object)
            writeStruct(value);
          else if (value.constructor !== Map && !Array.isArray(value) && !extensionClasses.some((extClass) => value instanceof extClass)) {
            writeStruct(value.toJSON ? value.toJSON() : value);
          } else
            pack(value);
        } else
          pack(value);
        let lastBundle = bundledStrings2;
        if (bundledStrings2)
          writeBundles(start, pack, 0);
        if (referenceMap2 && referenceMap2.idsToInsert) {
          let idsToInsert = referenceMap2.idsToInsert.sort((a, b) => a.offset > b.offset ? 1 : -1);
          let i = idsToInsert.length;
          let incrementPosition = -1;
          while (lastBundle && i > 0) {
            let insertionPoint = idsToInsert[--i].offset + start;
            if (insertionPoint < lastBundle.stringsPosition + start && incrementPosition === -1)
              incrementPosition = 0;
            if (insertionPoint > lastBundle.position + start) {
              if (incrementPosition >= 0)
                incrementPosition += 6;
            } else {
              if (incrementPosition >= 0) {
                targetView.setUint32(lastBundle.position + start, targetView.getUint32(lastBundle.position + start) + incrementPosition);
                incrementPosition = -1;
              }
              lastBundle = lastBundle.previous;
              i++;
            }
          }
          if (incrementPosition >= 0 && lastBundle) {
            targetView.setUint32(lastBundle.position + start, targetView.getUint32(lastBundle.position + start) + incrementPosition);
          }
          position2 += idsToInsert.length * 6;
          if (position2 > safeEnd)
            makeRoom(position2);
          packr.offset = position2;
          let serialized = insertIds(target.subarray(start, position2), idsToInsert);
          referenceMap2 = null;
          return serialized;
        }
        packr.offset = position2;
        if (encodeOptions & REUSE_BUFFER_MODE) {
          target.start = start;
          target.end = position2;
          return target;
        }
        return target.subarray(start, position2);
      } catch (error2) {
        encodingError = error2;
        throw error2;
      } finally {
        if (structures) {
          resetStructures();
          if (hasSharedUpdate && packr.saveStructures) {
            let sharedLength = structures.sharedLength || 0;
            let returnBuffer = target.subarray(start, position2);
            let newSharedData = prepareStructures(structures, packr);
            if (!encodingError) {
              if (packr.saveStructures(newSharedData, newSharedData.isCompatible) === false) {
                structures.uninitialized = true;
                return packr.pack(value, encodeOptions);
              }
              packr.lastNamedStructuresLength = sharedLength;
              if (target.length > 1073741824)
                target = null;
              return returnBuffer;
            }
          }
        }
        if (target.length > 1073741824)
          target = null;
        if (encodeOptions & RESET_BUFFER_MODE)
          position2 = start;
      }
    };
    const resetStructures = () => {
      if (serializationsSinceTransitionRebuild < 10)
        serializationsSinceTransitionRebuild++;
      let sharedLength = structures.sharedLength || 0;
      if (structures.length > sharedLength && !isSequential)
        structures.length = sharedLength;
      if (transitionsCount > 1e4) {
        structures.transitions = null;
        serializationsSinceTransitionRebuild = 0;
        transitionsCount = 0;
        if (recordIdsToRemove.length > 0)
          recordIdsToRemove = [];
      } else if (recordIdsToRemove.length > 0 && !isSequential) {
        for (let i = 0, l = recordIdsToRemove.length;i < l; i++) {
          recordIdsToRemove[i][RECORD_SYMBOL] = 0;
        }
        recordIdsToRemove = [];
      }
    };
    const packArray = (value) => {
      var length = value.length;
      if (length < 16) {
        target[position2++] = 144 | length;
      } else if (length < 65536) {
        target[position2++] = 220;
        target[position2++] = length >> 8;
        target[position2++] = length & 255;
      } else {
        target[position2++] = 221;
        targetView.setUint32(position2, length);
        position2 += 4;
      }
      for (let i = 0;i < length; i++) {
        pack(value[i]);
      }
    };
    const pack = (value) => {
      if (position2 > safeEnd)
        target = makeRoom(position2);
      var type = typeof value;
      var length;
      if (type === "string") {
        let strLength = value.length;
        if (bundledStrings2 && strLength >= 4 && strLength < 4096) {
          if ((bundledStrings2.size += strLength) > MAX_BUNDLE_SIZE) {
            let extStart;
            let maxBytes2 = (bundledStrings2[0] ? bundledStrings2[0].length * 3 + bundledStrings2[1].length : 0) + 10;
            if (position2 + maxBytes2 > safeEnd)
              target = makeRoom(position2 + maxBytes2);
            let lastBundle;
            if (bundledStrings2.position) {
              lastBundle = bundledStrings2;
              target[position2] = 200;
              position2 += 3;
              target[position2++] = 98;
              extStart = position2 - start;
              position2 += 4;
              writeBundles(start, pack, 0);
              targetView.setUint16(extStart + start - 3, position2 - start - extStart);
            } else {
              target[position2++] = 214;
              target[position2++] = 98;
              extStart = position2 - start;
              position2 += 4;
            }
            bundledStrings2 = ["", ""];
            bundledStrings2.previous = lastBundle;
            bundledStrings2.size = 0;
            bundledStrings2.position = extStart;
          }
          let twoByte = hasNonLatin.test(value);
          bundledStrings2[twoByte ? 0 : 1] += value;
          target[position2++] = 193;
          pack(twoByte ? -strLength : strLength);
          return;
        }
        let headerSize;
        if (strLength < 32) {
          headerSize = 1;
        } else if (strLength < 256) {
          headerSize = 2;
        } else if (strLength < 65536) {
          headerSize = 3;
        } else {
          headerSize = 5;
        }
        let maxBytes = strLength * 3;
        if (position2 + maxBytes > safeEnd)
          target = makeRoom(position2 + maxBytes);
        if (strLength < 64 || !encodeUtf8) {
          let i, c1, c2, strPosition = position2 + headerSize;
          for (i = 0;i < strLength; i++) {
            c1 = value.charCodeAt(i);
            if (c1 < 128) {
              target[strPosition++] = c1;
            } else if (c1 < 2048) {
              target[strPosition++] = c1 >> 6 | 192;
              target[strPosition++] = c1 & 63 | 128;
            } else if ((c1 & 64512) === 55296 && ((c2 = value.charCodeAt(i + 1)) & 64512) === 56320) {
              c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
              i++;
              target[strPosition++] = c1 >> 18 | 240;
              target[strPosition++] = c1 >> 12 & 63 | 128;
              target[strPosition++] = c1 >> 6 & 63 | 128;
              target[strPosition++] = c1 & 63 | 128;
            } else {
              target[strPosition++] = c1 >> 12 | 224;
              target[strPosition++] = c1 >> 6 & 63 | 128;
              target[strPosition++] = c1 & 63 | 128;
            }
          }
          length = strPosition - position2 - headerSize;
        } else {
          length = encodeUtf8(value, position2 + headerSize);
        }
        if (length < 32) {
          target[position2++] = 160 | length;
        } else if (length < 256) {
          if (headerSize < 2) {
            target.copyWithin(position2 + 2, position2 + 1, position2 + 1 + length);
          }
          target[position2++] = 217;
          target[position2++] = length;
        } else if (length < 65536) {
          if (headerSize < 3) {
            target.copyWithin(position2 + 3, position2 + 2, position2 + 2 + length);
          }
          target[position2++] = 218;
          target[position2++] = length >> 8;
          target[position2++] = length & 255;
        } else {
          if (headerSize < 5) {
            target.copyWithin(position2 + 5, position2 + 3, position2 + 3 + length);
          }
          target[position2++] = 219;
          targetView.setUint32(position2, length);
          position2 += 4;
        }
        position2 += length;
      } else if (type === "number") {
        if (value >>> 0 === value) {
          if (value < 32 || value < 128 && this.useRecords === false || value < 64 && !this.randomAccessStructure) {
            target[position2++] = value;
          } else if (value < 256) {
            target[position2++] = 204;
            target[position2++] = value;
          } else if (value < 65536) {
            target[position2++] = 205;
            target[position2++] = value >> 8;
            target[position2++] = value & 255;
          } else {
            target[position2++] = 206;
            targetView.setUint32(position2, value);
            position2 += 4;
          }
        } else if (value >> 0 === value) {
          if (value >= -32) {
            target[position2++] = 256 + value;
          } else if (value >= -128) {
            target[position2++] = 208;
            target[position2++] = value + 256;
          } else if (value >= -32768) {
            target[position2++] = 209;
            targetView.setInt16(position2, value);
            position2 += 2;
          } else {
            target[position2++] = 210;
            targetView.setInt32(position2, value);
            position2 += 4;
          }
        } else {
          let useFloat32;
          if ((useFloat32 = this.useFloat32) > 0 && value < 4294967296 && value >= -2147483648) {
            target[position2++] = 202;
            targetView.setFloat32(position2, value);
            let xShifted;
            if (useFloat32 < 4 || (xShifted = value * mult10[(target[position2] & 127) << 1 | target[position2 + 1] >> 7]) >> 0 === xShifted) {
              position2 += 4;
              return;
            } else
              position2--;
          }
          target[position2++] = 203;
          targetView.setFloat64(position2, value);
          position2 += 8;
        }
      } else if (type === "object" || type === "function") {
        if (!value)
          target[position2++] = 192;
        else {
          if (referenceMap2) {
            let referee = referenceMap2.get(value);
            if (referee) {
              if (!referee.id) {
                let idsToInsert = referenceMap2.idsToInsert || (referenceMap2.idsToInsert = []);
                referee.id = idsToInsert.push(referee);
              }
              target[position2++] = 214;
              target[position2++] = 112;
              targetView.setUint32(position2, referee.id);
              position2 += 4;
              return;
            } else
              referenceMap2.set(value, { offset: position2 - start });
          }
          let constructor = value.constructor;
          if (constructor === Object) {
            writeObject(value);
          } else if (constructor === Array) {
            packArray(value);
          } else if (constructor === Map) {
            if (this.mapAsEmptyObject)
              target[position2++] = 128;
            else {
              length = value.size;
              if (length < 16) {
                target[position2++] = 128 | length;
              } else if (length < 65536) {
                target[position2++] = 222;
                target[position2++] = length >> 8;
                target[position2++] = length & 255;
              } else {
                target[position2++] = 223;
                targetView.setUint32(position2, length);
                position2 += 4;
              }
              for (let [key, entryValue] of value) {
                pack(key);
                pack(entryValue);
              }
            }
          } else {
            for (let i = 0, l = extensions.length;i < l; i++) {
              let extensionClass = extensionClasses[i];
              if (value instanceof extensionClass) {
                let extension = extensions[i];
                if (extension.write) {
                  if (extension.type) {
                    target[position2++] = 212;
                    target[position2++] = extension.type;
                    target[position2++] = 0;
                  }
                  let writeResult = extension.write.call(this, value);
                  if (writeResult === value) {
                    if (Array.isArray(value)) {
                      packArray(value);
                    } else {
                      writeObject(value);
                    }
                  } else {
                    pack(writeResult);
                  }
                  return;
                }
                let currentTarget = target;
                let currentTargetView = targetView;
                let currentPosition = position2;
                target = null;
                let result;
                try {
                  result = extension.pack.call(this, value, (size) => {
                    target = currentTarget;
                    currentTarget = null;
                    position2 += size;
                    if (position2 > safeEnd)
                      makeRoom(position2);
                    return {
                      target,
                      targetView,
                      position: position2 - size
                    };
                  }, pack);
                } finally {
                  if (currentTarget) {
                    target = currentTarget;
                    targetView = currentTargetView;
                    position2 = currentPosition;
                    safeEnd = target.length - 10;
                  }
                }
                if (result) {
                  if (result.length + position2 > safeEnd)
                    makeRoom(result.length + position2);
                  position2 = writeExtensionData(result, target, position2, extension.type);
                }
                return;
              }
            }
            if (Array.isArray(value)) {
              packArray(value);
            } else {
              if (value.toJSON) {
                const json = value.toJSON();
                if (json !== value)
                  return pack(json);
              }
              if (type === "function")
                return pack(this.writeFunction && this.writeFunction(value));
              writeObject(value);
            }
          }
        }
      } else if (type === "boolean") {
        target[position2++] = value ? 195 : 194;
      } else if (type === "bigint") {
        if (value < 9223372036854776000 && value >= -9223372036854776000) {
          target[position2++] = 211;
          targetView.setBigInt64(position2, value);
        } else if (value < 18446744073709552000 && value > 0) {
          target[position2++] = 207;
          targetView.setBigUint64(position2, value);
        } else {
          if (this.largeBigIntToFloat) {
            target[position2++] = 203;
            targetView.setFloat64(position2, Number(value));
          } else if (this.largeBigIntToString) {
            return pack(value.toString());
          } else if (this.useBigIntExtension || this.moreTypes) {
            let empty = value < 0 ? BigInt(-1) : BigInt(0);
            let array;
            if (value >> BigInt(65536) === empty) {
              let mask = BigInt(18446744073709552000) - BigInt(1);
              let chunks = [];
              while (true) {
                chunks.push(value & mask);
                if (value >> BigInt(63) === empty)
                  break;
                value >>= BigInt(64);
              }
              array = new Uint8Array(new BigUint64Array(chunks).buffer);
              array.reverse();
            } else {
              let invert = value < 0;
              let string = (invert ? ~value : value).toString(16);
              if (string.length % 2) {
                string = "0" + string;
              } else if (parseInt(string.charAt(0), 16) >= 8) {
                string = "00" + string;
              }
              if (hasNodeBuffer) {
                array = Buffer.from(string, "hex");
              } else {
                array = new Uint8Array(string.length / 2);
                for (let i = 0;i < array.length; i++) {
                  array[i] = parseInt(string.slice(i * 2, i * 2 + 2), 16);
                }
              }
              if (invert) {
                for (let i = 0;i < array.length; i++)
                  array[i] = ~array[i];
              }
            }
            if (array.length + position2 > safeEnd)
              makeRoom(array.length + position2);
            position2 = writeExtensionData(array, target, position2, 66);
            return;
          } else {
            throw new RangeError(value + " was too large to fit in MessagePack 64-bit integer format, use" + " useBigIntExtension, or set largeBigIntToFloat to convert to float-64, or set" + " largeBigIntToString to convert to string");
          }
        }
        position2 += 8;
      } else if (type === "undefined") {
        if (this.encodeUndefinedAsNil)
          target[position2++] = 192;
        else {
          target[position2++] = 212;
          target[position2++] = 0;
          target[position2++] = 0;
        }
      } else {
        throw new Error("Unknown type: " + type);
      }
    };
    const writePlainObject = this.variableMapSize || this.coercibleKeyAsNumber || this.skipValues ? (object) => {
      let keys;
      if (this.skipValues) {
        keys = [];
        for (let key2 in object) {
          if ((typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key2)) && !this.skipValues.includes(object[key2]))
            keys.push(key2);
        }
      } else {
        keys = Object.keys(object);
      }
      let length = keys.length;
      if (length < 16) {
        target[position2++] = 128 | length;
      } else if (length < 65536) {
        target[position2++] = 222;
        target[position2++] = length >> 8;
        target[position2++] = length & 255;
      } else {
        target[position2++] = 223;
        targetView.setUint32(position2, length);
        position2 += 4;
      }
      let key;
      if (this.coercibleKeyAsNumber) {
        for (let i = 0;i < length; i++) {
          key = keys[i];
          let num = Number(key);
          pack(isNaN(num) ? key : num);
          pack(object[key]);
        }
      } else {
        for (let i = 0;i < length; i++) {
          pack(key = keys[i]);
          pack(object[key]);
        }
      }
    } : (object) => {
      target[position2++] = 222;
      let objectOffset = position2 - start;
      position2 += 2;
      let size = 0;
      for (let key in object) {
        if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          pack(key);
          pack(object[key]);
          size++;
        }
      }
      if (size > 65535) {
        throw new Error("Object is too large to serialize with fast 16-bit map size," + ' use the "variableMapSize" option to serialize this object');
      }
      target[objectOffset++ + start] = size >> 8;
      target[objectOffset + start] = size & 255;
    };
    const writeRecord = this.useRecords === false ? writePlainObject : options.progressiveRecords && !useTwoByteRecords ? (object) => {
      let nextTransition, transition = structures.transitions || (structures.transitions = Object.create(null));
      let objectOffset = position2++ - start;
      let wroteKeys;
      for (let key in object) {
        if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          nextTransition = transition[key];
          if (nextTransition)
            transition = nextTransition;
          else {
            let keys = Object.keys(object);
            let lastTransition = transition;
            transition = structures.transitions;
            let newTransitions = 0;
            for (let i = 0, l = keys.length;i < l; i++) {
              let key2 = keys[i];
              nextTransition = transition[key2];
              if (!nextTransition) {
                nextTransition = transition[key2] = Object.create(null);
                newTransitions++;
              }
              transition = nextTransition;
            }
            if (objectOffset + start + 1 == position2) {
              position2--;
              newRecord(transition, keys, newTransitions);
            } else
              insertNewRecord(transition, keys, objectOffset, newTransitions);
            wroteKeys = true;
            transition = lastTransition[key];
          }
          pack(object[key]);
        }
      }
      if (!wroteKeys) {
        let recordId = transition[RECORD_SYMBOL];
        if (recordId)
          target[objectOffset + start] = recordId;
        else
          insertNewRecord(transition, Object.keys(object), objectOffset, 0);
      }
    } : (object) => {
      let nextTransition, transition = structures.transitions || (structures.transitions = Object.create(null));
      let newTransitions = 0;
      for (let key in object)
        if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          nextTransition = transition[key];
          if (!nextTransition) {
            nextTransition = transition[key] = Object.create(null);
            newTransitions++;
          }
          transition = nextTransition;
        }
      let recordId = transition[RECORD_SYMBOL];
      if (recordId) {
        if (recordId >= 96 && useTwoByteRecords) {
          target[position2++] = ((recordId -= 96) & 31) + 96;
          target[position2++] = recordId >> 5;
        } else
          target[position2++] = recordId;
      } else {
        newRecord(transition, transition.__keys__ || Object.keys(object), newTransitions);
      }
      for (let key in object)
        if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          pack(object[key]);
        }
    };
    const checkUseRecords = typeof this.useRecords == "function" && this.useRecords;
    const writeObject = checkUseRecords ? (object) => {
      checkUseRecords(object) ? writeRecord(object) : writePlainObject(object);
    } : writeRecord;
    const makeRoom = (end) => {
      let newSize;
      if (end > 16777216) {
        if (end - start > MAX_BUFFER_SIZE)
          throw new Error("Packed buffer would be larger than maximum buffer size");
        newSize = Math.min(MAX_BUFFER_SIZE, Math.round(Math.max((end - start) * (end > 67108864 ? 1.25 : 2), 4194304) / 4096) * 4096);
      } else
        newSize = (Math.max(end - start << 2, target.length - 1) >> 12) + 1 << 12;
      let newBuffer = new ByteArrayAllocate(newSize);
      targetView = newBuffer.dataView || (newBuffer.dataView = new DataView(newBuffer.buffer, 0, newSize));
      end = Math.min(end, target.length);
      if (target.copy)
        target.copy(newBuffer, 0, start, end);
      else
        newBuffer.set(target.slice(start, end));
      position2 -= start;
      start = 0;
      safeEnd = newBuffer.length - 10;
      return target = newBuffer;
    };
    const newRecord = (transition, keys, newTransitions) => {
      let recordId = structures.nextId;
      if (!recordId)
        recordId = 64;
      if (recordId < sharedLimitId && this.shouldShareStructure && !this.shouldShareStructure(keys)) {
        recordId = structures.nextOwnId;
        if (!(recordId < maxStructureId))
          recordId = sharedLimitId;
        structures.nextOwnId = recordId + 1;
      } else {
        if (recordId >= maxStructureId)
          recordId = sharedLimitId;
        structures.nextId = recordId + 1;
      }
      let highByte = keys.highByte = recordId >= 96 && useTwoByteRecords ? recordId - 96 >> 5 : -1;
      transition[RECORD_SYMBOL] = recordId;
      transition.__keys__ = keys;
      structures[recordId - 64] = keys;
      if (recordId < sharedLimitId) {
        keys.isShared = true;
        structures.sharedLength = recordId - 63;
        hasSharedUpdate = true;
        if (highByte >= 0) {
          target[position2++] = (recordId & 31) + 96;
          target[position2++] = highByte;
        } else {
          target[position2++] = recordId;
        }
      } else {
        if (highByte >= 0) {
          target[position2++] = 213;
          target[position2++] = 114;
          target[position2++] = (recordId & 31) + 96;
          target[position2++] = highByte;
        } else {
          target[position2++] = 212;
          target[position2++] = 114;
          target[position2++] = recordId;
        }
        if (newTransitions)
          transitionsCount += serializationsSinceTransitionRebuild * newTransitions;
        if (recordIdsToRemove.length >= maxOwnStructures)
          recordIdsToRemove.shift()[RECORD_SYMBOL] = 0;
        recordIdsToRemove.push(transition);
        pack(keys);
      }
    };
    const insertNewRecord = (transition, keys, insertionOffset, newTransitions) => {
      let mainTarget = target;
      let mainPosition = position2;
      let mainSafeEnd = safeEnd;
      let mainStart = start;
      target = keysTarget;
      position2 = 0;
      start = 0;
      if (!target)
        keysTarget = target = new ByteArrayAllocate(8192);
      safeEnd = target.length - 10;
      newRecord(transition, keys, newTransitions);
      keysTarget = target;
      let keysPosition = position2;
      target = mainTarget;
      position2 = mainPosition;
      safeEnd = mainSafeEnd;
      start = mainStart;
      if (keysPosition > 1) {
        let newEnd = position2 + keysPosition - 1;
        if (newEnd > safeEnd)
          makeRoom(newEnd);
        let insertionPosition = insertionOffset + start;
        target.copyWithin(insertionPosition + keysPosition, insertionPosition + 1, position2);
        target.set(keysTarget.slice(0, keysPosition), insertionPosition);
        position2 = newEnd;
      } else {
        target[insertionOffset + start] = keysTarget[0];
      }
    };
    const writeStruct = (object) => {
      let newPosition = writeStructSlots(object, target, start, position2, structures, makeRoom, (value, newPosition2, notifySharedUpdate) => {
        if (notifySharedUpdate)
          return hasSharedUpdate = true;
        position2 = newPosition2;
        let startTarget = target;
        pack(value);
        resetStructures();
        if (startTarget !== target) {
          return { position: position2, targetView, target };
        }
        return position2;
      }, this);
      if (newPosition === 0)
        return writeObject(object);
      position2 = newPosition;
    };
  }
  useBuffer(buffer) {
    target = buffer;
    target.dataView || (target.dataView = new DataView(target.buffer, target.byteOffset, target.byteLength));
    targetView = target.dataView;
    position2 = 0;
  }
  set position(value) {
    position2 = value;
  }
  get position() {
    return position2;
  }
  clearSharedData() {
    if (this.structures)
      this.structures = [];
    if (this.typedStructs)
      this.typedStructs = [];
  }
}
extensionClasses = [Date, Set, Error, RegExp, ArrayBuffer, Object.getPrototypeOf(Uint8Array.prototype).constructor, DataView, C1Type];
extensions = [{
  pack(date, allocateForWrite, pack) {
    let seconds = date.getTime() / 1000;
    if ((this.useTimestamp32 || date.getMilliseconds() === 0) && seconds >= 0 && seconds < 4294967296) {
      let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(6);
      target2[position3++] = 214;
      target2[position3++] = 255;
      targetView2.setUint32(position3, seconds);
    } else if (seconds > 0 && seconds < 4294967296) {
      let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(10);
      target2[position3++] = 215;
      target2[position3++] = 255;
      targetView2.setUint32(position3, date.getMilliseconds() * 4000000 + (seconds / 1000 / 4294967296 >> 0));
      targetView2.setUint32(position3 + 4, seconds);
    } else if (isNaN(seconds)) {
      if (this.onInvalidDate) {
        allocateForWrite(0);
        return pack(this.onInvalidDate());
      }
      let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(3);
      target2[position3++] = 212;
      target2[position3++] = 255;
      target2[position3++] = 255;
    } else {
      let { target: target2, targetView: targetView2, position: position3 } = allocateForWrite(15);
      target2[position3++] = 199;
      target2[position3++] = 12;
      target2[position3++] = 255;
      targetView2.setUint32(position3, date.getMilliseconds() * 1e6);
      targetView2.setBigInt64(position3 + 4, BigInt(Math.floor(seconds)));
    }
  }
}, {
  pack(set, allocateForWrite, pack) {
    if (this.setAsEmptyObject) {
      allocateForWrite(0);
      return pack({});
    }
    let array = Array.from(set);
    let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
    if (this.moreTypes) {
      target2[position3++] = 212;
      target2[position3++] = 115;
      target2[position3++] = 0;
    }
    pack(array);
  }
}, {
  pack(error2, allocateForWrite, pack) {
    let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
    if (this.moreTypes) {
      target2[position3++] = 212;
      target2[position3++] = 101;
      target2[position3++] = 0;
    }
    pack([error2.name, error2.message, error2.cause]);
  }
}, {
  pack(regex, allocateForWrite, pack) {
    let { target: target2, position: position3 } = allocateForWrite(this.moreTypes ? 3 : 0);
    if (this.moreTypes) {
      target2[position3++] = 212;
      target2[position3++] = 120;
      target2[position3++] = 0;
    }
    pack([regex.source, regex.flags]);
  }
}, {
  pack(arrayBuffer, allocateForWrite) {
    if (this.moreTypes)
      writeExtBuffer(arrayBuffer, 16, allocateForWrite);
    else
      writeBuffer(hasNodeBuffer ? Buffer.from(arrayBuffer) : new Uint8Array(arrayBuffer), allocateForWrite);
  }
}, {
  pack(typedArray, allocateForWrite) {
    let constructor = typedArray.constructor;
    if (constructor !== ByteArray && this.moreTypes)
      writeExtBuffer(typedArray, typedArrays.indexOf(constructor.name), allocateForWrite);
    else
      writeBuffer(typedArray, allocateForWrite);
  }
}, {
  pack(arrayBuffer, allocateForWrite) {
    if (this.moreTypes)
      writeExtBuffer(arrayBuffer, 17, allocateForWrite);
    else
      writeBuffer(hasNodeBuffer ? Buffer.from(arrayBuffer) : new Uint8Array(arrayBuffer), allocateForWrite);
  }
}, {
  pack(c1, allocateForWrite) {
    let { target: target2, position: position3 } = allocateForWrite(1);
    target2[position3] = 193;
  }
}];
function writeExtBuffer(typedArray, type, allocateForWrite, encode) {
  let length = typedArray.byteLength;
  if (length + 1 < 256) {
    var { target: target2, position: position3 } = allocateForWrite(4 + length);
    target2[position3++] = 199;
    target2[position3++] = length + 1;
  } else if (length + 1 < 65536) {
    var { target: target2, position: position3 } = allocateForWrite(5 + length);
    target2[position3++] = 200;
    target2[position3++] = length + 1 >> 8;
    target2[position3++] = length + 1 & 255;
  } else {
    var { target: target2, position: position3, targetView: targetView2 } = allocateForWrite(7 + length);
    target2[position3++] = 201;
    targetView2.setUint32(position3, length + 1);
    position3 += 4;
  }
  target2[position3++] = 116;
  target2[position3++] = type;
  if (!typedArray.buffer)
    typedArray = new Uint8Array(typedArray);
  target2.set(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength), position3);
}
function writeBuffer(buffer, allocateForWrite) {
  let length = buffer.byteLength;
  var target2, position3;
  if (length < 256) {
    var { target: target2, position: position3 } = allocateForWrite(length + 2);
    target2[position3++] = 196;
    target2[position3++] = length;
  } else if (length < 65536) {
    var { target: target2, position: position3 } = allocateForWrite(length + 3);
    target2[position3++] = 197;
    target2[position3++] = length >> 8;
    target2[position3++] = length & 255;
  } else {
    var { target: target2, position: position3, targetView: targetView2 } = allocateForWrite(length + 5);
    target2[position3++] = 198;
    targetView2.setUint32(position3, length);
    position3 += 4;
  }
  target2.set(buffer, position3);
}
function writeExtensionData(result, target2, position3, type) {
  let length = result.length;
  switch (length) {
    case 1:
      target2[position3++] = 212;
      break;
    case 2:
      target2[position3++] = 213;
      break;
    case 4:
      target2[position3++] = 214;
      break;
    case 8:
      target2[position3++] = 215;
      break;
    case 16:
      target2[position3++] = 216;
      break;
    default:
      if (length < 256) {
        target2[position3++] = 199;
        target2[position3++] = length;
      } else if (length < 65536) {
        target2[position3++] = 200;
        target2[position3++] = length >> 8;
        target2[position3++] = length & 255;
      } else {
        target2[position3++] = 201;
        target2[position3++] = length >> 24;
        target2[position3++] = length >> 16 & 255;
        target2[position3++] = length >> 8 & 255;
        target2[position3++] = length & 255;
      }
  }
  target2[position3++] = type;
  target2.set(result, position3);
  position3 += length;
  return position3;
}
function insertIds(serialized, idsToInsert) {
  let nextId;
  let distanceToMove = idsToInsert.length * 6;
  let lastEnd = serialized.length - distanceToMove;
  while (nextId = idsToInsert.pop()) {
    let offset = nextId.offset;
    let id = nextId.id;
    serialized.copyWithin(offset + distanceToMove, offset, lastEnd);
    distanceToMove -= 6;
    let position3 = offset + distanceToMove;
    serialized[position3++] = 214;
    serialized[position3++] = 105;
    serialized[position3++] = id >> 24;
    serialized[position3++] = id >> 16 & 255;
    serialized[position3++] = id >> 8 & 255;
    serialized[position3++] = id & 255;
    lastEnd = offset;
  }
  return serialized;
}
function writeBundles(start, pack, incrementPosition) {
  if (bundledStrings2.length > 0) {
    targetView.setUint32(bundledStrings2.position + start, position2 + incrementPosition - bundledStrings2.position - start);
    bundledStrings2.stringsPosition = position2 - start;
    let writeStrings = bundledStrings2;
    bundledStrings2 = null;
    pack(writeStrings[0]);
    pack(writeStrings[1]);
  }
}
function prepareStructures(structures, packr) {
  structures.isCompatible = (existingStructures) => {
    let compatible = !existingStructures || (packr.lastNamedStructuresLength || 0) === existingStructures.length;
    if (!compatible)
      packr._mergeStructures(existingStructures);
    return compatible;
  };
  return structures;
}
function setWriteStructSlots(writeSlots, makeStructures) {
  writeStructSlots = writeSlots;
  prepareStructures = makeStructures;
}
var defaultPackr = new Packr({ useRecords: false });
var pack = defaultPackr.pack;
var encode = defaultPackr.pack;
var REUSE_BUFFER_MODE = 512;
var RESET_BUFFER_MODE = 1024;
var RESERVE_START_SPACE = 2048;
// ../../node_modules/.bun/msgpackr@1.12.1/node_modules/msgpackr/struct.js
var ASCII = 3;
var NUMBER = 0;
var UTF8 = 2;
var OBJECT_DATA = 1;
var DATE = 16;
var TYPE_NAMES = ["num", "object", "string", "ascii"];
TYPE_NAMES[DATE] = "date";
var float32Headers = [false, true, true, false, false, true, true, false];
var evalSupported;
try {
  new Function("");
  evalSupported = true;
} catch (error2) {}
var updatedPosition;
var hasNodeBuffer2 = typeof Buffer !== "undefined";
var textEncoder2;
var currentSource;
try {
  textEncoder2 = new TextEncoder;
} catch (error2) {}
var encodeUtf8 = hasNodeBuffer2 ? function(target2, string, position3) {
  return target2.utf8Write(string, position3, target2.byteLength - position3);
} : textEncoder2 && textEncoder2.encodeInto ? function(target2, string, position3) {
  return textEncoder2.encodeInto(string, target2.subarray(position3)).written;
} : false;
var TYPE = Symbol("type");
var PARENT = Symbol("parent");
setWriteStructSlots(writeStruct, prepareStructures2);
function writeStruct(object, target2, encodingStart, position3, structures, makeRoom, pack2, packr, structureKnown) {
  let typedStructs = packr.typedStructs || (packr.typedStructs = []);
  const cap = packr.maxOwnStructures ?? Infinity;
  const frozen = !structureKnown && typedStructs.length >= cap;
  let targetView2 = target2.dataView;
  let refsStartPosition = (typedStructs.lastStringStart || 100) + position3;
  let safeEnd2 = target2.length - 10;
  let start = position3;
  if (position3 > safeEnd2) {
    target2 = makeRoom(position3);
    targetView2 = target2.dataView;
    position3 -= encodingStart;
    start -= encodingStart;
    refsStartPosition -= encodingStart;
    encodingStart = 0;
    safeEnd2 = target2.length - 10;
  }
  let refOffset, refPosition = refsStartPosition;
  let transition = typedStructs.transitions || (typedStructs.transitions = Object.create(null));
  let nextId = typedStructs.nextId || typedStructs.length;
  let headerSize = nextId < 15 ? 1 : nextId < 240 ? 2 : nextId < 61440 ? 3 : nextId < 15728640 ? 4 : 0;
  if (headerSize === 0)
    return 0;
  position3 += headerSize;
  let queuedReferences = [];
  let usedAscii0;
  let keyIndex = 0;
  for (let key in object) {
    let nextTransition = transition[key];
    if (!nextTransition) {
      if (frozen)
        return 0;
      transition[key] = nextTransition = {
        key,
        parent: transition,
        enumerationOffset: 0,
        ascii0: null,
        ascii8: null,
        num8: null,
        string16: null,
        object16: null,
        num32: null,
        float64: null,
        date64: null
      };
    }
    let value = object[key];
    if (position3 > safeEnd2) {
      target2 = makeRoom(position3);
      targetView2 = target2.dataView;
      position3 -= encodingStart;
      start -= encodingStart;
      refsStartPosition -= encodingStart;
      refPosition -= encodingStart;
      encodingStart = 0;
      safeEnd2 = target2.length - 10;
    }
    switch (typeof value) {
      case "number":
        let number = value;
        if (nextId < 200 || !nextTransition.num64) {
          if (number >> 0 === number && number < 536870912 && number > -520093696) {
            if (number < 246 && number >= 0 && (nextTransition.num8 && !(nextId > 200 && nextTransition.num32) || number < 32 && !nextTransition.num32)) {
              transition = nextTransition.num8 || createTypeTransition(nextTransition, NUMBER, 1, frozen);
              target2[position3++] = number;
            } else {
              transition = nextTransition.num32 || createTypeTransition(nextTransition, NUMBER, 4, frozen);
              targetView2.setUint32(position3, number, true);
              position3 += 4;
            }
            break;
          } else if (number < 4294967296 && number >= -2147483648) {
            targetView2.setFloat32(position3, number, true);
            if (float32Headers[target2[position3 + 3] >>> 5]) {
              let xShifted;
              if ((xShifted = number * mult10[(target2[position3 + 3] & 127) << 1 | target2[position3 + 2] >> 7]) >> 0 === xShifted) {
                transition = nextTransition.num32 || createTypeTransition(nextTransition, NUMBER, 4, frozen);
                position3 += 4;
                break;
              }
            }
          }
        }
        transition = nextTransition.num64 || createTypeTransition(nextTransition, NUMBER, 8, frozen);
        targetView2.setFloat64(position3, number, true);
        position3 += 8;
        break;
      case "string":
        let strLength = value.length;
        refOffset = refPosition - refsStartPosition;
        if ((strLength << 2) + refPosition > safeEnd2) {
          target2 = makeRoom((strLength << 2) + refPosition);
          targetView2 = target2.dataView;
          position3 -= encodingStart;
          start -= encodingStart;
          refsStartPosition -= encodingStart;
          refPosition -= encodingStart;
          encodingStart = 0;
          safeEnd2 = target2.length - 10;
        }
        if (strLength > 65280 + refOffset >> 2) {
          queuedReferences.push(key, value, position3 - start);
          break;
        }
        let isNotAscii;
        let strStart = refPosition;
        if (strLength < 64) {
          let i, c1, c2;
          for (i = 0;i < strLength; i++) {
            c1 = value.charCodeAt(i);
            if (c1 < 128) {
              target2[refPosition++] = c1;
            } else if (c1 < 2048) {
              isNotAscii = true;
              target2[refPosition++] = c1 >> 6 | 192;
              target2[refPosition++] = c1 & 63 | 128;
            } else if ((c1 & 64512) === 55296 && ((c2 = value.charCodeAt(i + 1)) & 64512) === 56320) {
              isNotAscii = true;
              c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
              i++;
              target2[refPosition++] = c1 >> 18 | 240;
              target2[refPosition++] = c1 >> 12 & 63 | 128;
              target2[refPosition++] = c1 >> 6 & 63 | 128;
              target2[refPosition++] = c1 & 63 | 128;
            } else {
              isNotAscii = true;
              target2[refPosition++] = c1 >> 12 | 224;
              target2[refPosition++] = c1 >> 6 & 63 | 128;
              target2[refPosition++] = c1 & 63 | 128;
            }
          }
        } else {
          refPosition += encodeUtf8(target2, value, refPosition);
          isNotAscii = refPosition - strStart > strLength;
        }
        if (refOffset < 160 || refOffset < 246 && (nextTransition.ascii8 || nextTransition.string8)) {
          if (isNotAscii) {
            if (!(transition = nextTransition.string8)) {
              if (typedStructs.length > 10 && (transition = nextTransition.ascii8)) {
                transition.__type = UTF8;
                nextTransition.ascii8 = null;
                nextTransition.string8 = transition;
                pack2(null, 0, true);
              } else {
                transition = createTypeTransition(nextTransition, UTF8, 1, frozen);
              }
            }
          } else if (refOffset === 0 && !usedAscii0) {
            usedAscii0 = true;
            transition = nextTransition.ascii0 || createTypeTransition(nextTransition, ASCII, 0, frozen);
            break;
          } else if (!(transition = nextTransition.ascii8) && !(typedStructs.length > 10 && (transition = nextTransition.string8)))
            transition = createTypeTransition(nextTransition, ASCII, 1, frozen);
          target2[position3++] = refOffset;
        } else {
          transition = nextTransition.string16 || createTypeTransition(nextTransition, UTF8, 2, frozen);
          targetView2.setUint16(position3, refOffset, true);
          position3 += 2;
        }
        break;
      case "object":
        if (value) {
          if (value.constructor === Date) {
            transition = nextTransition.date64 || createTypeTransition(nextTransition, DATE, 8, frozen);
            targetView2.setFloat64(position3, value.getTime(), true);
            position3 += 8;
          } else {
            queuedReferences.push(key, value, keyIndex);
          }
          break;
        } else {
          nextTransition = anyType(nextTransition, position3, targetView2, -10);
          if (nextTransition) {
            transition = nextTransition;
            position3 = updatedPosition;
          } else
            queuedReferences.push(key, value, keyIndex);
        }
        break;
      case "boolean":
        transition = nextTransition.num8 || nextTransition.ascii8 || createTypeTransition(nextTransition, NUMBER, 1, frozen);
        target2[position3++] = value ? 249 : 248;
        break;
      case "undefined":
        nextTransition = anyType(nextTransition, position3, targetView2, -9);
        if (nextTransition) {
          transition = nextTransition;
          position3 = updatedPosition;
        } else
          queuedReferences.push(key, value, keyIndex);
        break;
      default:
        queuedReferences.push(key, value, keyIndex);
    }
    if (transition === undefined)
      return 0;
    keyIndex++;
  }
  if (!structureKnown && queuedReferences.length > 0 && typedStructs.length >= cap) {
    let t = transition;
    for (let i = 0, l = queuedReferences.length;i < l; i += 3) {
      if (queuedReferences[i + 1] != null)
        return 0;
      const nt = t[queuedReferences[i]];
      if (!nt)
        return 0;
      const next = nt.object16;
      if (!next)
        return 0;
      t = next;
    }
    if (t[RECORD_SYMBOL] == null)
      return 0;
  }
  let packedRef = false;
  for (let i = 0, l = queuedReferences.length;i < l; ) {
    let key = queuedReferences[i++];
    let value = queuedReferences[i++];
    let propertyIndex = queuedReferences[i++];
    let nextTransition = transition[key];
    if (!nextTransition) {
      transition[key] = nextTransition = {
        key,
        parent: transition,
        enumerationOffset: propertyIndex - keyIndex,
        ascii0: null,
        ascii8: null,
        num8: null,
        string16: null,
        object16: null,
        num32: null,
        float64: null
      };
    }
    let newPosition;
    if (value) {
      let size;
      refOffset = refPosition - refsStartPosition;
      if (refOffset < 65280) {
        transition = nextTransition.object16;
        if (transition)
          size = 2;
        else if (transition = nextTransition.object32)
          size = 4;
        else {
          transition = forceTypeTransition(nextTransition, OBJECT_DATA, 2);
          size = 2;
        }
      } else {
        transition = nextTransition.object32 || forceTypeTransition(nextTransition, OBJECT_DATA, 4);
        size = 4;
      }
      newPosition = pack2(value, refPosition);
      packedRef = true;
      if (typeof newPosition === "object") {
        refPosition = newPosition.position;
        targetView2 = newPosition.targetView;
        target2 = newPosition.target;
        refsStartPosition -= encodingStart;
        position3 -= encodingStart;
        start -= encodingStart;
        encodingStart = 0;
      } else
        refPosition = newPosition;
      if (size === 2) {
        targetView2.setUint16(position3, refOffset, true);
        position3 += 2;
      } else {
        targetView2.setUint32(position3, refOffset, true);
        position3 += 4;
      }
    } else {
      transition = nextTransition.object16 || forceTypeTransition(nextTransition, OBJECT_DATA, 2);
      targetView2.setInt16(position3, value === null ? -10 : -9, true);
      position3 += 2;
    }
    keyIndex++;
  }
  let recordId = transition[RECORD_SYMBOL];
  if (recordId == null) {
    if (!packedRef && typedStructs.length >= cap)
      return 0;
    recordId = packr.typedStructs.length;
    let structure = [];
    let nextTransition = transition;
    let key, type;
    while ((type = nextTransition.__type) !== undefined) {
      let size = nextTransition.__size;
      nextTransition = nextTransition.__parent;
      key = nextTransition.key;
      let property = [type, size, key];
      if (nextTransition.enumerationOffset)
        property.push(nextTransition.enumerationOffset);
      structure.push(property);
      nextTransition = nextTransition.parent;
    }
    structure.reverse();
    transition[RECORD_SYMBOL] = recordId;
    packr.typedStructs[recordId] = structure;
    pack2(null, 0, true);
  }
  switch (headerSize) {
    case 1:
      if (recordId >= 16)
        return 0;
      target2[start] = recordId + 32;
      break;
    case 2:
      if (recordId >= 256)
        return 0;
      target2[start] = 56;
      target2[start + 1] = recordId;
      break;
    case 3:
      if (recordId >= 65536)
        return 0;
      target2[start] = 57;
      targetView2.setUint16(start + 1, recordId, true);
      break;
    case 4:
      if (recordId >= 16777216)
        return 0;
      targetView2.setUint32(start, (recordId << 8) + 58, true);
      break;
  }
  if (position3 < refsStartPosition) {
    if (refsStartPosition === refPosition)
      return position3;
    target2.copyWithin(position3, refsStartPosition, refPosition);
    refPosition += position3 - refsStartPosition;
    typedStructs.lastStringStart = position3 - start;
  } else if (position3 > refsStartPosition) {
    if (refsStartPosition === refPosition)
      return position3;
    typedStructs.lastStringStart = position3 - start;
    return writeStruct(object, target2, encodingStart, start, structures, makeRoom, pack2, packr, true);
  }
  return refPosition;
}
function anyType(transition, position3, targetView2, value) {
  let nextTransition;
  if (nextTransition = transition.ascii8 || transition.num8) {
    targetView2.setInt8(position3, value, true);
    updatedPosition = position3 + 1;
    return nextTransition;
  }
  if (nextTransition = transition.string16 || transition.object16) {
    targetView2.setInt16(position3, value, true);
    updatedPosition = position3 + 2;
    return nextTransition;
  }
  if (nextTransition = transition.num32) {
    targetView2.setUint32(position3, 3758096640 + value, true);
    updatedPosition = position3 + 4;
    return nextTransition;
  }
  if (nextTransition = transition.num64) {
    targetView2.setFloat64(position3, NaN, true);
    targetView2.setInt8(position3, value);
    updatedPosition = position3 + 8;
    return nextTransition;
  }
  updatedPosition = position3;
  return;
}
function createTypeTransition(transition, type, size, frozen) {
  let typeName = TYPE_NAMES[type] + (size << 3);
  let newTransition = transition[typeName];
  if (newTransition)
    return newTransition;
  if (frozen)
    return;
  newTransition = transition[typeName] = Object.create(null);
  newTransition.__type = type;
  newTransition.__size = size;
  newTransition.__parent = transition;
  return newTransition;
}
function forceTypeTransition(transition, type, size) {
  let typeName = TYPE_NAMES[type] + (size << 3);
  let newTransition = transition[typeName];
  if (newTransition)
    return newTransition;
  newTransition = transition[typeName] = Object.create(null);
  newTransition.__type = type;
  newTransition.__size = size;
  newTransition.__parent = transition;
  return newTransition;
}
function onLoadedStructures2(sharedData) {
  if (!(sharedData instanceof Map))
    return sharedData;
  let typed = sharedData.get("typed") || [];
  if (Object.isFrozen(typed))
    typed = typed.map((structure) => structure.slice(0));
  let named = sharedData.get("named");
  let transitions = Object.create(null);
  for (let i = 0, l = typed.length;i < l; i++) {
    let structure = typed[i];
    let transition = transitions;
    for (let [type, size, key] of structure) {
      let nextTransition = transition[key];
      if (!nextTransition) {
        transition[key] = nextTransition = {
          key,
          parent: transition,
          enumerationOffset: 0,
          ascii0: null,
          ascii8: null,
          num8: null,
          string16: null,
          object16: null,
          num32: null,
          float64: null,
          date64: null
        };
      }
      transition = createTypeTransition(nextTransition, type, size, false);
    }
    transition[RECORD_SYMBOL] = i;
  }
  typed.transitions = transitions;
  this.typedStructs = typed;
  this.lastTypedStructuresLength = typed.length;
  return named;
}
var sourceSymbol = Symbol.for("source");
function readStruct2(src2, position3, srcEnd2, unpackr) {
  let recordId = src2[position3++] - 32;
  if (recordId >= 24) {
    switch (recordId) {
      case 24:
        recordId = src2[position3++];
        break;
      case 25:
        recordId = src2[position3++] + (src2[position3++] << 8);
        break;
      case 26:
        recordId = src2[position3++] + (src2[position3++] << 8) + (src2[position3++] << 16);
        break;
      case 27:
        recordId = src2[position3++] + (src2[position3++] << 8) + (src2[position3++] << 16) + (src2[position3++] << 24);
        break;
    }
  }
  let structure = unpackr.typedStructs && unpackr.typedStructs[recordId];
  if (!structure) {
    src2 = Uint8Array.prototype.slice.call(src2, position3, srcEnd2);
    srcEnd2 -= position3;
    position3 = 0;
    if (!unpackr.getStructures)
      throw new Error(`Reference to shared structure ${recordId} without getStructures method`);
    unpackr._mergeStructures(unpackr.getStructures());
    if (!unpackr.typedStructs)
      throw new Error("Could not find any shared typed structures");
    unpackr.lastTypedStructuresLength = unpackr.typedStructs.length;
    structure = unpackr.typedStructs[recordId];
    if (!structure)
      throw new Error("Could not find typed structure " + recordId);
  }
  var construct = structure.construct;
  var fullConstruct = structure.fullConstruct;
  if (!construct) {
    construct = structure.construct = function LazyObject() {};
    fullConstruct = structure.fullConstruct = function LoadedObject() {};
    fullConstruct.prototype = unpackr.structPrototype || {};
    var prototype = construct.prototype = unpackr.structPrototype ? Object.create(unpackr.structPrototype) : {};
    let properties = [];
    let currentOffset = 0;
    let lastRefProperty;
    for (let i = 0, l = structure.length;i < l; i++) {
      let definition = structure[i];
      let [type, size, key, enumerationOffset] = definition;
      if (key === "__proto__")
        key = "__proto_";
      let property = {
        key,
        offset: currentOffset
      };
      if (enumerationOffset)
        properties.splice(i + enumerationOffset, 0, property);
      else
        properties.push(property);
      let getRef;
      switch (size) {
        case 0:
          getRef = () => 0;
          break;
        case 1:
          getRef = (source, position4) => {
            let ref = source.bytes[position4 + property.offset];
            return ref >= 246 ? toConstant(ref) : ref;
          };
          break;
        case 2:
          getRef = (source, position4) => {
            let src3 = source.bytes;
            let dataView2 = src3.dataView || (src3.dataView = new DataView(src3.buffer, src3.byteOffset, src3.byteLength));
            let ref = dataView2.getUint16(position4 + property.offset, true);
            return ref >= 65280 ? toConstant(ref & 255) : ref;
          };
          break;
        case 4:
          getRef = (source, position4) => {
            let src3 = source.bytes;
            let dataView2 = src3.dataView || (src3.dataView = new DataView(src3.buffer, src3.byteOffset, src3.byteLength));
            let ref = dataView2.getUint32(position4 + property.offset, true);
            return ref >= 4294967040 ? toConstant(ref & 255) : ref;
          };
          break;
      }
      property.getRef = getRef;
      currentOffset += size;
      let get;
      switch (type) {
        case ASCII:
          if (lastRefProperty && !lastRefProperty.next)
            lastRefProperty.next = property;
          lastRefProperty = property;
          property.multiGetCount = 0;
          get = function(source) {
            let src3 = source.bytes;
            let position4 = source.position;
            let refStart = currentOffset + position4;
            let ref = getRef(source, position4);
            if (typeof ref !== "number")
              return ref;
            let end, next = property.next;
            while (next) {
              end = next.getRef(source, position4);
              if (typeof end === "number")
                break;
              else
                end = null;
              next = next.next;
            }
            if (end == null)
              end = source.bytesEnd - refStart;
            if (source.srcString) {
              return source.srcString.slice(ref, end);
            }
            return readString(src3, ref + refStart, end - ref);
          };
          break;
        case UTF8:
        case OBJECT_DATA:
          if (lastRefProperty && !lastRefProperty.next)
            lastRefProperty.next = property;
          lastRefProperty = property;
          get = function(source) {
            let position4 = source.position;
            let refStart = currentOffset + position4;
            let ref = getRef(source, position4);
            if (typeof ref !== "number")
              return ref;
            let src3 = source.bytes;
            let end, next = property.next;
            while (next) {
              end = next.getRef(source, position4);
              if (typeof end === "number")
                break;
              else
                end = null;
              next = next.next;
            }
            if (end == null)
              end = source.bytesEnd - refStart;
            if (type === UTF8) {
              return src3.toString("utf8", ref + refStart, end + refStart);
            } else {
              currentSource = source;
              try {
                return unpackr.unpack(src3, { start: ref + refStart, end: end + refStart });
              } finally {
                currentSource = null;
              }
            }
          };
          break;
        case NUMBER:
          switch (size) {
            case 4:
              get = function(source) {
                let src3 = source.bytes;
                let dataView2 = src3.dataView || (src3.dataView = new DataView(src3.buffer, src3.byteOffset, src3.byteLength));
                let position4 = source.position + property.offset;
                let value = dataView2.getInt32(position4, true);
                if (value < 536870912) {
                  if (value > -520093696)
                    return value;
                  if (value > -536870912)
                    return toConstant(value & 255);
                }
                let fValue = dataView2.getFloat32(position4, true);
                let multiplier = mult10[(src3[position4 + 3] & 127) << 1 | src3[position4 + 2] >> 7];
                return (multiplier * fValue + (fValue > 0 ? 0.5 : -0.5) >> 0) / multiplier;
              };
              break;
            case 8:
              get = function(source) {
                let src3 = source.bytes;
                let dataView2 = src3.dataView || (src3.dataView = new DataView(src3.buffer, src3.byteOffset, src3.byteLength));
                let value = dataView2.getFloat64(source.position + property.offset, true);
                if (isNaN(value)) {
                  let byte = src3[source.position + property.offset];
                  if (byte >= 246)
                    return toConstant(byte);
                }
                return value;
              };
              break;
            case 1:
              get = function(source) {
                let src3 = source.bytes;
                let value = src3[source.position + property.offset];
                return value < 246 ? value : toConstant(value);
              };
              break;
          }
          break;
        case DATE:
          get = function(source) {
            let src3 = source.bytes;
            let dataView2 = src3.dataView || (src3.dataView = new DataView(src3.buffer, src3.byteOffset, src3.byteLength));
            return new Date(dataView2.getFloat64(source.position + property.offset, true));
          };
          break;
      }
      property.get = get;
    }
    if (evalSupported) {
      let objectLiteralProperties = [];
      let args = [];
      let i = 0;
      let hasInheritedProperties;
      for (let property of properties) {
        if (unpackr.alwaysLazyProperty && unpackr.alwaysLazyProperty(property.key)) {
          hasInheritedProperties = true;
          continue;
        }
        Object.defineProperty(prototype, property.key, { get: withSource(property.get), enumerable: true });
        let valueFunction = "v" + i++;
        args.push(valueFunction);
        objectLiteralProperties.push("o[" + JSON.stringify(property.key) + "]=" + valueFunction + "(s)");
      }
      if (hasInheritedProperties) {
        objectLiteralProperties.push("__proto__:this");
      }
      let toObject = new Function(...args, "var c=this;return function(s){var o=new c();" + objectLiteralProperties.join(";") + ";return o;}").apply(fullConstruct, properties.map((prop) => prop.get));
      Object.defineProperty(prototype, "toJSON", {
        value(omitUnderscoredProperties) {
          return toObject.call(this, this[sourceSymbol]);
        }
      });
    } else {
      Object.defineProperty(prototype, "toJSON", {
        value(omitUnderscoredProperties) {
          let resolved = {};
          for (let i = 0, l = properties.length;i < l; i++) {
            let key = properties[i].key;
            resolved[key] = this[key];
          }
          return resolved;
        }
      });
    }
  }
  var instance = new construct;
  instance[sourceSymbol] = {
    bytes: src2,
    position: position3,
    srcString: "",
    bytesEnd: srcEnd2
  };
  return instance;
}
function toConstant(code) {
  switch (code) {
    case 246:
      return null;
    case 247:
      return;
    case 248:
      return false;
    case 249:
      return true;
  }
  throw new Error("Unknown constant");
}
function withSource(get) {
  return function() {
    return get(this[sourceSymbol]);
  };
}
function saveState2() {
  if (currentSource) {
    currentSource.bytes = Uint8Array.prototype.slice.call(currentSource.bytes, currentSource.position, currentSource.bytesEnd);
    currentSource.position = 0;
    currentSource.bytesEnd = currentSource.bytes.length;
  }
}
function prepareStructures2(structures, packr) {
  if (packr.typedStructs) {
    let structMap = new Map;
    structMap.set("named", structures);
    structMap.set("typed", packr.typedStructs);
    structures = structMap;
  }
  let lastTypedStructuresLength = packr.lastTypedStructuresLength || 0;
  structures.isCompatible = (existing) => {
    let compatible = true;
    if (existing instanceof Map) {
      let named = existing.get("named") || [];
      if (named.length !== (packr.lastNamedStructuresLength || 0))
        compatible = false;
      let typed = existing.get("typed") || [];
      if (typed.length !== lastTypedStructuresLength)
        compatible = false;
    } else if (existing instanceof Array || Array.isArray(existing)) {
      if (existing.length !== (packr.lastNamedStructuresLength || 0))
        compatible = false;
    }
    if (!compatible)
      packr._mergeStructures(existing);
    return compatible;
  };
  packr.lastTypedStructuresLength = packr.typedStructs && packr.typedStructs.length;
  return structures;
}
setReadStruct(readStruct2, onLoadedStructures2, saveState2);
// ../../node_modules/.bun/msgpackr@1.12.1/node_modules/msgpackr/node-index.js
var nativeAccelerationDisabled = process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED !== undefined && process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED.toLowerCase() === "true";
if (!nativeAccelerationDisabled) {
  let extractor;
  try {
    if (true)
      extractor = require_msgpackr_extract_stub();
    if (extractor)
      setExtractor(extractor.extractStrings);
  } catch (error2) {}
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/client.js
class ClientClosedError extends Error {
  constructor(message = "Client closed") {
    super(message);
    this.name = "ClientClosedError";
  }
}
var clientClosedFilterInstalled = false;
function installClientClosedFilter() {
  if (clientClosedFilterInstalled)
    return;
  clientClosedFilterInstalled = true;
  process.on("unhandledRejection", (reason) => {
    if (reason instanceof ClientClosedError) {
      return;
    }
  });
}

class TcpClient extends EventEmitter2 {
  on(event, listener) {
    return super.on(event, listener);
  }
  once(event, listener) {
    return super.once(event, listener);
  }
  socket = null;
  connected = false;
  connecting = false;
  options;
  health;
  reconnect;
  commands;
  reqIdCounter = 0;
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_CONNECTION, ...options };
    this.commands = new CommandQueue;
    this.health = new HealthTracker({
      pingInterval: this.options.pingInterval,
      maxPingFailures: this.options.maxPingFailures,
      maxCommandTimeouts: this.options.maxCommandTimeouts
    });
    this.reconnect = new ReconnectManager({
      maxReconnectAttempts: this.options.maxReconnectAttempts,
      reconnectDelay: this.options.reconnectDelay,
      maxReconnectDelay: this.options.maxReconnectDelay,
      autoReconnect: this.options.autoReconnect
    });
    this.reconnect.on("reconnecting", (data) => this.emit("reconnecting", data));
    this.reconnect.on("maxReconnectAttemptsReached", () => {
      this.emit("maxReconnectAttemptsReached");
      this.commands.rejectAll(new Error("Max reconnection attempts reached"));
    });
  }
  async connect() {
    if (this.connected)
      return;
    if (this.connecting) {
      return this.waitForConnection();
    }
    this.connecting = true;
    this.reconnect.setClosed(false);
    try {
      await this.doConnect();
      this.reconnect.reset();
      this.emit("connected");
      this.health.startPing(async () => {
        await this.ping();
      });
      this.processQueue();
    } catch (err) {
      this.connecting = false;
      if (this.reconnect.canReconnect()) {
        this.reconnect.scheduleReconnect(() => this.connect());
      }
      throw err;
    }
  }
  waitForConnection() {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        this.off("error", onError);
        resolve();
      };
      const onError = (err) => {
        this.off("connected", onConnect);
        reject(err);
      };
      this.once("connected", onConnect);
      this.once("error", onError);
    });
  }
  async doConnect() {
    const { socket } = await createConnection({
      host: this.options.host,
      port: this.options.port,
      tls: this.options.tls
    }, this.options.connectTimeout, {
      onData: (frame) => {
        this.handleData(frame);
      },
      onClose: () => {
        this.handleClose();
      },
      onError: (error2) => this.emit("error", error2)
    });
    this.socket = socket;
    if (this.options.token) {
      try {
        await this.authenticate();
      } catch (err) {
        this.socket.end();
        this.socket = null;
        throw err;
      }
    }
    this.connected = true;
    this.connecting = false;
    this.health.recordConnected();
  }
  async authenticate() {
    const response = await this.sendDirect({ cmd: "Auth", token: this.options.token });
    if (!response.ok) {
      throw new Error("Authentication failed");
    }
  }
  handleData(frame) {
    try {
      const response = unpack(frame);
      const reqId = response.reqId;
      if (reqId) {
        const pending = this.commands.removeByReqId(reqId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(response);
          this.processQueue();
          return;
        }
      }
      const current = this.commands.getCurrentCommand();
      if (current) {
        clearTimeout(current.timeout);
        current.resolve(response);
        this.commands.setCurrentCommand(null);
        this.processQueue();
        return;
      }
      this.emit("warning", { type: "unknown_response", reqId });
    } catch {
      const err = new Error("Invalid response from server");
      this.emit("warning", { type: "malformed_frame" });
      this.commands.rejectAll(err);
      this.forceReconnect();
    }
  }
  handleClose() {
    const wasConnected = this.connected;
    this.connected = false;
    this.connecting = false;
    this.socket = null;
    this.health.stopPing();
    this.commands.rejectAll(new Error("Connection lost"));
    if (wasConnected) {
      this.emit("disconnected");
      if (this.reconnect.canReconnect()) {
        this.reconnect.scheduleReconnect(() => this.connect());
      }
    }
  }
  async ping() {
    if (!this.connected)
      return false;
    try {
      const start = Date.now();
      const response = await this.send({ cmd: "Ping" });
      const data = response.data;
      const success = data?.pong === true;
      if (success) {
        this.health.recordPingSuccess(Date.now() - start);
        this.emit("health", { type: "ping_success", latency: Date.now() - start });
      } else {
        this.handlePingFailure();
      }
      return success;
    } catch {
      this.handlePingFailure();
      return false;
    }
  }
  handlePingFailure() {
    if (this.health.recordPingFailure()) {
      this.emit("health", { type: "unhealthy", reason: "max_ping_failures" });
      this.forceReconnect();
    } else {
      this.emit("health", { type: "ping_failed" });
    }
  }
  handleCommandTimeout() {
    if (this.health.recordCommandTimeout()) {
      this.emit("health", { type: "unhealthy", reason: "max_command_timeouts" });
      this.forceReconnect();
    }
  }
  forceReconnect() {
    if (this.reconnect.isClosed())
      return;
    if (this.socket) {
      try {
        this.socket.end();
      } catch {}
      this.socket = null;
    }
    this.connected = false;
    this.health.stopPing();
    this.commands.rejectAll(new Error("Connection lost"));
    if (this.reconnect.canReconnect())
      this.reconnect.scheduleReconnect(() => this.connect());
  }
  getHealth() {
    return this.health.getHealth(this.getState());
  }
  generateReqId() {
    this.reqIdCounter = this.reqIdCounter + 1 & 2147483647;
    return String(this.reqIdCounter);
  }
  sendDirect(command) {
    if (!this.socket)
      return Promise.reject(new Error("Not connected"));
    const startTime = Date.now();
    this.health.recordCommandSent();
    const reqId = this.generateReqId();
    const commandWithReqId = { ...command, reqId };
    let pendingRef;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const removed = this.commands.removeByReqId(reqId);
        if (removed) {
          this.health.recordError();
          reject(new Error("Command timeout"));
        }
      }, this.options.commandTimeout);
      pendingRef = {
        id: 0,
        reqId,
        command: commandWithReqId,
        resolve: (result) => {
          this.health.recordSuccess(Date.now() - startTime);
          resolve(result);
        },
        reject: (err) => {
          this.health.recordError();
          reject(err);
        },
        timeout
      };
    });
    pendingRef.promise = promise;
    this.commands.addInFlight(pendingRef);
    this.socket.write(FrameParser.frame(pack(commandWithReqId)));
    return promise;
  }
  processQueue() {
    if (!this.connected || !this.socket)
      return;
    while (this.commands.hasPending() && this.commands.canSendMore(this.options.maxInFlight)) {
      const next = this.commands.dequeue();
      if (!next)
        break;
      clearTimeout(next.timeout);
      const newTimeout = setTimeout(() => {
        const removed = this.commands.removeByReqId(next.reqId);
        if (removed) {
          this.health.recordError();
          next.reject(new Error("Command timeout"));
          this.handleCommandTimeout();
        }
      }, this.options.commandTimeout);
      next.timeout = newTimeout;
      this.commands.addInFlight(next);
      this.socket.write(FrameParser.frame(pack(next.command)));
    }
  }
  async send(command) {
    const startTime = Date.now();
    this.health.recordCommandSent();
    const reqId = this.generateReqId();
    const commandWithReqId = { ...command, reqId };
    const id = this.commands.nextId();
    let pendingRef;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.commands.remove(id)) {
          this.health.recordError();
          reject(new Error("Command timeout"));
          return;
        }
        const removed = this.commands.removeByReqId(reqId);
        if (removed) {
          this.health.recordError();
          reject(new Error("Command timeout"));
          this.handleCommandTimeout();
        }
      }, this.options.commandTimeout);
      pendingRef = {
        id,
        reqId,
        command: commandWithReqId,
        resolve: (result) => {
          this.health.recordSuccess(Date.now() - startTime);
          resolve(result);
        },
        reject: (err) => {
          this.health.recordError();
          reject(err);
        },
        timeout
      };
    });
    pendingRef.promise = promise;
    this.commands.enqueue(pendingRef);
    if (!this.connected && !this.connecting) {
      this.connect().catch(() => {});
    } else if (this.connected) {
      this.processQueue();
    }
    return promise;
  }
  close() {
    this.reconnect.setClosed(true);
    this.health.stopPing();
    this.reconnect.cancelReconnect();
    installClientClosedFilter();
    this.commands.rejectAll(new ClientClosedError);
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;
    }
  }
  isConnected() {
    return this.connected;
  }
  getState() {
    if (this.reconnect.isClosed())
      return "closed";
    if (this.connected)
      return "connected";
    if (this.connecting)
      return "connecting";
    return "disconnected";
  }
  getInFlightCount() {
    return this.commands.getInFlightCount();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcp/shared.js
var sharedClients = new Map;
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/tcpPool.js
class TcpConnectionPool {
  clients = [];
  options;
  currentIndex = 0;
  closed = false;
  refCount = 0;
  poolKey = null;
  constructor(options = {}) {
    const poolSize = Math.max(1, options.poolSize ?? 4);
    this.options = {
      host: options.host ?? "localhost",
      port: options.port ?? 6789,
      token: options.token ?? "",
      tls: options.tls ?? false,
      poolSize,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      reconnectDelay: options.reconnectDelay ?? 100,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      connectTimeout: options.connectTimeout ?? 5000,
      commandTimeout: options.commandTimeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      pingInterval: options.pingInterval ?? 30000,
      maxPingFailures: options.maxPingFailures ?? 3,
      maxCommandTimeouts: options.maxCommandTimeouts ?? 3,
      pipelining: options.pipelining ?? true,
      maxInFlight: options.maxInFlight ?? 100
    };
    for (let i = 0;i < this.options.poolSize; i++) {
      const client = new TcpClient({
        host: this.options.host,
        port: this.options.port,
        token: this.options.token,
        tls: this.options.tls,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        reconnectDelay: this.options.reconnectDelay,
        maxReconnectDelay: this.options.maxReconnectDelay,
        connectTimeout: this.options.connectTimeout,
        commandTimeout: this.options.commandTimeout,
        autoReconnect: this.options.autoReconnect,
        pingInterval: this.options.pingInterval,
        maxPingFailures: this.options.maxPingFailures,
        maxCommandTimeouts: this.options.maxCommandTimeouts
      });
      client.on("error", () => {});
      this.clients.push(client);
    }
  }
  async connect() {
    await Promise.all(this.clients.map((c) => c.connect()));
  }
  getNextClient() {
    const len = this.clients.length;
    for (let i = 0;i < len; i++) {
      const idx = (this.currentIndex + i) % len;
      const client2 = this.clients[idx];
      if (client2.isConnected()) {
        this.currentIndex = (idx + 1) % len;
        return client2;
      }
    }
    const client = this.clients[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % len;
    return client;
  }
  async send(command) {
    if (this.closed) {
      throw new Error("Connection pool is closed");
    }
    return this.getNextClient().send(command);
  }
  async sendParallel(commands) {
    if (this.closed) {
      throw new Error("Connection pool is closed");
    }
    const promises = commands.map((cmd, i) => {
      const client = this.clients[i % this.clients.length];
      return client.send(cmd);
    });
    return Promise.all(promises);
  }
  onReconnect(cb) {
    for (const client of this.clients) {
      client.on("connected", cb);
    }
  }
  isConnected() {
    return this.clients.some((c) => c.isConnected());
  }
  getConnectedCount() {
    return this.clients.filter((c) => c.isConnected()).length;
  }
  getPoolSize() {
    return this.clients.length;
  }
  addRef() {
    this.refCount++;
  }
  release() {
    this.refCount--;
    if (this.refCount <= 0) {
      this.close();
    }
  }
  setPoolKey(key) {
    this.poolKey = key;
  }
  close() {
    if (this.closed)
      return;
    this.closed = true;
    if (this.poolKey) {
      sharedPools.delete(this.poolKey);
      this.poolKey = null;
    }
    for (const client of this.clients) {
      client.close();
    }
    this.clients.length = 0;
  }
  isClosed() {
    return this.closed;
  }
  getHealth() {
    const clientHealths = this.clients.map((c) => c.getHealth());
    const connectedCount = clientHealths.filter((h) => h.state === "connected").length;
    const healthyCount = clientHealths.filter((h) => h.healthy).length;
    const totalCommands = clientHealths.reduce((sum, h) => sum + h.totalCommands, 0);
    const totalErrors = clientHealths.reduce((sum, h) => sum + h.totalErrors, 0);
    const latencies = clientHealths.filter((h) => h.avgLatencyMs > 0).map((h) => h.avgLatencyMs);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    return {
      healthy: healthyCount > 0,
      connectedCount,
      totalCount: this.clients.length,
      clients: clientHealths,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      totalCommands,
      totalErrors
    };
  }
}
var sharedPools = new Map;
function getPoolKey(options) {
  const host = options?.host ?? "localhost";
  const port = options?.port ?? 6789;
  const poolSize = options?.poolSize ?? 4;
  const token = options?.token ?? "";
  const tokenHash = token ? String(Number(Bun.hash(token)) & 65535) : "0";
  const tlsKey = options?.tls ? JSON.stringify(options.tls) : "0";
  return `${host}:${port}:${poolSize}:${tokenHash}:${tlsKey}`;
}
function getSharedPool(options) {
  const key = getPoolKey(options);
  let pool = sharedPools.get(key);
  if (pool && !pool.isClosed()) {
    pool.addRef();
    return pool;
  }
  if (pool) {
    sharedPools.delete(key);
  }
  pool = new TcpConnectionPool(options);
  pool.setPoolKey(key);
  sharedPools.set(key, pool);
  pool.addRef();
  return pool;
}
function releaseSharedPool(pool) {
  pool.release();
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/hash.js
var FNV_PRIME = 16777619;
var FNV_OFFSET = 2166136261;
function fnv1a(str) {
  let hash = FNV_OFFSET;
  for (let i = 0;i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
function calculateShardCount() {
  const cores = navigator.hardwareConcurrency || 4;
  let shards = 1;
  while (shards < cores && shards < 64) {
    shards *= 2;
  }
  return shards;
}
var SHARD_COUNT = calculateShardCount();
var SHARD_MASK = SHARD_COUNT - 1;
function shardIndex(key) {
  return fnv1a(key) & SHARD_MASK;
}
function processingShardIndex(jobId) {
  return fnv1a(jobId) & SHARD_MASK;
}
function uuid() {
  return Bun.randomUUIDv7();
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/helpers.js
var FORCE_EMBEDDED = Bun.env.BUNQUEUE_EMBEDDED === "1";
function getShards(manager) {
  return manager.shards;
}
function getShard(manager, queue) {
  const idx = shardIndex(queue);
  return getShards(manager)[idx];
}
function getDlqContext(manager) {
  return {
    shards: getShards(manager),
    jobIndex: manager.getJobIndex()
  };
}
function toDomainFilter(filter) {
  if (!filter)
    return;
  return filter;
}
function toDomainDlqConfig(config) {
  return config;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/addBatcher.js
class AddBatcher {
  maxPending;
  pending = [];
  timer = null;
  config;
  flushCb;
  stopped = false;
  flushing = false;
  inFlightFlushes = new Set;
  constructor(config, flushCb) {
    this.config = config;
    this.maxPending = config.maxPending ?? 1e4;
    this.flushCb = flushCb;
  }
  enqueue(name, data, opts) {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new Error("AddBatcher stopped"));
        return;
      }
      if (this.pending.length >= this.maxPending) {
        const dropped = this.pending.splice(0, Math.floor(this.maxPending * 0.1));
        for (const entry of dropped) {
          entry.reject(new Error("Add buffer overflow - oldest entries dropped"));
        }
      }
      this.pending.push({ name, data, opts, resolve, reject });
      if (this.pending.length >= this.config.maxSize) {
        this.triggerFlush();
      } else if (!this.flushing) {
        this.triggerFlush();
      } else {
        this.timer ??= setTimeout(() => {
          this.timer = null;
          this.triggerFlush();
        }, this.config.maxDelayMs);
      }
    });
  }
  triggerFlush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const flushPromise = this.doFlush().catch((err) => {
      console.error("[bunqueue] Flush failed:", err instanceof Error ? err.message : String(err));
    });
    this.inFlightFlushes.add(flushPromise);
    flushPromise.finally(() => this.inFlightFlushes.delete(flushPromise));
  }
  async doFlush() {
    if (this.pending.length === 0)
      return;
    this.flushing = true;
    try {
      while (this.pending.length > 0 && !this.stopped) {
        await this.flushOnce();
      }
    } finally {
      this.flushing = false;
    }
  }
  async flush() {
    await this.doFlush();
  }
  async flushOnce() {
    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length === 0)
      return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      const jobs = await this.flushCb(batch.map((entry) => ({ name: entry.name, data: entry.data, opts: entry.opts })));
      for (let i = 0;i < batch.length; i++) {
        batch[i].resolve(jobs[i]);
      }
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      for (const entry of batch) {
        entry.reject(error2);
      }
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const error2 = new Error("AddBatcher stopped");
    const remaining = this.pending.splice(0, this.pending.length);
    for (const entry of remaining) {
      entry.reject(error2);
    }
  }
  async waitForInFlight() {
    if (this.inFlightFlushes.size === 0)
      return;
    await Promise.all(this.inFlightFlushes);
  }
  hasPending() {
    return this.pending.length > 0;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/forwarder.js
import { EventEmitter as EventEmitter4 } from "events";

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/worker.js
import { EventEmitter as EventEmitter3 } from "events";
import { hostname } from "os";

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/job.js
function jobId(id) {
  return id;
}
function generateJobId() {
  return Bun.randomUUIDv7();
}
var DEFAULT_MAX_BACKOFF = 3600000;
var MAX_TIMELINE_ENTRIES = 20;
var JOB_DEFAULTS = {
  priority: 0,
  maxAttempts: 3,
  backoff: 1000,
  lifo: false,
  removeOnComplete: false,
  removeOnFail: false,
  stackTraceLimit: 10
};
function parseBackoff(input) {
  if (typeof input === "object") {
    return {
      backoff: input.delay,
      backoffConfig: { type: input.type, delay: input.delay }
    };
  }
  return { backoff: input ?? JOB_DEFAULTS.backoff, backoffConfig: null };
}
function parseRepeatConfig(repeat) {
  if (!repeat)
    return null;
  return {
    every: repeat.every,
    limit: repeat.limit,
    pattern: repeat.pattern,
    count: repeat.count ?? 0,
    startDate: repeat.startDate,
    endDate: repeat.endDate,
    tz: repeat.tz,
    immediately: repeat.immediately,
    prevMillis: repeat.prevMillis,
    offset: repeat.offset,
    jobId: repeat.jobId
  };
}
function toBoolean(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}
function parseCoreOptions(input) {
  return {
    priority: input.priority ?? JOB_DEFAULTS.priority,
    lifo: input.lifo ?? JOB_DEFAULTS.lifo,
    maxAttempts: input.maxAttempts ?? JOB_DEFAULTS.maxAttempts,
    removeOnComplete: toBoolean(input.removeOnComplete, JOB_DEFAULTS.removeOnComplete),
    removeOnFail: toBoolean(input.removeOnFail, JOB_DEFAULTS.removeOnFail)
  };
}
function parseOptionalFields(input) {
  return {
    ttl: input.ttl ?? null,
    timeout: input.timeout ?? null,
    uniqueKey: input.uniqueKey ?? null,
    customId: input.customId ?? null,
    parentId: input.parentId ?? null,
    groupId: input.groupId ?? null,
    stallTimeout: input.stallTimeout ?? null
  };
}
function parseBullMQV5Options(input) {
  return {
    stackTraceLimit: input.stackTraceLimit ?? JOB_DEFAULTS.stackTraceLimit,
    keepLogs: input.keepLogs ?? null,
    sizeLimit: input.sizeLimit ?? null,
    failParentOnFailure: input.failParentOnFailure ?? false,
    removeDependencyOnFailure: input.removeDependencyOnFailure ?? false,
    continueParentOnFailure: input.continueParentOnFailure ?? false,
    ignoreDependencyOnFailure: input.ignoreDependencyOnFailure ?? false,
    deduplicationTtl: input.dedup?.ttl ?? null,
    deduplicationExtend: input.dedup?.extend ?? false,
    deduplicationReplace: input.dedup?.replace ?? false,
    debounceId: input.debounceId ?? null,
    debounceTtl: input.debounceTtl ?? null
  };
}
function createJob(id, queue, input, now = Date.now()) {
  const { backoff, backoffConfig } = parseBackoff(input.backoff);
  const coreOpts = parseCoreOptions(input);
  const optionalFields = parseOptionalFields(input);
  const v5Opts = parseBullMQV5Options(input);
  const createdAt = input.timestamp ?? now;
  return {
    id,
    queue,
    data: input.data,
    createdAt,
    runAt: createdAt + (input.delay ?? 0),
    startedAt: null,
    completedAt: null,
    attempts: 0,
    backoff,
    backoffConfig,
    dependsOn: input.dependsOn ?? [],
    childrenIds: input.childrenIds ?? [],
    childrenCompleted: 0,
    tags: input.tags ?? [],
    progress: 0,
    progressMessage: null,
    stacktrace: null,
    repeat: parseRepeatConfig(input.repeat),
    lastHeartbeat: createdAt,
    stallCount: 0,
    ...coreOpts,
    ...optionalFields,
    ...v5Opts,
    timeline: []
  };
}
function normalizeStacktrace(lines, limit) {
  if (!lines || lines.length === 0)
    return null;
  const out = [];
  for (const line of lines) {
    if (out.length >= limit)
      break;
    if (typeof line !== "string")
      continue;
    const trimmed = line.trim();
    if (trimmed)
      out.push(trimmed);
  }
  return out.length > 0 ? out : null;
}
function isReady(job, now = Date.now()) {
  return job.runAt <= now;
}
function isExpired(job, now = Date.now()) {
  if (job.ttl === null)
    return false;
  return now > job.createdAt + job.ttl;
}
function calculateBackoff(job) {
  const maxDelay = job.backoffConfig?.maxDelay ?? DEFAULT_MAX_BACKOFF;
  if (job.backoffConfig) {
    if (job.backoffConfig.type === "fixed") {
      const base2 = job.backoffConfig.delay;
      const jittered2 = base2 * (0.8 + Math.random() * 0.4);
      return Math.min(jittered2, maxDelay);
    } else {
      const base2 = job.backoffConfig.delay * Math.pow(2, job.attempts);
      const jittered2 = base2 * (0.5 + Math.random());
      return Math.min(jittered2, maxDelay);
    }
  }
  const base = job.backoff * Math.pow(2, job.attempts);
  const jittered = base * (0.5 + Math.random());
  return Math.min(jittered, maxDelay);
}
function canRetry(job) {
  return job.attempts < job.maxAttempts;
}
function generateLockToken() {
  return Bun.randomUUIDv7();
}
var DEFAULT_LOCK_TTL = 30000;
function createJobLock(jobId2, owner, ttl = DEFAULT_LOCK_TTL, now = Date.now()) {
  return {
    jobId: jobId2,
    token: generateLockToken(),
    owner,
    createdAt: now,
    expiresAt: now + ttl,
    lastRenewalAt: now,
    renewalCount: 0,
    ttl
  };
}
function isLockExpired(lock, now = Date.now()) {
  return now >= lock.expiresAt;
}
function renewLock(lock, newTtl, now = Date.now()) {
  const ttl = newTtl ?? lock.ttl;
  lock.expiresAt = now + ttl;
  lock.lastRenewalAt = now;
  lock.renewalCount++;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/priorityQueue.js
function compareEntries(a, b) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.lifo && b.lifo) {
    if (b.jobId > a.jobId)
      return 1;
    if (b.jobId < a.jobId)
      return -1;
    return 0;
  }
  if (a.runAt !== b.runAt) {
    return a.runAt - b.runAt;
  }
  if (a.jobId < b.jobId)
    return -1;
  if (a.jobId > b.jobId)
    return 1;
  return 0;
}

class IndexedPriorityQueue {
  static D = 4;
  heap = [];
  index = new Map;
  generation = 0n;
  get size() {
    return this.index.size;
  }
  get isEmpty() {
    return this.index.size === 0;
  }
  push(job) {
    const gen = this.generation++;
    this.index.set(job.id, { job, generation: gen });
    const entry = {
      jobId: job.id,
      priority: job.priority,
      runAt: job.runAt,
      lifo: job.lifo,
      generation: gen
    };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }
  pop() {
    while (this.heap.length > 0) {
      const entry = this.heap[0];
      const indexed = this.index.get(entry.jobId);
      if (indexed?.generation !== entry.generation) {
        this.removeTop();
        continue;
      }
      this.removeTop();
      this.index.delete(entry.jobId);
      return indexed.job;
    }
    return null;
  }
  peek() {
    while (this.heap.length > 0) {
      const entry = this.heap[0];
      const indexed = this.index.get(entry.jobId);
      if (indexed?.generation !== entry.generation) {
        this.removeTop();
        continue;
      }
      return indexed.job;
    }
    return null;
  }
  find(jobId2) {
    return this.index.get(jobId2)?.job ?? null;
  }
  has(jobId2) {
    return this.index.has(jobId2);
  }
  remove(jobId2) {
    const indexed = this.index.get(jobId2);
    if (!indexed)
      return null;
    this.index.delete(jobId2);
    return indexed.job;
  }
  updatePriority(jobId2, newPriority, newLifo) {
    const indexed = this.index.get(jobId2);
    if (!indexed)
      return false;
    const lifo = newLifo ?? indexed.job.lifo;
    const updatedJob = {
      ...indexed.job,
      priority: newPriority,
      lifo
    };
    const gen = this.generation++;
    this.index.set(jobId2, { job: updatedJob, generation: gen });
    const entry = {
      jobId: updatedJob.id,
      priority: newPriority,
      runAt: updatedJob.runAt,
      lifo,
      generation: gen
    };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
    return true;
  }
  updateRunAt(jobId2, newRunAt) {
    const indexed = this.index.get(jobId2);
    if (!indexed)
      return false;
    const updatedJob = {
      ...indexed.job,
      runAt: newRunAt
    };
    const gen = this.generation++;
    this.index.set(jobId2, { job: updatedJob, generation: gen });
    const entry = {
      jobId: updatedJob.id,
      priority: updatedJob.priority,
      runAt: newRunAt,
      lifo: updatedJob.lifo,
      generation: gen
    };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
    return true;
  }
  values() {
    return Array.from(this.index.values()).map((v) => v.job);
  }
  clear() {
    this.heap = [];
    this.index.clear();
    this.generation = 0n;
  }
  getStaleRatio() {
    if (this.heap.length === 0)
      return 0;
    return 1 - this.index.size / this.heap.length;
  }
  compact() {
    if (this.heap.length === 0)
      return;
    const validEntries = [];
    for (const entry of this.heap) {
      const indexed = this.index.get(entry.jobId);
      if (indexed?.generation === entry.generation) {
        validEntries.push(entry);
      }
    }
    this.heap = validEntries;
    this.heapify();
  }
  heapify() {
    const D = IndexedPriorityQueue.D;
    for (let i = Math.floor((this.heap.length - 2) / D);i >= 0; i--) {
      this.bubbleDown(i);
    }
  }
  needsCompaction(threshold = 0.2) {
    return this.getStaleRatio() > threshold;
  }
  removeTop() {
    if (this.heap.length <= 1) {
      this.heap.pop();
      return;
    }
    this.heap[0] = this.heap.pop();
    this.bubbleDown(0);
  }
  bubbleUp(idx) {
    const D = IndexedPriorityQueue.D;
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / D);
      if (compareEntries(this.heap[idx], this.heap[parentIdx]) >= 0) {
        break;
      }
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }
  bubbleDown(idx) {
    const D = IndexedPriorityQueue.D;
    const length = this.heap.length;
    const heap = this.heap;
    while (true) {
      const firstChild = D * idx + 1;
      if (firstChild >= length)
        break;
      let smallest = idx;
      const lastChild = Math.min(firstChild + D, length);
      for (let c = firstChild;c < lastChild; c++) {
        if (compareEntries(heap[c], heap[smallest]) < 0) {
          smallest = c;
        }
      }
      if (smallest === idx)
        break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }
  swap(i, j) {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/deduplication.js
function isUniqueKeyExpired(entry, now = Date.now()) {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}
function calculateExpiration(ttl, now = Date.now()) {
  return ttl !== undefined ? now + ttl : null;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/uniqueKeyManager.js
class UniqueKeyManager {
  keys = new Map;
  isAvailable(queue, key) {
    const entry = this.keys.get(queue)?.get(key);
    if (!entry)
      return true;
    if (isUniqueKeyExpired(entry)) {
      this.keys.get(queue)?.delete(key);
      return true;
    }
    return false;
  }
  getEntry(queue, key) {
    const entry = this.keys.get(queue)?.get(key);
    if (!entry)
      return null;
    if (isUniqueKeyExpired(entry)) {
      this.keys.get(queue)?.delete(key);
      return null;
    }
    return entry;
  }
  register(queue, key, jobId2) {
    this.registerWithTtl(queue, key, jobId2, undefined);
  }
  registerWithTtl(queue, key, jobId2, ttl) {
    let queueKeys = this.keys.get(queue);
    if (!queueKeys) {
      queueKeys = new Map;
      this.keys.set(queue, queueKeys);
    }
    const now = Date.now();
    queueKeys.set(key, {
      jobId: jobId2,
      expiresAt: calculateExpiration(ttl, now),
      registeredAt: now
    });
  }
  extendTtl(queue, key, ttl) {
    const entry = this.keys.get(queue)?.get(key);
    if (!entry)
      return false;
    entry.expiresAt = calculateExpiration(ttl);
    return true;
  }
  release(queue, key) {
    this.keys.get(queue)?.delete(key);
  }
  cleanExpired() {
    let cleaned = 0;
    const now = Date.now();
    for (const [_queue, queueKeys] of this.keys) {
      for (const [key, entry] of queueKeys) {
        if (isUniqueKeyExpired(entry, now)) {
          queueKeys.delete(key);
          cleaned++;
        }
      }
    }
    return cleaned;
  }
  clearQueue(queue) {
    this.keys.delete(queue);
  }
  getMap() {
    return this.keys;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/dlq.js
var DEFAULT_DLQ_CONFIG = {
  autoRetry: false,
  autoRetryInterval: 60 * 60 * 1000,
  maxAutoRetries: 3,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  maxEntries: 1e4
};
function createDlqEntry(job, reason, error2, config = DEFAULT_DLQ_CONFIG) {
  const now = Date.now();
  const attemptRecord = {
    attempt: job.attempts,
    startedAt: job.startedAt ?? job.createdAt,
    failedAt: now,
    reason,
    error: error2,
    duration: job.startedAt ? now - job.startedAt : 0
  };
  return {
    job,
    enteredAt: now,
    reason,
    error: error2,
    attempts: [attemptRecord],
    retryCount: 0,
    lastRetryAt: null,
    nextRetryAt: config.autoRetry ? now + config.autoRetryInterval : null,
    expiresAt: config.maxAge ? now + config.maxAge : null
  };
}
function isDlqEntryExpired(entry, now = Date.now()) {
  return entry.expiresAt !== null && now >= entry.expiresAt;
}
function canAutoRetry(entry, config, now = Date.now()) {
  if (!config.autoRetry)
    return false;
  if (entry.retryCount >= config.maxAutoRetries)
    return false;
  if (entry.nextRetryAt === null)
    return false;
  return now >= entry.nextRetryAt;
}
function scheduleNextRetry(entry, config) {
  const now = Date.now();
  entry.retryCount++;
  entry.lastRetryAt = now;
  if (entry.retryCount < config.maxAutoRetries) {
    const backoffMultiplier = Math.pow(2, entry.retryCount - 1);
    entry.nextRetryAt = now + config.autoRetryInterval * backoffMultiplier;
  } else {
    entry.nextRetryAt = null;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/stall.js
var DEFAULT_STALL_CONFIG = {
  enabled: true,
  stallInterval: 30000,
  maxStalls: 3,
  gracePeriod: 5000
};
function checkStall(job, config = DEFAULT_STALL_CONFIG, now = Date.now()) {
  if (job.startedAt === null) {
    return {
      isStalled: false,
      stalledFor: 0,
      shouldMoveToDlq: false,
      newStallCount: job.stallCount
    };
  }
  if (now - job.startedAt < config.gracePeriod) {
    return {
      isStalled: false,
      stalledFor: 0,
      shouldMoveToDlq: false,
      newStallCount: job.stallCount
    };
  }
  const stallInterval = job.stallTimeout ?? config.stallInterval;
  const stalledFor = now - job.lastHeartbeat;
  const isStalled = stalledFor > stallInterval;
  if (!isStalled) {
    return {
      isStalled: false,
      stalledFor,
      shouldMoveToDlq: false,
      newStallCount: job.stallCount
    };
  }
  const newStallCount = job.stallCount + 1;
  const shouldMoveToDlq = newStallCount >= config.maxStalls;
  return {
    isStalled: true,
    stalledFor,
    shouldMoveToDlq,
    newStallCount
  };
}
function getStallAction(job, config = DEFAULT_STALL_CONFIG, now = Date.now()) {
  const result = checkStall(job, config, now);
  if (!result.isStalled) {
    return "keep";
  }
  if (result.shouldMoveToDlq) {
    return "move_to_dlq";
  }
  return "retry";
}
function incrementStallCount(job) {
  job.stallCount++;
  return job.stallCount;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/dlqShard.js
class DlqShard {
  dlq = new Map;
  dlqConfig = new Map;
  stallConfig = new Map;
  stats;
  constructor(stats) {
    this.stats = stats;
  }
  getConfig(queue) {
    return this.dlqConfig.get(queue) ?? DEFAULT_DLQ_CONFIG;
  }
  setConfig(queue, config) {
    const current = this.getConfig(queue);
    this.dlqConfig.set(queue, { ...current, ...config });
  }
  getStallConfig(queue) {
    return this.stallConfig.get(queue) ?? DEFAULT_STALL_CONFIG;
  }
  setStallConfig(queue, config) {
    const current = this.getStallConfig(queue);
    this.stallConfig.set(queue, { ...current, ...config });
  }
  add(job, reason = "unknown", error2 = null) {
    let entries = this.dlq.get(job.queue);
    if (!entries) {
      entries = [];
      this.dlq.set(job.queue, entries);
    }
    const config = this.getConfig(job.queue);
    const entry = createDlqEntry(job, reason, error2, config);
    while (entries.length >= config.maxEntries) {
      entries.shift();
      this.stats.decrementDlq();
    }
    entries.push(entry);
    this.stats.incrementDlq();
    return entry;
  }
  restoreEntry(queue, entry) {
    let entries = this.dlq.get(queue);
    if (!entries) {
      entries = [];
      this.dlq.set(queue, entries);
    }
    const config = this.getConfig(queue);
    while (entries.length >= config.maxEntries) {
      entries.shift();
      this.stats.decrementDlq();
    }
    entries.push(entry);
    this.stats.incrementDlq();
  }
  getEntries(queue) {
    return this.dlq.get(queue) ?? [];
  }
  getJobs(queue, count) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return [];
    const slice = count ? entries.slice(0, count) : entries;
    return slice.map((e) => e.job);
  }
  getFiltered(queue, filter) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return [];
    const now = Date.now();
    let result = entries.filter((entry) => {
      if (filter.reason && entry.reason !== filter.reason)
        return false;
      if (filter.olderThan && entry.enteredAt > filter.olderThan)
        return false;
      if (filter.newerThan && entry.enteredAt < filter.newerThan)
        return false;
      if (filter.retriable && !canAutoRetry(entry, this.getConfig(queue), now))
        return false;
      if (filter.expired && !isDlqEntryExpired(entry, now))
        return false;
      return true;
    });
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  }
  remove(queue, jobId2) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return null;
    const idx = entries.findIndex((e) => e.job.id === jobId2);
    if (idx === -1)
      return null;
    this.stats.decrementDlq();
    return entries.splice(idx, 1)[0];
  }
  getAutoRetryEntries(queue, now = Date.now()) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return [];
    const config = this.getConfig(queue);
    return entries.filter((entry) => canAutoRetry(entry, config, now));
  }
  getExpiredEntries(queue, now = Date.now()) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return [];
    return entries.filter((entry) => isDlqEntryExpired(entry, now));
  }
  purgeExpired(queue, now = Date.now()) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return 0;
    const before = entries.length;
    const remaining = entries.filter((entry) => !isDlqEntryExpired(entry, now));
    if (remaining.length < before) {
      this.dlq.set(queue, remaining);
      const removed = before - remaining.length;
      this.stats.decrementDlq(removed);
      return removed;
    }
    return 0;
  }
  clear(queue) {
    const entries = this.dlq.get(queue);
    if (!entries)
      return 0;
    const count = entries.length;
    this.dlq.delete(queue);
    this.stats.decrementDlq(count);
    return count;
  }
  getCount(queue) {
    return this.dlq.get(queue)?.length ?? 0;
  }
  getQueueNames() {
    return Array.from(this.dlq.keys());
  }
  deleteQueue(queue) {
    const entries = this.dlq.get(queue);
    const count = entries?.length ?? 0;
    this.dlq.delete(queue);
    this.dlqConfig.delete(queue);
    this.stallConfig.delete(queue);
    return count;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/queue.js
function createQueueState(name) {
  return {
    name,
    paused: false,
    rateLimit: null,
    concurrencyLimit: null,
    activeCount: 0
  };
}

class RateLimiter {
  capacity;
  refillRate;
  tokens;
  lastRefill;
  constructor(capacity, refillRate = capacity) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  tryAcquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
  getTokens() {
    this.refill();
    return this.tokens;
  }
}

class ConcurrencyLimiter {
  limit;
  active = 0;
  constructor(limit) {
    this.limit = limit;
  }
  tryAcquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return true;
    }
    return false;
  }
  release() {
    if (this.active > 0) {
      this.active -= 1;
    }
  }
  getActive() {
    return this.active;
  }
  getLimit() {
    return this.limit;
  }
  setLimit(limit) {
    this.limit = limit;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/limiterManager.js
class LimiterManager {
  queueState = new Map;
  rateLimiters = new Map;
  concurrencyLimiters = new Map;
  getState(name) {
    let state = this.queueState.get(name);
    if (!state) {
      state = createQueueState(name);
      this.queueState.set(name, state);
    }
    return state;
  }
  isPaused(name) {
    return this.queueState.get(name)?.paused ?? false;
  }
  pause(name) {
    this.getState(name).paused = true;
  }
  resume(name) {
    this.getState(name).paused = false;
  }
  setRateLimit(queue, limit) {
    this.rateLimiters.set(queue, new RateLimiter(limit));
    this.getState(queue).rateLimit = limit;
  }
  clearRateLimit(queue) {
    this.rateLimiters.delete(queue);
    const state = this.queueState.get(queue);
    if (state)
      state.rateLimit = null;
  }
  tryAcquireRateLimit(queue) {
    const limiter = this.rateLimiters.get(queue);
    return !limiter || limiter.tryAcquire();
  }
  setConcurrency(queue, limit) {
    let limiter = this.concurrencyLimiters.get(queue);
    if (limiter) {
      limiter.setLimit(limit);
    } else {
      limiter = new ConcurrencyLimiter(limit);
      this.concurrencyLimiters.set(queue, limiter);
    }
    this.getState(queue).concurrencyLimit = limit;
  }
  clearConcurrency(queue) {
    this.concurrencyLimiters.delete(queue);
    const state = this.queueState.get(queue);
    if (state)
      state.concurrencyLimit = null;
  }
  tryAcquireConcurrency(queue) {
    const limiter = this.concurrencyLimiters.get(queue);
    return !limiter || limiter.tryAcquire();
  }
  releaseConcurrency(queue) {
    this.concurrencyLimiters.get(queue)?.release();
  }
  getQueueNames() {
    return Array.from(this.queueState.keys());
  }
  deleteQueue(queue) {
    this.queueState.delete(queue);
    this.rateLimiters.delete(queue);
    this.concurrencyLimiters.delete(queue);
  }
  getStateMap() {
    return this.queueState;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/dependencyTracker.js
class DependencyTracker {
  waitingDeps = new Map;
  dependencyIndex = new Map;
  waitingChildren = new Map;
  registerDependencies(jobId2, dependsOn) {
    for (const depId of dependsOn) {
      let waiters = this.dependencyIndex.get(depId);
      if (!waiters) {
        waiters = new Set;
        this.dependencyIndex.set(depId, waiters);
      }
      waiters.add(jobId2);
    }
  }
  unregisterDependencies(jobId2, dependsOn) {
    for (const depId of dependsOn) {
      const waiters = this.dependencyIndex.get(depId);
      if (waiters) {
        waiters.delete(jobId2);
        if (waiters.size === 0) {
          this.dependencyIndex.delete(depId);
        }
      }
    }
  }
  getJobsWaitingFor(depId) {
    return this.dependencyIndex.get(depId);
  }
  addWaitingJob(job) {
    this.waitingDeps.set(job.id, job);
    if (job.dependsOn && job.dependsOn.length > 0) {
      this.registerDependencies(job.id, job.dependsOn);
    }
  }
  removeWaitingJob(jobId2) {
    const job = this.waitingDeps.get(jobId2);
    if (job) {
      this.waitingDeps.delete(jobId2);
      if (job.dependsOn && job.dependsOn.length > 0) {
        this.unregisterDependencies(jobId2, job.dependsOn);
      }
    }
    return job;
  }
  getWaitingJob(jobId2) {
    return this.waitingDeps.get(jobId2);
  }
  isWaiting(jobId2) {
    return this.waitingDeps.has(jobId2);
  }
  addWaitingParent(job) {
    this.waitingChildren.set(job.id, job);
  }
  removeWaitingParent(jobId2) {
    const job = this.waitingChildren.get(jobId2);
    if (job) {
      this.waitingChildren.delete(jobId2);
    }
    return job;
  }
  getWaitingParent(jobId2) {
    return this.waitingChildren.get(jobId2);
  }
  isParentWaiting(jobId2) {
    return this.waitingChildren.has(jobId2);
  }
  getCounts() {
    return {
      waitingDeps: this.waitingDeps.size,
      dependencyIndex: this.dependencyIndex.size,
      waitingChildren: this.waitingChildren.size
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/skipList.js
function createHead(maxLevel) {
  const forward = [];
  for (let i = 0;i <= maxLevel; i++) {
    forward.push(null);
  }
  return {
    value: null,
    forward
  };
}

class SkipList {
  maxLevel;
  probability;
  compare;
  equals;
  head;
  level = 0;
  _size = 0;
  constructor(compare, maxLevel = 16, probability = 0.5, equals) {
    this.compare = compare;
    this.maxLevel = maxLevel;
    this.probability = probability;
    this.equals = equals;
    this.head = createHead(maxLevel);
  }
  get size() {
    return this._size;
  }
  get isEmpty() {
    return this._size === 0;
  }
  randomLevel() {
    let lvl = 0;
    while (Math.random() < this.probability && lvl < this.maxLevel) {
      lvl++;
    }
    return lvl;
  }
  insert(value) {
    const update = [];
    for (let i = 0;i <= this.maxLevel; i++) {
      update.push(null);
    }
    let current = this.head;
    for (let i = this.level;i >= 0; i--) {
      let fwd = current.forward[i];
      while (fwd !== null && this.compare(fwd.value, value) < 0) {
        current = fwd;
        fwd = current.forward[i];
      }
      update[i] = current;
    }
    if (this.equals) {
      let node = current.forward[0];
      while (node !== null && this.compare(node.value, value) === 0) {
        if (this.equals(node.value, value)) {
          return false;
        }
        node = node.forward[0];
      }
    }
    const newLevel = this.randomLevel();
    if (newLevel > this.level) {
      for (let i = this.level + 1;i <= newLevel; i++) {
        update[i] = this.head;
      }
      this.level = newLevel;
    }
    const newNodeForward = [];
    for (let i = 0;i <= newLevel; i++) {
      newNodeForward.push(null);
    }
    const newNode = {
      value,
      forward: newNodeForward
    };
    for (let i = 0;i <= newLevel; i++) {
      const updateNode = update[i];
      if (updateNode) {
        newNode.forward[i] = updateNode.forward[i];
        updateNode.forward[i] = newNode;
      }
    }
    this._size++;
    return true;
  }
  delete(value) {
    const update = [];
    for (let i = 0;i <= this.maxLevel; i++) {
      update.push(null);
    }
    let current = this.head;
    for (let i = this.level;i >= 0; i--) {
      let fwd = current.forward[i];
      while (fwd !== null && this.compare(fwd.value, value) < 0) {
        current = fwd;
        fwd = current.forward[i];
      }
      update[i] = current;
    }
    const target2 = current.forward[0];
    if (target2 === null || this.compare(target2.value, value) !== 0) {
      return false;
    }
    for (let i = 0;i <= this.level; i++) {
      const updateNode = update[i];
      if (updateNode?.forward[i] === target2) {
        updateNode.forward[i] = target2.forward[i];
      } else {
        break;
      }
    }
    while (this.level > 0 && this.head.forward[this.level] === null) {
      this.level--;
    }
    this._size--;
    return true;
  }
  deleteWhere(predicate) {
    let current = this.head.forward[0];
    while (current !== null) {
      if (predicate(current.value)) {
        this.delete(current.value);
        return current.value;
      }
      current = current.forward[0];
    }
    return null;
  }
  find(value) {
    let current = this.head;
    for (let i = this.level;i >= 0; i--) {
      let fwd = current.forward[i];
      while (fwd !== null && this.compare(fwd.value, value) < 0) {
        current = fwd;
        fwd = current.forward[i];
      }
    }
    const target2 = current.forward[0];
    if (target2 !== null && this.compare(target2.value, value) === 0) {
      return target2.value;
    }
    return null;
  }
  has(value) {
    return this.find(value) !== null;
  }
  first() {
    return this.head.forward[0]?.value ?? null;
  }
  shift() {
    const first = this.head.forward[0];
    if (first === null)
      return null;
    this.delete(first.value);
    return first.value;
  }
  rangeUntil(maxValue, limit) {
    const result = [];
    let current = this.head.forward[0];
    while (current !== null && this.compare(current.value, maxValue) <= 0) {
      result.push(current.value);
      if (limit !== undefined && result.length >= limit)
        break;
      current = current.forward[0];
    }
    return result;
  }
  takeWhile(predicate, limit) {
    const result = [];
    let current = this.head.forward[0];
    while (current !== null && predicate(current.value)) {
      result.push(current.value);
      if (limit !== undefined && result.length >= limit)
        break;
      current = current.forward[0];
    }
    return result;
  }
  *values() {
    let current = this.head.forward[0];
    while (current !== null) {
      yield current.value;
      current = current.forward[0];
    }
  }
  toArray() {
    return Array.from(this.values());
  }
  clear() {
    this.head = createHead(this.maxLevel);
    this.level = 0;
    this._size = 0;
  }
  removeAll(predicate) {
    const removed = [];
    let current = this.head.forward[0];
    while (current !== null) {
      const next = current.forward[0];
      if (predicate(current.value)) {
        removed.push(current.value);
        this.delete(current.value);
      }
      current = next;
    }
    return removed;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/minHeap.js
class MinHeap {
  heap = [];
  compare;
  static D = 4;
  constructor(compare) {
    this.compare = compare;
  }
  get size() {
    return this.heap.length;
  }
  get isEmpty() {
    return this.heap.length === 0;
  }
  push(item) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }
  pop() {
    if (this.heap.length === 0)
      return;
    if (this.heap.length === 1)
      return this.heap.pop();
    const min = this.heap[0];
    const last = this.heap.pop();
    if (last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return min;
  }
  peek() {
    return this.heap[0];
  }
  clear() {
    this.heap = [];
  }
  toArray() {
    return [...this.heap];
  }
  buildFrom(items) {
    this.heap = [...items];
    const D = MinHeap.D;
    for (let i = Math.floor((this.heap.length - 2) / D);i >= 0; i--) {
      this.bubbleDown(i);
    }
  }
  removeWhere(predicate) {
    const idx = this.heap.findIndex(predicate);
    if (idx === -1)
      return;
    const item = this.heap[idx];
    if (idx === this.heap.length - 1) {
      this.heap.pop();
    } else {
      const last = this.heap.pop();
      if (last !== undefined) {
        this.heap[idx] = last;
        this.bubbleUp(idx);
        this.bubbleDown(idx);
      }
    }
    return item;
  }
  bubbleUp(idx) {
    const D = MinHeap.D;
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / D);
      if (this.compare(this.heap[idx], this.heap[parentIdx]) >= 0)
        break;
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }
  bubbleDown(idx) {
    const D = MinHeap.D;
    const length = this.heap.length;
    const heap = this.heap;
    const compare = this.compare;
    while (true) {
      const firstChild = D * idx + 1;
      if (firstChild >= length)
        break;
      let smallest = idx;
      const lastChild = Math.min(firstChild + D, length);
      for (let c = firstChild;c < lastChild; c++) {
        if (compare(heap[c], heap[smallest]) < 0) {
          smallest = c;
        }
      }
      if (smallest === idx)
        break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }
  swap(i, j) {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/temporalManager.js
class TemporalManager {
  temporalIndex = new SkipList((a, b) => a.createdAt - b.createdAt, 16, 0.5, (a, b) => a.jobId === b.jobId);
  delayedJobIds = new Set;
  delayedHeap = new MinHeap((a, b) => a.runAt - b.runAt);
  delayedRunAt = new Map;
  addToIndex(createdAt, jobId2, queue) {
    this.temporalIndex.insert({ createdAt, jobId: jobId2, queue });
  }
  getOldJobs(queue, thresholdMs, limit) {
    const now = Date.now();
    const threshold = now - thresholdMs;
    const result = [];
    for (const entry of this.temporalIndex.values()) {
      if (entry.createdAt > threshold)
        break;
      if (entry.queue === queue) {
        result.push({ jobId: entry.jobId, createdAt: entry.createdAt });
        if (result.length >= limit)
          break;
      }
    }
    return result;
  }
  removeFromIndex(jobId2) {
    this.temporalIndex.deleteWhere((e) => e.jobId === jobId2);
  }
  clearIndexForQueue(queue) {
    this.temporalIndex.removeAll((e) => e.queue === queue);
  }
  cleanOrphaned(validJobIds) {
    if (this.temporalIndex.size === 0)
      return 0;
    const beforeSize = this.temporalIndex.size;
    this.temporalIndex.removeAll((e) => !validJobIds.has(e.jobId));
    return beforeSize - this.temporalIndex.size;
  }
  get indexSize() {
    return this.temporalIndex.size;
  }
  isDelayed(jobId2) {
    return this.delayedJobIds.has(jobId2);
  }
  addDelayed(jobId2, runAt) {
    this.delayedJobIds.add(jobId2);
    this.delayedHeap.push({ jobId: jobId2, runAt });
    this.delayedRunAt.set(jobId2, runAt);
  }
  removeDelayed(jobId2) {
    if (this.delayedJobIds.has(jobId2)) {
      this.delayedJobIds.delete(jobId2);
      this.delayedRunAt.delete(jobId2);
      return true;
    }
    return false;
  }
  refreshDelayed(now) {
    let count = 0;
    while (!this.delayedHeap.isEmpty) {
      const top = this.delayedHeap.peek();
      if (!top || top.runAt > now)
        break;
      this.delayedHeap.pop();
      const currentRunAt = this.delayedRunAt.get(top.jobId);
      if (currentRunAt === undefined)
        continue;
      if (currentRunAt !== top.runAt)
        continue;
      this.delayedJobIds.delete(top.jobId);
      this.delayedRunAt.delete(top.jobId);
      count++;
    }
    return count;
  }
  get delayedCount() {
    return this.delayedJobIds.size;
  }
  clearDelayed() {
    this.delayedJobIds.clear();
    this.delayedHeap.clear();
    this.delayedRunAt.clear();
  }
  clear() {
    this.clearDelayed();
    this.temporalIndex.removeAll(() => true);
  }
  getSizes() {
    return {
      delayedJobIds: this.delayedJobIds.size,
      delayedHeap: this.delayedHeap.size,
      delayedRunAt: this.delayedRunAt.size,
      temporalIndex: this.temporalIndex.size
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/waiterManager.js
var WAITERS_CLEANUP_THRESHOLD = 1000;

class WaiterManager {
  waiters = [];
  pendingNotifications = 0;
  notifyBatch(count) {
    for (let i = 0;i < count; i++) {
      this.notify();
    }
  }
  notify() {
    while (this.waiters.length > 0 && this.waiters[0].cancelled) {
      this.waiters.shift();
    }
    const waiter = this.waiters.shift();
    if (waiter && !waiter.cancelled) {
      waiter.resolve();
    } else {
      this.pendingNotifications++;
    }
    if (this.waiters.length > WAITERS_CLEANUP_THRESHOLD) {
      this.cleanupWaiters();
    }
  }
  waitForJob(timeoutMs) {
    if (timeoutMs <= 0)
      return Promise.resolve();
    if (this.pendingNotifications > 0) {
      this.pendingNotifications--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiter = { resolve, cancelled: false };
      const cleanup = () => {
        if (waiter.cancelled)
          return;
        waiter.cancelled = true;
        resolve();
      };
      this.waiters.push(waiter);
      setTimeout(cleanup, timeoutMs);
    });
  }
  cleanupWaiters() {
    const active = this.waiters.filter((w) => !w.cancelled);
    this.waiters.length = 0;
    this.waiters.push(...active);
  }
  get length() {
    return this.waiters.length;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/shardCounters.js
class ShardCounters {
  temporalManager;
  stats = {
    queuedJobs: 0,
    delayedJobs: 0,
    dlqJobs: 0
  };
  constructor(temporalManager) {
    this.temporalManager = temporalManager;
  }
  getStats() {
    return { ...this.stats };
  }
  incrementQueued(jobId2, isDelayed, createdAt, queue, runAt) {
    this.stats.queuedJobs++;
    if (isDelayed) {
      this.stats.delayedJobs++;
      if (runAt !== undefined) {
        this.temporalManager.addDelayed(jobId2, runAt);
      }
    }
    if (createdAt !== undefined && queue !== undefined) {
      this.temporalManager.addToIndex(createdAt, jobId2, queue);
    }
  }
  decrementQueued(jobId2) {
    this.stats.queuedJobs = Math.max(0, this.stats.queuedJobs - 1);
    if (this.temporalManager.removeDelayed(jobId2)) {
      this.stats.delayedJobs = Math.max(0, this.stats.delayedJobs - 1);
    }
  }
  incrementDlq() {
    this.stats.dlqJobs++;
  }
  decrementDlq(count = 1) {
    this.stats.dlqJobs = Math.max(0, this.stats.dlqJobs - count);
  }
  refreshDelayedCount(now) {
    const readyCount = this.temporalManager.refreshDelayed(now);
    this.stats.delayedJobs = Math.max(0, this.stats.delayedJobs - readyCount);
  }
  resetQueuedCounters() {
    this.stats.queuedJobs = 0;
    this.stats.delayedJobs = 0;
    this.temporalManager.clearDelayed();
  }
  resetDlqCounter() {
    this.stats.dlqJobs = 0;
  }
  adjustQueued(delta) {
    this.stats.queuedJobs = Math.max(0, this.stats.queuedJobs + delta);
  }
  adjustDlq(delta) {
    this.stats.dlqJobs = Math.max(0, this.stats.dlqJobs + delta);
  }
  syncDelayedCount() {
    this.stats.delayedJobs = this.temporalManager.delayedCount;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/queue/shard.js
class Shard {
  queues = new Map;
  uniqueKeyManager = new UniqueKeyManager;
  dlqManager;
  limiterManager = new LimiterManager;
  dependencyTracker = new DependencyTracker;
  temporalManager = new TemporalManager;
  waiterManager = new WaiterManager;
  counters;
  activeGroups = new Map;
  constructor() {
    this.counters = new ShardCounters(this.temporalManager);
    this.dlqManager = new DlqShard({
      incrementDlq: () => {
        this.counters.incrementDlq();
      },
      decrementDlq: (count) => {
        this.counters.decrementDlq(count);
      }
    });
  }
  notify() {
    this.waiterManager.notify();
  }
  notifyBatch(count) {
    this.waiterManager.notifyBatch(count);
  }
  waitForJob(timeoutMs) {
    return this.waiterManager.waitForJob(timeoutMs);
  }
  getQueue(name) {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new IndexedPriorityQueue;
      this.queues.set(name, queue);
    }
    return queue;
  }
  getState(name) {
    return this.limiterManager.getState(name);
  }
  isPaused(name) {
    return this.limiterManager.isPaused(name);
  }
  pause(name) {
    this.limiterManager.pause(name);
  }
  resume(name) {
    this.limiterManager.resume(name);
    this.waiterManager.notify();
  }
  isUniqueAvailable(queue, key) {
    return this.uniqueKeyManager.isAvailable(queue, key);
  }
  getUniqueKeyEntry(queue, key) {
    return this.uniqueKeyManager.getEntry(queue, key);
  }
  registerUniqueKey(queue, key, jobId2) {
    this.uniqueKeyManager.register(queue, key, jobId2);
  }
  registerUniqueKeyWithTtl(queue, key, jobId2, ttl) {
    this.uniqueKeyManager.registerWithTtl(queue, key, jobId2, ttl);
  }
  extendUniqueKeyTtl(queue, key, ttl) {
    return this.uniqueKeyManager.extendTtl(queue, key, ttl);
  }
  releaseUniqueKey(queue, key) {
    this.uniqueKeyManager.release(queue, key);
  }
  cleanExpiredUniqueKeys() {
    return this.uniqueKeyManager.cleanExpired();
  }
  get uniqueKeys() {
    return this.uniqueKeyManager.getMap();
  }
  isGroupActive(queue, groupId) {
    return this.activeGroups.get(queue)?.has(groupId) ?? false;
  }
  activateGroup(queue, groupId) {
    let groups = this.activeGroups.get(queue);
    if (!groups) {
      groups = new Set;
      this.activeGroups.set(queue, groups);
    }
    groups.add(groupId);
  }
  releaseGroup(queue, groupId) {
    this.activeGroups.get(queue)?.delete(groupId);
  }
  setRateLimit(queue, limit) {
    this.limiterManager.setRateLimit(queue, limit);
  }
  clearRateLimit(queue) {
    this.limiterManager.clearRateLimit(queue);
  }
  tryAcquireRateLimit(queue) {
    return this.limiterManager.tryAcquireRateLimit(queue);
  }
  setConcurrency(queue, limit) {
    this.limiterManager.setConcurrency(queue, limit);
  }
  clearConcurrency(queue) {
    this.limiterManager.clearConcurrency(queue);
  }
  tryAcquireConcurrency(queue) {
    return this.limiterManager.tryAcquireConcurrency(queue);
  }
  releaseConcurrency(queue) {
    this.limiterManager.releaseConcurrency(queue);
  }
  get queueState() {
    return this.limiterManager.getStateMap();
  }
  clearQueueLimiters(queue) {
    this.limiterManager.deleteQueue(queue);
  }
  releaseJobResources(queue, uniqueKey, groupId) {
    if (uniqueKey)
      this.releaseUniqueKey(queue, uniqueKey);
    if (groupId)
      this.releaseGroup(queue, groupId);
    this.releaseConcurrency(queue);
  }
  get waitingDeps() {
    return this.dependencyTracker.waitingDeps;
  }
  get dependencyIndex() {
    return this.dependencyTracker.dependencyIndex;
  }
  get waitingChildren() {
    return this.dependencyTracker.waitingChildren;
  }
  registerDependencies(jobId2, dependsOn) {
    this.dependencyTracker.registerDependencies(jobId2, dependsOn);
  }
  unregisterDependencies(jobId2, dependsOn) {
    this.dependencyTracker.unregisterDependencies(jobId2, dependsOn);
  }
  getJobsWaitingFor(depId) {
    return this.dependencyTracker.getJobsWaitingFor(depId);
  }
  get dlq() {
    const map = new Map;
    for (const queue of this.dlqManager.getQueueNames()) {
      map.set(queue, this.dlqManager.getEntries(queue));
    }
    for (const queue of this.queues.keys()) {
      if (!map.has(queue))
        map.set(queue, []);
    }
    return map;
  }
  get dlqConfig() {
    const map = new Map;
    for (const queue of this.getQueueNames()) {
      map.set(queue, this.dlqManager.getConfig(queue));
    }
    return map;
  }
  get stallConfig() {
    const map = new Map;
    for (const queue of this.getQueueNames()) {
      map.set(queue, this.dlqManager.getStallConfig(queue));
    }
    return map;
  }
  getDlqConfig(queue) {
    return this.dlqManager.getConfig(queue);
  }
  setDlqConfig(queue, config) {
    this.dlqManager.setConfig(queue, config);
  }
  getStallConfig(queue) {
    return this.dlqManager.getStallConfig(queue);
  }
  setStallConfig(queue, config) {
    this.dlqManager.setStallConfig(queue, config);
  }
  addToDlq(job, reason = "unknown", error2 = null) {
    return this.dlqManager.add(job, reason, error2);
  }
  restoreDlqEntry(queue, entry) {
    this.dlqManager.restoreEntry(queue, entry);
  }
  getDlqEntries(queue) {
    return this.dlqManager.getEntries(queue);
  }
  getDlq(queue, count) {
    return this.dlqManager.getJobs(queue, count);
  }
  getDlqFiltered(queue, filter) {
    return this.dlqManager.getFiltered(queue, filter);
  }
  removeFromDlq(queue, jobId2) {
    return this.dlqManager.remove(queue, jobId2);
  }
  getAutoRetryEntries(queue, now = Date.now()) {
    return this.dlqManager.getAutoRetryEntries(queue, now);
  }
  getExpiredEntries(queue, now = Date.now()) {
    return this.dlqManager.getExpiredEntries(queue, now);
  }
  purgeExpired(queue, now = Date.now()) {
    return this.dlqManager.purgeExpired(queue, now);
  }
  clearDlq(queue) {
    return this.dlqManager.clear(queue);
  }
  getWaitingCount(queue) {
    return this.queues.get(queue)?.size ?? 0;
  }
  getDlqCount(queue) {
    return this.dlqManager.getCount(queue);
  }
  getQueueNames() {
    const names = new Set;
    for (const name of this.queues.keys())
      names.add(name);
    for (const name of this.dlqManager.getQueueNames())
      names.add(name);
    for (const name of this.limiterManager.getQueueNames())
      names.add(name);
    return Array.from(names);
  }
  getCountsPerPriority(queue) {
    const q = this.queues.get(queue);
    const counts = new Map;
    if (!q)
      return counts;
    for (const job of q.values()) {
      const count = counts.get(job.priority) ?? 0;
      counts.set(job.priority, count + 1);
    }
    return counts;
  }
  getStats() {
    return this.counters.getStats();
  }
  getInternalSizes() {
    const sizes = this.temporalManager.getSizes();
    return { ...sizes, waiters: this.waiterManager.length };
  }
  incrementQueued(jobId2, isDelayed, createdAt, queue, runAt) {
    this.counters.incrementQueued(jobId2, isDelayed, createdAt, queue, runAt);
  }
  decrementQueued(jobId2) {
    this.counters.decrementQueued(jobId2);
  }
  incrementDlq() {
    this.counters.incrementDlq();
  }
  decrementDlq(count = 1) {
    this.counters.decrementDlq(count);
  }
  refreshDelayedCount(now) {
    this.counters.refreshDelayedCount(now);
  }
  resetQueuedCounters() {
    this.counters.resetQueuedCounters();
  }
  resetDlqCounter() {
    this.counters.resetDlqCounter();
  }
  getOldJobs(queue, thresholdMs, limit) {
    return this.temporalManager.getOldJobs(queue, thresholdMs, limit);
  }
  removeFromTemporalIndex(jobId2) {
    this.temporalManager.removeFromIndex(jobId2);
  }
  clearTemporalIndexForQueue(queue) {
    this.temporalManager.clearIndexForQueue(queue);
  }
  cleanOrphanedTemporalEntries() {
    if (this.temporalManager.indexSize === 0)
      return 0;
    const validJobIds = new Set;
    for (const pq of this.queues.values()) {
      for (const job of pq.values()) {
        validJobIds.add(job.id);
      }
    }
    return this.temporalManager.cleanOrphaned(validJobIds);
  }
  drain(queue) {
    const q = this.queues.get(queue);
    if (!q)
      return { count: 0, jobIds: [] };
    const count = q.size;
    const jobIds = [];
    for (const job of q.values()) {
      jobIds.push(job.id);
      this.temporalManager.removeDelayed(job.id);
    }
    q.clear();
    this.temporalManager.clearIndexForQueue(queue);
    this.counters.adjustQueued(-count);
    this.counters.syncDelayedCount();
    return { count, jobIds };
  }
  obliterate(queue) {
    const q = this.queues.get(queue);
    if (q) {
      for (const job of q.values()) {
        this.temporalManager.removeDelayed(job.id);
      }
      this.counters.adjustQueued(-q.size);
    }
    const dlqCount = this.dlqManager.deleteQueue(queue);
    if (dlqCount > 0) {
      this.counters.adjustDlq(-dlqCount);
    }
    this.counters.syncDelayedCount();
    this.temporalManager.clearIndexForQueue(queue);
    this.queues.delete(queue);
    this.uniqueKeyManager.clearQueue(queue);
    this.limiterManager.deleteQueue(queue);
    this.activeGroups.delete(queue);
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/sqlite.js
import { Database } from "bun:sqlite";

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/schema.js
var PRAGMA_SETTINGS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
PRAGMA page_size = 4096;
PRAGMA busy_timeout = 5000;
`;
var SCHEMA = `
-- Jobs table (using UUIDv7 for job IDs)
-- Uses BLOB for data fields (MessagePack serialization for ~2-3x faster than JSON)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    data BLOB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    run_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    backoff INTEGER NOT NULL DEFAULT 1000,
    ttl INTEGER,
    timeout INTEGER,
    unique_key TEXT,
    custom_id TEXT,
    depends_on BLOB,
    parent_id TEXT,
    children_ids BLOB,
    tags BLOB,
    state TEXT NOT NULL DEFAULT 'waiting',
    lifo INTEGER NOT NULL DEFAULT 0,
    group_id TEXT,
    progress INTEGER DEFAULT 0,
    progress_msg TEXT,
    remove_on_complete INTEGER DEFAULT 0,
    remove_on_fail INTEGER DEFAULT 0,
    stall_timeout INTEGER,
    last_heartbeat INTEGER,
    timeline BLOB,
    stacktrace BLOB
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_queue_state
    ON jobs(queue, state);
CREATE INDEX IF NOT EXISTS idx_jobs_run_at
    ON jobs(run_at) WHERE state IN ('waiting', 'delayed');
CREATE INDEX IF NOT EXISTS idx_jobs_unique
    ON jobs(queue, unique_key) WHERE unique_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_custom_id
    ON jobs(custom_id) WHERE custom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_parent
    ON jobs(parent_id) WHERE parent_id IS NOT NULL;

-- Job results storage (BLOB for MessagePack)
CREATE TABLE IF NOT EXISTS job_results (
    job_id TEXT PRIMARY KEY,
    result BLOB,
    completed_at INTEGER NOT NULL
);

-- Dead letter queue (BLOB for MessagePack - stores full DlqEntry)
CREATE TABLE IF NOT EXISTS dlq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    queue TEXT NOT NULL,
    entry BLOB NOT NULL,
    entered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dlq(queue);
CREATE INDEX IF NOT EXISTS idx_dlq_job_id ON dlq(job_id);
CREATE INDEX IF NOT EXISTS idx_dlq_entered_at ON dlq(entered_at);

-- Performance indexes for high-throughput operations
-- Stall detection: runs every 5s, needs fast lookup of active jobs by started_at
CREATE INDEX IF NOT EXISTS idx_jobs_state_started
    ON jobs(state, started_at) WHERE state = 'active';

-- Group operations: fast lookup by group_id
CREATE INDEX IF NOT EXISTS idx_jobs_group_id
    ON jobs(group_id) WHERE group_id IS NOT NULL;

-- Pending jobs: compound index for priority-ordered retrieval
CREATE INDEX IF NOT EXISTS idx_jobs_pending_priority
    ON jobs(queue, state, priority DESC, run_at ASC) WHERE state IN ('waiting', 'delayed');

-- Completed jobs: index for recovery ordering (issue #84)
CREATE INDEX IF NOT EXISTS idx_jobs_completed_order
    ON jobs(completed_at DESC) WHERE state = 'completed';

-- Cron jobs (BLOB for MessagePack)
CREATE TABLE IF NOT EXISTS cron_jobs (
    name TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    data BLOB NOT NULL,
    schedule TEXT,
    repeat_every INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    next_run INTEGER NOT NULL,
    executions INTEGER NOT NULL DEFAULT 0,
    max_limit INTEGER,
    timezone TEXT,
    unique_key TEXT,
    dedup BLOB,
    skip_missed_on_restart INTEGER NOT NULL DEFAULT 0,
    skip_if_no_worker INTEGER NOT NULL DEFAULT 0,
    prevent_overlap INTEGER NOT NULL DEFAULT 1,
    job_options BLOB
);

-- Queue state persistence (optional)
CREATE TABLE IF NOT EXISTS queue_state (
    name TEXT PRIMARY KEY,
    paused INTEGER NOT NULL DEFAULT 0,
    rate_limit INTEGER,
    concurrency_limit INTEGER
);
`;
var MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
`;
var SCHEMA_VERSION = 13;
var MIGRATIONS = {
  1: SCHEMA,
  5: `
-- DLQ expiration cleanup: O(log n) instead of O(n) table scan
CREATE INDEX IF NOT EXISTS idx_dlq_entered_at ON dlq(entered_at);

-- Stall detection: runs every 5s, needs fast lookup of active jobs
CREATE INDEX IF NOT EXISTS idx_jobs_state_started
    ON jobs(state, started_at) WHERE state = 'active';

-- Group operations: fast lookup by group_id
CREATE INDEX IF NOT EXISTS idx_jobs_group_id
    ON jobs(group_id) WHERE group_id IS NOT NULL;

-- Pending jobs: compound index for priority-ordered retrieval
CREATE INDEX IF NOT EXISTS idx_jobs_pending_priority
    ON jobs(queue, state, priority DESC, run_at ASC) WHERE state IN ('waiting', 'delayed');
`,
  6: `
ALTER TABLE cron_jobs ADD COLUMN unique_key TEXT;
ALTER TABLE cron_jobs ADD COLUMN dedup BLOB;
`,
  7: `
ALTER TABLE jobs ADD COLUMN timeline BLOB;
`,
  8: `
ALTER TABLE cron_jobs ADD COLUMN skip_missed_on_restart INTEGER NOT NULL DEFAULT 0;
`,
  9: `
ALTER TABLE cron_jobs ADD COLUMN skip_if_no_worker INTEGER NOT NULL DEFAULT 0;
`,
  10: `
ALTER TABLE cron_jobs ADD COLUMN prevent_overlap INTEGER NOT NULL DEFAULT 1;
`,
  11: `
CREATE INDEX IF NOT EXISTS idx_jobs_completed_order
    ON jobs(completed_at DESC) WHERE state = 'completed';
`,
  12: `
ALTER TABLE cron_jobs ADD COLUMN job_options BLOB;
`,
  13: `
ALTER TABLE jobs ADD COLUMN stacktrace BLOB;
`
};

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/statements.js
var SQL_STATEMENTS = {
  insertJob: `
    INSERT INTO jobs (
      id, queue, data, priority, created_at, run_at, attempts,
      max_attempts, backoff, ttl, timeout, unique_key, custom_id,
      depends_on, parent_id, children_ids, tags, state, lifo, group_id,
      remove_on_complete, remove_on_fail, stall_timeout, timeline
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `,
  updateJobState: "UPDATE jobs SET state = ?, started_at = ?, timeline = ? WHERE id = ?",
  completeJob: "UPDATE jobs SET state = ?, completed_at = ?, progress = 100, timeline = ? WHERE id = ?",
  deleteJob: "DELETE FROM jobs WHERE id = ?",
  deleteJobResult: "DELETE FROM job_results WHERE job_id = ?",
  getJob: "SELECT * FROM jobs WHERE id = ?",
  insertResult: "INSERT OR REPLACE INTO job_results (job_id, result, completed_at) VALUES (?, ?, ?)",
  getResult: "SELECT result FROM job_results WHERE job_id = ?",
  insertDlq: "INSERT INTO dlq (job_id, queue, entry, entered_at) VALUES (?, ?, ?, ?)",
  loadDlq: "SELECT * FROM dlq ORDER BY entered_at",
  deleteDlqEntry: "DELETE FROM dlq WHERE job_id = ?",
  clearDlqQueue: "DELETE FROM dlq WHERE queue = ?",
  insertCron: `
    INSERT OR REPLACE INTO cron_jobs
    (name, queue, data, schedule, repeat_every, priority, next_run, executions, max_limit, timezone, unique_key, dedup, skip_missed_on_restart, skip_if_no_worker, prevent_overlap, job_options)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  updateCron: "UPDATE cron_jobs SET executions = ?, next_run = ? WHERE name = ?",
  upsertQueueState: "INSERT OR REPLACE INTO queue_state (name, paused, rate_limit, concurrency_limit) VALUES (?, ?, ?, ?)",
  loadQueueState: "SELECT name, paused, rate_limit, concurrency_limit FROM queue_state",
  deleteQueueState: "DELETE FROM queue_state WHERE name = ?"
};
function prepareStatements(db) {
  const statements = new Map;
  for (const [name, sql] of Object.entries(SQL_STATEMENTS)) {
    statements.set(name, db.prepare(sql));
  }
  return statements;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/logger.js
var LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger {
  component;
  static jsonMode = false;
  static level = "info";
  constructor(component) {
    this.component = component;
  }
  static enableJsonMode() {
    Logger.jsonMode = true;
  }
  static disableJsonMode() {
    Logger.jsonMode = false;
  }
  static setLevel(level) {
    Logger.level = level;
  }
  debug(message, data) {
    this.log("debug", message, data);
  }
  info(message, data) {
    this.log("info", message, data);
  }
  warn(message, data) {
    this.log("warn", message, data);
  }
  error(message, data) {
    this.log("error", message, data);
  }
  log(level, message, data) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[Logger.level])
      return;
    if (Logger.jsonMode) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        component: this.component,
        message,
        ...data && { data }
      };
      console.log(JSON.stringify(entry));
    } else {
      const prefix = `[${this.component}]`;
      const dataStr = data ? ` ${JSON.stringify(data)}` : "";
      switch (level) {
        case "debug":
          console.debug(`${prefix} ${message}${dataStr}`);
          break;
        case "info":
          console.log(`${prefix} ${message}${dataStr}`);
          break;
        case "warn":
          console.warn(`${prefix} ${message}${dataStr}`);
          break;
        case "error":
          console.error(`${prefix} ${message}${dataStr}`);
          break;
      }
    }
  }
}
function createLogger(component) {
  return new Logger(component);
}
var serverLog = createLogger("Server");
var tcpLog = createLogger("TCP");
var httpLog = createLogger("HTTP");
var wsLog = createLogger("WS");
var cronLog = createLogger("Cron");
var statsLog = createLogger("Stats");
var storageLog = createLogger("Storage");
var queueLog = createLogger("Queue");
var webhookLog = createLogger("Webhook");
var backupLog = createLogger("Backup");

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/sqliteSerializer.js
function pack2(data) {
  return pack(data);
}
function unpack2(buffer, fallback, context) {
  if (!buffer)
    return fallback;
  try {
    return unpack(buffer);
  } catch (err) {
    storageLog.error("MessagePack decode error", { context, error: String(err) });
    return fallback;
  }
}
var CORRUPT_DEPENDS_ON = Symbol("bunqueue.corruptDependsOn");
function isCorruptDependsOn(job) {
  return job[CORRUPT_DEPENDS_ON] === true;
}
function decodeDependsOn(buffer, context) {
  if (!buffer)
    return { ids: [], corrupt: false };
  try {
    return { ids: unpack(buffer), corrupt: false };
  } catch (err) {
    storageLog.error("Corrupt depends_on blob (routing job to DLQ)", {
      context,
      error: String(err)
    });
    return { ids: [], corrupt: true };
  }
}
function rowToJob(row) {
  const jobContext = `rowToJob:${row.id}`;
  const decoded = decodeDependsOn(row.depends_on, `${jobContext}:dependsOn`);
  const dependsOn = decoded.ids;
  const childrenIds = row.children_ids ? unpack2(row.children_ids, [], `${jobContext}:childrenIds`) : [];
  const tags = row.tags ? unpack2(row.tags, [], `${jobContext}:tags`) : [];
  const job = {
    id: jobId(row.id),
    queue: row.queue,
    data: unpack2(row.data, {}, `${jobContext}:data`),
    priority: row.priority,
    createdAt: row.created_at,
    runAt: row.run_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    backoff: row.backoff,
    backoffConfig: null,
    ttl: row.ttl,
    timeout: row.timeout,
    uniqueKey: row.unique_key,
    customId: row.custom_id,
    dependsOn: dependsOn.map((s) => jobId(s)),
    parentId: row.parent_id ? jobId(row.parent_id) : null,
    childrenIds: childrenIds.map((s) => jobId(s)),
    childrenCompleted: 0,
    tags,
    lifo: row.lifo === 1,
    groupId: row.group_id,
    progress: row.progress ?? 0,
    progressMessage: row.progress_msg,
    removeOnComplete: row.remove_on_complete === 1,
    removeOnFail: row.remove_on_fail === 1,
    repeat: null,
    lastHeartbeat: row.last_heartbeat ?? row.created_at,
    stallTimeout: row.stall_timeout,
    stallCount: 0,
    stackTraceLimit: 10,
    keepLogs: null,
    sizeLimit: null,
    failParentOnFailure: false,
    removeDependencyOnFailure: false,
    continueParentOnFailure: false,
    ignoreDependencyOnFailure: false,
    deduplicationTtl: null,
    deduplicationExtend: false,
    deduplicationReplace: false,
    debounceId: null,
    debounceTtl: null,
    timeline: row.timeline ? unpack2(row.timeline, [], `${jobContext}:timeline`) : [],
    stacktrace: row.stacktrace ? unpack2(row.stacktrace, null, `${jobContext}:stacktrace`) : null
  };
  if (decoded.corrupt) {
    Object.defineProperty(job, CORRUPT_DEPENDS_ON, {
      value: true,
      enumerable: false,
      configurable: true
    });
  }
  return job;
}
function brandId(id) {
  return typeof id === "string" ? jobId(id) : id;
}
function reconstructDlqEntry(entry) {
  return {
    ...entry,
    job: {
      ...entry.job,
      id: brandId(entry.job.id),
      dependsOn: entry.job.dependsOn.map((id) => brandId(id)),
      parentId: entry.job.parentId !== null ? brandId(entry.job.parentId) : null,
      childrenIds: entry.job.childrenIds.map((id) => brandId(id)),
      stacktrace: entry.job.stacktrace ?? null
    }
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/sqliteBatch.js
var COLS_PER_ROW = 24;
var MAX_ROWS_PER_INSERT = Math.floor(999 / COLS_PER_ROW);
function isConstraintError(err) {
  const code = err.code ?? "";
  return code.startsWith("SQLITE_CONSTRAINT") || /constraint failed/i.test(err.message);
}

class BatchInsertManager {
  db;
  cache = new Map;
  constructor(db) {
    this.db = db;
  }
  insertJobsBatch(jobs) {
    if (jobs.length === 0)
      return { transient: [], conflicts: [] };
    const now = Date.now();
    try {
      this.db.transaction(() => {
        for (let offset = 0;offset < jobs.length; offset += MAX_ROWS_PER_INSERT) {
          const chunk = jobs.slice(offset, offset + MAX_ROWS_PER_INSERT);
          this.insertJobsChunk(chunk, now);
        }
      })();
      return { transient: [], conflicts: [] };
    } catch (err) {
      const batchError = err instanceof Error ? err : new Error(String(err));
      return this.insertRowByRow(jobs, now, batchError);
    }
  }
  insertRowByRow(jobs, now, batchError) {
    const transient = [];
    const conflicts = [];
    for (const job of jobs) {
      try {
        this.insertJobsChunk([job], now);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (isConstraintError(err))
          conflicts.push(job);
        else
          transient.push(job);
      }
    }
    return { transient, conflicts, error: batchError };
  }
  getBatchInsertStmt(size) {
    let stmt = this.cache.get(size);
    if (!stmt) {
      const rowPlaceholder = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      const placeholders = Array(size).fill(rowPlaceholder).join(", ");
      const sql = `INSERT INTO jobs (
        id, queue, data, priority, created_at, run_at, attempts, max_attempts,
        backoff, ttl, timeout, unique_key, custom_id, depends_on, parent_id,
        children_ids, tags, state, lifo, group_id, remove_on_complete, remove_on_fail, stall_timeout, timeline
      ) VALUES ${placeholders}`;
      stmt = this.db.prepare(sql);
      if (size <= 100) {
        this.cache.set(size, stmt);
      }
    }
    return stmt;
  }
  insertJobsChunk(jobs, now) {
    const stmt = this.getBatchInsertStmt(jobs.length);
    const values = [];
    for (const job of jobs) {
      values.push(job.id, job.queue, pack2(job.data), job.priority, job.createdAt, job.runAt, job.attempts, job.maxAttempts, job.backoff, job.ttl, job.timeout, job.uniqueKey, job.customId, job.dependsOn.length > 0 ? pack2(job.dependsOn) : null, job.parentId, job.childrenIds.length > 0 ? pack2(job.childrenIds) : null, job.tags.length > 0 ? pack2(job.tags) : null, job.runAt > now ? "delayed" : "waiting", job.lifo ? 1 : 0, job.groupId, job.removeOnComplete ? 1 : 0, job.removeOnFail ? 1 : 0, job.stallTimeout, job.timeline.length > 0 ? pack2(job.timeline) : null);
    }
    stmt.run(...values);
  }
}

class WriteBuffer {
  activeBuffer = [];
  flushBuffer = [];
  flushing = false;
  stopped = false;
  timer = null;
  batchManager;
  bufferSize;
  onError;
  onCriticalError;
  retryCount = 0;
  currentBackoffMs = 100;
  initialBackoffMs = 100;
  maxBackoffMs = 30000;
  maxRetries = 10;
  lastError = null;
  backoffTimer = null;
  constructor(batchManager, bufferSize, flushIntervalMs, onError, onCriticalError) {
    this.batchManager = batchManager;
    this.bufferSize = bufferSize;
    this.onError = onError;
    this.onCriticalError = onCriticalError;
    this.timer = setInterval(() => {
      if (this.stopped || this.backoffTimer)
        return;
      try {
        this.flush();
      } catch {}
    }, flushIntervalMs);
  }
  add(job) {
    this.activeBuffer.push(job);
    if (this.activeBuffer.length >= this.bufferSize) {
      this.flush();
    }
  }
  addBatch(jobs) {
    for (const job of jobs) {
      this.activeBuffer.push(job);
    }
    if (this.activeBuffer.length >= this.bufferSize) {
      this.flush();
    }
  }
  flush() {
    if (this.stopped || this.flushing)
      return 0;
    if (this.activeBuffer.length === 0)
      return 0;
    this.flushing = true;
    this.flushBuffer = this.activeBuffer;
    this.activeBuffer = [];
    const jobCount = this.flushBuffer.length;
    try {
      let result;
      try {
        result = this.batchManager.insertJobsBatch(this.flushBuffer) ?? {
          transient: [],
          conflicts: []
        };
      } catch (err) {
        result = {
          transient: this.flushBuffer,
          conflicts: [],
          error: err instanceof Error ? err : new Error(String(err))
        };
      }
      const { transient, conflicts, error: error2 } = result;
      this.flushBuffer = [];
      if (conflicts.length > 0) {
        this.onError(error2 ?? new Error("Constraint violation"), conflicts.length);
      }
      if (transient.length > 0) {
        const error22 = error2 ?? new Error("Write buffer flush failed");
        this.lastError = error22;
        this.retryCount++;
        this.activeBuffer = transient.concat(this.activeBuffer);
        if (this.retryCount >= this.maxRetries) {
          const lostJobs = [...this.activeBuffer];
          this.activeBuffer = [];
          if (this.onCriticalError)
            this.onCriticalError(lostJobs, error22, this.retryCount);
          this.onError(error22, lostJobs.length, {
            retryCount: this.retryCount,
            nextBackoffMs: 0,
            maxRetries: this.maxRetries
          });
          this.retryCount = 0;
          this.currentBackoffMs = this.initialBackoffMs;
          this.lastError = null;
        } else {
          const nextBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
          this.onError(error22, transient.length, {
            retryCount: this.retryCount,
            nextBackoffMs,
            maxRetries: this.maxRetries
          });
          this.scheduleBackoffRetry();
        }
        return jobCount - transient.length - conflicts.length;
      }
      this.retryCount = 0;
      this.currentBackoffMs = this.initialBackoffMs;
      this.lastError = null;
      return jobCount - conflicts.length;
    } finally {
      this.flushing = false;
    }
  }
  scheduleBackoffRetry() {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
    }
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      try {
        this.flush();
      } catch {}
    }, this.currentBackoffMs);
  }
  get pendingCount() {
    return this.activeBuffer.length + this.flushBuffer.length;
  }
  removePending(jobId2) {
    const i = this.activeBuffer.findIndex((j2) => j2.id === jobId2);
    if (i !== -1)
      this.activeBuffer.splice(i, 1);
    const j = this.flushBuffer.findIndex((j2) => j2.id === jobId2);
    if (j !== -1)
      this.flushBuffer.splice(j, 1);
  }
  hasPending(jobId2) {
    for (const j of this.activeBuffer)
      if (j.id === jobId2)
        return true;
    for (const j of this.flushBuffer)
      if (j.id === jobId2)
        return true;
    return false;
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pendingCount > 0) {
      try {
        this.flush();
      } catch {}
    }
    this.stopped = true;
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.reportLostJobs();
  }
  async stopGracefully(timeoutMs = 5000) {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const pending = this.pendingCount;
    if (pending === 0) {
      this.stopped = true;
      return 0;
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.stopped = true;
        this.reportLostJobs();
        resolve(-1);
      }, timeoutMs);
      try {
        const flushed = this.flush();
        clearTimeout(timeout);
        this.stopped = true;
        if (this.pendingCount > 0)
          this.reportLostJobs();
        resolve(flushed);
      } catch {
        if (this.backoffTimer) {
          clearTimeout(this.backoffTimer);
          this.backoffTimer = null;
        }
        clearTimeout(timeout);
        this.stopped = true;
        this.reportLostJobs();
        resolve(0);
      }
    });
  }
  reportLostJobs() {
    const remaining = this.activeBuffer.concat(this.flushBuffer);
    if (remaining.length > 0 && this.onCriticalError) {
      this.onCriticalError(remaining, this.lastError ?? new Error("Flush failed during shutdown"), this.retryCount);
      this.activeBuffer = [];
      this.flushBuffer = [];
    }
  }
  getRetryState() {
    return {
      retryCount: this.retryCount,
      currentBackoffMs: this.currentBackoffMs,
      lastError: this.lastError
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/persistence/sqlite.js
function isSqliteFullError(err) {
  if (!(err instanceof Error))
    return false;
  const msg = err.message;
  return msg.includes("SQLITE_FULL") || msg.includes("database or disk is full");
}

class SqliteStorage {
  db;
  statements;
  batchManager;
  writeBuffer;
  _diskFull = false;
  _lastDiskFullError = null;
  _lastDiskFullAt = null;
  _criticalLosses = [];
  _onCriticalLoss;
  static MAX_RETAINED_LOSSES = 100;
  constructor(config) {
    this.db = new Database(config.path, { create: true });
    try {
      this.db.run(PRAGMA_SETTINGS);
    } catch (err) {
      storageLog.error("Failed to apply PRAGMA settings", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    this.migrate();
    this.statements = prepareStatements(this.db);
    this._onCriticalLoss = config.onCriticalLoss;
    this.batchManager = new BatchInsertManager(this.db);
    this.writeBuffer = new WriteBuffer(this.batchManager, config.writeBufferSize ?? 100, config.writeBufferFlushMs ?? 10, (err, jobCount) => {
      if (isSqliteFullError(err)) {
        this.setDiskFull(err.message);
      }
      if (/constraint failed/i.test(err.message)) {
        storageLog.error("Write buffer rejected jobs (constraint violation, dropped)", {
          rejectedJobCount: jobCount,
          error: err.message
        });
      } else {
        storageLog.error("Write buffer flush failed", {
          jobCount,
          error: err.message,
          diskFull: this._diskFull
        });
      }
    }, (jobs, lastError, attempts) => {
      this.handleCriticalLoss(jobs, lastError, attempts);
    });
  }
  handleCriticalLoss(jobs, lastError, attempts) {
    storageLog.error("CRITICAL: WriteBuffer dropped jobs after exhausting retries", {
      lostJobCount: jobs.length,
      attempts,
      error: lastError.message,
      diskFull: this._diskFull
    });
    for (const job of jobs) {
      storageLog.error("Lost job (recover from this log if needed)", {
        id: String(job.id),
        queue: job.queue,
        customId: job.customId,
        priority: job.priority,
        createdAt: job.createdAt,
        attempts: job.attempts,
        dataPreview: this.previewJobData(job.data)
      });
    }
    this._criticalLosses.push({
      jobs,
      error: lastError.message,
      attempts,
      at: Date.now()
    });
    while (this._criticalLosses.length > SqliteStorage.MAX_RETAINED_LOSSES) {
      this._criticalLosses.shift();
    }
    for (const job of jobs) {
      try {
        this.saveDlqEntry(createDlqEntry(job, "unknown", lastError.message));
      } catch (err) {
        storageLog.error("Failed to persist lost job to DLQ", {
          id: String(job.id),
          queue: job.queue,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    if (this._onCriticalLoss) {
      try {
        this._onCriticalLoss(jobs, lastError, attempts);
      } catch (err) {
        storageLog.error("onCriticalLoss callback threw", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  previewJobData(data) {
    try {
      const s = JSON.stringify(data);
      return s.length > 500 ? s.slice(0, 500) + "...[truncated]" : s;
    } catch {
      return "[unserializable]";
    }
  }
  getCriticalLosses() {
    return this._criticalLosses;
  }
  clearCriticalLosses() {
    this._criticalLosses.length = 0;
  }
  setDiskFull(message) {
    if (!this._diskFull) {
      storageLog.error("DISK FULL: SQLite cannot write, persistence degraded", { error: message });
    }
    this._diskFull = true;
    this._lastDiskFullError = message;
    this._lastDiskFullAt = Date.now();
  }
  safeWrite(fn) {
    try {
      fn();
      if (this._diskFull) {
        this._diskFull = false;
        this._lastDiskFullError = null;
        storageLog.info("Disk full condition cleared - writes succeeding again");
      }
    } catch (err) {
      if (isSqliteFullError(err)) {
        this.setDiskFull(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }
  get diskFull() {
    return this._diskFull;
  }
  getDiskFullStatus() {
    return {
      diskFull: this._diskFull,
      error: this._lastDiskFullError,
      since: this._lastDiskFullAt
    };
  }
  flushWriteBuffer() {
    return this.writeBuffer.flush();
  }
  migrate() {
    this.db.run(MIGRATION_TABLE);
    const currentVersion = this.db.query("SELECT MAX(version) as version FROM migrations").get()?.version ?? 0;
    if (currentVersion < SCHEMA_VERSION) {
      this.db.run(SCHEMA);
      for (const [ver, sql] of Object.entries(MIGRATIONS)) {
        const v = Number(ver);
        if (v > currentVersion && v > 1) {
          try {
            this.db.run(sql);
          } catch {}
        }
      }
      this.db.prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, Date.now());
    }
  }
  insertJob(job, durable) {
    if (durable) {
      this.insertJobImmediate(job);
      return;
    }
    this.writeBuffer.add(job);
  }
  insertJobImmediate(job) {
    this.safeWrite(() => {
      this.runInsertJobStmt(job);
    });
  }
  runInsertJobStmt(job) {
    this.statements.get("insertJob").run(job.id, job.queue, pack2(job.data), job.priority, job.createdAt, job.runAt, job.attempts, job.maxAttempts, job.backoff, job.ttl, job.timeout, job.uniqueKey, job.customId, job.dependsOn.length > 0 ? pack2(job.dependsOn) : null, job.parentId, job.childrenIds.length > 0 ? pack2(job.childrenIds) : null, job.tags.length > 0 ? pack2(job.tags) : null, job.runAt > Date.now() ? "delayed" : "waiting", job.lifo ? 1 : 0, job.groupId, job.removeOnComplete ? 1 : 0, job.removeOnFail ? 1 : 0, job.stallTimeout, job.timeline.length > 0 ? pack2(job.timeline) : null);
  }
  flushIfBuffered(jobId2) {
    if (this.writeBuffer.hasPending(String(jobId2))) {
      try {
        this.writeBuffer.flush();
      } catch {}
    }
  }
  markActive(jobId2, startedAt, timeline) {
    this.flushIfBuffered(jobId2);
    this.safeWrite(() => {
      this.statements.get("updateJobState").run("active", startedAt, timeline && timeline.length > 0 ? pack2(timeline) : null, jobId2);
    });
  }
  markCompleted(jobId2, completedAt, timeline) {
    this.flushIfBuffered(jobId2);
    this.safeWrite(() => {
      this.statements.get("completeJob").run("completed", completedAt, timeline && timeline.length > 0 ? pack2(timeline) : null, jobId2);
    });
  }
  markFailed(job, error2) {
    this.flushIfBuffered(job.id);
    this.safeWrite(() => {
      this.statements.get("insertDlq").run(job.id, job.queue, pack2({ job, error: error2 }), Date.now());
    });
  }
  saveDlqEntry(entry) {
    this.safeWrite(() => {
      this.statements.get("insertDlq").run(entry.job.id, entry.job.queue, pack2(entry), entry.enteredAt);
    });
  }
  deleteDlqEntry(jobId2) {
    this.safeWrite(() => {
      this.statements.get("deleteDlqEntry").run(jobId2);
    });
  }
  clearDlqQueue(queue) {
    this.safeWrite(() => {
      this.statements.get("clearDlqQueue").run(queue);
    });
  }
  loadDlq() {
    const rows = this.statements.get("loadDlq").all();
    const result = new Map;
    for (const row of rows) {
      const entry = unpack2(row.entry, null, `loadDlq:${row.job_id}`);
      if (!entry?.job)
        continue;
      const reconstructedEntry = reconstructDlqEntry(entry);
      let queueEntries = result.get(row.queue);
      if (!queueEntries) {
        queueEntries = [];
        result.set(row.queue, queueEntries);
      }
      queueEntries.push(reconstructedEntry);
    }
    return result;
  }
  updateForRetry(job) {
    this.safeWrite(() => {
      this.db.prepare("UPDATE jobs SET attempts = ?, run_at = ?, state = ?, timeline = ?, stacktrace = ? WHERE id = ?").run(job.attempts, job.runAt, "waiting", job.timeline.length > 0 ? pack2(job.timeline) : null, job.stacktrace && job.stacktrace.length > 0 ? pack2(job.stacktrace) : null, job.id);
    });
  }
  deleteJob(jobId2) {
    this.writeBuffer.removePending(jobId2);
    this.safeWrite(() => {
      const deleteStmt = this.statements.get("deleteJob");
      const deleteResultStmt = this.statements.get("deleteJobResult");
      const tx = this.db.transaction((id) => {
        deleteStmt.run(id);
        deleteResultStmt.run(id);
      });
      tx(jobId2);
    });
  }
  updateJobData(jobId2, data) {
    this.safeWrite(() => {
      this.db.prepare("UPDATE jobs SET data = ? WHERE id = ?").run(pack2(data), jobId2);
    });
  }
  updateJobChildrenIds(jobId2, childrenIds) {
    this.safeWrite(() => {
      this.db.prepare("UPDATE jobs SET children_ids = ? WHERE id = ?").run(childrenIds.length > 0 ? pack2(childrenIds) : null, jobId2);
    });
  }
  getJob(id) {
    const row = this.statements.get("getJob").get(id);
    return row ? rowToJob(row) : null;
  }
  storeResult(jobId2, result) {
    this.safeWrite(() => {
      this.statements.get("insertResult").run(jobId2, pack2(result), Date.now());
    });
  }
  getResult(jobId2) {
    const row = this.statements.get("getResult").get(jobId2);
    return row ? unpack2(row.result, null, `getResult:${jobId2}`) : null;
  }
  hasResult(jobId2) {
    const row = this.db.query("SELECT job_id FROM job_results WHERE job_id = ?").get(String(jobId2));
    return row !== null;
  }
  hasDlqEntry(jobId2) {
    const row = this.db.query("SELECT job_id FROM dlq WHERE job_id = ? LIMIT 1").get(String(jobId2));
    return row !== null;
  }
  getDlqEntry(jobId2) {
    const row = this.db.query("SELECT entry FROM dlq WHERE job_id = ? ORDER BY entered_at DESC LIMIT 1").get(String(jobId2));
    if (!row)
      return null;
    const entry = unpack2(row.entry, null, `getDlqEntry:${String(jobId2)}`);
    return entry?.job ? reconstructDlqEntry(entry) : null;
  }
  loadDlqJobIds() {
    const rows = this.db.query("SELECT job_id FROM dlq").all();
    return new Set(rows.map((r) => r.job_id));
  }
  getJobStateRaw(jobId2) {
    const row = this.db.query("SELECT state FROM jobs WHERE id = ?").get(String(jobId2));
    return row?.state ?? null;
  }
  loadCompletedJobIds() {
    const rows = this.db.query("SELECT job_id FROM job_results").all();
    const ids = new Set(rows.map((r) => r.job_id));
    const stateRows = this.db.query("SELECT id FROM jobs WHERE state = 'completed'").all();
    for (const r of stateRows)
      ids.add(r.id);
    return ids;
  }
  insertJobsBatch(jobs, durable) {
    if (durable) {
      this.safeWrite(() => {
        const tx = this.db.transaction((batch) => {
          for (const job of batch)
            this.runInsertJobStmt(job);
        });
        tx(jobs);
      });
      return;
    }
    this.writeBuffer.addBatch(jobs);
  }
  queryJobs(queue, options) {
    const order = options.asc ? "ASC" : "DESC";
    let rows;
    if (options.states && options.states.length > 0) {
      const placeholders = options.states.map(() => "?").join(",");
      rows = this.db.query(`SELECT * FROM jobs WHERE queue = ? AND state IN (${placeholders}) ORDER BY created_at ${order} LIMIT ? OFFSET ?`).all(queue, ...options.states, options.limit, options.offset);
    } else if (options.state) {
      rows = this.db.query(`SELECT * FROM jobs WHERE queue = ? AND state = ? ORDER BY created_at ${order} LIMIT ? OFFSET ?`).all(queue, options.state, options.limit, options.offset);
    } else {
      rows = this.db.query(`SELECT * FROM jobs WHERE queue = ? ORDER BY created_at ${order} LIMIT ? OFFSET ?`).all(queue, options.limit, options.offset);
    }
    return rows.map((row) => rowToJob(row));
  }
  loadPendingJobs(limit = 1e4, offset = 0) {
    const rows = this.db.query("SELECT * FROM jobs WHERE state IN ('waiting', 'delayed') ORDER BY priority DESC, run_at ASC LIMIT ? OFFSET ?").all(limit, offset);
    return rows.map((row) => rowToJob(row));
  }
  loadActiveJobs(limit = 1e4, offset = 0) {
    const rows = this.db.query("SELECT * FROM jobs WHERE state = 'active' ORDER BY started_at ASC LIMIT ? OFFSET ?").all(limit, offset);
    return rows.map((row) => rowToJob(row));
  }
  loadCompletedJobs(limit = 1e4, offset = 0) {
    const rows = this.db.query("SELECT * FROM jobs WHERE state = 'completed' ORDER BY completed_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    return rows.map((row) => rowToJob(row));
  }
  countPendingJobs() {
    const result = this.db.query("SELECT COUNT(*) as count FROM jobs WHERE state IN ('waiting', 'delayed')").get();
    return result?.count ?? 0;
  }
  countActiveJobs() {
    const result = this.db.query("SELECT COUNT(*) as count FROM jobs WHERE state = 'active'").get();
    return result?.count ?? 0;
  }
  saveCron(cron) {
    this.safeWrite(() => {
      this.statements.get("insertCron").run(cron.name, cron.queue, pack2(cron.data), cron.schedule, cron.repeatEvery, cron.priority, cron.nextRun, cron.executions, cron.maxLimit, cron.timezone, cron.uniqueKey, cron.dedup ? pack2(cron.dedup) : null, cron.skipMissedOnRestart ? 1 : 0, cron.skipIfNoWorker ? 1 : 0, cron.preventOverlap ? 1 : 0, cron.jobOptions ? pack2(cron.jobOptions) : null);
    });
  }
  loadCronJobs() {
    const rows = this.db.query("SELECT * FROM cron_jobs").all();
    return rows.map((row) => ({
      name: row.name,
      queue: row.queue,
      data: unpack2(row.data, {}, `loadCronJobs:${row.name}`),
      schedule: row.schedule,
      repeatEvery: row.repeat_every,
      priority: row.priority,
      timezone: row.timezone,
      nextRun: row.next_run,
      executions: row.executions,
      maxLimit: row.max_limit,
      uniqueKey: row.unique_key ?? null,
      dedup: row.dedup ? unpack2(row.dedup, null, `loadCronDedup:${row.name}`) : null,
      skipMissedOnRestart: row.skip_missed_on_restart === 1,
      skipIfNoWorker: row.skip_if_no_worker === 1,
      preventOverlap: row.prevent_overlap === 1,
      jobOptions: row.job_options ? unpack2(row.job_options, null, `loadCronJobOptions:${row.name}`) : null
    }));
  }
  deleteCron(name) {
    this.safeWrite(() => {
      this.db.prepare("DELETE FROM cron_jobs WHERE name = ?").run(name);
    });
  }
  updateCron(name, executions, nextRun) {
    this.safeWrite(() => {
      this.statements.get("updateCron").run(executions, nextRun, name);
    });
  }
  saveQueueState(name, paused, rateLimit, concurrencyLimit) {
    this.safeWrite(() => {
      this.statements.get("upsertQueueState").run(name, paused ? 1 : 0, rateLimit, concurrencyLimit);
    });
  }
  loadQueueState() {
    const rows = this.statements.get("loadQueueState").all();
    return rows.map((row) => ({
      name: row.name,
      paused: row.paused === 1,
      rateLimit: row.rate_limit,
      concurrencyLimit: row.concurrency_limit
    }));
  }
  deleteQueueState(name) {
    this.safeWrite(() => {
      this.statements.get("deleteQueueState").run(name);
    });
  }
  close() {
    this.writeBuffer.stop();
    try {
      this.writeBuffer.flush();
    } catch (err) {
      storageLog.error("Failed to flush write buffer on close", {
        bufferedJobs: this.writeBuffer.pendingCount,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    try {
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      storageLog.error("WAL checkpoint failed on close", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
    this.db.close();
  }
  getSize() {
    const file = Bun.file(this.db.filename);
    return file.size;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/cron.js
function createCronJob(input, nextRun) {
  if (!input.schedule && !input.repeatEvery) {
    throw new Error("Cron job must have either schedule or repeatEvery");
  }
  return {
    name: input.name,
    queue: input.queue,
    data: input.data,
    schedule: input.schedule ?? null,
    repeatEvery: input.repeatEvery ?? null,
    priority: input.priority ?? 0,
    timezone: input.timezone ?? null,
    nextRun,
    executions: 0,
    maxLimit: input.maxLimit !== undefined && input.maxLimit > 0 ? input.maxLimit : null,
    uniqueKey: input.uniqueKey ?? null,
    dedup: input.dedup ?? null,
    skipMissedOnRestart: input.skipMissedOnRestart ?? true,
    skipIfNoWorker: input.skipIfNoWorker ?? false,
    preventOverlap: input.preventOverlap ?? true,
    jobOptions: input.jobOptions ?? null
  };
}
function isAtLimit(cron) {
  if (cron.maxLimit === null)
    return false;
  return cron.executions >= cron.maxLimit;
}

// ../../node_modules/.bun/croner@10.0.1/node_modules/croner/dist/croner.js
function T(s) {
  return Date.UTC(s.y, s.m - 1, s.d, s.h, s.i, s.s);
}
function D(s, e) {
  return s.y === e.y && s.m === e.m && s.d === e.d && s.h === e.h && s.i === e.i && s.s === e.s;
}
function A(s, e) {
  let t = new Date(Date.parse(s));
  if (isNaN(t))
    throw new Error("Invalid ISO8601 passed to timezone parser.");
  let r = s.substring(9);
  return r.includes("Z") || r.includes("+") || r.includes("-") ? b(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), "Etc/UTC") : b(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), e);
}
function v(s, e, t) {
  return k(A(s, e), t);
}
function k(s, e) {
  let t = new Date(T(s)), r = g(t, s.tz), n = T(s), i = T(r), a = n - i, o = new Date(t.getTime() + a), h = g(o, s.tz);
  if (D(h, s)) {
    let u = new Date(o.getTime() - 3600000), d = g(u, s.tz);
    return D(d, s) ? u : o;
  }
  let l = new Date(o.getTime() + T(s) - T(h)), y = g(l, s.tz);
  if (D(y, s))
    return l;
  if (e)
    throw new Error("Invalid date passed to fromTZ()");
  return o.getTime() > l.getTime() ? o : l;
}
function g(s, e) {
  let t, r;
  try {
    t = new Intl.DateTimeFormat("en-US", { timeZone: e, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }), r = t.formatToParts(s);
  } catch (i) {
    let a = i instanceof Error ? i.message : String(i);
    throw new RangeError(`toTZ: Invalid timezone '${e}' or date. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: ${a}`);
  }
  let n = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (let i of r)
    (i.type === "year" || i.type === "month" || i.type === "day" || i.type === "hour" || i.type === "minute" || i.type === "second") && (n[i.type] = parseInt(i.value, 10));
  if (isNaN(n.year) || isNaN(n.month) || isNaN(n.day) || isNaN(n.hour) || isNaN(n.minute) || isNaN(n.second))
    throw new Error(`toTZ: Failed to parse all date components from timezone '${e}'. This may indicate an invalid date or timezone configuration. Parsed components: ${JSON.stringify(n)}`);
  return n.hour === 24 && (n.hour = 0), { y: n.year, m: n.month, d: n.day, h: n.hour, i: n.minute, s: n.second, tz: e };
}
function b(s, e, t, r, n, i, a) {
  return { y: s, m: e, d: t, h: r, i: n, s: i, tz: a };
}
var O = [1, 2, 4, 8, 16];
var C = class {
  pattern;
  timezone;
  mode;
  alternativeWeekdays;
  sloppyRanges;
  second;
  minute;
  hour;
  day;
  month;
  dayOfWeek;
  year;
  lastDayOfMonth;
  lastWeekday;
  nearestWeekdays;
  starDOM;
  starDOW;
  starYear;
  useAndLogic;
  constructor(e, t, r) {
    this.pattern = e, this.timezone = t, this.mode = r?.mode ?? "auto", this.alternativeWeekdays = r?.alternativeWeekdays ?? false, this.sloppyRanges = r?.sloppyRanges ?? false, this.second = Array(60).fill(0), this.minute = Array(60).fill(0), this.hour = Array(24).fill(0), this.day = Array(31).fill(0), this.month = Array(12).fill(0), this.dayOfWeek = Array(7).fill(0), this.year = Array(1e4).fill(0), this.lastDayOfMonth = false, this.lastWeekday = false, this.nearestWeekdays = Array(31).fill(0), this.starDOM = false, this.starDOW = false, this.starYear = false, this.useAndLogic = false, this.parse();
  }
  parse() {
    if (!(typeof this.pattern == "string" || this.pattern instanceof String))
      throw new TypeError("CronPattern: Pattern has to be of type string.");
    this.pattern.indexOf("@") >= 0 && (this.pattern = this.handleNicknames(this.pattern).trim());
    let e = this.pattern.match(/\S+/g) || [""], t = e.length;
    if (e.length < 5 || e.length > 7)
      throw new TypeError("CronPattern: invalid configuration format ('" + this.pattern + "'), exactly five, six, or seven space separated parts are required.");
    if (this.mode !== "auto") {
      let n;
      switch (this.mode) {
        case "5-part":
          n = 5;
          break;
        case "6-part":
          n = 6;
          break;
        case "7-part":
          n = 7;
          break;
        case "5-or-6-parts":
          n = [5, 6];
          break;
        case "6-or-7-parts":
          n = [6, 7];
          break;
        default:
          n = 0;
      }
      if (!(Array.isArray(n) ? n.includes(t) : t === n)) {
        let a = Array.isArray(n) ? n.join(" or ") : n.toString();
        throw new TypeError(`CronPattern: mode '${this.mode}' requires exactly ${a} parts, but pattern '${this.pattern}' has ${t} parts.`);
      }
    }
    if (e.length === 5 && e.unshift("0"), e.length === 6 && e.push("*"), e[3].toUpperCase() === "LW" ? (this.lastWeekday = true, e[3] = "") : e[3].toUpperCase().indexOf("L") >= 0 && (e[3] = e[3].replace(/L/gi, ""), this.lastDayOfMonth = true), e[3] == "*" && (this.starDOM = true), e[6] == "*" && (this.starYear = true), e[4].length >= 3 && (e[4] = this.replaceAlphaMonths(e[4])), e[5].length >= 3 && (e[5] = this.alternativeWeekdays ? this.replaceAlphaDaysQuartz(e[5]) : this.replaceAlphaDays(e[5])), e[5].startsWith("+") && (this.useAndLogic = true, e[5] = e[5].substring(1), e[5] === ""))
      throw new TypeError("CronPattern: Day-of-week field cannot be empty after '+' modifier.");
    switch (e[5] == "*" && (this.starDOW = true), this.pattern.indexOf("?") >= 0 && (e[0] = e[0].replace(/\?/g, "*"), e[1] = e[1].replace(/\?/g, "*"), e[2] = e[2].replace(/\?/g, "*"), e[3] = e[3].replace(/\?/g, "*"), e[4] = e[4].replace(/\?/g, "*"), e[5] = e[5].replace(/\?/g, "*"), e[6] && (e[6] = e[6].replace(/\?/g, "*"))), this.mode) {
      case "5-part":
        e[0] = "0", e[6] = "*";
        break;
      case "6-part":
        e[6] = "*";
        break;
      case "5-or-6-parts":
        e[6] = "*";
        break;
      case "6-or-7-parts":
        break;
      case "7-part":
      case "auto":
        break;
    }
    this.throwAtIllegalCharacters(e), this.partToArray("second", e[0], 0, 1), this.partToArray("minute", e[1], 0, 1), this.partToArray("hour", e[2], 0, 1), this.partToArray("day", e[3], -1, 1), this.partToArray("month", e[4], -1, 1);
    let r = this.alternativeWeekdays ? -1 : 0;
    this.partToArray("dayOfWeek", e[5], r, 63), this.partToArray("year", e[6], 0, 1), !this.alternativeWeekdays && this.dayOfWeek[7] && (this.dayOfWeek[0] = this.dayOfWeek[7]);
  }
  partToArray(e, t, r, n) {
    let i = this[e], a = e === "day" && this.lastDayOfMonth, o = e === "day" && this.lastWeekday;
    if (t === "" && !a && !o)
      throw new TypeError("CronPattern: configuration entry " + e + " (" + t + ") is empty, check for trailing spaces.");
    if (t === "*")
      return i.fill(n);
    let h = t.split(",");
    if (h.length > 1)
      for (let l = 0;l < h.length; l++)
        this.partToArray(e, h[l], r, n);
    else
      t.indexOf("-") !== -1 && t.indexOf("/") !== -1 ? this.handleRangeWithStepping(t, e, r, n) : t.indexOf("-") !== -1 ? this.handleRange(t, e, r, n) : t.indexOf("/") !== -1 ? this.handleStepping(t, e, r, n) : t !== "" && this.handleNumber(t, e, r, n);
  }
  throwAtIllegalCharacters(e) {
    for (let t = 0;t < e.length; t++)
      if ((t === 3 ? /[^/*0-9,\-WwLl]+/ : t === 5 ? /[^/*0-9,\-#Ll]+/ : /[^/*0-9,\-]+/).test(e[t]))
        throw new TypeError("CronPattern: configuration entry " + t + " (" + e[t] + ") contains illegal characters.");
  }
  handleNumber(e, t, r, n) {
    let i = this.extractNth(e, t), a = e.toUpperCase().includes("W");
    if (t !== "day" && a)
      throw new TypeError("CronPattern: Nearest weekday modifier (W) only allowed in day-of-month.");
    a && (t = "nearestWeekdays");
    let o = parseInt(i[0], 10) + r;
    if (isNaN(o))
      throw new TypeError("CronPattern: " + t + " is not a number: '" + e + "'");
    this.setPart(t, o, i[1] || n);
  }
  setPart(e, t, r) {
    if (!Object.prototype.hasOwnProperty.call(this, e))
      throw new TypeError("CronPattern: Invalid part specified: " + e);
    if (e === "dayOfWeek") {
      if (t === 7 && (t = 0), t < 0 || t > 6)
        throw new RangeError("CronPattern: Invalid value for dayOfWeek: " + t);
      this.setNthWeekdayOfMonth(t, r);
      return;
    }
    if (e === "second" || e === "minute") {
      if (t < 0 || t >= 60)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "hour") {
      if (t < 0 || t >= 24)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "day" || e === "nearestWeekdays") {
      if (t < 0 || t >= 31)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "month") {
      if (t < 0 || t >= 12)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "year" && (t < 1 || t >= 1e4))
      throw new RangeError("CronPattern: Invalid value for " + e + ": " + t + " (supported range: 1-9999)");
    this[e][t] = r;
  }
  validateNotNaN(e, t) {
    if (isNaN(e))
      throw new TypeError(t);
  }
  validateRange(e, t, r, n, i) {
    if (e > t)
      throw new TypeError("CronPattern: From value is larger than to value: '" + i + "'");
    if (r !== undefined) {
      if (r === 0)
        throw new TypeError("CronPattern: Syntax error, illegal stepping: 0");
      if (r > this[n].length)
        throw new TypeError("CronPattern: Syntax error, steps cannot be greater than maximum value of part (" + this[n].length + ")");
    }
  }
  handleRangeWithStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in ranges with stepping.");
    let i = this.extractNth(e, t), a = i[0].match(/^(\d+)-(\d+)\/(\d+)$/);
    if (a === null)
      throw new TypeError("CronPattern: Syntax error, illegal range with stepping: '" + e + "'");
    let [, o, h, l] = a, y = parseInt(o, 10) + r, u = parseInt(h, 10) + r, d = parseInt(l, 10);
    this.validateNotNaN(y, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(u, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateNotNaN(d, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(y, u, d, t, e);
    for (let c = y;c <= u; c += d)
      this.setPart(t, c, i[1] || n);
  }
  extractNth(e, t) {
    let r = e, n;
    if (r.includes("#")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: nth (#) only allowed in day-of-week field");
      n = r.split("#")[1], r = r.split("#")[0];
    } else if (r.toUpperCase().endsWith("L")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: L modifier only allowed in day-of-week field (use L alone for day-of-month)");
      n = "L", r = r.slice(0, -1);
    }
    return [r, n];
  }
  handleRange(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in a range.");
    let i = this.extractNth(e, t), a = i[0].split("-");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal range: '" + e + "'");
    let o = parseInt(a[0], 10) + r, h = parseInt(a[1], 10) + r;
    this.validateNotNaN(o, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(h, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateRange(o, h, undefined, t, e);
    for (let l = o;l <= h; l++)
      this.setPart(t, l, i[1] || n);
  }
  handleStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in parts with stepping.");
    let i = this.extractNth(e, t), a = i[0].split("/");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal stepping: '" + e + "'");
    if (this.sloppyRanges)
      a[0] === "" && (a[0] = "*");
    else {
      if (a[0] === "")
        throw new TypeError("CronPattern: Syntax error, stepping with missing prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
      if (a[0] !== "*")
        throw new TypeError("CronPattern: Syntax error, stepping with numeric prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
    }
    let o = 0;
    a[0] !== "*" && (o = parseInt(a[0], 10) + r);
    let h = parseInt(a[1], 10);
    this.validateNotNaN(h, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(0, this[t].length - 1, h, t, e);
    for (let l = o;l < this[t].length; l += h)
      this.setPart(t, l, i[1] || n);
  }
  replaceAlphaDays(e) {
    return e.replace(/-sun/gi, "-7").replace(/sun/gi, "0").replace(/mon/gi, "1").replace(/tue/gi, "2").replace(/wed/gi, "3").replace(/thu/gi, "4").replace(/fri/gi, "5").replace(/sat/gi, "6");
  }
  replaceAlphaDaysQuartz(e) {
    return e.replace(/sun/gi, "1").replace(/mon/gi, "2").replace(/tue/gi, "3").replace(/wed/gi, "4").replace(/thu/gi, "5").replace(/fri/gi, "6").replace(/sat/gi, "7");
  }
  replaceAlphaMonths(e) {
    return e.replace(/jan/gi, "1").replace(/feb/gi, "2").replace(/mar/gi, "3").replace(/apr/gi, "4").replace(/may/gi, "5").replace(/jun/gi, "6").replace(/jul/gi, "7").replace(/aug/gi, "8").replace(/sep/gi, "9").replace(/oct/gi, "10").replace(/nov/gi, "11").replace(/dec/gi, "12");
  }
  handleNicknames(e) {
    let t = e.trim().toLowerCase();
    if (t === "@yearly" || t === "@annually")
      return "0 0 1 1 *";
    if (t === "@monthly")
      return "0 0 1 * *";
    if (t === "@weekly")
      return "0 0 * * 0";
    if (t === "@daily" || t === "@midnight")
      return "0 0 * * *";
    if (t === "@hourly")
      return "0 * * * *";
    if (t === "@reboot")
      throw new TypeError("CronPattern: @reboot is not supported in this environment. This is an event-based trigger that requires system startup detection.");
    return e;
  }
  setNthWeekdayOfMonth(e, t) {
    if (typeof t != "number" && t.toUpperCase() === "L")
      this.dayOfWeek[e] = this.dayOfWeek[e] | 32;
    else if (t === 63)
      this.dayOfWeek[e] = 63;
    else if (t < 6 && t > 0)
      this.dayOfWeek[e] = this.dayOfWeek[e] | O[t - 1];
    else
      throw new TypeError(`CronPattern: nth weekday out of range, should be 1-5 or L. Value: ${t}, Type: ${typeof t}`);
  }
};
var P = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var f = [["month", "year", 0], ["day", "month", -1], ["hour", "day", 0], ["minute", "hour", 0], ["second", "minute", 0]];
var m = class s {
  tz;
  ms;
  second;
  minute;
  hour;
  day;
  month;
  year;
  constructor(e, t) {
    if (this.tz = t, e && e instanceof Date)
      if (!isNaN(e))
        this.fromDate(e);
      else
        throw new TypeError("CronDate: Invalid date passed to CronDate constructor");
    else if (e == null)
      this.fromDate(new Date);
    else if (e && typeof e == "string")
      this.fromString(e);
    else if (e instanceof s)
      this.fromCronDate(e);
    else
      throw new TypeError("CronDate: Invalid type (" + typeof e + ") passed to CronDate constructor");
  }
  getLastDayOfMonth(e, t) {
    return t !== 1 ? P[t] : new Date(Date.UTC(e, t + 1, 0)).getUTCDate();
  }
  getLastWeekday(e, t) {
    let r = this.getLastDayOfMonth(e, t), i = new Date(Date.UTC(e, t, r)).getUTCDay();
    return i === 0 ? r - 2 : i === 6 ? r - 1 : r;
  }
  getNearestWeekday(e, t, r) {
    let n = this.getLastDayOfMonth(e, t);
    if (r > n)
      return -1;
    let a = new Date(Date.UTC(e, t, r)).getUTCDay();
    return a === 0 ? r === n ? r - 2 : r + 1 : a === 6 ? r === 1 ? r + 2 : r - 1 : r;
  }
  isNthWeekdayOfMonth(e, t, r, n) {
    let a = new Date(Date.UTC(e, t, r)).getUTCDay(), o = 0;
    for (let h = 1;h <= r; h++)
      new Date(Date.UTC(e, t, h)).getUTCDay() === a && o++;
    if (n & 63 && O[o - 1] & n)
      return true;
    if (n & 32) {
      let h = this.getLastDayOfMonth(e, t);
      for (let l = r + 1;l <= h; l++)
        if (new Date(Date.UTC(e, t, l)).getUTCDay() === a)
          return false;
      return true;
    }
    return false;
  }
  fromDate(e) {
    if (this.tz !== undefined)
      if (typeof this.tz == "number")
        this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes() + this.tz, this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), this.apply();
      else
        try {
          let t = g(e, this.tz);
          this.ms = e.getMilliseconds(), this.second = t.s, this.minute = t.i, this.hour = t.h, this.day = t.d, this.month = t.m - 1, this.year = t.y;
        } catch (t) {
          let r = t instanceof Error ? t.message : String(t);
          throw new TypeError(`CronDate: Failed to convert date to timezone '${this.tz}'. This may happen with invalid timezone names or dates. Original error: ${r}`);
        }
    else
      this.ms = e.getMilliseconds(), this.second = e.getSeconds(), this.minute = e.getMinutes(), this.hour = e.getHours(), this.day = e.getDate(), this.month = e.getMonth(), this.year = e.getFullYear();
  }
  fromCronDate(e) {
    this.tz = e.tz, this.year = e.year, this.month = e.month, this.day = e.day, this.hour = e.hour, this.minute = e.minute, this.second = e.second, this.ms = e.ms;
  }
  apply() {
    if (this.month > 11 || this.month < 0 || this.day > P[this.month] || this.day < 1 || this.hour > 59 || this.minute > 59 || this.second > 59 || this.hour < 0 || this.minute < 0 || this.second < 0) {
      let e = new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms));
      return this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes(), this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), true;
    } else
      return false;
  }
  fromString(e) {
    if (typeof this.tz == "number") {
      let t = v(e);
      this.ms = t.getUTCMilliseconds(), this.second = t.getUTCSeconds(), this.minute = t.getUTCMinutes(), this.hour = t.getUTCHours(), this.day = t.getUTCDate(), this.month = t.getUTCMonth(), this.year = t.getUTCFullYear(), this.apply();
    } else
      return this.fromDate(v(e, this.tz));
  }
  findNext(e, t, r, n) {
    return this._findMatch(e, t, r, n, 1);
  }
  _findMatch(e, t, r, n, i) {
    let a = this[t], o;
    r.lastDayOfMonth && (o = this.getLastDayOfMonth(this.year, this.month));
    let h = !r.starDOW && t == "day" ? new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay() : undefined, l = this[t] + n, y = i === 1 ? (u) => u < r[t].length : (u) => u >= 0;
    for (let u = l;y(u); u += i) {
      let d = r[t][u];
      if (t === "day" && !d) {
        for (let c = 0;c < r.nearestWeekdays.length; c++)
          if (r.nearestWeekdays[c]) {
            let M = this.getNearestWeekday(this.year, this.month, c - n);
            if (M === -1)
              continue;
            if (M === u - n) {
              d = 1;
              break;
            }
          }
      }
      if (t === "day" && r.lastWeekday) {
        let c = this.getLastWeekday(this.year, this.month);
        u - n === c && (d = 1);
      }
      if (t === "day" && r.lastDayOfMonth && u - n == o && (d = 1), t === "day" && !r.starDOW) {
        let c = r.dayOfWeek[(h + (u - n - 1)) % 7];
        if (c && c & 63)
          c = this.isNthWeekdayOfMonth(this.year, this.month, u - n, c) ? 1 : 0;
        else if (c)
          throw new Error(`CronDate: Invalid value for dayOfWeek encountered. ${c}`);
        r.useAndLogic ? d = d && c : !e.domAndDow && !r.starDOM ? d = d || c : d = d && c;
      }
      if (d)
        return this[t] = u - n, a !== this[t] ? 2 : 1;
    }
    return 3;
  }
  recurse(e, t, r) {
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let i = -1;
        for (let a = this.year + 1;a < e.year.length && a < 1e4; a++)
          if (e.year[a] === 1) {
            i = a;
            break;
          }
        if (i === -1)
          return null;
        this.year = i, this.month = 0, this.day = 1, this.hour = 0, this.minute = 0, this.second = 0, this.ms = 0;
      }
      if (this.year >= 1e4)
        return null;
    }
    let n = this.findNext(t, f[r][0], e, f[r][2]);
    if (n > 1) {
      let i = r + 1;
      for (;i < f.length; )
        this[f[i][0]] = -f[i][2], i++;
      if (n === 3) {
        if (this[f[r][1]]++, this[f[r][0]] = -f[r][2], this.apply(), r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0 && this.year < 1e4; )
            this.year++;
          if (this.year >= 1e4 || this.year >= e.year.length)
            return null;
        }
        return this.recurse(e, t, 0);
      } else if (this.apply())
        return this.recurse(e, t, r - 1);
    }
    return r += 1, r >= f.length ? this : (e.starYear ? this.year >= 3000 : this.year >= 1e4) ? null : this.recurse(e, t, r);
  }
  increment(e, t, r) {
    return this.second += t.interval !== undefined && t.interval > 1 && r ? t.interval : 1, this.ms = 0, this.apply(), this.recurse(e, t, 0);
  }
  decrement(e, t) {
    return this.second -= t.interval !== undefined && t.interval > 1 ? t.interval : 1, this.ms = 0, this.apply(), this.recurseBackward(e, t, 0, 0);
  }
  recurseBackward(e, t, r, n = 0) {
    if (n > 1e4)
      return null;
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let a = -1;
        for (let o = this.year - 1;o >= 0; o--)
          if (e.year[o] === 1) {
            a = o;
            break;
          }
        if (a === -1)
          return null;
        this.year = a, this.month = 11, this.day = 31, this.hour = 23, this.minute = 59, this.second = 59, this.ms = 0;
      }
      if (this.year < 0)
        return null;
    }
    let i = this.findPrevious(t, f[r][0], e, f[r][2]);
    if (i > 1) {
      let a = r + 1;
      for (;a < f.length; ) {
        let o = f[a][0], h = f[a][2], l = this.getMaxPatternValue(o, e, h);
        this[o] = l, a++;
      }
      if (i === 3) {
        if (this[f[r][1]]--, r === 0) {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this.day > y && (this.day = y);
        }
        if (r === 1)
          if (this.day <= 0)
            this.day = 1;
          else {
            let y = this.year, u = this.month;
            for (;u < 0; )
              u += 12, y--;
            for (;u > 11; )
              u -= 12, y++;
            let d = u !== 1 ? P[u] : new Date(Date.UTC(y, u + 1, 0)).getUTCDate();
            this.day > d && (this.day = d);
          }
        this.apply();
        let o = f[r][0], h = f[r][2], l = this.getMaxPatternValue(o, e, h);
        if (o === "day") {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this[o] = Math.min(l, y);
        } else
          this[o] = l;
        if (this.apply(), r === 0) {
          let y = f[1][2], u = this.getMaxPatternValue("day", e, y), d = this.getLastDayOfMonth(this.year, this.month), c = Math.min(u, d);
          c !== this.day && (this.day = c, this.hour = this.getMaxPatternValue("hour", e, f[2][2]), this.minute = this.getMaxPatternValue("minute", e, f[3][2]), this.second = this.getMaxPatternValue("second", e, f[4][2]));
        }
        if (r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0; )
            this.year--;
          if (this.year < 0)
            return null;
        }
        return this.recurseBackward(e, t, 0, n + 1);
      } else if (this.apply())
        return this.recurseBackward(e, t, r - 1, n + 1);
    }
    return r += 1, r >= f.length ? this : this.year < 0 ? null : this.recurseBackward(e, t, r, n + 1);
  }
  getMaxPatternValue(e, t, r) {
    if (e === "day" && t.lastDayOfMonth)
      return this.getLastDayOfMonth(this.year, this.month);
    if (e === "day" && !t.starDOW)
      return this.getLastDayOfMonth(this.year, this.month);
    for (let n = t[e].length - 1;n >= 0; n--)
      if (t[e][n])
        return n - r;
    return t[e].length - 1 - r;
  }
  findPrevious(e, t, r, n) {
    return this._findMatch(e, t, r, n, -1);
  }
  getDate(e) {
    return e || this.tz === undefined ? new Date(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms) : typeof this.tz == "number" ? new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute - this.tz, this.second, this.ms)) : k(b(this.year, this.month + 1, this.day, this.hour, this.minute, this.second, this.tz), false);
  }
  getTime() {
    return this.getDate(false).getTime();
  }
  match(e, t) {
    if (!e.starYear && (this.year < 0 || this.year >= e.year.length || e.year[this.year] === 0))
      return false;
    for (let r = 0;r < f.length; r++) {
      let n = f[r][0], i = f[r][2], a = this[n];
      if (a + i < 0 || a + i >= e[n].length)
        return false;
      let o = e[n][a + i];
      if (n === "day") {
        if (!o) {
          for (let h = 0;h < e.nearestWeekdays.length; h++)
            if (e.nearestWeekdays[h]) {
              let l = this.getNearestWeekday(this.year, this.month, h - i);
              if (l !== -1 && l === a) {
                o = 1;
                break;
              }
            }
        }
        if (e.lastWeekday) {
          let h = this.getLastWeekday(this.year, this.month);
          a === h && (o = 1);
        }
        if (e.lastDayOfMonth) {
          let h = this.getLastDayOfMonth(this.year, this.month);
          a === h && (o = 1);
        }
        if (!e.starDOW) {
          let h = new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay(), l = e.dayOfWeek[(h + (a - 1)) % 7];
          l && l & 63 && (l = this.isNthWeekdayOfMonth(this.year, this.month, a, l) ? 1 : 0), e.useAndLogic ? o = o && l : !t.domAndDow && !e.starDOM ? o = o || l : o = o && l;
        }
      }
      if (!o)
        return false;
    }
    return true;
  }
};
function R(s2) {
  if (s2 === undefined && (s2 = {}), delete s2.name, s2.legacyMode !== undefined && s2.domAndDow === undefined ? s2.domAndDow = !s2.legacyMode : s2.domAndDow === undefined && (s2.domAndDow = false), s2.legacyMode = !s2.domAndDow, s2.paused = s2.paused === undefined ? false : s2.paused, s2.maxRuns = s2.maxRuns === undefined ? 1 / 0 : s2.maxRuns, s2.catch = s2.catch === undefined ? false : s2.catch, s2.interval = s2.interval === undefined ? 0 : parseInt(s2.interval.toString(), 10), s2.utcOffset = s2.utcOffset === undefined ? undefined : parseInt(s2.utcOffset.toString(), 10), s2.dayOffset = s2.dayOffset === undefined ? 0 : parseInt(s2.dayOffset.toString(), 10), s2.unref = s2.unref === undefined ? false : s2.unref, s2.mode = s2.mode === undefined ? "auto" : s2.mode, s2.alternativeWeekdays = s2.alternativeWeekdays === undefined ? false : s2.alternativeWeekdays, s2.sloppyRanges = s2.sloppyRanges === undefined ? false : s2.sloppyRanges, !["auto", "5-part", "6-part", "7-part", "5-or-6-parts", "6-or-7-parts"].includes(s2.mode))
    throw new Error("CronOptions: mode must be one of 'auto', '5-part', '6-part', '7-part', '5-or-6-parts', or '6-or-7-parts'.");
  if (s2.startAt && (s2.startAt = new m(s2.startAt, s2.timezone)), s2.stopAt && (s2.stopAt = new m(s2.stopAt, s2.timezone)), s2.interval !== null) {
    if (isNaN(s2.interval))
      throw new Error("CronOptions: Supplied value for interval is not a number");
    if (s2.interval < 0)
      throw new Error("CronOptions: Supplied value for interval can not be negative");
  }
  if (s2.utcOffset !== undefined) {
    if (isNaN(s2.utcOffset))
      throw new Error("CronOptions: Invalid value passed for utcOffset, should be number representing minutes offset from UTC.");
    if (s2.utcOffset < -870 || s2.utcOffset > 870)
      throw new Error("CronOptions: utcOffset out of bounds.");
    if (s2.utcOffset !== undefined && s2.timezone)
      throw new Error("CronOptions: Combining 'utcOffset' with 'timezone' is not allowed.");
  }
  if (s2.unref !== true && s2.unref !== false)
    throw new Error("CronOptions: Unref should be either true, false or undefined(false).");
  if (s2.dayOffset !== undefined && s2.dayOffset !== 0 && isNaN(s2.dayOffset))
    throw new Error("CronOptions: Invalid value passed for dayOffset, should be a number representing days to offset.");
  return s2;
}
function p(s2) {
  return Object.prototype.toString.call(s2) === "[object Function]" || typeof s2 == "function" || s2 instanceof Function;
}
function _(s2) {
  return p(s2);
}
function x(s2) {
  typeof Deno < "u" && typeof Deno.unrefTimer < "u" ? Deno.unrefTimer(s2) : s2 && typeof s2.unref < "u" && s2.unref();
}
var W = 30 * 1000;
var w = [];
var E = class {
  name;
  options;
  _states;
  fn;
  getTz() {
    return this.options.timezone || this.options.utcOffset;
  }
  applyDayOffset(e) {
    if (this.options.dayOffset !== undefined && this.options.dayOffset !== 0) {
      let t = this.options.dayOffset * 24 * 60 * 60 * 1000;
      return new Date(e.getTime() + t);
    }
    return e;
  }
  constructor(e, t, r) {
    let n, i;
    if (p(t))
      i = t;
    else if (typeof t == "object")
      n = t;
    else if (t !== undefined)
      throw new Error("Cron: Invalid argument passed for optionsIn. Should be one of function, or object (options).");
    if (p(r))
      i = r;
    else if (typeof r == "object")
      n = r;
    else if (r !== undefined)
      throw new Error("Cron: Invalid argument passed for funcIn. Should be one of function, or object (options).");
    if (this.name = n?.name, this.options = R(n), this._states = { kill: false, blocking: false, previousRun: undefined, currentRun: undefined, once: undefined, currentTimeout: undefined, maxRuns: n ? n.maxRuns : undefined, paused: n ? n.paused : false, pattern: new C("* * * * *", undefined, { mode: "auto" }) }, e && (e instanceof Date || typeof e == "string" && e.indexOf(":") > 0) ? this._states.once = new m(e, this.getTz()) : this._states.pattern = new C(e, this.options.timezone, { mode: this.options.mode, alternativeWeekdays: this.options.alternativeWeekdays, sloppyRanges: this.options.sloppyRanges }), this.name) {
      if (w.find((o) => o.name === this.name))
        throw new Error("Cron: Tried to initialize new named job '" + this.name + "', but name already taken.");
      w.push(this);
    }
    return i !== undefined && _(i) && (this.fn = i, this.schedule()), this;
  }
  nextRun(e) {
    let t = this._next(e);
    return t ? this.applyDayOffset(t.getDate(false)) : null;
  }
  nextRuns(e, t) {
    this._states.maxRuns !== undefined && e > this._states.maxRuns && (e = this._states.maxRuns);
    let r = t || this._states.currentRun || undefined;
    return this._enumerateRuns(e, r, "next");
  }
  previousRuns(e, t) {
    return this._enumerateRuns(e, t || undefined, "previous");
  }
  _enumerateRuns(e, t, r) {
    let n = [], i = t ? new m(t, this.getTz()) : null, a = r === "next" ? this._next : this._previous;
    for (;e--; ) {
      let o = a.call(this, i);
      if (!o)
        break;
      let h = o.getDate(false);
      n.push(this.applyDayOffset(h)), i = o;
    }
    return n;
  }
  match(e) {
    if (this._states.once) {
      let r = new m(e, this.getTz());
      r.ms = 0;
      let n = new m(this._states.once, this.getTz());
      return n.ms = 0, r.getTime() === n.getTime();
    }
    let t = new m(e, this.getTz());
    return t.ms = 0, t.match(this._states.pattern, this.options);
  }
  getPattern() {
    if (!this._states.once)
      return this._states.pattern ? this._states.pattern.pattern : undefined;
  }
  getOnce() {
    return this._states.once ? this._states.once.getDate() : null;
  }
  isRunning() {
    let e = this.nextRun(this._states.currentRun), t = !this._states.paused, r = this.fn !== undefined, n = !this._states.kill;
    return t && r && n && e !== null;
  }
  isStopped() {
    return this._states.kill;
  }
  isBusy() {
    return this._states.blocking;
  }
  currentRun() {
    return this._states.currentRun ? this._states.currentRun.getDate() : null;
  }
  previousRun() {
    return this._states.previousRun ? this._states.previousRun.getDate() : null;
  }
  msToNext(e) {
    let t = this._next(e);
    return t ? e instanceof m || e instanceof Date ? t.getTime() - e.getTime() : t.getTime() - new m(e).getTime() : null;
  }
  stop() {
    this._states.kill = true, this._states.currentTimeout && clearTimeout(this._states.currentTimeout);
    let e = w.indexOf(this);
    e >= 0 && w.splice(e, 1);
  }
  pause() {
    return this._states.paused = true, !this._states.kill;
  }
  resume() {
    return this._states.paused = false, !this._states.kill;
  }
  schedule(e) {
    if (e && this.fn)
      throw new Error("Cron: It is not allowed to schedule two functions using the same Croner instance.");
    e && (this.fn = e);
    let t = this.msToNext(), r = this.nextRun(this._states.currentRun);
    return t == null || isNaN(t) || r === null ? this : (t > W && (t = W), this._states.currentTimeout = setTimeout(() => this._checkTrigger(r), t), this._states.currentTimeout && this.options.unref && x(this._states.currentTimeout), this);
  }
  async _trigger(e) {
    this._states.blocking = true, this._states.currentRun = new m(undefined, this.getTz());
    try {
      if (this.options.catch)
        try {
          this.fn !== undefined && await this.fn(this, this.options.context);
        } catch (t) {
          if (p(this.options.catch))
            try {
              this.options.catch(t, this);
            } catch {}
        }
      else
        this.fn !== undefined && await this.fn(this, this.options.context);
    } finally {
      this._states.previousRun = new m(e, this.getTz()), this._states.blocking = false;
    }
  }
  async trigger() {
    await this._trigger();
  }
  runsLeft() {
    return this._states.maxRuns;
  }
  _checkTrigger(e) {
    let t = new Date, r = !this._states.paused && t.getTime() >= e.getTime(), n = this._states.blocking && this.options.protect;
    r && !n ? (this._states.maxRuns !== undefined && this._states.maxRuns--, this._trigger()) : r && n && p(this.options.protect) && setTimeout(() => this.options.protect(this), 0), this.schedule();
  }
  _next(e) {
    let t = !!(e || this._states.currentRun), r = false;
    !e && this.options.startAt && this.options.interval && ([e, t] = this._calculatePreviousRun(e, t), r = !e), e = new m(e, this.getTz()), this.options.startAt && e && e.getTime() < this.options.startAt.getTime() && (e = this.options.startAt);
    let n = this._states.once || new m(e, this.getTz());
    return !r && n !== this._states.once && (n = n.increment(this._states.pattern, this.options, t)), this._states.once && this._states.once.getTime() <= e.getTime() || n === null || this._states.maxRuns !== undefined && this._states.maxRuns <= 0 || this._states.kill || this.options.stopAt && n.getTime() >= this.options.stopAt.getTime() ? null : n;
  }
  _previous(e) {
    let t = new m(e, this.getTz());
    this.options.stopAt && t.getTime() > this.options.stopAt.getTime() && (t = this.options.stopAt);
    let r = new m(t, this.getTz());
    return this._states.once ? this._states.once.getTime() < t.getTime() ? this._states.once : null : (r = r.decrement(this._states.pattern, this.options), r === null || this.options.startAt && r.getTime() < this.options.startAt.getTime() ? null : r);
  }
  _calculatePreviousRun(e, t) {
    let r = new m(undefined, this.getTz()), n = e;
    if (this.options.startAt.getTime() <= r.getTime()) {
      n = this.options.startAt;
      let i = n.getTime() + this.options.interval * 1000;
      for (;i <= r.getTime(); )
        n = new m(n, this.getTz()).increment(this._states.pattern, this.options, true), i = n.getTime() + this.options.interval * 1000;
      t = true;
    }
    return n === null && (n = undefined), [n, t];
  }
};

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/scheduler/cronParser.js
function validateCronExpression(expression, timezone) {
  try {
    new E(expression, { timezone });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid cron expression";
  }
}
function getNextCronRun(expression, fromTime = Date.now(), timezone) {
  const cron = new E(expression, { timezone });
  const nextDate = cron.nextRun(new Date(fromTime));
  return nextDate ? nextDate.getTime() : 0;
}
function getNextIntervalRun(intervalMs, lastRun = Date.now()) {
  return lastRun + intervalMs;
}
var CRON_SHORTCUTS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *"
};
function expandCronShortcut(expression) {
  const trimmed = expression.trim().toLowerCase();
  return CRON_SHORTCUTS[trimmed] ?? expression;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/infrastructure/scheduler/cronScheduler.js
var SAFETY_FALLBACK_MS = 60000;

class CronScheduler {
  cronJobs = new Map;
  cronHeap = new MinHeap((a, b2) => a.cron.nextRun - b2.cron.nextRun);
  generation = 0;
  nextTimer = null;
  safetyInterval = null;
  started = false;
  pushJob = null;
  persistCron = null;
  hasWorkers = null;
  dashboardEmit = null;
  lastFiredAt = new Map;
  constructor(_config) {}
  setPushCallback(callback) {
    this.pushJob = callback;
  }
  setPersistCallback(callback) {
    this.persistCron = callback;
  }
  setWorkerCheckCallback(callback) {
    this.hasWorkers = callback;
  }
  setDashboardEmit(callback) {
    this.dashboardEmit = callback;
  }
  start() {
    if (this.started)
      return;
    this.started = true;
    this.safetyInterval = setInterval(() => {
      this.tick();
    }, SAFETY_FALLBACK_MS);
    this.scheduleNext();
  }
  stop() {
    this.started = false;
    if (this.nextTimer !== null) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    if (this.safetyInterval !== null) {
      clearInterval(this.safetyInterval);
      this.safetyInterval = null;
    }
  }
  add(input) {
    if (!input.schedule && !input.repeatEvery) {
      throw new Error("Cron job must have either schedule or repeatEvery");
    }
    if (input.schedule) {
      const expanded = expandCronShortcut(input.schedule);
      const error2 = validateCronExpression(expanded, input.timezone);
      if (error2) {
        throw new Error(`Invalid cron expression: ${error2}`);
      }
    }
    const now = Date.now();
    let nextRun;
    if (input.schedule) {
      const expanded = expandCronShortcut(input.schedule);
      nextRun = getNextCronRun(expanded, now, input.timezone);
    } else {
      nextRun = getNextIntervalRun(input.repeatEvery, now);
    }
    const cron = createCronJob(input, nextRun);
    const existing = this.cronJobs.get(cron.name);
    if (existing) {
      cron.executions = existing.cron.executions;
      this.lastFiredAt.delete(cron.name);
    }
    if (input.immediately && !existing) {
      cron.nextRun = Date.now();
    }
    const gen = this.generation++;
    this.cronJobs.set(cron.name, { cron, generation: gen });
    this.cronHeap.push({ cron, generation: gen });
    if (this.started) {
      this.scheduleNext();
    }
    return cron;
  }
  remove(name) {
    const entry = this.cronJobs.get(name);
    if (!entry)
      return false;
    this.cronJobs.delete(name);
    this.lastFiredAt.delete(name);
    if (this.started) {
      this.scheduleNext();
    }
    return true;
  }
  get(name) {
    return this.cronJobs.get(name)?.cron;
  }
  list() {
    return Array.from(this.cronJobs.values()).map((e) => e.cron);
  }
  load(crons) {
    const now = Date.now();
    const entries = [];
    for (const cron of crons) {
      if ((cron.skipMissedOnRestart || cron.skipIfNoWorker) && cron.nextRun < now) {
        if (cron.schedule) {
          cron.nextRun = getNextCronRun(cron.schedule, now, cron.timezone ?? undefined);
        } else if (cron.repeatEvery) {
          cron.nextRun = getNextIntervalRun(cron.repeatEvery, now);
        }
        this.persistCron?.(cron.name, cron.executions, cron.nextRun);
      }
      const gen = this.generation++;
      this.cronJobs.set(cron.name, { cron, generation: gen });
      entries.push({ cron, generation: gen });
    }
    this.cronHeap.buildFrom(entries);
    if (this.started) {
      this.scheduleNext();
    }
  }
  scheduleNext() {
    if (!this.started)
      return;
    if (this.nextTimer !== null) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    while (!this.cronHeap.isEmpty) {
      const entry = this.cronHeap.peek();
      if (!entry)
        return;
      if (this.cronJobs.get(entry.cron.name)?.generation !== entry.generation) {
        this.cronHeap.pop();
        continue;
      }
      const delay = Math.max(0, entry.cron.nextRun - Date.now());
      this.nextTimer = setTimeout(() => {
        this.nextTimer = null;
        this.tick();
      }, delay);
      return;
    }
  }
  async tick() {
    if (!this.pushJob)
      return;
    const now = Date.now();
    const toReinsert = [];
    const toRemove = [];
    while (!this.cronHeap.isEmpty) {
      const entry = this.cronHeap.peek();
      if (!entry || entry.cron.nextRun > now)
        break;
      this.cronHeap.pop();
      const current = this.cronJobs.get(entry.cron.name);
      if (current?.generation !== entry.generation) {
        continue;
      }
      const cron = entry.cron;
      if (isAtLimit(cron)) {
        toRemove.push(cron.name);
        continue;
      }
      try {
        const newExecutions = cron.executions + 1;
        const executionTime = Date.now();
        const scheduledRun = cron.nextRun;
        let newNextRun;
        if (cron.schedule) {
          const expanded = expandCronShortcut(cron.schedule);
          newNextRun = getNextCronRun(expanded, executionTime, cron.timezone ?? undefined);
        } else if (cron.repeatEvery) {
          newNextRun = getNextIntervalRun(cron.repeatEvery, scheduledRun);
        } else {
          newNextRun = executionTime;
        }
        if (this.persistCron) {
          try {
            this.persistCron(cron.name, newExecutions, newNextRun);
          } catch (persistErr) {
            cronLog.error("Failed to persist cron state, skipping job push", {
              name: cron.name,
              error: String(persistErr)
            });
            this.dashboardEmit?.("cron:missed", {
              name: cron.name,
              queue: cron.queue,
              error: String(persistErr)
            });
            toReinsert.push(entry);
            continue;
          }
        }
        cron.executions = newExecutions;
        cron.nextRun = newNextRun;
        await this.fireCronJob(cron, now);
        toReinsert.push(entry);
      } catch (err) {
        cronLog.error("Failed to push cron job (state already persisted)", {
          name: cron.name,
          error: String(err)
        });
        this.dashboardEmit?.("cron:missed", {
          name: cron.name,
          queue: cron.queue,
          error: String(err)
        });
        toReinsert.push(entry);
      }
    }
    for (const entry of toReinsert) {
      this.cronHeap.push(entry);
    }
    for (const name of toRemove) {
      this.cronJobs.delete(name);
    }
    this.scheduleNext();
  }
  async fireCronJob(cron, now) {
    if (cron.skipIfNoWorker && this.hasWorkers && !this.hasWorkers(cron.queue)) {
      this.dashboardEmit?.("cron:skipped", {
        name: cron.name,
        queue: cron.queue,
        reason: "no-worker"
      });
      return;
    }
    const lastFire = this.lastFiredAt.get(cron.name);
    const interval = cron.repeatEvery ?? 60000;
    if (lastFire && now - lastFire < interval * 0.8) {
      this.dashboardEmit?.("cron:skipped", {
        name: cron.name,
        queue: cron.queue,
        reason: "overlap"
      });
      return;
    }
    const effectiveUniqueKey = cron.uniqueKey ?? (cron.preventOverlap ? `cron:${cron.name}` : undefined);
    const opts = cron.jobOptions;
    await this.pushJob(cron.queue, {
      data: cron.data,
      priority: cron.priority,
      uniqueKey: effectiveUniqueKey,
      dedup: cron.dedup ?? undefined,
      maxAttempts: opts?.maxAttempts,
      backoff: opts?.backoff,
      timeout: opts?.timeout,
      delay: opts?.delay,
      stallTimeout: opts?.stallTimeout,
      removeOnComplete: opts?.removeOnComplete,
      removeOnFail: opts?.removeOnFail
    });
    this.lastFiredAt.set(cron.name, now);
    this.dashboardEmit?.("cron:fired", { name: cron.name, queue: cron.queue });
  }
  getStats() {
    let nextRun = null;
    const entry = this.cronHeap.peek();
    if (entry) {
      const current = this.cronJobs.get(entry.cron.name);
      if (current?.generation === entry.generation && !isAtLimit(entry.cron)) {
        nextRun = entry.cron.nextRun;
      }
    }
    let pending = 0;
    for (const { cron } of this.cronJobs.values()) {
      if (!isAtLimit(cron)) {
        pending++;
      }
    }
    return {
      total: this.cronJobs.size,
      pending,
      nextRun
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/webhook.js
function createWebhook(url, events, queue, secret) {
  return {
    id: uuid(),
    url,
    events,
    queue: queue ?? null,
    secret: secret ?? null,
    createdAt: Date.now(),
    lastTriggered: null,
    successCount: 0,
    failureCount: 0,
    enabled: true
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/webhookManager.js
var WEBHOOK_MAX_RETRIES = parseInt(Bun.env.WEBHOOK_MAX_RETRIES ?? "3", 10);
var WEBHOOK_RETRY_DELAY_MS = parseInt(Bun.env.WEBHOOK_RETRY_DELAY_MS ?? "1000", 10);
function signPayload(payload, secret) {
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(payload);
  return hasher.digest("hex");
}

class WebhookManager {
  webhooks = new Map;
  maxRetries = WEBHOOK_MAX_RETRIES;
  retryDelay = WEBHOOK_RETRY_DELAY_MS;
  validateUrls;
  dashboardEmit = null;
  enabledCount = 0;
  constructor(options) {
    this.validateUrls = options?.validateUrls !== false;
  }
  setDashboardEmit(callback) {
    this.dashboardEmit = callback;
  }
  add(url, events, queue, secret) {
    if (this.validateUrls) {
      const urlError = validateWebhookUrl(url);
      if (urlError) {
        throw new Error(urlError);
      }
    }
    const webhook = createWebhook(url, events, queue, secret);
    this.webhooks.set(webhook.id, webhook);
    if (webhook.enabled) {
      this.enabledCount++;
    }
    return webhook;
  }
  remove(id) {
    const webhook = this.webhooks.get(id);
    if (webhook?.enabled) {
      this.enabledCount--;
    }
    return this.webhooks.delete(id);
  }
  get(id) {
    return this.webhooks.get(id);
  }
  setEnabled(id, enabled) {
    const webhook = this.webhooks.get(id);
    if (!webhook)
      return false;
    if (webhook.enabled !== enabled) {
      webhook.enabled = enabled;
      this.enabledCount += enabled ? 1 : -1;
      this.dashboardEmit?.(enabled ? "webhook:enabled" : "webhook:disabled", { webhookId: id });
    }
    return true;
  }
  list() {
    return Array.from(this.webhooks.values());
  }
  async trigger(event, jobId2, queue, extra) {
    const payload = {
      event,
      timestamp: Date.now(),
      jobId: jobId2,
      queue,
      ...extra
    };
    const matchingWebhooks = Array.from(this.webhooks.values()).filter((wh) => wh.enabled && wh.events.includes(event) && (wh.queue === null || wh.queue === queue));
    for (const webhook of matchingWebhooks) {
      this.sendWebhook(webhook, payload).catch((err) => {
        webhookLog.error("Failed to send webhook", { url: webhook.url, error: String(err) });
      });
    }
  }
  async sendWebhook(webhook, payload) {
    const body = JSON.stringify(payload);
    const headers = {
      "Content-Type": "application/json",
      "X-Webhook-Event": payload.event,
      "X-Webhook-Timestamp": String(payload.timestamp)
    };
    if (webhook.secret) {
      headers["X-Webhook-Signature"] = signPayload(body, webhook.secret);
    }
    let lastError = null;
    for (let attempt = 0;attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(1e4)
        });
        if (response.ok) {
          webhook.lastTriggered = Date.now();
          webhook.successCount++;
          this.dashboardEmit?.("webhook:fired", {
            webhookId: webhook.id,
            url: webhook.url,
            event: payload.event
          });
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < this.maxRetries - 1) {
        await Bun.sleep(this.retryDelay * (attempt + 1));
      }
    }
    webhook.failureCount++;
    this.dashboardEmit?.("webhook:failed", {
      webhookId: webhook.id,
      url: webhook.url,
      event: payload.event,
      error: lastError?.message ?? "Webhook delivery failed after max retries"
    });
    throw lastError ?? new Error("Webhook delivery failed after max retries");
  }
  hasEnabledWebhooks() {
    return this.enabledCount > 0;
  }
  getStats() {
    return {
      total: this.webhooks.size,
      enabled: this.enabledCount
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/domain/types/worker.js
function createWorker(name, queues, concurrency = 1, opts) {
  const now = Date.now();
  return {
    id: opts?.workerId ?? uuid(),
    name,
    queues: queues ?? [],
    concurrency,
    hostname: opts?.hostname ?? "unknown",
    pid: opts?.pid ?? 0,
    registeredAt: opts?.startedAt ?? now,
    lastSeen: now,
    activeJobs: 0,
    processedJobs: 0,
    failedJobs: 0,
    currentJob: null,
    clientId: opts?.clientId ?? null
  };
}
function createLogEntry(message, level = "info") {
  return {
    timestamp: Date.now(),
    level,
    message
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/workerManager.js
var WORKER_TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT_MS ?? "30000", 10);
var WORKER_CLEANUP_INTERVAL_MS = parseInt(Bun.env.WORKER_CLEANUP_INTERVAL_MS ?? "60000", 10);

class WorkerManager {
  workers = new Map;
  cleanupInterval = null;
  dashboardEmit = null;
  totalProcessedCounter = 0;
  totalFailedCounter = 0;
  totalActiveJobsCounter = 0;
  constructor() {
    this.startCleanup();
  }
  setDashboardEmit(callback) {
    this.dashboardEmit = callback;
  }
  register(name, queues, concurrency = 1, opts) {
    if (opts?.workerId) {
      const existing = this.workers.get(opts.workerId);
      if (existing) {
        existing.queues = queues;
        existing.concurrency = concurrency;
        existing.lastSeen = Date.now();
        if (opts.hostname)
          existing.hostname = opts.hostname;
        if (opts.pid)
          existing.pid = opts.pid;
        return existing;
      }
    }
    const worker = createWorker(name, queues, concurrency, opts);
    this.workers.set(worker.id, worker);
    return worker;
  }
  unregister(id) {
    const worker = this.workers.get(id);
    if (worker) {
      this.totalActiveJobsCounter -= worker.activeJobs;
    }
    return this.workers.delete(id);
  }
  unregisterByClientId(clientId) {
    let removed = 0;
    for (const [id, worker] of this.workers) {
      if (worker.clientId === clientId) {
        this.totalActiveJobsCounter -= worker.activeJobs;
        this.workers.delete(id);
        this.dashboardEmit?.("worker:disconnected", { workerId: id, name: worker.name, clientId });
        removed++;
      }
    }
    return removed;
  }
  get(id) {
    return this.workers.get(id);
  }
  heartbeat(id, stats) {
    const worker = this.workers.get(id);
    if (!worker)
      return false;
    worker.lastSeen = Date.now();
    if (stats) {
      if (stats.activeJobs !== undefined) {
        this.totalActiveJobsCounter -= worker.activeJobs;
        worker.activeJobs = stats.activeJobs;
        this.totalActiveJobsCounter += stats.activeJobs;
      }
      if (stats.processed !== undefined) {
        this.totalProcessedCounter -= worker.processedJobs;
        worker.processedJobs = stats.processed;
        this.totalProcessedCounter += stats.processed;
      }
      if (stats.failed !== undefined) {
        this.totalFailedCounter -= worker.failedJobs;
        worker.failedJobs = stats.failed;
        this.totalFailedCounter += stats.failed;
      }
    }
    return true;
  }
  incrementActive(id, jobId2) {
    const worker = this.workers.get(id);
    if (worker) {
      worker.activeJobs++;
      this.totalActiveJobsCounter++;
      worker.lastSeen = Date.now();
      if (jobId2) {
        worker.currentJob = jobId2;
      }
    }
  }
  jobCompleted(id) {
    const worker = this.workers.get(id);
    if (worker) {
      if (worker.activeJobs > 0) {
        worker.activeJobs--;
        this.totalActiveJobsCounter--;
      }
      worker.processedJobs++;
      this.totalProcessedCounter++;
      worker.lastSeen = Date.now();
      if (worker.activeJobs === 0) {
        worker.currentJob = null;
        this.dashboardEmit?.("worker:idle", { workerId: id, processedJobs: worker.processedJobs });
      }
    }
  }
  jobFailed(id) {
    const worker = this.workers.get(id);
    if (worker) {
      if (worker.activeJobs > 0) {
        worker.activeJobs--;
        this.totalActiveJobsCounter--;
      }
      worker.failedJobs++;
      this.totalFailedCounter++;
      worker.lastSeen = Date.now();
      if (worker.activeJobs === 0) {
        worker.currentJob = null;
        this.dashboardEmit?.("worker:idle", { workerId: id, processedJobs: worker.processedJobs });
      }
      const total = worker.processedJobs + worker.failedJobs;
      if (total >= 5 && (worker.failedJobs === 5 || worker.failedJobs === 10 || worker.failedJobs === 25 || worker.failedJobs === 50 || worker.failedJobs === 100)) {
        this.dashboardEmit?.("worker:error", {
          workerId: id,
          name: worker.name,
          failedJobs: worker.failedJobs,
          processedJobs: worker.processedJobs,
          failureRate: +(worker.failedJobs / total).toFixed(3)
        });
      }
    }
  }
  list() {
    return Array.from(this.workers.values());
  }
  listActive() {
    const now = Date.now();
    return Array.from(this.workers.values()).filter((w2) => now - w2.lastSeen < WORKER_TIMEOUT_MS);
  }
  getForQueue(queue) {
    const now = Date.now();
    return Array.from(this.workers.values()).filter((w2) => w2.queues?.includes(queue) && now - w2.lastSeen < WORKER_TIMEOUT_MS);
  }
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStale();
    }, WORKER_CLEANUP_INTERVAL_MS);
  }
  cleanupStale() {
    const now = Date.now();
    const staleTimeout = WORKER_TIMEOUT_MS * 3;
    for (const [id, worker] of this.workers) {
      if (now - worker.lastSeen > staleTimeout) {
        this.totalActiveJobsCounter -= worker.activeJobs;
        this.workers.delete(id);
        this.dashboardEmit?.("worker:removed-stale", { workerId: id, name: worker.name });
      }
    }
  }
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  getStats() {
    const now = Date.now();
    let activeWorkers = 0;
    for (const worker of this.workers.values()) {
      if (now - worker.lastSeen < WORKER_TIMEOUT_MS) {
        activeWorkers++;
      }
    }
    return {
      total: this.workers.size,
      active: activeWorkers,
      totalProcessed: this.totalProcessedCounter,
      totalFailed: this.totalFailedCounter,
      activeJobs: this.totalActiveJobsCounter
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/eventsManager.js
class EventsManager {
  webhookManager;
  subscribers = new Set;
  completionWaiters = new Map;
  constructor(webhookManager) {
    this.webhookManager = webhookManager;
  }
  get subscriberCount() {
    return this.subscribers.size;
  }
  get completionWaiterCount() {
    return this.completionWaiters.size;
  }
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
  clear() {
    this.subscribers.clear();
    for (const waiters of this.completionWaiters.values()) {
      for (const waiter of waiters) {
        if (!waiter.cancelled) {
          waiter.resolve();
        }
      }
    }
    this.completionWaiters.clear();
  }
  waitForJobCompletion(jobId2, timeoutMs) {
    const jobKey = String(jobId2);
    return new Promise((resolve) => {
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve(true);
        },
        cancelled: false
      };
      const timer = setTimeout(() => {
        waiter.cancelled = true;
        const waiters2 = this.completionWaiters.get(jobKey);
        if (waiters2) {
          const index = waiters2.indexOf(waiter);
          if (index !== -1) {
            waiters2.splice(index, 1);
          }
          if (waiters2.length === 0) {
            this.completionWaiters.delete(jobKey);
          }
        }
        resolve(false);
      }, timeoutMs);
      let waiters = this.completionWaiters.get(jobKey);
      if (!waiters) {
        waiters = [];
        this.completionWaiters.set(jobKey, waiters);
      }
      waiters.push(waiter);
    });
  }
  needsBroadcast() {
    return this.subscribers.size > 0 || this.webhookManager.hasEnabledWebhooks() || this.completionWaiters.size > 0;
  }
  broadcast(event) {
    const hasSubscribers = this.subscribers.size > 0;
    const hasWebhooks = this.webhookManager.hasEnabledWebhooks();
    const isCompletion = event.eventType === "completed";
    const hasWaiters = isCompletion && this.completionWaiters.size > 0;
    if (!hasSubscribers && !hasWebhooks && !hasWaiters) {
      return;
    }
    if (hasSubscribers) {
      for (const sub of this.subscribers) {
        try {
          sub(event);
        } catch {}
      }
    }
    if (hasWaiters) {
      const jobKey = String(event.jobId);
      const waiters = this.completionWaiters.get(jobKey);
      if (waiters) {
        this.completionWaiters.delete(jobKey);
        for (const waiter of waiters) {
          if (!waiter.cancelled) {
            waiter.resolve();
          }
        }
      }
    }
    if (hasWebhooks) {
      const webhookEvent = this.mapEventToWebhook(event.eventType);
      if (webhookEvent) {
        this.webhookManager.trigger(webhookEvent, String(event.jobId), event.queue, {
          data: event.data,
          error: event.error
        }).catch((err) => {
          webhookLog.error("Webhook trigger failed", {
            event: webhookEvent,
            jobId: String(event.jobId),
            queue: event.queue,
            error: String(err)
          });
        });
      }
    }
  }
  mapEventToWebhook(eventType) {
    switch (eventType) {
      case "pushed":
        return "job.pushed";
      case "pulled":
        return "job.started";
      case "completed":
        return "job.completed";
      case "failed":
        return "job.failed";
      case "progress":
      case "stalled":
      case "removed":
      case "delayed":
      case "duplicated":
      case "retried":
      case "waiting-children":
      case "drained":
      case "paused":
      case "resumed":
        return null;
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/monitoringChecks.js
function createMonitoringState() {
  return {
    queueIdleSince: new Map,
    queueThresholdEmitted: new Set,
    workerOverloadedSince: new Map,
    storageWarningEmitted: false,
    memoryWarningEmitted: false
  };
}
var QUEUE_IDLE_THRESHOLD_MS = parseInt(process.env.QUEUE_IDLE_THRESHOLD_MS ?? "30000");
var QUEUE_SIZE_THRESHOLD = parseInt(process.env.QUEUE_SIZE_THRESHOLD ?? "0");
var MEMORY_WARNING_MB = parseInt(process.env.MEMORY_WARNING_MB ?? "0");
var STORAGE_WARNING_MB = parseInt(process.env.STORAGE_WARNING_MB ?? "0");
var WORKER_OVERLOAD_THRESHOLD_MS = parseInt(process.env.WORKER_OVERLOAD_THRESHOLD_MS ?? "30000");
function runMonitoringChecks(ctx) {
  if (!ctx.dashboardEmit)
    return;
  const now = Date.now();
  checkQueueIdle(ctx, now);
  checkQueueThreshold(ctx);
  checkWorkerOverload(ctx, now);
  checkMemoryPressure(ctx);
  checkStorageSize(ctx);
}
function getQueueWaiting(queue, shards, now) {
  const idx = shardIndex(queue);
  const q = shards[idx].queues.get(queue);
  if (!q)
    return 0;
  let count = 0;
  for (const job of q.values()) {
    if (job.runAt <= now)
      count++;
  }
  return count;
}
function getQueueActive(queue, procShards) {
  let count = 0;
  for (const shard of procShards) {
    for (const job of shard.values()) {
      if (job.queue === queue)
        count++;
    }
  }
  return count;
}
function checkQueueIdle(ctx, now) {
  if (QUEUE_IDLE_THRESHOLD_MS <= 0)
    return;
  for (const queue of ctx.queueNamesCache) {
    const waiting = getQueueWaiting(queue, ctx.shards, now);
    const active = getQueueActive(queue, ctx.processingShards);
    if (waiting === 0 && active === 0) {
      if (!ctx.state.queueIdleSince.has(queue)) {
        ctx.state.queueIdleSince.set(queue, now);
      } else {
        const since = ctx.state.queueIdleSince.get(queue) ?? now;
        if (now - since >= QUEUE_IDLE_THRESHOLD_MS) {
          ctx.dashboardEmit?.("queue:idle", {
            queue,
            idleSeconds: Math.floor((now - since) / 1000)
          });
          ctx.state.queueIdleSince.delete(queue);
        }
      }
    } else {
      ctx.state.queueIdleSince.delete(queue);
    }
  }
}
function checkQueueThreshold(ctx) {
  if (QUEUE_SIZE_THRESHOLD <= 0)
    return;
  const now = Date.now();
  for (const queue of ctx.queueNamesCache) {
    const waiting = getQueueWaiting(queue, ctx.shards, now);
    if (waiting >= QUEUE_SIZE_THRESHOLD) {
      if (!ctx.state.queueThresholdEmitted.has(queue)) {
        ctx.dashboardEmit?.("queue:threshold", {
          queue,
          size: waiting,
          threshold: QUEUE_SIZE_THRESHOLD
        });
        ctx.state.queueThresholdEmitted.add(queue);
      }
    } else {
      ctx.state.queueThresholdEmitted.delete(queue);
    }
  }
}
function checkWorkerOverload(ctx, now) {
  if (WORKER_OVERLOAD_THRESHOLD_MS <= 0)
    return;
  for (const worker of ctx.workerManager.list()) {
    const atCapacity = worker.concurrency > 0 && worker.activeJobs >= worker.concurrency;
    if (atCapacity) {
      if (!ctx.state.workerOverloadedSince.has(worker.id)) {
        ctx.state.workerOverloadedSince.set(worker.id, now);
      } else {
        const since = ctx.state.workerOverloadedSince.get(worker.id) ?? now;
        if (now - since >= WORKER_OVERLOAD_THRESHOLD_MS) {
          ctx.dashboardEmit?.("worker:overloaded", {
            workerId: worker.id,
            name: worker.name,
            activeJobs: worker.activeJobs,
            concurrency: worker.concurrency,
            overloadedSeconds: Math.floor((now - since) / 1000)
          });
          ctx.state.workerOverloadedSince.delete(worker.id);
        }
      }
    } else {
      ctx.state.workerOverloadedSince.delete(worker.id);
    }
  }
}
function checkMemoryPressure(ctx) {
  if (MEMORY_WARNING_MB <= 0)
    return;
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapMB >= MEMORY_WARNING_MB) {
    if (!ctx.state.memoryWarningEmitted) {
      ctx.dashboardEmit?.("server:memory-warning", {
        heapUsedMB: heapMB,
        thresholdMB: MEMORY_WARNING_MB,
        rssMB: Math.round(mem.rss / 1024 / 1024)
      });
      ctx.state.memoryWarningEmitted = true;
    }
  } else if (heapMB < MEMORY_WARNING_MB * 0.9) {
    ctx.state.memoryWarningEmitted = false;
  }
}
function checkStorageSize(ctx) {
  if (STORAGE_WARNING_MB <= 0 || !ctx.storage)
    return;
  const sizeBytes = ctx.storage.getSize();
  const sizeMB = Math.round(sizeBytes / 1024 / 1024);
  if (sizeMB >= STORAGE_WARNING_MB) {
    if (!ctx.state.storageWarningEmitted) {
      ctx.dashboardEmit?.("storage:size-warning", { sizeMB, thresholdMB: STORAGE_WARNING_MB });
      ctx.state.storageWarningEmitted = true;
    }
  } else if (sizeMB < STORAGE_WARNING_MB * 0.9) {
    ctx.state.storageWarningEmitted = false;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/lock.js
var DEFAULT_LOCK_TIMEOUT_MS = parseInt(Bun.env.LOCK_TIMEOUT_MS ?? "5000", 10);

class LockTimeoutError extends Error {
  constructor(message = "Lock acquisition timed out") {
    super(message);
    this.name = "LockTimeoutError";
  }
}
class RWLock {
  readers = 0;
  writer = false;
  writerWaiting = 0;
  readerQueue = [];
  writerQueue = [];
  async acquireRead(timeoutMs = DEFAULT_LOCK_TIMEOUT_MS) {
    const start = Date.now();
    while (this.writer || this.writerWaiting > 0) {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) {
        throw new LockTimeoutError("Read lock acquisition timed out");
      }
      await new Promise((resolve) => {
        const entry = { resolve, cancelled: false };
        const timer = setTimeout(() => {
          entry.cancelled = true;
          resolve();
        }, remaining);
        entry.resolve = () => {
          clearTimeout(timer);
          resolve();
        };
        this.readerQueue.push(entry);
      });
    }
    this.readers++;
    let released = false;
    return {
      release: () => {
        if (released)
          return;
        released = true;
        this.readers--;
        if (this.readers === 0 && this.writerWaiting > 0) {
          let next = this.writerQueue.shift();
          while (next) {
            if (!next.cancelled) {
              next.resolve();
              break;
            }
            next = this.writerQueue.shift();
          }
        }
      }
    };
  }
  async acquireWrite(timeoutMs = DEFAULT_LOCK_TIMEOUT_MS) {
    if (!this.writer && this.readers === 0) {
      this.writer = true;
      return this.createWriteGuard();
    }
    const start = Date.now();
    this.writerWaiting++;
    try {
      while (this.writer || this.readers > 0) {
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new LockTimeoutError("Write lock acquisition timed out");
        }
        await new Promise((resolve) => {
          const entry = { resolve, cancelled: false };
          const timer = setTimeout(() => {
            entry.cancelled = true;
            resolve();
          }, remaining);
          entry.resolve = () => {
            clearTimeout(timer);
            resolve();
          };
          this.writerQueue.push(entry);
        });
      }
      this.writerWaiting--;
      this.writer = true;
      return this.createWriteGuard();
    } catch (e) {
      this.writerWaiting--;
      throw e;
    }
  }
  createWriteGuard() {
    let released = false;
    return {
      release: () => {
        if (released)
          return;
        released = true;
        this.writer = false;
        if (this.writerWaiting > 0) {
          let next = this.writerQueue.shift();
          while (next) {
            if (!next.cancelled) {
              next.resolve();
              return;
            }
            next = this.writerQueue.shift();
          }
        }
        const readers = this.readerQueue.splice(0);
        for (const entry of readers) {
          if (!entry.cancelled) {
            entry.resolve();
          }
        }
      }
    };
  }
  getState() {
    return {
      readers: this.readers,
      writer: this.writer,
      writerWaiting: this.writerWaiting
    };
  }
}
async function withReadLock(lock, fn, timeoutMs) {
  const guard = await lock.acquireRead(timeoutMs);
  try {
    return await fn();
  } finally {
    guard.release();
  }
}
async function withWriteLock(lock, fn, timeoutMs) {
  const guard = await lock.acquireWrite(timeoutMs);
  try {
    return await fn();
  } finally {
    guard.release();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/histogram.js
var DEFAULT_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 1e4];

class Histogram {
  buckets;
  counts;
  sum = 0;
  count = 0;
  constructor(buckets = DEFAULT_BUCKETS) {
    this.buckets = [...buckets].sort((a, b2) => a - b2);
    this.counts = new Float64Array(this.buckets.length + 1);
  }
  observe(value) {
    this.sum += value;
    this.count++;
    let lo = 0;
    let hi = this.buckets.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.buckets[mid] < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    for (let i = lo;i <= this.buckets.length; i++) {
      this.counts[i]++;
    }
  }
  getSum() {
    return this.sum;
  }
  getCount() {
    return this.count;
  }
  percentile(p2) {
    if (this.count === 0)
      return 0;
    const target2 = p2 / 100 * this.count;
    for (let i = 0;i < this.buckets.length; i++) {
      if (this.counts[i] >= target2) {
        return this.buckets[i];
      }
    }
    return this.buckets[this.buckets.length - 1];
  }
  toPrometheus(name, help) {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (let i = 0;i < this.buckets.length; i++) {
      lines.push(`${name}_bucket{le="${this.buckets[i]}"} ${this.counts[i]}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${this.counts[this.buckets.length]}`);
    lines.push(`${name}_sum ${this.sum}`);
    lines.push(`${name}_count ${this.count}`);
    return lines.join(`
`);
  }
  reset() {
    this.sum = 0;
    this.count = 0;
    this.counts.fill(0);
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/latencyTracker.js
class LatencyTracker {
  push = new Histogram;
  pull = new Histogram;
  ack = new Histogram;
  toPrometheus() {
    return [
      this.push.toPrometheus("bunqueue_push_duration_ms", "Push operation latency in milliseconds"),
      "",
      this.pull.toPrometheus("bunqueue_pull_duration_ms", "Pull operation latency in milliseconds"),
      "",
      this.ack.toPrometheus("bunqueue_ack_duration_ms", "Ack operation latency in milliseconds")
    ].join(`
`);
  }
  getAverages() {
    return {
      pushMs: this.push.getCount() > 0 ? this.push.getSum() / this.push.getCount() : 0,
      pullMs: this.pull.getCount() > 0 ? this.pull.getSum() / this.pull.getCount() : 0,
      ackMs: this.ack.getCount() > 0 ? this.ack.getSum() / this.ack.getCount() : 0
    };
  }
  getPercentiles() {
    return {
      push: {
        p50: this.push.percentile(50),
        p95: this.push.percentile(95),
        p99: this.push.percentile(99)
      },
      pull: {
        p50: this.pull.percentile(50),
        p95: this.pull.percentile(95),
        p99: this.pull.percentile(99)
      },
      ack: {
        p50: this.ack.percentile(50),
        p95: this.ack.percentile(95),
        p99: this.ack.percentile(99)
      }
    };
  }
}
var latencyTracker = new LatencyTracker;

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/throughputTracker.js
class RateTracker {
  count = 0;
  lastRate = 0;
  lastCalcTime = Date.now();
  alpha;
  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }
  increment(n = 1) {
    this.count += n;
  }
  getRate() {
    const now = Date.now();
    const elapsed = (now - this.lastCalcTime) / 1000;
    if (elapsed < 0.1)
      return this.lastRate;
    const currentRate = this.count / elapsed;
    this.lastRate = this.lastRate === 0 ? currentRate : this.alpha * currentRate + (1 - this.alpha) * this.lastRate;
    this.count = 0;
    this.lastCalcTime = now;
    return this.lastRate;
  }
}

class ThroughputTracker {
  pushRate = new RateTracker;
  pullRate = new RateTracker;
  completeRate = new RateTracker;
  failRate = new RateTracker;
  getRates() {
    return {
      pushPerSec: Math.round(this.pushRate.getRate() * 100) / 100,
      pullPerSec: Math.round(this.pullRate.getRate() * 100) / 100,
      completePerSec: Math.round(this.completeRate.getRate() * 100) / 100,
      failPerSec: Math.round(this.failRate.getRate() * 100) / 100
    };
  }
}
var throughputTracker = new ThroughputTracker;

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/push.js
function handleCustomId(input, shard, ctx) {
  if (!input.customId) {
    return { skip: false, id: generateJobId() };
  }
  const id = jobId(input.customId);
  const existing = ctx.customIdMap.get(input.customId);
  if (existing) {
    const location = ctx.jobIndex.get(existing);
    const existingJob = location?.type === "queue" ? shard.getQueue(location.queueName).find(existing) : null;
    if (existingJob) {
      return { skip: true, existingJob };
    }
  }
  if (ctx.completedJobs.has(id)) {
    ctx.completedJobs.delete(id);
    ctx.completedJobsData.delete(id);
    ctx.jobResults.delete(id);
    ctx.jobIndex.delete(id);
    ctx.storage?.deleteJob(id);
  }
  ctx.timedOutJobs?.delete(id);
  ctx.customIdMap.set(input.customId, id);
  return { skip: false, id };
}
function handleDeduplication(job, input, queue, shard, ctx) {
  if (!job.uniqueKey) {
    return { skip: false };
  }
  const q = shard.getQueue(queue);
  const existingEntry = shard.getUniqueKeyEntry(queue, job.uniqueKey);
  if (!existingEntry) {
    shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, input.dedup?.ttl);
    return { skip: false };
  }
  const dedupOpts = input.dedup;
  if (dedupOpts?.replace) {
    const existingJob2 = q.find(existingEntry.jobId);
    if (existingJob2) {
      q.remove(existingEntry.jobId);
      shard.decrementQueued(existingEntry.jobId);
      ctx.jobIndex.delete(existingEntry.jobId);
    }
    shard.releaseUniqueKey(queue, job.uniqueKey);
    shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, dedupOpts?.ttl);
    return { skip: false };
  }
  if (dedupOpts?.extend && dedupOpts?.ttl) {
    shard.extendUniqueKeyTtl(queue, job.uniqueKey, dedupOpts.ttl);
    if (input.customId)
      ctx.customIdMap.delete(input.customId);
    const existingJob2 = q.find(existingEntry.jobId);
    if (existingJob2) {
      ctx.dashboardEmit?.("job:deduplicated", {
        queue,
        jobId: String(existingEntry.jobId),
        strategy: "extend"
      });
      return { skip: true, existingId: existingEntry.jobId };
    }
    throw new Error("Duplicate unique_key (extended TTL)");
  }
  if (input.customId)
    ctx.customIdMap.delete(input.customId);
  const existingJob = q.find(existingEntry.jobId);
  if (existingJob || ctx.jobIndex.has(existingEntry.jobId)) {
    ctx.broadcast({
      eventType: "duplicated",
      queue,
      jobId: existingEntry.jobId,
      timestamp: Date.now()
    });
    ctx.dashboardEmit?.("job:deduplicated", {
      queue,
      jobId: String(existingEntry.jobId),
      strategy: "default"
    });
    return { skip: true, existingId: existingEntry.jobId };
  }
  shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, input.dedup?.ttl);
  return { skip: false };
}
function insertJobToShard(job, queue, shard, shardIdx, ctx) {
  const hasDeps = job.dependsOn.length > 0;
  const needsWaiting = hasDeps && !job.dependsOn.every((depId) => ctx.completedJobs.has(depId) || (ctx.depCompletions?.has(depId) ?? false));
  const now = Date.now();
  if (needsWaiting) {
    shard.waitingDeps.set(job.id, job);
    shard.registerDependencies(job.id, job.dependsOn);
    job.timeline.push({ state: "waiting-children", timestamp: now });
    ctx.dashboardEmit?.("job:waiting-children", {
      jobId: String(job.id),
      queue,
      dependsOn: job.dependsOn.map(String)
    });
  } else {
    shard.getQueue(queue).push(job);
    const isDelayed = job.runAt > now;
    shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
    const state = isDelayed ? "delayed" : job.priority > 0 ? "prioritized" : "waiting";
    job.timeline.push({ state, timestamp: now });
  }
  ctx.jobIndex.set(job.id, { type: "queue", shardIdx, queueName: queue });
}
async function pushJob(queue, input, ctx) {
  const startNs = Bun.nanoseconds();
  const idx = shardIndex(queue);
  const now = Date.now();
  let result;
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    const customIdResult = handleCustomId(input, shard, ctx);
    if (customIdResult.skip) {
      result = { job: customIdResult.existingJob, persisted: false };
      return;
    }
    const job = createJob(customIdResult.id, queue, input, now);
    const dedupResult = handleDeduplication(job, input, queue, shard, ctx);
    if (dedupResult.skip) {
      const existingJob = shard.getQueue(queue).find(dedupResult.existingId);
      result = {
        job: existingJob ?? { ...job, id: dedupResult.existingId },
        persisted: false
      };
      return;
    }
    insertJobToShard(job, queue, shard, idx, ctx);
    shard.notify();
    result = { job, persisted: true };
  });
  if (!result) {
    console.error("[Push] Push failed unexpectedly", { queue, input });
    throw new Error("Push failed");
  }
  if (result.persisted) {
    ctx.storage?.insertJob(result.job, input.durable);
    ctx.totalPushed.value++;
    throughputTracker.pushRate.increment();
    ctx.broadcast({
      eventType: "pushed",
      queue,
      jobId: result.job.id,
      timestamp: now
    });
  }
  latencyTracker.push.observe((Bun.nanoseconds() - startNs) / 1e6);
  return result.job;
}
async function pushJobBatch(queue, inputs, ctx) {
  const startNs = Bun.nanoseconds();
  const now = Date.now();
  const idx = shardIndex(queue);
  const resultIds = [];
  const jobsToInsert = [];
  const durableJobs = [];
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    for (const input of inputs) {
      const customIdResult = handleCustomId(input, shard, ctx);
      if (customIdResult.skip) {
        resultIds.push(customIdResult.existingJob.id);
        continue;
      }
      const job = createJob(customIdResult.id, queue, input, now);
      const dedupResult = handleDeduplication(job, input, queue, shard, ctx);
      if (dedupResult.skip) {
        resultIds.push(dedupResult.existingId);
        continue;
      }
      insertJobToShard(job, queue, shard, idx, ctx);
      jobsToInsert.push(job);
      if (input.durable)
        durableJobs.push(job);
      resultIds.push(job.id);
    }
    if (jobsToInsert.length > 0) {
      shard.notifyBatch(jobsToInsert.length);
    }
  });
  if (jobsToInsert.length > 0) {
    if (durableJobs.length === 0) {
      ctx.storage?.insertJobsBatch(jobsToInsert);
    } else {
      const durableSet = new Set(durableJobs);
      const buffered = jobsToInsert.filter((j) => !durableSet.has(j));
      if (buffered.length > 0)
        ctx.storage?.insertJobsBatch(buffered);
      ctx.storage?.insertJobsBatch(durableJobs, true);
    }
    ctx.totalPushed.value += BigInt(jobsToInsert.length);
    throughputTracker.pushRate.increment(jobsToInsert.length);
    for (const job of jobsToInsert) {
      ctx.broadcast({
        eventType: "pushed",
        queue: job.queue,
        jobId: job.id,
        timestamp: now
      });
    }
  }
  if (jobsToInsert.length > 0 && inputs.length > 1) {
    ctx.dashboardEmit?.("batch:pushed", {
      queue,
      total: inputs.length,
      inserted: jobsToInsert.length,
      duplicates: inputs.length - jobsToInsert.length
    });
  }
  latencyTracker.push.observe((Bun.nanoseconds() - startNs) / 1e6);
  return resultIds;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/pull.js
function tryDequeueNextJob(shard, queue, now, ctx) {
  const q = shard.getQueue(queue);
  const job = q.peek();
  if (!job)
    return { status: "stop" };
  if (isExpired(job, now)) {
    q.pop();
    shard.decrementQueued(job.id);
    ctx.jobIndex.delete(job.id);
    ctx.dashboardEmit?.("job:expired", {
      queue,
      jobId: String(job.id),
      ttl: job.ttl,
      age: now - job.createdAt
    });
    return { status: "skip" };
  }
  if (!isReady(job, now))
    return { status: "stop" };
  if (job.groupId && shard.isGroupActive(queue, job.groupId)) {
    return { status: "stop" };
  }
  q.pop();
  shard.decrementQueued(job.id);
  if (job.groupId) {
    shard.activateGroup(queue, job.groupId);
  }
  job.startedAt = now;
  job.lastHeartbeat = now;
  if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
    job.timeline.push({ state: "active", timestamp: now });
  }
  return { status: "job", job };
}
async function moveToProcessing(job, queue, ctx) {
  const procIdx = processingShardIndex(job.id);
  const now = Date.now();
  await withWriteLock(ctx.processingLocks[procIdx], () => {
    ctx.processingShards[procIdx].set(job.id, job);
  });
  ctx.jobIndex.set(job.id, { type: "processing", shardIdx: procIdx });
  try {
    ctx.storage?.markActive(job.id, job.startedAt ?? now, job.timeline);
  } catch {}
  ctx.totalPulled.value++;
  throughputTracker.pullRate.increment();
  ctx.broadcast({
    eventType: "pulled",
    queue,
    jobId: job.id,
    timestamp: now
  });
}
async function moveToProcessingBatch(jobs, queue, ctx) {
  const byProcShard = new Map;
  for (const job of jobs) {
    const procIdx = processingShardIndex(job.id);
    const shardJobs = byProcShard.get(procIdx) ?? [];
    if (shardJobs.length === 0)
      byProcShard.set(procIdx, shardJobs);
    shardJobs.push(job);
  }
  const lockPromises = [];
  for (const [procIdx, shardJobs] of byProcShard) {
    lockPromises.push(withWriteLock(ctx.processingLocks[procIdx], () => {
      for (const job of shardJobs) {
        ctx.processingShards[procIdx].set(job.id, job);
      }
    }));
  }
  await Promise.all(lockPromises);
  const now = Date.now();
  for (const job of jobs) {
    const procIdx = processingShardIndex(job.id);
    ctx.jobIndex.set(job.id, { type: "processing", shardIdx: procIdx });
    try {
      ctx.storage?.markActive(job.id, job.startedAt ?? now, job.timeline);
    } catch {}
    ctx.totalPulled.value++;
    throughputTracker.pullRate.increment();
    ctx.broadcast({
      eventType: "pulled",
      queue,
      jobId: job.id,
      timestamp: now
    });
  }
}
async function requeueJob(job, queue, idx, ctx) {
  const procIdx = processingShardIndex(job.id);
  await withWriteLock(ctx.processingLocks[procIdx], () => {
    ctx.processingShards[procIdx].delete(job.id);
  });
  job.startedAt = null;
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    if (job.groupId)
      shard.releaseGroup(queue, job.groupId);
    shard.releaseConcurrency(queue);
    shard.getQueue(queue).push(job);
    shard.incrementQueued(job.id, false, job.createdAt, queue, job.runAt);
    shard.notify();
  });
  ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: queue });
}
async function pullJob(queue, timeoutMs, ctx) {
  const startNs = Bun.nanoseconds();
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
  const idx = shardIndex(queue);
  while (true) {
    const job = await tryPullFromShard(queue, idx, ctx);
    if (job) {
      try {
        await moveToProcessing(job, queue, ctx);
      } catch {
        await requeueJob(job, queue, idx, ctx);
        return null;
      }
      latencyTracker.pull.observe((Bun.nanoseconds() - startNs) / 1e6);
      return job;
    }
    const now = Date.now();
    if (deadline === 0 || now >= deadline) {
      return null;
    }
    const remaining = deadline - now;
    await ctx.shards[idx].waitForJob(remaining);
  }
}
async function tryPullFromShard(queue, idx, ctx) {
  return await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    const state = shard.getState(queue);
    if (state.paused) {
      return null;
    }
    if (!shard.tryAcquireRateLimit(queue)) {
      ctx.dashboardEmit?.("ratelimit:rejected", { queue });
      return null;
    }
    if (!shard.tryAcquireConcurrency(queue)) {
      ctx.dashboardEmit?.("concurrency:rejected", { queue });
      return null;
    }
    const now = Date.now();
    while (true) {
      const result = tryDequeueNextJob(shard, queue, now, ctx);
      if (result.status === "job")
        return result.job;
      if (result.status === "stop") {
        shard.releaseConcurrency(queue);
        return null;
      }
    }
  });
}
async function pullJobBatch(queue, count, timeoutMs, ctx) {
  const startNs = Bun.nanoseconds();
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
  const idx = shardIndex(queue);
  while (true) {
    const jobs = await tryPullBatchFromShard(queue, idx, count, ctx);
    if (jobs.length > 0) {
      try {
        await moveToProcessingBatch(jobs, queue, ctx);
      } catch {
        for (const job of jobs) {
          await requeueJob(job, queue, idx, ctx);
        }
        return [];
      }
      if (jobs.length > 1) {
        ctx.dashboardEmit?.("batch:pulled", { queue, count: jobs.length });
      }
      latencyTracker.pull.observe((Bun.nanoseconds() - startNs) / 1e6);
      return jobs;
    }
    const now = Date.now();
    if (deadline === 0 || now >= deadline) {
      return [];
    }
    const remaining = deadline - now;
    await ctx.shards[idx].waitForJob(remaining);
  }
}
async function tryPullBatchFromShard(queue, idx, count, ctx) {
  return await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    const state = shard.getState(queue);
    const jobs = [];
    if (state.paused)
      return jobs;
    const now = Date.now();
    while (jobs.length < count) {
      if (!shard.tryAcquireRateLimit(queue)) {
        break;
      }
      if (!shard.tryAcquireConcurrency(queue)) {
        break;
      }
      const result = tryDequeueNextJob(shard, queue, now, ctx);
      if (result.status === "job") {
        jobs.push(result.job);
      } else {
        shard.releaseConcurrency(queue);
        if (result.status === "stop")
          break;
      }
    }
    return jobs;
  });
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/ackHelpers.js
function groupByProcShard(jobIds) {
  const byProcShard = new Map;
  for (const jobId2 of jobIds) {
    const procIdx = processingShardIndex(jobId2);
    let group = byProcShard.get(procIdx);
    if (!group) {
      group = [];
      byProcShard.set(procIdx, group);
    }
    group.push(jobId2);
  }
  return byProcShard;
}
function groupItemsByProcShard(items) {
  const byProcShard = new Map;
  for (const item of items) {
    const procIdx = processingShardIndex(item.id);
    let group = byProcShard.get(procIdx);
    if (!group) {
      group = [];
      byProcShard.set(procIdx, group);
    }
    group.push(item);
  }
  return byProcShard;
}
async function extractJobs(byProcShard, ctx) {
  const extractedJobs = [];
  await Promise.all(Array.from(byProcShard.entries()).map(async ([procIdx, ids]) => {
    await withWriteLock(ctx.processingLocks[procIdx], () => {
      for (const jobId2 of ids) {
        const job = ctx.processingShards[procIdx].get(jobId2);
        if (job) {
          ctx.processingShards[procIdx].delete(jobId2);
          extractedJobs.push({ id: jobId2, job });
        }
      }
    });
  }));
  return extractedJobs;
}
async function extractJobsWithResults(byProcShard, ctx) {
  const extractedJobs = [];
  await Promise.all(Array.from(byProcShard.entries()).map(async ([procIdx, items]) => {
    await withWriteLock(ctx.processingLocks[procIdx], () => {
      for (const item of items) {
        const job = ctx.processingShards[procIdx].get(item.id);
        if (job) {
          ctx.processingShards[procIdx].delete(item.id);
          extractedJobs.push({ id: item.id, job, result: item.result });
        }
      }
    });
  }));
  return extractedJobs;
}
function groupByQueueShard(extractedJobs) {
  const byQueueShard = new Map;
  for (let i = 0;i < extractedJobs.length; i++) {
    const job = extractedJobs[i].job;
    const idx = shardIndex(job.queue);
    let group = byQueueShard.get(idx);
    if (!group) {
      group = [];
      byQueueShard.set(idx, group);
    }
    group.push(job);
  }
  return byQueueShard;
}
async function releaseResources(byQueueShard, ctx) {
  await Promise.all(Array.from(byQueueShard.entries()).map(async ([idx, jobs]) => {
    await withWriteLock(ctx.shardLocks[idx], () => {
      const shard = ctx.shards[idx];
      for (const job of jobs) {
        shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
      }
    });
  }));
}
function finalizeBatchAck(extractedJobs, ctx, includeResults) {
  const now = Date.now();
  const storage = ctx.storage;
  const hasStorage = storage !== null;
  const jobCount = extractedJobs.length;
  const needsBroadcast = ctx.needsBroadcast?.() ?? true;
  const hasPendingDeps = ctx.hasPendingDeps?.() ?? true;
  ctx.totalCompleted.value += BigInt(jobCount);
  if (ctx.perQueueMetrics) {
    for (let i = 0;i < jobCount; i++) {
      const qName = extractedJobs[i].job.queue;
      const pq = ctx.perQueueMetrics.get(qName);
      if (pq) {
        pq.totalCompleted++;
      } else {
        ctx.perQueueMetrics.set(qName, { totalCompleted: 1n, totalFailed: 0n });
      }
    }
  }
  for (let i = 0;i < jobCount; i++) {
    const { id: jobId2, job, result } = extractedJobs[i];
    if (job.customId && ctx.customIdMap) {
      ctx.customIdMap.delete(job.customId);
    }
    if (!job.removeOnComplete) {
      job.completedAt = now;
      if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
        job.timeline.push({ state: "completed", timestamp: now });
      }
      if (includeResults && result !== undefined) {
        ctx.jobResults.set(jobId2, result);
        if (hasStorage)
          storage.storeResult(jobId2, result);
      }
      ctx.jobIndex.set(jobId2, { type: "completed", queueName: job.queue });
      ctx.completedJobsData.set(jobId2, job);
      if (hasStorage)
        storage.markCompleted(jobId2, now, job.timeline);
      ctx.completedJobs.add(jobId2);
    } else {
      ctx.jobIndex.delete(jobId2);
      if (hasStorage)
        storage.deleteJob(jobId2);
      ctx.depCompletions?.add(jobId2);
    }
  }
  if (needsBroadcast) {
    for (let i = 0;i < jobCount; i++) {
      const { id: jobId2, job, result } = extractedJobs[i];
      ctx.broadcast({
        eventType: "completed",
        queue: job.queue,
        jobId: jobId2,
        timestamp: now,
        data: includeResults ? result : undefined
      });
    }
  }
  if (hasPendingDeps && ctx.onJobsCompleted) {
    const completedIds = extractedJobs.map((e) => e.id);
    ctx.onJobsCompleted(completedIds);
  } else if (hasPendingDeps) {
    for (let i = 0;i < jobCount; i++) {
      ctx.onJobCompleted(extractedJobs[i].id);
    }
  }
  throughputTracker.completeRate.increment(jobCount);
  if (ctx.onRepeat) {
    for (let i = 0;i < jobCount; i++) {
      const job = extractedJobs[i].job;
      if (job.repeat) {
        const shouldRepeat = job.repeat.limit === undefined || job.repeat.count < job.repeat.limit;
        if (shouldRepeat) {
          ctx.onRepeat(job);
        }
      }
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/ack.js
async function ackJob(jobId2, result, ctx) {
  const startNs = Bun.nanoseconds();
  const procIdx = processingShardIndex(jobId2);
  const job = await withWriteLock(ctx.processingLocks[procIdx], () => {
    const job2 = ctx.processingShards[procIdx].get(jobId2);
    if (job2) {
      ctx.processingShards[procIdx].delete(jobId2);
    }
    return job2;
  });
  if (!job) {
    throw new Error(`Job not found or not in processing state: ${jobId2}`);
  }
  const idx = shardIndex(job.queue);
  await withWriteLock(ctx.shardLocks[idx], () => {
    ctx.shards[idx].releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  });
  if (job.customId && ctx.customIdMap) {
    ctx.customIdMap.delete(job.customId);
  }
  if (!job.removeOnComplete) {
    const now = Date.now();
    job.completedAt = now;
    if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
      job.timeline.push({ state: "completed", timestamp: now });
    }
    ctx.completedJobs.add(jobId2);
    ctx.completedJobsData.set(jobId2, job);
    if (result !== undefined) {
      ctx.jobResults.set(jobId2, result);
      ctx.storage?.storeResult(jobId2, result);
    }
    ctx.jobIndex.set(jobId2, { type: "completed", queueName: job.queue });
    ctx.storage?.markCompleted(jobId2, now, job.timeline);
  } else {
    ctx.jobIndex.delete(jobId2);
    ctx.storage?.deleteJob(jobId2);
    ctx.depCompletions?.add(jobId2);
  }
  ctx.totalCompleted.value++;
  if (ctx.perQueueMetrics) {
    const pq = ctx.perQueueMetrics.get(job.queue);
    if (pq) {
      pq.totalCompleted++;
    } else {
      ctx.perQueueMetrics.set(job.queue, { totalCompleted: 1n, totalFailed: 0n });
    }
  }
  throughputTracker.completeRate.increment();
  ctx.broadcast({
    eventType: "completed",
    queue: job.queue,
    jobId: jobId2,
    timestamp: Date.now(),
    data: result
  });
  ctx.onJobCompleted(jobId2);
  if (job.repeat && ctx.onRepeat) {
    const shouldRepeat = job.repeat.limit === undefined || job.repeat.count < job.repeat.limit;
    if (shouldRepeat) {
      ctx.onRepeat(job);
    }
  }
  latencyTracker.ack.observe((Bun.nanoseconds() - startNs) / 1e6);
}
function moveFailedJobToDlq(job, jobId2, error2, shard, ctx) {
  const entry = shard.addToDlq(job, "max_attempts_exceeded", error2 ?? null);
  ctx.jobIndex.set(jobId2, { type: "dlq", queueName: job.queue });
  ctx.storage?.saveDlqEntry(entry);
  ctx.storage?.deleteJob(jobId2);
  ctx.totalFailed.value++;
  if (ctx.perQueueMetrics) {
    const pq = ctx.perQueueMetrics.get(job.queue);
    if (pq)
      pq.totalFailed++;
    else
      ctx.perQueueMetrics.set(job.queue, { totalCompleted: 0n, totalFailed: 1n });
  }
  throughputTracker.failRate.increment();
  if (job.customId && ctx.customIdMap)
    ctx.customIdMap.delete(job.customId);
  ctx.emitDashboardEvent?.("dlq:added", {
    queue: job.queue,
    jobId: String(jobId2),
    reason: "max_attempts_exceeded"
  });
  if (job.parentId) {
    ctx.emitDashboardEvent?.("flow:failed", {
      parentJobId: String(job.parentId),
      failedChildId: String(jobId2),
      queue: job.queue,
      error: error2 ?? "Max attempts exceeded"
    });
  }
}
async function failJob(jobId2, error2, ctx, unrecoverable = false, stack) {
  const procIdx = processingShardIndex(jobId2);
  const job = await withWriteLock(ctx.processingLocks[procIdx], () => {
    const job2 = ctx.processingShards[procIdx].get(jobId2);
    if (job2) {
      ctx.processingShards[procIdx].delete(jobId2);
    }
    return job2;
  });
  if (!job) {
    throw new Error(`Job not found or not in processing state: ${jobId2}`);
  }
  job.attempts++;
  if (stack) {
    job.stacktrace = normalizeStacktrace(stack, job.stackTraceLimit);
  }
  const failNow = Date.now();
  if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
    job.timeline.push({ state: "failed", timestamp: failNow, error: error2, attempt: job.attempts });
  }
  const idx = shardIndex(job.queue);
  let wasRetried = false;
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
    if (!unrecoverable && canRetry(job)) {
      const now = Date.now();
      job.runAt = now + calculateBackoff(job);
      shard.getQueue(job.queue).push(job);
      shard.incrementQueued(jobId2, true, job.createdAt, job.queue, job.runAt);
      ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: idx, queueName: job.queue });
      ctx.storage?.updateForRetry(job);
      wasRetried = true;
      if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
        job.timeline.push({ state: "waiting", timestamp: now, attempt: job.attempts + 1 });
      }
    } else if (job.removeOnFail) {
      ctx.jobIndex.delete(jobId2);
      ctx.storage?.deleteJob(jobId2);
      ctx.totalFailed.value++;
      if (ctx.perQueueMetrics) {
        const pq = ctx.perQueueMetrics.get(job.queue);
        if (pq) {
          pq.totalFailed++;
        } else {
          ctx.perQueueMetrics.set(job.queue, { totalCompleted: 0n, totalFailed: 1n });
        }
      }
      throughputTracker.failRate.increment();
      if (job.customId && ctx.customIdMap) {
        ctx.customIdMap.delete(job.customId);
      }
    } else {
      moveFailedJobToDlq(job, jobId2, error2, shard, ctx);
    }
  });
  ctx.broadcast({
    eventType: "failed",
    queue: job.queue,
    jobId: jobId2,
    timestamp: Date.now(),
    error: error2,
    data: job.data
  });
  if (wasRetried) {
    ctx.broadcast({
      eventType: "retried",
      queue: job.queue,
      jobId: jobId2,
      timestamp: Date.now(),
      prev: "failed"
    });
  }
  if (!wasRetried && job.failParentOnFailure && job.parentId && ctx.onChildTerminalFailure) {
    ctx.onChildTerminalFailure(job, error2);
  }
  if (!wasRetried && job.parentId && ctx.onChildDependencyOption && (job.removeDependencyOnFailure || job.ignoreDependencyOnFailure || job.continueParentOnFailure)) {
    ctx.onChildDependencyOption(job, error2);
  }
}
async function ackJobBatch(jobIds, ctx) {
  if (jobIds.length === 0)
    return;
  if (jobIds.length <= 4) {
    await Promise.all(jobIds.map((id) => ackJob(id, undefined, ctx)));
    return;
  }
  const batchCtx = {
    processingShards: ctx.processingShards,
    processingLocks: ctx.processingLocks,
    shards: ctx.shards,
    shardLocks: ctx.shardLocks
  };
  const byProcShard = groupByProcShard(jobIds);
  const extractedJobs = await extractJobs(byProcShard, batchCtx);
  const byQueueShard = groupByQueueShard(extractedJobs);
  await releaseResources(byQueueShard, batchCtx);
  finalizeBatchAck(extractedJobs, ctx, false);
}
async function ackJobBatchWithResults(items, ctx) {
  if (items.length === 0)
    return;
  if (items.length <= 4) {
    await Promise.all(items.map((item) => ackJob(item.id, item.result, ctx)));
    return;
  }
  const batchCtx = {
    processingShards: ctx.processingShards,
    processingLocks: ctx.processingLocks,
    shards: ctx.shards,
    shardLocks: ctx.shardLocks
  };
  const byProcShard = groupItemsByProcShard(items);
  const extractedJobs = await extractJobsWithResults(byProcShard, batchCtx);
  const byQueueShard = groupByQueueShard(extractedJobs);
  await releaseResources(byQueueShard, batchCtx);
  finalizeBatchAck(extractedJobs, ctx, true);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/queueControl.js
function pauseQueue(queue, ctx) {
  const idx = shardIndex(queue);
  ctx.shards[idx].pause(queue);
}
function resumeQueue(queue, ctx) {
  const idx = shardIndex(queue);
  ctx.shards[idx].resume(queue);
}
function isQueuePaused(queue, ctx) {
  const idx = shardIndex(queue);
  return ctx.shards[idx].isPaused(queue);
}
function drainQueue(queue, ctx) {
  const idx = shardIndex(queue);
  const { count, jobIds } = ctx.shards[idx].drain(queue);
  for (const jobId2 of jobIds) {
    ctx.jobIndex.delete(jobId2);
    safeDeleteJob(ctx, jobId2);
  }
  return count;
}
function obliterateQueue(queue, ctx) {
  const idx = shardIndex(queue);
  ctx.shards[idx].obliterate(queue);
}
function normalizeCleanState(state) {
  if (!state)
    return;
  if (state === "wait")
    return "waiting";
  return state;
}
function safeDeleteJob(ctx, jobId2) {
  try {
    ctx.storage?.deleteJob(jobId2);
  } catch {}
}
function safeDeleteDlqEntry(ctx, jobId2) {
  try {
    ctx.storage?.deleteDlqEntry(jobId2);
  } catch {}
}
function cleanWaitingLike(queue, graceMs, ctx, maxJobs) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const q = shard.getQueue(queue);
  const oldJobs = shard.getOldJobs(queue, graceMs, maxJobs);
  const removed = [];
  for (const { jobId: jobId2 } of oldJobs) {
    if (q.has(jobId2)) {
      q.remove(jobId2);
      shard.decrementQueued(jobId2);
      shard.removeFromTemporalIndex(jobId2);
      ctx.jobIndex.delete(jobId2);
      safeDeleteJob(ctx, jobId2);
      removed.push(jobId2);
    }
  }
  return removed;
}
function cleanCompleted(queue, graceMs, ctx, maxJobs) {
  if (!ctx.completedJobs || !ctx.completedJobsData)
    return [];
  const threshold = Date.now() - graceMs;
  const toRemove = [];
  for (const [jid, loc] of ctx.jobIndex) {
    if (loc.type !== "completed" || loc.queueName !== queue)
      continue;
    const job = ctx.completedJobsData.get(jid) ?? ctx.storage?.getJob(jid) ?? null;
    const ts = job?.completedAt ?? job?.createdAt ?? 0;
    if (ts && ts > threshold)
      continue;
    toRemove.push(jid);
    if (toRemove.length >= maxJobs)
      break;
  }
  for (const jid of toRemove) {
    ctx.completedJobs.delete(jid);
    ctx.completedJobsData.delete(jid);
    ctx.jobResults?.delete(jid);
    ctx.jobLogs?.delete(jid);
    ctx.jobIndex.delete(jid);
    safeDeleteJob(ctx, jid);
  }
  return toRemove;
}
function cleanFailed(queue, graceMs, ctx, maxJobs) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const entries = shard.getDlqEntries(queue);
  const threshold = Date.now() - graceMs;
  const toRemove = [];
  for (const entry of entries) {
    const ts = entry.enteredAt ?? entry.job.createdAt;
    if (ts > threshold)
      continue;
    toRemove.push(entry.job.id);
    if (toRemove.length >= maxJobs)
      break;
  }
  for (const jid of toRemove) {
    shard.removeFromDlq(queue, jid);
    ctx.jobIndex.delete(jid);
    ctx.jobResults?.delete(jid);
    ctx.jobLogs?.delete(jid);
    safeDeleteDlqEntry(ctx, jid);
    safeDeleteJob(ctx, jid);
  }
  return toRemove;
}
function cleanQueue(queue, graceMs, ctx, state, limit) {
  const maxJobs = limit ?? 1000;
  const normalized = normalizeCleanState(state);
  switch (normalized) {
    case undefined:
    case "waiting":
    case "delayed":
    case "prioritized":
    case "paused":
      return cleanWaitingLike(queue, graceMs, ctx, maxJobs);
    case "completed":
      return cleanCompleted(queue, graceMs, ctx, maxJobs);
    case "failed":
      return cleanFailed(queue, graceMs, ctx, maxJobs);
    case "active":
    default:
      return [];
  }
}
function getQueueCount(queue, ctx) {
  const idx = shardIndex(queue);
  const q = ctx.shards[idx].getQueue(queue);
  return q.size;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/jobManagement.js
async function cancelJob(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (!location)
    return false;
  if (location.type === "queue") {
    const result = await withWriteLock(ctx.shardLocks[location.shardIdx], () => {
      const shard = ctx.shards[location.shardIdx];
      const job = shard.getQueue(location.queueName).remove(jobId2);
      if (job) {
        shard.decrementQueued(jobId2);
        if (job.uniqueKey)
          shard.releaseUniqueKey(location.queueName, job.uniqueKey);
        ctx.jobIndex.delete(jobId2);
        ctx.storage?.deleteJob(jobId2);
        return { success: true, queueName: location.queueName };
      }
      const parked = shard.waitingChildren.get(jobId2);
      if (parked) {
        shard.waitingChildren.delete(jobId2);
        ctx.jobIndex.delete(jobId2);
        ctx.storage?.deleteJob(jobId2);
        return { success: true, queueName: location.queueName };
      }
      return { success: false, queueName: location.queueName };
    });
    if (result.success) {
      ctx.eventsManager.broadcast({
        eventType: "removed",
        jobId: jobId2,
        queue: result.queueName,
        timestamp: Date.now(),
        prev: "waiting"
      });
    }
    return result.success;
  }
  return false;
}
async function updateJobProgress(jobId2, progress, ctx, message) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "processing")
    return false;
  const procIdx = processingShardIndex(jobId2);
  return withWriteLock(ctx.processingLocks[procIdx], () => {
    const job = ctx.processingShards[procIdx].get(jobId2);
    if (!job)
      return false;
    job.progress = Math.max(0, Math.min(100, progress));
    if (message !== undefined)
      job.progressMessage = message;
    job.lastHeartbeat = Date.now();
    ctx.eventsManager.broadcast({
      eventType: "progress",
      jobId: jobId2,
      queue: job.queue,
      timestamp: Date.now(),
      progress: job.progress,
      data: { progress: job.progress, message: job.progressMessage }
    });
    ctx.webhookManager.trigger("job.progress", String(jobId2), job.queue, { progress: job.progress }).catch((err) => {
      webhookLog.error("Progress webhook failed", {
        jobId: String(jobId2),
        queue: job.queue,
        error: String(err)
      });
    });
    return true;
  });
}
async function updateJobData(jobId2, data, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type === "queue") {
    return withWriteLock(ctx.shardLocks[location.shardIdx], () => {
      const shard = ctx.shards[location.shardIdx];
      const job = shard.getQueue(location.queueName).find(jobId2) ?? shard.waitingDeps.get(jobId2);
      if (job) {
        job.data = data;
        return true;
      }
      return false;
    });
  } else if (location?.type === "processing") {
    const procIdx = processingShardIndex(jobId2);
    return withWriteLock(ctx.processingLocks[procIdx], () => {
      const job = ctx.processingShards[procIdx].get(jobId2);
      if (job) {
        job.data = data;
        return true;
      }
      return false;
    });
  }
  return updateRepeatSuccessor(jobId2, data, ctx);
}
async function updateRepeatSuccessor(originalId, data, ctx) {
  if (!ctx.repeatChain)
    return false;
  const successorId = ctx.repeatChain.get(originalId);
  if (!successorId)
    return false;
  const successorLoc = ctx.jobIndex.get(successorId);
  if (successorLoc?.type !== "queue")
    return false;
  return withWriteLock(ctx.shardLocks[successorLoc.shardIdx], () => {
    const job = ctx.shards[successorLoc.shardIdx].getQueue(successorLoc.queueName).find(successorId);
    if (job) {
      job.data = data;
      return true;
    }
    return false;
  });
}
async function changeJobPriority(jobId2, priority, ctx, lifo) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "queue")
    return false;
  return withWriteLock(ctx.shardLocks[location.shardIdx], () => {
    const q = ctx.shards[location.shardIdx].getQueue(location.queueName);
    return q.updatePriority(jobId2, priority, lifo);
  });
}
async function promoteJob(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "queue")
    return false;
  return withWriteLock(ctx.shardLocks[location.shardIdx], () => {
    const q = ctx.shards[location.shardIdx].getQueue(location.queueName);
    const job = q.find(jobId2);
    if (!job || job.runAt <= Date.now())
      return false;
    q.updateRunAt(jobId2, Date.now());
    return true;
  });
}
async function moveJobToDelayed(jobId2, delay, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "processing")
    return false;
  const procIdx = processingShardIndex(jobId2);
  const job = await withWriteLock(ctx.processingLocks[procIdx], () => {
    const job2 = ctx.processingShards[procIdx].get(jobId2);
    if (job2) {
      ctx.processingShards[procIdx].delete(jobId2);
    }
    return job2;
  });
  if (!job)
    return false;
  const now = Date.now();
  job.runAt = now + delay;
  job.startedAt = null;
  const idx = shardIndex(job.queue);
  const queueName = job.queue;
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    shard.getQueue(job.queue).push(job);
    const isDelayed = job.runAt > now;
    shard.incrementQueued(jobId2, isDelayed, job.createdAt, job.queue, job.runAt);
    ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: idx, queueName: job.queue });
  });
  ctx.eventsManager.broadcast({
    eventType: "delayed",
    jobId: jobId2,
    queue: queueName,
    timestamp: Date.now(),
    delay
  });
  return true;
}
async function discardJob(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (!location)
    return false;
  let job = null;
  if (location.type === "queue") {
    job = await withWriteLock(ctx.shardLocks[location.shardIdx], () => {
      const shard = ctx.shards[location.shardIdx];
      const removed = shard.getQueue(location.queueName).remove(jobId2);
      if (removed) {
        shard.decrementQueued(jobId2);
      }
      return removed;
    });
  } else if (location.type === "processing") {
    const procIdx = processingShardIndex(jobId2);
    job = await withWriteLock(ctx.processingLocks[procIdx], () => {
      const j = ctx.processingShards[procIdx].get(jobId2) ?? null;
      if (j)
        ctx.processingShards[procIdx].delete(jobId2);
      return j;
    });
  }
  if (job) {
    const validJob = job;
    const idx = shardIndex(validJob.queue);
    const entry = await withWriteLock(ctx.shardLocks[idx], () => {
      const dlqEntry = ctx.shards[idx].addToDlq(validJob);
      ctx.jobIndex.set(jobId2, { type: "dlq", queueName: validJob.queue });
      return dlqEntry;
    });
    ctx.storage?.saveDlqEntry(entry);
    ctx.storage?.deleteJob(jobId2);
    return true;
  }
  return false;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/jobStateTransitions.js
async function moveActiveToWait(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "processing")
    return false;
  const procIdx = processingShardIndex(jobId2);
  const job = await withWriteLock(ctx.processingLocks[procIdx], () => {
    const job2 = ctx.processingShards[procIdx].get(jobId2);
    if (job2) {
      ctx.processingShards[procIdx].delete(jobId2);
    }
    return job2;
  });
  if (!job)
    return false;
  const now = Date.now();
  job.runAt = now;
  job.startedAt = null;
  const idx = shardIndex(job.queue);
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
    shard.getQueue(job.queue).push(job);
    shard.incrementQueued(jobId2, false, job.createdAt, job.queue, job.runAt);
    ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: idx, queueName: job.queue });
    shard.notify();
  });
  ctx.eventsManager.broadcast({
    eventType: "waiting",
    jobId: jobId2,
    queue: job.queue,
    timestamp: now,
    prev: "active"
  });
  return true;
}
async function changeWaitingDelay(jobId2, delay, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "queue")
    return false;
  const now = Date.now();
  const newRunAt = now + delay;
  return withWriteLock(ctx.shardLocks[location.shardIdx], () => {
    const q = ctx.shards[location.shardIdx].getQueue(location.queueName);
    const job = q.find(jobId2);
    if (!job)
      return false;
    q.updateRunAt(jobId2, newRunAt);
    return true;
  });
}
async function moveToWaitingChildren(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "processing")
    return false;
  const procIdx = processingShardIndex(jobId2);
  const job = await withWriteLock(ctx.processingLocks[procIdx], () => {
    const job2 = ctx.processingShards[procIdx].get(jobId2);
    if (job2) {
      ctx.processingShards[procIdx].delete(jobId2);
    }
    return job2;
  });
  if (!job)
    return false;
  const idx = shardIndex(job.queue);
  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];
    shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
    shard.waitingChildren.set(jobId2, job);
    ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: idx, queueName: job.queue });
  });
  return true;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/operations/queryOperations.js
async function getJob(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (!location) {
    if (ctx.storage) {
      const job = ctx.storage.getJob(jobId2);
      if (job)
        return job;
      const dlqEntry = ctx.storage.getDlqEntry(jobId2);
      if (dlqEntry)
        return dlqEntry.job;
    }
    return ctx.completedJobsData.get(jobId2) ?? null;
  }
  switch (location.type) {
    case "queue": {
      return await withReadLock(ctx.shardLocks[location.shardIdx], () => {
        const shard = ctx.shards[location.shardIdx];
        return shard.getQueue(location.queueName).find(jobId2) ?? shard.waitingDeps.get(jobId2) ?? shard.waitingChildren.get(jobId2) ?? null;
      });
    }
    case "processing": {
      return await withReadLock(ctx.processingLocks[location.shardIdx], () => {
        return ctx.processingShards[location.shardIdx].get(jobId2) ?? null;
      });
    }
    case "completed":
      return ctx.storage?.getJob(jobId2) ?? ctx.completedJobsData.get(jobId2) ?? null;
    case "dlq": {
      if (ctx.storage) {
        const dlqEntry = ctx.storage.getDlqEntry(jobId2);
        if (dlqEntry)
          return dlqEntry.job;
        const job = ctx.storage.getJob(jobId2);
        if (job)
          return job;
      }
      const dlqShardIdx = shardIndex(location.queueName);
      const dlqJobs = ctx.shards[dlqShardIdx].getDlq(location.queueName);
      return dlqJobs.find((j) => j.id === jobId2) ?? null;
    }
  }
}
function getJobResult(jobId2, ctx) {
  return ctx.jobResults.get(jobId2) ?? ctx.storage?.getResult(jobId2);
}
function getJobByCustomId(customId, ctx) {
  const jobId2 = ctx.customIdMap.get(customId);
  if (!jobId2)
    return null;
  const location = ctx.jobIndex.get(jobId2);
  if (!location)
    return null;
  if (location.type === "queue") {
    const shard = ctx.shards[location.shardIdx];
    return shard.getQueue(location.queueName).find(jobId2) ?? shard.waitingDeps.get(jobId2) ?? shard.waitingChildren.get(jobId2) ?? null;
  }
  if (location.type === "processing") {
    return ctx.processingShards[location.shardIdx].get(jobId2) ?? null;
  }
  if (location.type === "completed") {
    return ctx.storage?.getJob(jobId2) ?? ctx.completedJobsData.get(jobId2) ?? null;
  }
  if (location.type === "dlq") {
    if (ctx.storage) {
      const job = ctx.storage.getJob(jobId2);
      if (job)
        return job;
    }
    const dlqShardIdx = shardIndex(location.queueName);
    const dlqJobs = ctx.shards[dlqShardIdx].getDlq(location.queueName);
    return dlqJobs.find((j) => j.id === jobId2) ?? null;
  }
  return null;
}
function getJobProgress(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (location?.type !== "processing")
    return null;
  const job = ctx.processingShards[location.shardIdx].get(jobId2);
  if (!job)
    return null;
  return { progress: job.progress, message: job.progressMessage };
}
function resolveStateFromStorage(jobId2, storage) {
  if (!storage)
    return "unknown";
  if (storage.hasDlqEntry(jobId2))
    return "failed";
  const persisted = storage.getJobStateRaw(jobId2);
  if (persisted === "completed")
    return "completed";
  if (persisted === "active")
    return "active";
  if (persisted !== "waiting" && persisted !== "delayed")
    return "unknown";
  const row = storage.getJob(jobId2);
  if (!row)
    return "unknown";
  if (row.runAt > Date.now())
    return "delayed";
  return row.priority > 0 ? "prioritized" : "waiting";
}
async function getJobState(jobId2, ctx) {
  const location = ctx.jobIndex.get(jobId2);
  if (ctx.completedJobs.has(jobId2)) {
    return "completed";
  }
  if (!location) {
    return resolveStateFromStorage(jobId2, ctx.storage);
  }
  switch (location.type) {
    case "queue": {
      const result = await withReadLock(ctx.shardLocks[location.shardIdx], () => {
        const shard = ctx.shards[location.shardIdx];
        const queueJob = shard.getQueue(location.queueName).find(jobId2);
        if (queueJob)
          return { job: queueJob, waitingDeps: false, waitingChildren: false };
        const depsJob = shard.waitingDeps.get(jobId2);
        if (depsJob)
          return { job: depsJob, waitingDeps: true, waitingChildren: false };
        const childrenJob = shard.waitingChildren.get(jobId2);
        if (childrenJob)
          return { job: childrenJob, waitingDeps: false, waitingChildren: true };
        return null;
      });
      if (!result)
        return "unknown";
      if (result.waitingDeps || result.waitingChildren)
        return "waiting-children";
      const now = Date.now();
      if (result.job.runAt > now)
        return "delayed";
      return result.job.priority > 0 ? "prioritized" : "waiting";
    }
    case "processing":
      return "active";
    case "completed":
      return "completed";
    case "dlq":
      return "failed";
  }
}
function collectCompletedJobs(queue, ctx, maxCollect) {
  const jobs = [];
  for (const [jId, location] of ctx.jobIndex) {
    if (location.type === "completed" && location.queueName === queue) {
      const job = ctx.storage?.getJob(jId) ?? ctx.completedJobsData?.get(jId) ?? null;
      if (job) {
        jobs.push(job);
        if (jobs.length >= maxCollect)
          break;
      }
    }
  }
  return jobs;
}
function collectActiveJobs(queue, shardIdx, ctx, maxCollect) {
  const jobs = [];
  for (const job of ctx.processingShards[shardIdx].values()) {
    if (job.queue === queue)
      jobs.push(job);
    if (jobs.length >= maxCollect)
      return jobs;
  }
  for (let i = 0;i < ctx.shardCount; i++) {
    if (i === shardIdx)
      continue;
    for (const job of ctx.processingShards[i].values()) {
      if (job.queue === queue)
        jobs.push(job);
      if (jobs.length >= maxCollect)
        return jobs;
    }
  }
  return jobs;
}
function collectTemporalJobs(shard, queue, needs, maxCollect) {
  const { waiting: needWaiting, prioritized: needPrioritized, delayed: needDelayed } = needs;
  const now = Date.now();
  const jobs = [];
  for (const j of shard.getQueue(queue).values()) {
    if (jobs.length >= maxCollect)
      break;
    const isDelayed = j.runAt > now;
    if (isDelayed && needDelayed) {
      jobs.push(j);
    } else if (!isDelayed) {
      if (j.priority > 0 ? needPrioritized : needWaiting) {
        jobs.push(j);
      }
    }
  }
  return jobs;
}
function tagState(jobs, state) {
  for (const j of jobs)
    j._state = state;
  return jobs;
}
function tagTemporalState(jobs) {
  const now = Date.now();
  for (const j of jobs) {
    const isDelayed = j.runAt > now;
    j._state = isDelayed ? "delayed" : j.priority > 0 ? "prioritized" : "waiting";
  }
}
function collectWaitingChildrenFromShard(shard, queue, max) {
  const wcJobs = [];
  for (const job of shard.waitingDeps.values()) {
    if (job.queue === queue)
      wcJobs.push(job);
    if (wcJobs.length >= max)
      return wcJobs;
  }
  for (const job of shard.waitingChildren.values()) {
    if (job.queue === queue)
      wcJobs.push(job);
    if (wcJobs.length >= max)
      return wcJobs;
  }
  return wcJobs;
}
function resolveStateNeeds(states, paused) {
  const want = (s2) => !states || states.includes(s2);
  const suppressReady = !!states && paused;
  return {
    waiting: want("waiting") && !suppressReady,
    prioritized: want("prioritized") && !suppressReady,
    delayed: want("delayed"),
    paused: !!states && states.includes("paused") && paused,
    active: want("active"),
    failed: want("failed"),
    completed: want("completed"),
    waitingChildren: want("waiting-children")
  };
}
function collectPausedJobs(shard, queue, maxPerSource) {
  const pausedJobs = collectTemporalJobs(shard, queue, { waiting: true, prioritized: true, delayed: false }, maxPerSource);
  return tagState(pausedJobs, "paused");
}
function collectJobsByState(queue, shardIdx, states, ctx, maxPerSource = Infinity) {
  const shard = ctx.shards[shardIdx];
  const jobs = [];
  const need = resolveStateNeeds(states, shard.getState(queue).paused);
  if (need.waiting || need.prioritized || need.delayed) {
    const temporal = collectTemporalJobs(shard, queue, { waiting: need.waiting, prioritized: need.prioritized, delayed: need.delayed }, maxPerSource);
    tagTemporalState(temporal);
    jobs.push(...temporal);
  }
  if (need.paused) {
    jobs.push(...collectPausedJobs(shard, queue, maxPerSource));
  }
  if (need.active) {
    jobs.push(...tagState(collectActiveJobs(queue, shardIdx, ctx, maxPerSource), "active"));
  }
  if (need.failed) {
    const dlq = shard.getDlq(queue);
    jobs.push(...tagState(maxPerSource < dlq.length ? dlq.slice(0, maxPerSource) : dlq, "failed"));
  }
  if (need.completed) {
    jobs.push(...tagState(collectCompletedJobs(queue, ctx, maxPerSource), "completed"));
  }
  if (need.waitingChildren) {
    jobs.push(...tagState(collectWaitingChildrenFromShard(shard, queue, maxPerSource), "waiting-children"));
  }
  return jobs;
}
function collectWaitingChildrenJobs(shard, queue) {
  const jobs = [];
  for (const job of shard.waitingDeps.values()) {
    if (job.queue === queue)
      jobs.push(job);
  }
  for (const job of shard.waitingChildren.values()) {
    if (job.queue === queue)
      jobs.push(job);
  }
  return jobs;
}
function querySqliteWithPriority(storage, queue, sqlFilteredStates, opts) {
  const hasPrioritized = sqlFilteredStates.includes("prioritized");
  const hasWaiting = sqlFilteredStates.includes("waiting");
  if (!hasPrioritized && !hasWaiting) {
    if (sqlFilteredStates.length === 1) {
      return storage.queryJobs(queue, { state: sqlFilteredStates[0], ...opts });
    }
    return storage.queryJobs(queue, { states: sqlFilteredStates, ...opts });
  }
  const sqlStates = sqlFilteredStates.map((s2) => s2 === "prioritized" ? "waiting" : s2).filter((s2, i, arr) => arr.indexOf(s2) === i);
  const overFetchOpts = { ...opts, limit: opts.limit * 2 };
  let jobs = sqlStates.length === 1 ? storage.queryJobs(queue, { state: sqlStates[0], ...overFetchOpts }) : storage.queryJobs(queue, { states: sqlStates, ...overFetchOpts });
  if (hasPrioritized && !hasWaiting) {
    jobs = jobs.filter((j) => j.priority > 0);
  } else if (hasWaiting && !hasPrioritized) {
    jobs = jobs.filter((j) => j.priority <= 0);
  }
  return jobs.slice(0, opts.limit);
}
function mergePage(sqlJobs, extras, start, end, asc) {
  const merged = sqlJobs.concat(extras);
  merged.sort((a, b2) => asc ? a.createdAt - b2.createdAt : b2.createdAt - a.createdAt);
  return merged.slice(start, end);
}
function getJobs(queue, shardIdx, options, ctx) {
  const { state, start = 0, end = 100, asc = true } = options;
  const states = !state ? null : Array.isArray(state) ? state.length === 0 ? null : state : [state];
  const limit = end - start;
  if (ctx.storage) {
    const shard = ctx.shards[shardIdx];
    const isPaused = shard.getState(queue).paused;
    const maxPerSource2 = end + 1;
    if (!states) {
      const dlq = tagState(shard.getDlq(queue), "failed");
      if (dlq.length === 0) {
        return ctx.storage.queryJobs(queue, { limit, offset: start, asc });
      }
      const all = ctx.storage.queryJobs(queue, { limit: end, offset: 0, asc });
      return mergePage(all, dlq, start, end, asc);
    }
    const extras = [];
    if (states.includes("failed")) {
      extras.push(...tagState(shard.getDlq(queue), "failed"));
    }
    if (states.includes("waiting-children")) {
      extras.push(...collectWaitingChildrenJobs(shard, queue));
    }
    if (states.includes("paused") && isPaused) {
      const pausedJobs = collectTemporalJobs(shard, queue, { waiting: true, prioritized: true, delayed: false }, maxPerSource2);
      extras.push(...tagState(pausedJobs, "paused"));
    }
    const sqlFilteredStates = states.filter((s2) => s2 !== "failed" && s2 !== "waiting-children" && s2 !== "paused" && !(isPaused && (s2 === "waiting" || s2 === "prioritized")));
    if (extras.length === 0) {
      return sqlFilteredStates.length > 0 ? querySqliteWithPriority(ctx.storage, queue, sqlFilteredStates, {
        limit,
        offset: start,
        asc
      }) : [];
    }
    const sqlJobs = sqlFilteredStates.length > 0 ? querySqliteWithPriority(ctx.storage, queue, sqlFilteredStates, {
      limit: end,
      offset: 0,
      asc
    }) : [];
    return mergePage(sqlJobs, extras, start, end, asc);
  }
  const maxPerSource = end + 1;
  const jobs = collectJobsByState(queue, shardIdx, states, ctx, maxPerSource);
  jobs.sort((a, b2) => asc ? a.createdAt - b2.createdAt : b2.createdAt - a.createdAt);
  return jobs.slice(start, end);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/dlqManager.js
function getDlqJobs(queue, ctx, count) {
  const idx = shardIndex(queue);
  return ctx.shards[idx].getDlq(queue, count);
}
function getDlqEntries(queue, ctx, filter) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  if (filter) {
    return shard.getDlqFiltered(queue, filter);
  }
  return shard.getDlqEntries(queue);
}
function getDlqStats(queue, ctx) {
  const idx = shardIndex(queue);
  const entries = ctx.shards[idx].getDlqEntries(queue);
  const config = ctx.shards[idx].getDlqConfig(queue);
  const now = Date.now();
  const stats = {
    total: entries.length,
    byReason: {
      ["explicit_fail"]: 0,
      ["max_attempts_exceeded"]: 0,
      ["timeout"]: 0,
      ["stalled"]: 0,
      ["ttl_expired"]: 0,
      ["worker_lost"]: 0,
      ["unknown"]: 0
    },
    byQueue: { [queue]: entries.length },
    pendingRetry: 0,
    expired: 0,
    oldestEntry: null,
    newestEntry: null
  };
  for (const entry of entries) {
    stats.byReason[entry.reason]++;
    if (entry.nextRetryAt && entry.nextRetryAt <= now && entry.retryCount < config.maxAutoRetries) {
      stats.pendingRetry++;
    }
    if (entry.expiresAt && entry.expiresAt <= now) {
      stats.expired++;
    }
    if (stats.oldestEntry === null || entry.enteredAt < stats.oldestEntry) {
      stats.oldestEntry = entry.enteredAt;
    }
    if (stats.newestEntry === null || entry.enteredAt > stats.newestEntry) {
      stats.newestEntry = entry.enteredAt;
    }
  }
  return stats;
}
function retryDlqJob(queue, jobId2, ctx) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const now = Date.now();
  const entry = shard.removeFromDlq(queue, jobId2);
  if (!entry)
    return null;
  ctx.storage?.deleteDlqEntry(jobId2);
  const job = entry.job;
  job.attempts = 0;
  job.runAt = now;
  job.stallCount = 0;
  job.lastHeartbeat = now;
  if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
    job.timeline.push({ state: "waiting", timestamp: now });
  }
  shard.getQueue(queue).push(job);
  const isDelayed = job.runAt > now;
  shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
  ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: queue });
  ctx.storage?.insertJob(job, true);
  return job;
}
function retryDlqJobs(queue, ctx, jobId2) {
  if (jobId2) {
    return retryDlqJob(queue, jobId2, ctx) ? 1 : 0;
  }
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const entries = shard.getDlqEntries(queue);
  const count = entries.length;
  shard.clearDlq(queue);
  ctx.storage?.clearDlqQueue(queue);
  const now = Date.now();
  for (const entry of entries) {
    const job = entry.job;
    job.attempts = 0;
    job.runAt = now;
    job.stallCount = 0;
    job.lastHeartbeat = now;
    if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
      job.timeline.push({ state: "waiting", timestamp: now });
    }
    shard.getQueue(queue).push(job);
    const isDelayed = job.runAt > now;
    shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
    ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: queue });
    ctx.storage?.insertJob(job, true);
  }
  return count;
}
function retryDlqByFilter(queue, ctx, filter) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const entries = shard.getDlqFiltered(queue, filter);
  let count = 0;
  const now = Date.now();
  for (const entry of entries) {
    const removed = shard.removeFromDlq(queue, entry.job.id);
    if (!removed)
      continue;
    ctx.storage?.deleteDlqEntry(entry.job.id);
    const job = entry.job;
    job.attempts = 0;
    job.runAt = now;
    job.stallCount = 0;
    job.lastHeartbeat = now;
    if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
      job.timeline.push({ state: "waiting", timestamp: now });
    }
    shard.getQueue(queue).push(job);
    const isDelayed = job.runAt > now;
    shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
    ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: queue });
    ctx.storage?.insertJob(job, true);
    count++;
  }
  return count;
}
function processAutoRetry(queue, ctx) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const config = shard.getDlqConfig(queue);
  if (!config.autoRetry)
    return 0;
  const now = Date.now();
  const entries = shard.getAutoRetryEntries(queue, now);
  let count = 0;
  for (const entry of entries) {
    scheduleNextRetry(entry, config);
    const removed = shard.removeFromDlq(queue, entry.job.id);
    if (!removed)
      continue;
    const job = entry.job;
    job.attempts = 0;
    job.runAt = now;
    job.stallCount = 0;
    job.lastHeartbeat = now;
    if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
      job.timeline.push({ state: "waiting", timestamp: now });
    }
    shard.getQueue(queue).push(job);
    const isDelayed = job.runAt > now;
    shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
    ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: queue });
    ctx.storage?.insertJob(job, true);
    count++;
  }
  return count;
}
function purgeExpiredDlq(queue, ctx) {
  const idx = shardIndex(queue);
  const shard = ctx.shards[idx];
  const expiredEntries = shard.getExpiredEntries(queue);
  const count = shard.purgeExpired(queue);
  if (ctx.storage && expiredEntries.length > 0) {
    for (const entry of expiredEntries) {
      ctx.storage.deleteDlqEntry(entry.job.id);
    }
  }
  return count;
}
function purgeDlqJobs(queue, ctx) {
  const idx = shardIndex(queue);
  const count = ctx.shards[idx].clearDlq(queue);
  ctx.storage?.clearDlqQueue(queue);
  return count;
}
function configureDlq(queue, ctx, config) {
  const idx = shardIndex(queue);
  ctx.shards[idx].setDlqConfig(queue, config);
}
function getDlqConfig(queue, ctx) {
  const idx = shardIndex(queue);
  return ctx.shards[idx].getDlqConfig(queue);
}
function retryCompletedJobs(queue, ctx, jobId2) {
  if (jobId2) {
    if (!ctx.completedJobs.has(jobId2))
      return 0;
    const job = ctx.storage?.getJob(jobId2);
    if (job?.queue !== queue)
      return 0;
    return requeueCompletedJob(job, ctx);
  }
  let count = 0;
  for (const id of ctx.completedJobs) {
    const job = ctx.storage?.getJob(id);
    if (job?.queue === queue)
      count += requeueCompletedJob(job, ctx);
  }
  return count;
}
function requeueCompletedJob(job, ctx) {
  job.attempts = 0;
  job.startedAt = null;
  job.completedAt = null;
  job.runAt = Date.now();
  job.progress = 0;
  if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
    job.timeline.push({ state: "waiting", timestamp: job.runAt });
  }
  const idx = shardIndex(job.queue);
  const shard = ctx.shards[idx];
  shard.getQueue(job.queue).push(job);
  shard.incrementQueued(job.id, false, job.createdAt, job.queue, job.runAt);
  ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: job.queue });
  ctx.completedJobs.delete(job.id);
  ctx.jobResults.delete(job.id);
  ctx.storage?.updateForRetry(job);
  shard.notify();
  return 1;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/jobLogsManager.js
function addJobLog(jobId2, message, ctx, level = "info") {
  const location = ctx.jobIndex.get(jobId2);
  if (!location)
    return false;
  const logs = ctx.jobLogs.get(jobId2) ?? [];
  logs.push(createLogEntry(message, level));
  if (logs.length > ctx.maxLogsPerJob) {
    logs.splice(0, logs.length - ctx.maxLogsPerJob);
  }
  ctx.jobLogs.set(jobId2, logs);
  return true;
}
function getJobLogs(jobId2, ctx) {
  return ctx.jobLogs.get(jobId2) ?? [];
}
function clearJobLogs(jobId2, ctx, keepLogs) {
  if (keepLogs === undefined || keepLogs <= 0) {
    ctx.jobLogs.delete(jobId2);
  } else {
    const logs = ctx.jobLogs.get(jobId2);
    if (logs && logs.length > keepLogs) {
      const trimmed = logs.slice(-keepLogs);
      ctx.jobLogs.set(jobId2, trimmed);
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/metricsExporter.js
function generatePrometheusMetrics(stats, workerManager, webhookManager, perQueueStats) {
  const workerStats = workerManager.getStats();
  const webhookStats = webhookManager.getStats();
  const lines = [
    "# HELP bunqueue_jobs_waiting Number of jobs waiting in queue",
    "# TYPE bunqueue_jobs_waiting gauge",
    `bunqueue_jobs_waiting ${stats.waiting}`,
    "",
    "# HELP bunqueue_jobs_prioritized Number of prioritized jobs (priority > 0)",
    "# TYPE bunqueue_jobs_prioritized gauge",
    `bunqueue_jobs_prioritized ${stats.prioritized}`,
    "",
    "# HELP bunqueue_jobs_delayed Number of delayed jobs",
    "# TYPE bunqueue_jobs_delayed gauge",
    `bunqueue_jobs_delayed ${stats.delayed}`,
    "",
    "# HELP bunqueue_jobs_active Number of jobs being processed",
    "# TYPE bunqueue_jobs_active gauge",
    `bunqueue_jobs_active ${stats.active}`,
    "",
    "# HELP bunqueue_jobs_dlq Number of jobs in dead letter queue",
    "# TYPE bunqueue_jobs_dlq gauge",
    `bunqueue_jobs_dlq ${stats.dlq}`,
    "",
    "# HELP bunqueue_jobs_completed Number of completed jobs",
    "# TYPE bunqueue_jobs_completed gauge",
    `bunqueue_jobs_completed ${stats.completed}`,
    "",
    "# HELP bunqueue_jobs_pushed_total Total jobs pushed",
    "# TYPE bunqueue_jobs_pushed_total counter",
    `bunqueue_jobs_pushed_total ${stats.totalPushed}`,
    "",
    "# HELP bunqueue_jobs_pulled_total Total jobs pulled",
    "# TYPE bunqueue_jobs_pulled_total counter",
    `bunqueue_jobs_pulled_total ${stats.totalPulled}`,
    "",
    "# HELP bunqueue_jobs_completed_total Total jobs completed",
    "# TYPE bunqueue_jobs_completed_total counter",
    `bunqueue_jobs_completed_total ${stats.totalCompleted}`,
    "",
    "# HELP bunqueue_jobs_failed_total Total jobs failed",
    "# TYPE bunqueue_jobs_failed_total counter",
    `bunqueue_jobs_failed_total ${stats.totalFailed}`,
    "",
    "# HELP bunqueue_uptime_seconds Server uptime in seconds",
    "# TYPE bunqueue_uptime_seconds gauge",
    `bunqueue_uptime_seconds ${Math.floor(stats.uptime / 1000)}`,
    "",
    "# HELP bunqueue_cron_jobs_total Total number of cron jobs",
    "# TYPE bunqueue_cron_jobs_total gauge",
    `bunqueue_cron_jobs_total ${stats.cronJobs}`,
    "",
    "# HELP bunqueue_workers_total Total number of registered workers",
    "# TYPE bunqueue_workers_total gauge",
    `bunqueue_workers_total ${workerStats.total}`,
    "",
    "# HELP bunqueue_workers_active Number of active workers",
    "# TYPE bunqueue_workers_active gauge",
    `bunqueue_workers_active ${workerStats.active}`,
    "",
    "# HELP bunqueue_workers_processed_total Total jobs processed by workers",
    "# TYPE bunqueue_workers_processed_total counter",
    `bunqueue_workers_processed_total ${workerStats.totalProcessed}`,
    "",
    "# HELP bunqueue_workers_failed_total Total jobs failed by workers",
    "# TYPE bunqueue_workers_failed_total counter",
    `bunqueue_workers_failed_total ${workerStats.totalFailed}`,
    "",
    "# HELP bunqueue_webhooks_total Total number of webhooks",
    "# TYPE bunqueue_webhooks_total gauge",
    `bunqueue_webhooks_total ${webhookStats.total}`,
    "",
    "# HELP bunqueue_webhooks_enabled Number of enabled webhooks",
    "# TYPE bunqueue_webhooks_enabled gauge",
    `bunqueue_webhooks_enabled ${webhookStats.enabled}`
  ];
  if (perQueueStats && perQueueStats.size > 0) {
    lines.push("");
    lines.push("# HELP bunqueue_queue_jobs_waiting Number of waiting jobs per queue");
    lines.push("# TYPE bunqueue_queue_jobs_waiting gauge");
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_waiting{queue="${queue}"} ${qs.waiting}`);
    }
    lines.push("");
    lines.push("# HELP bunqueue_queue_jobs_prioritized Number of prioritized jobs per queue");
    lines.push("# TYPE bunqueue_queue_jobs_prioritized gauge");
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_prioritized{queue="${queue}"} ${qs.prioritized}`);
    }
    lines.push("");
    lines.push("# HELP bunqueue_queue_jobs_delayed Number of delayed jobs per queue");
    lines.push("# TYPE bunqueue_queue_jobs_delayed gauge");
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_delayed{queue="${queue}"} ${qs.delayed}`);
    }
    lines.push("");
    lines.push("# HELP bunqueue_queue_jobs_active Number of active jobs per queue");
    lines.push("# TYPE bunqueue_queue_jobs_active gauge");
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_active{queue="${queue}"} ${qs.active}`);
    }
    lines.push("");
    lines.push("# HELP bunqueue_queue_jobs_dlq Number of DLQ jobs per queue");
    lines.push("# TYPE bunqueue_queue_jobs_dlq gauge");
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_dlq{queue="${queue}"} ${qs.dlq}`);
    }
  }
  const histogramOutput = latencyTracker.toPrometheus();
  if (histogramOutput) {
    lines.push("");
    lines.push(histogramOutput);
  }
  return lines.join(`
`);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/lruMap.js
class LRUMap {
  cache = new Map;
  maxSize;
  onEvict;
  head = null;
  tail = null;
  constructor(maxSize, onEvict) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }
  moveToFront(node) {
    if (node === this.head)
      return;
    if (node.prev)
      node.prev.next = node.next;
    if (node.next)
      node.next.prev = node.prev;
    if (node === this.tail)
      this.tail = node.prev;
    node.prev = null;
    node.next = this.head;
    if (this.head)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }
  removeNode(node) {
    if (node.prev)
      node.prev.next = node.next;
    if (node.next)
      node.next.prev = node.prev;
    if (node === this.head)
      this.head = node.next;
    if (node === this.tail)
      this.tail = node.prev;
  }
  addToFront(node) {
    node.prev = null;
    node.next = this.head;
    if (this.head)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }
  get(key) {
    const node = this.cache.get(key);
    if (!node)
      return;
    this.moveToFront(node);
    return node.value;
  }
  set(key, value) {
    const existing = this.cache.get(key);
    if (existing) {
      existing.value = value;
      this.moveToFront(existing);
    } else {
      if (this.cache.size >= this.maxSize && this.tail) {
        const evicted = this.tail;
        this.cache.delete(evicted.key);
        this.removeNode(evicted);
        this.onEvict?.(evicted.key, evicted.value);
      }
      const node = { key, value, prev: null, next: null };
      this.cache.set(key, node);
      this.addToFront(node);
    }
  }
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    const node = this.cache.get(key);
    if (!node)
      return false;
    this.removeNode(node);
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }
  get size() {
    return this.cache.size;
  }
  *keys() {
    let current = this.tail;
    while (current) {
      yield current.key;
      current = current.prev;
    }
  }
  *values() {
    let current = this.tail;
    while (current) {
      yield current.value;
      current = current.prev;
    }
  }
  *entries() {
    let current = this.tail;
    while (current) {
      yield [current.key, current.value];
      current = current.prev;
    }
  }
  forEach(callback) {
    let current = this.tail;
    while (current) {
      callback(current.value, current.key);
      current = current.prev;
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/lruSet.js
class LRUSet {
  cache = new Map;
  maxSize;
  onEvict;
  head = null;
  tail = null;
  constructor(maxSize, onEvict) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }
  moveToFront(node) {
    if (node === this.head)
      return;
    if (node.prev)
      node.prev.next = node.next;
    if (node.next)
      node.next.prev = node.prev;
    if (node === this.tail)
      this.tail = node.prev;
    node.prev = null;
    node.next = this.head;
    if (this.head)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }
  removeNode(node) {
    if (node.prev)
      node.prev.next = node.next;
    if (node.next)
      node.next.prev = node.prev;
    if (node === this.head)
      this.head = node.next;
    if (node === this.tail)
      this.tail = node.prev;
  }
  addToFront(node) {
    node.prev = null;
    node.next = this.head;
    if (this.head)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }
  add(value) {
    const existing = this.cache.get(value);
    if (existing) {
      this.moveToFront(existing);
    } else {
      if (this.cache.size >= this.maxSize && this.tail) {
        const evicted = this.tail;
        this.cache.delete(evicted.value);
        this.removeNode(evicted);
        this.onEvict?.(evicted.value);
      }
      const node = { value, prev: null, next: null };
      this.cache.set(value, node);
      this.addToFront(node);
    }
  }
  has(value) {
    return this.cache.has(value);
  }
  delete(value) {
    const node = this.cache.get(value);
    if (!node)
      return false;
    this.removeNode(node);
    return this.cache.delete(value);
  }
  clear() {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }
  get size() {
    return this.cache.size;
  }
  *values() {
    let current = this.tail;
    while (current) {
      yield current.value;
      current = current.prev;
    }
  }
  [Symbol.iterator]() {
    return this.values();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/boundedSet.js
class BoundedSet {
  cache = new Set;
  maxSize;
  onEvict;
  evictBatchSize;
  constructor(maxSize, onEvict) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
    this.evictBatchSize = Math.max(1, Math.floor(maxSize * 0.1));
  }
  add(value) {
    if (this.cache.has(value))
      return;
    if (this.cache.size >= this.maxSize) {
      this.evictBatch();
    }
    this.cache.add(value);
  }
  evictBatch() {
    const toEvict = [];
    const iter = this.cache.values();
    for (let i = 0;i < this.evictBatchSize; i++) {
      const { value, done } = iter.next();
      if (done)
        break;
      toEvict.push(value);
    }
    for (const value of toEvict) {
      this.cache.delete(value);
      this.onEvict?.(value);
    }
  }
  has(value) {
    return this.cache.has(value);
  }
  delete(value) {
    return this.cache.delete(value);
  }
  clear() {
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
  values() {
    return this.cache.values();
  }
  [Symbol.iterator]() {
    return this.cache[Symbol.iterator]();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/boundedMap.js
class BoundedMap {
  cache = new Map;
  maxSize;
  onEvict;
  evictBatchSize;
  constructor(maxSize, onEvict) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
    this.evictBatchSize = Math.max(1, Math.floor(maxSize * 0.1));
  }
  get(key) {
    return this.cache.get(key);
  }
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      return;
    }
    if (this.cache.size >= this.maxSize) {
      this.evictBatch();
    }
    this.cache.set(key, value);
  }
  evictBatch() {
    const toEvict = [];
    const iter = this.cache.entries();
    for (let i = 0;i < this.evictBatchSize; i++) {
      const { value, done } = iter.next();
      if (done)
        break;
      toEvict.push({ key: value[0], value: value[1] });
    }
    for (const { key, value } of toEvict) {
      this.cache.delete(key);
      this.onEvict?.(key, value);
    }
  }
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
  keys() {
    return this.cache.keys();
  }
  values() {
    return this.cache.values();
  }
  entries() {
    return this.cache.entries();
  }
  forEach(callback) {
    this.cache.forEach(callback);
  }
  [Symbol.iterator]() {
    return this.cache[Symbol.iterator]();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/ttlMap.js
class TTLMap {
  cache = new Map;
  ttlMs;
  cleanupInterval = null;
  expiryHeap = new MinHeap((a, b2) => a.expiresAt - b2.expiresAt);
  staleCount = 0;
  static COMPACTION_THRESHOLD = 0.5;
  static MIN_COMPACTION_SIZE = 100;
  constructor(ttlMs, cleanupIntervalMs = 60000) {
    this.ttlMs = ttlMs;
    this.startCleanup(cleanupIntervalMs);
  }
  startCleanup(intervalMs) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }
  cleanup() {
    const now = Date.now();
    while (!this.expiryHeap.isEmpty) {
      const top = this.expiryHeap.peek();
      if (!top || top.expiresAt > now)
        break;
      this.expiryHeap.pop();
      const { key, expiresAt } = top;
      const entry = this.cache.get(key);
      if (entry?.expiresAt === expiresAt) {
        this.cache.delete(key);
      } else {
        if (this.staleCount > 0)
          this.staleCount--;
      }
    }
    this.maybeCompact();
  }
  maybeCompact() {
    const heapSize = this.expiryHeap.size;
    if (heapSize >= TTLMap.MIN_COMPACTION_SIZE && this.staleCount / heapSize > TTLMap.COMPACTION_THRESHOLD) {
      this.rebuildHeap();
    }
  }
  rebuildHeap() {
    this.expiryHeap.clear();
    this.staleCount = 0;
    for (const [key, entry] of this.cache) {
      this.expiryHeap.push({ expiresAt: entry.expiresAt, key });
    }
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry)
      return;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      this.staleCount++;
      return;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    const expiresAt = Date.now() + (ttlMs ?? this.ttlMs);
    if (this.cache.has(key)) {
      this.staleCount++;
    }
    this.cache.set(key, { value, expiresAt });
    this.expiryHeap.push({ expiresAt, key });
  }
  has(key) {
    return this.get(key) !== undefined;
  }
  delete(key) {
    const existed = this.cache.delete(key);
    if (existed) {
      this.staleCount++;
    }
    return existed;
  }
  clear() {
    this.cache.clear();
    this.expiryHeap.clear();
    this.staleCount = 0;
  }
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  get size() {
    return this.cache.size;
  }
  get heapSize() {
    return this.expiryHeap.size;
  }
  get staleEntryCount() {
    return this.staleCount;
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/types.js
var DEFAULT_CONFIG = {
  maxCompletedJobs: 50000,
  maxJobResults: 1e4,
  maxJobLogs: 1e4,
  maxCustomIds: 50000,
  maxWaitingDeps: 1e4,
  cleanupIntervalMs: 1e4,
  jobTimeoutCheckMs: 5000,
  dependencyCheckMs: 30000,
  stallCheckMs: 5000,
  dlqMaintenanceMs: 60000
};

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/lockOperations.js
function createLock(jobId2, owner, ctx, ttl = DEFAULT_LOCK_TTL) {
  const loc = ctx.jobIndex.get(jobId2);
  if (loc?.type !== "processing")
    return null;
  if (ctx.jobLocks.has(jobId2)) {
    return null;
  }
  const lock = createJobLock(jobId2, owner, ttl);
  ctx.jobLocks.set(jobId2, lock);
  return lock.token;
}
function verifyLock(jobId2, token, ctx) {
  const lock = ctx.jobLocks.get(jobId2);
  if (!lock)
    return false;
  if (lock.token !== token)
    return false;
  if (isLockExpired(lock))
    return false;
  return true;
}
function renewJobLock(jobId2, token, ctx, newTtl) {
  const lock = ctx.jobLocks.get(jobId2);
  if (!lock)
    return false;
  if (lock.token !== token)
    return false;
  if (isLockExpired(lock)) {
    ctx.jobLocks.delete(jobId2);
    return false;
  }
  renewLock(lock, newTtl);
  const loc = ctx.jobIndex.get(jobId2);
  if (loc?.type === "processing") {
    const job = ctx.processingShards[loc.shardIdx].get(jobId2);
    if (job)
      job.lastHeartbeat = Date.now();
  }
  return true;
}
function renewJobLockBatch(items, ctx) {
  const renewed = [];
  for (const item of items) {
    if (renewJobLock(item.id, item.token, ctx, item.ttl)) {
      renewed.push(String(item.id));
    }
  }
  return renewed;
}
function releaseLock(jobId2, ctx, token) {
  const lock = ctx.jobLocks.get(jobId2);
  if (!lock)
    return true;
  if (token && lock.token !== token) {
    return false;
  }
  ctx.jobLocks.delete(jobId2);
  return true;
}
function getLockInfo(jobId2, ctx) {
  return ctx.jobLocks.get(jobId2) ?? null;
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/clientTracking.js
function registerClientJob(clientId, jobId2, ctx) {
  let jobs = ctx.clientJobs.get(clientId);
  if (!jobs) {
    jobs = new Set;
    ctx.clientJobs.set(clientId, jobs);
  }
  jobs.add(jobId2);
}
function unregisterClientJob(clientId, jobId2, ctx) {
  if (!clientId)
    return;
  const jobs = ctx.clientJobs.get(clientId);
  if (jobs) {
    jobs.delete(jobId2);
    if (jobs.size === 0) {
      ctx.clientJobs.delete(clientId);
    }
  }
}
async function releaseClientJobs(clientId, ctx) {
  const jobs = ctx.clientJobs.get(clientId);
  if (!jobs || jobs.size === 0) {
    ctx.clientJobs.delete(clientId);
    return 0;
  }
  const jobsToRelease = [];
  for (const jobId2 of jobs) {
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type !== "processing")
      continue;
    const lock = ctx.jobLocks.get(jobId2);
    if (lock && lock.renewalCount > 0)
      continue;
    const procIdx = loc.shardIdx;
    const job = ctx.processingShards[procIdx].get(jobId2);
    if (!job)
      continue;
    jobsToRelease.push({
      jobId: jobId2,
      procIdx,
      queueShardIdx: shardIndex(job.queue)
    });
  }
  if (jobsToRelease.length === 0) {
    ctx.clientJobs.delete(clientId);
    return 0;
  }
  const byProcShard = new Map;
  for (const item of jobsToRelease) {
    let list = byProcShard.get(item.procIdx);
    if (!list) {
      list = [];
      byProcShard.set(item.procIdx, list);
    }
    list.push(item);
  }
  let released = 0;
  const now = Date.now();
  try {
    for (const [procIdx, items] of byProcShard) {
      const byQueueShard = new Map;
      for (const item of items) {
        let list = byQueueShard.get(item.queueShardIdx);
        if (!list) {
          list = [];
          byQueueShard.set(item.queueShardIdx, list);
        }
        list.push(item);
      }
      for (const [queueShardIdx, shardItems] of byQueueShard) {
        await withWriteLock(ctx.shardLocks[queueShardIdx], async () => {
          await withWriteLock(ctx.processingLocks[procIdx], () => {
            for (const { jobId: jobId2 } of shardItems) {
              const job = ctx.processingShards[procIdx].get(jobId2);
              if (!job)
                continue;
              released += releaseJobToQueue({ jobId: jobId2, job, procIdx, queueShardIdx, ctx, now });
            }
          });
        });
      }
    }
    return released;
  } finally {
    ctx.clientJobs.delete(clientId);
  }
}
function forceReleaseClientJobs(clientId, ctx) {
  const jobs = ctx.clientJobs.get(clientId);
  if (!jobs || jobs.size === 0) {
    ctx.clientJobs.delete(clientId);
    return 0;
  }
  let touched = 0;
  for (const jobId2 of jobs) {
    ctx.jobLocks.delete(jobId2);
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type !== "processing")
      continue;
    const job = ctx.processingShards[loc.shardIdx].get(jobId2);
    if (!job)
      continue;
    job.lastHeartbeat = 0;
    job.startedAt = 0;
    touched++;
  }
  ctx.clientJobs.delete(clientId);
  return touched;
}
function releaseJobToQueue(opts) {
  const { jobId: jobId2, job, procIdx, queueShardIdx, ctx, now } = opts;
  const shard = ctx.shards[queueShardIdx];
  ctx.processingShards[procIdx].delete(jobId2);
  ctx.jobLocks.delete(jobId2);
  shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  if (job.uniqueKey?.startsWith("cron:")) {
    ctx.jobIndex.delete(jobId2);
    ctx.storage?.deleteJob(jobId2);
    return 1;
  }
  job.startedAt = null;
  job.lastHeartbeat = now;
  shard.getQueue(job.queue).push(job);
  const isDelayed = job.runAt > now;
  shard.incrementQueued(jobId2, isDelayed, job.createdAt, job.queue, job.runAt);
  ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: queueShardIdx, queueName: job.queue });
  return 1;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/lockManager.js
async function checkExpiredLocks(ctx) {
  const now = Date.now();
  const expired = [];
  for (const [jobId2, lock] of ctx.jobLocks) {
    if (isLockExpired(lock, now)) {
      const procIdx = processingShardIndex(jobId2);
      const job = ctx.processingShards[procIdx].get(jobId2);
      if (job) {
        const shardIdx = shardIndex(job.queue);
        expired.push({ jobId: jobId2, lock, procIdx, shardIdx, job });
      } else {
        ctx.jobLocks.delete(jobId2);
      }
    }
  }
  if (expired.length === 0)
    return;
  const byShard = new Map;
  for (const item of expired) {
    let procMap = byShard.get(item.shardIdx);
    if (!procMap) {
      procMap = new Map;
      byShard.set(item.shardIdx, procMap);
    }
    let list = procMap.get(item.procIdx);
    if (!list) {
      list = [];
      procMap.set(item.procIdx, list);
    }
    list.push(item);
  }
  for (const [shardIdx, procMap] of byShard) {
    await withWriteLock(ctx.shardLocks[shardIdx], async () => {
      for (const [procIdx, items] of procMap) {
        await withWriteLock(ctx.processingLocks[procIdx], async () => {
          for (const { jobId: jobId2, lock, job } of items) {
            processExpiredLockInner(jobId2, lock, job, shardIdx, procIdx, ctx, now);
          }
        });
      }
    });
  }
}
function processExpiredLockInner(jobId2, lock, job, shardIdx, procIdx, ctx, now) {
  const shard = ctx.shards[shardIdx];
  const queue = shard.getQueue(job.queue);
  ctx.processingShards[procIdx].delete(jobId2);
  if (job.uniqueKey?.startsWith("cron:")) {
    shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
    ctx.jobIndex.delete(jobId2);
    ctx.storage?.deleteJob(jobId2);
    ctx.jobLocks.delete(jobId2);
    return;
  }
  job.attempts++;
  job.startedAt = null;
  job.lastHeartbeat = now;
  job.stallCount++;
  const stallConfig = shard.getStallConfig(job.queue);
  if (stallConfig.maxStalls > 0 && job.stallCount >= stallConfig.maxStalls) {
    handleMaxStallsExceeded({ jobId: jobId2, job, lock, shard, ctx, now });
  } else {
    requeueExpiredJob({ jobId: jobId2, job, lock, queue, idx: shardIdx, ctx, now });
  }
  ctx.jobLocks.delete(jobId2);
  ctx.dashboardEmit?.("job:lock-expired", {
    jobId: String(jobId2),
    queue: job.queue,
    renewalCount: lock.renewalCount
  });
}
function handleMaxStallsExceeded(opts) {
  const { jobId: jobId2, job, lock, shard, ctx, now } = opts;
  shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  const entry = shard.addToDlq(job, "stalled", `Lock expired after ${lock.renewalCount} renewals`);
  ctx.jobIndex.set(jobId2, { type: "dlq", queueName: job.queue });
  ctx.storage?.saveDlqEntry(entry);
  ctx.storage?.deleteJob(jobId2);
  ctx.eventsManager.broadcast({
    eventType: "failed",
    jobId: jobId2,
    queue: job.queue,
    timestamp: now,
    error: "Lock expired (max stalls reached)"
  });
}
function requeueExpiredJob(opts) {
  const { jobId: jobId2, job, queue, idx, ctx, now } = opts;
  const shard = ctx.shards[idx];
  shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  queue.push(job);
  const isDelayed = job.runAt > now;
  shard.incrementQueued(jobId2, isDelayed, job.createdAt, job.queue, job.runAt);
  ctx.jobIndex.set(jobId2, { type: "queue", shardIdx: idx, queueName: job.queue });
  shard.notify();
  ctx.eventsManager.broadcast({
    eventType: "stalled",
    jobId: jobId2,
    queue: job.queue,
    timestamp: now
  });
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/cleanupTasks.js
async function cleanup(ctx) {
  const now = Date.now();
  const stallTimeout = 30 * 60 * 1000;
  for (let i = 0;i < SHARD_COUNT; i++) {
    ctx.shards[i].refreshDelayedCount(now);
  }
  for (let i = 0;i < SHARD_COUNT; i++) {
    for (const q of ctx.shards[i].queues.values()) {
      if (q.needsCompaction(0.2)) {
        q.compact();
      }
    }
  }
  await cleanOrphanedProcessingEntries(ctx, now, stallTimeout);
  cleanStaleWaitingDependencies(ctx, now);
  cleanUniqueKeysAndGroups(ctx);
  cleanStalledCandidates(ctx);
  await cleanOrphanedJobIndex(ctx);
  cleanOrphanedJobLocks(ctx);
  cleanEmptyQueues(ctx);
}
async function cleanOrphanedProcessingEntries(ctx, now, stallTimeout) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    const orphaned = [];
    for (const [jobId2, job] of ctx.processingShards[i]) {
      if (job.startedAt && now - job.startedAt > stallTimeout) {
        orphaned.push(jobId2);
      }
    }
    if (orphaned.length === 0)
      continue;
    await withWriteLock(ctx.processingLocks[i], () => {
      let removed = 0;
      for (const jobId2 of orphaned) {
        const job = ctx.processingShards[i].get(jobId2);
        if (job) {
          ctx.processingShards[i].delete(jobId2);
          ctx.jobIndex.delete(jobId2);
          removed++;
        }
      }
      if (removed > 0)
        ctx.dashboardEmit?.("cleanup:orphans-removed", { count: removed });
    });
  }
}
function cleanStaleWaitingDependencies(ctx, now) {
  const depTimeout = 60 * 60 * 1000;
  for (let i = 0;i < SHARD_COUNT; i++) {
    const shard = ctx.shards[i];
    const stale = [];
    for (const [_id, job] of shard.waitingDeps) {
      if (now - job.createdAt > depTimeout) {
        stale.push(job);
      }
    }
    for (const job of stale) {
      shard.waitingDeps.delete(job.id);
      shard.unregisterDependencies(job.id, job.dependsOn);
      ctx.jobIndex.delete(job.id);
    }
    if (stale.length > 0) {
      ctx.dashboardEmit?.("cleanup:stale-deps-removed", { count: stale.length });
    }
  }
}
function cleanUniqueKeysAndGroups(ctx) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    const shard = ctx.shards[i];
    shard.cleanExpiredUniqueKeys();
    for (const [_queueName, keys] of shard.uniqueKeys) {
      if (keys.size > 1000) {
        const toRemove = Math.floor(keys.size / 2);
        const iter = keys.keys();
        for (let j = 0;j < toRemove; j++) {
          const { value, done } = iter.next();
          if (done)
            break;
          keys.delete(value);
        }
      }
    }
    for (const [_queueName, groups] of shard.activeGroups) {
      if (groups.size > 1000) {
        const toRemove = Math.floor(groups.size / 2);
        const iter = groups.values();
        for (let j = 0;j < toRemove; j++) {
          const { value, done } = iter.next();
          if (done)
            break;
          groups.delete(value);
        }
      }
    }
  }
}
function cleanStalledCandidates(ctx) {
  for (const jobId2 of ctx.stalledCandidates) {
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type !== "processing") {
      ctx.stalledCandidates.delete(jobId2);
    }
  }
}
async function cleanOrphanedJobIndex(ctx) {
  if (ctx.jobIndex.size <= 1e5)
    return;
  const processingCandidates = new Map;
  const queueCandidates = new Map;
  for (const [jobId2, loc] of ctx.jobIndex) {
    if (loc.type === "processing") {
      const procIdx = processingShardIndex(jobId2);
      let list = processingCandidates.get(procIdx);
      if (!list) {
        list = [];
        processingCandidates.set(procIdx, list);
      }
      list.push(jobId2);
    } else if (loc.type === "queue") {
      let list = queueCandidates.get(loc.shardIdx);
      if (!list) {
        list = [];
        queueCandidates.set(loc.shardIdx, list);
      }
      list.push({ jobId: jobId2, queueName: loc.queueName });
    }
  }
  for (const [procIdx, candidates] of processingCandidates) {
    await withWriteLock(ctx.processingLocks[procIdx], () => {
      for (const jobId2 of candidates) {
        if (!ctx.processingShards[procIdx].has(jobId2)) {
          ctx.jobIndex.delete(jobId2);
        }
      }
    });
  }
  for (const [shardIdx, candidates] of queueCandidates) {
    await withWriteLock(ctx.shardLocks[shardIdx], () => {
      const shard = ctx.shards[shardIdx];
      for (const { jobId: jobId2, queueName } of candidates) {
        if (!shard.getQueue(queueName).has(jobId2)) {
          ctx.jobIndex.delete(jobId2);
        }
      }
    });
  }
}
function cleanOrphanedJobLocks(ctx) {
  for (const jobId2 of ctx.jobLocks.keys()) {
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type !== "processing") {
      ctx.jobLocks.delete(jobId2);
    }
  }
}
function hasProcessingJobsForQueue(ctx, queueName) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    for (const job of ctx.processingShards[i].values()) {
      if (job.queue === queueName)
        return true;
    }
  }
  return false;
}
function hasWaitingDepsForQueue(ctx, queueName) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    for (const job of ctx.shards[i].waitingDeps.values()) {
      if (job.queue === queueName)
        return true;
    }
  }
  return false;
}
function cleanEmptyQueues(ctx) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    const shard = ctx.shards[i];
    const emptyQueues = [];
    for (const [queueName, queue] of shard.queues) {
      const dlqEntries = shard.dlq.get(queueName);
      if (queue.size === 0 && (!dlqEntries || dlqEntries.length === 0) && !hasProcessingJobsForQueue(ctx, queueName) && !hasWaitingDepsForQueue(ctx, queueName)) {
        emptyQueues.push(queueName);
      }
    }
    for (const queueName of emptyQueues) {
      shard.queues.delete(queueName);
      shard.dlq.delete(queueName);
      shard.uniqueKeys.delete(queueName);
      shard.queueState.delete(queueName);
      shard.activeGroups.delete(queueName);
      shard.clearQueueLimiters(queueName);
      shard.stallConfig.delete(queueName);
      shard.dlqConfig.delete(queueName);
      ctx.dashboardEmit?.("queue:removed", { queue: queueName });
      ctx.unregisterQueueName(queueName);
    }
    shard.cleanOrphanedTemporalEntries();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/stallDetection.js
function checkStalledJobs(ctx) {
  const now = Date.now();
  const confirmedStalled = [];
  for (const jobId2 of ctx.stalledCandidates) {
    const procIdx = processingShardIndex(jobId2);
    const job = ctx.processingShards[procIdx].get(jobId2);
    if (!job) {
      ctx.stalledCandidates.delete(jobId2);
      continue;
    }
    const stallConfig = ctx.shards[shardIndex(job.queue)].getStallConfig(job.queue);
    if (!stallConfig.enabled) {
      ctx.stalledCandidates.delete(jobId2);
      continue;
    }
    const action = getStallAction(job, stallConfig, now);
    if (action !== "keep") {
      confirmedStalled.push({ job, action });
    }
    ctx.stalledCandidates.delete(jobId2);
  }
  for (let i = 0;i < SHARD_COUNT; i++) {
    const procShard = ctx.processingShards[i];
    for (const [jobId2, job] of procShard) {
      const stallConfig = ctx.shards[shardIndex(job.queue)].getStallConfig(job.queue);
      if (!stallConfig.enabled)
        continue;
      const action = getStallAction(job, stallConfig, now);
      if (action !== "keep") {
        ctx.stalledCandidates.add(jobId2);
      }
    }
  }
  for (const { job, action } of confirmedStalled) {
    handleStalledJob(job, action, ctx).catch((err) => {
      queueLog.error("Failed to handle stalled job", {
        jobId: String(job.id),
        error: String(err)
      });
    });
  }
}
async function handleStalledJob(job, action, ctx) {
  const idx = shardIndex(job.queue);
  const procIdx = processingShardIndex(job.id);
  let handled = false;
  await withWriteLock(ctx.shardLocks[idx], async () => {
    await withWriteLock(ctx.processingLocks[procIdx], () => {
      if (!ctx.processingShards[procIdx].has(job.id)) {
        return;
      }
      const shard = ctx.shards[idx];
      if (action === "move_to_dlq") {
        moveStalliedJobToDlq(job, ctx, shard, procIdx, idx);
      } else {
        retryStalliedJob(job, ctx, shard, procIdx, idx);
      }
      handled = true;
    });
  });
  if (handled) {
    ctx.dashboardEmit?.("job:stalled", {
      jobId: String(job.id),
      queue: job.queue,
      stallCount: job.stallCount + 1,
      action
    });
    ctx.eventsManager.broadcast({
      eventType: "stalled",
      queue: job.queue,
      jobId: job.id,
      timestamp: Date.now(),
      data: { stallCount: job.stallCount + 1, action }
    });
    ctx.webhookManager.trigger("stalled", String(job.id), job.queue, {
      data: { stallCount: job.stallCount + 1, action }
    });
  }
}
function moveStalliedJobToDlq(job, ctx, shard, procIdx, _idx) {
  ctx.processingShards[procIdx].delete(job.id);
  shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  if (job.uniqueKey?.startsWith("cron:")) {
    ctx.jobIndex.delete(job.id);
    ctx.storage?.deleteJob(job.id);
    return;
  }
  const entry = shard.addToDlq(job, "stalled", `Job stalled ${job.stallCount + 1} times`);
  ctx.jobIndex.set(job.id, { type: "dlq", queueName: job.queue });
  ctx.storage?.saveDlqEntry(entry);
  ctx.storage?.deleteJob(job.id);
}
function retryStalliedJob(job, ctx, shard, procIdx, idx) {
  if (job.uniqueKey?.startsWith("cron:")) {
    ctx.processingShards[procIdx].delete(job.id);
    shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
    ctx.jobIndex.delete(job.id);
    ctx.storage?.deleteJob(job.id);
    return;
  }
  incrementStallCount(job);
  job.attempts++;
  job.startedAt = null;
  const stallNow = Date.now();
  job.runAt = stallNow + calculateBackoff(job);
  job.lastHeartbeat = stallNow;
  if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
    job.timeline.push({
      state: "failed",
      timestamp: stallNow,
      error: "stalled",
      attempt: job.attempts
    });
    job.timeline.push({ state: "waiting", timestamp: stallNow, attempt: job.attempts + 1 });
  }
  ctx.processingShards[procIdx].delete(job.id);
  shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
  shard.getQueue(job.queue).push(job);
  const isDelayed = job.runAt > Date.now();
  shard.incrementQueued(job.id, isDelayed, job.createdAt, job.queue, job.runAt);
  ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: job.queue });
  ctx.storage?.updateForRetry(job);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/dependencyProcessor.js
async function processPendingDependencies(ctx) {
  if (ctx.pendingDepChecks.size === 0)
    return;
  const completedIds = Array.from(ctx.pendingDepChecks);
  ctx.pendingDepChecks.clear();
  const jobsToCheckByShard = new Map;
  for (const completedId of completedIds) {
    for (let i = 0;i < SHARD_COUNT; i++) {
      const waitingJobIds = ctx.shards[i].getJobsWaitingFor(completedId);
      if (waitingJobIds && waitingJobIds.size > 0) {
        let shardJobs = jobsToCheckByShard.get(i);
        if (!shardJobs) {
          shardJobs = new Set;
          jobsToCheckByShard.set(i, shardJobs);
        }
        for (const jobId2 of waitingJobIds) {
          shardJobs.add(jobId2);
        }
      }
    }
  }
  await Promise.all(Array.from(jobsToCheckByShard.entries()).map(async ([i, jobIdsToCheck]) => {
    await withWriteLock(ctx.shardLocks[i], () => {
      const shard = ctx.shards[i];
      const jobsToPromote = [];
      for (const jobId2 of jobIdsToCheck) {
        const job = shard.waitingDeps.get(jobId2);
        if (job?.dependsOn.every((dep) => ctx.completedJobs.has(dep) || (ctx.depCompletions?.has(dep) ?? false))) {
          jobsToPromote.push(job);
        }
      }
      if (jobsToPromote.length > 0) {
        promoteJobsToQueue(jobsToPromote, shard, ctx, i);
      }
    });
  }));
}
function promoteJobsToQueue(jobsToPromote, shard, ctx, shardIdx) {
  const now = Date.now();
  for (const job of jobsToPromote) {
    if (shard.waitingDeps.has(job.id)) {
      shard.waitingDeps.delete(job.id);
      shard.unregisterDependencies(job.id, job.dependsOn);
      shard.getQueue(job.queue).push(job);
      const isDelayed = job.runAt > now;
      shard.incrementQueued(job.id, isDelayed, job.createdAt, job.queue, job.runAt);
      ctx.jobIndex.set(job.id, { type: "queue", shardIdx, queueName: job.queue });
      if (job.timeline.length < MAX_TIMELINE_ENTRIES) {
        const state = isDelayed ? "delayed" : job.priority > 0 ? "prioritized" : "waiting";
        job.timeline.push({ state, timestamp: now });
      }
    }
  }
  if (jobsToPromote.length > 0) {
    shard.notify();
    for (const job of jobsToPromote) {
      ctx.dashboardEmit?.("job:dependencies-resolved", { jobId: String(job.id), queue: job.queue });
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/taskErrorTracking.js
var MAX_CONSECUTIVE_FAILURES = 5;
var taskErrors = {
  cleanup: { consecutiveFailures: 0 },
  dependency: { consecutiveFailures: 0 },
  lockExpiration: { consecutiveFailures: 0 }
};
function handleTaskError(taskName, err) {
  const state = taskErrors[taskName];
  if (!state)
    return;
  state.consecutiveFailures++;
  state.lastError = String(err);
  state.lastFailureAt = Date.now();
  queueLog.error(`${taskName} task failed`, {
    error: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    willRetry: state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES
  });
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    queueLog.error(`CRITICAL: Background ${taskName} repeatedly failing`, {
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError
    });
  }
}
function handleTaskSuccess(taskName) {
  const state = taskErrors[taskName];
  if (state) {
    state.consecutiveFailures = 0;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/backgroundTasks.js
function startBackgroundTasks(ctx, cronScheduler) {
  const cleanupInterval = setInterval(() => {
    cleanup(ctx).then(() => {
      handleTaskSuccess("cleanup");
      runMonitoringChecks({
        queueNamesCache: ctx.queueNamesCache,
        shards: ctx.shards,
        processingShards: ctx.processingShards,
        workerManager: ctx.workerManager,
        storage: ctx.storage,
        dashboardEmit: ctx.dashboardEmit,
        state: ctx.monitoringState
      });
    }).catch((err) => {
      handleTaskError("cleanup", err);
    });
  }, ctx.config.cleanupIntervalMs);
  const timeoutInterval = setInterval(() => {
    checkJobTimeouts(ctx);
  }, ctx.config.jobTimeoutCheckMs);
  const depCheckInterval = setInterval(() => {
    if (ctx.pendingDepChecks.size === 0)
      return;
    processPendingDependencies(ctx).then(() => {
      handleTaskSuccess("dependency");
    }).catch((err) => {
      handleTaskError("dependency", err);
    });
  }, ctx.config.dependencyCheckMs);
  const stallCheckInterval = setInterval(() => {
    checkStalledJobs(ctx);
  }, ctx.config.stallCheckMs);
  const dlqMaintenanceInterval = setInterval(() => {
    performDlqMaintenance(ctx);
  }, ctx.config.dlqMaintenanceMs);
  const lockCheckInterval = setInterval(() => {
    checkExpiredLocks(getLockContext(ctx)).then(() => {
      handleTaskSuccess("lockExpiration");
    }).catch((err) => {
      handleTaskError("lockExpiration", err);
    });
  }, ctx.config.stallCheckMs);
  cronScheduler.start();
  return {
    cleanupInterval,
    timeoutInterval,
    depCheckInterval,
    stallCheckInterval,
    dlqMaintenanceInterval,
    lockCheckInterval,
    cronScheduler
  };
}
function stopBackgroundTasks(handles) {
  clearInterval(handles.cleanupInterval);
  clearInterval(handles.timeoutInterval);
  clearInterval(handles.depCheckInterval);
  clearInterval(handles.stallCheckInterval);
  clearInterval(handles.dlqMaintenanceInterval);
  clearInterval(handles.lockCheckInterval);
  handles.cronScheduler.stop();
}
function getLockContext(ctx) {
  return {
    jobIndex: ctx.jobIndex,
    jobLocks: ctx.jobLocks,
    clientJobs: ctx.clientJobs,
    processingShards: ctx.processingShards,
    processingLocks: ctx.processingLocks,
    shards: ctx.shards,
    shardLocks: ctx.shardLocks,
    eventsManager: ctx.eventsManager,
    dashboardEmit: ctx.dashboardEmit
  };
}
function checkJobTimeouts(ctx) {
  const now = Date.now();
  for (const procShard of ctx.processingShards) {
    for (const [jobId2, job] of procShard) {
      if (job.timeout && job.startedAt && now - job.startedAt > job.timeout) {
        ctx.dashboardEmit?.("job:timeout", {
          jobId: String(jobId2),
          queue: job.queue,
          timeout: job.timeout
        });
        ctx.timedOutJobs?.add(jobId2);
        ctx.fail(jobId2, "Job timeout exceeded").catch((err) => {
          queueLog.error("Failed to mark timed out job as failed", {
            jobId: String(jobId2),
            error: String(err)
          });
        });
      }
    }
  }
}
function performDlqMaintenance(ctx) {
  const dlqCtx = {
    shards: ctx.shards,
    jobIndex: ctx.jobIndex,
    storage: ctx.storage
  };
  for (const queueName of ctx.queueNamesCache) {
    try {
      const retried = processAutoRetry(queueName, dlqCtx);
      if (retried > 0) {
        ctx.dashboardEmit?.("dlq:auto-retried", { queue: queueName, count: retried });
      }
      const expired = purgeExpiredDlq(queueName, dlqCtx);
      if (expired > 0)
        ctx.dashboardEmit?.("dlq:expired", { queue: queueName, count: expired });
    } catch (err) {
      queueLog.error("DLQ maintenance failed", { queue: queueName, error: String(err) });
    }
  }
}
var RECOVERY_BATCH_SIZE = 1e4;
function quarantineCorruptDependsOn(ctx, job) {
  if (!ctx.storage)
    return;
  const entry = createDlqEntry(job, "unknown", "corrupt-dependency-metadata");
  ctx.storage.saveDlqEntry(entry);
  ctx.storage.deleteJob(job.id);
  ctx.registerQueueName(job.queue);
  queueLog.error("Recovered job with corrupt depends_on metadata -> routed to DLQ", {
    jobId: String(job.id),
    queue: job.queue
  });
}
function recover(ctx) {
  if (!ctx.storage)
    return;
  const completedInDb = ctx.storage.loadCompletedJobIds();
  const dlqJobIds = ctx.storage.loadDlqJobIds();
  const now = Date.now();
  let activeOffset = 0;
  while (true) {
    const activeJobs = ctx.storage.loadActiveJobs(RECOVERY_BATCH_SIZE, activeOffset);
    if (activeJobs.length === 0)
      break;
    for (const job of activeJobs) {
      const idx = shardIndex(job.queue);
      const shard = ctx.shards[idx];
      const stallConfig = shard.getStallConfig(job.queue);
      if (job.uniqueKey?.startsWith("cron:")) {
        ctx.storage.deleteJob(job.id);
        ctx.registerQueueName(job.queue);
        continue;
      }
      if (dlqJobIds.has(job.id)) {
        ctx.storage.deleteJob(job.id);
        ctx.registerQueueName(job.queue);
        continue;
      }
      if (isCorruptDependsOn(job)) {
        quarantineCorruptDependsOn(ctx, job);
        continue;
      }
      job.stallCount = (job.stallCount || 0) + 1;
      job.attempts++;
      job.startedAt = null;
      job.lastHeartbeat = now;
      const maxStalls = stallConfig.maxStalls ?? 3;
      if (job.stallCount >= maxStalls) {
        const entry = shard.addToDlq(job, "stalled", `Job stalled ${job.stallCount} times (recovered at startup)`);
        ctx.jobIndex.set(job.id, { type: "dlq", queueName: job.queue });
        ctx.storage.saveDlqEntry(entry);
        ctx.storage.deleteJob(job.id);
      } else {
        job.runAt = now + calculateBackoff(job);
        shard.getQueue(job.queue).push(job);
        const isDelayed = job.runAt > now;
        shard.incrementQueued(job.id, isDelayed, job.createdAt, job.queue, job.runAt);
        ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: job.queue });
        ctx.storage.updateForRetry(job);
      }
      ctx.registerQueueName(job.queue);
    }
    activeOffset += activeJobs.length;
    if (activeJobs.length < RECOVERY_BATCH_SIZE)
      break;
  }
  let offset = 0;
  while (true) {
    const jobs = ctx.storage.loadPendingJobs(RECOVERY_BATCH_SIZE, offset);
    if (jobs.length === 0)
      break;
    for (const job of jobs) {
      const idx = shardIndex(job.queue);
      const shard = ctx.shards[idx];
      if (isCorruptDependsOn(job)) {
        quarantineCorruptDependsOn(ctx, job);
        continue;
      }
      const hasDependencies = job.dependsOn && job.dependsOn.length > 0;
      const needsWaitingDeps = hasDependencies && !job.dependsOn.every((depId) => ctx.completedJobs.has(depId) || completedInDb.has(depId));
      if (needsWaitingDeps) {
        shard.waitingDeps.set(job.id, job);
        shard.registerDependencies(job.id, job.dependsOn);
      } else {
        shard.getQueue(job.queue).push(job);
        const isDelayed = job.runAt > now;
        shard.incrementQueued(job.id, isDelayed, job.createdAt, job.queue, job.runAt);
      }
      ctx.jobIndex.set(job.id, { type: "queue", shardIdx: idx, queueName: job.queue });
      if (job.customId) {
        ctx.customIdMap.set(job.customId, job.id);
      }
      if (job.uniqueKey) {
        shard.registerUniqueKeyWithTtl(job.queue, job.uniqueKey, job.id, job.deduplicationTtl ?? undefined);
      }
      ctx.registerQueueName(job.queue);
    }
    offset += jobs.length;
    if (jobs.length < RECOVERY_BATCH_SIZE)
      break;
  }
  const dlqEntries = ctx.storage.loadDlq();
  for (const [queue, entries] of dlqEntries) {
    const idx = shardIndex(queue);
    const shard = ctx.shards[idx];
    for (const entry of entries) {
      shard.restoreDlqEntry(queue, entry);
      ctx.jobIndex.set(entry.job.id, { type: "dlq", queueName: queue });
    }
    ctx.registerQueueName(queue);
  }
  for (const qs of ctx.storage.loadQueueState()) {
    const shard = ctx.shards[shardIndex(qs.name)];
    if (qs.paused)
      shard.pause(qs.name);
    if (qs.rateLimit !== null)
      shard.setRateLimit(qs.name, qs.rateLimit);
    if (qs.concurrencyLimit !== null)
      shard.setConcurrency(qs.name, qs.concurrencyLimit);
    ctx.registerQueueName(qs.name);
  }
  const completedCap = ctx.config.maxCompletedJobs;
  let completedLoaded = 0;
  let completedOffset = 0;
  while (completedLoaded < completedCap) {
    const remaining = completedCap - completedLoaded;
    const batchSize = Math.min(RECOVERY_BATCH_SIZE, remaining);
    const completedBatch = ctx.storage.loadCompletedJobs(batchSize, completedOffset);
    if (completedBatch.length === 0)
      break;
    for (const job of completedBatch) {
      ctx.jobIndex.set(job.id, { type: "completed", queueName: job.queue });
      ctx.completedJobs.add(job.id);
      ctx.completedJobsData.set(job.id, job);
      ctx.registerQueueName(job.queue);
    }
    completedLoaded += completedBatch.length;
    completedOffset += completedBatch.length;
    if (completedBatch.length < batchSize)
      break;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/statsManager.js
function countByQueue(sources, queueName) {
  let count = 0;
  for (const src2 of sources) {
    for (const job of src2)
      if (job.queue === queueName)
        count++;
  }
  return count;
}
function getStats(ctx, cronScheduler) {
  let waiting = 0, prioritized = 0, delayed = 0, active = 0, dlq = 0, waitingChildren = 0;
  const now = Date.now();
  for (let i = 0;i < SHARD_COUNT; i++) {
    const shardStats = ctx.shards[i].getStats();
    delayed += shardStats.delayedJobs;
    dlq += shardStats.dlqJobs;
    active += ctx.processingShards[i].size;
    waitingChildren += ctx.shards[i].waitingChildren.size + ctx.shards[i].waitingDeps.size;
    for (const queue of ctx.shards[i].queues.values()) {
      for (const job of queue.values()) {
        if (job.runAt <= now) {
          if (job.priority > 0) {
            prioritized++;
          } else {
            waiting++;
          }
        }
      }
    }
  }
  const cronStats = cronScheduler.getStats();
  return {
    waiting,
    prioritized,
    delayed,
    active,
    dlq,
    completed: ctx.completedJobs.size,
    "waiting-children": waitingChildren,
    totalPushed: ctx.metrics.totalPushed.value,
    totalPulled: ctx.metrics.totalPulled.value,
    totalCompleted: ctx.metrics.totalCompleted.value,
    totalFailed: ctx.metrics.totalFailed.value,
    uptime: Date.now() - ctx.startTime,
    cronJobs: cronStats.total,
    cronPending: cronStats.pending
  };
}
function getMemoryStats(ctx) {
  let processingTotal = 0;
  let queuedTotal = 0;
  let waitingDepsTotal = 0;
  let temporalIndexTotal = 0;
  let delayedHeapTotal = 0;
  for (let i = 0;i < SHARD_COUNT; i++) {
    processingTotal += ctx.processingShards[i].size;
    const shardStats = ctx.shards[i].getStats();
    queuedTotal += shardStats.queuedJobs;
    waitingDepsTotal += ctx.shards[i].waitingDeps.size;
    const internalSizes = ctx.shards[i].getInternalSizes();
    temporalIndexTotal += internalSizes.temporalIndex;
    delayedHeapTotal += internalSizes.delayedHeap;
  }
  let clientJobsTotal = 0;
  for (const jobs of ctx.clientJobs.values()) {
    clientJobsTotal += jobs.size;
  }
  return {
    jobIndex: ctx.jobIndex.size,
    completedJobs: ctx.completedJobs.size,
    jobResults: ctx.jobResults.size,
    jobLogs: ctx.jobLogs.size,
    customIdMap: ctx.customIdMap.size,
    jobLocks: ctx.jobLocks.size,
    clientJobs: ctx.clientJobs.size,
    clientJobsTotal,
    pendingDepChecks: ctx.pendingDepChecks.size,
    stalledCandidates: ctx.stalledCandidates.size,
    processingTotal,
    queuedTotal,
    waitingDepsTotal,
    temporalIndexTotal,
    delayedHeapTotal
  };
}
function getPerQueueStats(ctx, queueNames) {
  const result = new Map;
  const now = Date.now();
  for (const name of queueNames) {
    const idx = shardIndex(name);
    const shard = ctx.shards[idx];
    const queue = shard.queues.get(name);
    let waiting = 0;
    let prioritized = 0;
    let delayed = 0;
    if (queue) {
      for (const job of queue.values()) {
        if (job.runAt > now) {
          delayed++;
        } else if (job.priority > 0) {
          prioritized++;
        } else {
          waiting++;
        }
      }
    }
    const dlq = shard.getDlqCount(name);
    result.set(name, { waiting, prioritized, delayed, active: 0, dlq });
  }
  for (let i = 0;i < SHARD_COUNT; i++) {
    for (const job of ctx.processingShards[i].values()) {
      const entry = result.get(job.queue);
      if (entry) {
        entry.active++;
      }
    }
  }
  return result;
}
function getQueueJobCounts(queueName, ctx) {
  const idx = shardIndex(queueName);
  const shard = ctx.shards[idx];
  const queue = shard.queues.get(queueName);
  const now = Date.now();
  let waiting = 0;
  let prioritized = 0;
  let delayed = 0;
  if (queue) {
    for (const job of queue.values()) {
      if (job.runAt > now) {
        delayed++;
      } else if (job.priority > 0) {
        prioritized++;
      } else {
        waiting++;
      }
    }
  }
  let active = 0;
  for (const procShard of ctx.processingShards) {
    for (const job of procShard.values()) {
      if (job.queue === queueName) {
        active++;
      }
    }
  }
  let completed = 0;
  for (const [jobId2, loc] of ctx.jobIndex) {
    if (loc.type === "completed" && loc.queueName === queueName && ctx.completedJobs.has(jobId2)) {
      completed++;
    }
  }
  const failed = shard.getDlq(queueName).length;
  const waitingChildrenCount = countByQueue([shard.waitingChildren.values(), shard.waitingDeps.values()], queueName);
  const perQueue = ctx.perQueueMetrics?.get(queueName);
  const totalCompleted = Number(perQueue?.totalCompleted ?? 0n);
  const totalFailed = Number(perQueue?.totalFailed ?? 0n);
  return {
    waiting,
    prioritized,
    delayed,
    active,
    completed,
    failed,
    "waiting-children": waitingChildrenCount,
    totalCompleted,
    totalFailed
  };
}
function compactMemory(ctx) {
  for (let i = 0;i < SHARD_COUNT; i++) {
    for (const q of ctx.shards[i].queues.values()) {
      if (q.needsCompaction(0.1)) {
        q.compact();
      }
    }
  }
  for (const [clientId, jobs] of ctx.clientJobs) {
    if (jobs.size === 0) {
      ctx.clientJobs.delete(clientId);
    }
  }
  for (const jobId2 of ctx.jobLocks.keys()) {
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type !== "processing") {
      ctx.jobLocks.delete(jobId2);
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/contextFactory.js
class ContextFactory {
  deps;
  callbacks;
  constructor(deps, callbacks) {
    this.deps = deps;
    this.callbacks = callbacks;
  }
  getLockContext() {
    return {
      jobIndex: this.deps.jobIndex,
      jobLocks: this.deps.jobLocks,
      clientJobs: this.deps.clientJobs,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      eventsManager: this.deps.eventsManager,
      storage: this.deps.storage
    };
  }
  getBackgroundContext() {
    return {
      config: this.deps.config,
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      jobIndex: this.deps.jobIndex,
      completedJobs: this.deps.completedJobs,
      depCompletions: this.deps.depCompletions,
      timedOutJobs: this.deps.timedOutJobs,
      jobResults: this.deps.jobResults,
      customIdMap: this.deps.customIdMap,
      jobLogs: this.deps.jobLogs,
      jobLocks: this.deps.jobLocks,
      clientJobs: this.deps.clientJobs,
      stalledCandidates: this.deps.stalledCandidates,
      pendingDepChecks: this.deps.pendingDepChecks,
      queueNamesCache: this.deps.queueNamesCache,
      eventsManager: this.deps.eventsManager,
      webhookManager: this.deps.webhookManager,
      metrics: this.deps.metrics,
      startTime: this.deps.startTime,
      perQueueMetrics: this.deps.perQueueMetrics,
      fail: this.callbacks.fail,
      registerQueueName: this.callbacks.registerQueueName,
      unregisterQueueName: this.callbacks.unregisterQueueName,
      dashboardEmit: this.callbacks.emitDashboardEvent,
      workerManager: this.deps.workerManager,
      monitoringState: this.deps.monitoringState,
      completedJobsData: this.deps.completedJobsData
    };
  }
  getStatsContext() {
    return {
      shards: this.deps.shards,
      processingShards: this.deps.processingShards,
      completedJobs: this.deps.completedJobs,
      jobIndex: this.deps.jobIndex,
      jobResults: this.deps.jobResults,
      jobLogs: this.deps.jobLogs,
      customIdMap: this.deps.customIdMap,
      jobLocks: this.deps.jobLocks,
      clientJobs: this.deps.clientJobs,
      pendingDepChecks: this.deps.pendingDepChecks,
      stalledCandidates: this.deps.stalledCandidates,
      metrics: this.deps.metrics,
      startTime: this.deps.startTime,
      perQueueMetrics: this.deps.perQueueMetrics
    };
  }
  getPushContext() {
    return {
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      completedJobs: this.deps.completedJobs,
      completedJobsData: this.deps.completedJobsData,
      depCompletions: this.deps.depCompletions,
      timedOutJobs: this.deps.timedOutJobs,
      jobResults: this.deps.jobResults,
      customIdMap: this.deps.customIdMap,
      jobIndex: this.deps.jobIndex,
      totalPushed: this.deps.metrics.totalPushed,
      broadcast: this.deps.eventsManager.broadcast.bind(this.deps.eventsManager),
      dashboardEmit: this.callbacks.emitDashboardEvent
    };
  }
  getPullContext() {
    return {
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      jobIndex: this.deps.jobIndex,
      totalPulled: this.deps.metrics.totalPulled,
      broadcast: this.deps.eventsManager.broadcast.bind(this.deps.eventsManager),
      dashboardEmit: this.callbacks.emitDashboardEvent
    };
  }
  getAckContext() {
    return {
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      completedJobs: this.deps.completedJobs,
      completedJobsData: this.deps.completedJobsData,
      depCompletions: this.deps.depCompletions,
      jobResults: this.deps.jobResults,
      jobIndex: this.deps.jobIndex,
      customIdMap: this.deps.customIdMap,
      totalCompleted: this.deps.metrics.totalCompleted,
      totalFailed: this.deps.metrics.totalFailed,
      perQueueMetrics: this.deps.perQueueMetrics,
      broadcast: this.deps.eventsManager.broadcast.bind(this.deps.eventsManager),
      onJobCompleted: this.callbacks.onJobCompleted,
      onJobsCompleted: this.callbacks.onJobsCompleted,
      needsBroadcast: this.deps.eventsManager.needsBroadcast.bind(this.deps.eventsManager),
      hasPendingDeps: this.callbacks.hasPendingDeps,
      onRepeat: this.callbacks.onRepeat,
      emitDashboardEvent: this.callbacks.emitDashboardEvent,
      onChildTerminalFailure: this.callbacks.onChildTerminalFailure,
      onChildDependencyOption: this.callbacks.onChildDependencyOption
    };
  }
  getJobMgmtContext() {
    return {
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      jobIndex: this.deps.jobIndex,
      webhookManager: this.deps.webhookManager,
      eventsManager: this.deps.eventsManager,
      repeatChain: this.deps.repeatChain
    };
  }
  getQueryContext() {
    return {
      storage: this.deps.storage,
      shards: this.deps.shards,
      shardLocks: this.deps.shardLocks,
      processingShards: this.deps.processingShards,
      processingLocks: this.deps.processingLocks,
      jobIndex: this.deps.jobIndex,
      completedJobs: this.deps.completedJobs,
      completedJobsData: this.deps.completedJobsData,
      jobResults: this.deps.jobResults,
      customIdMap: this.deps.customIdMap
    };
  }
  getDlqContext() {
    return {
      shards: this.deps.shards,
      jobIndex: this.deps.jobIndex,
      storage: this.deps.storage
    };
  }
  getRetryCompletedContext() {
    return {
      shards: this.deps.shards,
      jobIndex: this.deps.jobIndex,
      storage: this.deps.storage,
      completedJobs: this.deps.completedJobs,
      jobResults: this.deps.jobResults
    };
  }
  getLogsContext() {
    return {
      jobIndex: this.deps.jobIndex,
      jobLogs: this.deps.jobLogs,
      maxLogsPerJob: this.deps.maxLogsPerJob
    };
  }
  getQueueControlContext() {
    return {
      shards: this.deps.shards,
      jobIndex: this.deps.jobIndex,
      processingShards: this.deps.processingShards,
      completedJobs: this.deps.completedJobs,
      completedJobsData: this.deps.completedJobsData,
      jobResults: this.deps.jobResults,
      jobLogs: this.deps.jobLogs,
      storage: this.deps.storage
    };
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/application/queueManager.js
class QueueManager {
  config;
  storage;
  shards = [];
  shardLocks = [];
  processingShards = [];
  processingLocks = [];
  jobIndex = new Map;
  completedJobs;
  completedJobsData;
  depCompletions;
  timedOutJobs;
  jobResults;
  customIdMap;
  jobLogs;
  pendingDepChecks = new Set;
  stalledCandidates = new Set;
  depFlushScheduled = false;
  depFlushRunning = false;
  jobLocks = new Map;
  clientJobs = new Map;
  repeatChain = new Map;
  failedChildrenValues = new Map;
  ignoredChildrenFailures = new Map;
  cronScheduler;
  webhookManager;
  workerManager;
  eventsManager;
  dashboardEmit = null;
  recoveryStats = null;
  maxLogsPerJob = 100;
  metrics = {
    totalPushed: { value: 0n },
    totalPulled: { value: 0n },
    totalCompleted: { value: 0n },
    totalFailed: { value: 0n }
  };
  perQueueMetrics;
  startTime = Date.now();
  backgroundTaskHandles;
  queueNamesCache = new Set;
  monitoringState = createMonitoringState();
  contextFactory;
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = config.dataPath ? new SqliteStorage({ path: config.dataPath }) : null;
    this.completedJobsData = new BoundedMap(this.config.maxCompletedJobs);
    this.completedJobs = new BoundedSet(this.config.maxCompletedJobs, (jobId2) => {
      this.jobIndex.delete(jobId2);
      this.completedJobsData.delete(jobId2);
    });
    this.depCompletions = new BoundedSet(this.config.maxCompletedJobs);
    this.timedOutJobs = new BoundedSet(this.config.maxCompletedJobs);
    this.perQueueMetrics = new LRUMap(this.config.maxCustomIds);
    this.jobResults = new LRUMap(this.config.maxJobResults);
    this.customIdMap = new LRUMap(this.config.maxCustomIds);
    this.jobLogs = new LRUMap(this.config.maxJobLogs);
    for (let i = 0;i < SHARD_COUNT; i++) {
      this.shards.push(new Shard);
      this.shardLocks.push(new RWLock);
      this.processingShards.push(new Map);
      this.processingLocks.push(new RWLock);
    }
    this.cronScheduler = new CronScheduler;
    this.cronScheduler.setPushCallback(async (queue, input) => {
      await this.push(queue, input);
    });
    if (this.storage) {
      const storage = this.storage;
      this.cronScheduler.setPersistCallback((name, executions, nextRun) => {
        storage.updateCron(name, executions, nextRun);
      });
    }
    this.webhookManager = new WebhookManager({ validateUrls: config.validateWebhookUrls });
    this.workerManager = new WorkerManager;
    this.cronScheduler.setWorkerCheckCallback((queue) => {
      return this.workerManager.getForQueue(queue).length > 0;
    });
    this.eventsManager = new EventsManager(this.webhookManager);
    this.contextFactory = new ContextFactory(this.getContextDependencies(), this.getContextCallbacks());
    recover(this.contextFactory.getBackgroundContext());
    this.recoveryStats = { queues: this.queueNamesCache.size, jobs: this.jobIndex.size };
    if (this.storage) {
      this.cronScheduler.load(this.storage.loadCronJobs());
    }
    this.backgroundTaskHandles = startBackgroundTasks(this.contextFactory.getBackgroundContext(), this.cronScheduler);
  }
  getContextDependencies() {
    return {
      config: this.config,
      storage: this.storage,
      shards: this.shards,
      shardLocks: this.shardLocks,
      processingShards: this.processingShards,
      processingLocks: this.processingLocks,
      jobIndex: this.jobIndex,
      completedJobs: this.completedJobs,
      completedJobsData: this.completedJobsData,
      depCompletions: this.depCompletions,
      timedOutJobs: this.timedOutJobs,
      jobResults: this.jobResults,
      customIdMap: this.customIdMap,
      jobLogs: this.jobLogs,
      jobLocks: this.jobLocks,
      clientJobs: this.clientJobs,
      stalledCandidates: this.stalledCandidates,
      pendingDepChecks: this.pendingDepChecks,
      queueNamesCache: this.queueNamesCache,
      repeatChain: this.repeatChain,
      eventsManager: this.eventsManager,
      webhookManager: this.webhookManager,
      workerManager: this.workerManager,
      monitoringState: this.monitoringState,
      metrics: this.metrics,
      startTime: this.startTime,
      maxLogsPerJob: this.maxLogsPerJob,
      perQueueMetrics: this.perQueueMetrics
    };
  }
  getContextCallbacks() {
    return {
      fail: this.fail.bind(this),
      registerQueueName: this.registerQueueName.bind(this),
      unregisterQueueName: this.unregisterQueueName.bind(this),
      onJobCompleted: this.onJobCompleted.bind(this),
      onJobsCompleted: this.onJobsCompleted.bind(this),
      hasPendingDeps: this.hasPendingDeps.bind(this),
      onRepeat: this.handleRepeat.bind(this),
      emitDashboardEvent: this.emitDashboardEvent.bind(this),
      onChildTerminalFailure: this.failParentOnChildFailure.bind(this),
      onChildDependencyOption: this.onChildDependencyOption.bind(this)
    };
  }
  handleRepeat(job) {
    if (!job.repeat)
      return;
    const delay = job.repeat.every ?? 0;
    const oldId = job.id;
    this.push(job.queue, {
      data: job.data,
      priority: job.priority,
      delay,
      maxAttempts: job.maxAttempts,
      backoff: job.backoff,
      ttl: job.ttl ?? undefined,
      timeout: job.timeout ?? undefined,
      tags: job.tags,
      groupId: job.groupId ?? undefined,
      lifo: job.lifo,
      removeOnComplete: job.removeOnComplete,
      removeOnFail: job.removeOnFail,
      repeat: {
        every: job.repeat.every,
        limit: job.repeat.limit,
        pattern: job.repeat.pattern,
        count: job.repeat.count + 1
      }
    }).then((newJob) => {
      this.repeatChain.set(oldId, newJob.id);
      if (this.repeatChain.size > 1e4) {
        const first = this.repeatChain.keys().next().value;
        if (first !== undefined)
          this.repeatChain.delete(first);
      }
    });
  }
  async push(queue, input) {
    this.registerQueueName(queue);
    return pushJob(queue, input, this.contextFactory.getPushContext());
  }
  async pushBatch(queue, inputs) {
    this.registerQueueName(queue);
    return pushJobBatch(queue, inputs, this.contextFactory.getPushContext());
  }
  async pull(queue, timeoutMs = 0) {
    return pullJob(queue, timeoutMs, this.contextFactory.getPullContext());
  }
  async pullWithLock(queue, owner, timeoutMs = 0, lockTtl = DEFAULT_LOCK_TTL) {
    const job = await pullJob(queue, timeoutMs, this.contextFactory.getPullContext());
    if (!job)
      return { job: null, token: null };
    const token = createLock(job.id, owner, this.contextFactory.getLockContext(), lockTtl);
    return { job, token };
  }
  async pullBatch(queue, count, timeoutMs = 0) {
    return pullJobBatch(queue, count, timeoutMs, this.contextFactory.getPullContext());
  }
  async pullBatchWithLock(queue, count, owner, timeoutMs = 0, lockTtl = DEFAULT_LOCK_TTL) {
    const jobs = await pullJobBatch(queue, count, timeoutMs, this.contextFactory.getPullContext());
    const tokens = [];
    for (const job of jobs) {
      const token = createLock(job.id, owner, this.contextFactory.getLockContext(), lockTtl);
      tokens.push(token ?? "");
    }
    return { jobs, tokens };
  }
  async ack(jobId2, result, token) {
    const lockCtx = this.contextFactory.getLockContext();
    if (token && !verifyLock(jobId2, token, lockCtx) && !this.isExpiredButOwned(jobId2, token, lockCtx)) {
      this.throwIfOwnershipConflict(jobId2, lockCtx);
      const loc = this.jobIndex.get(jobId2);
      if (loc?.type !== "processing") {
        if (loc?.type === "queue") {
          if (this.timedOutJobs.has(jobId2)) {
            releaseLock(jobId2, lockCtx, token);
            return;
          }
          await this.completeStallRetriedJob(jobId2, result);
          releaseLock(jobId2, lockCtx, token);
        }
        return;
      }
    }
    try {
      await ackJob(jobId2, result, this.contextFactory.getAckContext());
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        if (this.timedOutJobs.has(jobId2)) {
          if (token)
            releaseLock(jobId2, lockCtx, token);
          return;
        }
        const shouldRecover = token ?? this.isStallRetried(jobId2);
        if (shouldRecover && await this.completeStallRetriedJob(jobId2, result)) {
          if (token)
            releaseLock(jobId2, lockCtx, token);
          return;
        }
      }
      throw err;
    }
    releaseLock(jobId2, lockCtx, token);
  }
  async ackBatch(jobIds, tokens) {
    const lockCtx = this.contextFactory.getLockContext();
    const validJobIds = [];
    const validTokens = tokens ? [] : undefined;
    if (tokens?.length === jobIds.length) {
      for (let i = 0;i < jobIds.length; i++) {
        const t = tokens[i];
        if (t && !verifyLock(jobIds[i], t, lockCtx) && !this.isExpiredButOwned(jobIds[i], t, lockCtx)) {
          this.throwIfOwnershipConflict(jobIds[i], lockCtx);
          const loc = this.jobIndex.get(jobIds[i]);
          if (loc?.type === "queue") {
            if (!this.timedOutJobs.has(jobIds[i])) {
              await this.completeStallRetriedJob(jobIds[i], undefined);
            }
            releaseLock(jobIds[i], lockCtx, t);
          }
          continue;
        }
        validJobIds.push(jobIds[i]);
        if (validTokens)
          validTokens.push(t);
      }
    } else {
      validJobIds.push(...jobIds);
    }
    if (validJobIds.length > 0) {
      await ackJobBatch(validJobIds, this.contextFactory.getAckContext());
    }
    if (validTokens) {
      for (let i = 0;i < validJobIds.length; i++) {
        releaseLock(validJobIds[i], lockCtx, validTokens[i]);
      }
    } else if (tokens) {
      for (let i = 0;i < jobIds.length; i++) {
        releaseLock(jobIds[i], lockCtx, tokens[i]);
      }
    }
  }
  async ackBatchWithResults(items) {
    const lockCtx = this.contextFactory.getLockContext();
    const validItems = [];
    for (const item of items) {
      if (item.token && !verifyLock(item.id, item.token, lockCtx) && !this.isExpiredButOwned(item.id, item.token, lockCtx)) {
        this.throwIfOwnershipConflict(item.id, lockCtx);
        const loc = this.jobIndex.get(item.id);
        if (loc?.type === "queue") {
          if (!this.timedOutJobs.has(item.id)) {
            await this.completeStallRetriedJob(item.id, item.result);
          }
          releaseLock(item.id, lockCtx, item.token);
        }
        continue;
      }
      validItems.push(item);
    }
    if (validItems.length > 0) {
      await ackJobBatchWithResults(validItems, this.contextFactory.getAckContext());
    }
    for (const item of validItems) {
      releaseLock(item.id, lockCtx, item.token);
    }
  }
  async fail(jobId2, error2, token, unrecoverable = false, stack) {
    const lockCtx = this.contextFactory.getLockContext();
    if (token && !verifyLock(jobId2, token, lockCtx)) {
      this.throwIfOwnershipConflict(jobId2, lockCtx);
      const loc = this.jobIndex.get(jobId2);
      if (loc?.type !== "processing")
        return;
    }
    try {
      await failJob(jobId2, error2, this.contextFactory.getAckContext(), unrecoverable, stack);
    } catch (err) {
      if (token && err instanceof Error && err.message.includes("not found")) {
        const loc = this.jobIndex.get(jobId2);
        if (loc?.type === "queue")
          return;
      }
      throw err;
    }
    releaseLock(jobId2, lockCtx, token);
  }
  throwIfOwnershipConflict(jobId2, lockCtx) {
    const loc = this.jobIndex.get(jobId2);
    if (loc?.type === "processing" && lockCtx.jobLocks.has(jobId2)) {
      throw new Error(`Invalid or expired lock token for job ${jobId2}`);
    }
  }
  isExpiredButOwned(jobId2, token, lockCtx) {
    const loc = this.jobIndex.get(jobId2);
    if (loc?.type !== "processing")
      return false;
    const lock = lockCtx.jobLocks.get(jobId2);
    if (lock?.token !== token)
      return false;
    const job = this.processingShards[loc.shardIdx].get(jobId2);
    if (job && job.startedAt !== null && job.startedAt > lock.createdAt)
      return false;
    return true;
  }
  isStallRetried(jobId2) {
    const loc = this.jobIndex.get(jobId2);
    if (loc?.type !== "queue")
      return false;
    const shard = this.shards[loc.shardIdx];
    const pq = shard.getQueue(loc.queueName);
    const job = pq.find(jobId2);
    return job !== null && job.attempts > 0;
  }
  async completeStallRetriedJob(jId, result) {
    const loc = this.jobIndex.get(jId);
    if (loc?.type !== "queue")
      return false;
    const idx = loc.shardIdx;
    const queueName = loc.queueName;
    const shard = this.shards[idx];
    let job = null;
    await withWriteLock(this.shardLocks[idx], () => {
      const pq = shard.getQueue(queueName);
      job = pq.remove(jId);
      if (job) {
        shard.decrementQueued(jId);
        shard.releaseJobResources(queueName, job.uniqueKey, job.groupId);
      }
    });
    if (!job) {
      return false;
    }
    const ctx = this.contextFactory.getAckContext();
    if (!job.removeOnComplete) {
      ctx.completedJobs.add(jId);
      ctx.completedJobsData.set(jId, job);
      if (result !== undefined) {
        ctx.jobResults.set(jId, result);
        ctx.storage?.storeResult(jId, result);
      }
      ctx.jobIndex.set(jId, { type: "completed", queueName: job.queue });
      ctx.storage?.markCompleted(jId, Date.now(), job.timeline);
    } else {
      ctx.jobIndex.delete(jId);
      ctx.storage?.deleteJob(jId);
    }
    ctx.totalCompleted.value++;
    ctx.broadcast({
      eventType: "completed",
      queue: queueName,
      jobId: jId,
      timestamp: Date.now(),
      data: result
    });
    ctx.onJobCompleted(jId);
    return true;
  }
  jobHeartbeat(jobId2, token) {
    const loc = this.jobIndex.get(jobId2);
    if (loc?.type !== "processing")
      return false;
    if (token) {
      return renewJobLock(jobId2, token, this.contextFactory.getLockContext());
    }
    const processing = this.processingShards[loc.shardIdx];
    const job = processing.get(jobId2);
    if (job) {
      job.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  }
  jobHeartbeatBatch(jobIds, tokens) {
    let count = 0;
    for (let i = 0;i < jobIds.length; i++) {
      if (this.jobHeartbeat(jobIds[i], tokens?.[i]))
        count++;
    }
    return count;
  }
  removeLock(jobId2) {
    this.contextFactory.getLockContext().jobLocks.delete(jobId2);
  }
  createLock(jobId2, owner, ttl = DEFAULT_LOCK_TTL) {
    return createLock(jobId2, owner, this.contextFactory.getLockContext(), ttl);
  }
  verifyLock(jobId2, token) {
    return verifyLock(jobId2, token, this.contextFactory.getLockContext());
  }
  renewJobLock(jobId2, token, newTtl) {
    return renewJobLock(jobId2, token, this.contextFactory.getLockContext(), newTtl);
  }
  renewJobLockBatch(items) {
    return renewJobLockBatch(items, this.contextFactory.getLockContext());
  }
  releaseLock(jobId2, token) {
    return releaseLock(jobId2, this.contextFactory.getLockContext(), token);
  }
  getLockInfo(jobId2) {
    return getLockInfo(jobId2, this.contextFactory.getLockContext());
  }
  registerClientJob(clientId, jobId2) {
    registerClientJob(clientId, jobId2, this.contextFactory.getLockContext());
  }
  unregisterClientJob(clientId, jobId2) {
    unregisterClientJob(clientId, jobId2, this.contextFactory.getLockContext());
  }
  releaseClientJobs(clientId) {
    return releaseClientJobs(clientId, this.contextFactory.getLockContext());
  }
  forceReleaseClientJobs(clientId) {
    return forceReleaseClientJobs(clientId, this.contextFactory.getLockContext());
  }
  async getJob(jobId2) {
    return getJob(jobId2, this.contextFactory.getQueryContext());
  }
  async getJobState(jobId2) {
    return getJobState(jobId2, this.contextFactory.getQueryContext());
  }
  getResult(jobId2) {
    return getJobResult(jobId2, this.contextFactory.getQueryContext());
  }
  async getChildrenValues(parentJobId) {
    const job = await this.getJob(parentJobId);
    if (!job?.childrenIds || job.childrenIds.length === 0) {
      return {};
    }
    const ctx = this.contextFactory.getQueryContext();
    const results = {};
    for (const childId of job.childrenIds) {
      const result = getJobResult(childId, ctx);
      if (result !== undefined) {
        const childJob = await this.getJob(childId);
        const key = childJob ? `${childJob.queue}:${childId}` : childId;
        results[key] = result;
      }
    }
    return results;
  }
  async updateJobParent(childJobId, parentJobId) {
    const childJob = await this.getJob(childJobId);
    if (!childJob)
      return;
    childJob.parentId = parentJobId;
    const jobData = childJob.data;
    jobData.__parentId = parentJobId;
    jobData.__parentQueue = childJob.queue;
    const parentJob = await this.getJob(parentJobId);
    if (parentJob) {
      if (!parentJob.childrenIds) {
        parentJob.childrenIds = [];
      }
      if (!parentJob.childrenIds.includes(childJobId)) {
        parentJob.childrenIds.push(childJobId);
      }
    }
    if (this.storage) {
      this.storage.updateJobData(childJobId, childJob.data);
      if (parentJob) {
        this.storage.updateJobChildrenIds(parentJobId, parentJob.childrenIds);
      }
    }
    const childLoc = this.jobIndex.get(childJobId);
    if (childLoc?.type === "dlq" && childJob.failParentOnFailure) {
      this.moveParentToFailed(parentJobId, childJob, "Child job failed").catch(() => {});
    }
    if (childLoc?.type === "dlq" && (childJob.removeDependencyOnFailure || childJob.ignoreDependencyOnFailure || childJob.continueParentOnFailure)) {
      this.onChildDependencyOption(childJob, "Child job failed");
    }
  }
  getJobByCustomId(customId) {
    return getJobByCustomId(customId, this.contextFactory.getQueryContext());
  }
  getProgress(jobId2) {
    return getJobProgress(jobId2, this.contextFactory.getQueryContext());
  }
  count(queue) {
    return getQueueCount(queue, this.contextFactory.getQueueControlContext());
  }
  pause(queue) {
    pauseQueue(queue, this.contextFactory.getQueueControlContext());
    this.persistQueueState(queue);
    this.dashboardEmit?.("queue:paused", { queue });
    this.eventsManager.broadcast({
      eventType: "paused",
      queue,
      jobId: "",
      timestamp: Date.now()
    });
  }
  resume(queue) {
    resumeQueue(queue, this.contextFactory.getQueueControlContext());
    this.persistQueueState(queue);
    this.dashboardEmit?.("queue:resumed", { queue });
    this.eventsManager.broadcast({
      eventType: "resumed",
      queue,
      jobId: "",
      timestamp: Date.now()
    });
  }
  isPaused(queue) {
    return isQueuePaused(queue, this.contextFactory.getQueueControlContext());
  }
  drain(queue) {
    const count = drainQueue(queue, this.contextFactory.getQueueControlContext());
    if (count > 0)
      this.dashboardEmit?.("queue:drained", { queue, count });
    return count;
  }
  obliterate(queue) {
    obliterateQueue(queue, this.contextFactory.getQueueControlContext());
    purgeDlqJobs(queue, this.contextFactory.getDlqContext());
    const toDrop = new Set;
    for (const [jid, loc] of this.jobIndex) {
      if (loc.type === "processing") {
        const job = this.processingShards[loc.shardIdx]?.get(jid);
        if (job?.queue === queue)
          toDrop.add(jid);
      } else if (loc.queueName === queue) {
        toDrop.add(jid);
      }
    }
    for (const jid of toDrop) {
      const loc = this.jobIndex.get(jid);
      if (loc?.type === "processing") {
        this.processingShards[loc.shardIdx]?.delete(jid);
      }
      this.jobIndex.delete(jid);
      this.completedJobs.delete(jid);
      this.completedJobsData.delete(jid);
      this.jobResults.delete(jid);
      this.jobLogs.delete(jid);
      this.jobLocks.delete(jid);
      this.failedChildrenValues.delete(jid);
      this.ignoredChildrenFailures.delete(jid);
      this.pendingDepChecks.delete(jid);
      this.stalledCandidates.delete(jid);
      this.repeatChain.delete(jid);
      this.storage?.deleteJob(jid);
    }
    const chainKeysToDelete = [];
    for (const [oldId, newId] of this.repeatChain) {
      if (toDrop.has(newId))
        chainKeysToDelete.push(oldId);
    }
    for (const oldId of chainKeysToDelete)
      this.repeatChain.delete(oldId);
    const customIdsToDelete = [];
    for (const [cid, jid] of this.customIdMap.entries()) {
      if (toDrop.has(jid))
        customIdsToDelete.push(cid);
    }
    for (const cid of customIdsToDelete)
      this.customIdMap.delete(cid);
    this.purgeQueueMetadata(queue);
    this.unregisterQueueName(queue);
    this.dashboardEmit?.("queue:obliterated", { queue });
    this.dashboardEmit?.("queue:removed", { queue });
  }
  purgeQueueMetadata(queue) {
    this.perQueueMetrics.delete(queue);
    this.storage?.deleteQueueState(queue);
  }
  listQueues() {
    return Array.from(this.queueNamesCache);
  }
  registerQueueName(queue) {
    const isNew = !this.queueNamesCache.has(queue);
    this.queueNamesCache.add(queue);
    if (isNew)
      this.dashboardEmit?.("queue:created", { queue });
  }
  unregisterQueueName(queue) {
    this.queueNamesCache.delete(queue);
  }
  clean(queue, graceMs, state, limit) {
    return cleanQueue(queue, graceMs, this.contextFactory.getQueueControlContext(), state, limit);
  }
  getCountsPerPriority(queue) {
    const idx = shardIndex(queue);
    const counts = this.shards[idx].getCountsPerPriority(queue);
    return Object.fromEntries(counts);
  }
  getJobs(queue, options = {}) {
    const idx = shardIndex(queue);
    return getJobs(queue, idx, options, {
      ...this.contextFactory.getQueryContext(),
      shardCount: SHARD_COUNT
    });
  }
  getDlq(queue, count) {
    return getDlqJobs(queue, this.contextFactory.getDlqContext(), count);
  }
  getDlqEntries(queue, filter) {
    return getDlqEntries(queue, this.contextFactory.getDlqContext(), filter);
  }
  getDlqCount(queue) {
    return this.shards[shardIndex(queue)].getDlqCount(queue);
  }
  getDlqStats(queue) {
    return getDlqStats(queue, this.contextFactory.getDlqContext());
  }
  retryDlq(queue, jobId2) {
    return retryDlqJobs(queue, this.contextFactory.getDlqContext(), jobId2);
  }
  purgeDlq(queue) {
    return purgeDlqJobs(queue, this.contextFactory.getDlqContext());
  }
  retryCompleted(queue, jobId2) {
    return retryCompletedJobs(queue, this.contextFactory.getRetryCompletedContext(), jobId2);
  }
  setRateLimit(queue, limit) {
    this.shards[shardIndex(queue)].setRateLimit(queue, limit);
    this.persistQueueState(queue);
  }
  clearRateLimit(queue) {
    this.shards[shardIndex(queue)].clearRateLimit(queue);
    this.persistQueueState(queue);
  }
  setConcurrency(queue, limit) {
    this.shards[shardIndex(queue)].setConcurrency(queue, limit);
    this.persistQueueState(queue);
  }
  clearConcurrency(queue) {
    this.shards[shardIndex(queue)].clearConcurrency(queue);
    this.persistQueueState(queue);
  }
  persistQueueState(queue) {
    if (!this.storage)
      return;
    const state = this.shards[shardIndex(queue)].getState(queue);
    if (!state.paused && state.rateLimit === null && state.concurrencyLimit === null) {
      this.storage.deleteQueueState(queue);
      return;
    }
    this.storage.saveQueueState(queue, state.paused, state.rateLimit, state.concurrencyLimit);
  }
  getQueueLimits(queue) {
    const state = this.shards[shardIndex(queue)].getState(queue);
    return { rateLimit: state.rateLimit, concurrencyLimit: state.concurrencyLimit };
  }
  getAllJobResults() {
    const map = new Map;
    for (const [k2, v2] of this.jobResults.entries())
      map.set(k2, v2);
    return map;
  }
  getAllJobLogs() {
    const map = new Map;
    for (const [k2, v2] of this.jobLogs.entries())
      map.set(k2, v2);
    return map;
  }
  getAllJobLocks() {
    return this.jobLocks;
  }
  setStallConfig(queue, config) {
    this.shards[shardIndex(queue)].setStallConfig(queue, config);
  }
  getStallConfig(queue) {
    return this.shards[shardIndex(queue)].getStallConfig(queue);
  }
  setDlqConfig(queue, config) {
    this.shards[shardIndex(queue)].setDlqConfig(queue, config);
  }
  getDlqConfig(queue) {
    return this.shards[shardIndex(queue)].getDlqConfig(queue);
  }
  getCloudTelemetry(queueNames) {
    const perQueue = {};
    for (const name of queueNames) {
      const idx = shardIndex(name);
      const shard = this.shards[idx];
      const uniqueMap = shard.uniqueKeys.get(name);
      const groupSet = shard.activeGroups.get(name);
      let waitingDeps = 0;
      for (const j of shard.waitingDeps.values()) {
        if (j.queue === name)
          waitingDeps++;
      }
      let waitingChildren = 0;
      for (const j of shard.waitingChildren.values()) {
        if (j.queue === name)
          waitingChildren++;
      }
      perQueue[name] = {
        uniqueKeys: uniqueMap?.size ?? 0,
        activeGroups: groupSet?.size ?? 0,
        waitingDeps,
        waitingChildren
      };
    }
    return {
      perQueue,
      eventSubscribers: this.eventsManager.subscriberCount,
      pendingDepChecks: this.pendingDepChecks.size
    };
  }
  async cancel(jobId2) {
    return cancelJob(jobId2, this.contextFactory.getJobMgmtContext());
  }
  async updateProgress(jobId2, progress, message) {
    return updateJobProgress(jobId2, progress, this.contextFactory.getJobMgmtContext(), message);
  }
  async updateJobData(jobId2, data) {
    return updateJobData(jobId2, data, this.contextFactory.getJobMgmtContext());
  }
  async changePriority(jobId2, priority, lifo) {
    return changeJobPriority(jobId2, priority, this.contextFactory.getJobMgmtContext(), lifo);
  }
  async promote(jobId2) {
    return promoteJob(jobId2, this.contextFactory.getJobMgmtContext());
  }
  async moveToDelayed(jobId2, delay) {
    return moveJobToDelayed(jobId2, delay, this.contextFactory.getJobMgmtContext());
  }
  async changeDelay(jobId2, delay) {
    const ctx = this.contextFactory.getJobMgmtContext();
    const loc = ctx.jobIndex.get(jobId2);
    if (loc?.type === "queue") {
      return changeWaitingDelay(jobId2, delay, ctx);
    }
    return moveJobToDelayed(jobId2, delay, ctx);
  }
  async moveActiveToWait(jobId2) {
    return moveActiveToWait(jobId2, this.contextFactory.getJobMgmtContext());
  }
  async changeWaitingDelay(jobId2, delay) {
    return changeWaitingDelay(jobId2, delay, this.contextFactory.getJobMgmtContext());
  }
  async moveToWaitingChildren(jobId2) {
    return moveToWaitingChildren(jobId2, this.contextFactory.getJobMgmtContext());
  }
  async extendLock(jobId2, token, duration) {
    const jid = typeof jobId2 === "string" ? jobId2 : jobId2;
    const ctx = this.contextFactory.getLockContext();
    if (token) {
      return renewJobLock(jid, token, ctx, duration);
    }
    const lockInfo = getLockInfo(jid, ctx);
    if (lockInfo) {
      return renewJobLock(jid, lockInfo.token, ctx, duration);
    }
    return false;
  }
  async discard(jobId2) {
    return discardJob(jobId2, this.contextFactory.getJobMgmtContext());
  }
  addLog(jobId2, message, level = "info") {
    return addJobLog(jobId2, message, this.contextFactory.getLogsContext(), level);
  }
  getLogs(jobId2) {
    return getJobLogs(jobId2, this.contextFactory.getLogsContext());
  }
  clearLogs(jobId2, keepLogs) {
    clearJobLogs(jobId2, this.contextFactory.getLogsContext(), keepLogs);
  }
  getPerQueueStats() {
    return getPerQueueStats(this.contextFactory.getStatsContext(), this.queueNamesCache);
  }
  getPrometheusMetrics() {
    return generatePrometheusMetrics(this.getStats(), this.workerManager, this.webhookManager, this.getPerQueueStats());
  }
  addCron(input) {
    if (input.preventOverlap) {
      const uniqueKey = input.uniqueKey ?? `cron:${input.name}`;
      this.removeOrphanedCronJob(input.queue, uniqueKey);
    }
    const cron = this.cronScheduler.add(input);
    this.storage?.saveCron(cron);
    return cron;
  }
  removeOrphanedCronJob(queue, uniqueKey) {
    const idx = shardIndex(queue);
    const shard = this.shards[idx];
    const entry = shard.getUniqueKeyEntry(queue, uniqueKey);
    if (!entry)
      return;
    const jobId2 = entry.jobId;
    const location = this.jobIndex.get(jobId2);
    if (location?.type !== "queue")
      return;
    const job = shard.getQueue(queue).remove(jobId2);
    if (job) {
      shard.decrementQueued(jobId2);
      shard.releaseUniqueKey(queue, uniqueKey);
      this.jobIndex.delete(jobId2);
      this.storage?.deleteJob(jobId2);
    }
  }
  removeCron(name) {
    const removed = this.cronScheduler.remove(name);
    if (removed)
      this.storage?.deleteCron(name);
    return removed;
  }
  getCron(name) {
    return this.cronScheduler.get(name);
  }
  listCrons() {
    return this.cronScheduler.list();
  }
  setDashboardEmit(fn) {
    this.dashboardEmit = fn;
    this.cronScheduler.setDashboardEmit(fn);
    this.webhookManager.setDashboardEmit(fn);
    this.workerManager.setDashboardEmit(fn);
    if (this.recoveryStats) {
      fn("server:recovered", this.recoveryStats);
      this.recoveryStats = null;
    }
  }
  emitDashboardEvent(event, data) {
    this.dashboardEmit?.(event, data);
  }
  subscribe(callback) {
    return this.eventsManager.subscribe(callback);
  }
  waitForJobCompletion(jobId2, timeoutMs) {
    return this.eventsManager.waitForJobCompletion(jobId2, timeoutMs);
  }
  registerWorker(name, queues, concurrency, opts) {
    const worker = this.workerManager.register(name, queues, concurrency, opts);
    this.dashboardEmit?.("worker:connected", {
      workerId: worker.id,
      name: worker.name,
      queues: worker.queues,
      hostname: worker.hostname,
      pid: worker.pid
    });
    return worker;
  }
  unregisterWorker(workerId) {
    const result = this.workerManager.unregister(workerId);
    if (result) {
      this.dashboardEmit?.("worker:disconnected", { workerId });
    }
    return result;
  }
  unregisterWorkersByClientId(clientId) {
    return this.workerManager.unregisterByClientId(clientId);
  }
  getJobIndex() {
    return this.jobIndex;
  }
  getCompletedJobs() {
    return this.completedJobs;
  }
  getDepCompletions() {
    return this.depCompletions;
  }
  getShards() {
    return this.shards;
  }
  onJobCompleted(completedId) {
    this.failedChildrenValues.delete(completedId);
    this.ignoredChildrenFailures.delete(completedId);
    this.pendingDepChecks.add(completedId);
    this.scheduleDependencyFlush();
    this.checkFlowCompleted(completedId);
  }
  async checkFlowCompleted(completedId) {
    const job = await this.getJob(completedId);
    if (!job?.parentId)
      return;
    const parent = await this.getJob(job.parentId);
    if (!parent?.childrenIds || parent.childrenIds.length === 0)
      return;
    const allDone = parent.childrenIds.every((childId) => this.completedJobs.has(childId));
    if (allDone) {
      this.dashboardEmit?.("flow:completed", {
        parentJobId: String(parent.id),
        queue: parent.queue,
        childrenCount: parent.childrenIds.length
      });
    }
  }
  failParentOnChildFailure(childJob, error2) {
    const parentId = childJob.parentId;
    if (!parentId)
      return;
    this.moveParentToFailed(parentId, childJob, error2).catch(() => {});
  }
  async moveParentToFailed(parentId, childJob, error2) {
    const parentJob = await this.getJob(parentId);
    if (!parentJob)
      return;
    const parentLoc = this.jobIndex.get(parentId);
    if (!parentLoc)
      return;
    if (parentLoc.type !== "queue")
      return;
    const idx = shardIndex(parentJob.queue);
    await withWriteLock(this.shardLocks[idx], () => {
      if (this.jobIndex.get(parentId)?.type !== "queue")
        return;
      const shard = this.shards[idx];
      if (shard.waitingDeps.has(parentId)) {
        shard.waitingDeps.delete(parentId);
        shard.unregisterDependencies(parentId, parentJob.dependsOn);
      }
      if (shard.waitingChildren.has(parentId)) {
        shard.waitingChildren.delete(parentId);
      }
      const queue = shard.getQueue(parentJob.queue);
      if (queue.find(parentId)) {
        queue.remove(parentId);
        shard.decrementQueued(parentId);
      }
      const failError = `Child job ${childJob.id} failed: ${error2 ?? "unknown error"}`;
      const entry = shard.addToDlq(parentJob, "unknown", failError);
      this.jobIndex.set(parentId, { type: "dlq", queueName: parentJob.queue });
      this.storage?.saveDlqEntry(entry);
      this.storage?.deleteJob(parentId);
    });
    this.failedChildrenValues.delete(parentId);
    this.ignoredChildrenFailures.delete(parentId);
    this.eventsManager.broadcast({
      eventType: "failed",
      queue: parentJob.queue,
      jobId: parentId,
      timestamp: Date.now(),
      error: `Child job ${childJob.id} failed: ${error2 ?? "unknown error"}`,
      data: parentJob.data
    });
    this.dashboardEmit?.("flow:failed", {
      parentJobId: String(parentId),
      failedChildId: String(childJob.id),
      queue: parentJob.queue,
      error: error2 ?? "Child job failed"
    });
  }
  onChildDependencyOption(childJob, error2) {
    if (!childJob.parentId)
      return;
    if (childJob.continueParentOnFailure) {
      this.continueParentOnChildFailure(childJob, error2).catch(() => {});
    } else {
      this.removeChildFromParentDeps(childJob, error2, childJob.ignoreDependencyOnFailure).catch(() => {});
    }
  }
  async continueParentOnChildFailure(childJob, error2) {
    const parentId = childJob.parentId;
    if (!parentId)
      return;
    const parentJob = await this.getJob(parentId);
    if (!parentJob)
      return;
    const parentLoc = this.jobIndex.get(parentId);
    if (parentLoc?.type !== "queue")
      return;
    const childKey = `${childJob.queue}:${childJob.id}`;
    const existing = this.failedChildrenValues.get(parentId) ?? {};
    existing[childKey] = error2 ?? "unknown error";
    this.failedChildrenValues.set(parentId, existing);
    const idx = shardIndex(parentJob.queue);
    await this.promoteParentAfterChildFailure(parentId, parentJob, idx);
  }
  async promoteParentAfterChildFailure(parentId, parentJob, idx) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 0);
      timer.unref?.();
    });
    let promoted = false;
    await withWriteLock(this.shardLocks[idx], () => {
      if (this.jobIndex.get(parentId)?.type !== "queue")
        return;
      const shard = this.shards[idx];
      if (shard.waitingDeps.has(parentId)) {
        shard.waitingDeps.delete(parentId);
        shard.unregisterDependencies(parentId, parentJob.dependsOn);
      }
      if (shard.waitingChildren.has(parentId)) {
        shard.waitingChildren.delete(parentId);
      }
      const queue = shard.getQueue(parentJob.queue);
      if (!queue.find(parentId)) {
        const now = Date.now();
        parentJob.runAt = now;
        queue.push(parentJob);
        shard.incrementQueued(parentId, false, parentJob.createdAt, parentJob.queue, now);
        this.jobIndex.set(parentId, { type: "queue", shardIdx: idx, queueName: parentJob.queue });
        shard.notify();
        promoted = true;
      }
    });
    if (promoted) {
      this.eventsManager.broadcast({
        eventType: "waiting",
        queue: parentJob.queue,
        jobId: parentId,
        timestamp: Date.now(),
        prev: "waiting-children"
      });
    }
  }
  async removeChildFromParentDeps(childJob, error2, storeIgnored) {
    const parentId = childJob.parentId;
    if (!parentId)
      return;
    const parentJob = await this.getJob(parentId);
    if (!parentJob)
      return;
    const parentLoc = this.jobIndex.get(parentId);
    if (parentLoc?.type !== "queue")
      return;
    if (storeIgnored) {
      const childKey = `${childJob.queue}:${childJob.id}`;
      const existing = this.ignoredChildrenFailures.get(parentId) ?? {};
      existing[childKey] = error2 ?? "unknown error";
      this.ignoredChildrenFailures.set(parentId, existing);
    }
    const idx = shardIndex(parentJob.queue);
    let readyToPromote = false;
    await withWriteLock(this.shardLocks[idx], () => {
      if (this.jobIndex.get(parentId)?.type !== "queue")
        return;
      const shard = this.shards[idx];
      const parentInDeps = shard.waitingDeps.get(parentId);
      if (!parentInDeps)
        return;
      const depIndex = parentJob.dependsOn.indexOf(childJob.id);
      if (depIndex !== -1) {
        parentJob.dependsOn.splice(depIndex, 1);
        shard.unregisterDependencies(parentId, [childJob.id]);
      }
      readyToPromote = parentJob.dependsOn.length === 0 || parentJob.dependsOn.every((dep) => this.completedJobs.has(dep));
    });
    if (readyToPromote) {
      await this.promoteParentAfterChildFailure(parentId, parentJob, idx);
    }
  }
  async getFailedChildrenValues(parentJobId) {
    return this.failedChildrenValues.get(parentJobId) ?? {};
  }
  async getIgnoredChildrenFailures(parentJobId) {
    return this.ignoredChildrenFailures.get(parentJobId) ?? {};
  }
  async removeChildDependency(childJobId) {
    const childJob = await this.getJob(childJobId);
    if (!childJob)
      throw new Error(`Job not found: ${childJobId}`);
    if (!childJob.parentId)
      throw new Error(`Job ${childJobId} has no parent`);
    const parentId = childJob.parentId;
    const parentJob = await this.getJob(parentId);
    if (!parentJob)
      return false;
    const parentLoc = this.jobIndex.get(parentId);
    if (parentLoc?.type !== "queue")
      return false;
    const idx = shardIndex(parentJob.queue);
    let promoted = false;
    await withWriteLock(this.shardLocks[idx], () => {
      if (this.jobIndex.get(parentId)?.type !== "queue")
        return;
      const shard = this.shards[idx];
      const parentInDeps = shard.waitingDeps.get(parentId);
      if (!parentInDeps)
        return;
      const depIndex = parentJob.dependsOn.indexOf(childJobId);
      if (depIndex !== -1) {
        parentJob.dependsOn.splice(depIndex, 1);
        shard.unregisterDependencies(parentId, [childJobId]);
      }
      const allDone = parentJob.dependsOn.length === 0 || parentJob.dependsOn.every((dep) => this.completedJobs.has(dep));
      if (allDone) {
        shard.waitingDeps.delete(parentId);
        const now = Date.now();
        parentJob.runAt = now;
        shard.getQueue(parentJob.queue).push(parentJob);
        shard.incrementQueued(parentId, false, parentJob.createdAt, parentJob.queue, now);
        this.jobIndex.set(parentId, { type: "queue", shardIdx: idx, queueName: parentJob.queue });
        shard.notify();
        promoted = true;
      }
    });
    if (promoted) {
      this.eventsManager.broadcast({
        eventType: "waiting",
        queue: parentJob.queue,
        jobId: parentId,
        timestamp: Date.now(),
        prev: "waiting-children"
      });
    }
    return true;
  }
  async removeUnprocessedChildren(parentJobId) {
    const parent = await this.getJob(parentJobId);
    if (!parent?.childrenIds || parent.childrenIds.length === 0)
      return;
    for (const childId of parent.childrenIds) {
      const loc = this.jobIndex.get(childId);
      if (loc?.type === "queue") {
        try {
          await this.cancel(childId);
        } catch {}
      }
    }
  }
  onJobsCompleted(completedIds) {
    for (const id of completedIds)
      this.pendingDepChecks.add(id);
    this.scheduleDependencyFlush();
  }
  scheduleDependencyFlush() {
    if (this.depFlushScheduled)
      return;
    this.depFlushScheduled = true;
    queueMicrotask(() => {
      this.depFlushScheduled = false;
      if (this.depFlushRunning)
        return;
      this.runDependencyFlush();
    });
  }
  async runDependencyFlush() {
    this.depFlushRunning = true;
    try {
      while (this.pendingDepChecks.size > 0) {
        await processPendingDependencies(this.contextFactory.getBackgroundContext());
        handleTaskSuccess("dependency");
      }
    } catch (err) {
      handleTaskError("dependency", err);
    } finally {
      this.depFlushRunning = false;
      if (this.pendingDepChecks.size > 0) {
        this.scheduleDependencyFlush();
      }
    }
  }
  hasPendingDeps() {
    for (const shard of this.shards) {
      if (shard.waitingDeps.size > 0)
        return true;
    }
    return false;
  }
  getStats() {
    return getStats(this.contextFactory.getStatsContext(), this.cronScheduler);
  }
  getQueuesSummary() {
    const ctx = this.contextFactory.getStatsContext();
    const queues = this.listQueues();
    const result = [];
    for (const name of queues) {
      const c = getQueueJobCounts(name, ctx);
      result.push({
        name,
        paused: this.isPaused(name),
        counts: {
          waiting: c.waiting,
          active: c.active,
          completed: c.completed,
          failed: c.failed,
          delayed: c.delayed
        }
      });
    }
    return result;
  }
  getQueueJobCounts(queueName) {
    return getQueueJobCounts(queueName, this.contextFactory.getStatsContext());
  }
  getMemoryStats() {
    return getMemoryStats(this.contextFactory.getStatsContext());
  }
  getStorageStatus() {
    if (!this.storage)
      return { diskFull: false, error: null, since: null };
    return this.storage.getDiskFullStatus();
  }
  compactMemory() {
    compactMemory(this.contextFactory.getStatsContext());
    this.dashboardEmit?.("memory:compacted", {});
  }
  shutdown() {
    this.cronScheduler.stop();
    this.workerManager.stop();
    this.eventsManager.clear();
    if (this.backgroundTaskHandles) {
      stopBackgroundTasks(this.backgroundTaskHandles);
    }
    this.storage?.close();
    this.jobIndex.clear();
    this.completedJobs.clear();
    this.completedJobsData.clear();
    this.depCompletions.clear();
    this.timedOutJobs.clear();
    this.jobResults.clear();
    this.jobLogs.clear();
    this.customIdMap.clear();
    this.pendingDepChecks.clear();
    this.queueNamesCache.clear();
    this.jobLocks.clear();
    this.stalledCandidates.clear();
    this.clientJobs.clear();
    this.repeatChain.clear();
    this.failedChildrenValues.clear();
    this.ignoredChildrenFailures.clear();
    for (const shard of this.processingShards)
      shard.clear();
    for (const shard of this.shards) {
      shard.waitingDeps.clear();
      shard.dependencyIndex.clear();
      shard.waitingChildren.clear();
      shard.uniqueKeys.clear();
      shard.activeGroups.clear();
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/manager.js
var instance = null;
function getDataPath() {
  return Bun.env.BUNQUEUE_DATA_PATH ?? Bun.env.BQ_DATA_PATH ?? Bun.env.DATA_PATH ?? Bun.env.SQLITE_PATH;
}
function getSharedManager(dataPath) {
  instance ??= new QueueManager({ dataPath: dataPath ?? getDataPath() });
  return instance;
}
function shutdownManager() {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/types.js
var FORCE_EMBEDDED2 = Bun.env.BUNQUEUE_EMBEDDED === "1";
var WORKER_CONSTANTS = {
  MAX_BACKOFF_MS: 30000,
  BASE_BACKOFF_MS: 100,
  MAX_POLL_TIMEOUT: 30000,
  DEFAULT_ACK_INTERVAL: 50
};

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/ackBatcher.js
var DEFAULT_MAX_RETRIES = 3;
var DEFAULT_RETRY_DELAY_MS = 100;

class AckBatcher {
  MAX_PENDING_ACKS = 1e4;
  pendingAcks = [];
  ackTimer = null;
  config;
  tcp = null;
  stopped = false;
  inFlightFlushes = new Set;
  constructor(config) {
    this.config = config;
  }
  setTcp(tcp) {
    this.tcp = tcp;
  }
  async queue(id, result, token) {
    while (this.pendingAcks.length >= this.MAX_PENDING_ACKS && !this.stopped) {
      await this.waitForInFlight();
      if (this.pendingAcks.length >= this.MAX_PENDING_ACKS) {
        const flushPromise = this.flush();
        this.inFlightFlushes.add(flushPromise);
        flushPromise.finally(() => this.inFlightFlushes.delete(flushPromise));
        await flushPromise;
      }
    }
    return new Promise((resolve, reject) => {
      this.pendingAcks.push({
        id,
        result,
        token,
        resolve,
        reject
      });
      if (this.pendingAcks.length >= this.config.batchSize) {
        const flushPromise = this.flush();
        this.inFlightFlushes.add(flushPromise);
        flushPromise.finally(() => this.inFlightFlushes.delete(flushPromise));
      } else {
        this.ackTimer ??= setTimeout(() => {
          this.ackTimer = null;
          const flushPromise = this.flush();
          this.inFlightFlushes.add(flushPromise);
          flushPromise.finally(() => this.inFlightFlushes.delete(flushPromise));
        }, this.config.interval);
      }
    });
  }
  async flush() {
    if (this.pendingAcks.length === 0)
      return;
    const batch = this.pendingAcks.splice(0, this.pendingAcks.length);
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    await this.sendBatchWithRetry(batch);
  }
  async sendBatchWithRetry(batch) {
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelay = this.config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    let lastError = null;
    for (let attempt = 0;attempt <= maxRetries; attempt++) {
      if (this.stopped) {
        const error2 = new Error("AckBatcher stopped");
        for (const ack of batch) {
          ack.reject(error2);
        }
        return;
      }
      try {
        if (this.config.embedded) {
          const manager = getSharedManager();
          const items = batch.map((a) => ({ id: jobId(a.id), result: a.result, token: a.token }));
          await manager.ackBatchWithResults(items);
        } else if (this.tcp) {
          const response = await this.tcp.send({
            cmd: "ACKB",
            ids: batch.map((a) => a.id),
            results: batch.map((a) => a.result),
            tokens: batch.map((a) => a.token ?? "")
          });
          if (!response.ok) {
            throw new Error(response.error ?? "Batch ACK failed");
          }
        }
        for (const ack of batch) {
          ack.resolve();
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await Bun.sleep(delay);
        }
      }
    }
    console.error(`[AckBatcher] Flush failed after ${maxRetries + 1} attempts:`, lastError?.message, `(${batch.length} acks lost)`);
    for (const ack of batch) {
      ack.reject(lastError ?? new Error("Unknown error"));
    }
  }
  stop() {
    this.stopped = true;
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    this.pendingAcks.length = 0;
  }
  hasPending() {
    return this.pendingAcks.length > 0;
  }
  async waitForInFlight() {
    if (this.inFlightFlushes.size === 0)
      return;
    await Promise.all(this.inFlightFlushes);
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/jobParser.js
function parseJobFromResponse(jobData, queueName) {
  return {
    id: jobId(jobData.id),
    queue: queueName,
    data: jobData.data,
    priority: jobData.priority ?? 0,
    createdAt: jobData.createdAt ?? Date.now(),
    runAt: jobData.runAt ?? Date.now(),
    startedAt: jobData.startedAt ?? Date.now(),
    completedAt: null,
    attempts: jobData.attempts ?? 0,
    maxAttempts: jobData.maxAttempts ?? 3,
    backoff: jobData.backoff ?? 1000,
    ttl: jobData.ttl ?? null,
    timeout: jobData.timeout ?? null,
    uniqueKey: jobData.uniqueKey ?? null,
    customId: jobData.customId ?? null,
    progress: jobData.progress ?? 0,
    progressMessage: jobData.progressMessage ?? null,
    dependsOn: Array.isArray(jobData.dependsOn) ? jobData.dependsOn : [],
    parentId: jobData.parentId ?? null,
    childrenIds: Array.isArray(jobData.childrenIds) ? jobData.childrenIds : [],
    childrenCompleted: jobData.childrenCompleted ?? 0,
    tags: Array.isArray(jobData.tags) ? jobData.tags : [],
    groupId: jobData.groupId ?? null,
    lifo: false,
    removeOnComplete: jobData.removeOnComplete ?? false,
    removeOnFail: false,
    stallCount: 0,
    stallTimeout: null,
    lastHeartbeat: Date.now(),
    repeat: null
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/jobHelpers.js
function extractUserData(jobData) {
  if (typeof jobData === "object" && jobData !== null) {
    const { name: _name, ...userData } = jobData;
    return userData;
  }
  return jobData;
}
function extractParent(jobData) {
  if (typeof jobData === "object" && jobData !== null) {
    const data = jobData;
    const parentId = data.__parentId;
    const parentQueue = data.__parentQueue;
    if (parentId !== undefined && parentQueue !== undefined && (typeof parentId === "string" || typeof parentId === "number") && (typeof parentQueue === "string" || typeof parentQueue === "number")) {
      return {
        id: String(parentId),
        queueQualifiedName: String(parentQueue)
      };
    }
  }
  return;
}
function buildRepeatOpts(repeat) {
  if (!repeat)
    return;
  return {
    every: repeat.every,
    limit: repeat.limit,
    pattern: repeat.pattern,
    count: repeat.count,
    startDate: repeat.startDate,
    endDate: repeat.endDate,
    tz: repeat.tz,
    immediately: repeat.immediately,
    prevMillis: repeat.prevMillis,
    offset: repeat.offset,
    jobId: repeat.jobId
  };
}
function buildParentOpts(job) {
  const data = job.data;
  const rawParentId = job.parentId ?? data?.__parentId;
  const rawParentQueue = data?.__parentQueue;
  const isStringLike = (v2) => typeof v2 === "string" || typeof v2 === "number";
  if (isStringLike(rawParentId) && isStringLike(rawParentQueue)) {
    return { id: String(rawParentId), queue: String(rawParentQueue) };
  }
  return;
}
function buildJobOpts(job) {
  const backoff = job.backoffConfig ? { type: job.backoffConfig.type, delay: job.backoffConfig.delay } : job.backoff;
  return {
    priority: job.priority,
    delay: job.runAt > job.createdAt ? job.runAt - job.createdAt : 0,
    attempts: job.maxAttempts,
    backoff,
    timeout: job.timeout ?? undefined,
    jobId: job.customId ?? undefined,
    removeOnComplete: job.removeOnComplete,
    removeOnFail: job.removeOnFail,
    stallTimeout: job.stallTimeout ?? undefined,
    repeat: buildRepeatOpts(job.repeat),
    parent: buildParentOpts(job),
    lifo: job.lifo,
    stackTraceLimit: job.stackTraceLimit,
    keepLogs: job.keepLogs ?? undefined,
    sizeLimit: job.sizeLimit ?? undefined,
    failParentOnFailure: job.failParentOnFailure,
    removeDependencyOnFailure: job.removeDependencyOnFailure,
    deduplication: job.deduplicationTtl !== null ? { id: job.customId ?? "", ttl: job.deduplicationTtl } : undefined,
    debounce: job.debounceId && job.debounceTtl !== null ? { id: job.debounceId, ttl: job.debounceTtl } : undefined
  };
}
function buildParentKey(job) {
  if (job.parentId) {
    const data = job.data;
    const parentQueue = data?.__parentQueue;
    if (parentQueue && (typeof parentQueue === "string" || typeof parentQueue === "number")) {
      return `${String(parentQueue)}:${job.parentId}`;
    }
    return `unknown:${job.parentId}`;
  }
  return;
}
function buildRepeatJobKey(job) {
  if (job.repeat) {
    const pattern = job.repeat.pattern ?? (job.repeat.every ? `every:${job.repeat.every}` : "");
    return `${job.queue}:${job.id}:${pattern}`;
  }
  return;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/jobConversionHelpers.js
function buildJobProperties(job, name, stacktrace, token, processedBy) {
  const id = String(job.id);
  const parent = extractParent(job.data);
  const jobOpts = buildJobOpts(job);
  return {
    id,
    name,
    data: extractUserData(job.data),
    queueName: job.queue,
    attemptsMade: job.attempts,
    timestamp: job.createdAt,
    progress: job.progress,
    parent,
    delay: job.runAt > job.createdAt ? job.runAt - job.createdAt : 0,
    processedOn: job.startedAt ?? undefined,
    finishedOn: job.completedAt ?? undefined,
    stacktrace: stacktrace ?? job.stacktrace ?? null,
    stalledCounter: job.stallCount,
    priority: job.priority,
    parentKey: buildParentKey(job),
    opts: jobOpts,
    token,
    processedBy,
    deduplicationId: job.customId ?? undefined,
    repeatJobKey: buildRepeatJobKey(job),
    attemptsStarted: job.attempts
  };
}
function buildStateCheckMethods(id, getState, getDependenciesCount) {
  return {
    isWaiting: async () => {
      const state = await (getState ? getState(id) : Promise.resolve("unknown"));
      return state === "waiting";
    },
    isActive: async () => {
      const state = await (getState ? getState(id) : Promise.resolve("unknown"));
      return state === "active";
    },
    isDelayed: async () => {
      const state = await (getState ? getState(id) : Promise.resolve("unknown"));
      return state === "delayed";
    },
    isCompleted: async () => {
      const state = await (getState ? getState(id) : Promise.resolve("unknown"));
      return state === "completed";
    },
    isFailed: async () => {
      const state = await (getState ? getState(id) : Promise.resolve("unknown"));
      return state === "failed";
    },
    isWaitingChildren: async () => {
      if (getDependenciesCount) {
        const counts = await getDependenciesCount(id);
        return counts.unprocessed > 0;
      }
      return false;
    }
  };
}
function buildSerializationMethods(job, id, name, jobOpts, stacktrace) {
  const stack = stacktrace ?? job.stacktrace ?? null;
  return {
    toJSON: () => ({
      id,
      name,
      data: extractUserData(job.data),
      opts: jobOpts,
      progress: job.progress,
      delay: job.runAt > job.createdAt ? job.runAt - job.createdAt : 0,
      timestamp: job.createdAt,
      attemptsMade: job.attempts,
      stacktrace: stack,
      returnvalue: undefined,
      failedReason: undefined,
      finishedOn: job.completedAt ?? undefined,
      processedOn: job.startedAt ?? undefined,
      queueQualifiedName: `bull:${job.queue}`,
      parentKey: buildParentKey(job)
    }),
    asJSON: () => ({
      id,
      name,
      data: JSON.stringify(extractUserData(job.data)),
      opts: JSON.stringify(jobOpts),
      progress: JSON.stringify(job.progress),
      delay: String(job.runAt > job.createdAt ? job.runAt - job.createdAt : 0),
      timestamp: String(job.createdAt),
      attemptsMade: String(job.attempts),
      stacktrace: stack ? JSON.stringify(stack) : null,
      returnvalue: undefined,
      failedReason: undefined,
      finishedOn: job.completedAt ? String(job.completedAt) : undefined,
      processedOn: job.startedAt ? String(job.startedAt) : undefined,
      parentKey: buildParentKey(job)
    })
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/jobConversion.js
function createPublicJob(opts) {
  const { job, name, updateProgress, log, getState, remove, retry, getChildrenValues, updateData, promote, changeDelay, changePriority, extendLock, clearLogs, getDependencies, getDependenciesCount, moveToCompleted, moveToFailed, moveToWait, moveToDelayed, moveToWaitingChildren: moveToWaitingChildren2, waitUntilFinished, discard, getFailedChildrenValues, getIgnoredChildrenFailures, removeChildDependency, removeDeduplicationKey, removeUnprocessedChildren, token, processedBy, stacktrace } = opts;
  const id = String(job.id);
  const jobOpts = buildJobOpts(job);
  const props = buildJobProperties(job, name, stacktrace, token, processedBy);
  const stateChecks = buildStateCheckMethods(id, getState, getDependenciesCount);
  const serialization = buildSerializationMethods(job, id, name, jobOpts, stacktrace);
  return {
    ...props,
    ...stateChecks,
    ...serialization,
    updateProgress: (progress, message) => updateProgress(id, progress, message),
    log: (message) => log(id, message),
    getState: () => getState ? getState(id) : Promise.resolve("unknown"),
    remove: () => remove ? remove(id) : Promise.resolve(),
    retry: () => retry ? retry(id) : Promise.resolve(),
    getChildrenValues: () => getChildrenValues ? getChildrenValues(id) : Promise.resolve({}),
    updateData: (data) => updateData ? updateData(id, data) : Promise.resolve(),
    promote: () => promote ? promote(id) : Promise.resolve(),
    changeDelay: (delay) => changeDelay ? changeDelay(id, delay) : Promise.resolve(),
    changePriority: (prioOpts) => changePriority ? changePriority(id, prioOpts) : Promise.resolve(),
    extendLock: (lockToken, duration) => extendLock ? extendLock(id, lockToken, duration) : Promise.resolve(0),
    clearLogs: (keepLogs) => clearLogs ? clearLogs(id, keepLogs) : Promise.resolve(),
    getDependencies: (depOpts) => getDependencies ? getDependencies(id, depOpts) : Promise.resolve({ processed: {}, unprocessed: [] }),
    getDependenciesCount: (depOpts) => getDependenciesCount ? getDependenciesCount(id, depOpts) : Promise.resolve({ processed: 0, unprocessed: 0 }),
    moveToCompleted: (returnValue, lockToken, _fetchNext) => moveToCompleted ? moveToCompleted(id, returnValue, lockToken) : Promise.resolve(null),
    moveToFailed: (error2, lockToken, _fetchNext) => moveToFailed ? moveToFailed(id, error2, lockToken) : Promise.resolve(),
    moveToWait: (lockToken) => moveToWait ? moveToWait(id, lockToken) : Promise.resolve(false),
    moveToDelayed: (timestamp, lockToken) => moveToDelayed ? moveToDelayed(id, timestamp, lockToken) : Promise.resolve(),
    moveToWaitingChildren: (lockToken, moveOpts) => moveToWaitingChildren2 ? moveToWaitingChildren2(id, lockToken, moveOpts) : Promise.resolve(false),
    waitUntilFinished: (queueEvents, ttl) => waitUntilFinished ? waitUntilFinished(id, queueEvents, ttl) : Promise.resolve(undefined),
    discard: () => {
      if (discard)
        discard(id);
    },
    getFailedChildrenValues: () => getFailedChildrenValues ? getFailedChildrenValues(id) : Promise.resolve({}),
    getIgnoredChildrenFailures: () => getIgnoredChildrenFailures ? getIgnoredChildrenFailures(id) : Promise.resolve({}),
    removeChildDependency: () => removeChildDependency ? removeChildDependency(id) : Promise.resolve(false),
    removeDeduplicationKey: () => removeDeduplicationKey ? removeDeduplicationKey(id) : Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available")),
    removeUnprocessedChildren: () => removeUnprocessedChildren ? removeUnprocessedChildren(id) : Promise.resolve()
  };
}
function toPublicJob(opts) {
  const { job, name, getState, remove, retry, getChildrenValues, updateData, promote, changeDelay, changePriority, extendLock, clearLogs, getDependencies, getDependenciesCount, moveToCompleted, moveToFailed, moveToWait, moveToDelayed, moveToWaitingChildren: moveToWaitingChildren2, waitUntilFinished, discard, getFailedChildrenValues, getIgnoredChildrenFailures, removeChildDependency, removeDeduplicationKey, removeUnprocessedChildren, stacktrace } = opts;
  const id = String(job.id);
  const jobOpts = buildJobOpts(job);
  const props = buildJobProperties(job, name, stacktrace, undefined, undefined);
  const stateChecks = buildStateCheckMethods(id, getState, getDependenciesCount);
  const serialization = buildSerializationMethods(job, id, name, jobOpts, stacktrace);
  return {
    ...props,
    ...stateChecks,
    ...serialization,
    updateProgress: async () => {},
    log: async () => {},
    getState: () => getState ? getState(id) : Promise.resolve("unknown"),
    remove: () => remove ? remove(id) : Promise.resolve(),
    retry: () => retry ? retry(id) : Promise.resolve(),
    getChildrenValues: () => getChildrenValues ? getChildrenValues(id) : Promise.resolve({}),
    updateData: (data) => updateData ? updateData(id, data) : Promise.resolve(),
    promote: () => promote ? promote(id) : Promise.resolve(),
    changeDelay: (delay) => changeDelay ? changeDelay(id, delay) : Promise.resolve(),
    changePriority: (prioOpts) => changePriority ? changePriority(id, prioOpts) : Promise.resolve(),
    extendLock: (lockToken, duration) => extendLock ? extendLock(id, lockToken, duration) : Promise.resolve(0),
    clearLogs: (keepLogs) => clearLogs ? clearLogs(id, keepLogs) : Promise.resolve(),
    getDependencies: (depOpts) => getDependencies ? getDependencies(id, depOpts) : Promise.resolve({ processed: {}, unprocessed: [] }),
    getDependenciesCount: (depOpts) => getDependenciesCount ? getDependenciesCount(id, depOpts) : Promise.resolve({ processed: 0, unprocessed: 0 }),
    moveToCompleted: (returnValue, lockToken, _fetchNext) => moveToCompleted ? moveToCompleted(id, returnValue, lockToken) : Promise.resolve(null),
    moveToFailed: (error2, lockToken, _fetchNext) => moveToFailed ? moveToFailed(id, error2, lockToken) : Promise.resolve(),
    moveToWait: (lockToken) => moveToWait ? moveToWait(id, lockToken) : Promise.resolve(false),
    moveToDelayed: (timestamp, lockToken) => moveToDelayed ? moveToDelayed(id, timestamp, lockToken) : Promise.resolve(),
    moveToWaitingChildren: (lockToken, moveOpts) => moveToWaitingChildren2 ? moveToWaitingChildren2(id, lockToken, moveOpts) : Promise.resolve(false),
    waitUntilFinished: (queueEvents, ttl) => waitUntilFinished ? waitUntilFinished(id, queueEvents, ttl) : Promise.resolve(undefined),
    discard: () => {
      if (discard)
        discard(id);
    },
    getFailedChildrenValues: () => getFailedChildrenValues ? getFailedChildrenValues(id) : Promise.resolve({}),
    getIgnoredChildrenFailures: () => getIgnoredChildrenFailures ? getIgnoredChildrenFailures(id) : Promise.resolve({}),
    removeChildDependency: () => removeChildDependency ? removeChildDependency(id) : Promise.resolve(false),
    removeDeduplicationKey: () => removeDeduplicationKey ? removeDeduplicationKey(id) : Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available")),
    removeUnprocessedChildren: () => removeUnprocessedChildren ? removeUnprocessedChildren(id) : Promise.resolve()
  };
}
function toDlqEntry(entry) {
  const jobData = entry.job.data;
  return {
    job: toPublicJob({ job: entry.job, name: jobData?.name ?? "default" }),
    enteredAt: entry.enteredAt,
    reason: entry.reason,
    error: entry.error,
    attempts: entry.attempts.map((a) => ({
      attempt: a.attempt,
      startedAt: a.startedAt,
      failedAt: a.failedAt,
      reason: a.reason,
      error: a.error,
      duration: a.duration
    })),
    retryCount: entry.retryCount,
    lastRetryAt: entry.lastRetryAt,
    nextRetryAt: entry.nextRetryAt,
    expiresAt: entry.expiresAt
  };
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/errors.js
class UnrecoverableError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnrecoverableError";
  }
}

class DelayedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DelayedError";
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/processorHandlers.js
function createProgressHandler(embedded, tcp, emitter, jobHolder) {
  return async (id, progress, message) => {
    if (embedded) {
      const manager = getSharedManager();
      await manager.updateProgress(jobId(id), progress, message);
    } else if (tcp) {
      await tcp.send({ cmd: "Progress", id, progress, message });
    }
    emitter.emit("progress", jobHolder.current, progress);
  };
}
function createLogHandler(embedded, tcp, emitter, jobHolder) {
  return async (id, message) => {
    if (embedded) {
      const manager = getSharedManager();
      manager.addLog(jobId(id), message);
    } else if (tcp) {
      await tcp.send({ cmd: "AddLog", id, message });
    }
    emitter.emit("log", jobHolder.current, message);
  };
}
function createGetStateHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return await manager.getJobState(jobId(id));
    } else if (tcp) {
      const response = await tcp.send({ cmd: "GetState", id });
      return response.state ?? "unknown";
    }
    return "unknown";
  };
}
function createGetChildrenValuesHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return manager.getChildrenValues(jobId(id));
    } else if (tcp) {
      const response = await tcp.send({ cmd: "GetChildrenValues", id });
      const data = response.data;
      return data?.values ?? {};
    }
    return {};
  };
}
function createGetFailedChildrenValuesHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return manager.getFailedChildrenValues(jobId(id));
    }
    if (!tcp)
      return {};
    const res = await tcp.send({ cmd: "GetFailedChildrenValues", id });
    return res.values ?? {};
  };
}
function createGetIgnoredChildrenFailuresHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return manager.getIgnoredChildrenFailures(jobId(id));
    }
    if (!tcp)
      return {};
    const res = await tcp.send({ cmd: "GetIgnoredChildrenFailures", id });
    return res.values ?? {};
  };
}
function createRemoveChildDependencyHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return manager.removeChildDependency(jobId(id));
    }
    if (!tcp)
      return false;
    const res = await tcp.send({ cmd: "RemoveChildDependency", id });
    return res.ok === true;
  };
}
function createRemoveUnprocessedChildrenHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      const manager = getSharedManager();
      return manager.removeUnprocessedChildren(jobId(id));
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "RemoveUnprocessedChildren", id });
  };
}
function computeStackLines(err) {
  const stackLines = err.stack ? err.stack.split(`
`).map((l) => l.trim()).filter(Boolean) : [];
  const wireStack = stackLines.length > 0 ? stackLines.slice(0, 50) : undefined;
  return { stackLines, wireStack };
}
function createMoveToFailedHandler(embedded, tcp, internalJob, token, onCalled) {
  return async (_id, error2, _lockToken) => {
    const { wireStack } = computeStackLines(error2);
    if (embedded) {
      const manager = getSharedManager();
      await manager.fail(internalJob.id, error2.message, token ?? undefined, undefined, wireStack);
    } else if (tcp) {
      await tcp.send({
        cmd: "FAIL",
        id: internalJob.id,
        error: error2.message,
        ...wireStack ? { stack: wireStack } : {},
        ...token ? { token } : {}
      });
    }
    onCalled(error2);
  };
}
function createMoveToCompletedHandler(embedded, ackBatcher, internalJob, token, onCalled) {
  return async (_id, returnValue, _lockToken) => {
    if (embedded) {
      const manager = getSharedManager();
      await manager.ack(internalJob.id, returnValue, token ?? undefined);
    } else {
      await ackBatcher.queue(String(internalJob.id), returnValue, token ?? undefined);
    }
    onCalled(returnValue);
    return null;
  };
}
function createRemoveHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      await getSharedManager().cancel(jobId(id));
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "Cancel", id });
  };
}
function createRetryHandler(embedded, tcp, internalJob) {
  return async (id) => {
    if (embedded) {
      const mgr = getSharedManager();
      const state = await mgr.getJobState(jobId(id));
      if (state === "failed") {
        const count = mgr.retryDlq(internalJob.queue, jobId(id));
        if (count === 0)
          throw new Error(`Job ${id} is failed but not present in DLQ`);
        return;
      }
      if (state === "active") {
        const ok = await mgr.moveActiveToWait(jobId(id));
        if (!ok)
          throw new Error(`Failed to retry active job ${id}`);
        return;
      }
      if (state === "waiting" || state === "prioritized" || state === "delayed")
        return;
      throw new Error(`Cannot retry job ${id} from state '${state}'`);
    }
    if (!tcp)
      return;
    const res = await tcp.send({ cmd: "MoveToWait", id });
    if (res.ok !== true) {
      const err = typeof res.error === "string" ? res.error : "retry failed";
      throw new Error(err);
    }
  };
}
function createUpdateDataHandler(embedded, tcp) {
  return async (id, data) => {
    if (embedded) {
      await getSharedManager().updateJobData(jobId(id), data);
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "Update", id, data });
  };
}
function createPromoteHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      await getSharedManager().promote(jobId(id));
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "Promote", id });
  };
}
function createChangeDelayHandler(embedded, tcp) {
  return async (id, delay) => {
    if (embedded) {
      await getSharedManager().changeDelay(jobId(id), delay);
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "ChangeDelay", id, delay });
  };
}
function createChangePriorityHandler(embedded, tcp) {
  return async (id, opts) => {
    if (embedded) {
      await getSharedManager().changePriority(jobId(id), opts.priority, opts.lifo);
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "ChangePriority", id, priority: opts.priority, lifo: opts.lifo });
  };
}
function createExtendLockHandler(embedded, tcp) {
  return async (id, token, duration) => {
    if (embedded) {
      const ok = await getSharedManager().extendLock(jobId(id), token, duration);
      return ok ? duration : 0;
    }
    if (!tcp)
      return 0;
    const res = await tcp.send({ cmd: "ExtendLock", id, token, duration });
    return res.ok === true ? duration : 0;
  };
}
function createClearLogsHandler(embedded, tcp) {
  return async (id, keepLogs) => {
    if (embedded) {
      getSharedManager().clearLogs(jobId(id), keepLogs);
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "ClearLogs", id, keepLogs });
  };
}
function createMoveToWaitHandler(embedded, tcp) {
  return async (id, _token) => {
    if (embedded) {
      return await getSharedManager().moveActiveToWait(jobId(id));
    }
    if (!tcp)
      return false;
    const res = await tcp.send({ cmd: "MoveToWait", id });
    return res.ok === true;
  };
}
function createMoveToDelayedHandler(embedded, tcp) {
  return async (id, timestamp, _token) => {
    const delay = Math.max(0, timestamp - Date.now());
    if (embedded) {
      await getSharedManager().moveToDelayed(jobId(id), delay);
      return;
    }
    if (!tcp)
      return;
    await tcp.send({ cmd: "MoveToDelayed", id, delay });
  };
}
function createMoveToWaitingChildrenHandler(embedded, tcp) {
  return async (id) => {
    if (embedded) {
      return await getSharedManager().moveToWaitingChildren(jobId(id));
    }
    if (!tcp)
      return false;
    throw new Error("moveToWaitingChildren is not supported in TCP mode \u2014 no server command available");
  };
}
function createWaitUntilFinishedHandler(embedded, tcp) {
  return async (id, _queueEvents, ttl) => {
    const timeout = ttl ?? 30000;
    if (embedded) {
      const manager = getSharedManager();
      const job = await manager.getJob(jobId(id));
      if (!job)
        throw new Error(`Job ${id} not found`);
      if (job.completedAt)
        return manager.getResult(jobId(id));
      const completed = await manager.waitForJobCompletion(jobId(id), timeout);
      if (!completed)
        throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
      return manager.getResult(jobId(id));
    }
    if (!tcp)
      throw new Error("waitUntilFinished: no connection");
    const res = await tcp.send({ cmd: "WaitJob", id, timeout });
    const typed = res;
    if (!typed.completed)
      throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
    return typed.result;
  };
}
function createDiscardHandler(embedded, tcp) {
  return (id) => {
    if (embedded) {
      getSharedManager().discard(jobId(id));
      return;
    }
    if (!tcp)
      return;
    tcp.send({ cmd: "Discard", id });
  };
}
function createGetDependenciesHandler(embedded, tcp, internalJob) {
  return async () => {
    const childIds = internalJob.childrenIds;
    const processed = {};
    const unprocessed = [];
    for (const cid of childIds) {
      let state = "unknown";
      let result;
      if (embedded) {
        const mgr = getSharedManager();
        state = await mgr.getJobState(cid);
        if (state === "completed")
          result = mgr.getResult(cid);
      } else if (tcp) {
        const r = await tcp.send({ cmd: "GetState", id: String(cid) });
        state = r.state ?? "unknown";
        if (state === "completed") {
          const rr = await tcp.send({ cmd: "GetResult", id: String(cid) });
          result = rr.result;
        }
      }
      const key = `${internalJob.queue}:${String(cid)}`;
      if (state === "completed" || state === "failed") {
        processed[key] = result ?? null;
      } else {
        unprocessed.push(key);
      }
    }
    return { processed, unprocessed };
  };
}
function createGetDependenciesCountHandler(embedded, tcp, internalJob) {
  const getDeps = createGetDependenciesHandler(embedded, tcp, internalJob);
  return async (id) => {
    const deps = await getDeps(id);
    return {
      processed: Object.keys(deps.processed).length,
      unprocessed: deps.unprocessed.length
    };
  };
}
function createRemoveDeduplicationKeyHandler() {
  return () => Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available"));
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/processor.js
async function processJob(internalJob, config) {
  const { processor, embedded, tcp, ackBatcher, emitter, token } = config;
  const jobData = internalJob.data;
  const jobName = jobData?.name ?? "default";
  const jobIdStr = String(internalJob.id);
  const jobHolder = { current: null };
  const manualMove = { result: null };
  const moveToFailedHandler = createMoveToFailedHandler(embedded, tcp, internalJob, token, (error2) => {
    manualMove.result = { type: "failed", error: error2 };
  });
  const moveToCompletedHandler = createMoveToCompletedHandler(embedded, ackBatcher, internalJob, token, (value) => {
    manualMove.result = { type: "completed", value };
  });
  const job = createPublicJob({
    job: internalJob,
    name: jobName,
    updateProgress: createProgressHandler(embedded, tcp, emitter, jobHolder),
    log: createLogHandler(embedded, tcp, emitter, jobHolder),
    getState: createGetStateHandler(embedded, tcp),
    getChildrenValues: createGetChildrenValuesHandler(embedded, tcp),
    getFailedChildrenValues: createGetFailedChildrenValuesHandler(embedded, tcp),
    getIgnoredChildrenFailures: createGetIgnoredChildrenFailuresHandler(embedded, tcp),
    removeChildDependency: createRemoveChildDependencyHandler(embedded, tcp),
    removeUnprocessedChildren: createRemoveUnprocessedChildrenHandler(embedded, tcp),
    moveToFailed: moveToFailedHandler,
    moveToCompleted: moveToCompletedHandler,
    remove: createRemoveHandler(embedded, tcp),
    retry: createRetryHandler(embedded, tcp, internalJob),
    updateData: createUpdateDataHandler(embedded, tcp),
    promote: createPromoteHandler(embedded, tcp),
    changeDelay: createChangeDelayHandler(embedded, tcp),
    changePriority: createChangePriorityHandler(embedded, tcp),
    extendLock: createExtendLockHandler(embedded, tcp),
    clearLogs: createClearLogsHandler(embedded, tcp),
    moveToWait: createMoveToWaitHandler(embedded, tcp),
    moveToDelayed: createMoveToDelayedHandler(embedded, tcp),
    moveToWaitingChildren: createMoveToWaitingChildrenHandler(embedded, tcp),
    waitUntilFinished: createWaitUntilFinishedHandler(embedded, tcp),
    discard: createDiscardHandler(embedded, tcp),
    getDependencies: createGetDependenciesHandler(embedded, tcp, internalJob),
    getDependenciesCount: createGetDependenciesCountHandler(embedded, tcp, internalJob),
    removeDeduplicationKey: createRemoveDeduplicationKeyHandler(),
    token: token ?? undefined
  });
  jobHolder.current = job;
  emitter.emit("active", job);
  try {
    const result = await processor(job);
    if (handleManualMove(manualMove, job, config, internalJob))
      return;
    try {
      if (embedded) {
        const manager = getSharedManager();
        await manager.ack(internalJob.id, result, token ?? undefined);
      } else {
        await ackBatcher.queue(jobIdStr, result, token ?? undefined);
      }
    } catch (ackErr) {
      const ackError = ackErr instanceof Error ? ackErr : new Error(String(ackErr));
      if (isJobNotFoundError(ackError)) {
        emitter.emit("error", Object.assign(ackError, { context: "ack-stale", jobId: jobIdStr }));
        return;
      }
      throw ackErr;
    }
    job.returnvalue = result;
    config.onOutcome?.(true);
    emitter.emit("completed", job, result);
  } catch (error2) {
    if (handleManualMove(manualMove, job, config, internalJob))
      return;
    await handleJobFailure(internalJob, error2, config, { job, jobIdStr, token });
  }
}
function handleManualMove(manualMove, job, config, internalJob) {
  if (manualMove.result?.type === "failed") {
    const err = manualMove.result.error ?? new Error("Job manually moved to failed");
    job.failedReason = err.message;
    if (err.stack) {
      const { stackLines } = computeStackLines(err);
      job.stacktrace = stackLines.slice(0, internalJob.stackTraceLimit);
    }
    config.onOutcome?.(false);
    config.emitter.emit("failed", job, err);
    return true;
  }
  if (manualMove.result?.type === "completed") {
    job.returnvalue = manualMove.result.value;
    config.onOutcome?.(true);
    config.emitter.emit("completed", job, manualMove.result.value);
    return true;
  }
  return false;
}
function isJobNotFoundError(err) {
  return err.message.includes("not found") || err.message.includes("not in processing");
}
async function handleDelayedError(internalJob, config, context) {
  const { embedded, tcp, emitter } = config;
  try {
    if (embedded) {
      const manager = getSharedManager();
      await manager.moveToDelayed(internalJob.id, internalJob.backoff || 1000);
    } else if (tcp) {
      await tcp.send({
        cmd: "MoveToDelayed",
        id: internalJob.id,
        delay: internalJob.backoff || 1000,
        ...context.token ? { token: context.token } : {}
      });
    }
  } catch (delayError) {
    const wrappedError = delayError instanceof Error ? delayError : new Error(String(delayError));
    if (!isJobNotFoundError(wrappedError)) {
      emitter.emit("error", Object.assign(wrappedError, { context: "delay", jobId: context.jobIdStr }));
    }
  }
}
async function handleJobFailure(internalJob, error2, config, context) {
  const { embedded, tcp, emitter } = config;
  const { job, jobIdStr, token } = context;
  const err = error2 instanceof Error ? error2 : new Error(String(error2));
  if (err instanceof DelayedError) {
    await handleDelayedError(internalJob, config, { jobIdStr, token });
    return;
  }
  if (err instanceof UnrecoverableError) {
    internalJob.maxAttempts = 1;
    internalJob.attempts = 0;
  }
  const { stackLines, wireStack } = computeStackLines(err);
  try {
    if (embedded) {
      const manager = getSharedManager();
      await manager.fail(internalJob.id, err.message, token ?? undefined, undefined, wireStack);
    } else if (tcp) {
      await tcp.send({
        cmd: "FAIL",
        id: internalJob.id,
        error: err.message,
        ...wireStack ? { stack: wireStack } : {},
        ...token ? { token } : {},
        ...err instanceof UnrecoverableError ? { unrecoverable: true } : {}
      });
    }
  } catch (failError) {
    const wrappedError = failError instanceof Error ? failError : new Error(String(failError));
    if (isJobNotFoundError(wrappedError)) {
      return;
    }
    emitter.emit("error", Object.assign(wrappedError, { context: "fail", jobId: jobIdStr }));
  }
  job.failedReason = err.message;
  if (err.stack) {
    const limit = internalJob.stackTraceLimit;
    job.stacktrace = stackLines.slice(0, limit);
  }
  config.onOutcome?.(false);
  emitter.emit("failed", job, err);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/workerRateLimiter.js
class WorkerRateLimiter {
  limiter;
  limiterTokens = [];
  head = 0;
  rateLimitExpiration = 0;
  constructor(limiter) {
    this.limiter = limiter;
  }
  canProcessWithinLimit() {
    if (!this.limiter)
      return true;
    const windowStart = Date.now() - this.limiter.duration;
    this.evictExpired(windowStart);
    return this.activeCount() < this.limiter.max;
  }
  recordJobForLimiter() {
    if (!this.limiter)
      return;
    this.limiterTokens.push(Date.now());
  }
  getTimeUntilNextSlot() {
    if (!this.limiter)
      return 0;
    const now = Date.now();
    const windowStart = now - this.limiter.duration;
    this.evictExpired(windowStart);
    if (this.activeCount() < this.limiter.max) {
      return 0;
    }
    const oldestToken = this.limiterTokens[this.head];
    return oldestToken + this.limiter.duration - now;
  }
  getRateLimiterInfo() {
    if (!this.limiter)
      return null;
    const windowStart = Date.now() - this.limiter.duration;
    this.evictExpired(windowStart);
    return {
      current: this.activeCount(),
      max: this.limiter.max,
      duration: this.limiter.duration
    };
  }
  rateLimit(expireTimeMs) {
    if (expireTimeMs <= 0)
      return;
    if (this.limiter) {
      const now = Date.now();
      for (let i = 0;i < this.limiter.max; i++) {
        this.limiterTokens.push(now + expireTimeMs - this.limiter.duration);
      }
    }
    this.rateLimitExpiration = Date.now() + expireTimeMs;
  }
  isRateLimited() {
    return Date.now() < this.rateLimitExpiration;
  }
  activeCount() {
    return this.limiterTokens.length - this.head;
  }
  evictExpired(windowStart) {
    while (this.head < this.limiterTokens.length && this.limiterTokens[this.head] <= windowStart) {
      this.head++;
    }
    if (this.head > 0 && this.head > this.limiterTokens.length / 2) {
      this.limiterTokens = this.limiterTokens.slice(this.head);
      this.head = 0;
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/groupConcurrency.js
class GroupConcurrencyLimiter {
  groupKey;
  maxPerGroup;
  activeByGroup = new Map;
  constructor(groupKey, max) {
    this.groupKey = groupKey;
    this.maxPerGroup = max;
  }
  static fromOptions(limiter) {
    if (!limiter?.groupKey)
      return null;
    return new GroupConcurrencyLimiter(limiter.groupKey, limiter.max);
  }
  getGroupValue(job) {
    const data = job.data;
    if (!data || typeof data !== "object")
      return null;
    const value = data[this.groupKey];
    if (value === undefined || value === null)
      return null;
    return typeof value === "string" ? value : `${value}`;
  }
  canProcess(job) {
    const group = this.getGroupValue(job);
    if (group === null)
      return true;
    const current = this.activeByGroup.get(group) ?? 0;
    return current < this.maxPerGroup;
  }
  increment(job) {
    const group = this.getGroupValue(job);
    if (group === null)
      return;
    const current = this.activeByGroup.get(group) ?? 0;
    this.activeByGroup.set(group, current + 1);
  }
  decrement(job) {
    const group = this.getGroupValue(job);
    if (group === null)
      return;
    const current = this.activeByGroup.get(group) ?? 0;
    if (current <= 1) {
      this.activeByGroup.delete(group);
    } else {
      this.activeByGroup.set(group, current - 1);
    }
  }
  getGroupCount(group) {
    return this.activeByGroup.get(group) ?? 0;
  }
  getMax() {
    return this.maxPerGroup;
  }
  getGroupKey() {
    return this.groupKey;
  }
  clear() {
    this.activeByGroup.clear();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/workerHeartbeat.js
function startHeartbeat(deps, intervalMs) {
  return setInterval(() => void sendHeartbeat(deps), intervalMs);
}
async function sendHeartbeat(deps) {
  if (deps.pulledJobIds.size === 0 || !deps.tcp)
    return;
  try {
    const ids = Array.from(deps.pulledJobIds);
    if (ids.length === 0)
      return;
    if (deps.useLocks) {
      const tokens = ids.map((id) => deps.jobTokens.get(id) ?? "");
      if (ids.length === 1) {
        await deps.tcp.send({ cmd: "JobHeartbeat", id: ids[0], token: tokens[0] || undefined });
      } else {
        await deps.tcp.send({ cmd: "JobHeartbeatB", ids, tokens });
      }
    } else {
      if (ids.length === 1) {
        await deps.tcp.send({ cmd: "JobHeartbeat", id: ids[0] });
      } else {
        await deps.tcp.send({ cmd: "JobHeartbeatB", ids });
      }
    }
  } catch (err) {
    const error2 = err instanceof Error ? err : new Error(String(err));
    deps.emitter.emit("error", Object.assign(error2, { context: "heartbeat" }));
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/workerPull.js
async function pullEmbedded(config, count) {
  const manager = getSharedManager();
  if (config.useLocks) {
    if (count === 1) {
      const { job, token } = await manager.pullWithLock(config.name, config.workerId, 0, config.lockDuration);
      return job ? [{ job, token }] : [];
    }
    const { jobs: jobs2, tokens } = await manager.pullBatchWithLock(config.name, count, config.workerId, 0, config.lockDuration);
    return jobs2.map((job, i) => ({ job, token: tokens[i] || null }));
  }
  if (count === 1) {
    const job = await manager.pull(config.name, 0);
    return job ? [{ job, token: null }] : [];
  }
  const jobs = await manager.pullBatch(config.name, count, 0);
  return jobs.map((job) => ({ job, token: null }));
}
async function pullTcp(config, tcp, count, closing) {
  if (closing)
    return [];
  const cmd = {
    cmd: count === 1 ? "PULL" : "PULLB",
    queue: config.name,
    timeout: config.pollTimeout
  };
  if (count > 1)
    cmd.count = count;
  if (config.useLocks) {
    cmd.owner = config.workerId;
    if (config.lockDuration !== undefined)
      cmd.lockTtl = config.lockDuration;
  }
  const response = await tcp.send(cmd);
  if (!response.ok)
    return [];
  if (count === 1) {
    const job = response.job;
    const token = config.useLocks ? response.token ?? null : null;
    if (job) {
      return [{ job: parseJobFromResponse(job, config.name), token }];
    }
    return [];
  }
  const jobs = response.jobs;
  const tokens = config.useLocks ? response.tokens ?? [] : [];
  return jobs?.map((j, i) => ({
    job: parseJobFromResponse(j, config.name),
    token: tokens[i] || null
  })) ?? [];
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/resolveToken.js
function resolveToken(explicitToken) {
  if (explicitToken)
    return explicitToken;
  const bqToken = Bun.env.BQ_TOKEN;
  if (bqToken)
    return bqToken;
  const bunqueueToken = Bun.env.BUNQUEUE_TOKEN;
  if (bunqueueToken)
    return bunqueueToken;
  return;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/worker/worker.js
function resolveWorkerOptions(opts, embedded) {
  return {
    concurrency: opts.concurrency ?? 1,
    autorun: opts.autorun ?? true,
    heartbeatInterval: opts.heartbeatInterval ?? 1e4,
    batchSize: Math.min(opts.batchSize ?? 10, 1000),
    pollTimeout: Math.min(opts.pollTimeout ?? 0, WORKER_CONSTANTS.MAX_POLL_TIMEOUT),
    embedded,
    useLocks: opts.useLocks ?? true,
    skipLockRenewal: opts.skipLockRenewal ?? false,
    skipStalledCheck: opts.skipStalledCheck ?? false,
    drainDelay: opts.drainDelay ?? 50,
    lockDuration: opts.lockDuration ?? 30000,
    maxStalledCount: opts.maxStalledCount ?? 1,
    removeOnComplete: opts.removeOnComplete,
    removeOnFail: opts.removeOnFail
  };
}
function createTcpPool(opts, concurrency) {
  const connOpts = opts.connection ?? {};
  const poolSize = connOpts.poolSize ?? Math.min(concurrency, 8);
  const token = resolveToken(connOpts.token);
  return new TcpConnectionPool({
    host: connOpts.host ?? "localhost",
    port: connOpts.port ?? 6789,
    token,
    tls: connOpts.tls,
    poolSize,
    pingInterval: connOpts.pingInterval,
    commandTimeout: connOpts.commandTimeout,
    maxCommandTimeouts: connOpts.maxCommandTimeouts,
    pipelining: connOpts.pipelining,
    maxInFlight: connOpts.maxInFlight
  });
}

class Worker2 extends EventEmitter3 {
  name;
  queueKey;
  opts;
  processor;
  embedded;
  tcp;
  tcpPool;
  ackBatcher;
  rateLimiter;
  groupLimiter;
  running = false;
  paused = false;
  _closing = false;
  _forceClose = false;
  _closingPromise = null;
  closed = false;
  activeJobs = 0;
  pollTimer = null;
  consecutiveErrors = 0;
  activeJobIds = new Set;
  pulledJobIds = new Set;
  jobTokens = new Map;
  cancelledJobs = new Set;
  heartbeatTimer = null;
  workerHeartbeatTimer = null;
  processedCount = 0;
  failedCount = 0;
  startedAt;
  registered = false;
  workerId;
  pendingJobs = [];
  pendingJobsHead = 0;
  processingScheduled = false;
  pendingPull = 0;
  lastDrainedEmit = 0;
  stalledUnsubscribe = null;
  on(event, listener) {
    return super.on(event, listener);
  }
  once(event, listener) {
    return super.once(event, listener);
  }
  off(event, listener) {
    return super.off(event, listener);
  }
  constructor(name, processor, opts = {}) {
    super();
    this.name = name;
    this.queueKey = (opts.prefixKey ?? "") + name;
    this.processor = processor;
    this.embedded = opts.embedded ?? FORCE_EMBEDDED2;
    this.startedAt = Date.now();
    this.workerId = `worker-${this.queueKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.opts = resolveWorkerOptions(opts, this.embedded);
    this.rateLimiter = new WorkerRateLimiter(opts.limiter?.groupKey ? null : opts.limiter ?? null);
    this.groupLimiter = GroupConcurrencyLimiter.fromOptions(opts.limiter);
    this.ackBatcher = new AckBatcher({
      batchSize: opts.batchSize ?? 10,
      interval: WORKER_CONSTANTS.DEFAULT_ACK_INTERVAL,
      embedded: this.embedded
    });
    if (this.embedded) {
      getSharedManager(opts.dataPath);
      this.tcp = null;
      this.tcpPool = null;
    } else {
      this.tcpPool = createTcpPool(opts, this.opts.concurrency);
      this.tcp = this.tcpPool;
      this.ackBatcher.setTcp(this.tcp);
      this.tcpPool.onReconnect(() => {
        if (this.closed || this._closing || !this.registered)
          return;
        this.registered = false;
        this.registerWithServer();
      });
    }
    if (this.opts.autorun)
      this.run();
  }
  run() {
    if (this.running || this.closed)
      return;
    this.running = true;
    this.paused = false;
    this._closing = false;
    this._forceClose = false;
    this._closingPromise = null;
    queueMicrotask(() => {
      if (!this.closed)
        this.emit("ready");
    });
    if (this.embedded && !this.stalledUnsubscribe && !this.opts.skipStalledCheck) {
      this.subscribeToStalledEvents();
    }
    if (!this.embedded && this.tcp && !this.registered) {
      this.registerWithServer();
    }
    if (this.opts.heartbeatInterval > 0 && !this.opts.skipLockRenewal) {
      if (this.embedded) {
        this.heartbeatTimer = setInterval(() => {
          const manager = getSharedManager();
          for (const id of this.pulledJobIds) {
            manager.jobHeartbeat(jobId(id));
          }
        }, this.opts.heartbeatInterval);
      } else {
        const deps = this.getHeartbeatDeps();
        this.heartbeatTimer = startHeartbeat(deps, this.opts.heartbeatInterval);
        this.startWorkerHeartbeat();
      }
    }
    this.poll();
  }
  subscribeToStalledEvents() {
    if (!this.embedded)
      return;
    const manager = getSharedManager();
    this.stalledUnsubscribe = manager.subscribe((event) => {
      if (event.queue !== this.queueKey)
        return;
      if (event.eventType === "stalled") {
        this.emit("stalled", event.jobId, "active");
      }
    });
  }
  pause() {
    if (!this.running)
      return;
    this.running = false;
    this.paused = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
  resume() {
    if (this.closed)
      return;
    this.paused = false;
    this.run();
  }
  isRunning() {
    return this.running;
  }
  isPaused() {
    return this.paused && !this.closed;
  }
  isClosed() {
    return this.closed;
  }
  get concurrency() {
    return this.opts.concurrency;
  }
  set concurrency(val) {
    const clamped = Math.max(1, val);
    const prev = this.opts.concurrency;
    this.opts.concurrency = clamped;
    if (clamped > prev && this.running && !this._closing) {
      this.poll();
    }
  }
  get closing() {
    return this._closingPromise;
  }
  async waitUntilReady() {
    if (this.embedded)
      return;
    if (this.tcpPool) {
      await this.tcpPool.send({ cmd: "Ping" });
    }
  }
  cancelJob(jobId2, reason) {
    if (this.activeJobIds.has(jobId2)) {
      this.cancelledJobs.add(jobId2);
      this.emit("cancelled", { jobId: jobId2, reason: reason ?? "Job cancelled by worker" });
      return true;
    }
    return false;
  }
  cancelAllJobs(reason) {
    for (const jobId2 of this.activeJobIds) {
      this.cancelledJobs.add(jobId2);
      this.emit("cancelled", { jobId: jobId2, reason: reason ?? "All jobs cancelled" });
    }
  }
  isJobCancelled(jobId2) {
    return this.cancelledJobs.has(jobId2);
  }
  getRateLimiterInfo() {
    return this.rateLimiter.getRateLimiterInfo();
  }
  rateLimit(expireTimeMs) {
    this.rateLimiter.rateLimit(expireTimeMs);
  }
  isRateLimited() {
    return this.rateLimiter.isRateLimited();
  }
  async startStalledCheckTimer() {}
  async delay(milliseconds = 0, abortController) {
    if (milliseconds <= 0)
      return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, milliseconds);
      if (abortController) {
        abortController.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Delay aborted"));
        });
      }
    });
  }
  async getNextJob(token, _opts) {
    if (this.closed)
      return;
    if (this.embedded) {
      const manager = getSharedManager();
      if (this.opts.useLocks) {
        const { job: job3, token: lockToken } = await manager.pullWithLock(this.queueKey, this.workerId, 0);
        if (job3 && lockToken) {
          const jobIdStr2 = String(job3.id);
          this.pulledJobIds.add(jobIdStr2);
          this.jobTokens.set(jobIdStr2, lockToken);
        }
        return job3 ?? undefined;
      }
      const job2 = await manager.pull(this.queueKey, 0);
      if (job2) {
        this.pulledJobIds.add(String(job2.id));
      }
      return job2 ?? undefined;
    }
    if (!this.tcp)
      return;
    const cmd = {
      cmd: "PULL",
      queue: this.queueKey,
      timeout: 0
    };
    if (this.opts.useLocks) {
      cmd.owner = this.workerId;
      if (token)
        cmd.token = token;
    }
    const response = await this.tcp.send(cmd);
    if (!response.ok || !response.job)
      return;
    const job = parseJobFromResponse(response.job, this.queueKey);
    const jobIdStr = String(job.id);
    this.pulledJobIds.add(jobIdStr);
    if (this.opts.useLocks && response.token) {
      this.jobTokens.set(jobIdStr, response.token);
    }
    return job;
  }
  async processJobManually(job, token, fetchNextCallback) {
    if (this.closed)
      return;
    const jobIdStr = String(job.id);
    this.activeJobs++;
    this.activeJobIds.add(jobIdStr);
    this.pulledJobIds.add(jobIdStr);
    if (this.opts.useLocks && token) {
      this.jobTokens.set(jobIdStr, token);
    }
    try {
      await processJob(job, {
        name: this.queueKey,
        processor: this.processor,
        embedded: this.embedded,
        tcp: this.tcp,
        ackBatcher: this.ackBatcher,
        emitter: this,
        token: this.opts.useLocks ? token : undefined
      });
      if (fetchNextCallback) {
        return await fetchNextCallback();
      }
    } finally {
      this.activeJobs--;
      this.activeJobIds.delete(jobIdStr);
      this.pulledJobIds.delete(jobIdStr);
      this.cancelledJobs.delete(jobIdStr);
      if (this.opts.useLocks) {
        this.jobTokens.delete(jobIdStr);
      }
      this.rateLimiter.recordJobForLimiter();
    }
  }
  async extendJobLocks(jobIds, tokens, duration) {
    if (this.closed || jobIds.length === 0)
      return 0;
    if (jobIds.length !== tokens.length) {
      throw new Error("jobIds and tokens arrays must have the same length");
    }
    if (this.embedded) {
      const manager = getSharedManager();
      let extended2 = 0;
      for (let i = 0;i < jobIds.length; i++) {
        const success = await manager.extendLock(jobIds[i], tokens[i], duration);
        if (success)
          extended2++;
      }
      return extended2;
    }
    if (!this.tcp)
      return 0;
    const response = await this.tcp.send({
      cmd: "ExtendLocks",
      ids: jobIds,
      tokens,
      durations: jobIds.map(() => duration)
    });
    const extended = response.count;
    return extended ?? 0;
  }
  async close(force = false) {
    if (this.closed)
      return;
    if (this._closingPromise) {
      if (force)
        this._forceClose = true;
      return this._closingPromise;
    }
    this._forceClose = force;
    this._closingPromise = this._doClose(force);
    return this._closingPromise;
  }
  async _doClose(force) {
    this._closing = true;
    this.running = false;
    this.paused = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.workerHeartbeatTimer) {
      clearInterval(this.workerHeartbeatTimer);
      this.workerHeartbeatTimer = null;
    }
    await this.releaseBufferedJobs();
    if (!force) {
      while (this.activeJobs > 0 && !this._forceClose) {
        await Bun.sleep(50);
      }
    }
    await this.ackBatcher.flush();
    await this.ackBatcher.waitForInFlight();
    this.ackBatcher.stop();
    if (!this.embedded && this.tcp && this.registered) {
      try {
        await this.tcp.send({ cmd: "UnregisterWorker", workerId: this.workerId });
      } catch {}
      this.registered = false;
    }
    await Bun.sleep(100);
    if (this.stalledUnsubscribe) {
      this.stalledUnsubscribe();
      this.stalledUnsubscribe = null;
    }
    this.activeJobIds.clear();
    this.pulledJobIds.clear();
    this.jobTokens.clear();
    this.cancelledJobs.clear();
    this.pendingJobs = [];
    this.pendingJobsHead = 0;
    if (this.groupLimiter)
      this.groupLimiter.clear();
    if (this.tcpPool)
      this.tcpPool.close();
    this.closed = true;
    this._closing = false;
    this.emit("closed");
  }
  async releaseBufferedJobs() {
    const buffered = this.pendingJobs.slice(this.pendingJobsHead);
    this.pendingJobs = [];
    this.pendingJobsHead = 0;
    if (buffered.length === 0)
      return;
    for (const { job, token } of buffered) {
      const id = String(job.id);
      try {
        if (this.embedded) {
          const manager = getSharedManager();
          await manager.moveActiveToWait(jobId(id));
          if (this.opts.useLocks)
            manager.releaseLock(jobId(id), token ?? undefined);
        } else if (this.tcp) {
          await this.tcp.send({ cmd: "MoveToWait", id });
        }
      } catch {} finally {
        this.pulledJobIds.delete(id);
        this.jobTokens.delete(id);
      }
    }
  }
  poll() {
    if (!this.running || this._closing)
      return;
    if (this.activeJobs >= this.opts.concurrency) {
      this.pollTimer = setTimeout(() => {
        this.poll();
      }, 10);
      return;
    }
    if (!this.rateLimiter.canProcessWithinLimit()) {
      const waitTime = this.rateLimiter.getTimeUntilNextSlot();
      this.pollTimer = setTimeout(() => {
        this.poll();
      }, Math.max(waitTime, 10));
      return;
    }
    this.tryProcess();
  }
  async tryProcess() {
    if (!this.running || this._closing)
      return;
    try {
      let item = this.getNextEligibleJob();
      if (!item) {
        const items = await this.doPullBatch();
        if (!this.running || this._closing)
          return;
        if (items.length > 0) {
          this.registerPulledJobs(items);
          if (this.pendingJobsHead >= this.pendingJobs.length) {
            this.pendingJobs = items;
            this.pendingJobsHead = 0;
          } else {
            this.pendingJobs = this.pendingJobs.slice(this.pendingJobsHead).concat(items);
            this.pendingJobsHead = 0;
          }
          item = this.getNextEligibleJob();
        }
      }
      if (item) {
        if (this.activeJobs >= this.opts.concurrency) {
          this.requeueItem(item);
          this.pollTimer = setTimeout(() => {
            this.poll();
          }, 10);
          return;
        }
        this.consecutiveErrors = 0;
        this.startJob(item.job, item.token);
      } else {
        const hasBuffered = this.pendingJobsHead < this.pendingJobs.length;
        if (hasBuffered && this.groupLimiter) {
          this.pollTimer = setTimeout(() => {
            this.poll();
          }, 10);
          return;
        }
        const now = Date.now();
        if (now - this.lastDrainedEmit > 1000) {
          this.lastDrainedEmit = now;
          this.emit("drained");
        }
        const waitTime = this.opts.pollTimeout > 0 ? 10 : this.opts.drainDelay;
        this.pollTimer = setTimeout(() => {
          this.poll();
        }, waitTime);
      }
    } catch (err) {
      if (!this.running)
        return;
      this.handlePullError(err);
    }
  }
  registerPulledJobs(items) {
    for (const pulledItem of items) {
      const jobIdStr = String(pulledItem.job.id);
      this.pulledJobIds.add(jobIdStr);
      if (this.opts.useLocks && pulledItem.token) {
        this.jobTokens.set(jobIdStr, pulledItem.token);
      }
    }
    if (this.opts.useLocks && items.length > 0 && this.tcpPool && this.tcpPool.getPoolSize() > 1) {
      sendHeartbeat(this.getHeartbeatDeps());
    }
  }
  getBufferedJob() {
    if (this.pendingJobsHead >= this.pendingJobs.length)
      return null;
    const item = this.pendingJobs[this.pendingJobsHead++];
    if (this.pendingJobsHead > 500 && this.pendingJobsHead >= this.pendingJobs.length / 2) {
      this.pendingJobs = this.pendingJobs.slice(this.pendingJobsHead);
      this.pendingJobsHead = 0;
    }
    return item;
  }
  requeueItem(item) {
    if (this.pendingJobsHead > 0) {
      this.pendingJobs[--this.pendingJobsHead] = item;
    } else {
      this.pendingJobs.unshift(item);
    }
  }
  getNextEligibleJob() {
    if (this.pendingJobsHead >= this.pendingJobs.length)
      return null;
    if (!this.groupLimiter) {
      return this.getBufferedJob();
    }
    const start = this.pendingJobsHead;
    const end = this.pendingJobs.length;
    for (let i = start;i < end; i++) {
      const item = this.pendingJobs[i];
      if (this.groupLimiter.canProcess(item.job)) {
        this.pendingJobs[i] = this.pendingJobs[this.pendingJobsHead];
        this.pendingJobsHead++;
        if (this.pendingJobsHead > 500 && this.pendingJobsHead >= this.pendingJobs.length / 2) {
          this.pendingJobs = this.pendingJobs.slice(this.pendingJobsHead);
          this.pendingJobsHead = 0;
        }
        return item;
      }
    }
    return null;
  }
  async doPullBatch() {
    const groupBlockedBuffer = this.groupLimiter !== null && this.pendingJobsHead < this.pendingJobs.length;
    const leased = groupBlockedBuffer ? this.activeJobs : this.pulledJobIds.size;
    const slots = this.opts.concurrency - leased - this.pendingPull;
    const batchSize = Math.min(this.opts.batchSize, slots, 1000);
    if (batchSize <= 0)
      return [];
    const config = this.getPullConfig();
    this.pendingPull += batchSize;
    try {
      return this.embedded ? await pullEmbedded(config, batchSize) : await pullTcp(config, this.tcp, batchSize, this._closing);
    } finally {
      this.pendingPull -= batchSize;
    }
  }
  startJob(job, token) {
    const jobIdStr = String(job.id);
    if (this.activeJobIds.has(jobIdStr)) {
      return;
    }
    this.activeJobs++;
    this.activeJobIds.add(jobIdStr);
    this.applyRemoveDefaults(job);
    if (this.groupLimiter) {
      this.groupLimiter.increment(job);
    }
    if (this.opts.useLocks && token && !this.jobTokens.has(jobIdStr)) {
      this.jobTokens.set(jobIdStr, token);
    }
    this.pulledJobIds.add(jobIdStr);
    const tokenForProcess = this.opts.useLocks ? token : undefined;
    processJob(job, {
      name: this.queueKey,
      processor: this.processor,
      embedded: this.embedded,
      tcp: this.tcp,
      ackBatcher: this.ackBatcher,
      emitter: this,
      token: tokenForProcess,
      onOutcome: (ok) => {
        if (ok)
          this.processedCount++;
        else
          this.failedCount++;
      }
    }).finally(() => {
      this.activeJobs--;
      this.activeJobIds.delete(jobIdStr);
      this.pulledJobIds.delete(jobIdStr);
      this.cancelledJobs.delete(jobIdStr);
      if (this.opts.useLocks) {
        this.jobTokens.delete(jobIdStr);
      }
      if (this.groupLimiter) {
        this.groupLimiter.decrement(job);
      }
      this.rateLimiter.recordJobForLimiter();
      if (this.running && !this._closing)
        this.poll();
    });
    if (this.activeJobs < this.opts.concurrency && !this._closing && !this.processingScheduled) {
      this.processingScheduled = true;
      setImmediate(() => {
        this.processingScheduled = false;
        this.tryProcess();
      });
    }
  }
  handlePullError(err) {
    this.consecutiveErrors++;
    const error2 = err instanceof Error ? err : new Error(String(err));
    this.emit("error", Object.assign(error2, {
      queue: this.name,
      consecutiveErrors: this.consecutiveErrors,
      context: "pull"
    }));
    const backoffMs = Math.min(WORKER_CONSTANTS.BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1), WORKER_CONSTANTS.MAX_BACKOFF_MS);
    this.pollTimer = setTimeout(() => {
      this.poll();
    }, backoffMs);
  }
  registerWithServer() {
    if (!this.tcp || this.registered)
      return;
    this.tcp.send({
      cmd: "RegisterWorker",
      name: this.queueKey,
      queues: [this.queueKey],
      concurrency: this.opts.concurrency,
      workerId: this.workerId,
      hostname: hostname(),
      pid: process.pid,
      startedAt: this.startedAt
    }).then(() => {
      this.registered = true;
    }).catch((err) => {
      const error2 = err instanceof Error ? err : new Error(String(err));
      this.emit("error", Object.assign(error2, { context: "worker-register" }));
    });
  }
  startWorkerHeartbeat() {
    if (this.workerHeartbeatTimer || !this.tcp)
      return;
    this.workerHeartbeatTimer = setInterval(() => {
      if (!this.tcp || !this.registered)
        return;
      this.tcp.send({
        cmd: "Heartbeat",
        id: this.workerId,
        activeJobs: this.activeJobs,
        processed: this.processedCount,
        failed: this.failedCount
      }).catch((err) => {
        const error2 = err instanceof Error ? err : new Error(String(err));
        this.emit("error", Object.assign(error2, { context: "worker-heartbeat" }));
      });
    }, this.opts.heartbeatInterval);
  }
  getHeartbeatDeps() {
    return {
      pulledJobIds: this.pulledJobIds,
      jobTokens: this.jobTokens,
      tcp: this.tcp,
      useLocks: this.opts.useLocks,
      emitter: this
    };
  }
  getPullConfig() {
    return {
      name: this.queueKey,
      workerId: this.workerId,
      useLocks: this.opts.useLocks,
      pollTimeout: this.opts.pollTimeout,
      lockDuration: this.opts.lockDuration
    };
  }
  applyRemoveDefaults(job) {
    if (this.opts.removeOnComplete !== undefined && !job.removeOnComplete) {
      const val = this.opts.removeOnComplete;
      job.removeOnComplete = val === true;
    }
    if (this.opts.removeOnFail !== undefined && !job.removeOnFail) {
      const val = this.opts.removeOnFail;
      job.removeOnFail = val === true;
    }
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/forwarder.js
class Forwarder extends EventEmitter4 {
  on(event, listener) {
    return super.on(event, listener);
  }
  remote;
  worker;
  closed = false;
  constructor(source, options, RemoteQueue) {
    super();
    this.remote = new RemoteQueue(options.queue ?? source.name, {
      embedded: false,
      connection: options.to,
      autoBatch: { enabled: false }
    });
    this.worker = new Worker2(source.name, async (job) => {
      const remoteId = `fwd:${source.queueKey}:${job.id}`;
      await this.remote.add(job.name, job.data, {
        jobId: remoteId,
        ...job.opts.priority !== undefined && { priority: job.opts.priority },
        ...options.durable && { durable: true }
      });
      const info = { id: job.id, remoteId, name: job.name };
      try {
        this.emit("forwarded", info);
      } catch {}
      return info;
    }, {
      embedded: source.embedded,
      dataPath: source.dataPath,
      connection: source.connection,
      prefixKey: source.prefixKey,
      concurrency: options.concurrency ?? 4
    });
    this.worker.on("failed", (_job, err) => {
      if (this.listenerCount("error") > 0)
        this.emit("error", err);
    });
    this.worker.on("error", (err) => {
      if (this.listenerCount("error") > 0)
        this.emit("error", err);
    });
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    await this.worker.close();
    await this.remote.close();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/jobProxy.js
function reflectFields(id, queueName, meta) {
  const opts = meta?.opts ?? {};
  const p2 = opts.parent;
  const repeat = opts.repeat;
  const pattern = repeat?.pattern ?? (repeat?.every ? `every:${repeat.every}` : "");
  return {
    delay: meta?.delay ?? 0,
    priority: meta?.priority ?? 0,
    opts,
    deduplicationId: opts.jobId ?? opts.deduplication?.id,
    parentKey: p2 ? `${p2.queue}:${p2.id}` : undefined,
    parent: p2 ? { id: p2.id, queueQualifiedName: p2.queue } : undefined,
    repeatJobKey: repeat ? `${queueName}:${id}:${pattern}` : undefined,
    stacktrace: meta?.stacktrace ?? null,
    failedReason: meta?.failedReason
  };
}
function createJobProxy(id, name, data, ctx, meta) {
  const { tcp, queueName } = ctx;
  const ts = meta?.timestamp ?? Date.now();
  const r = reflectFields(id, queueName, meta);
  return {
    id,
    name,
    data,
    queueName,
    attemptsMade: 0,
    timestamp: ts,
    progress: 0,
    delay: r.delay,
    processedOn: undefined,
    finishedOn: undefined,
    stacktrace: r.stacktrace,
    failedReason: r.failedReason,
    stalledCounter: 0,
    priority: r.priority,
    parent: r.parent,
    parentKey: r.parentKey,
    opts: r.opts,
    token: undefined,
    processedBy: undefined,
    deduplicationId: r.deduplicationId,
    repeatJobKey: r.repeatJobKey,
    attemptsStarted: 0,
    updateProgress: async (progress, message) => {
      await tcp.send({ cmd: "Progress", id, progress, message });
    },
    log: async (message) => {
      await tcp.send({ cmd: "AddLog", id, message });
    },
    getState: () => ctx.getJobState(id),
    remove: () => ctx.removeAsync(id),
    retry: () => ctx.retryJob(id),
    getChildrenValues: () => ctx.getChildrenValues(id),
    isWaiting: async () => await ctx.getJobState(id) === "waiting",
    isActive: async () => await ctx.getJobState(id) === "active",
    isDelayed: async () => await ctx.getJobState(id) === "delayed",
    isCompleted: async () => await ctx.getJobState(id) === "completed",
    isFailed: async () => await ctx.getJobState(id) === "failed",
    isWaitingChildren: async () => await ctx.getJobState(id) === "waiting-children",
    updateData: async (newData) => {
      await tcp.send({ cmd: "Update", id, data: newData });
    },
    promote: async () => {
      await tcp.send({ cmd: "Promote", id });
    },
    changeDelay: async (delay) => {
      await tcp.send({ cmd: "ChangeDelay", id, delay });
    },
    changePriority: async (opts) => {
      await tcp.send({ cmd: "ChangePriority", id, priority: opts.priority, lifo: opts.lifo });
    },
    extendLock: async (token, duration) => {
      const res = await tcp.send({ cmd: "ExtendLock", id, token, duration });
      return res.ok === true ? duration : 0;
    },
    clearLogs: async () => {
      await tcp.send({ cmd: "ClearLogs", id });
    },
    getDependencies: () => computeDependencies(id, queueName, tcp),
    getDependenciesCount: async () => {
      const deps = await computeDependencies(id, queueName, tcp);
      return {
        processed: Object.keys(deps.processed).length,
        unprocessed: deps.unprocessed.length
      };
    },
    toJSON: () => ({
      id,
      name,
      data,
      opts: r.opts,
      progress: 0,
      delay: r.delay,
      timestamp: ts,
      attemptsMade: 0,
      stacktrace: r.stacktrace,
      failedReason: r.failedReason,
      queueQualifiedName: `bull:${queueName}`,
      parentKey: r.parentKey
    }),
    asJSON: () => ({
      id,
      name,
      data: JSON.stringify(data),
      opts: JSON.stringify(r.opts),
      progress: "0",
      delay: String(r.delay),
      timestamp: String(ts),
      attemptsMade: "0",
      stacktrace: r.stacktrace ? JSON.stringify(r.stacktrace) : null,
      failedReason: r.failedReason,
      parentKey: r.parentKey
    }),
    moveToCompleted: async (returnValue) => {
      await tcp.send({ cmd: "ACK", id, result: returnValue });
      return null;
    },
    moveToFailed: async (error2) => {
      await tcp.send({ cmd: "FAIL", id, error: error2.message });
    },
    moveToWait: async () => {
      const res = await tcp.send({ cmd: "MoveToWait", id });
      return res.ok === true;
    },
    moveToDelayed: async (timestamp) => {
      const delay = Math.max(0, timestamp - Date.now());
      await tcp.send({ cmd: "MoveToDelayed", id, delay });
    },
    moveToWaitingChildren: () => {
      return Promise.reject(new Error("moveToWaitingChildren is not supported in TCP mode \u2014 no server command available"));
    },
    waitUntilFinished: async (_queueEvents, ttl) => {
      const timeout = ttl ?? 30000;
      const res = await tcp.send({ cmd: "WaitJob", id, timeout });
      const typed = res;
      if (!typed.completed)
        throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
      return typed.result;
    },
    discard: () => {
      tcp.send({ cmd: "Discard", id });
    },
    getFailedChildrenValues: async () => {
      const res = await tcp.send({ cmd: "GetFailedChildrenValues", id });
      return res.values ?? {};
    },
    getIgnoredChildrenFailures: async () => {
      const res = await tcp.send({ cmd: "GetIgnoredChildrenFailures", id });
      return res.values ?? {};
    },
    removeChildDependency: async () => {
      const res = await tcp.send({ cmd: "RemoveChildDependency", id });
      return res.removed ?? false;
    },
    removeDeduplicationKey: () => Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available")),
    removeUnprocessedChildren: async () => {
      await tcp.send({ cmd: "RemoveUnprocessedChildren", id });
    }
  };
}
async function computeDependencies(id, queueName, tcp) {
  const jobRes = await tcp.send({ cmd: "GetJob", id });
  const parent = jobRes.job;
  const childIds = parent?.childrenIds ?? [];
  const processed = {};
  const unprocessed = [];
  for (const cid of childIds) {
    const stateRes = await tcp.send({ cmd: "GetState", id: cid });
    const state = stateRes.state ?? "unknown";
    const key = `${queueName}:${cid}`;
    if (state === "completed" || state === "failed") {
      if (state === "completed") {
        const resR = await tcp.send({ cmd: "GetResult", id: cid });
        processed[key] = resR.result ?? null;
      } else {
        processed[key] = null;
      }
    } else {
      unprocessed.push(key);
    }
  }
  return { processed, unprocessed };
}
function createSimpleJob(id, name, data, timestamp, ctx) {
  const { queueName, embedded, tcp, meta } = ctx;
  const r = reflectFields(id, queueName, meta);
  return {
    id,
    name,
    data,
    queueName,
    attemptsMade: 0,
    timestamp,
    progress: 0,
    delay: r.delay,
    processedOn: undefined,
    finishedOn: undefined,
    stacktrace: r.stacktrace,
    failedReason: r.failedReason,
    stalledCounter: 0,
    priority: r.priority,
    parent: r.parent,
    parentKey: r.parentKey,
    opts: r.opts,
    token: undefined,
    processedBy: undefined,
    deduplicationId: r.deduplicationId,
    repeatJobKey: r.repeatJobKey,
    attemptsStarted: 0,
    updateProgress: async (progress, message) => {
      if (embedded) {
        await getSharedManager().updateProgress(jobId(id), progress, message);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Progress", id, progress, message });
    },
    log: async (message) => {
      if (embedded) {
        getSharedManager().addLog(jobId(id), message);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "AddLog", id, message });
    },
    getState: () => ctx.getJobState(id),
    remove: () => ctx.removeAsync(id),
    retry: () => ctx.retryJob(id),
    getChildrenValues: () => ctx.getChildrenValues(id),
    isWaiting: async () => await ctx.getJobState(id) === "waiting",
    isActive: async () => await ctx.getJobState(id) === "active",
    isDelayed: async () => await ctx.getJobState(id) === "delayed",
    isCompleted: async () => await ctx.getJobState(id) === "completed",
    isFailed: async () => await ctx.getJobState(id) === "failed",
    isWaitingChildren: async () => await ctx.getJobState(id) === "waiting-children",
    updateData: async (newData) => {
      if (embedded) {
        await getSharedManager().updateJobData(jobId(id), newData);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Update", id, data: newData });
    },
    promote: async () => {
      if (embedded) {
        await getSharedManager().promote(jobId(id));
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Promote", id });
    },
    changeDelay: async (delay) => {
      if (embedded) {
        await getSharedManager().changeDelay(jobId(id), delay);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "ChangeDelay", id, delay });
    },
    changePriority: async (opts) => {
      if (embedded) {
        await getSharedManager().changePriority(jobId(id), opts.priority, opts.lifo);
        return;
      }
      if (tcp) {
        await tcp.send({ cmd: "ChangePriority", id, priority: opts.priority, lifo: opts.lifo });
      }
    },
    extendLock: async (token, duration) => {
      if (embedded) {
        const ok = await getSharedManager().extendLock(jobId(id), token, duration);
        return ok ? duration : 0;
      }
      if (!tcp)
        return 0;
      const res = await tcp.send({ cmd: "ExtendLock", id, token, duration });
      return res.ok === true ? duration : 0;
    },
    clearLogs: async (keepLogs) => {
      if (embedded) {
        getSharedManager().clearLogs(jobId(id), keepLogs);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "ClearLogs", id, keepLogs });
    },
    getDependencies: () => computeDepsSimple(id, queueName, embedded, tcp),
    getDependenciesCount: async () => {
      const deps = await computeDepsSimple(id, queueName, embedded, tcp);
      return {
        processed: Object.keys(deps.processed).length,
        unprocessed: deps.unprocessed.length
      };
    },
    toJSON: () => ({
      id,
      name,
      data,
      opts: r.opts,
      progress: 0,
      delay: r.delay,
      timestamp,
      attemptsMade: 0,
      stacktrace: r.stacktrace,
      failedReason: r.failedReason,
      queueQualifiedName: `bull:${queueName}`,
      parentKey: r.parentKey
    }),
    asJSON: () => ({
      id,
      name,
      data: JSON.stringify(data),
      opts: JSON.stringify(r.opts),
      progress: "0",
      delay: String(r.delay),
      timestamp: String(timestamp),
      attemptsMade: "0",
      stacktrace: r.stacktrace ? JSON.stringify(r.stacktrace) : null,
      failedReason: r.failedReason,
      parentKey: r.parentKey
    }),
    moveToCompleted: async (returnValue) => {
      if (embedded) {
        await getSharedManager().ack(jobId(id), returnValue);
        return null;
      }
      if (tcp)
        await tcp.send({ cmd: "ACK", id, result: returnValue });
      return null;
    },
    moveToFailed: async (error2) => {
      if (embedded) {
        await getSharedManager().fail(jobId(id), error2.message);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "FAIL", id, error: error2.message });
    },
    moveToWait: async () => {
      if (embedded) {
        const mgr = getSharedManager();
        const state = await mgr.getJobState(jobId(id));
        if (state === "active")
          return await mgr.moveActiveToWait(jobId(id));
        if (state === "delayed")
          return await mgr.promote(jobId(id));
        if (state === "failed") {
          const job = await mgr.getJob(jobId(id));
          if (!job)
            return false;
          return mgr.retryDlq(job.queue, jobId(id)) > 0;
        }
        if (state === "waiting" || state === "prioritized")
          return true;
        return false;
      }
      if (!tcp)
        return false;
      const res = await tcp.send({ cmd: "MoveToWait", id });
      return res.ok === true;
    },
    moveToDelayed: async (ts) => {
      const delay = Math.max(0, ts - Date.now());
      if (embedded) {
        await getSharedManager().moveToDelayed(jobId(id), delay);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "MoveToDelayed", id, delay });
    },
    moveToWaitingChildren: async () => {
      if (embedded) {
        return await getSharedManager().moveToWaitingChildren(jobId(id));
      }
      throw new Error("moveToWaitingChildren is not supported in TCP mode \u2014 no server command available");
    },
    waitUntilFinished: async (_qe, ttl) => {
      const timeout = ttl ?? 30000;
      if (embedded) {
        const mgr = getSharedManager();
        const job = await mgr.getJob(jobId(id));
        if (!job)
          throw new Error(`Job ${id} not found`);
        if (job.completedAt)
          return mgr.getResult(jobId(id));
        const ok = await mgr.waitForJobCompletion(jobId(id), timeout);
        if (!ok)
          throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
        return mgr.getResult(jobId(id));
      }
      if (!tcp)
        throw new Error("waitUntilFinished: no connection");
      const res = await tcp.send({ cmd: "WaitJob", id, timeout });
      const typed = res;
      if (!typed.completed)
        throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
      return typed.result;
    },
    discard: () => {
      if (embedded) {
        getSharedManager().discard(jobId(id));
        return;
      }
      if (tcp)
        tcp.send({ cmd: "Discard", id });
    },
    getFailedChildrenValues: async () => {
      if (embedded) {
        return await getSharedManager().getFailedChildrenValues(jobId(id));
      }
      if (!tcp)
        return {};
      const res = await tcp.send({ cmd: "GetFailedChildrenValues", id });
      return res.values ?? {};
    },
    getIgnoredChildrenFailures: async () => {
      if (embedded) {
        return await getSharedManager().getIgnoredChildrenFailures(jobId(id));
      }
      if (!tcp)
        return {};
      const res = await tcp.send({ cmd: "GetIgnoredChildrenFailures", id });
      return res.values ?? {};
    },
    removeChildDependency: async () => {
      if (embedded) {
        return await getSharedManager().removeChildDependency(jobId(id));
      }
      if (!tcp)
        return false;
      const res = await tcp.send({ cmd: "RemoveChildDependency", id });
      return res.removed ?? false;
    },
    removeDeduplicationKey: () => Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available")),
    removeUnprocessedChildren: async () => {
      if (embedded) {
        await getSharedManager().removeUnprocessedChildren(jobId(id));
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "RemoveUnprocessedChildren", id });
    }
  };
}
async function computeDepsSimple(id, queueName, embedded, tcp) {
  const processed = {};
  const unprocessed = [];
  let childIds = [];
  if (embedded) {
    const job = await getSharedManager().getJob(jobId(id));
    childIds = (job?.childrenIds ?? []).map(String);
  } else if (tcp) {
    const jobRes = await tcp.send({ cmd: "GetJob", id });
    const parent = jobRes.job;
    childIds = (parent?.childrenIds ?? []).map(String);
  }
  for (const cid of childIds) {
    let state = "unknown";
    let result;
    if (embedded) {
      const mgr = getSharedManager();
      state = await mgr.getJobState(jobId(cid));
      if (state === "completed")
        result = mgr.getResult(jobId(cid));
    } else if (tcp) {
      const r = await tcp.send({ cmd: "GetState", id: cid });
      state = r.state ?? "unknown";
      if (state === "completed") {
        const rr = await tcp.send({ cmd: "GetResult", id: cid });
        result = rr.result;
      }
    }
    const key = `${queueName}:${cid}`;
    if (state === "completed" || state === "failed") {
      processed[key] = result ?? null;
    } else {
      unprocessed.push(key);
    }
  }
  return { processed, unprocessed };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/operations/add.js
async function add(ctx, jobName, data, opts = {}) {
  const merged = { ...ctx.opts.defaultJobOptions, ...opts };
  const jobData = { name: jobName, ...data };
  if (merged.parent) {
    jobData.__parentId = merged.parent.id;
    jobData.__parentQueue = merged.parent.queue;
  }
  if (ctx.embedded) {
    const manager = getSharedManager();
    const removeOnComplete = typeof merged.removeOnComplete === "boolean" ? merged.removeOnComplete : false;
    const removeOnFail = typeof merged.removeOnFail === "boolean" ? merged.removeOnFail : false;
    const repeat = merged.repeat ? {
      every: merged.repeat.every,
      limit: merged.repeat.limit,
      pattern: merged.repeat.pattern,
      count: merged.repeat.count,
      startDate: parseDate(merged.repeat.startDate),
      endDate: parseDate(merged.repeat.endDate),
      tz: merged.repeat.tz,
      immediately: merged.repeat.immediately,
      prevMillis: merged.repeat.prevMillis,
      offset: merged.repeat.offset,
      jobId: merged.repeat.jobId
    } : undefined;
    const job = await manager.push(ctx.name, {
      data: jobData,
      priority: merged.priority,
      delay: merged.delay,
      maxAttempts: merged.attempts,
      backoff: merged.backoff,
      ttl: merged.ttl,
      timeout: merged.timeout,
      uniqueKey: merged.deduplication?.id,
      customId: merged.jobId ?? merged.deduplication?.id,
      dependsOn: merged.dependsOn?.map((id) => jobId(id)),
      tags: merged.tags,
      groupId: merged.groupId,
      dedup: merged.deduplication ? {
        ttl: merged.deduplication.ttl,
        extend: merged.deduplication.extend,
        replace: merged.deduplication.replace
      } : undefined,
      lifo: merged.lifo,
      removeOnComplete,
      removeOnFail,
      stallTimeout: merged.stallTimeout,
      durable: merged.durable,
      repeat,
      parentId: merged.parent ? jobId(merged.parent.id) : undefined,
      stackTraceLimit: merged.stackTraceLimit,
      keepLogs: merged.keepLogs,
      sizeLimit: merged.sizeLimit,
      failParentOnFailure: merged.failParentOnFailure,
      removeDependencyOnFailure: merged.removeDependencyOnFailure,
      continueParentOnFailure: merged.continueParentOnFailure,
      ignoreDependencyOnFailure: merged.ignoreDependencyOnFailure,
      timestamp: merged.timestamp,
      debounceId: merged.debounce?.id,
      debounceTtl: merged.debounce?.ttl
    });
    return toPublicJob({
      job,
      name: jobName,
      getState: (jid) => ctx.getJobState(jid),
      remove: (jid) => ctx.removeAsync(jid),
      retry: (jid) => ctx.retryJob(jid),
      getChildrenValues: (jid) => ctx.getChildrenValues(jid),
      updateData: (jid, d) => ctx.updateJobData(jid, d),
      promote: (jid) => ctx.promoteJob(jid),
      changeDelay: (jid, delay) => ctx.changeJobDelay(jid, delay),
      changePriority: (jid, o) => ctx.changeJobPriority(jid, o),
      extendLock: (jid, token, duration) => ctx.extendJobLock(jid, token, duration),
      clearLogs: (jid, keepLogs) => ctx.clearJobLogs(jid, keepLogs),
      getDependencies: (jid, o) => ctx.getJobDependencies(jid, o),
      getDependenciesCount: (jid, o) => ctx.getJobDependenciesCount(jid, o),
      moveToCompleted: (jid, result, token) => ctx.moveJobToCompleted(jid, result, token),
      moveToFailed: (jid, error2, token) => ctx.moveJobToFailed(jid, error2, token),
      moveToWait: (jid, token) => ctx.moveJobToWait(jid, token),
      moveToDelayed: (jid, timestamp, token) => ctx.moveJobToDelayed(jid, timestamp, token),
      moveToWaitingChildren: (jid, token, o) => ctx.moveJobToWaitingChildren(jid, token, o),
      waitUntilFinished: (jid, queueEvents, ttl) => ctx.waitJobUntilFinished(jid, queueEvents, ttl)
    });
  }
  const tcp = ctx.tcp;
  const response = await tcp.send(buildPushPayload(ctx.name, jobData, merged));
  if (!response.ok) {
    throw new Error(response.error ?? "Failed to add job");
  }
  const jobIdStr = response.id;
  return createJobProxy(jobIdStr, jobName, data, {
    queueName: ctx.name,
    tcp,
    getJobState: ctx.getJobState,
    removeAsync: ctx.removeAsync,
    retryJob: ctx.retryJob,
    getChildrenValues: ctx.getChildrenValues
  }, { priority: merged.priority, delay: merged.delay, opts: merged });
}
function compact(obj) {
  const out = {};
  for (const k2 in obj) {
    if (obj[k2] !== undefined)
      out[k2] = obj[k2];
  }
  return out;
}
function buildPushPayload(queue, jobData, m2) {
  return compact({
    cmd: "PUSH",
    queue,
    data: jobData,
    priority: m2.priority,
    delay: m2.delay,
    maxAttempts: m2.attempts,
    backoff: m2.backoff,
    ttl: m2.ttl,
    timeout: m2.timeout,
    jobId: m2.jobId,
    uniqueKey: m2.deduplication?.id,
    dedup: m2.deduplication ? {
      ttl: m2.deduplication.ttl,
      extend: m2.deduplication.extend,
      replace: m2.deduplication.replace
    } : undefined,
    dependsOn: m2.dependsOn,
    tags: m2.tags,
    groupId: m2.groupId,
    lifo: m2.lifo,
    removeOnComplete: typeof m2.removeOnComplete === "boolean" ? m2.removeOnComplete : undefined,
    removeOnFail: typeof m2.removeOnFail === "boolean" ? m2.removeOnFail : undefined,
    stallTimeout: m2.stallTimeout,
    stackTraceLimit: m2.stackTraceLimit,
    keepLogs: m2.keepLogs,
    sizeLimit: m2.sizeLimit,
    failParentOnFailure: m2.failParentOnFailure,
    removeDependencyOnFailure: m2.removeDependencyOnFailure,
    continueParentOnFailure: m2.continueParentOnFailure,
    ignoreDependencyOnFailure: m2.ignoreDependencyOnFailure,
    debounceId: m2.debounce?.id,
    debounceTtl: m2.debounce?.ttl,
    timestamp: m2.timestamp,
    durable: m2.durable,
    repeat: m2.repeat,
    parentId: m2.parent?.id
  });
}
function buildBulkData(name, data, m2) {
  const jobData = { name, ...data };
  if (m2.parent) {
    jobData.__parentId = m2.parent.id;
    jobData.__parentQueue = m2.parent.queue;
  }
  return jobData;
}
function reflectionMeta(m2) {
  return { priority: m2.priority, delay: m2.delay, opts: m2 };
}
async function addBulk(ctx, jobs) {
  if (jobs.length === 0)
    return [];
  const now = Date.now();
  const merged = jobs.map(({ opts }) => ({
    ...ctx.opts.defaultJobOptions,
    ...opts
  }));
  if (ctx.embedded) {
    const manager = getSharedManager();
    const inputs = jobs.map(({ name, data }, i) => {
      const m2 = merged[i];
      const removeOnComplete = typeof m2.removeOnComplete === "boolean" ? m2.removeOnComplete : false;
      const removeOnFail = typeof m2.removeOnFail === "boolean" ? m2.removeOnFail : false;
      return {
        data: buildBulkData(name, data, m2),
        priority: m2.priority,
        delay: m2.delay,
        maxAttempts: m2.attempts,
        backoff: m2.backoff,
        timeout: m2.timeout,
        ttl: m2.ttl,
        customId: m2.jobId,
        uniqueKey: m2.deduplication?.id,
        dependsOn: m2.dependsOn?.map((id) => jobId(id)),
        parentId: m2.parent ? jobId(m2.parent.id) : undefined,
        tags: m2.tags,
        groupId: m2.groupId,
        stallTimeout: m2.stallTimeout,
        timestamp: m2.timestamp,
        removeOnComplete,
        removeOnFail,
        repeat: m2.repeat ? {
          every: m2.repeat.every,
          limit: m2.repeat.limit,
          pattern: m2.repeat.pattern,
          count: m2.repeat.count,
          startDate: parseDate(m2.repeat.startDate),
          endDate: parseDate(m2.repeat.endDate),
          tz: m2.repeat.tz,
          immediately: m2.repeat.immediately,
          prevMillis: m2.repeat.prevMillis,
          offset: m2.repeat.offset,
          jobId: m2.repeat.jobId
        } : undefined,
        durable: m2.durable,
        lifo: m2.lifo,
        stackTraceLimit: m2.stackTraceLimit,
        keepLogs: m2.keepLogs,
        sizeLimit: m2.sizeLimit,
        failParentOnFailure: m2.failParentOnFailure,
        removeDependencyOnFailure: m2.removeDependencyOnFailure,
        continueParentOnFailure: m2.continueParentOnFailure,
        ignoreDependencyOnFailure: m2.ignoreDependencyOnFailure,
        dedup: m2.deduplication ? {
          ttl: m2.deduplication.ttl,
          extend: m2.deduplication.extend,
          replace: m2.deduplication.replace
        } : undefined,
        debounceId: m2.debounce?.id,
        debounceTtl: m2.debounce?.ttl
      };
    });
    const ids2 = await manager.pushBatch(ctx.name, inputs);
    return ids2.map((id, i) => createSimpleJob(String(id), jobs[i].name, jobs[i].data, now, {
      queueName: ctx.name,
      embedded: ctx.embedded,
      tcp: ctx.tcp,
      getJobState: ctx.getJobState,
      removeAsync: ctx.removeAsync,
      retryJob: ctx.retryJob,
      getChildrenValues: ctx.getChildrenValues,
      meta: reflectionMeta(merged[i])
    }));
  }
  const tcp = ctx.tcp;
  const batchJobs = jobs.map(({ name, data }, i) => {
    const m2 = merged[i];
    const removeOnComplete = typeof m2.removeOnComplete === "boolean" ? m2.removeOnComplete : false;
    const removeOnFail = typeof m2.removeOnFail === "boolean" ? m2.removeOnFail : false;
    return compact({
      data: buildBulkData(name, data, m2),
      priority: m2.priority,
      delay: m2.delay,
      maxAttempts: m2.attempts,
      backoff: m2.backoff,
      timeout: m2.timeout,
      ttl: m2.ttl,
      customId: m2.jobId,
      tags: m2.tags,
      groupId: m2.groupId,
      dependsOn: m2.dependsOn?.map((id) => jobId(id)),
      parentId: m2.parent ? jobId(m2.parent.id) : undefined,
      uniqueKey: m2.deduplication?.id,
      dedup: m2.deduplication ? {
        ttl: m2.deduplication.ttl,
        extend: m2.deduplication.extend,
        replace: m2.deduplication.replace
      } : undefined,
      lifo: m2.lifo,
      stallTimeout: m2.stallTimeout,
      timestamp: m2.timestamp,
      removeOnComplete,
      removeOnFail,
      repeat: m2.repeat,
      durable: m2.durable,
      stackTraceLimit: m2.stackTraceLimit,
      keepLogs: m2.keepLogs,
      sizeLimit: m2.sizeLimit,
      failParentOnFailure: m2.failParentOnFailure,
      removeDependencyOnFailure: m2.removeDependencyOnFailure,
      continueParentOnFailure: m2.continueParentOnFailure,
      ignoreDependencyOnFailure: m2.ignoreDependencyOnFailure,
      debounceId: m2.debounce?.id,
      debounceTtl: m2.debounce?.ttl
    });
  });
  const response = await tcp.send({
    cmd: "PUSHB",
    queue: ctx.name,
    jobs: batchJobs
  });
  if (!response.ok) {
    throw new Error(response.error ?? "Failed to add jobs");
  }
  const ids = response.ids ?? [];
  return ids.map((id, i) => createJobProxy(id, jobs[i].name, jobs[i].data, {
    queueName: ctx.name,
    tcp,
    getJobState: ctx.getJobState,
    removeAsync: ctx.removeAsync,
    retryJob: ctx.retryJob,
    getChildrenValues: ctx.getChildrenValues
  }, reflectionMeta(merged[i])));
}
function parseDate(date) {
  if (date instanceof Date)
    return date.getTime();
  if (typeof date === "string")
    return new Date(date).getTime();
  return date;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/operations/query.js
function lastFailedError(timeline) {
  if (!timeline)
    return;
  for (let i = timeline.length - 1;i >= 0; i--) {
    const entry = timeline[i];
    if (entry.state === "failed" && entry.error)
      return entry.error;
  }
  return;
}
function metaFromJob(job) {
  const opts = buildJobOpts(job);
  return {
    priority: job.priority ?? 0,
    delay: opts.delay ?? 0,
    opts,
    stacktrace: job.stacktrace ?? null,
    failedReason: lastFailedError(job.timeline)
  };
}
async function getJob2(ctx, id) {
  if (ctx.embedded) {
    const job = await getSharedManager().getJob(jobId(id));
    if (!job)
      return null;
    const name2 = job.data?.name ?? "unknown";
    if (ctx.updateJobData) {
      const mgr = getSharedManager();
      return toPublicJob({
        job,
        name: name2,
        getState: (jid) => ctx.getJobState(jid),
        remove: (jid) => ctx.removeAsync(jid),
        retry: (jid) => ctx.retryJob(jid),
        getChildrenValues: (jid) => ctx.getChildrenValues(jid),
        updateData: ctx.updateJobData,
        promote: ctx.promoteJob,
        changeDelay: ctx.changeJobDelay,
        changePriority: ctx.changeJobPriority,
        extendLock: ctx.extendJobLock,
        clearLogs: ctx.clearJobLogs,
        getDependencies: ctx.getJobDependencies,
        getDependenciesCount: ctx.getJobDependenciesCount,
        moveToCompleted: ctx.moveJobToCompleted,
        moveToFailed: ctx.moveJobToFailed,
        moveToWait: ctx.moveJobToWait,
        moveToDelayed: ctx.moveJobToDelayed ? (jid, ts, tok) => ctx.moveJobToDelayed(jid, ts, tok) : undefined,
        moveToWaitingChildren: ctx.moveJobToWaitingChildren,
        waitUntilFinished: ctx.waitJobUntilFinished,
        discard: (jid) => {
          mgr.discard(jobId(jid));
        },
        getFailedChildrenValues: (jid) => mgr.getFailedChildrenValues(jobId(jid)),
        getIgnoredChildrenFailures: (jid) => mgr.getIgnoredChildrenFailures(jobId(jid)),
        removeChildDependency: (jid) => mgr.removeChildDependency(jobId(jid)),
        removeUnprocessedChildren: async (jid) => {
          await mgr.removeUnprocessedChildren(jobId(jid));
        }
      });
    }
    return createSimpleJob(String(job.id), name2, job.data, job.createdAt, {
      queueName: ctx.name,
      embedded: ctx.embedded,
      tcp: ctx.tcp,
      getJobState: ctx.getJobState,
      removeAsync: ctx.removeAsync,
      retryJob: ctx.retryJob,
      getChildrenValues: ctx.getChildrenValues,
      meta: metaFromJob(job)
    });
  }
  const response = await ctx.tcp.send({ cmd: "GetJob", id });
  if (!response.ok || !response.job)
    return null;
  const j = response.job;
  const name = j.data?.name ?? "unknown";
  const result = createSimpleJob(String(j.id), name, j.data, j.createdAt ?? Date.now(), {
    queueName: ctx.name,
    embedded: ctx.embedded,
    tcp: ctx.tcp,
    getJobState: ctx.getJobState,
    removeAsync: ctx.removeAsync,
    retryJob: ctx.retryJob,
    getChildrenValues: ctx.getChildrenValues,
    meta: metaFromJob(j)
  });
  if (j.progress !== undefined)
    result.progress = j.progress;
  return result;
}
async function getJobState2(ctx, id) {
  if (ctx.embedded) {
    const state = await getSharedManager().getJobState(jobId(id));
    return mapState(state);
  }
  const response = await ctx.tcp.send({ cmd: "GetState", id });
  if (!response.ok)
    return "unknown";
  return mapState(response.state);
}
function mapState(state) {
  switch (state) {
    case "waiting":
    case "prioritized":
    case "delayed":
    case "active":
    case "completed":
    case "failed":
    case "waiting-children":
      return state;
    case "processing":
      return "active";
    case "dlq":
      return "failed";
    default:
      return "unknown";
  }
}
async function getChildrenValues(ctx, id) {
  if (ctx.embedded) {
    return getSharedManager().getChildrenValues(jobId(id));
  }
  const response = await ctx.tcp.send({ cmd: "GetChildrenValues", id });
  if (!response.ok)
    return {};
  const data = response.data;
  return data?.values ?? {};
}
function getJobs2(ctx, options = {}) {
  if (!ctx.embedded)
    return [];
  const manager = getSharedManager();
  const jobs = manager.getJobs(ctx.name, {
    state: options.state,
    start: options.start ?? 0,
    end: options.end !== undefined && options.end >= 0 ? options.end : 100
  });
  return jobs.map((j) => {
    const name = j.data?.name ?? "unknown";
    return createSimpleJob(String(j.id), name, j.data, j.createdAt, {
      queueName: ctx.name,
      embedded: ctx.embedded,
      tcp: ctx.tcp,
      getJobState: ctx.getJobState,
      removeAsync: ctx.removeAsync,
      retryJob: ctx.retryJob,
      getChildrenValues: ctx.getChildrenValues
    });
  });
}
async function getJobsAsync(ctx, options = {}) {
  if (ctx.embedded)
    return getJobs2(ctx, options);
  const end = options.end !== undefined && options.end >= 0 ? options.end : 1000;
  const start = options.start ?? 0;
  const response = await ctx.tcp.send({
    cmd: "GetJobs",
    queue: ctx.name,
    state: options.state,
    offset: start,
    limit: end - start
  });
  if (!response.ok || !Array.isArray(response.jobs)) {
    return [];
  }
  const jobs = response.jobs;
  const now = Date.now();
  return jobs.map((j) => {
    const name = j.data?.name ?? "unknown";
    const createdAt = j.createdAt ?? now;
    const result = createSimpleJob(String(j.id), name, j.data, createdAt, {
      queueName: ctx.name,
      embedded: ctx.embedded,
      tcp: ctx.tcp,
      getJobState: ctx.getJobState,
      removeAsync: ctx.removeAsync,
      retryJob: ctx.retryJob,
      getChildrenValues: ctx.getChildrenValues,
      meta: metaFromJob(j)
    });
    if (j.progress !== undefined)
      result.progress = j.progress;
    if (j.priority !== undefined)
      result.priority = j.priority;
    if (j.attempts !== undefined)
      result.attemptsMade = j.attempts;
    return result;
  });
}
function getWaiting(ctx, start = 0, end = 100) {
  return getJobs2(ctx, { state: "waiting", start, end });
}
async function getWaitingAsync(ctx, start = 0, end = 100) {
  return getJobsAsync(ctx, { state: "waiting", start, end });
}
function getDelayed(ctx, start = 0, end = 100) {
  return getJobs2(ctx, { state: "delayed", start, end });
}
async function getDelayedAsync(ctx, start = 0, end = 100) {
  return getJobsAsync(ctx, { state: "delayed", start, end });
}
function getActive(ctx, start = 0, end = 100) {
  return getJobs2(ctx, { state: "active", start, end });
}
async function getActiveAsync(ctx, start = 0, end = 100) {
  return getJobsAsync(ctx, { state: "active", start, end });
}
function getCompleted(ctx, start = 0, end = 100) {
  return getJobs2(ctx, { state: "completed", start, end });
}
async function getCompletedAsync(ctx, start = 0, end = 100) {
  return getJobsAsync(ctx, { state: "completed", start, end });
}
function getFailed(ctx, start = 0, end = 100) {
  return getJobs2(ctx, { state: "failed", start, end });
}
async function getFailedAsync(ctx, start = 0, end = 100) {
  return getJobsAsync(ctx, { state: "failed", start, end });
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/shared/pausedView.js
function pausedView(waiting, prioritized, isPaused) {
  return {
    waiting: isPaused ? 0 : waiting,
    prioritized: isPaused ? 0 : prioritized,
    paused: isPaused ? waiting + prioritized : 0
  };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/operations/counts.js
function getJobCounts(ctx) {
  if (!ctx.embedded) {
    return getJobCountsAsync(ctx);
  }
  const manager = getSharedManager();
  const counts = manager.getQueueJobCounts(ctx.name);
  const isPaused = manager.isPaused(ctx.name);
  const pv = pausedView(counts.waiting, counts.prioritized, isPaused);
  return {
    waiting: pv.waiting,
    prioritized: pv.prioritized,
    active: counts.active,
    completed: counts.completed,
    failed: counts.failed,
    delayed: counts.delayed,
    paused: pv.paused
  };
}
async function getJobCountsAsync(ctx) {
  if (ctx.embedded)
    return getJobCounts(ctx);
  const response = await ctx.tcp.send({ cmd: "GetJobCounts", queue: ctx.name });
  if (!response.ok) {
    return {
      waiting: 0,
      prioritized: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0
    };
  }
  const counts = response.counts;
  return {
    waiting: counts?.waiting ?? 0,
    prioritized: counts?.prioritized ?? 0,
    active: counts?.active ?? 0,
    completed: counts?.completed ?? 0,
    failed: counts?.failed ?? 0,
    delayed: counts?.delayed ?? 0,
    paused: counts?.paused ?? 0
  };
}
async function getWaitingCount(ctx) {
  const counts = await getJobCountsAsync(ctx);
  return counts.waiting;
}
async function getActiveCount(ctx) {
  const counts = await getJobCountsAsync(ctx);
  return counts.active;
}
async function getCompletedCount(ctx) {
  const counts = await getJobCountsAsync(ctx);
  return counts.completed;
}
async function getFailedCount(ctx) {
  const counts = await getJobCountsAsync(ctx);
  return counts.failed;
}
async function getDelayedCount(ctx) {
  if (ctx.embedded) {
    const jobs = getSharedManager().getJobs(ctx.name, { state: "delayed" });
    return jobs.length;
  }
  const response = await ctx.tcp.send({ cmd: "GetJobCounts", queue: ctx.name });
  if (!response.ok)
    return 0;
  return response.counts?.delayed ?? 0;
}
function count(ctx) {
  if (!ctx.embedded)
    return 0;
  return getSharedManager().count(ctx.name);
}
async function countAsync(ctx) {
  if (ctx.embedded)
    return count(ctx);
  const response = await ctx.tcp.send({ cmd: "Count", queue: ctx.name });
  if (!response.ok)
    return 0;
  return response.count ?? 0;
}
function getCountsPerPriority(ctx) {
  if (!ctx.embedded)
    return {};
  return getSharedManager().getCountsPerPriority(ctx.name);
}
async function getCountsPerPriorityAsync(ctx) {
  if (ctx.embedded)
    return getCountsPerPriority(ctx);
  const response = await ctx.tcp.send({ cmd: "GetCountsPerPriority", queue: ctx.name });
  if (!response.ok)
    return {};
  return response.counts ?? {};
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/operations/control.js
function pause(ctx) {
  if (ctx.embedded)
    getSharedManager().pause(ctx.name);
  else if (ctx.tcp)
    ctx.tcp.send({ cmd: "Pause", queue: ctx.name });
}
function resume(ctx) {
  if (ctx.embedded)
    getSharedManager().resume(ctx.name);
  else if (ctx.tcp)
    ctx.tcp.send({ cmd: "Resume", queue: ctx.name });
}
function drain(ctx) {
  if (ctx.embedded)
    getSharedManager().drain(ctx.name);
  else if (ctx.tcp)
    ctx.tcp.send({ cmd: "Drain", queue: ctx.name });
}
function obliterate(ctx) {
  if (ctx.embedded)
    getSharedManager().obliterate(ctx.name);
  else if (ctx.tcp)
    ctx.tcp.send({ cmd: "Obliterate", queue: ctx.name });
}
function isPaused(ctx) {
  if (!ctx.embedded)
    return false;
  return getSharedManager().isPaused(ctx.name);
}
async function isPausedAsync(ctx) {
  if (ctx.embedded)
    return isPaused(ctx);
  if (!ctx.tcp)
    return false;
  const response = await ctx.tcp.send({ cmd: "IsPaused", queue: ctx.name });
  return response.paused === true;
}
async function waitUntilReady(ctx) {
  if (ctx.embedded)
    return;
  if (ctx.tcp)
    await ctx.tcp.send({ cmd: "Ping" });
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/operations/management.js
function remove(ctx, id) {
  if (ctx.embedded)
    getSharedManager().cancel(jobId(id));
  else
    ctx.tcp.send({ cmd: "Cancel", id });
}
async function removeAsync(ctx, id) {
  if (ctx.embedded) {
    await getSharedManager().cancel(jobId(id));
    return;
  }
  await ctx.tcp.send({ cmd: "Cancel", id });
}
async function retryJob(ctx, id) {
  if (ctx.embedded) {
    const mgr = getSharedManager();
    const state = await mgr.getJobState(jobId(id));
    if (state === "failed") {
      const count2 = mgr.retryDlq(ctx.name, jobId(id));
      if (count2 === 0)
        throw new Error(`Job ${id} is failed but not present in DLQ`);
      return;
    }
    if (state === "active") {
      const ok = await mgr.moveActiveToWait(jobId(id));
      if (!ok)
        throw new Error(`Failed to retry active job ${id}`);
      return;
    }
    if (state === "waiting" || state === "prioritized" || state === "delayed")
      return;
    throw new Error(`Cannot retry job ${id} from state '${state}'`);
  }
  const res = await ctx.tcp.send({ cmd: "MoveToWait", id });
  if (res.ok !== true) {
    const err = typeof res.error === "string" ? res.error : "retry failed";
    throw new Error(err);
  }
}
async function retryJobs(ctx, opts) {
  if (ctx.embedded) {
    if (opts?.state === "failed") {
      getSharedManager().retryDlq(ctx.name);
    }
    return;
  }
  if (opts?.state === "failed") {
    await ctx.tcp.send({ cmd: "RetryDlq", queue: ctx.name, count: opts?.count });
  }
}
function clean(ctx, grace, limit, type) {
  if (!ctx.embedded)
    return [];
  return getSharedManager().clean(ctx.name, grace, type, limit);
}
async function cleanAsync(ctx, grace, limit, type) {
  if (ctx.embedded)
    return clean(ctx, grace, limit, type);
  const response = await ctx.tcp.send({
    cmd: "Clean",
    queue: ctx.name,
    grace,
    limit,
    state: type
  });
  if (!response.ok)
    return [];
  const ids = response.ids ?? [];
  return ids;
}
async function promoteJobs(ctx, opts) {
  if (ctx.embedded) {
    const manager = getSharedManager();
    const jobs = manager.getJobs(ctx.name, { state: "delayed" });
    const count2 = opts?.count ?? jobs.length;
    let promoted = 0;
    for (let i = 0;i < Math.min(count2, jobs.length); i++) {
      const success = await manager.promote(jobs[i].id);
      if (success)
        promoted++;
    }
    return promoted;
  }
  const response = await ctx.tcp.send({
    cmd: "PromoteJobs",
    queue: ctx.name,
    count: opts?.count
  });
  if (!response.ok)
    return 0;
  return response.count ?? 0;
}
async function promoteJob2(ctx, id) {
  if (ctx.embedded) {
    await getSharedManager().promote(jobId(id));
    return;
  }
  await ctx.tcp.send({ cmd: "Promote", id });
}
async function updateJobProgress2(ctx, id, progress) {
  const progressValue = typeof progress === "number" ? progress : 0;
  const message = typeof progress === "object" ? JSON.stringify(progress) : undefined;
  if (ctx.embedded) {
    await getSharedManager().updateProgress(jobId(id), progressValue, message);
    return;
  }
  await ctx.tcp.send({ cmd: "Progress", id, progress: progressValue, message });
}
async function getJobLogs2(ctx, id, start = 0, end = 100) {
  if (ctx.embedded) {
    const logs2 = getSharedManager().getLogs(jobId(id));
    const logStrings2 = logs2.slice(start, end).map((l) => `[${l.level}] ${l.message}`);
    return { logs: logStrings2, count: logs2.length };
  }
  const response = await ctx.tcp.send({ cmd: "GetLogs", id, start, end });
  if (!response.ok)
    return { logs: [], count: 0 };
  const data = response.data;
  const logs = data?.logs ?? [];
  const logStrings = logs.map((l) => `[${l.level}] ${l.message}`);
  return { logs: logStrings, count: logs.length };
}
async function addJobLog2(ctx, id, logRow) {
  if (ctx.embedded) {
    const success = getSharedManager().addLog(jobId(id), logRow);
    return success ? 1 : 0;
  }
  const response = await ctx.tcp.send({ cmd: "AddLog", id, message: logRow });
  return response.ok ? 1 : 0;
}
async function clearJobLogs2(ctx, id, keepLogs) {
  if (ctx.embedded) {
    getSharedManager().clearLogs(jobId(id), keepLogs);
    return;
  }
  await ctx.tcp.send({ cmd: "ClearLogs", id, keepLogs });
}
async function updateJobData2(ctx, id, data) {
  if (ctx.embedded) {
    await getSharedManager().updateJobData(jobId(id), data);
    return;
  }
  await ctx.tcp.send({ cmd: "Update", id, data });
}
async function changeJobDelay(ctx, id, delay) {
  if (ctx.embedded) {
    await getSharedManager().changeDelay(jobId(id), delay);
    return;
  }
  await ctx.tcp.send({ cmd: "ChangeDelay", id, delay });
}
async function changeJobPriority2(ctx, id, opts) {
  if (ctx.embedded) {
    await getSharedManager().changePriority(jobId(id), opts.priority, opts.lifo);
    return;
  }
  await ctx.tcp.send({ cmd: "ChangePriority", id, priority: opts.priority, lifo: opts.lifo });
}
async function extendJobLock(ctx, id, token, duration) {
  if (ctx.embedded) {
    const success = await getSharedManager().extendLock(jobId(id), token, duration);
    return success ? duration : 0;
  }
  const response = await ctx.tcp.send({ cmd: "ExtendLock", id, token, duration });
  return response.ok ? duration : 0;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/dlqOps.js
function setDlqConfig(queue, config) {
  const manager = getSharedManager();
  const ctx = getDlqContext(manager);
  configureDlq(queue, ctx, toDomainDlqConfig(config));
}
function getDlqConfigEmbedded(queue) {
  const manager = getSharedManager();
  const ctx = getDlqContext(manager);
  return getDlqConfig(queue, ctx);
}
function getDlqEntries2(queue, filter) {
  const manager = getSharedManager();
  const ctx = getDlqContext(manager);
  const entries = getDlqEntries(queue, ctx, toDomainFilter(filter));
  return entries.map((entry) => toDlqEntry(entry));
}
function getDlqStatsEmbedded(queue) {
  const manager = getSharedManager();
  const ctx = getDlqContext(manager);
  const stats = getDlqStats(queue, ctx);
  return {
    total: stats.total,
    byReason: stats.byReason,
    pendingRetry: stats.pendingRetry,
    expired: stats.expired,
    oldestEntry: stats.oldestEntry,
    newestEntry: stats.newestEntry
  };
}
function retryDlqByFilterEmbedded(queue, filter) {
  const manager = getSharedManager();
  const ctx = getDlqContext(manager);
  const domainFilter = toDomainFilter(filter);
  if (!domainFilter)
    return 0;
  return retryDlqByFilter(queue, ctx, domainFilter);
}
function retryDlqEmbedded(queue, id) {
  const manager = getSharedManager();
  return manager.retryDlq(queue, id ? jobId(id) : undefined);
}
function purgeDlqEmbedded(queue) {
  return getSharedManager().purgeDlq(queue);
}
function setStallConfigEmbedded(queue, config) {
  const manager = getSharedManager();
  const shard = getShard(manager, queue);
  shard.setStallConfig(queue, config);
}
function getStallConfigEmbedded(queue) {
  const manager = getSharedManager();
  const shard = getShard(manager, queue);
  return shard.getStallConfig(queue);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/stall.js
var DEFAULT_STALL_CONFIG2 = {
  enabled: true,
  stallInterval: 30000,
  maxStalls: 3,
  gracePeriod: 5000
};
var tcpConfigCache = new Map;
function setStallConfig(ctx, config) {
  if (ctx.embedded) {
    setStallConfigEmbedded(ctx.name, config);
  } else if (ctx.tcp) {
    const current = tcpConfigCache.get(ctx.name) ?? { ...DEFAULT_STALL_CONFIG2 };
    tcpConfigCache.set(ctx.name, { ...current, ...config });
    ctx.tcp.send({ cmd: "SetStallConfig", queue: ctx.name, config });
  }
}
function getStallConfig(ctx) {
  if (ctx.embedded) {
    return getStallConfigEmbedded(ctx.name);
  }
  return tcpConfigCache.get(ctx.name) ?? { ...DEFAULT_STALL_CONFIG2 };
}
async function getStallConfigAsync(ctx) {
  if (ctx.embedded) {
    return getStallConfigEmbedded(ctx.name);
  }
  if (!ctx.tcp) {
    return { enabled: true, stallInterval: 30000, maxStalls: 3, gracePeriod: 5000 };
  }
  const response = await ctx.tcp.send({ cmd: "GetStallConfig", queue: ctx.name });
  if (!response.ok) {
    return { enabled: true, stallInterval: 30000, maxStalls: 3, gracePeriod: 5000 };
  }
  return response.config;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/dlq.js
var tcpDlqConfigCache = new Map;
function setDlqConfig2(ctx, config) {
  if (ctx.embedded) {
    setDlqConfig(ctx.name, config);
  } else if (ctx.tcp) {
    const current = tcpDlqConfigCache.get(ctx.name) ?? {};
    tcpDlqConfigCache.set(ctx.name, { ...current, ...config });
    ctx.tcp.send({ cmd: "SetDlqConfig", queue: ctx.name, config });
  }
}
function getDlqConfig2(ctx) {
  if (ctx.embedded)
    return getDlqConfigEmbedded(ctx.name);
  const cached = tcpDlqConfigCache.get(ctx.name);
  if (cached)
    return cached;
  return {};
}
async function getDlqConfigAsync(ctx) {
  if (ctx.embedded)
    return getDlqConfigEmbedded(ctx.name);
  if (!ctx.tcp)
    return {};
  const response = await ctx.tcp.send({ cmd: "GetDlqConfig", queue: ctx.name });
  if (!response.ok)
    return {};
  return response.config;
}
function getDlq(ctx, filter) {
  if (!ctx.embedded)
    return [];
  return getDlqEntries2(ctx.name, filter);
}
function getDlqStats2(ctx) {
  if (!ctx.embedded) {
    return {
      total: 0,
      byReason: {},
      pendingRetry: 0,
      expired: 0,
      oldestEntry: null,
      newestEntry: null
    };
  }
  return getDlqStatsEmbedded(ctx.name);
}
function retryDlq(ctx, id) {
  if (ctx.embedded)
    return retryDlqEmbedded(ctx.name, id);
  if (ctx.tcp)
    ctx.tcp.send({ cmd: "RetryDlq", queue: ctx.name, jobId: id });
  return 0;
}
function retryDlqByFilter2(ctx, filter) {
  if (!ctx.embedded)
    return 0;
  return retryDlqByFilterEmbedded(ctx.name, filter);
}
function purgeDlq(ctx) {
  if (ctx.embedded)
    return purgeDlqEmbedded(ctx.name);
  if (ctx.tcp)
    ctx.tcp.send({ cmd: "PurgeDlq", queue: ctx.name });
  return 0;
}
function retryCompleted(ctx, id) {
  if (ctx.embedded) {
    const jid = id ? jobId(id) : undefined;
    return getSharedManager().retryCompleted(ctx.name, jid);
  }
  if (ctx.tcp)
    ctx.tcp.send({ cmd: "RetryCompleted", queue: ctx.name, id });
  return 0;
}
async function retryCompletedAsync(ctx, id) {
  if (ctx.embedded)
    return retryCompleted(ctx, id);
  if (!ctx.tcp)
    return 0;
  const response = await ctx.tcp.send({ cmd: "RetryCompleted", queue: ctx.name, id });
  if (!response.ok)
    return 0;
  return response.count ?? 0;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/rateLimit.js
function setGlobalConcurrency(ctx, concurrency) {
  if (ctx.embedded) {
    getSharedManager().setConcurrency(ctx.name, concurrency);
  } else if (ctx.tcp) {
    ctx.tcp.send({ cmd: "SetConcurrency", queue: ctx.name, limit: concurrency });
  }
}
function removeGlobalConcurrency(ctx) {
  if (ctx.embedded) {
    getSharedManager().clearConcurrency(ctx.name);
  } else if (ctx.tcp) {
    ctx.tcp.send({ cmd: "ClearConcurrency", queue: ctx.name });
  }
}
function getGlobalConcurrency(_ctx) {
  return Promise.resolve(null);
}
function setGlobalRateLimit(ctx, max, _duration) {
  if (ctx.embedded) {
    getSharedManager().setRateLimit(ctx.name, max);
  } else if (ctx.tcp) {
    ctx.tcp.send({ cmd: "RateLimit", queue: ctx.name, limit: max });
  }
}
function removeGlobalRateLimit(ctx) {
  if (ctx.embedded) {
    getSharedManager().clearRateLimit(ctx.name);
  } else if (ctx.tcp) {
    ctx.tcp.send({ cmd: "RateLimitClear", queue: ctx.name });
  }
}
function getGlobalRateLimit(_ctx) {
  return Promise.resolve(null);
}
async function rateLimit(ctx, expireTimeMs) {
  if (ctx.embedded) {
    getSharedManager().setRateLimit(ctx.name, 1);
    setTimeout(() => {
      getSharedManager().clearRateLimit(ctx.name);
    }, expireTimeMs);
  } else if (ctx.tcp) {
    await ctx.tcp.send({ cmd: "RateLimit", queue: ctx.name, limit: 1 });
  }
}
function getRateLimitTtl(_ctx, _maxJobs) {
  return Promise.resolve(0);
}
function isMaxed(_ctx) {
  return Promise.resolve(false);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/scheduler.js
function toCronName(ctx, schedulerId) {
  return ctx.prefixKey ? `${ctx.prefixKey}${schedulerId}` : schedulerId;
}
function fromCronName(ctx, cronName) {
  if (ctx.prefixKey && cronName.startsWith(ctx.prefixKey)) {
    return cronName.slice(ctx.prefixKey.length);
  }
  return cronName;
}
function buildCronData(jobTemplate) {
  if (!jobTemplate)
    return {};
  return jobTemplate.name ? { name: jobTemplate.name, ...jobTemplate.data ?? {} } : jobTemplate.data ?? {};
}
function buildCronJobOptions(defaultJobOptions, jobTemplate) {
  const merged = { ...defaultJobOptions, ...jobTemplate?.opts };
  const opts = {};
  if (merged.attempts !== undefined)
    opts.maxAttempts = merged.attempts;
  if (merged.backoff !== undefined)
    opts.backoff = merged.backoff;
  if (merged.timeout !== undefined)
    opts.timeout = merged.timeout;
  if (merged.delay !== undefined)
    opts.delay = merged.delay;
  if (merged.stallTimeout !== undefined)
    opts.stallTimeout = merged.stallTimeout;
  if (typeof merged.removeOnComplete === "boolean")
    opts.removeOnComplete = merged.removeOnComplete;
  if (typeof merged.removeOnFail === "boolean")
    opts.removeOnFail = merged.removeOnFail;
  return Object.keys(opts).length > 0 ? opts : undefined;
}
function buildCronDedup(jobTemplate) {
  const dedup = jobTemplate?.opts?.deduplication;
  if (!dedup)
    return { uniqueKey: undefined, dedup: undefined };
  return {
    uniqueKey: dedup.id,
    dedup: { ttl: dedup.ttl, extend: dedup.extend, replace: dedup.replace }
  };
}
async function upsertJobScheduler(ctx, schedulerId, repeatOpts, jobTemplate) {
  const cronPattern = repeatOpts.pattern;
  const repeatEvery = repeatOpts.every;
  const data = buildCronData(jobTemplate);
  const dedupFields = buildCronDedup(jobTemplate);
  const jobOptions = buildCronJobOptions(ctx.defaultJobOptions, jobTemplate);
  const cronName = toCronName(ctx, schedulerId);
  const priority = jobTemplate?.opts?.priority ?? ctx.defaultJobOptions?.priority;
  if (ctx.embedded) {
    const manager = getSharedManager();
    manager.addCron({
      name: cronName,
      queue: ctx.name,
      data,
      schedule: cronPattern,
      repeatEvery,
      priority,
      timezone: repeatOpts.timezone ?? "UTC",
      skipMissedOnRestart: repeatOpts.skipMissedOnRestart,
      immediately: repeatOpts.immediately,
      skipIfNoWorker: repeatOpts.skipIfNoWorker,
      preventOverlap: repeatOpts.preventOverlap,
      jobOptions,
      ...dedupFields
    });
    return {
      id: schedulerId,
      name: jobTemplate?.name ?? "default",
      next: Date.now() + (repeatEvery ?? 60000)
    };
  }
  const response = await ctx.tcp.send({
    cmd: "Cron",
    name: cronName,
    queue: ctx.name,
    data,
    schedule: cronPattern,
    repeatEvery,
    priority,
    timezone: repeatOpts.timezone,
    skipMissedOnRestart: repeatOpts.skipMissedOnRestart,
    immediately: repeatOpts.immediately,
    skipIfNoWorker: repeatOpts.skipIfNoWorker,
    preventOverlap: repeatOpts.preventOverlap,
    jobOptions,
    ...dedupFields
  });
  if (!response.ok)
    return null;
  return {
    id: schedulerId,
    name: jobTemplate?.name ?? "default",
    next: response.nextRun ?? Date.now()
  };
}
async function removeJobScheduler(ctx, schedulerId) {
  const cronName = toCronName(ctx, schedulerId);
  if (ctx.embedded) {
    getSharedManager().removeCron(cronName);
    return true;
  }
  const response = await ctx.tcp.send({ cmd: "CronDelete", name: cronName });
  return response.ok === true;
}
async function getJobScheduler(ctx, schedulerId) {
  const cronName = toCronName(ctx, schedulerId);
  if (ctx.embedded) {
    const crons2 = getSharedManager().listCrons();
    const cron2 = crons2.find((c) => c.name === cronName && c.queue === ctx.name);
    if (!cron2)
      return null;
    return {
      id: fromCronName(ctx, cron2.name),
      name: fromCronName(ctx, cron2.name),
      next: cron2.nextRun,
      pattern: cron2.schedule ?? undefined,
      every: cron2.repeatEvery ?? undefined
    };
  }
  const response = await ctx.tcp.send({ cmd: "CronList" });
  if (!response.ok)
    return null;
  const crons = response.crons;
  const cron = crons?.find((c) => c.name === cronName && (c.queue === undefined || c.queue === ctx.name));
  if (!cron)
    return null;
  return {
    id: fromCronName(ctx, cron.name),
    name: fromCronName(ctx, cron.name),
    next: cron.nextRun,
    pattern: cron.schedule ?? undefined,
    every: cron.repeatEvery ?? undefined
  };
}
async function getJobSchedulers(ctx, _start = 0, _end = -1, _asc = true) {
  if (ctx.embedded) {
    return getSharedManager().listCrons().filter((c) => c.queue === ctx.name).map((c) => ({
      id: fromCronName(ctx, c.name),
      name: fromCronName(ctx, c.name),
      next: c.nextRun,
      pattern: c.schedule ?? undefined,
      every: c.repeatEvery ?? undefined
    }));
  }
  const response = await ctx.tcp.send({ cmd: "CronList" });
  if (!response.ok)
    return [];
  const crons = response.crons ?? [];
  return crons.filter((c) => c.queue === ctx.name).map((c) => ({
    id: fromCronName(ctx, c.name),
    name: fromCronName(ctx, c.name),
    next: c.nextRun,
    pattern: c.schedule ?? undefined,
    every: c.repeatEvery ?? undefined
  }));
}
async function getJobSchedulersCount(ctx) {
  const schedulers = await getJobSchedulers(ctx);
  return schedulers.length;
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/deduplication.js
function getDeduplicationJobId(ctx, deduplicationId) {
  if (ctx.embedded) {
    const job = getSharedManager().getJobByCustomId(deduplicationId);
    return Promise.resolve(job ? String(job.id) : null);
  }
  return Promise.resolve(null);
}
function removeDeduplicationKey(ctx, deduplicationId) {
  if (ctx.embedded) {
    const job = getSharedManager().getJobByCustomId(deduplicationId);
    if (job) {
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }
  return Promise.resolve(0);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/jobMove.js
async function moveJobToCompleted(ctx, id, returnValue, _token) {
  if (ctx.embedded) {
    await getSharedManager().ack(jobId(id), returnValue);
    return null;
  }
  await ctx.tcp.send({ cmd: "ACK", id, result: returnValue });
  return null;
}
async function moveJobToFailed(ctx, id, error2, _token) {
  if (ctx.embedded) {
    await getSharedManager().fail(jobId(id), error2.message);
  } else {
    await ctx.tcp.send({ cmd: "FAIL", id, error: error2.message });
  }
}
async function moveJobToWait(ctx, id, _token) {
  if (ctx.embedded) {
    const manager = getSharedManager();
    const state = await ctx.getJobState(id);
    if (state === "failed") {
      const job = await manager.getJob(jobId(id));
      if (!job)
        return false;
      const count2 = manager.retryDlq(job.queue, jobId(id));
      return count2 > 0;
    }
    if (state === "active") {
      return manager.moveActiveToWait(jobId(id));
    }
    if (state === "delayed") {
      return manager.promote(jobId(id));
    }
    if (state === "waiting" || state === "prioritized") {
      return true;
    }
    return false;
  }
  const response = await ctx.tcp.send({ cmd: "MoveToWait", id });
  return response.ok === true;
}
async function moveJobToDelayed2(ctx, id, timestamp, _token) {
  if (ctx.embedded) {
    const delay = Math.max(0, timestamp - Date.now());
    const manager = getSharedManager();
    const state = await ctx.getJobState(id);
    if (state === "failed") {
      const job = await manager.getJob(jobId(id));
      if (!job)
        return;
      const count2 = manager.retryDlq(job.queue, jobId(id));
      if (count2 > 0 && delay > 0) {
        await manager.changeWaitingDelay(jobId(id), delay);
      }
    } else if (state === "waiting" || state === "prioritized" || state === "delayed") {
      await manager.changeWaitingDelay(jobId(id), delay);
    } else {
      await manager.changeDelay(jobId(id), delay);
    }
  } else {
    await ctx.tcp.send({ cmd: "MoveToDelayed", id, timestamp });
  }
}
async function moveJobToWaitingChildren(ctx, id, _token, _opts) {
  if (ctx.embedded) {
    const manager = getSharedManager();
    return manager.moveToWaitingChildren(jobId(id));
  }
  return false;
}
async function waitJobUntilFinished(ctx, id, queueEvents, ttl) {
  return new Promise((resolve, reject) => {
    const timeout = ttl ? setTimeout(() => {
      cleanup2();
      reject(new Error(`Job ${id} timed out after ${ttl}ms`));
    }, ttl) : null;
    const events = queueEvents;
    const completedHandler = (data) => {
      if (data.jobId === id) {
        cleanup2();
        resolve(data.returnvalue);
      }
    };
    const failedHandler = (data) => {
      if (data.jobId === id) {
        cleanup2();
        reject(new Error(data.failedReason ?? "Job failed"));
      }
    };
    const cleanup2 = () => {
      if (timeout)
        clearTimeout(timeout);
      events.off("completed", completedHandler);
      events.off("failed", failedHandler);
    };
    events.on("completed", completedHandler);
    events.on("failed", failedHandler);
    ctx.getJobState(id).then((state) => {
      if (state === "completed") {
        cleanup2();
        if (ctx.embedded) {
          const result = getSharedManager().getResult(jobId(id));
          resolve(result);
        } else {
          resolve(undefined);
        }
      } else if (state === "failed") {
        cleanup2();
        reject(new Error("Job already failed"));
      }
    });
  });
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/workers.js
async function getWorkers(ctx) {
  if (ctx.embedded) {
    return [];
  }
  const response = await ctx.tcp.send({ cmd: "ListWorkers" });
  if (!response.ok)
    return [];
  return response.workers ?? [];
}
async function getWorkersCount(ctx) {
  const workers = await getWorkers(ctx);
  return workers.length;
}
async function getMetrics(ctx, type, _start, _end) {
  if (ctx.embedded) {
    const stats2 = getSharedManager().getStats();
    const count3 = type === "completed" ? stats2.completed : stats2.dlq;
    return { meta: { count: count3 }, data: [] };
  }
  const response = await ctx.tcp.send({ cmd: "Metrics" });
  if (!response.ok)
    return { meta: { count: 0 }, data: [] };
  const stats = response.stats;
  const count2 = type === "completed" ? stats?.completed ?? 0 : stats?.dlq ?? 0;
  return { meta: { count: count2 }, data: [] };
}
function trimEvents(_ctx, _maxLength) {
  return Promise.resolve(0);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/bullmqCompat.js
function getPrioritized(ctx, start = 0, end = -1) {
  return ctx.getPrioritizedAsync(start, end);
}
async function getPrioritizedCount(ctx) {
  const jobs = await ctx.getPrioritizedAsync(0, 1000);
  return jobs.length;
}
async function getWaitingChildren(ctx, start = 0, end = -1) {
  if (ctx.embedded) {
    const jobs = getSharedManager().getJobs(ctx.name, {
      state: "delayed",
      start,
      end: end === -1 ? 1000 : end
    });
    return jobs.filter((j) => {
      const data = j.data;
      return data?._waitingParent === true;
    }).map((job) => {
      const jobData = job.data;
      return toPublicJob({
        job,
        name: jobData?.name ?? "default",
        getState: ctx.getJobState,
        remove: ctx.removeAsync,
        retry: ctx.retryJob,
        getChildrenValues: ctx.getChildrenValues,
        updateData: ctx.updateJobData,
        promote: ctx.promoteJob,
        changeDelay: ctx.changeJobDelay,
        changePriority: ctx.changeJobPriority,
        extendLock: ctx.extendJobLock,
        clearLogs: ctx.clearJobLogs,
        getDependencies: ctx.getJobDependencies,
        getDependenciesCount: ctx.getJobDependenciesCount
      });
    });
  }
  return [];
}
async function getWaitingChildrenCount(ctx) {
  const children = await getWaitingChildren(ctx);
  return children.length;
}
function getDependencies(_ctx, _parentId, _type, _start, _end) {
  return Promise.resolve({ processed: {}, unprocessed: [] });
}
async function getJobDependencies(ctx, id, _opts) {
  if (ctx.embedded) {
    const manager = getSharedManager();
    const job = await manager.getJob(jobId(id));
    if (!job)
      return { processed: {}, unprocessed: [] };
    const childIds = job.childrenIds;
    const processed = {};
    const unprocessed = [];
    for (const childId of childIds) {
      const result = manager.getResult(childId);
      if (result !== undefined) {
        const childJob = await manager.getJob(childId);
        const key = childJob ? `${childJob.queue}:${childId}` : String(childId);
        processed[key] = result;
      } else {
        unprocessed.push(String(childId));
      }
    }
    return { processed, unprocessed };
  }
  return { processed: {}, unprocessed: [] };
}
async function getJobDependenciesCount(ctx, id, _opts) {
  if (ctx.embedded) {
    const deps = await getJobDependencies(ctx, id);
    return {
      processed: Object.keys(deps.processed).length,
      unprocessed: deps.unprocessed.length
    };
  }
  return { processed: 0, unprocessed: 0 };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/queue/queue.js
class Queue {
  name;
  queueKey;
  prefixKey;
  opts;
  embedded;
  tcpPool;
  useSharedPool;
  addBatcher;
  constructor(name, opts = {}) {
    this.name = name;
    this.prefixKey = opts.prefixKey ?? "";
    this.queueKey = this.prefixKey + name;
    this.opts = opts;
    this.embedded = opts.embedded ?? FORCE_EMBEDDED;
    if (this.embedded) {
      getSharedManager(opts.dataPath);
      this.tcpPool = null;
      this.useSharedPool = false;
      this.addBatcher = null;
    } else {
      const connOpts = opts.connection ?? {};
      const poolSize = connOpts.poolSize ?? 4;
      const token = resolveToken(connOpts.token);
      if (poolSize === 4 && !token) {
        this.tcpPool = getSharedPool({
          host: connOpts.host,
          port: connOpts.port,
          tls: connOpts.tls,
          poolSize,
          pingInterval: connOpts.pingInterval,
          commandTimeout: connOpts.commandTimeout,
          maxCommandTimeouts: connOpts.maxCommandTimeouts,
          pipelining: connOpts.pipelining,
          maxInFlight: connOpts.maxInFlight
        });
        this.useSharedPool = true;
      } else {
        this.tcpPool = new TcpConnectionPool({
          host: connOpts.host ?? "localhost",
          port: connOpts.port ?? 6789,
          token,
          tls: connOpts.tls,
          poolSize,
          pingInterval: connOpts.pingInterval,
          commandTimeout: connOpts.commandTimeout,
          maxCommandTimeouts: connOpts.maxCommandTimeouts,
          pipelining: connOpts.pipelining,
          maxInFlight: connOpts.maxInFlight
        });
        this.useSharedPool = false;
      }
      const autoBatch = opts.autoBatch;
      if (autoBatch?.enabled === false) {
        this.addBatcher = null;
      } else {
        this.addBatcher = new AddBatcher({
          maxSize: autoBatch?.maxSize ?? 50,
          maxDelayMs: autoBatch?.maxDelayMs ?? 5
        }, (jobs) => addBulk(this.addCtx, jobs));
      }
    }
  }
  get ctx() {
    return {
      name: this.queueKey,
      embedded: this.embedded,
      tcp: this.tcpPool,
      prefixKey: this.prefixKey
    };
  }
  get addCtx() {
    return {
      ...this.ctx,
      opts: this.opts,
      getJobState: (id) => this.getJobState(id),
      removeAsync: (id) => this.removeAsync(id),
      retryJob: (id) => this.retryJob(id),
      getChildrenValues: (id) => this.getChildrenValues(id),
      updateJobData: (id, data) => this.updateJobData(id, data),
      promoteJob: (id) => this.promoteJob(id),
      changeJobDelay: (id, delay) => this.changeJobDelay(id, delay),
      changeJobPriority: (id, opts) => this.changeJobPriority(id, opts),
      extendJobLock: (id, token, dur) => this.extendJobLock(id, token, dur),
      clearJobLogs: (id, keep) => this.clearJobLogs(id, keep),
      getJobDependencies: (id, o) => this.getJobDependencies(id, o),
      getJobDependenciesCount: (id, o) => this.getJobDependenciesCount(id, o),
      moveJobToCompleted: (id, r, t) => this.moveJobToCompleted(id, r, t),
      moveJobToFailed: (id, e, t) => this.moveJobToFailed(id, e, t),
      moveJobToWait: (id, t) => this.moveJobToWait(id, t),
      moveJobToDelayed: (id, ts, t) => this.moveJobToDelayed(id, ts, t),
      moveJobToWaitingChildren: (id, t, o) => this.moveJobToWaitingChildren(id, t, o),
      waitJobUntilFinished: (id, qe, ttl) => this.waitJobUntilFinished(id, qe, ttl)
    };
  }
  get queryCtx() {
    return {
      ...this.ctx,
      getJobState: (id) => this.getJobState(id),
      removeAsync: (id) => this.removeAsync(id),
      retryJob: (id) => this.retryJob(id),
      getChildrenValues: (id) => this.getChildrenValues(id),
      updateJobData: (id, data) => this.updateJobData(id, data),
      promoteJob: (id) => this.promoteJob(id),
      changeJobDelay: (id, delay) => this.changeJobDelay(id, delay),
      changeJobPriority: (id, opts) => this.changeJobPriority(id, opts),
      extendJobLock: (id, token, dur) => this.extendJobLock(id, token, dur),
      clearJobLogs: (id, keep) => this.clearJobLogs(id, keep),
      getJobDependencies: (id, o) => this.getJobDependencies(id, o),
      getJobDependenciesCount: (id, o) => this.getJobDependenciesCount(id, o),
      moveJobToCompleted: (id, r, t) => this.moveJobToCompleted(id, r, t),
      moveJobToFailed: (id, e, t) => this.moveJobToFailed(id, e, t),
      moveJobToWait: (id, t) => this.moveJobToWait(id, t),
      moveJobToDelayed: (id, ts, t) => this.moveJobToDelayed(id, ts, t),
      moveJobToWaitingChildren: (id, t, o) => this.moveJobToWaitingChildren(id, t, o),
      waitJobUntilFinished: (id, qe, ttl) => this.waitJobUntilFinished(id, qe, ttl)
    };
  }
  get moveCtx() {
    return {
      ...this.ctx,
      getJobState: (id) => this.getJobState(id),
      getJobDependencies: (id) => this.getJobDependencies(id)
    };
  }
  add(name, data, opts) {
    if (this.addBatcher && !opts?.durable) {
      return this.addBatcher.enqueue(name, data, opts);
    }
    return add(this.addCtx, name, data, opts);
  }
  addBulk(jobs) {
    return addBulk(this.addCtx, jobs);
  }
  getJob(id) {
    return getJob2(this.queryCtx, id);
  }
  getJobState(id) {
    return getJobState2(this.queryCtx, id);
  }
  getChildrenValues(id) {
    return getChildrenValues(this.queryCtx, id);
  }
  getJobs(opts) {
    return getJobs2(this.queryCtx, opts);
  }
  getJobsAsync(opts) {
    return getJobsAsync(this.queryCtx, opts);
  }
  getWaiting(start, end) {
    return getWaiting(this.queryCtx, start, end);
  }
  getWaitingAsync(start, end) {
    return getWaitingAsync(this.queryCtx, start, end);
  }
  getDelayed(start, end) {
    return getDelayed(this.queryCtx, start, end);
  }
  getDelayedAsync(start, end) {
    return getDelayedAsync(this.queryCtx, start, end);
  }
  getActive(start, end) {
    return getActive(this.queryCtx, start, end);
  }
  getActiveAsync(start, end) {
    return getActiveAsync(this.queryCtx, start, end);
  }
  getCompleted(start, end) {
    return getCompleted(this.queryCtx, start, end);
  }
  getCompletedAsync(start, end) {
    return getCompletedAsync(this.queryCtx, start, end);
  }
  getFailed(start, end) {
    return getFailed(this.queryCtx, start, end);
  }
  getFailedAsync(start, end) {
    return getFailedAsync(this.queryCtx, start, end);
  }
  getJobCounts() {
    return getJobCounts(this.ctx);
  }
  getJobCountsAsync() {
    return getJobCountsAsync(this.ctx);
  }
  getWaitingCount() {
    return getWaitingCount(this.ctx);
  }
  getActiveCount() {
    return getActiveCount(this.ctx);
  }
  getCompletedCount() {
    return getCompletedCount(this.ctx);
  }
  getFailedCount() {
    return getFailedCount(this.ctx);
  }
  getDelayedCount() {
    return getDelayedCount(this.ctx);
  }
  count() {
    return count(this.ctx);
  }
  countAsync() {
    return countAsync(this.ctx);
  }
  getCountsPerPriority() {
    return getCountsPerPriority(this.ctx);
  }
  getCountsPerPriorityAsync() {
    return getCountsPerPriorityAsync(this.ctx);
  }
  pause() {
    pause(this.ctx);
  }
  resume() {
    resume(this.ctx);
  }
  drain() {
    drain(this.ctx);
  }
  obliterate() {
    obliterate(this.ctx);
  }
  isPaused() {
    return isPaused(this.ctx);
  }
  isPausedAsync() {
    return isPausedAsync(this.ctx);
  }
  waitUntilReady() {
    return waitUntilReady(this.ctx);
  }
  remove(id) {
    remove(this.ctx, id);
  }
  removeAsync(id) {
    return removeAsync(this.ctx, id);
  }
  retryJob(id) {
    return retryJob(this.ctx, id);
  }
  retryJobs(opts) {
    return retryJobs(this.ctx, opts);
  }
  clean(grace, limit, type) {
    return clean(this.ctx, grace, limit, type);
  }
  cleanAsync(grace, limit, type) {
    return cleanAsync(this.ctx, grace, limit, type);
  }
  promoteJobs(opts) {
    return promoteJobs(this.ctx, opts);
  }
  promoteJob(id) {
    return promoteJob2(this.ctx, id);
  }
  updateJobProgress(id, progress) {
    return updateJobProgress2(this.ctx, id, progress);
  }
  getJobLogs(id, start, end, _asc) {
    return getJobLogs2(this.ctx, id, start, end);
  }
  addJobLog(id, logRow, _keepLogs) {
    return addJobLog2(this.ctx, id, logRow);
  }
  clearJobLogs(id, keepLogs) {
    return clearJobLogs2(this.ctx, id, keepLogs);
  }
  updateJobData(id, data) {
    return updateJobData2(this.ctx, id, data);
  }
  changeJobDelay(id, delay) {
    return changeJobDelay(this.ctx, id, delay);
  }
  changeJobPriority(id, opts) {
    return changeJobPriority2(this.ctx, id, opts);
  }
  extendJobLock(id, token, duration) {
    return extendJobLock(this.ctx, id, token, duration);
  }
  setStallConfig(config) {
    setStallConfig(this.ctx, config);
  }
  getStallConfig() {
    return getStallConfig(this.ctx);
  }
  getStallConfigAsync() {
    return getStallConfigAsync(this.ctx);
  }
  setDlqConfig(config) {
    setDlqConfig2(this.ctx, config);
  }
  getDlqConfig() {
    return getDlqConfig2(this.ctx);
  }
  getDlqConfigAsync() {
    return getDlqConfigAsync(this.ctx);
  }
  getDlq(filter) {
    return getDlq(this.ctx, filter);
  }
  getDlqStats() {
    return getDlqStats2(this.ctx);
  }
  retryDlq(id) {
    return retryDlq(this.ctx, id);
  }
  retryDlqByFilter(filter) {
    return retryDlqByFilter2(this.ctx, filter);
  }
  purgeDlq() {
    return purgeDlq(this.ctx);
  }
  retryCompleted(id) {
    return retryCompleted(this.ctx, id);
  }
  retryCompletedAsync(id) {
    return retryCompletedAsync(this.ctx, id);
  }
  setGlobalConcurrency(concurrency) {
    setGlobalConcurrency(this.ctx, concurrency);
  }
  removeGlobalConcurrency() {
    removeGlobalConcurrency(this.ctx);
  }
  getGlobalConcurrency() {
    return getGlobalConcurrency(this.ctx);
  }
  setGlobalRateLimit(max, duration) {
    setGlobalRateLimit(this.ctx, max, duration);
  }
  removeGlobalRateLimit() {
    removeGlobalRateLimit(this.ctx);
  }
  getGlobalRateLimit() {
    return getGlobalRateLimit(this.ctx);
  }
  rateLimit(expireTimeMs) {
    return rateLimit(this.ctx, expireTimeMs);
  }
  getRateLimitTtl(maxJobs) {
    return getRateLimitTtl(this.ctx, maxJobs);
  }
  isMaxed() {
    return isMaxed(this.ctx);
  }
  upsertJobScheduler(schedulerId, repeatOpts, jobTemplate) {
    return upsertJobScheduler({ ...this.ctx, defaultJobOptions: this.opts.defaultJobOptions }, schedulerId, repeatOpts, jobTemplate);
  }
  removeJobScheduler(schedulerId) {
    return removeJobScheduler(this.ctx, schedulerId);
  }
  getJobScheduler(schedulerId) {
    return getJobScheduler(this.ctx, schedulerId);
  }
  getJobSchedulers(start, end, asc) {
    return getJobSchedulers(this.ctx, start, end, asc);
  }
  getJobSchedulersCount() {
    return getJobSchedulersCount(this.ctx);
  }
  getDeduplicationJobId(deduplicationId) {
    return getDeduplicationJobId(this.ctx, deduplicationId);
  }
  removeDeduplicationKey(deduplicationId) {
    return removeDeduplicationKey(this.ctx, deduplicationId);
  }
  moveJobToCompleted(id, returnValue, token) {
    return moveJobToCompleted(this.moveCtx, id, returnValue, token);
  }
  moveJobToFailed(id, error2, token) {
    return moveJobToFailed(this.moveCtx, id, error2, token);
  }
  moveJobToWait(id, token) {
    return moveJobToWait(this.moveCtx, id, token);
  }
  moveJobToDelayed(id, timestamp, token) {
    return moveJobToDelayed2(this.moveCtx, id, timestamp, token);
  }
  moveJobToWaitingChildren(id, token, opts) {
    return moveJobToWaitingChildren(this.moveCtx, id, token, opts);
  }
  waitJobUntilFinished(id, queueEvents, ttl) {
    return waitJobUntilFinished(this.moveCtx, id, queueEvents, ttl);
  }
  getJobDependencies(id, opts) {
    return getJobDependencies(this.addCtx, id, opts);
  }
  getJobDependenciesCount(id, opts) {
    return getJobDependenciesCount(this.addCtx, id, opts);
  }
  getDependencies(parentId, type, start, end) {
    return getDependencies(this.addCtx, parentId, type, start, end);
  }
  getPrioritized(start, end) {
    return getPrioritized({
      ...this.addCtx,
      getWaitingAsync: (s2, e) => this.getWaitingAsync(s2, e),
      getPrioritizedAsync: (s2, e) => this.getJobsAsync({ state: "prioritized", start: s2, end: e })
    }, start, end);
  }
  getPrioritizedCount() {
    return getPrioritizedCount({
      ...this.addCtx,
      getWaitingAsync: (s2, e) => this.getWaitingAsync(s2, e),
      getPrioritizedAsync: (s2, e) => this.getJobsAsync({ state: "prioritized", start: s2, end: e })
    });
  }
  getWaitingChildren(start, end) {
    return getWaitingChildren(this.addCtx, start, end);
  }
  getWaitingChildrenCount() {
    return getWaitingChildrenCount(this.addCtx);
  }
  trimEvents(maxLength) {
    return trimEvents(this.ctx, maxLength);
  }
  getWorkers() {
    return getWorkers(this.ctx);
  }
  getWorkersCount() {
    return getWorkersCount(this.ctx);
  }
  getMetrics(type, start, end) {
    return getMetrics(this.ctx, type, start, end);
  }
  forward(options) {
    return new Forwarder({
      name: this.name,
      queueKey: this.queueKey,
      prefixKey: this.prefixKey || undefined,
      embedded: this.embedded,
      dataPath: this.opts.dataPath,
      connection: this.opts.connection
    }, options, Queue);
  }
  async disconnect() {
    if (this.addBatcher) {
      await this.addBatcher.flush();
      await this.addBatcher.waitForInFlight();
      this.addBatcher.stop();
    }
    this.close();
  }
  close() {
    this.addBatcher?.stop();
    if (this.tcpPool) {
      if (this.useSharedPool)
        releaseSharedPool(this.tcpPool);
      else
        this.tcpPool.close();
    }
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/dlqRateLimit.js
class DlqRateLimitManager {
  queue;
  constructor(queue) {
    this.queue = queue;
  }
  setDlqConfig(config) {
    this.queue.setDlqConfig(config);
  }
  getDlqConfig() {
    return this.queue.getDlqConfig();
  }
  getDlq(filter) {
    return this.queue.getDlq(filter);
  }
  getDlqStats() {
    return this.queue.getDlqStats();
  }
  retryDlq(id) {
    return this.queue.retryDlq(id);
  }
  purgeDlq() {
    return this.queue.purgeDlq();
  }
  setGlobalRateLimit(max, duration) {
    this.queue.setGlobalRateLimit(max, duration);
  }
  removeGlobalRateLimit() {
    this.queue.removeGlobalRateLimit();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/retry.js
function calculateBackoff2(strategy, attempt, baseDelay, error2, config) {
  switch (strategy) {
    case "fixed":
      return baseDelay;
    case "exponential":
      return baseDelay * Math.pow(2, attempt - 1);
    case "jitter": {
      const exp = baseDelay * Math.pow(2, attempt - 1);
      return Math.floor(exp * (0.5 + Math.random()));
    }
    case "fibonacci": {
      let a = 1, b2 = 1;
      for (let i = 0;i < attempt - 1; i++) {
        const next = a + b2;
        a = b2;
        b2 = next;
      }
      return baseDelay * b2;
    }
    case "custom":
      if (config.customBackoff) {
        return config.customBackoff(attempt, error2);
      }
      return baseDelay;
    default:
      return baseDelay;
  }
}
function executeWithRetry(fn, config) {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelay = config.delay ?? 1000;
  const strategy = config.strategy ?? "exponential";
  const attempt = (n) => {
    return fn().catch((err) => {
      const error2 = err instanceof Error ? err : new Error(String(err));
      if (n >= maxAttempts)
        throw error2;
      if (config.retryIf && !config.retryIf(error2, n))
        throw error2;
      const delay = calculateBackoff2(strategy, n, baseDelay, error2, config);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(attempt(n + 1));
        }, delay);
      });
    });
  };
  return attempt(1);
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/circuitBreaker.js
class WorkerCircuitBreaker {
  state = "closed";
  failures = 0;
  timer = null;
  config;
  worker;
  constructor(config, worker) {
    this.config = config;
    this.worker = worker;
  }
  get currentState() {
    return this.state;
  }
  isOpen() {
    return this.state === "open";
  }
  onSuccess() {
    if (this.state === "half-open") {
      this.state = "closed";
      this.failures = 0;
      this.config.onClose?.();
    } else if (this.state === "closed") {
      this.failures = 0;
    }
  }
  onFailure() {
    this.failures++;
    const threshold = this.config.threshold ?? 5;
    if (this.state === "half-open" || this.failures >= threshold) {
      this.open();
    }
  }
  open() {
    this.state = "open";
    this.config.onOpen?.(this.failures);
    this.worker.pause();
    const resetTimeout = this.config.resetTimeout ?? 30000;
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.state = "half-open";
      this.config.onHalfOpen?.();
      this.worker.resume();
    }, resetTimeout);
  }
  reset() {
    this.state = "closed";
    this.failures = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.worker.isPaused()) {
      this.worker.resume();
    }
  }
  destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/batch.js
class BatchAccumulator {
  buffer = [];
  timer = null;
  config;
  constructor(config) {
    this.config = config;
  }
  buildProcessor() {
    return (job) => {
      return new Promise((resolve, reject) => {
        this.buffer.push({ job, resolve, reject });
        if (this.buffer.length >= this.config.size) {
          this.flush();
        } else if (!this.timer) {
          const timeout = this.config.timeout ?? 5000;
          this.timer = setTimeout(() => {
            this.flush();
          }, timeout);
        }
      });
    };
  }
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.buffer.splice(0);
    if (batch.length === 0)
      return;
    const jobs = batch.map((b2) => b2.job);
    this.config.processor(jobs).then((results) => {
      for (let i = 0;i < batch.length; i++) {
        batch[i].resolve(results[i] ?? undefined);
      }
    }, (err) => {
      const error2 = err instanceof Error ? err : new Error(String(err));
      for (const b2 of batch) {
        b2.reject(error2);
      }
    });
  }
  destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      this.flush();
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/triggers.js
class TriggerManager {
  rules = [];
  active = false;
  queue;
  worker;
  constructor(queue, worker) {
    this.queue = queue;
    this.worker = worker;
  }
  add(rule) {
    this.rules.push(rule);
    this.ensureActive();
  }
  ensureActive() {
    if (this.active)
      return;
    this.active = true;
    this.worker.on("completed", (job, result) => {
      this.fire("completed", job, result);
    });
    this.worker.on("failed", (job, error2) => {
      this.fire("failed", job, error2);
    });
  }
  fire(event, job, resultOrError) {
    for (const rule of this.rules) {
      if (rule.on !== job.name)
        continue;
      if ((rule.event ?? "completed") !== event)
        continue;
      if (rule.condition && !rule.condition(resultOrError, job))
        continue;
      const data = rule.data(resultOrError, job);
      this.queue.add(rule.create, data, rule.opts);
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/aging.js
class PriorityAger {
  timer = null;
  config;
  queue;
  constructor(config, queue) {
    this.config = config;
    this.queue = queue;
  }
  start() {
    const interval = this.config.interval ?? 60000;
    this.timer = setInterval(() => {
      this.tick();
    }, interval);
  }
  async tick() {
    const minAge = this.config.minAge ?? 60000;
    const boost = this.config.boost ?? 1;
    const maxPriority = this.config.maxPriority ?? 100;
    const maxScan = this.config.maxScan ?? 100;
    const [waiting, prioritized] = await Promise.all([
      this.queue.getWaitingAsync(0, maxScan),
      this.queue.getJobsAsync({ state: "prioritized", start: 0, end: maxScan })
    ]);
    const jobs = [...waiting, ...prioritized];
    const now = Date.now();
    for (const job of jobs) {
      const age = now - job.timestamp;
      if (age >= minAge && job.priority < maxPriority) {
        const newPriority = Math.min(job.priority + boost, maxPriority);
        try {
          await this.queue.changeJobPriority(job.id, {
            priority: newPriority
          });
        } catch {}
      }
    }
  }
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/cancellation.js
class CancellationManager {
  controllers = new Map;
  register(jobId2) {
    const ac = new AbortController;
    this.controllers.set(jobId2, ac);
    return ac;
  }
  unregister(jobId2) {
    this.controllers.delete(jobId2);
  }
  cancel(jobId2, gracePeriodMs = 0) {
    const ac = this.controllers.get(jobId2);
    if (!ac)
      return;
    if (gracePeriodMs > 0) {
      setTimeout(() => {
        ac.abort();
      }, gracePeriodMs);
    } else {
      ac.abort();
    }
  }
  isCancelled(jobId2) {
    const ac = this.controllers.get(jobId2);
    return ac ? ac.signal.aborted : false;
  }
  getSignal(jobId2) {
    return this.controllers.get(jobId2)?.signal ?? null;
  }
  destroyAll() {
    for (const ac of this.controllers.values()) {
      ac.abort();
    }
    this.controllers.clear();
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/ttl.js
class TtlChecker {
  config;
  constructor(config) {
    this.config = config;
  }
  getTtl(jobName) {
    return this.config.perName?.[jobName] ?? this.config.defaultTtl ?? 0;
  }
  isExpired(jobName, jobTimestamp) {
    const ttl = this.getTtl(jobName);
    if (ttl <= 0)
      return false;
    return Date.now() - jobTimestamp > ttl;
  }
  setDefaultTtl(ttlMs) {
    this.config.defaultTtl = ttlMs;
  }
  setNameTtl(jobName, ttlMs) {
    this.config.perName ??= {};
    this.config.perName[jobName] = ttlMs;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue/dedupDebounce.js
class DedupDebounceMerger {
  dedup;
  debounce;
  constructor(dedup, debounce) {
    this.dedup = dedup;
    this.debounce = debounce;
  }
  get active() {
    return this.dedup !== null || this.debounce !== null;
  }
  merge(name, opts, data) {
    if (!this.active)
      return opts;
    const merged = { ...opts };
    if (this.dedup && !merged.deduplication) {
      const dataKey = data !== undefined ? JSON.stringify(data) : "";
      merged.deduplication = {
        id: `${name}:${dataKey}`,
        ttl: this.dedup.ttl ?? 3600000,
        extend: this.dedup.extend,
        replace: this.dedup.replace
      };
    }
    if (this.debounce && !merged.debounce) {
      merged.debounce = {
        id: name,
        ttl: this.debounce.ttl
      };
    }
    return merged;
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/bunqueue.js
class Bunqueue {
  name;
  queue;
  worker;
  middlewares = [];
  baseProcessor;
  cb;
  retryConfig;
  triggerMgr;
  ager;
  cancellation = new CancellationManager;
  ttlChecker;
  batchAcc;
  merger;
  dlqrl;
  constructor(name, opts) {
    const modes = [opts.processor, opts.routes, opts.batch].filter(Boolean).length;
    if (modes === 0)
      throw new Error('Bunqueue requires "processor", "routes", or "batch"');
    if (modes > 1)
      throw new Error('Bunqueue: use only one of "processor", "routes", or "batch"');
    this.name = name;
    this.retryConfig = opts.retry ?? null;
    this.ttlChecker = opts.ttl ? new TtlChecker(opts.ttl) : null;
    this.merger = new DedupDebounceMerger(opts.deduplication ?? null, opts.debounce ?? null);
    if (opts.batch) {
      this.batchAcc = new BatchAccumulator(opts.batch);
      this.baseProcessor = this.batchAcc.buildProcessor();
    } else {
      this.batchAcc = null;
      this.baseProcessor = opts.routes ? this.buildRouteProcessor(opts.routes) : opts.processor;
    }
    const self = this;
    const wrappedProcessor = (job) => self.processJob(job);
    this.queue = new Queue(name, this.buildQueueOpts(opts));
    this.worker = new Worker2(name, wrappedProcessor, this.buildWorkerOpts(opts));
    this.dlqrl = new DlqRateLimitManager(this.queue);
    if (opts.dlq)
      this.dlqrl.setDlqConfig(opts.dlq);
    this.cb = opts.circuitBreaker ? new WorkerCircuitBreaker(opts.circuitBreaker, this.worker) : null;
    this.triggerMgr = new TriggerManager(this.queue, this.worker);
    this.ager = opts.priorityAging ? new PriorityAger(opts.priorityAging, this.queue) : null;
    this.ager?.start();
  }
  buildRouteProcessor(routes) {
    const routeMap = routes;
    return (job) => {
      const handler = routeMap[job.name];
      if (!handler)
        throw new Error(`No route for job "${job.name}" in queue "${this.name}"`);
      return handler(job);
    };
  }
  buildQueueOpts(opts) {
    return {
      connection: opts.connection,
      embedded: opts.embedded,
      dataPath: opts.dataPath,
      defaultJobOptions: opts.defaultJobOptions,
      autoBatch: opts.autoBatch,
      prefixKey: opts.prefixKey
    };
  }
  buildWorkerOpts(opts) {
    return {
      connection: opts.connection,
      embedded: opts.embedded,
      dataPath: opts.dataPath,
      concurrency: opts.concurrency,
      autorun: opts.autorun,
      heartbeatInterval: opts.heartbeatInterval,
      batchSize: opts.batchSize,
      pollTimeout: opts.pollTimeout,
      limiter: opts.rateLimit ?? opts.limiter,
      removeOnComplete: opts.removeOnComplete,
      removeOnFail: opts.removeOnFail,
      prefixKey: opts.prefixKey
    };
  }
  processJob(job) {
    if (this.cb?.isOpen()) {
      return Promise.reject(new Error("Circuit breaker is open"));
    }
    if (this.ttlChecker?.isExpired(job.name, job.timestamp)) {
      return Promise.reject(new Error(`Job expired (age: ${Date.now() - job.timestamp}ms)`));
    }
    const ac = this.cancellation.register(job.id);
    const runChain = () => this.runMiddlewareChain(job, ac);
    const execute = this.retryConfig ? executeWithRetry(runChain, this.retryConfig) : runChain();
    return execute.then((result) => {
      this.cb?.onSuccess();
      this.cancellation.unregister(job.id);
      return result;
    }, (err) => {
      this.cb?.onFailure();
      this.cancellation.unregister(job.id);
      throw err;
    });
  }
  runMiddlewareChain(job, ac) {
    const asJob = job;
    if (this.middlewares.length === 0) {
      const result = this.baseProcessor(job);
      return result instanceof Promise ? result : Promise.resolve(result);
    }
    let index = 0;
    const mws = this.middlewares;
    const base = this.baseProcessor;
    const next = () => {
      if (ac.signal.aborted)
        return Promise.reject(new Error("Job cancelled"));
      if (index < mws.length)
        return mws[index++](asJob, next);
      const result = base(job);
      return result instanceof Promise ? result : Promise.resolve(result);
    };
    return next();
  }
  use(middleware) {
    this.middlewares.push(middleware);
    return this;
  }
  add(name, data, opts) {
    return this.queue.add(name, data, this.merger.merge(name, opts, data));
  }
  addBulk(jobs) {
    return this.queue.addBulk(jobs.map((j) => ({ ...j, opts: this.merger.merge(j.name, j.opts, j.data) })));
  }
  getJob(id) {
    return this.queue.getJob(id);
  }
  getJobCounts() {
    return this.queue.getJobCounts();
  }
  getJobCountsAsync() {
    return this.queue.getJobCountsAsync();
  }
  count() {
    return this.queue.count();
  }
  countAsync() {
    return this.queue.countAsync();
  }
  cron(id, pattern, data, opts) {
    return this.queue.upsertJobScheduler(id, { pattern, timezone: opts?.timezone }, { name: id, data, opts: opts?.jobOpts });
  }
  every(id, intervalMs, data, opts) {
    return this.queue.upsertJobScheduler(id, { every: intervalMs }, { name: id, data, opts: opts?.jobOpts });
  }
  removeCron(id) {
    return this.queue.removeJobScheduler(id);
  }
  listCrons() {
    return this.queue.getJobSchedulers();
  }
  cancel(jobId2, gracePeriodMs = 0) {
    this.cancellation.cancel(jobId2, gracePeriodMs);
  }
  isCancelled(jobId2) {
    return this.cancellation.isCancelled(jobId2);
  }
  getSignal(jobId2) {
    return this.cancellation.getSignal(jobId2);
  }
  getCircuitState() {
    return this.cb?.currentState ?? "closed";
  }
  resetCircuit() {
    this.cb?.reset();
  }
  trigger(rule) {
    this.triggerMgr.add(rule);
    return this;
  }
  setDefaultTtl(ttlMs) {
    this.ttlChecker?.setDefaultTtl(ttlMs);
  }
  setNameTtl(name, ttlMs) {
    this.ttlChecker?.setNameTtl(name, ttlMs);
  }
  setDlqConfig(config) {
    this.dlqrl.setDlqConfig(config);
  }
  getDlqConfig() {
    return this.dlqrl.getDlqConfig();
  }
  getDlq(filter) {
    return this.dlqrl.getDlq(filter);
  }
  getDlqStats() {
    return this.dlqrl.getDlqStats();
  }
  retryDlq(id) {
    return this.dlqrl.retryDlq(id);
  }
  purgeDlq() {
    return this.dlqrl.purgeDlq();
  }
  setGlobalRateLimit(max, duration) {
    this.dlqrl.setGlobalRateLimit(max, duration);
  }
  removeGlobalRateLimit() {
    this.dlqrl.removeGlobalRateLimit();
  }
  on(event, listener) {
    this.worker.on(event, listener);
    return this;
  }
  once(event, listener) {
    this.worker.once(event, listener);
    return this;
  }
  off(event, listener) {
    this.worker.off(event, listener);
    return this;
  }
  pause() {
    this.queue.pause();
    this.worker.pause();
  }
  resume() {
    this.queue.resume();
    this.worker.resume();
  }
  async close(force = false) {
    this.ager?.destroy();
    this.cb?.destroy();
    this.batchAcc?.destroy();
    this.cancellation.destroyAll();
    await this.worker.close(force);
    this.queue.close();
  }
  isRunning() {
    return this.worker.isRunning();
  }
  isPaused() {
    return this.worker.isPaused();
  }
  isClosed() {
    return this.worker.isClosed();
  }
}
// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/flow.js
import { EventEmitter as EventEmitter5 } from "events";

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/flowJobFactory.js
function extractUserDataFromInternal(data) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("__") && key !== "name") {
      result[key] = value;
    }
  }
  return result;
}
function createFlowJobObject(id, name, data, queueName, callbacks) {
  const ts = Date.now();
  const embedded = !!callbacks?.embedded;
  const tcp = callbacks?.tcp ?? null;
  const stateAsType = (s2) => {
    const valid = [
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "prioritized",
      "waiting-children",
      "unknown"
    ];
    return valid.includes(s2) ? s2 : "unknown";
  };
  const getStateInternal = () => {
    if (callbacks?.getState)
      return callbacks.getState(id).then(stateAsType);
    if (embedded) {
      return getSharedManager().getJobState(jobId(id)).then((s2) => stateAsType(s2));
    }
    if (tcp) {
      return tcp.send({ cmd: "GetState", id }).then((r) => {
        const s2 = r.state ?? "unknown";
        return stateAsType(s2);
      });
    }
    return Promise.resolve("unknown");
  };
  return {
    id,
    name,
    data,
    queueName,
    attemptsMade: 0,
    timestamp: ts,
    progress: 0,
    delay: 0,
    processedOn: undefined,
    finishedOn: undefined,
    stacktrace: null,
    stalledCounter: 0,
    priority: 0,
    parentKey: undefined,
    opts: {},
    token: undefined,
    processedBy: undefined,
    deduplicationId: undefined,
    repeatJobKey: undefined,
    attemptsStarted: 0,
    updateProgress: async (progress) => {
      if (callbacks?.updateProgress) {
        return callbacks.updateProgress(id, progress);
      }
      if (embedded) {
        await getSharedManager().updateProgress(jobId(id), progress);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Progress", id, progress });
    },
    log: async (message) => {
      if (callbacks?.log)
        return callbacks.log(id, message);
      if (embedded) {
        getSharedManager().addLog(jobId(id), message);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "AddLog", id, message });
    },
    getState: getStateInternal,
    remove: async () => {
      if (callbacks?.remove)
        return callbacks.remove(id);
      if (embedded) {
        await getSharedManager().cancel(jobId(id));
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Cancel", id });
    },
    retry: async () => {
      if (callbacks?.retry)
        return callbacks.retry(id);
      if (embedded) {
        const mgr = getSharedManager();
        const state = await mgr.getJobState(jobId(id));
        if (state === "failed") {
          const count2 = mgr.retryDlq(queueName, jobId(id));
          if (count2 === 0)
            throw new Error(`Job ${id} is failed but not present in DLQ`);
          return;
        }
        if (state === "active") {
          const ok = await mgr.moveActiveToWait(jobId(id));
          if (!ok)
            throw new Error(`Failed to retry active job ${id}`);
          return;
        }
        if (state === "waiting" || state === "prioritized" || state === "delayed")
          return;
        throw new Error(`Cannot retry job ${id} from state '${state}'`);
      }
      if (!tcp)
        return;
      const res = await tcp.send({ cmd: "MoveToWait", id });
      if (res.ok !== true) {
        const err = typeof res.error === "string" ? res.error : "retry failed";
        throw new Error(err);
      }
    },
    getChildrenValues: async () => {
      if (embedded) {
        return await getSharedManager().getChildrenValues(jobId(id));
      }
      if (!tcp)
        return {};
      const res = await tcp.send({ cmd: "GetChildrenValues", id });
      const vals = res.data?.values ?? {};
      return vals;
    },
    isWaiting: async () => await getStateInternal() === "waiting",
    isActive: async () => await getStateInternal() === "active",
    isDelayed: async () => await getStateInternal() === "delayed",
    isCompleted: async () => await getStateInternal() === "completed",
    isFailed: async () => await getStateInternal() === "failed",
    isWaitingChildren: async () => await getStateInternal() === "waiting-children",
    updateData: async (newData) => {
      if (callbacks?.updateData)
        return callbacks.updateData(id, newData);
      if (embedded) {
        await getSharedManager().updateJobData(jobId(id), newData);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Update", id, data: newData });
    },
    promote: async () => {
      if (callbacks?.promote)
        return callbacks.promote(id);
      if (embedded) {
        await getSharedManager().promote(jobId(id));
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "Promote", id });
    },
    changeDelay: async (delay) => {
      if (callbacks?.changeDelay)
        return callbacks.changeDelay(id, delay);
      if (embedded) {
        await getSharedManager().changeDelay(jobId(id), delay);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "ChangeDelay", id, delay });
    },
    changePriority: async (opts) => {
      if (callbacks?.changePriority) {
        return callbacks.changePriority(id, { priority: opts.priority, lifo: opts.lifo });
      }
      if (embedded) {
        await getSharedManager().changePriority(jobId(id), opts.priority, opts.lifo);
        return;
      }
      if (tcp) {
        await tcp.send({ cmd: "ChangePriority", id, priority: opts.priority, lifo: opts.lifo });
      }
    },
    extendLock: async (token, duration) => {
      if (embedded) {
        const ok = await getSharedManager().extendLock(jobId(id), token, duration);
        return ok ? duration : 0;
      }
      if (!tcp)
        return 0;
      const res = await tcp.send({ cmd: "ExtendLock", id, token, duration });
      return res.ok === true ? duration : 0;
    },
    clearLogs: async (keepLogs) => {
      if (callbacks?.clearLogs)
        return callbacks.clearLogs(id);
      if (embedded) {
        getSharedManager().clearLogs(jobId(id), keepLogs);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "ClearLogs", id, keepLogs });
    },
    getDependencies: async () => {
      const childIds = await fetchChildIds(id, embedded, tcp);
      return computeDepsFlow(queueName, childIds, embedded, tcp);
    },
    getDependenciesCount: async () => {
      const childIds = await fetchChildIds(id, embedded, tcp);
      const deps = await computeDepsFlow(queueName, childIds, embedded, tcp);
      return {
        processed: Object.keys(deps.processed).length,
        unprocessed: deps.unprocessed.length
      };
    },
    toJSON: () => ({
      id,
      name,
      data,
      opts: {},
      progress: 0,
      delay: 0,
      timestamp: ts,
      attemptsMade: 0,
      stacktrace: null,
      queueQualifiedName: `bull:${queueName}`
    }),
    asJSON: () => ({
      id,
      name,
      data: JSON.stringify(data),
      opts: "{}",
      progress: "0",
      delay: "0",
      timestamp: String(ts),
      attemptsMade: "0",
      stacktrace: null
    }),
    moveToCompleted: async (returnValue) => {
      if (embedded) {
        await getSharedManager().ack(jobId(id), returnValue);
        return null;
      }
      if (tcp)
        await tcp.send({ cmd: "ACK", id, result: returnValue });
      return null;
    },
    moveToFailed: async (error2) => {
      if (embedded) {
        await getSharedManager().fail(jobId(id), error2.message);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "FAIL", id, error: error2.message });
    },
    moveToWait: async () => {
      if (embedded)
        return await getSharedManager().moveActiveToWait(jobId(id));
      if (!tcp)
        return false;
      const res = await tcp.send({ cmd: "MoveToWait", id });
      return res.ok === true;
    },
    moveToDelayed: async (timestamp) => {
      const delay = Math.max(0, timestamp - Date.now());
      if (embedded) {
        await getSharedManager().moveToDelayed(jobId(id), delay);
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "MoveToDelayed", id, delay });
    },
    moveToWaitingChildren: async () => {
      if (embedded)
        return await getSharedManager().moveToWaitingChildren(jobId(id));
      throw new Error("moveToWaitingChildren is not supported in TCP mode \u2014 no server command available");
    },
    waitUntilFinished: async (_qe, ttl) => {
      const timeout = ttl ?? 30000;
      if (embedded) {
        const mgr = getSharedManager();
        const job = await mgr.getJob(jobId(id));
        if (!job)
          throw new Error(`Job ${id} not found`);
        if (job.completedAt)
          return mgr.getResult(jobId(id));
        const ok = await mgr.waitForJobCompletion(jobId(id), timeout);
        if (!ok)
          throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
        return mgr.getResult(jobId(id));
      }
      if (!tcp)
        throw new Error("waitUntilFinished: no connection");
      const res = await tcp.send({ cmd: "WaitJob", id, timeout });
      const typed = res;
      if (!typed.completed)
        throw new Error(`waitUntilFinished timed out after ${timeout}ms`);
      return typed.result;
    },
    discard: () => {
      if (embedded) {
        getSharedManager().discard(jobId(id));
        return;
      }
      if (tcp)
        tcp.send({ cmd: "Discard", id });
    },
    getFailedChildrenValues: async () => {
      if (embedded)
        return await getSharedManager().getFailedChildrenValues(jobId(id));
      if (!tcp)
        return {};
      const res = await tcp.send({ cmd: "GetFailedChildrenValues", id });
      return res.values ?? {};
    },
    getIgnoredChildrenFailures: async () => {
      if (embedded)
        return await getSharedManager().getIgnoredChildrenFailures(jobId(id));
      if (!tcp)
        return {};
      const res = await tcp.send({ cmd: "GetIgnoredChildrenFailures", id });
      return res.values ?? {};
    },
    removeChildDependency: async () => {
      if (embedded)
        return await getSharedManager().removeChildDependency(jobId(id));
      if (!tcp)
        return false;
      const res = await tcp.send({ cmd: "RemoveChildDependency", id });
      return res.removed ?? false;
    },
    removeDeduplicationKey: () => Promise.reject(new Error("removeDeduplicationKey is not implemented \u2014 no server primitive available")),
    removeUnprocessedChildren: async () => {
      if (embedded) {
        await getSharedManager().removeUnprocessedChildren(jobId(id));
        return;
      }
      if (tcp)
        await tcp.send({ cmd: "RemoveUnprocessedChildren", id });
    }
  };
}
async function fetchChildIds(id, embedded, tcp) {
  if (embedded) {
    const job = await getSharedManager().getJob(jobId(id));
    return (job?.childrenIds ?? []).map(String);
  }
  if (!tcp)
    return [];
  const jobRes = await tcp.send({ cmd: "GetJob", id });
  const parent = jobRes.job;
  return (parent?.childrenIds ?? []).map(String);
}
async function computeDepsFlow(queueName, childIds, embedded, tcp) {
  const processed = {};
  const unprocessed = [];
  for (const cid of childIds) {
    let state = "unknown";
    let result;
    if (embedded) {
      const mgr = getSharedManager();
      state = await mgr.getJobState(jobId(cid));
      if (state === "completed")
        result = mgr.getResult(jobId(cid));
    } else if (tcp) {
      const r = await tcp.send({ cmd: "GetState", id: cid });
      state = r.state ?? "unknown";
      if (state === "completed") {
        const rr = await tcp.send({ cmd: "GetResult", id: cid });
        result = rr.result;
      }
    }
    const key = `${queueName}:${cid}`;
    if (state === "completed" || state === "failed") {
      processed[key] = result ?? null;
    } else {
      unprocessed.push(key);
    }
  }
  return { processed, unprocessed };
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/flowPush.js
function parseRemoveOptions(opts) {
  return {
    removeOnComplete: typeof opts.removeOnComplete === "boolean" ? opts.removeOnComplete : false,
    removeOnFail: typeof opts.removeOnFail === "boolean" ? opts.removeOnFail : false
  };
}
function normalizeRepeat(repeat) {
  if (!repeat)
    return;
  const toMs = (d) => d instanceof Date ? d.getTime() : typeof d === "string" ? new Date(d).getTime() : d;
  return {
    every: repeat.every,
    limit: repeat.limit,
    pattern: repeat.pattern,
    count: repeat.count,
    startDate: toMs(repeat.startDate),
    endDate: toMs(repeat.endDate),
    tz: repeat.tz,
    immediately: repeat.immediately,
    prevMillis: repeat.prevMillis,
    offset: repeat.offset,
    jobId: repeat.jobId
  };
}
function dedupConfig(opts) {
  return opts.deduplication ? {
    ttl: opts.deduplication.ttl,
    extend: opts.deduplication.extend,
    replace: opts.deduplication.replace
  } : undefined;
}
function managerOptions(opts) {
  return {
    priority: opts.priority,
    delay: opts.delay,
    maxAttempts: opts.attempts,
    backoff: opts.backoff,
    timeout: opts.timeout,
    customId: opts.jobId ?? opts.deduplication?.id,
    uniqueKey: opts.deduplication?.id,
    dedup: dedupConfig(opts),
    lifo: opts.lifo,
    stallTimeout: opts.stallTimeout,
    durable: opts.durable,
    stackTraceLimit: opts.stackTraceLimit,
    keepLogs: opts.keepLogs,
    sizeLimit: opts.sizeLimit,
    timestamp: opts.timestamp,
    repeat: normalizeRepeat(opts.repeat),
    debounceId: opts.debounce?.id,
    debounceTtl: opts.debounce?.ttl,
    failParentOnFailure: opts.failParentOnFailure,
    removeDependencyOnFailure: opts.removeDependencyOnFailure,
    ignoreDependencyOnFailure: opts.ignoreDependencyOnFailure,
    continueParentOnFailure: opts.continueParentOnFailure
  };
}
function tcpOptions(opts) {
  return {
    priority: opts.priority,
    delay: opts.delay,
    maxAttempts: opts.attempts,
    backoff: opts.backoff,
    timeout: opts.timeout,
    jobId: opts.jobId,
    uniqueKey: opts.deduplication?.id,
    dedup: dedupConfig(opts),
    lifo: opts.lifo,
    stallTimeout: opts.stallTimeout,
    durable: opts.durable,
    stackTraceLimit: opts.stackTraceLimit,
    keepLogs: opts.keepLogs,
    sizeLimit: opts.sizeLimit,
    timestamp: opts.timestamp,
    repeat: opts.repeat,
    debounceId: opts.debounce?.id,
    debounceTtl: opts.debounce?.ttl,
    failParentOnFailure: opts.failParentOnFailure,
    removeDependencyOnFailure: opts.removeDependencyOnFailure,
    ignoreDependencyOnFailure: opts.ignoreDependencyOnFailure,
    continueParentOnFailure: opts.continueParentOnFailure
  };
}
async function pushJob2(ctx, queueName, data, opts = {}, dependsOn) {
  const { removeOnComplete, removeOnFail } = parseRemoveOptions(opts);
  if (ctx.embedded) {
    const manager = getSharedManager();
    const job = await manager.push(queueName, {
      data,
      ...managerOptions(opts),
      removeOnComplete,
      removeOnFail,
      dependsOn: dependsOn?.map((id) => jobId(id))
    });
    return String(job.id);
  }
  if (!ctx.tcp)
    throw new Error("TCP connection not initialized");
  const response = await ctx.tcp.send({
    cmd: "PUSH",
    queue: queueName,
    data,
    ...tcpOptions(opts),
    removeOnComplete,
    removeOnFail,
    dependsOn
  });
  if (!response.ok) {
    throw new Error(response.error ?? "Failed to add job");
  }
  return response.id;
}
async function pushJobWithParent(ctx, params) {
  const { queueName, data, opts, parentRef, childIds } = params;
  const { removeOnComplete, removeOnFail } = parseRemoveOptions(opts);
  if (ctx.embedded) {
    const manager = getSharedManager();
    const childJobIds = childIds.map((id) => jobId(id));
    const job = await manager.push(queueName, {
      data,
      ...managerOptions(opts),
      removeOnComplete,
      removeOnFail,
      parentId: parentRef ? jobId(parentRef.id) : undefined,
      dependsOn: childJobIds.length > 0 ? childJobIds : undefined,
      childrenIds: childJobIds.length > 0 ? childJobIds : undefined
    });
    if (childIds.length > 0) {
      for (const childIdStr of childIds) {
        await manager.updateJobParent(jobId(childIdStr), job.id);
      }
    }
    return String(job.id);
  }
  if (!ctx.tcp)
    throw new Error("TCP connection not initialized");
  const response = await ctx.tcp.send({
    cmd: "PUSH",
    queue: queueName,
    data,
    ...tcpOptions(opts),
    removeOnComplete,
    removeOnFail,
    parentId: parentRef?.id,
    childrenIds: childIds.length > 0 ? childIds : undefined,
    dependsOn: childIds.length > 0 ? childIds : undefined
  });
  if (!response.ok) {
    throw new Error(response.error ?? "Failed to add job");
  }
  const parentJobId = response.id;
  if (childIds.length > 0) {
    for (const childId of childIds) {
      await ctx.tcp.send({ cmd: "UpdateParent", childId, parentId: parentJobId });
    }
  }
  return parentJobId;
}
async function cleanupJobs(ctx, jobIds) {
  if (jobIds.length === 0)
    return;
  if (ctx.embedded) {
    const manager = getSharedManager();
    const cleanupPromises = jobIds.map(async (id) => {
      try {
        await manager.cancel(jobId(id));
      } catch {}
    });
    await Promise.all(cleanupPromises);
  } else if (ctx.tcp) {
    const cleanupPromises = jobIds.map(async (id) => {
      try {
        await ctx.tcp?.send({ cmd: "Cancel", id });
      } catch {}
    });
    await Promise.all(cleanupPromises);
  }
}

// ../../node_modules/.bun/bunqueue@2.8.20/node_modules/bunqueue/dist/client/flow.js
var FORCE_EMBEDDED3 = Bun.env.BUNQUEUE_EMBEDDED === "1";

class FlowProducer extends EventEmitter5 {
  closing = Promise.resolve();
  embedded;
  tcp;
  useSharedPool;
  constructor(opts = {}) {
    super();
    this.embedded = opts.embedded ?? FORCE_EMBEDDED3;
    if (this.embedded) {
      this.tcp = null;
      this.useSharedPool = false;
    } else {
      const connOpts = opts.connection ?? {};
      const poolSize = connOpts.poolSize ?? 4;
      if (poolSize === 4 && !connOpts.token) {
        this.tcp = getSharedPool({
          host: connOpts.host,
          port: connOpts.port,
          poolSize,
          pingInterval: connOpts.pingInterval,
          commandTimeout: connOpts.commandTimeout,
          pipelining: connOpts.pipelining,
          maxInFlight: connOpts.maxInFlight
        });
        this.useSharedPool = true;
      } else {
        this.tcp = new TcpConnectionPool({
          host: connOpts.host ?? "localhost",
          port: connOpts.port ?? 6789,
          token: connOpts.token,
          poolSize,
          pingInterval: connOpts.pingInterval,
          commandTimeout: connOpts.commandTimeout,
          pipelining: connOpts.pipelining,
          maxInFlight: connOpts.maxInFlight
        });
        this.useSharedPool = false;
      }
    }
  }
  get pushCtx() {
    return { embedded: this.embedded, tcp: this.tcp };
  }
  close() {
    if (this.tcp && !this.useSharedPool) {
      this.tcp.close();
    } else if (this.tcp && this.useSharedPool) {
      releaseSharedPool(this.tcp);
    }
    this.closing = Promise.resolve();
    return this.closing;
  }
  disconnect() {
    return this.close();
  }
  async waitUntilReady() {
    if (this.embedded)
      return;
    if (this.tcp)
      await this.tcp.send({ cmd: "Ping" });
  }
  async add(flow, opts) {
    const createdJobIds = [];
    try {
      return await this.addFlowNode(flow, null, createdJobIds, opts);
    } catch (error2) {
      await cleanupJobs(this.pushCtx, createdJobIds);
      throw error2;
    }
  }
  async addBulk(flows) {
    const results = [];
    const allCreatedJobIds = [];
    try {
      for (const flow of flows) {
        const createdJobIds = [];
        const result = await this.addFlowNode(flow, null, createdJobIds);
        allCreatedJobIds.push(...createdJobIds);
        results.push(result);
      }
      return results;
    } catch (error2) {
      await cleanupJobs(this.pushCtx, allCreatedJobIds);
      throw error2;
    }
  }
  async getFlow(opts) {
    const { id, queueName, depth, maxChildren } = opts;
    if (this.embedded) {
      return this.getFlowEmbedded(id, queueName, depth ?? Infinity, maxChildren);
    }
    return this.getFlowTcp(id, queueName, depth ?? Infinity, maxChildren);
  }
  async addChain(steps) {
    if (steps.length === 0)
      return { jobIds: [] };
    const jobIds = [];
    let prevId = null;
    try {
      for (const step of steps) {
        const data = { name: step.name, __flowParentId: prevId, ...step.data };
        const id = await pushJob2(this.pushCtx, step.queueName, data, step.opts ?? {}, prevId ? [prevId] : undefined);
        jobIds.push(id);
        prevId = id;
      }
    } catch (error2) {
      await cleanupJobs(this.pushCtx, jobIds);
      throw error2;
    }
    return { jobIds };
  }
  async addBulkThen(parallel, final) {
    const parallelIds = [];
    try {
      const results = await Promise.allSettled(parallel.map(async (step) => {
        const data = { name: step.name, ...step.data };
        return pushJob2(this.pushCtx, step.queueName, data, step.opts ?? {});
      }));
      const errors2 = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          parallelIds.push(r.value);
        } else {
          errors2.push(r.reason);
        }
      }
      if (errors2.length > 0) {
        await cleanupJobs(this.pushCtx, parallelIds);
        throw errors2[0] instanceof Error ? errors2[0] : new Error(String(errors2[0]));
      }
      const finalData = {
        name: final.name,
        __flowParentIds: parallelIds,
        ...final.data
      };
      const finalId = await pushJob2(this.pushCtx, final.queueName, finalData, final.opts ?? {}, parallelIds);
      return { parallelIds, finalId };
    } catch (error2) {
      await cleanupJobs(this.pushCtx, parallelIds);
      throw error2;
    }
  }
  async addTree(root) {
    const jobIds = [];
    try {
      await this.addTreeNode(root, null, jobIds);
    } catch (error2) {
      await cleanupJobs(this.pushCtx, jobIds);
      throw error2;
    }
    return { jobIds };
  }
  getParentResult(parentId) {
    if (!this.embedded)
      throw new Error("getParentResult is only available in embedded mode");
    return getSharedManager().getResult(jobId(parentId));
  }
  getParentResults(parentIds) {
    if (!this.embedded)
      throw new Error("getParentResults is only available in embedded mode");
    const manager = getSharedManager();
    const results = new Map;
    for (const id of parentIds) {
      const result = manager.getResult(jobId(id));
      if (result !== undefined)
        results.set(id, result);
    }
    return results;
  }
  buildCallbacks(queueName) {
    const ctx = { name: queueName, embedded: this.embedded, tcp: this.tcp };
    return {
      embedded: this.embedded,
      tcp: this.tcp,
      updateData: (id, data) => updateJobData2(ctx, id, data),
      updateProgress: (id, progress) => updateJobProgress2(ctx, id, progress),
      log: (id, msg) => addJobLog2(ctx, id, msg).then(() => {}),
      promote: (id) => promoteJob2(ctx, id),
      remove: (id) => removeAsync(ctx, id),
      changePriority: (id, opts) => changeJobPriority2(ctx, id, opts),
      changeDelay: (id, d) => changeJobDelay(ctx, id, d),
      clearLogs: (id) => clearJobLogs2(ctx, id),
      retry: (id) => retryJob(ctx, id),
      getState: (id) => {
        if (this.embedded) {
          return getSharedManager().getJobState(jobId(id));
        }
        if (!this.tcp)
          return Promise.resolve("unknown");
        return this.tcp.send({ cmd: "GetState", id }).then((r) => typeof r.state === "string" ? r.state : "unknown");
      }
    };
  }
  async getFlowEmbedded(id, queueName, depth, maxChildren) {
    const job = await getSharedManager().getJob(jobId(id));
    if (job?.queue !== queueName)
      return null;
    return this.buildJobNode(job, depth, maxChildren);
  }
  async getFlowTcp(id, queueName, depth, maxChildren) {
    if (!this.tcp)
      throw new Error("TCP connection not initialized");
    const response = await this.tcp.send({ cmd: "GetJob", id });
    if (!response.ok || !response.job)
      return null;
    const jobData = response.job;
    if (jobData.queue !== queueName)
      return null;
    return this.buildJobNodeFromTcp(jobData, depth, maxChildren);
  }
  async buildJobNode(job, depth, maxChildren) {
    const data = job.data;
    const name = typeof data.name === "string" ? data.name : "default";
    const userData = extractUserDataFromInternal(data);
    const jobObj = createFlowJobObject(String(job.id), name, userData, job.queue, this.buildCallbacks(job.queue));
    if (depth <= 0 || job.childrenIds.length === 0)
      return { job: jobObj };
    const childNodes = [];
    const childrenToFetch = maxChildren ? job.childrenIds.slice(0, maxChildren) : job.childrenIds;
    for (const childId of childrenToFetch) {
      const childJob = await getSharedManager().getJob(childId);
      if (childJob)
        childNodes.push(await this.buildJobNode(childJob, depth - 1, maxChildren));
    }
    return { job: jobObj, children: childNodes.length > 0 ? childNodes : undefined };
  }
  async buildJobNodeFromTcp(jobData, depth, maxChildren) {
    const id = String(jobData.id);
    const queueName = String(jobData.queue);
    const data = jobData.data;
    const name = typeof data?.name === "string" ? data.name : "default";
    const userData = extractUserDataFromInternal(data ?? {});
    const rawChildrenIds = data?.__childrenIds;
    const childrenIds = Array.isArray(rawChildrenIds) ? rawChildrenIds : [];
    const jobObj = createFlowJobObject(id, name, userData, queueName, this.buildCallbacks(queueName));
    if (depth <= 0 || childrenIds.length === 0 || !this.tcp)
      return { job: jobObj };
    const childNodes = [];
    const childrenToFetch = maxChildren ? childrenIds.slice(0, maxChildren) : childrenIds;
    for (const childId of childrenToFetch) {
      const response = await this.tcp.send({ cmd: "GetJob", id: childId });
      if (response.ok && response.job) {
        childNodes.push(await this.buildJobNodeFromTcp(response.job, depth - 1, maxChildren));
      }
    }
    return { job: jobObj, children: childNodes.length > 0 ? childNodes : undefined };
  }
  async addFlowNode(node, parentRef, createdJobIds, flowOpts) {
    const childNodes = [];
    const childIds = [];
    if (node.children && node.children.length > 0) {
      const tempParentRef = { id: "pending", queue: node.queueName };
      const results = await Promise.all(node.children.map((child) => this.addFlowNode(child, tempParentRef, createdJobIds, flowOpts)));
      for (const childNode of results) {
        childNodes.push(childNode);
        childIds.push(childNode.job.id);
      }
    }
    const queueDefaults = flowOpts?.queuesOptions?.[node.queueName];
    const mergedOpts = queueDefaults ? { ...queueDefaults, ...node.opts } : node.opts ?? {};
    const jobData = {
      name: node.name,
      ...node.data
    };
    if (parentRef) {
      jobData.__parentId = parentRef.id;
      jobData.__parentQueue = parentRef.queue;
    }
    if (childIds.length > 0)
      jobData.__childrenIds = childIds;
    const jobIdStr = await pushJobWithParent(this.pushCtx, {
      queueName: node.queueName,
      data: jobData,
      opts: mergedOpts,
      parentRef,
      childIds
    });
    createdJobIds.push(jobIdStr);
    const job = createFlowJobObject(jobIdStr, node.name, node.data, node.queueName, this.buildCallbacks(node.queueName));
    return { job, children: childNodes.length > 0 ? childNodes : undefined };
  }
  async addTreeNode(step, parentId, jobIds) {
    const data = { name: step.name, __flowParentId: parentId, ...step.data };
    const id = await pushJob2(this.pushCtx, step.queueName, data, step.opts ?? {}, parentId ? [parentId] : undefined);
    jobIds.push(id);
    if (step.children) {
      await Promise.all(step.children.map((child) => this.addTreeNode(child, id, jobIds)));
    }
    return id;
  }
}
export {
  shutdownManager,
  Worker2 as Worker,
  Queue
};
