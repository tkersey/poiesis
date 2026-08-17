import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodeDecisionTurn,
  decodeEffectPayload,
  encodeAction,
  encodeEffectResult,
} from "./codecs.mjs";

const manifestKeys = ["applicationId", "applicationName", "applicationVersion", "decisionContractDigest", "format", "interfaces"];
const interfaceKeys = ["authorityRequirements", "interfaceId", "interfaceLabel", "maximumResultBytes", "operation", "payloadSchemaId", "resultSchemaId", "siteIdentity"];
const interfaceLabels = Object.freeze({
  decide: "model.decide.v1",
  list: "repo.list.v2",
  read: "repo.read.v2",
  search: "repo.release-search.v1",
  check: "repo.check.v1",
  replace: "repo.replace.approved.v2",
});
const workspaceTargets = Object.freeze({
  list: ["poiesis-workspace.list.v1", "desc.poiesis-repository-list.v1", "actuator.poiesis-repository-list.v1", "idempotent"],
  read: ["poiesis-workspace.read.v1", "desc.poiesis-repository-read.v1", "actuator.poiesis-repository-read.v1", "idempotent"],
  search: ["poiesis-workspace.search.v1", "desc.poiesis-repository-search.v1", "actuator.poiesis-repository-search.v1", "idempotent"],
  check: ["poiesis-workspace.check.v1", "desc.poiesis-repository-check.v1", "actuator.poiesis-repository-check.v1", "retryable"],
  replace: ["poiesis-workspace.replace.v1", "desc.poiesis-repository-replace-approved.v1", "actuator.poiesis-repository-replace-approved.v1", "idempotent"],
});

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== expected.join("\0")) {
    throw new TypeError(`${label} shape mismatch`);
  }
  return value;
}

