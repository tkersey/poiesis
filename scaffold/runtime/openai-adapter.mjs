import { createHash } from "node:crypto";
import { encodeAction } from "./codecs.mjs";

export const responsesEndpoint = "https://api.openai.com/v1/responses";
const defaultFetch = fetch;
const maximumResponseBytes = 4 * 1024 * 1024;
const transportInstructions = "Return exactly one action for this decision and stop. The entire assistant output must be one JSON value matching the supplied schema. Do not return tool calls, narration, a plan, or a later action.";

const outcome = (request, status, payload, claims) => ({ requestId: request?.requestId ?? "unknown", status, payload, ...(claims ? { claims } : {}) });
function normalizeStrict(value) { if (Array.isArray(value)) return value.map(normalizeStrict); if (!value || typeof value !== "object") return value; const result = {}; for (const [key, child] of Object.entries(value)) if (key !== "$schema" && key !== "title") result[key] = normalizeStrict(child); if (Object.hasOwn(result, "const") && !result.type) { if (typeof result.const !== "string") throw new TypeError("schema const must be a string"); result.type = "string"; } if (result.type === "object") { result.properties ??= {}; result.required = Object.keys(result.properties); result.additionalProperties = false; } return result; }
function strictSchema(actionSchema) { if (!Array.isArray(actionSchema?.oneOf) || actionSchema.oneOf.length === 0) throw new TypeError("action schema variants are required"); return { type: "object", properties: { value: { anyOf: actionSchema.oneOf.map(normalizeStrict) } }, required: ["value"], additionalProperties: false }; }
function admittedContract(context) { const contract = context.decisionContract; if (contract?.format !== "agent-decision-contract/v2" || contract.semanticDigest !== context.decisionContractDigest) throw new TypeError("decision_contract_mismatch"); return contract; }
function parseAction(text) { let envelope; try { envelope = JSON.parse(text); } catch { throw new Error("openai_action_json_not_admitted"); } if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, "value")) throw new Error("openai_action_envelope_not_admitted"); encodeAction(envelope.value); return envelope.value; }

function requestBody(context, request) {
  const contract = admittedContract(context);
  return {
    model: context.model,
    store: false,
    background: false,
    input: [
      { role: "developer", content: [{ type: "input_text", text: `${contract.instructions}\n\n${transportInstructions}` }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(request.payload) }] },
    ],
    text: { format: { type: "json_schema", name: "poiesis_release_steward_action", strict: true, schema: strictSchema(contract.actionSchema) } },
    tools: [],
    metadata: { application_id: context.applicationId, effect_request_id: request.requestId, decision_contract: context.decisionContractDigest },
  };
}

function exactResponse(value, requestedModel) {
  if (!value || typeof value !== "object" || value.status !== "completed" || value.model !== requestedModel || typeof value.id !== "string") throw new Error("openai_response_not_admitted");
  if (!Array.isArray(value.output) || value.output.some((item) => !["message", "reasoning"].includes(item?.type))) throw new Error("openai_output_not_admitted");
  const messages = value.output.filter((item) => item.type === "message");
  if (messages.length !== 1) throw new Error("openai_output_message_count_not_admitted");
  const message = messages[0];
  if (message.role !== "assistant" || !Array.isArray(message.content) || message.content.length !== 1) throw new Error("openai_message_not_admitted");
  const content = message.content[0];
  if (content?.type === "refusal") throw new Error("openai_refusal");
  if (content?.type !== "output_text" || typeof content.text !== "string") throw new Error("openai_output_not_text");
  for (const field of ["input_tokens", "output_tokens", "total_tokens"]) if (!Number.isSafeInteger(value.usage?.[field]) || value.usage[field] < 0) throw new Error("openai_usage_not_admitted");
  return { id: value.id, model: value.model, text: content.text, usage: value.usage };
}

function admissionReason(context, request) {
  if (!request || typeof request.requestId !== "string") return "invalid_request";
  if (typeof context?.secrets?.OPENAI_API_KEY !== "string" || context.secrets.OPENAI_API_KEY.length === 0) return "openai_api_key_required";
  if (typeof context.model !== "string" || !Array.isArray(context.allowedModels) || !context.allowedModels.includes(context.model)) return "openai_model_not_allowed";
  if (request.payload?.contract_digest !== context.decisionContractDigest) return "decision_contract_mismatch";
  try { admittedContract(context); } catch { return "decision_contract_mismatch"; }
  return null;
}

export async function preflight(context, request) { const reason = admissionReason(context, request); return reason ? outcome(request, "rejected", { reason }) : outcome(request, "ok", { admitted: true }); }
export async function resolve(context, request) {
  const admitted = await preflight(context, request); if (admitted.status !== "ok") return admitted;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), context.timeoutMs ?? 180_000);
  let response;
  try { response = await (context.fetchImplementation ?? defaultFetch)(responsesEndpoint, { method: "POST", headers: { Authorization: `Bearer ${context.secrets.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(requestBody(context, request)), signal: controller.signal }); }
  catch (error) { clearTimeout(timer); const reason = error?.name === "AbortError" ? "openai_timeout" : "openai_transport_failed"; context.lastOpenAiFailure = reason; return outcome(request, "failed", { reason }); }
  clearTimeout(timer);
  if (!response || response.status < 200 || response.status >= 300) return outcome(request, "failed", { reason: `openai_http_${Number(response?.status) || 0}` });
  const declared = Number(response.headers?.get?.("content-length")); if (Number.isFinite(declared) && declared > maximumResponseBytes) return outcome(request, "failed", { reason: "openai_response_too_large" });
  const text = await response.text(); if (Buffer.byteLength(text) > maximumResponseBytes) return outcome(request, "failed", { reason: "openai_response_too_large" });
  try { const parsed = exactResponse(JSON.parse(text), context.model); const action = parseAction(parsed.text); return outcome(request, "ok", action, { provider: "openai", endpointClass: "responses", requestedModel: context.model, returnedModel: parsed.model, inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens, totalTokens: parsed.usage.total_tokens, responseIdSha256: createHash("sha256").update(parsed.id).digest("hex"), store: false }); }
  catch (error) { context.lastOpenAiFailure = String(error.message).slice(0, 256); return outcome(request, "failed", { reason: context.lastOpenAiFailure }); }
}
export async function recover(_context, effectRecord) { return effectRecord?.recordedResolution ? structuredClone(effectRecord.recordedResolution) : { status: "failed", payload: { reason: "recorded_resolution_required" } }; }

export const _openAiInternals = { normalizeStrict, strictSchema, parseAction, requestBody, exactResponse, transportInstructions };