function hex(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} must be a SHA-256 hex value`);
  return Buffer.from(value, "hex");
}

function configurationIdentity(parts) {
  const hasher = createHash("sha256");
  hasher.update("poiesis.capability-configuration.v1");
  for (const part of parts) {
    const bytes = Buffer.from(String(part), "utf8");
    const size = Buffer.alloc(4);
    size.writeUInt32LE(bytes.length);
    hasher.update(size);
    hasher.update(bytes);
  }
  return hasher.digest("hex");
}

function claims(value) {
  return value === undefined || value === null ? new Uint8Array(0) : Buffer.from(JSON.stringify(value), "utf8");
}

function manifestIndex(value) {
  const manifest = exactKeys(value, manifestKeys, "binding manifest");
  if (manifest.format !== "poiesis-binding-manifest/v1" || manifest.applicationName !== "release-steward" || manifest.applicationVersion !== "1.0.0") {
    throw new TypeError("Poiesis binding manifest identity mismatch");
  }
  hex(manifest.applicationId, "applicationId");
  hex(manifest.decisionContractDigest, "decisionContractDigest");
  if (!Array.isArray(manifest.interfaces) || manifest.interfaces.length !== Object.keys(interfaceLabels).length) throw new TypeError("binding manifest interface count mismatch");
  const entries = new Map();
  const interfaceIds = new Set();
  for (const raw of manifest.interfaces) {
    const entry = exactKeys(raw, interfaceKeys, "binding interface");
    const expectedLabel = interfaceLabels[entry.operation];
    if (!expectedLabel || entry.interfaceLabel !== expectedLabel || entry.siteIdentity !== expectedLabel || entries.has(entry.operation)) {
      throw new TypeError(`binding interface identity mismatch: ${String(entry.operation)}`);
    }
    hex(entry.interfaceId, `${entry.operation} interface`);
    hex(entry.payloadSchemaId, `${entry.operation} payload schema`);
    hex(entry.resultSchemaId, `${entry.operation} result schema`);
    if (typeof entry.authorityRequirements !== "string" || !/^(0|[1-9][0-9]*)$/.test(entry.authorityRequirements)) throw new TypeError("authority requirements must be canonical decimal text");
    if (!Number.isInteger(entry.maximumResultBytes) || entry.maximumResultBytes <= 0) throw new TypeError("maximum result bytes must be positive");
    if (interfaceIds.has(entry.interfaceId)) throw new TypeError("binding interface ID is duplicated");
    interfaceIds.add(entry.interfaceId);
    entries.set(entry.operation, Object.freeze({ ...entry }));
  }
  return entries;
}

function requireAdapter(value, label) {
  if (!value || typeof value.preflight !== "function" || typeof value.resolve !== "function") throw new TypeError(`${label} adapter is required`);
  return value;
}

export async function createPoiesisBindings({
  worldCapabilitiesRoot,
  bindingManifest,
  workspaceAdapter,
  modelAdapter,
  modelBindingId = "poiesis-openai.v1",
}) {
  if (typeof worldCapabilitiesRoot !== "string" || worldCapabilitiesRoot.length === 0) throw new TypeError("verified worldCapabilitiesRoot is required");
  if (typeof modelBindingId !== "string" || modelBindingId.length === 0) throw new TypeError("modelBindingId is required");
  requireAdapter(workspaceAdapter, "workspace");
  requireAdapter(modelAdapter, "model");
  const { effectInterfaceId } = await import(pathToFileURL(join(worldCapabilitiesRoot, "src/v1/protocol.mjs")).href);
  if (typeof effectInterfaceId !== "function") throw new TypeError("world-capabilities effectInterfaceId is required");
  const byOperation = manifestIndex(bindingManifest);
  const applicationId = hex(bindingManifest.applicationId, "applicationId");
  const bindings = [];

  const decision = byOperation.get("decide");
  bindings.push({
    bindingId: modelBindingId,
    driverId: modelBindingId,
    packageName: "@tkersey/poiesis",
    interfaceId: checkedInterfaceId(effectInterfaceId, decision),
    payloadSchemaId: hex(decision.payloadSchemaId, "decision payload schema"),
    resultSchemaId: hex(decision.resultSchemaId, "decision result schema"),
    applicationIds: [applicationId],
    authorityRequirements: BigInt(decision.authorityRequirements),
    target: { descriptorFingerprint: "desc.poiesis-openai.v1", actuatorRef: "actuator.poiesis-openai.v1", actuationClass: "model" },
    adapter: modelAdapter,
    decodePayload: decodeDecisionTurn,
    encodeOutcome: (outcome) => encodeAction(outcome.payload),
    hostClaims: (outcome) => claims(outcome.claims),
    configurationIdentity: (context) => configurationIdentity([
      bindingManifest.applicationId,
      modelBindingId,
      bindingManifest.decisionContractDigest,
      context.runId,
      context.model,
      "decide",
    ]),
    recoveryClass: "retryable",
  });

  for (const operation of ["list", "read", "search", "check", "replace"]) {
    const site = byOperation.get(operation);
    const target = workspaceTargets[operation];
    bindings.push({
      bindingId: target[0],
      driverId: target[0],
      packageName: "@tkersey/poiesis",
      interfaceId: checkedInterfaceId(effectInterfaceId, site),
      payloadSchemaId: hex(site.payloadSchemaId, `${operation} payload schema`),
      resultSchemaId: hex(site.resultSchemaId, `${operation} result schema`),
      applicationIds: [applicationId],
      authorityRequirements: BigInt(site.authorityRequirements),
      target: { descriptorFingerprint: target[1], actuatorRef: target[2], actuationClass: "repository" },
      adapter: workspaceAdapter,
      decodePayload: (bytes) => Object.freeze({ operation, ...decodeEffectPayload(operation, bytes) }),
      encodeOutcome: (outcome) => encodeEffectResult(operation, outcome.payload),
      hostClaims: (outcome) => claims(outcome.claims),
      configurationIdentity: (context) => configurationIdentity([
        bindingManifest.applicationId,
        target[0],
        context.runId,
        context.workspaceRootReal,
        context.repository,
        context.baseRevision,
        context.policyDigest,
        operation,
        operation === "check" ? context.zigExecutable : "",
        operation === "check" ? context.zigVersion : "",
      ]),
      recoveryClass: target[3],
    });
  }
  return Object.freeze(bindings.map((binding) => Object.freeze(binding)));
}

function checkedInterfaceId(effectInterfaceId, entry) {
  const derived = Buffer.from(effectInterfaceId(entry.interfaceLabel));
  if (derived.length !== 32 || derived.toString("hex") !== entry.interfaceId) throw new Error(`interface derivation mismatch for ${entry.operation}`);
  return derived;
}

export async function createPoiesisRouter(options) {
  const { CapabilityRouterV1 } = await import(pathToFileURL(join(options.worldCapabilitiesRoot, "src/v1/index.mjs")).href);
  if (typeof CapabilityRouterV1 !== "function") throw new TypeError("world-capabilities CapabilityRouterV1 is required");
  return new CapabilityRouterV1({ bindings: await createPoiesisBindings(options) });
}

export const _bindingInternals = Object.freeze({ configurationIdentity, manifestIndex, workspaceTargets });
