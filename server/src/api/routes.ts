import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, constantTimeEqual } from "../auth/auth";
import type { AppConfig } from "../config/env";
import { writeSecretsFile } from "../config/secrets";
import type { Database, UpdatePolicyRecord } from "../db/database";
import { EventHub, type RealtimeEvent } from "../events/eventHub";
import { parseExternalCommand } from "../parser/commandParser";
import { DeviceRegistry } from "../realtime/deviceRegistry";
import { CommandRouter, DispatchError } from "../router/commandRouter";
import type { CommandDispatchResult, TypedCommand } from "../types/protocol";
import { randomToken, sha256Hex } from "../utils/crypto";
import { makeRequestId } from "../utils/id";
import { log } from "../utils/logger";
import { FixedWindowRateLimiter } from "../utils/rateLimiter";
import { inspectPackageFromUrl, PackageInspectionError } from "../update/packageInspector";
import {
  inferDesignationPrefixFromPackageUrl,
  prepareDesignationChange,
  type PreparedDesignationChange,
} from "../update/designation";
import { queuePolicyUpdate } from "../update/policyQueue";
import { verifyUpdateSignature } from "../update/signatureVerifier";
import { evaluateVersionPolicy, hasManagedPolicyPackage } from "../update/versionPolicy";
import type { QueuedUpdateDispatcher } from "../update/queuedUpdateDispatcher";

interface ApiDeps {
  config: AppConfig;
  db: Database;
  registry: DeviceRegistry;
  router: CommandRouter;
  eventHub: EventHub;
  queuedUpdateDispatcher: QueuedUpdateDispatcher;
}

interface CommandRequestBody {
  request_id?: string;
  text?: string;
  source?: string;
  async?: unknown;
  timeout_ms?: unknown;
  sent_at?: string;
  client_version?: string;
  user_id?: string;
  shortcut_name?: string;
}

interface EnrollRequestBody {
  bootstrap_token?: string;
  device_id?: string;
  display_name?: string;
  version?: string;
  hostname?: string;
  username?: string;
  capabilities?: string[];
  designation_prefix?: string;
}

interface UpdateRequestBody {
  request_id?: string;
  source?: string;
  target?: string;
  version?: string;
  package_url?: string;
  sha256?: string;
  size_bytes?: unknown;
  signature?: unknown;
  signature_key_id?: unknown;
  use_privileged_helper?: unknown;
  queue_if_offline?: unknown;
}

interface RenameDeviceBody {
  display_name?: string;
}

interface DeviceAppAliasesBody {
  aliases?: Array<{
    alias?: string;
    app?: string;
  }>;
}

interface DeviceControlBody {
  quarantine_enabled?: unknown;
  kill_switch_enabled?: unknown;
  reason?: unknown;
  enforce_lockdown?: unknown;
  trigger_lockdown?: unknown;
  lockdown_minutes?: unknown;
}

interface UpdatePolicyBody {
  pinned_version?: unknown;
  revoked_versions?: unknown;
  strict_mode?: unknown;
  auto_update?: unknown;
  package_url?: unknown;
  sha256?: unknown;
  size_bytes?: unknown;
  signature?: unknown;
  signature_key_id?: unknown;
  use_privileged_helper?: unknown;
}

interface CreateApiKeyBody {
  name?: string;
  scopes?: string[];
}

interface UpsertGroupBody {
  display_name?: string;
  description?: string;
  device_ids?: string[];
}

interface GroupCommandBody {
  request_id?: string;
  text?: string;
  source?: string;
  confirm_bulk?: boolean;
}

interface RotateTokensBody {
  rotate_owner_token?: unknown;
  rotate_bootstrap_token?: unknown;
  owner_grace_seconds?: unknown;
}

type ApiScope =
  | "devices:read"
  | "devices:write"
  | "commands:execute"
  | "updates:execute"
  | "history:read"
  | "groups:read"
  | "groups:write"
  | "events:read"
  | "admin:manage";

const MAX_TEXT_LEN = 4096;
const MAX_SOURCE_LEN = 40;
const MAX_UPDATE_VERSION_LEN = 64;
const MAX_UPDATE_SIGNATURE_LEN = 1024;
const MAX_SIGNING_KEY_ID_LEN = 40;
const MAX_CAPABILITIES = 50;
const MAX_GROUP_ID_LEN = 32;
const MAX_GROUP_DISPLAY_NAME_LEN = 80;
const MAX_GROUP_DESCRIPTION_LEN = 240;
const MAX_GROUP_MEMBER_COUNT = 100;
const MAX_DEVICE_CONTROL_REASON_LEN = 240;
const DEFAULT_LOCKDOWN_MINUTES = 30;
const MIN_LOCKDOWN_MINUTES = 1;
const MAX_LOCKDOWN_MINUTES = 240;
const MAX_REVOKED_VERSIONS = 100;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;
const MAX_SSE_TOKEN_LENGTH = 512;
const SSE_PING_INTERVAL_MS = 20_000;
const DEFAULT_OWNER_TOKEN_GRACE_SECONDS = 600;
const MAX_OWNER_TOKEN_GRACE_SECONDS = 3600;
const JSON_CONTENT_TYPE_RE = /^\s*application\/(?:[a-z0-9.+-]+\+)?json\s*(?:;|$)/i;
const GROUP_COMMAND_PATH_RE = /^\/api\/groups\/[^/]+\/command$/;
const GROUP_UPSERT_PATH_RE = /^\/api\/groups\/[^/]+$/;
const DEVICE_RENAME_PATH_RE = /^\/api\/devices\/[^/]+\/display-name$/;
const DEVICE_CONTROL_PATH_RE = /^\/api\/devices\/[^/]+\/control$/;
const API_KEY_ROTATE_PATH_RE = /^\/api\/auth\/keys\/[^/]+\/rotate$/;

interface RateLimitRule {
  id: string;
  limit: number;
  windowMs: number;
  message: string;
}

const RATE_LIMIT_RULES = {
  enroll: {
    id: "enroll",
    limit: 20,
    windowMs: 60_000,
    message: "Too many enrollment attempts from this client",
  } satisfies RateLimitRule,
  auth: {
    id: "auth",
    limit: 120,
    windowMs: 60_000,
    message: "Too many authentication management requests",
  } satisfies RateLimitRule,
  dispatch: {
    id: "dispatch",
    limit: 240,
    windowMs: 60_000,
    message: "Too many command/update dispatch requests",
  } satisfies RateLimitRule,
  events: {
    id: "events",
    limit: 30,
    windowMs: 60_000,
    message: "Too many event stream connection attempts",
  } satisfies RateLimitRule,
} as const;

const API_SCOPES: ApiScope[] = [
  "devices:read",
  "devices:write",
  "commands:execute",
  "updates:execute",
  "history:read",
  "groups:read",
  "groups:write",
  "events:read",
  "admin:manage",
];

const BULK_GROUP_ALLOWED_TYPES = new Set([
  "PING",
  "OPEN_APP",
  "MEDIA_PLAY",
  "MEDIA_PAUSE",
  "MEDIA_PLAY_PAUSE",
  "MEDIA_NEXT",
  "MEDIA_PREVIOUS",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
  "LOCK_PC",
  "NOTIFY",
  "CLIPBOARD_SET",
  "SYSTEM_DISPLAY_OFF",
]);

const QUARANTINE_ALLOWED_TYPES = new Set(["PING", "LOCK_PC", "EMERGENCY_LOCKDOWN"]);

const ADMIN_ONLY_COMMANDS = new Set([
  "ADMIN_EXEC_CMD",
  "ADMIN_EXEC_POWERSHELL",
  "PROCESS_LIST",
  "PROCESS_KILL",
  "PROCESS_START",
  "PROCESS_DETAILS",
  "SERVICE_LIST",
  "SERVICE_CONTROL",
  "SERVICE_DETAILS",
  "FILE_READ",
  "FILE_WRITE",
  "FILE_APPEND",
  "FILE_COPY",
  "FILE_MOVE",
  "FILE_EXISTS",
  "FILE_HASH",
  "FILE_TAIL",
  "FILE_DELETE",
  "FILE_LIST",
  "FILE_MKDIR",
  "NETWORK_INFO",
  "NETWORK_TEST",
  "NETWORK_FLUSH_DNS",
  "EVENT_LOG_QUERY",
  "ENV_LIST",
  "ENV_GET",
  "SYSTEM_INFO",
]);

type AgentProfile = "s" | "se" | "t" | "e" | "a" | "legacy";

const LITE_PROFILE_COMMANDS = new Set([
  "PING",
  "OPEN_APP",
  "MEDIA_PLAY",
  "MEDIA_PAUSE",
  "MEDIA_PLAY_PAUSE",
  "MEDIA_NEXT",
  "MEDIA_PREVIOUS",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
  "LOCK_PC",
  "NOTIFY",
  "CLIPBOARD_SET",
  "SYSTEM_DISPLAY_OFF",
]);

const STANDARD_PROFILE_EXTRA_COMMANDS = new Set([
  "SYSTEM_SLEEP",
  "SYSTEM_SIGN_OUT",
  "SYSTEM_SHUTDOWN",
  "SYSTEM_RESTART",
  "AGENT_REMOVE",
  "TYPE_TEXT",
]);

const OPEN_APP_CANONICAL_ALLOWLIST = new Set([
  "spotify",
  "discord",
  "chrome",
  "steam",
  "explorer",
  "vscode",
  "edge",
  "firefox",
  "notepad",
  "calculator",
  "settings",
  "slack",
  "teams",
  "taskmanager",
  "terminal",
  "powershell",
  "cmd",
  "controlpanel",
  "paint",
  "snippingtool",
]);

interface OwnerTokenFallback {
  token: string;
  expiresAt: number;
}

const ownerTokenFallbacks: OwnerTokenFallback[] = [];

function makeLogId(requestId: string, deviceId: string): string {
  return `${requestId}:${deviceId}`;
}

function requestPath(url: string): string {
  const queryIndex = url.indexOf("?");
  if (queryIndex < 0) {
    return url;
  }

  return url.slice(0, queryIndex);
}

function resolveClientIdentity(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === "string") {
    const first = forwardedValue.split(",")[0]?.trim() ?? "";
    if (first) {
      return first.slice(0, 80);
    }
  }

  if (typeof request.ip === "string" && request.ip.trim()) {
    return request.ip.trim().slice(0, 80);
  }

  const remoteAddress = request.socket.remoteAddress?.trim() ?? "";
  if (remoteAddress) {
    return remoteAddress.slice(0, 80);
  }

  return "unknown";
}

function pruneOwnerTokenFallbacks(now = Date.now()): void {
  for (let index = ownerTokenFallbacks.length - 1; index >= 0; index -= 1) {
    if (ownerTokenFallbacks[index].expiresAt <= now) {
      ownerTokenFallbacks.splice(index, 1);
    }
  }
}

function addOwnerTokenFallback(token: string, graceSeconds: number): string | null {
  if (!token || graceSeconds <= 0) {
    return null;
  }

  pruneOwnerTokenFallbacks();
  const expiresAt = Date.now() + graceSeconds * 1000;
  ownerTokenFallbacks.push({ token, expiresAt });
  if (ownerTokenFallbacks.length > 5) {
    ownerTokenFallbacks.shift();
  }

  return new Date(expiresAt).toISOString();
}

function isValidOwnerTokenFallback(token: string): boolean {
  pruneOwnerTokenFallbacks();
  return ownerTokenFallbacks.some((item) => item.expiresAt > Date.now() && constantTimeEqual(token, item.token));
}

function resolveRateLimitRule(method: string, path: string): RateLimitRule | null {
  if (method === "POST" && path === "/api/enroll") {
    return RATE_LIMIT_RULES.enroll;
  }

  if (path.startsWith("/api/auth/")) {
    return RATE_LIMIT_RULES.auth;
  }

  if (method === "GET" && path === "/api/events") {
    return RATE_LIMIT_RULES.events;
  }

  if (
    (method === "POST" &&
      (path === "/api/command" ||
        path === "/api/update" ||
        GROUP_COMMAND_PATH_RE.test(path) ||
        DEVICE_CONTROL_PATH_RE.test(path))) ||
    (method === "PUT" && path === "/api/update/policy")
  ) {
    return RATE_LIMIT_RULES.dispatch;
  }

  return null;
}

function isJsonContentType(value: unknown): boolean {
  if (typeof value === "string") {
    return JSON_CONTENT_TYPE_RE.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => isJsonContentType(item));
  }

  return false;
}

function requiresJsonBody(method: string, path: string): boolean {
  if (method === "PUT" && GROUP_UPSERT_PATH_RE.test(path)) {
    return true;
  }

  if (method === "PUT" && path === "/api/update/policy") {
    return true;
  }

  if (method !== "POST") {
    return false;
  }

  if (path === "/api/enroll") {
    return true;
  }

  if (path === "/api/command") {
    return true;
  }

  if (path === "/api/update") {
    return true;
  }

  if (path === "/api/auth/keys") {
    return true;
  }

  if (path === "/api/auth/tokens/rotate") {
    return true;
  }

  if (API_KEY_ROTATE_PATH_RE.test(path)) {
    return true;
  }

  if (DEVICE_RENAME_PATH_RE.test(path)) {
    return true;
  }

  if (DEVICE_CONTROL_PATH_RE.test(path)) {
    return true;
  }

  return GROUP_COMMAND_PATH_RE.test(path);
}

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ ok: false, message: "Unauthorized" });
}

function forbidden(reply: FastifyReply, message = "Forbidden"): void {
  reply.code(403).send({ ok: false, message });
}

function hasScopes(candidate: Set<ApiScope>, requiredScopes: ApiScope[]): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }

  return requiredScopes.every((scope) => candidate.has(scope));
}

function isValidApiScope(value: string): value is ApiScope {
  return API_SCOPES.includes(value as ApiScope);
}

interface AuthContext {
  subject: string;
  scopes: Set<ApiScope>;
  isOwnerToken: boolean;
  keyId: string | null;
}

function tokenFromQuery(query: unknown): string {
  if (!query || typeof query !== "object") {
    return "";
  }

  const candidate = (query as Record<string, unknown>).token;
  if (typeof candidate !== "string") {
    return "";
  }

  return candidate.trim().slice(0, MAX_SSE_TOKEN_LENGTH);
}

function tokenFromRequest(request: FastifyRequest, allowQueryToken = false): string {
  const fromHeader = extractBearerToken(request.headers.authorization);
  if (fromHeader) {
    return fromHeader;
  }

  if (!allowQueryToken) {
    return "";
  }

  return tokenFromQuery(request.query);
}

function resolveAuthContext(
  request: FastifyRequest,
  deps: ApiDeps,
  input?: { allowQueryToken?: boolean },
): AuthContext | null {
  const token = tokenFromRequest(request, input?.allowQueryToken === true);
  if (!token) {
    return null;
  }

  if (constantTimeEqual(token, deps.config.phoneApiToken) || isValidOwnerTokenFallback(token)) {
    return {
      subject: "owner",
      scopes: new Set<ApiScope>(API_SCOPES),
      isOwnerToken: true,
      keyId: null,
    };
  }

  const key = deps.db.resolveApiKeyByToken(token);
  if (!key || key.status !== "active") {
    return null;
  }

  deps.db.touchApiKeyUsage(key.key_id);

  const scopes = new Set<ApiScope>();
  for (const scope of key.scopes) {
    if (isValidApiScope(scope)) {
      scopes.add(scope);
    }
  }

  return {
    subject: key.name,
    scopes,
    isOwnerToken: false,
    keyId: key.key_id,
  };
}

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDeps,
  requiredScopes: ApiScope[],
  input?: { allowQueryToken?: boolean },
): AuthContext | null {
  const auth = resolveAuthContext(request, deps, input);
  if (!auth) {
    unauthorized(reply);
    return null;
  }

  if (!hasScopes(auth.scopes, requiredScopes)) {
    forbidden(reply);
    return null;
  }

  return auth;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asCreateApiKeyBody(body: unknown): CreateApiKeyBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as CreateApiKeyBody;
}

function asUpsertGroupBody(body: unknown): UpsertGroupBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as UpsertGroupBody;
}

function asGroupCommandBody(body: unknown): GroupCommandBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as GroupCommandBody;
}

function normalizeApiKeyScopes(value: unknown): ApiScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const scopes: ApiScope[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    const candidate = asTrimmedString(raw).toLowerCase();
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    if (!isValidApiScope(candidate)) {
      continue;
    }

    seen.add(candidate);
    scopes.push(candidate);
  }

  return scopes;
}

function normalizeGroupId(value: unknown): string {
  return asTrimmedString(value).toLowerCase();
}

function isValidGroupId(groupId: string): boolean {
  if (groupId.length < 2 || groupId.length > MAX_GROUP_ID_LEN) {
    return false;
  }

  return /^[a-z][a-z0-9_-]+$/.test(groupId);
}

function normalizeGroupDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const deviceId = asTrimmedString(item).toLowerCase();
    if (!deviceId || seen.has(deviceId)) {
      continue;
    }

    if (!/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      continue;
    }

    seen.add(deviceId);
    deduped.push(deviceId);
  }

  return deduped;
}

function normalizeDesignationPrefix(candidate: unknown): string {
  const value = asTrimmedString(candidate).toLowerCase();
  if (!value) {
    return "";
  }

  const safeValue = value.replace(/[^a-z]/g, "");
  if (!safeValue) {
    return "";
  }

  return safeValue.slice(0, 4);
}

function normalizeRequestId(candidate: unknown): string {
  const value = asTrimmedString(candidate);
  if (!value) {
    return makeRequestId();
  }

  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) {
    return makeRequestId();
  }

  return value;
}

function normalizeSource(candidate: unknown): string {
  const value = asTrimmedString(candidate).toLowerCase();
  if (!value) {
    return "iphone";
  }

  const safeValue = value.replace(/[^a-z0-9_.:-]/g, "");
  if (!safeValue) {
    return "iphone";
  }

  return safeValue.slice(0, MAX_SOURCE_LEN);
}

function requiredCapabilityForCommand(type: string): string | null {
  if (ADMIN_ONLY_COMMANDS.has(type)) {
    return "admin_ops";
  }

  if (type === "EMERGENCY_LOCKDOWN") {
    return "emergency_lockdown";
  }

  return null;
}

function timeoutForCommand(config: AppConfig, type: string): number {
  if (ADMIN_ONLY_COMMANDS.has(type)) {
    return config.adminCommandTimeoutMs;
  }

  if (
    type === "SYSTEM_SLEEP" ||
    type === "SYSTEM_SIGN_OUT" ||
    type === "SYSTEM_SHUTDOWN" ||
    type === "SYSTEM_RESTART" ||
    type === "AGENT_REMOVE" ||
    type === "EMERGENCY_LOCKDOWN"
  ) {
    return config.powerCommandTimeoutMs;
  }

  return config.commandTimeoutMs;
}

function profileFromDeviceId(deviceId: string): AgentProfile {
  const normalized = asTrimmedString(deviceId).toLowerCase();
  if (normalized.startsWith("se")) {
    return "se";
  }

  if (normalized.startsWith("s")) {
    return "s";
  }

  if (normalized.startsWith("e")) {
    return "e";
  }

  if (normalized.startsWith("t")) {
    return "t";
  }

  if (normalized.startsWith("a")) {
    return "a";
  }

  return "legacy";
}

function resolveDeviceProfile(deviceId: string, capabilities: string[] | null | undefined): AgentProfile {
  const normalizedCapabilities = new Set(
    (capabilities ?? []).map((item) => asTrimmedString(item).toLowerCase()).filter((item) => item.length > 0),
  );

  if (normalizedCapabilities.has("profile_se")) {
    return "se";
  }

  if (normalizedCapabilities.has("profile_s")) {
    return "s";
  }

  if (normalizedCapabilities.has("profile_e")) {
    return "e";
  }

  if (normalizedCapabilities.has("profile_t")) {
    return "t";
  }

  if (normalizedCapabilities.has("profile_a")) {
    return "a";
  }

  return profileFromDeviceId(deviceId);
}

function isCommandAllowedForProfile(profile: AgentProfile, commandType: string): boolean {
  if (profile === "legacy" || profile === "a") {
    return true;
  }

  if (profile === "s") {
    return LITE_PROFILE_COMMANDS.has(commandType);
  }

  if (profile === "se") {
    return LITE_PROFILE_COMMANDS.has(commandType) || commandType === "EMERGENCY_LOCKDOWN";
  }

  if (profile === "t") {
    return LITE_PROFILE_COMMANDS.has(commandType) || STANDARD_PROFILE_EXTRA_COMMANDS.has(commandType);
  }

  if (profile === "e") {
    return (
      LITE_PROFILE_COMMANDS.has(commandType) ||
      STANDARD_PROFILE_EXTRA_COMMANDS.has(commandType) ||
      commandType === "EMERGENCY_LOCKDOWN"
    );
  }

  return false;
}

function profileLabel(profile: AgentProfile): string {
  if (profile === "legacy") {
    return "legacy";
  }

  return `${profile}`;
}

function withProfile<T extends { device_id: string; capabilities: string[] }>(device: T): T & { profile: AgentProfile } {
  return {
    ...device,
    profile: resolveDeviceProfile(device.device_id, device.capabilities),
  };
}

function parseDispatchError(error: unknown): { code: string; message: string; httpStatus: number } {
  if (!(error instanceof DispatchError)) {
    const message = error instanceof Error ? error.message : "Unknown routing error";
    return {
      code: "ROUTING_ERROR",
      message,
      httpStatus: 502,
    };
  }

  switch (error.code) {
    case "TIMEOUT":
      return { code: error.code, message: error.message, httpStatus: 504 };
    case "ROUTER_OVERLOADED":
      return { code: error.code, message: error.message, httpStatus: 503 };
    case "DEVICE_OFFLINE":
    case "DEVICE_DISCONNECTED":
    case "DUPLICATE_REQUEST":
      return { code: error.code, message: error.message, httpStatus: 409 };
    case "SEND_FAILED":
      return { code: error.code, message: error.message, httpStatus: 502 };
    default:
      return { code: error.code, message: error.message, httpStatus: 500 };
  }
}

function preflightPolicyFailure(input: {
  deviceId: string;
  commandType: string;
  quarantineEnabled: boolean;
  killSwitchEnabled: boolean;
  policy: UpdatePolicyRecord;
  version: string | null | undefined;
}): { code: string; message: string } | null {
  if (input.killSwitchEnabled) {
    return {
      code: "DEVICE_KILL_SWITCHED",
      message: `${input.deviceId} is blocked by kill-switch policy`,
    };
  }

  if (input.quarantineEnabled && !QUARANTINE_ALLOWED_TYPES.has(input.commandType)) {
    return {
      code: "DEVICE_QUARANTINED",
      message: `${input.deviceId} is quarantined`,
    };
  }

  const versionPolicy = evaluateVersionPolicy(input.version, input.policy);
  if (input.policy.strict_mode && versionPolicy.requiresUpdate) {
    return {
      code: versionPolicy.code ?? "VERSION_POLICY_BLOCKED",
      message: versionPolicy.message ?? `${input.deviceId} is blocked by update policy`,
    };
  }

  return null;
}

function parsePackageInspectionFailure(error: unknown): { code: string; message: string; httpStatus: number } {
  if (!(error instanceof PackageInspectionError)) {
    const message = error instanceof Error ? error.message : "Failed to inspect package URL";
    return {
      code: "UPDATE_FETCH_FAILED",
      message,
      httpStatus: 502,
    };
  }

  switch (error.code) {
    case "INVALID_UPDATE_URL":
      return { code: error.code, message: error.message, httpStatus: 400 };
    case "UPDATE_FETCH_TIMEOUT":
      return { code: error.code, message: error.message, httpStatus: 504 };
    case "UPDATE_PACKAGE_TOO_LARGE":
      return { code: error.code, message: error.message, httpStatus: 413 };
    default:
      return { code: error.code, message: error.message, httpStatus: 502 };
  }
}

function verifyNormalizedUpdateSignature(input: {
  config: AppConfig;
  version: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number | null;
  signature: string | null;
  signatureKeyId: string | null;
}):
  | {
      ok: true;
      signature: string | null;
      signatureKeyId: string | null;
      signatureVerified: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus: number;
    } {
  if (input.signatureKeyId && !input.signature) {
    return {
      ok: false,
      code: "INVALID_UPDATE_SIGNATURE",
      message: "signature_key_id requires signature",
      httpStatus: 400,
    };
  }

  if (!input.signature) {
    if (input.config.updateRequireSignature) {
      return {
        ok: false,
        code: "SIGNATURE_REQUIRED",
        message: "signature is required by server policy",
        httpStatus: 400,
      };
    }

    return {
      ok: true,
      signature: null,
      signatureKeyId: null,
      signatureVerified: false,
    };
  }

  const verified = verifyUpdateSignature({
    version: input.version,
    packageUrl: input.packageUrl,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    signature: input.signature,
    keyId: input.signatureKeyId,
    keyStore: input.config.updateSigningKeys,
  });

  if (!verified.ok) {
    return {
      ok: false,
      code: verified.code ?? "UPDATE_SIGNATURE_MISMATCH",
      message: verified.message ?? "signature verification failed",
      httpStatus: 400,
    };
  }

  return {
    ok: true,
    signature: input.signature,
    signatureKeyId: verified.keyId,
    signatureVerified: true,
  };
}

function asCommandBody(body: unknown): CommandRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as CommandRequestBody;
}

function asEnrollBody(body: unknown): EnrollRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as EnrollRequestBody;
}

function asUpdateBody(body: unknown): UpdateRequestBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as UpdateRequestBody;
}

function asRenameDeviceBody(body: unknown): RenameDeviceBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as RenameDeviceBody;
}

function asDeviceAppAliasesBody(body: unknown): DeviceAppAliasesBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as DeviceAppAliasesBody;
}

function asDeviceControlBody(body: unknown): DeviceControlBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as DeviceControlBody;
}

function asUpdatePolicyBody(body: unknown): UpdatePolicyBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as UpdatePolicyBody;
}

function asRotateTokensBody(body: unknown): RotateTokensBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  return body as RotateTokensBody;
}

function normalizeUpdateTarget(candidate: unknown): string {
  return asTrimmedString(candidate).toLowerCase();
}

function isValidTargetFormat(value: string): boolean {
  return /^(all|[a-z][a-z0-9_-]{1,31})$/.test(value);
}

function normalizeUpdateVersion(candidate: unknown): string {
  return asTrimmedString(candidate);
}

function isValidUpdateVersion(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

function normalizeSha256(candidate: unknown): string {
  return asTrimmedString(candidate).toLowerCase();
}

function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function normalizeUpdatePackageUrl(candidate: unknown, enforceHttps = true): string | null {
  const value = asTrimmedString(candidate);
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (enforceHttps && parsed.protocol !== "https:") {
      return null;
    }

    if (!enforceHttps && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    if (!parsed.hostname) {
      return null;
    }

    if (parsed.username || parsed.password) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOptionalSizeBytes(value: unknown, maxBytes: number): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed > maxBytes) {
    return null;
  }

  return parsed;
}

function normalizeOptionalSignature(value: unknown): string | null {
  const normalized = asTrimmedString(value).replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_UPDATE_SIGNATURE_LEN) {
    return null;
  }

  if (!/^[A-Za-z0-9+/_=-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeOptionalSignatureKeyId(value: unknown): string | null {
  const normalized = asTrimmedString(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_SIGNING_KEY_ID_LEN || !/^[a-z0-9._-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeOptionalTimeoutMs(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }

  const bounded = Math.floor(parsed);
  const min = 1_000;
  const max = 15 * 60 * 1_000;
  return Math.max(min, Math.min(max, bounded));
}

function normalizeOwnerGraceSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_OWNER_TOKEN_GRACE_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  const bounded = Math.floor(parsed);
  if (bounded < 0 || bounded > MAX_OWNER_TOKEN_GRACE_SECONDS) {
    return null;
  }

  return bounded;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  return false;
}

function normalizeOptionalLockdownMinutes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < MIN_LOCKDOWN_MINUTES || parsed > MAX_LOCKDOWN_MINUTES) {
    return null;
  }

  return Math.floor(parsed);
}

function makeUpdateRawText(target: string, version: string, packageUrl: string): string {
  return `${target} update ${version} ${packageUrl}`;
}

function makeUpdateArgs(input: {
  version: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number | null;
  signature: string | null;
  signatureKeyId: string | null;
  usePrivilegedHelper: boolean;
  nextDeviceId?: string;
}): Record<string, unknown> {
  return {
    version: input.version,
    url: input.packageUrl,
    sha256: input.sha256,
    ...(input.sizeBytes ? { size_bytes: input.sizeBytes } : {}),
    ...(input.signature ? { signature: input.signature } : {}),
    ...(input.signatureKeyId ? { signature_key_id: input.signatureKeyId } : {}),
    ...(input.usePrivilegedHelper ? { use_privileged_helper: true } : {}),
    ...(input.nextDeviceId ? { next_device_id: input.nextDeviceId } : {}),
  };
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function normalizeOptionalVersion(value: unknown): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeRevokedVersions(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const version = asTrimmedString(item);
    if (!version || seen.has(version)) {
      continue;
    }

    if (!isValidUpdateVersion(version)) {
      return null;
    }

    seen.add(version);
    output.push(version);
    if (output.length >= MAX_REVOKED_VERSIONS) {
      break;
    }
  }

  return output;
}

function hasOwnField(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const capabilities: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const normalized = asTrimmedString(item).toLowerCase();
    if (!normalized || normalized.length > 40) {
      continue;
    }

    if (!/^[a-z0-9_-]+$/.test(normalized)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      capabilities.push(normalized);
    }

    if (capabilities.length >= MAX_CAPABILITIES) {
      break;
    }
  }

  return capabilities;
}

function parseActionTextAsCommand(text: string): TypedCommand | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const parsed = parseExternalCommand(`m1 ${normalized}`);
  if ("code" in parsed) {
    return null;
  }

  return parsed.command;
}

function rewriteOpenAliasCommand(rawText: string, db: Database): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return rawText;
  }

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0) {
    return rawText;
  }

  const target = trimmed.slice(0, firstSpace).trim().toLowerCase();
  if (!target || target === "all" || !/^[a-z][a-z0-9_-]{1,31}$/.test(target)) {
    return rawText;
  }

  const commandPhrase = trimmed.slice(firstSpace + 1).trim();
  const openMatch = commandPhrase.match(/^(open|launch|start)\s+(.+)$/i);
  if (!openMatch) {
    return rawText;
  }

  const alias = openMatch[2]?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (!alias) {
    return rawText;
  }

  const mapped = db.resolveDeviceAppAlias(target, alias);
  if (!mapped || !OPEN_APP_CANONICAL_ALLOWLIST.has(mapped)) {
    return rawText;
  }

  return `${target} open ${mapped}`;
}

function publishCommandLogEvent(
  deps: ApiDeps,
  input: {
    requestId: string;
    deviceId: string;
    source: string;
    rawText: string;
    parsedTarget: string;
    parsedType: string;
    status: string;
    message: string | null;
    resultPayload?: Record<string, unknown> | null;
    errorCode?: string | null;
  },
): void {
  deps.eventHub.publish("command_log", {
    request_id: input.requestId,
    device_id: input.deviceId,
    source: input.source,
    raw_text: input.rawText,
    parsed_target: input.parsedTarget,
    parsed_type: input.parsedType,
    status: input.status,
    message: input.message,
    result_payload: input.resultPayload ?? null,
    error_code: input.errorCode ?? null,
    ts: new Date().toISOString(),
  });
}

function normalizeHistoryLimit(value: unknown): number {
  const parsed = Number.parseInt(asTrimmedString(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function writeSseEvent(reply: FastifyReply, event: RealtimeEvent): void {
  try {
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify({ ts: event.ts, ...event.payload })}\n\n`);
  } catch {
    // noop: closed sockets naturally fail writes.
  }
}

export async function registerApiRoutes(server: FastifyInstance, deps: ApiDeps): Promise<void> {
  const rateLimiter = new FixedWindowRateLimiter({
    maxEntries: 25_000,
    pruneEveryHits: 200,
  });

  const createApiKeyWithRetry = (input: {
    name: string;
    scopes: ApiScope[];
  }): { key: ReturnType<Database["createApiKey"]>; rawToken: string } | null => {
    const rawToken = randomToken(32);
    const tokenHash = sha256Hex(rawToken);
    let created: ReturnType<Database["createApiKey"]> | null = null;
    let attempts = 0;

    while (!created && attempts < 5) {
      attempts += 1;
      const keyId = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      try {
        created = deps.db.createApiKey({
          keyId,
          name: input.name,
          tokenHash,
          scopes: input.scopes,
        });
      } catch {
        created = null;
      }
    }

    if (!created) {
      return null;
    }

    return {
      key: created,
      rawToken,
    };
  };

  server.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);

    const path = requestPath(request.url);
    const rule = resolveRateLimitRule(request.method, path);
    if (rule) {
      const identity = resolveClientIdentity(request);
      const limit = rateLimiter.hit({
        key: `${rule.id}:${identity}`,
        limit: rule.limit,
        windowMs: rule.windowMs,
      });

      reply.header("X-RateLimit-Limit", String(limit.limit));
      reply.header("X-RateLimit-Remaining", String(limit.remaining));
      reply.header("X-RateLimit-Reset", String(Math.ceil(limit.resetAt / 1000)));

      if (!limit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
        reply.header("Retry-After", String(retryAfterSeconds));
        reply.code(429).send({
          ok: false,
          message: rule.message,
          error_code: "RATE_LIMITED",
          retry_after_seconds: retryAfterSeconds,
        });
        return;
      }
    }

    if (requiresJsonBody(request.method, path) && !isJsonContentType(request.headers["content-type"])) {
      reply.code(415).send({
        ok: false,
        message: "Content-Type must be application/json",
        error_code: "UNSUPPORTED_MEDIA_TYPE",
      });
      return;
    }
  });

  server.addHook("onSend", async (request, reply, payload) => {
    if (!reply.hasHeader("X-Content-Type-Options")) {
      reply.header("X-Content-Type-Options", "nosniff");
    }

    if (!reply.hasHeader("X-Frame-Options")) {
      reply.header("X-Frame-Options", "DENY");
    }

    if (!reply.hasHeader("Referrer-Policy")) {
      reply.header("Referrer-Policy", "no-referrer");
    }

    if (!reply.hasHeader("Permissions-Policy")) {
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    }

    if (requestPath(request.url).startsWith("/api/") && !reply.hasHeader("Cache-Control")) {
      reply.header("Cache-Control", "no-store");
    }

    return payload;
  });

  server.get("/api/health", async () => {
    const dbStats = deps.db.healthSnapshot();

    return {
      ok: true,
      service: "cordyceps-server",
      ts: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      online_connections: deps.registry.countOnline(),
      pending_commands: deps.router.pendingCount(),
      devices_total: dbStats.deviceCount,
      devices_online: dbStats.onlineDeviceCount,
      command_logs_total: dbStats.commandLogCount,
      groups_total: dbStats.groupCount,
      api_keys_total: dbStats.apiKeyCount,
    };
  });

  server.get("/api/admin/overview", async (request, reply) => {
    if (!authorize(request, reply, deps, ["admin:manage"])) {
      return;
    }

    const dbStats = deps.db.healthSnapshot();
    const policy = deps.db.getUpdatePolicy();
    const controls = deps.db.listDeviceControls();
    const activeControls = controls.filter((control) => control.quarantine_enabled || control.kill_switch_enabled);
    const onlineByCapability = new Map<string, number>();

    for (const deviceId of deps.registry.listOnlineDeviceIds()) {
      const connected = deps.registry.get(deviceId);
      if (!connected) {
        continue;
      }

      for (const capability of connected.capabilities) {
        onlineByCapability.set(capability, (onlineByCapability.get(capability) ?? 0) + 1);
      }
    }

    reply.send({
      ok: true,
      ts: new Date().toISOString(),
      health: {
        uptime_seconds: Math.floor(process.uptime()),
        online_connections: deps.registry.countOnline(),
        pending_commands: deps.router.pendingCount(),
        devices_total: dbStats.deviceCount,
        devices_online: dbStats.onlineDeviceCount,
        command_logs_total: dbStats.commandLogCount,
        groups_total: dbStats.groupCount,
        api_keys_total: dbStats.apiKeyCount,
      },
      update_policy: {
        ...policy,
        auto_update: deps.config.allowAutomaticUpdates ? policy.auto_update : false,
      },
      security_controls: {
        active_count: activeControls.length,
        quarantined_count: controls.filter((control) => control.quarantine_enabled).length,
        kill_switch_count: controls.filter((control) => control.kill_switch_enabled).length,
        devices: activeControls,
      },
      online_capabilities: Object.fromEntries([...onlineByCapability.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
    });
  });

  server.get("/api/auth/scopes", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    reply.send({
      ok: true,
      scopes: API_SCOPES,
      subject: auth.subject,
    });
  });

  server.get("/api/auth/keys", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    reply.send({
      ok: true,
      keys: deps.db.listApiKeys(),
    });
  });

  server.post("/api/auth/keys", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    const body = asCreateApiKeyBody(request.body);
    const name = normalizeOptionalText(body.name, 80);
    if (!name) {
      reply.code(400).send({
        ok: false,
        message: "name is required",
        error_code: "INVALID_KEY_NAME",
      });
      return;
    }

    const scopes = normalizeApiKeyScopes(body.scopes);
    if (scopes.length === 0) {
      reply.code(400).send({
        ok: false,
        message: "scopes must include at least one valid scope",
        error_code: "INVALID_KEY_SCOPES",
      });
      return;
    }

    if (!auth.isOwnerToken && scopes.includes("admin:manage")) {
      forbidden(reply, "Only owner token may mint admin keys");
      return;
    }

    const created = createApiKeyWithRetry({ name, scopes });
    if (!created) {
      reply.code(500).send({
        ok: false,
        message: "Failed to create API key",
        error_code: "API_KEY_CREATE_FAILED",
      });
      return;
    }

    reply.send({
      ok: true,
      key: created.key,
      api_key: created.rawToken,
    });
  });

  server.post("/api/auth/keys/:keyId/revoke", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    const params = request.params as { keyId?: string } | undefined;
    const keyId = asTrimmedString(params?.keyId);
    if (!keyId) {
      reply.code(400).send({
        ok: false,
        message: "key_id is required",
        error_code: "INVALID_KEY_ID",
      });
      return;
    }

    const revoked = deps.db.revokeApiKey(keyId);
    if (!revoked) {
      reply.code(404).send({
        ok: false,
        message: `Unknown key: ${keyId}`,
        error_code: "UNKNOWN_KEY",
      });
      return;
    }

    reply.send({
      ok: true,
      message: `Revoked key ${keyId}`,
    });
  });

  server.post("/api/auth/keys/:keyId/rotate", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    const params = request.params as { keyId?: string } | undefined;
    const keyId = asTrimmedString(params?.keyId);
    if (!keyId) {
      reply.code(400).send({
        ok: false,
        message: "key_id is required",
        error_code: "INVALID_KEY_ID",
      });
      return;
    }

    const current = deps.db.getApiKeyById(keyId);
    if (!current) {
      reply.code(404).send({
        ok: false,
        message: `Unknown key: ${keyId}`,
        error_code: "UNKNOWN_KEY",
      });
      return;
    }

    if (current.status !== "active") {
      reply.code(409).send({
        ok: false,
        message: `Key ${keyId} is not active`,
        error_code: "KEY_NOT_ACTIVE",
      });
      return;
    }

    const scopes = current.scopes.filter((scope): scope is ApiScope => isValidApiScope(scope));
    if (!auth.isOwnerToken && scopes.includes("admin:manage")) {
      forbidden(reply, "Only owner token may rotate admin keys");
      return;
    }

    const replacement = createApiKeyWithRetry({
      name: current.name,
      scopes,
    });
    if (!replacement) {
      reply.code(500).send({
        ok: false,
        message: "Failed to rotate API key",
        error_code: "API_KEY_ROTATE_FAILED",
      });
      return;
    }

    deps.db.revokeApiKey(keyId);

    reply.send({
      ok: true,
      rotated_from: keyId,
      key: replacement.key,
      api_key: replacement.rawToken,
    });
  });

  server.post("/api/auth/tokens/rotate", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["admin:manage"]);
    if (!auth) {
      return;
    }

    if (!auth.isOwnerToken) {
      forbidden(reply, "Only owner token may rotate owner/bootstrap tokens");
      return;
    }

    const body = asRotateTokensBody(request.body);
    const rotateOwner = hasOwnField(body, "rotate_owner_token") ? normalizeBoolean(body.rotate_owner_token) : true;
    const rotateBootstrap = hasOwnField(body, "rotate_bootstrap_token")
      ? normalizeBoolean(body.rotate_bootstrap_token)
      : false;

    if (!rotateOwner && !rotateBootstrap) {
      reply.code(400).send({
        ok: false,
        message: "Set rotate_owner_token and/or rotate_bootstrap_token to true",
        error_code: "INVALID_ROTATION_REQUEST",
      });
      return;
    }

    const ownerGraceSeconds = rotateOwner
      ? normalizeOwnerGraceSeconds(body.owner_grace_seconds)
      : 0;
    if (rotateOwner && ownerGraceSeconds === null) {
      reply.code(400).send({
        ok: false,
        message: `owner_grace_seconds must be an integer between 0 and ${MAX_OWNER_TOKEN_GRACE_SECONDS}`,
        error_code: "INVALID_OWNER_GRACE_SECONDS",
      });
      return;
    }

    if (rotateOwner && deps.config.phoneApiTokenSource === "env") {
      reply.code(409).send({
        ok: false,
        message: "Owner token is env-managed and cannot be rotated at runtime",
        error_code: "OWNER_TOKEN_ENV_MANAGED",
      });
      return;
    }

    if (rotateBootstrap && deps.config.agentBootstrapTokenSource === "env") {
      reply.code(409).send({
        ok: false,
        message: "Bootstrap token is env-managed and cannot be rotated at runtime",
        error_code: "BOOTSTRAP_TOKEN_ENV_MANAGED",
      });
      return;
    }

    const previousOwnerToken = deps.config.phoneApiToken;
    const nextOwnerToken = rotateOwner ? randomToken(32) : deps.config.phoneApiToken;
    const nextBootstrapToken = rotateBootstrap ? randomToken(24) : deps.config.agentBootstrapToken;

    try {
      writeSecretsFile(deps.config.secretsPath, {
        phoneApiToken: nextOwnerToken,
        agentBootstrapToken: nextBootstrapToken,
      });
    } catch (error) {
      reply.code(500).send({
        ok: false,
        message: error instanceof Error ? error.message : "Failed to persist rotated tokens",
        error_code: "TOKEN_ROTATION_PERSIST_FAILED",
      });
      return;
    }

    deps.config.phoneApiToken = nextOwnerToken;
    deps.config.agentBootstrapToken = nextBootstrapToken;
    if (rotateOwner) {
      deps.config.phoneApiTokenSource = "secrets_file";
    }
    if (rotateBootstrap) {
      deps.config.agentBootstrapTokenSource = "secrets_file";
    }

    const previousOwnerTokenValidUntil = rotateOwner
      ? addOwnerTokenFallback(previousOwnerToken, ownerGraceSeconds ?? 0)
      : null;

    reply.send({
      ok: true,
      rotated_owner_token: rotateOwner,
      rotated_bootstrap_token: rotateBootstrap,
      owner_token: rotateOwner ? nextOwnerToken : null,
      bootstrap_token: rotateBootstrap ? nextBootstrapToken : null,
      owner_grace_seconds: rotateOwner ? (ownerGraceSeconds ?? 0) : 0,
      previous_owner_token_valid_until: previousOwnerTokenValidUntil,
    });
  });

  server.get("/api/events", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["events:read"], { allowQueryToken: true });
    if (!auth) {
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    writeSseEvent(reply, {
      type: "ready",
      ts: new Date().toISOString(),
      payload: {
        subject: auth.subject,
      },
    });

    const unsubscribe = deps.eventHub.subscribe((event) => {
      writeSseEvent(reply, event);
    });

    const pingTimer = setInterval(() => {
      writeSseEvent(reply, {
        type: "ping",
        ts: new Date().toISOString(),
        payload: {},
      });
    }, SSE_PING_INTERVAL_MS);
    pingTimer.unref?.();

    const cleanup = (): void => {
      clearInterval(pingTimer);
      unsubscribe();
    };

    request.raw.on("close", cleanup);
    request.raw.on("end", cleanup);
    request.raw.on("error", cleanup);
  });

  server.get("/api/devices", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:read"])) {
      return;
    }

    const devices = deps.db.listDevices().map((device) => {
      const control = deps.db.getDeviceControl(device.device_id);
      return {
        ...withProfile(device),
        quarantine_enabled: control.quarantine_enabled,
        kill_switch_enabled: control.kill_switch_enabled,
        quarantine_reason: control.reason,
      };
    });

    return {
      ok: true,
      devices,
    };
  });

  server.get("/api/devices/:deviceId", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:read"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_DEVICE_ID",
      });
      return;
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const recentLogLimit = Math.max(1, Math.min(100, normalizeHistoryLimit(query.logs_limit)));
    const dbDevice = deps.db.getDevice(deviceId);
    const connected = deps.registry.get(deviceId);
    if (!dbDevice && !connected) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    const device = dbDevice ?? {
      device_id: deviceId,
      display_name: null,
      status: connected ? "online" : "offline",
      last_seen: connected ? new Date(connected.lastSeenAt).toISOString() : "",
      version: connected?.version ?? null,
      hostname: connected?.hostname ?? null,
      username: connected?.username ?? null,
      capabilities: connected?.capabilities ?? [],
      device_info: connected?.deviceInfo ?? null,
      created_at: "",
      updated_at: "",
    };

    const control = deps.db.getDeviceControl(deviceId);
    const aliases = deps.db.listDeviceAppAliases(deviceId);
    const queuedUpdates = deps.db.listQueuedUpdatesForDevice(deviceId);
    const recentLogs = deps.db.listCommandLogs({
      limit: recentLogLimit,
      deviceId,
    });

    reply.send({
      ok: true,
      device: {
        ...withProfile(device),
        quarantine_enabled: control.quarantine_enabled,
        kill_switch_enabled: control.kill_switch_enabled,
        quarantine_reason: control.reason,
      },
      realtime: connected
        ? {
            connected: true,
            connected_at: new Date(connected.connectedAt).toISOString(),
            last_seen_at: new Date(connected.lastSeenAt).toISOString(),
            device_info: connected.deviceInfo ?? null,
          }
        : {
            connected: false,
            connected_at: null,
            last_seen_at: null,
            device_info: null,
          },
      aliases,
      queued_updates: queuedUpdates,
      recent_logs: recentLogs,
    });
  });

  server.delete("/api/devices/:deviceId", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:write"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_DEVICE_ID",
      });
      return;
    }

    if (deps.registry.get(deviceId)) {
      reply.code(409).send({
        ok: false,
        message: `${deviceId} is online. Disconnect it before deleting the record.`,
        error_code: "DEVICE_ONLINE",
      });
      return;
    }

    if (!deps.db.deleteDevice(deviceId)) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    deps.router.clearDevicePending(deviceId);
    deps.eventHub.publish("device_status", {
      device_id: deviceId,
      status: "deleted",
      reason: "manual_delete",
    });

    reply.send({
      ok: true,
      device_id: deviceId,
      message: `Deleted device record ${deviceId}`,
    });
  });

  server.post("/api/devices/:deviceId/display-name", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:write"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const body = asRenameDeviceBody(request.body);
    const displayName = normalizeOptionalText(body.display_name, 80);
    if (!deps.db.updateDeviceDisplayName(deviceId, displayName)) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    const updated = deps.db.getDevice(deviceId);
    reply.send({
      ok: true,
      device: updated ? withProfile(updated) : null,
      message: displayName ? `Saved name for ${deviceId}` : `Cleared name for ${deviceId}`,
    });
  });

  server.post("/api/devices/:deviceId/control", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:write"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_DEVICE_ID",
      });
      return;
    }

    const known = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
    if (!known) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    const body = asDeviceControlBody(request.body);
    const hasQuarantineField = hasOwnField(body, "quarantine_enabled");
    const hasKillSwitchField = hasOwnField(body, "kill_switch_enabled");
    const hasEnforceLockdownField = hasOwnField(body, "enforce_lockdown");
    const hasTriggerLockdownField = hasOwnField(body, "trigger_lockdown");
    const hasLockdownMinutesField = hasOwnField(body, "lockdown_minutes");
    if (
      !hasQuarantineField &&
      !hasKillSwitchField &&
      !hasOwnField(body, "reason") &&
      !hasEnforceLockdownField &&
      !hasTriggerLockdownField &&
      !hasLockdownMinutesField
    ) {
      reply.code(400).send({
        ok: false,
        message:
          "Provide at least one of quarantine_enabled, kill_switch_enabled, reason, enforce_lockdown, trigger_lockdown, or lockdown_minutes",
        error_code: "INVALID_CONTROL_UPDATE",
      });
      return;
    }

    const parsedLockdownMinutes = normalizeOptionalLockdownMinutes(body.lockdown_minutes);
    if (hasLockdownMinutesField && parsedLockdownMinutes === null) {
      reply.code(400).send({
        ok: false,
        message: `lockdown_minutes must be an integer between ${MIN_LOCKDOWN_MINUTES} and ${MAX_LOCKDOWN_MINUTES}`,
        error_code: "INVALID_LOCKDOWN_MINUTES",
      });
      return;
    }

    const lockdownMinutes = parsedLockdownMinutes ?? DEFAULT_LOCKDOWN_MINUTES;

    const current = deps.db.getDeviceControl(deviceId);
    let quarantineEnabled = hasQuarantineField ? normalizeBoolean(body.quarantine_enabled) : current.quarantine_enabled;
    let killSwitchEnabled = hasKillSwitchField ? normalizeBoolean(body.kill_switch_enabled) : current.kill_switch_enabled;
    if (killSwitchEnabled) {
      quarantineEnabled = true;
    }

    if (!quarantineEnabled) {
      killSwitchEnabled = false;
    }

    const hasReasonField = hasOwnField(body, "reason");
    const requestedReason = normalizeOptionalText(body.reason, MAX_DEVICE_CONTROL_REASON_LEN) ?? null;
    const reason = quarantineEnabled
      ? hasReasonField
        ? requestedReason
        : current.reason
      : null;

    const control = deps.db.upsertDeviceControl({
      deviceId,
      quarantineEnabled,
      killSwitchEnabled,
      reason,
    });

    const connected = deps.registry.get(deviceId);
    const requestedLockdown = hasTriggerLockdownField ? normalizeBoolean(body.trigger_lockdown) : false;
    const enforcedLockdown = hasEnforceLockdownField ? normalizeBoolean(body.enforce_lockdown) : false;
    const shouldLockdown = Boolean(connected && (requestedLockdown || enforcedLockdown));

    let lockdownResult:
      | {
          attempted: boolean;
          command_type: string;
          lockdown_minutes: number | null;
          ok: boolean;
          message: string;
          error_code?: string;
        }
      | null = null;

    if (shouldLockdown && connected) {
      const commandType = connected.capabilities.includes("emergency_lockdown") ? "EMERGENCY_LOCKDOWN" : "LOCK_PC";
      const requestId = makeRequestId();
      const commandArgs =
        commandType === "EMERGENCY_LOCKDOWN"
          ? {
              rollback_minutes: lockdownMinutes,
            }
          : {};
      try {
        const result = await deps.router.dispatchToDevice({
          requestId,
          deviceId,
          command: {
            type: commandType,
            args: commandArgs,
          },
          timeoutMs: timeoutForCommand(deps.config, commandType),
        });

        lockdownResult = {
          attempted: true,
          command_type: commandType,
          lockdown_minutes: commandType === "EMERGENCY_LOCKDOWN" ? lockdownMinutes : null,
          ok: result.ok,
          message: result.message,
          error_code: result.error_code,
        };
      } catch (error) {
        const dispatch = parseDispatchError(error);
        lockdownResult = {
          attempted: true,
          command_type: commandType,
          lockdown_minutes: commandType === "EMERGENCY_LOCKDOWN" ? lockdownMinutes : null,
          ok: false,
          message: dispatch.message,
          error_code: dispatch.code,
        };
      }
    }

    const disconnected = killSwitchEnabled
      ? deps.registry.forceDisconnect(deviceId, 4008, "Kill-switch policy enabled")
      : false;

    if (disconnected) {
      deps.db.markDeviceOffline(deviceId);
      deps.router.clearDevicePending(deviceId);
      deps.eventHub.publish("device_status", {
        device_id: deviceId,
        status: "offline",
        reason: "kill_switch",
      });
    }

    reply.send({
      ok: true,
      device_id: deviceId,
      control,
      lockdown: lockdownResult,
      disconnected,
    });
  });

  server.get("/api/devices/:deviceId/app-aliases", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:read"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const known = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
    if (!known) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    reply.send({
      ok: true,
      device_id: deviceId,
      aliases: deps.db.listDeviceAppAliases(deviceId),
    });
  });

  server.put("/api/devices/:deviceId/app-aliases", async (request, reply) => {
    if (!authorize(request, reply, deps, ["devices:write"])) {
      return;
    }

    const params = request.params as { deviceId?: string } | undefined;
    const deviceId = asTrimmedString(params?.deviceId).toLowerCase();
    if (!deviceId || !/^[a-z0-9_-]{2,32}$/.test(deviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const known = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
    if (!known) {
      reply.code(404).send({
        ok: false,
        message: `Unknown device: ${deviceId}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    const body = asDeviceAppAliasesBody(request.body);
    const aliasesRaw = Array.isArray(body.aliases) ? body.aliases : [];
    const aliases: Array<{ alias: string; app: string }> = [];

    for (const entry of aliasesRaw) {
      const alias = asTrimmedString(entry?.alias).toLowerCase().replace(/\s+/g, " ");
      const app = asTrimmedString(entry?.app).toLowerCase();
      if (!alias || !app) {
        continue;
      }

      if (alias.length > 80 || !/^[a-z0-9 _-]+$/.test(alias)) {
        reply.code(400).send({
          ok: false,
          message: `Invalid alias: ${alias}`,
          error_code: "INVALID_ALIAS",
        });
        return;
      }

      if (!OPEN_APP_CANONICAL_ALLOWLIST.has(app)) {
        reply.code(400).send({
          ok: false,
          message: `Invalid app target for alias ${alias}: ${app}`,
          error_code: "INVALID_ALIAS_APP",
        });
        return;
      }

      aliases.push({ alias, app });
      if (aliases.length >= 200) {
        break;
      }
    }

    const saved = deps.db.replaceDeviceAppAliases(deviceId, aliases);
    reply.send({
      ok: true,
      device_id: deviceId,
      aliases: saved,
      message: `Saved ${saved.length} app aliases`,
    });
  });

  server.get("/api/command-logs", async (request, reply) => {
    if (!authorize(request, reply, deps, ["history:read"])) {
      return;
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = normalizeHistoryLimit(query.limit);
    const before = asTrimmedString(query.before);
    const deviceId = asTrimmedString(query.device_id).toLowerCase();
    const requestId = asTrimmedString(query.request_id);
    const parsedType = asTrimmedString(query.parsed_type).toUpperCase();
    const status = asTrimmedString(query.status).toLowerCase();

    const logs = deps.db.listCommandLogs({
      limit,
      before: before || undefined,
      deviceId: deviceId || undefined,
      requestId: requestId || undefined,
      parsedType: parsedType || undefined,
      status: status || undefined,
    });

    const nextBefore = logs.length > 0 ? logs[logs.length - 1]?.created_at : null;

    reply.send({
      ok: true,
      count: logs.length,
      next_before: nextBefore,
      logs,
    });
  });

  server.get("/api/command-jobs/:requestId", async (request, reply) => {
    if (!authorize(request, reply, deps, ["history:read"])) {
      return;
    }

    const params = request.params as { requestId?: string } | undefined;
    const requestId = asTrimmedString(params?.requestId);
    if (!requestId) {
      reply.code(400).send({
        ok: false,
        message: "request_id is required",
        error_code: "INVALID_REQUEST_ID",
      });
      return;
    }

    const logs = deps.db.listCommandLogs({
      limit: MAX_HISTORY_LIMIT,
      requestId,
    });

    if (logs.length === 0) {
      reply.code(404).send({
        ok: false,
        request_id: requestId,
        message: `Unknown request_id: ${requestId}`,
        error_code: "UNKNOWN_REQUEST_ID",
      });
      return;
    }

    const done = logs.every((entry) => entry.status !== "queued");
    const okCount = logs.filter((entry) => entry.status === "ok").length;
    const failedCount = logs.filter((entry) => entry.status === "failed" || entry.status === "timeout").length;

    reply.send({
      ok: failedCount === 0 && done,
      request_id: requestId,
      done,
      ok_count: okCount,
      failed_count: failedCount,
      total: logs.length,
      logs,
    });
  });

  server.get("/api/groups", async (request, reply) => {
    if (!authorize(request, reply, deps, ["groups:read"])) {
      return;
    }

    const groups = deps.db.listDeviceGroups().map((group) => ({
      ...group,
      online_count: group.device_ids.filter((deviceId) => deps.registry.get(deviceId)).length,
    }));

    reply.send({
      ok: true,
      groups,
    });
  });

  server.put("/api/groups/:groupId", async (request, reply) => {
    if (!authorize(request, reply, deps, ["groups:write"])) {
      return;
    }

    const params = request.params as { groupId?: string } | undefined;
    const groupId = normalizeGroupId(params?.groupId);
    if (!isValidGroupId(groupId)) {
      reply.code(400).send({
        ok: false,
        message: "group_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_GROUP_ID",
      });
      return;
    }

    const body = asUpsertGroupBody(request.body);
    const displayName = normalizeOptionalText(body.display_name, MAX_GROUP_DISPLAY_NAME_LEN);
    if (!displayName) {
      reply.code(400).send({
        ok: false,
        message: "display_name is required",
        error_code: "INVALID_GROUP_NAME",
      });
      return;
    }

    const description = normalizeOptionalText(body.description, MAX_GROUP_DESCRIPTION_LEN);
    const deviceIds = normalizeGroupDeviceIds(body.device_ids);
    if (deviceIds.length > MAX_GROUP_MEMBER_COUNT) {
      reply.code(400).send({
        ok: false,
        message: `group has too many members (max ${MAX_GROUP_MEMBER_COUNT})`,
        error_code: "GROUP_TOO_LARGE",
      });
      return;
    }

    const known = deps.db.listExistingDeviceIds(deviceIds);
    const unknown = deviceIds.filter((deviceId) => !known.has(deviceId));
    if (unknown.length > 0) {
      reply.code(404).send({
        ok: false,
        message: `Unknown devices: ${unknown.join(", ")}`,
        error_code: "UNKNOWN_DEVICE",
      });
      return;
    }

    const group = deps.db.upsertDeviceGroup({
      groupId,
      displayName,
      description,
      deviceIds,
    });

    reply.send({
      ok: true,
      group,
      message: `Saved group ${groupId}`,
    });
  });

  server.delete("/api/groups/:groupId", async (request, reply) => {
    if (!authorize(request, reply, deps, ["groups:write"])) {
      return;
    }

    const params = request.params as { groupId?: string } | undefined;
    const groupId = normalizeGroupId(params?.groupId);
    if (!isValidGroupId(groupId)) {
      reply.code(400).send({
        ok: false,
        message: "group_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_GROUP_ID",
      });
      return;
    }

    const removed = deps.db.deleteDeviceGroup(groupId);
    if (!removed) {
      reply.code(404).send({
        ok: false,
        message: `Unknown group: ${groupId}`,
        error_code: "UNKNOWN_GROUP",
      });
      return;
    }

    reply.send({
      ok: true,
      message: `Deleted group ${groupId}`,
    });
  });

  server.post("/api/groups/:groupId/command", async (request, reply) => {
    if (!authorize(request, reply, deps, ["groups:write", "commands:execute"])) {
      return;
    }

    const params = request.params as { groupId?: string } | undefined;
    const groupId = normalizeGroupId(params?.groupId);
    if (!isValidGroupId(groupId)) {
      reply.code(400).send({
        ok: false,
        message: "group_id must be 2-32 chars and use a-z, 0-9, _ or -",
        error_code: "INVALID_GROUP_ID",
      });
      return;
    }

    const group = deps.db.getDeviceGroup(groupId);
    if (!group) {
      reply.code(404).send({
        ok: false,
        message: `Unknown group: ${groupId}`,
        error_code: "UNKNOWN_GROUP",
      });
      return;
    }

    const body = asGroupCommandBody(request.body);
    const rawText = asTrimmedString(body.text);
    const source = normalizeSource(body.source || "group");
    const requestId = normalizeRequestId(body.request_id);

    if (!rawText) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: command text is empty",
        error_code: "EMPTY_COMMAND",
      });
      return;
    }

    const parsedFromFullText = parseExternalCommand(rawText);
    const parsedCommand = "code" in parsedFromFullText ? parseActionTextAsCommand(rawText) : parsedFromFullText.command;
    if (!parsedCommand) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: unknown command",
        error_code: "UNKNOWN_COMMAND",
      });
      return;
    }

    if (!BULK_GROUP_ALLOWED_TYPES.has(parsedCommand.type)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `${parsedCommand.type} is not allowed for group dispatch`,
        error_code: "GROUP_COMMAND_NOT_ALLOWED",
      });
      return;
    }

    if (parsedCommand.type !== "PING" && body.confirm_bulk !== true) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Bulk command requires confirm_bulk=true",
        error_code: "BULK_CONFIRM_REQUIRED",
      });
      return;
    }

    const targetDeviceIds = [...group.device_ids];
    if (targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No devices in group",
        results: [],
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    const requiredCapability = requiredCapabilityForCommand(parsedCommand.type);
    const updatePolicy = deps.db.getUpdatePolicy();
    const dispatchableDeviceIds: string[] = [];
    const preflightResults: CommandDispatchResult[] = [];

    for (const deviceId of targetDeviceIds) {
      const connected = deps.registry.get(deviceId);
      if (!connected) {
        preflightResults.push({
          request_id: requestId,
          device_id: deviceId,
          ok: false,
          message: `${deviceId} is offline`,
          error_code: "DEVICE_OFFLINE",
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      const control = deps.db.getDeviceControl(deviceId);
      const policyFailure = preflightPolicyFailure({
        deviceId,
        commandType: parsedCommand.type,
        quarantineEnabled: control.quarantine_enabled,
        killSwitchEnabled: control.kill_switch_enabled,
        policy: updatePolicy,
        version: connected.version,
      });
      if (policyFailure) {
        preflightResults.push({
          request_id: requestId,
          device_id: deviceId,
          ok: false,
          message: policyFailure.message,
          error_code: policyFailure.code,
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      const profile = resolveDeviceProfile(deviceId, connected.capabilities);
      if (!isCommandAllowedForProfile(profile, parsedCommand.type)) {
        preflightResults.push({
          request_id: requestId,
          device_id: deviceId,
          ok: false,
          message: `${deviceId} (${profileLabel(profile)} profile) blocks ${parsedCommand.type.toLowerCase()}`,
          error_code: "COMMAND_NOT_ALLOWED_FOR_PROFILE",
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      if (requiredCapability && !connected.capabilities.includes(requiredCapability)) {
        preflightResults.push({
          request_id: requestId,
          device_id: deviceId,
          ok: false,
          message: `${deviceId} does not support ${parsedCommand.type.toLowerCase()} yet`,
          error_code: "COMMAND_NOT_SUPPORTED",
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      dispatchableDeviceIds.push(deviceId);
    }

    for (const skipped of preflightResults) {
      deps.db.insertCommandLog({
        id: makeLogId(requestId, skipped.device_id),
        requestId,
        deviceId: skipped.device_id,
        source,
        rawText,
        parsedTarget: `group:${groupId}`,
        parsedType: parsedCommand.type,
        argsJson: JSON.stringify(parsedCommand.args),
        status: "failed",
        resultMessage: skipped.message,
        errorCode: skipped.error_code ?? "ROUTING_ERROR",
      });
      deps.db.completeCommandLog({
        id: makeLogId(requestId, skipped.device_id),
        status: "failed",
        resultMessage: skipped.message,
        resultPayload: skipped.result_payload,
        errorCode: skipped.error_code,
      });
      publishCommandLogEvent(deps, {
        requestId,
        deviceId: skipped.device_id,
        source,
        rawText,
        parsedTarget: `group:${groupId}`,
        parsedType: parsedCommand.type,
        status: "failed",
        message: skipped.message,
        resultPayload: skipped.result_payload,
        errorCode: skipped.error_code,
      });
    }

    if (dispatchableDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No eligible online devices in group",
        results: preflightResults.map((result) => ({
          device_id: result.device_id,
          ok: result.ok,
          message: result.message,
          result_payload: result.result_payload ?? null,
          error_code: result.error_code,
        })),
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    for (const deviceId of dispatchableDeviceIds) {
      deps.db.insertCommandLog({
        id: makeLogId(requestId, deviceId),
        requestId,
        deviceId,
        source,
        rawText,
        parsedTarget: `group:${groupId}`,
        parsedType: parsedCommand.type,
        argsJson: JSON.stringify(parsedCommand.args),
        status: "queued",
        resultMessage: null,
        errorCode: null,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId,
        source,
        rawText,
        parsedTarget: `group:${groupId}`,
        parsedType: parsedCommand.type,
        status: "queued",
        message: null,
      });
    }

    const commandTimeoutMs = timeoutForCommand(deps.config, parsedCommand.type);
    const dispatchResults = await deps.router.dispatchToMany({
      requestId,
      deviceIds: dispatchableDeviceIds,
      command: parsedCommand,
      timeoutMs: commandTimeoutMs,
    });

    for (const result of dispatchResults) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId: result.device_id,
        source,
        rawText,
        parsedTarget: `group:${groupId}`,
        parsedType: parsedCommand.type,
        status: result.ok ? "ok" : "failed",
        message: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });
    }

    const results = [...dispatchResults, ...preflightResults];
    const okCount = dispatchResults.filter((result) => result.ok).length;
    const dispatchCount = dispatchResults.length;
    const skippedCount = preflightResults.length;
    reply.send({
      ok: okCount === dispatchCount && skippedCount === 0,
      request_id: requestId,
      target: `group:${groupId}`,
      parsed_type: parsedCommand.type,
      message: `Completed ${okCount}/${dispatchCount}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}`,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        result_payload: result.result_payload ?? null,
        error_code: result.error_code,
      })),
    });
  });

  server.post("/api/enroll", async (request, reply) => {
    const body = asEnrollBody(request.body);
    const bootstrapToken = asTrimmedString(body.bootstrap_token);
    if (!bootstrapToken || !constantTimeEqual(bootstrapToken, deps.config.agentBootstrapToken)) {
      unauthorized(reply);
      return;
    }

    const inputDeviceId = asTrimmedString(body.device_id).toLowerCase();
    const designationPrefix = normalizeDesignationPrefix(body.designation_prefix) || "m";

    if (inputDeviceId && !/^[a-z0-9_-]{2,32}$/.test(inputDeviceId)) {
      reply.code(400).send({
        ok: false,
        message: "device_id must be 2-32 chars and use a-z, 0-9, _ or -",
      });
      return;
    }

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const displayName = normalizeOptionalText(body.display_name, 80);
    const version = normalizeOptionalText(body.version, 40);
    const hostname = normalizeOptionalText(body.hostname, 120);
    const username = normalizeOptionalText(body.username, 120);
    const capabilities = normalizeCapabilities(body.capabilities);

    let deviceId = inputDeviceId;
    if (deviceId) {
      deps.db.enrollDevice({
        deviceId,
        tokenHash,
        displayName,
        version,
        hostname,
        username,
        capabilities,
      });
    } else {
      const maxAttempts = 5;
      let enrolled = false;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidateId = deps.db.allocateNextDeviceId(designationPrefix);
        const created = deps.db.enrollDeviceIfAbsent({
          deviceId: candidateId,
          tokenHash,
          displayName,
          version,
          hostname,
          username,
          capabilities,
        });

        if (created) {
          deviceId = candidateId;
          enrolled = true;
          break;
        }
      }

      if (!enrolled || !deviceId) {
        reply.code(503).send({
          ok: false,
          message: "Unable to allocate device designation",
        });
        return;
      }
    }

    log("info", "Device enrolled", {
      device_id: deviceId,
      hostname: normalizeOptionalText(body.hostname, 120) ?? null,
      username: normalizeOptionalText(body.username, 120) ?? null,
    });

    reply.send({
      ok: true,
      device_id: deviceId,
      device_token: token,
      ws_url: deps.config.publicWsUrl,
      message: "Enrollment complete",
    });
  });

  server.get("/api/update/policy", async (request, reply) => {
    if (!authorize(request, reply, deps, ["updates:execute"])) {
      return;
    }

    const policy = deps.db.getUpdatePolicy();
    reply.send({
      ok: true,
      policy: {
        ...policy,
        auto_update: deps.config.allowAutomaticUpdates ? policy.auto_update : false,
      },
    });
  });

  server.put("/api/update/policy", async (request, reply) => {
    if (!authorize(request, reply, deps, ["updates:execute"])) {
      return;
    }

    const current = deps.db.getUpdatePolicy();
    const body = asUpdatePolicyBody(request.body);

    const hasPinnedVersion = hasOwnField(body, "pinned_version");
    let pinnedVersion = hasPinnedVersion ? normalizeOptionalVersion(body.pinned_version) : current.pinned_version;
    if (pinnedVersion && !isValidUpdateVersion(pinnedVersion)) {
      reply.code(400).send({
        ok: false,
        message: "pinned_version must match [A-Za-z0-9._-] and be at most 64 chars",
        error_code: "INVALID_UPDATE_VERSION",
      });
      return;
    }

    const hasRevokedVersions = hasOwnField(body, "revoked_versions");
    let revokedVersions = hasRevokedVersions ? normalizeRevokedVersions(body.revoked_versions) : current.revoked_versions;
    if (!revokedVersions) {
      reply.code(400).send({
        ok: false,
        message: "revoked_versions must be an array of valid version strings",
        error_code: "INVALID_REVOKED_VERSIONS",
      });
      return;
    }

    const hasStrictMode = hasOwnField(body, "strict_mode");
    const strictMode = hasStrictMode ? normalizeBoolean(body.strict_mode) : current.strict_mode;
    const hasAutoUpdate = hasOwnField(body, "auto_update");
    const requestedAutoUpdate = hasAutoUpdate ? normalizeBoolean(body.auto_update) : current.auto_update;
    const autoUpdate = deps.config.allowAutomaticUpdates ? requestedAutoUpdate : false;

    const hasPackageUrl = hasOwnField(body, "package_url");
    const rawPackageUrl = asTrimmedString(body.package_url);
    let packageUrl = hasPackageUrl
      ? rawPackageUrl
        ? normalizeUpdatePackageUrl(rawPackageUrl, deps.config.enforceHttpsUpdateUrl)
        : null
      : current.package_url;

    if (hasPackageUrl && rawPackageUrl && !packageUrl) {
      reply.code(400).send({
        ok: false,
        message: deps.config.enforceHttpsUpdateUrl
          ? "package_url must be a valid https URL"
          : "package_url must be a valid http/https URL",
        error_code: "INVALID_UPDATE_URL",
      });
      return;
    }

    const hasSha = hasOwnField(body, "sha256");
    const rawSha = asTrimmedString(body.sha256).toLowerCase();
    let sha256 = hasSha ? (rawSha ? rawSha : null) : current.sha256;
    if (sha256 && !isValidSha256(sha256)) {
      reply.code(400).send({
        ok: false,
        message: "sha256 must be a 64-character lowercase or uppercase hex string",
        error_code: "INVALID_SHA256",
      });
      return;
    }

    const hasSizeBytes = hasOwnField(body, "size_bytes");
    let sizeBytes = hasSizeBytes
      ? normalizeOptionalSizeBytes(body.size_bytes, deps.config.updateMaxPackageBytes)
      : current.size_bytes;

    if (
      hasSizeBytes &&
      body.size_bytes !== undefined &&
      body.size_bytes !== null &&
      body.size_bytes !== "" &&
      sizeBytes === null
    ) {
      reply.code(400).send({
        ok: false,
        message: `size_bytes must be a positive integer <= ${deps.config.updateMaxPackageBytes}`,
        error_code: "INVALID_UPDATE_SIZE",
      });
      return;
    }

    const hasSignature = hasOwnField(body, "signature");
    const providedSignature = normalizeOptionalSignature(body.signature);
    let signature = hasSignature ? providedSignature : current.signature;
    if (
      hasSignature &&
      body.signature !== undefined &&
      body.signature !== null &&
      body.signature !== "" &&
      !providedSignature
    ) {
      reply.code(400).send({
        ok: false,
        message: "signature must be base64/base64url and at most 1024 chars",
        error_code: "INVALID_UPDATE_SIGNATURE",
      });
      return;
    }

    const hasSignatureKeyId = hasOwnField(body, "signature_key_id");
    const providedSignatureKeyId = normalizeOptionalSignatureKeyId(body.signature_key_id);
    let signatureKeyId = hasSignatureKeyId ? providedSignatureKeyId : current.signature_key_id;
    if (
      hasSignatureKeyId &&
      body.signature_key_id !== undefined &&
      body.signature_key_id !== null &&
      body.signature_key_id !== "" &&
      !providedSignatureKeyId
    ) {
      reply.code(400).send({
        ok: false,
        message: "signature_key_id must match [a-z0-9._-] and be at most 40 chars",
        error_code: "INVALID_SIGNATURE_KEY_ID",
      });
      return;
    }

    const hasUsePrivilegedHelper = hasOwnField(body, "use_privileged_helper");
    let usePrivilegedHelper = hasUsePrivilegedHelper
      ? normalizeBoolean(body.use_privileged_helper)
      : current.use_privileged_helper;

    if (!packageUrl) {
      sha256 = null;
      sizeBytes = null;
      signature = null;
      signatureKeyId = null;
      usePrivilegedHelper = false;
    }

    if (packageUrl && !sha256) {
      try {
        const inspected = await inspectPackageFromUrl({
          url: packageUrl,
          timeoutMs: deps.config.updateMetadataTimeoutMs,
          maxBytes: deps.config.updateMaxPackageBytes,
          requireHttps: deps.config.enforceHttpsUpdateUrl,
        });

        sha256 = inspected.sha256;
        packageUrl = inspected.finalUrl;
        if (!sizeBytes) {
          sizeBytes = inspected.sizeBytes;
        }
      } catch (error) {
        const failure = parsePackageInspectionFailure(error);
        reply.code(failure.httpStatus).send({
          ok: false,
          message: failure.message,
          error_code: failure.code,
        });
        return;
      }
    }

    if (packageUrl && sha256) {
      const signatureCheck = verifyNormalizedUpdateSignature({
        config: deps.config,
        version: pinnedVersion ?? "",
        packageUrl,
        sha256,
        sizeBytes,
        signature,
        signatureKeyId,
      });

      if (!signatureCheck.ok) {
        reply.code(signatureCheck.httpStatus).send({
          ok: false,
          message: signatureCheck.message,
          error_code: signatureCheck.code,
        });
        return;
      }

      signature = signatureCheck.signature;
      signatureKeyId = signatureCheck.signatureKeyId;
    }

    const policyActive = Boolean(pinnedVersion) || revokedVersions.length > 0;
    if (autoUpdate && policyActive) {
      if (!pinnedVersion) {
        reply.code(400).send({
          ok: false,
          message: "pinned_version is required when auto_update is enabled",
          error_code: "PINNED_VERSION_REQUIRED",
        });
        return;
      }

      if (!packageUrl || !sha256) {
        reply.code(400).send({
          ok: false,
          message: "package_url and sha256 are required when auto_update is enabled",
          error_code: "POLICY_PACKAGE_REQUIRED",
        });
        return;
      }
    }

    const saved = deps.db.upsertUpdatePolicy({
      pinnedVersion,
      packageUrl,
      sha256,
      sizeBytes,
      signature,
      signatureKeyId,
      usePrivilegedHelper,
      revokedVersions,
      strictMode,
      autoUpdate,
    });

    const queuedUpdates: string[] = [];
    if (
      deps.config.allowAutomaticUpdates &&
      saved.auto_update &&
      hasManagedPolicyPackage(saved) &&
      (!deps.config.updateRequireSignature || Boolean(saved.signature))
    ) {
      for (const deviceId of deps.registry.listOnlineDeviceIds()) {
        const connected = deps.registry.get(deviceId);
        if (!connected) {
          continue;
        }

        const versionGate = evaluateVersionPolicy(connected.version, saved);
        if (!versionGate.requiresUpdate) {
          continue;
        }

        if (!connected.capabilities.includes("updater")) {
          continue;
        }

        if (saved.use_privileged_helper && !connected.capabilities.includes("privileged_helper_split")) {
          continue;
        }

        const queued = queuePolicyUpdate({
          db: deps.db,
          deviceId,
          source: "server-policy",
          policy: saved,
        });

        if (!queued.queued || !queued.requestId || !saved.pinned_version || !saved.package_url) {
          continue;
        }

        queuedUpdates.push(deviceId);
        publishCommandLogEvent(deps, {
          requestId: queued.requestId,
          deviceId,
          source: "server-policy",
          rawText: makeUpdateRawText(deviceId, saved.pinned_version, saved.package_url),
          parsedTarget: deviceId,
          parsedType: "AGENT_UPDATE",
          status: "queued",
          message: null,
        });

        void deps.queuedUpdateDispatcher.kick(deviceId);
      }
    }

    reply.send({
      ok: true,
      policy: {
        ...saved,
        auto_update: deps.config.allowAutomaticUpdates ? saved.auto_update : false,
      },
      queued_updates: queuedUpdates,
      auto_update_enabled: deps.config.allowAutomaticUpdates,
    });
  });

  server.post("/api/update", async (request, reply) => {
    if (!authorize(request, reply, deps, ["updates:execute"])) {
      return;
    }

    const body = asUpdateBody(request.body);
    const requestId = normalizeRequestId(body.request_id);
    const source = normalizeSource(asTrimmedString(body.source) || "server-update");
    const target = normalizeUpdateTarget(body.target);
    const version = normalizeUpdateVersion(body.version);
    const packageUrl = normalizeUpdatePackageUrl(body.package_url, deps.config.enforceHttpsUpdateUrl);
    const providedSha256 = normalizeSha256(body.sha256);
    const providedSignature = normalizeOptionalSignature(body.signature);
    const providedSignatureKeyId = normalizeOptionalSignatureKeyId(body.signature_key_id);
    const usePrivilegedHelper = hasOwnField(body, "use_privileged_helper")
      ? normalizeBoolean(body.use_privileged_helper)
      : false;
    const queueIfOffline = normalizeBoolean(body.queue_if_offline);

    if (!isValidTargetFormat(target)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "target must be a device id like t1 or all",
        error_code: "INVALID_TARGET",
      });
      return;
    }

    if (queueIfOffline && target === "all") {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "queue_if_offline is supported only for a single target device",
        error_code: "INVALID_QUEUE_TARGET",
      });
      return;
    }

    if (!version) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "version is required",
        error_code: "INVALID_UPDATE_VERSION",
      });
      return;
    }

    if (version.length > MAX_UPDATE_VERSION_LEN || !isValidUpdateVersion(version)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "version must match [A-Za-z0-9._-] and be at most 64 chars",
        error_code: "INVALID_UPDATE_VERSION",
      });
      return;
    }

    if (!packageUrl) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: deps.config.enforceHttpsUpdateUrl
          ? "package_url must be a valid https URL"
          : "package_url must be a valid http/https URL",
        error_code: "INVALID_UPDATE_URL",
      });
      return;
    }

    if (providedSha256 && !isValidSha256(providedSha256)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "sha256 must be a 64-character lowercase or uppercase hex string",
        error_code: "INVALID_SHA256",
      });
      return;
    }

    if (
      hasOwnField(body, "signature") &&
      body.signature !== undefined &&
      body.signature !== null &&
      body.signature !== "" &&
      !providedSignature
    ) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "signature must be base64/base64url and at most 1024 chars",
        error_code: "INVALID_UPDATE_SIGNATURE",
      });
      return;
    }

    if (
      hasOwnField(body, "signature_key_id") &&
      body.signature_key_id !== undefined &&
      body.signature_key_id !== null &&
      body.signature_key_id !== "" &&
      !providedSignatureKeyId
    ) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "signature_key_id must match [a-z0-9._-] and be at most 40 chars",
        error_code: "INVALID_SIGNATURE_KEY_ID",
      });
      return;
    }

    const providedSizeBytes = normalizeOptionalSizeBytes(body.size_bytes, deps.config.updateMaxPackageBytes);
    if (body.size_bytes !== undefined && providedSizeBytes === null) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `size_bytes must be a positive integer <= ${deps.config.updateMaxPackageBytes}`,
        error_code: "INVALID_UPDATE_SIZE",
      });
      return;
    }

    let sha256 = providedSha256;
    let packageSizeBytes = providedSizeBytes;
    let resolvedPackageUrl = packageUrl;
    let hashSource: "provided" | "server_inspected" = providedSha256 ? "provided" : "server_inspected";

    if (!sha256) {
      try {
        const inspected = await inspectPackageFromUrl({
          url: packageUrl,
          timeoutMs: deps.config.updateMetadataTimeoutMs,
          maxBytes: deps.config.updateMaxPackageBytes,
          requireHttps: deps.config.enforceHttpsUpdateUrl,
        });

        sha256 = inspected.sha256;
        resolvedPackageUrl = inspected.finalUrl;
        if (!packageSizeBytes) {
          packageSizeBytes = inspected.sizeBytes;
        }
      } catch (error) {
        const failure = parsePackageInspectionFailure(error);
        reply.code(failure.httpStatus).send({
          ok: false,
          request_id: requestId,
          message: failure.message,
          error_code: failure.code,
        });
        return;
      }
    }

    const signatureCheck = verifyNormalizedUpdateSignature({
      config: deps.config,
      version,
      packageUrl: resolvedPackageUrl,
      sha256,
      sizeBytes: packageSizeBytes,
      signature: providedSignature,
      signatureKeyId: providedSignatureKeyId,
    });
    if (!signatureCheck.ok) {
      reply.code(signatureCheck.httpStatus).send({
        ok: false,
        request_id: requestId,
        message: signatureCheck.message,
        error_code: signatureCheck.code,
      });
      return;
    }

    const signature = signatureCheck.signature;
    const signatureKeyId = signatureCheck.signatureKeyId;
    const signatureVerified = signatureCheck.signatureVerified;

    log("info", "Update dispatch requested", {
      request_id: requestId,
      target,
      version,
      package_url: resolvedPackageUrl,
      hash_source: hashSource,
      package_size_bytes: packageSizeBytes ?? null,
      signature_verified: signatureVerified,
      signature_key_id: signatureKeyId,
      use_privileged_helper: usePrivilegedHelper,
    });

    const nextDesignationPrefix = inferDesignationPrefixFromPackageUrl(resolvedPackageUrl);

    const targetDeviceIds = target === "all" ? deps.registry.listOnlineDeviceIds() : [target];
    if (target === "all" && targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No online devices available",
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    const updateRawText = makeUpdateRawText(target, version, resolvedPackageUrl);
    const preparedDesignationChanges = new Map<string, PreparedDesignationChange>();
    const queuedOfflineDeviceIds = new Set<string>();
    const rollbackPreparedDesignationChanges = (): void => {
      for (const designationChange of preparedDesignationChanges.values()) {
        deps.db.deleteDevice(designationChange.nextDeviceId);
      }
    };

    for (const deviceId of targetDeviceIds) {
      const knownDevice = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
      if (!knownDevice) {
        rollbackPreparedDesignationChanges();
        reply.code(404).send({
          ok: false,
          request_id: requestId,
          message: `Unknown device: ${deviceId}`,
          error_code: "UNKNOWN_DEVICE",
        });
        return;
      }

      const connected = deps.registry.get(deviceId);
      const knownCapabilities = connected?.capabilities ?? (Array.isArray(knownDevice.capabilities) ? knownDevice.capabilities : []);
      if (usePrivilegedHelper && !knownCapabilities.includes("privileged_helper_split")) {
        rollbackPreparedDesignationChanges();
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support privileged helper split`,
          error_code: "PRIVILEGED_HELPER_NOT_SUPPORTED",
        });
        return;
      }

      if (!connected) {
        if (!queueIfOffline) {
          rollbackPreparedDesignationChanges();
          reply.code(409).send({
            ok: false,
            request_id: requestId,
            message: `${deviceId} is offline`,
            error_code: "DEVICE_OFFLINE",
          });
          return;
        }

        queuedOfflineDeviceIds.add(deviceId);
      } else {
        const hasUpdater = Array.isArray(connected.capabilities) && connected.capabilities.includes("updater");
        if (!hasUpdater) {
          rollbackPreparedDesignationChanges();
          reply.code(409).send({
            ok: false,
            request_id: requestId,
            message: `${deviceId} does not support remote updates yet. Update this device manually once with the latest agent.`,
            error_code: "UPDATER_NOT_SUPPORTED",
          });
          return;
        }

        const designationChange = prepareDesignationChange(deps.db, deviceId, nextDesignationPrefix);
        if (designationChange) {
          preparedDesignationChanges.set(deviceId, designationChange);
        }
      }

      const logId = makeLogId(requestId, deviceId);
      deps.db.insertCommandLog({
        id: logId,
        requestId,
        deviceId,
        source,
        rawText: updateRawText,
        parsedTarget: target,
        parsedType: "AGENT_UPDATE",
        argsJson: JSON.stringify(makeUpdateArgs({
          version,
          packageUrl: resolvedPackageUrl,
          sha256,
          sizeBytes: packageSizeBytes,
          signature,
          signatureKeyId,
          usePrivilegedHelper,
        })),
        status: "queued",
        resultMessage: null,
        errorCode: null,
      });

      if (!connected) {
        deps.db.upsertQueuedUpdate({
          id: logId,
          requestId,
          deviceId,
          source,
          rawText: updateRawText,
          parsedTarget: target,
          version,
          packageUrl: resolvedPackageUrl,
          sha256,
          sizeBytes: packageSizeBytes,
          signature,
          signatureKeyId,
          usePrivilegedHelper,
        });
      }

      publishCommandLogEvent(deps, {
        requestId,
        deviceId,
        source,
        rawText: updateRawText,
        parsedTarget: target,
        parsedType: "AGENT_UPDATE",
        status: "queued",
        message: null,
      });
    }

    const command = {
      type: "AGENT_UPDATE" as const,
      args: makeUpdateArgs({
        version,
        packageUrl: resolvedPackageUrl,
        sha256,
        sizeBytes: packageSizeBytes,
        signature,
        signatureKeyId,
        usePrivilegedHelper,
      }),
    };
    const immediateTargetDeviceIds = targetDeviceIds.filter((deviceId) => !queuedOfflineDeviceIds.has(deviceId));

    if (target !== "all") {
      const deviceId = targetDeviceIds[0];
      if (queuedOfflineDeviceIds.has(deviceId)) {
        reply.code(202).send({
          ok: true,
          request_id: requestId,
          target: deviceId,
          parsed_type: "AGENT_UPDATE",
          message: `${deviceId} is offline. Update queued and will run automatically on next reconnect.`,
          queued: true,
          version,
          package_url: resolvedPackageUrl,
          sha256,
          hash_source: hashSource,
          package_size_bytes: packageSizeBytes ?? null,
          signature,
          signature_key_id: signatureKeyId,
          signature_verified: signatureVerified,
          use_privileged_helper: usePrivilegedHelper,
        });
        return;
      }

      try {
        const designationChange = preparedDesignationChanges.get(deviceId);
        const commandWithDesignationChange = designationChange
          ? {
              ...command,
              args: {
                ...command.args,
                next_device_id: designationChange.nextDeviceId,
              },
            }
          : command;

        const result = await deps.router.dispatchToDevice({
          requestId,
          deviceId,
          command: commandWithDesignationChange,
          timeoutMs: deps.config.updateCommandTimeoutMs,
        });

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: result.ok ? "ok" : "failed",
          resultMessage: result.message,
          resultPayload: result.result_payload,
          errorCode: result.error_code,
        });

        publishCommandLogEvent(deps, {
          requestId,
          deviceId,
          source,
          rawText: updateRawText,
          parsedTarget: target,
          parsedType: "AGENT_UPDATE",
          status: result.ok ? "ok" : "failed",
          message: result.message,
          resultPayload: result.result_payload,
          errorCode: result.error_code,
        });

        if (designationChange) {
          if (result.ok) {
            deps.db.deleteDevice(designationChange.currentDeviceId);
          } else {
            deps.db.deleteDevice(designationChange.nextDeviceId);
          }
        }

        reply.send({
          ok: result.ok,
          request_id: requestId,
          target: deviceId,
          parsed_type: "AGENT_UPDATE",
          message: result.message,
          version,
          package_url: resolvedPackageUrl,
          sha256,
          hash_source: hashSource,
          package_size_bytes: packageSizeBytes ?? null,
          signature,
          signature_key_id: signatureKeyId,
          signature_verified: signatureVerified,
          use_privileged_helper: usePrivilegedHelper,
          designation_change: designationChange
            ? {
                previous_device_id: designationChange.currentDeviceId,
                next_device_id: designationChange.nextDeviceId,
              }
            : null,
          result_payload: result.result_payload ?? null,
          result,
        });
      } catch (error) {
        const dispatch = parseDispatchError(error);
        const designationChange = preparedDesignationChanges.get(deviceId);

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
          resultMessage: dispatch.message,
          errorCode: dispatch.code,
        });

        publishCommandLogEvent(deps, {
          requestId,
          deviceId,
          source,
          rawText: updateRawText,
          parsedTarget: target,
          parsedType: "AGENT_UPDATE",
          status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
          message: dispatch.message,
          errorCode: dispatch.code,
        });

        if (designationChange) {
          deps.db.deleteDevice(designationChange.nextDeviceId);
        }

        reply.code(dispatch.httpStatus).send({
          ok: false,
          request_id: requestId,
          target: deviceId,
          parsed_type: "AGENT_UPDATE",
          message: dispatch.message,
          error_code: dispatch.code,
          version,
          package_url: resolvedPackageUrl,
          sha256,
          hash_source: hashSource,
          package_size_bytes: packageSizeBytes ?? null,
          signature,
          signature_key_id: signatureKeyId,
          signature_verified: signatureVerified,
          use_privileged_helper: usePrivilegedHelper,
        });
      }

      return;
    }

    const results = await Promise.all(
      immediateTargetDeviceIds.map(async (deviceId) => {
        const designationChange = preparedDesignationChanges.get(deviceId);
        const commandForDevice = designationChange
          ? {
              ...command,
              args: {
                ...command.args,
                next_device_id: designationChange.nextDeviceId,
              },
            }
          : command;

        try {
          return await deps.router.dispatchToDevice({
            requestId,
            deviceId,
            command: commandForDevice,
            timeoutMs: deps.config.updateCommandTimeoutMs,
          });
        } catch (error) {
          const dispatch = parseDispatchError(error);
          return {
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: dispatch.message,
            error_code: dispatch.code,
            result_payload: undefined,
            completed_at: new Date().toISOString(),
          };
        }
      }),
    );

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId: result.device_id,
        source,
        rawText: updateRawText,
        parsedTarget: target,
        parsedType: "AGENT_UPDATE",
        status: result.ok ? "ok" : "failed",
        message: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      const designationChange = preparedDesignationChanges.get(result.device_id);
      if (designationChange) {
        if (result.ok) {
          deps.db.deleteDevice(designationChange.currentDeviceId);
        } else {
          deps.db.deleteDevice(designationChange.nextDeviceId);
        }
      }
    }

    const okCount = results.filter((result) => result.ok).length;
    const total = results.length;

    reply.send({
      ok: okCount === total,
      request_id: requestId,
      target: "all",
      parsed_type: "AGENT_UPDATE",
      message: `Update dispatched ${okCount}/${total}`,
      version,
      package_url: resolvedPackageUrl,
      sha256,
      hash_source: hashSource,
      package_size_bytes: packageSizeBytes ?? null,
      signature,
      signature_key_id: signatureKeyId,
      signature_verified: signatureVerified,
      use_privileged_helper: usePrivilegedHelper,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        result_payload: result.result_payload ?? null,
        error_code: result.error_code,
        designation_change: preparedDesignationChanges.has(result.device_id)
          ? {
              previous_device_id: preparedDesignationChanges.get(result.device_id)?.currentDeviceId,
              next_device_id: preparedDesignationChanges.get(result.device_id)?.nextDeviceId,
            }
          : null,
      })),
    });
  });

  server.post("/api/command", async (request, reply) => {
    const auth = authorize(request, reply, deps, ["commands:execute"]);
    if (!auth) {
      return;
    }

    const body = asCommandBody(request.body);
    const rawText = typeof body.text === "string" ? body.text : "";
    const text = rawText.trim();
    const requestId = normalizeRequestId(body.request_id);
    const source = normalizeSource(body.source);
    const asyncDispatch = normalizeBoolean(body.async);
    const timeoutOverrideMs = normalizeOptionalTimeoutMs(body.timeout_ms);

    if (text.length === 0) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: command text is empty",
        error_code: "EMPTY_COMMAND",
      });
      return;
    }

    if (text.length > MAX_TEXT_LEN) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `Command rejected: command text too long (max ${MAX_TEXT_LEN})`,
        error_code: "COMMAND_TOO_LONG",
      });
      return;
    }

    const rewrittenText = rewriteOpenAliasCommand(text, deps.db);
    const parsed = parseExternalCommand(rewrittenText);
    if ("code" in parsed) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `Command rejected: ${parsed.message}`,
        error_code: parsed.code,
      });
      return;
    }

    if (ADMIN_ONLY_COMMANDS.has(parsed.command.type) && !auth.scopes.has("admin:manage")) {
      forbidden(reply, "Admin commands require admin:manage scope");
      return;
    }

    if (parsed.target === "all" && !BULK_GROUP_ALLOWED_TYPES.has(parsed.command.type)) {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: `Command rejected: target all does not allow ${parsed.command.type.toLowerCase()}`,
        error_code: "GROUP_COMMAND_NOT_ALLOWED",
      });
      return;
    }

    if (asyncDispatch && parsed.target === "all") {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "async mode currently supports single-device dispatch only",
        error_code: "ASYNC_ALL_NOT_SUPPORTED",
      });
      return;
    }

    const targetDeviceIds =
      parsed.target === "all" ? deps.registry.listOnlineDeviceIds() : [parsed.target];

    if (targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No online devices available",
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    const requiredCapability = requiredCapabilityForCommand(parsed.command.type);
    const updatePolicy = deps.db.getUpdatePolicy();
    const dispatchableDeviceIds: string[] = [];
    const preflightResults: CommandDispatchResult[] = [];

    for (const deviceId of targetDeviceIds) {
      const knownDevice = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
      if (!knownDevice) {
        if (parsed.target === "all") {
          preflightResults.push({
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: `Unknown device: ${deviceId}`,
            error_code: "UNKNOWN_DEVICE",
            completed_at: new Date().toISOString(),
          });
          continue;
        }

        reply.code(404).send({
          ok: false,
          request_id: requestId,
          message: `Unknown device: ${deviceId}`,
          error_code: "UNKNOWN_DEVICE",
        });
        return;
      }

      const connected = deps.registry.get(deviceId);
      if (!connected) {
        if (parsed.target === "all") {
          preflightResults.push({
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: `${deviceId} is offline`,
            error_code: "DEVICE_OFFLINE",
            completed_at: new Date().toISOString(),
          });
          continue;
        }

        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} is offline`,
          error_code: "DEVICE_OFFLINE",
        });
        return;
      }

      const control = deps.db.getDeviceControl(deviceId);
      const policyFailure = preflightPolicyFailure({
        deviceId,
        commandType: parsed.command.type,
        quarantineEnabled: control.quarantine_enabled,
        killSwitchEnabled: control.kill_switch_enabled,
        policy: updatePolicy,
        version: connected.version,
      });
      if (policyFailure) {
        if (parsed.target === "all") {
          preflightResults.push({
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: policyFailure.message,
            error_code: policyFailure.code,
            completed_at: new Date().toISOString(),
          });
          continue;
        }

        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: policyFailure.message,
          error_code: policyFailure.code,
        });
        return;
      }

      const profile = resolveDeviceProfile(deviceId, connected.capabilities);
      if (!isCommandAllowedForProfile(profile, parsed.command.type)) {
        if (parsed.target === "all") {
          preflightResults.push({
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: `${deviceId} (${profileLabel(profile)} profile) blocks ${parsed.command.type.toLowerCase()}`,
            error_code: "COMMAND_NOT_ALLOWED_FOR_PROFILE",
            completed_at: new Date().toISOString(),
          });
          continue;
        }

        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} (${profileLabel(profile)} profile) blocks ${parsed.command.type.toLowerCase()}`,
          error_code: "COMMAND_NOT_ALLOWED_FOR_PROFILE",
        });
        return;
      }

      if (requiredCapability && !connected.capabilities.includes(requiredCapability)) {
        if (parsed.target === "all") {
          preflightResults.push({
            request_id: requestId,
            device_id: deviceId,
            ok: false,
            message: `${deviceId} does not support ${parsed.command.type.toLowerCase()} yet`,
            error_code: "COMMAND_NOT_SUPPORTED",
            completed_at: new Date().toISOString(),
          });
          continue;
        }

        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support ${parsed.command.type.toLowerCase()} yet`,
          error_code: "COMMAND_NOT_SUPPORTED",
        });
        return;
      }

      dispatchableDeviceIds.push(deviceId);
    }

    if (parsed.target === "all") {
      for (const skipped of preflightResults) {
        deps.db.insertCommandLog({
          id: makeLogId(requestId, skipped.device_id),
          requestId,
          deviceId: skipped.device_id,
          source,
          rawText: text,
          parsedTarget: parsed.target,
          parsedType: parsed.command.type,
          argsJson: JSON.stringify(parsed.command.args),
          status: "failed",
          resultMessage: skipped.message,
          errorCode: skipped.error_code ?? "ROUTING_ERROR",
        });
        deps.db.completeCommandLog({
          id: makeLogId(requestId, skipped.device_id),
          status: "failed",
          resultMessage: skipped.message,
          resultPayload: skipped.result_payload,
          errorCode: skipped.error_code,
        });
        publishCommandLogEvent(deps, {
          requestId,
          deviceId: skipped.device_id,
          source,
          rawText: text,
          parsedTarget: parsed.target,
          parsedType: parsed.command.type,
          status: "failed",
          message: skipped.message,
          resultPayload: skipped.result_payload,
          errorCode: skipped.error_code,
        });
      }

      if (dispatchableDeviceIds.length === 0) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          target: "all",
          parsed_type: parsed.command.type,
          message: "No eligible online devices available",
          results: preflightResults.map((result) => ({
            device_id: result.device_id,
            ok: result.ok,
            message: result.message,
            result_payload: result.result_payload ?? null,
            error_code: result.error_code,
          })),
          error_code: "NO_ONLINE_DEVICES",
        });
        return;
      }
    }

    for (const deviceId of dispatchableDeviceIds) {
      deps.db.insertCommandLog({
        id: makeLogId(requestId, deviceId),
        requestId,
        deviceId,
        source,
        rawText: text,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        argsJson: JSON.stringify(parsed.command.args),
        status: "queued",
        resultMessage: null,
        errorCode: null,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId,
        source,
        rawText: text,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        status: "queued",
        message: null,
      });
    }

    if (parsed.target !== "all") {
      const deviceId = dispatchableDeviceIds[0];
      const executeSingle = async (): Promise<
        { kind: "ok"; result: CommandDispatchResult } | { kind: "error"; dispatch: ReturnType<typeof parseDispatchError> }
      > => {
        try {
          const result = await deps.router.dispatchToDevice({
            requestId,
            deviceId,
            command: parsed.command,
            timeoutMs: timeoutOverrideMs ?? timeoutForCommand(deps.config, parsed.command.type),
          });

          deps.db.completeCommandLog({
            id: makeLogId(requestId, deviceId),
            status: result.ok ? "ok" : "failed",
            resultMessage: result.message,
            resultPayload: result.result_payload,
            errorCode: result.error_code,
          });

          publishCommandLogEvent(deps, {
            requestId,
            deviceId,
            source,
            rawText: text,
            parsedTarget: parsed.target,
            parsedType: parsed.command.type,
            status: result.ok ? "ok" : "failed",
            message: result.message,
            resultPayload: result.result_payload,
            errorCode: result.error_code,
          });

          return { kind: "ok", result };
        } catch (error) {
          const dispatch = parseDispatchError(error);

          deps.db.completeCommandLog({
            id: makeLogId(requestId, deviceId),
            status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
            resultMessage: dispatch.message,
            errorCode: dispatch.code,
          });

          publishCommandLogEvent(deps, {
            requestId,
            deviceId,
            source,
            rawText: text,
            parsedTarget: parsed.target,
            parsedType: parsed.command.type,
            status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
            message: dispatch.message,
            errorCode: dispatch.code,
          });

          return { kind: "error", dispatch };
        }
      };

      if (asyncDispatch) {
        void executeSingle();
        reply.code(202).send({
          ok: true,
          request_id: requestId,
          job_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: "Command accepted and running asynchronously",
          async: true,
        });
      } else {
        const dispatched = await executeSingle();
        if (dispatched.kind === "ok") {
          reply.send({
            ok: dispatched.result.ok,
            request_id: requestId,
            target: deviceId,
            parsed_type: parsed.command.type,
            message: dispatched.result.message,
            result_payload: dispatched.result.result_payload ?? null,
            result: dispatched.result,
          });
        } else {
          reply.code(dispatched.dispatch.httpStatus).send({
            ok: false,
            request_id: requestId,
            target: deviceId,
            parsed_type: parsed.command.type,
            message: dispatched.dispatch.message,
            error_code: dispatched.dispatch.code,
          });
        }
      }

      return;
    }

    const results = await deps.router.dispatchToMany({
      requestId,
      deviceIds: dispatchableDeviceIds,
      command: parsed.command,
      timeoutMs: timeoutOverrideMs ?? timeoutForCommand(deps.config, parsed.command.type),
    });

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId: result.device_id,
        source,
        rawText: text,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        status: result.ok ? "ok" : "failed",
        message: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });
    }

    const okCount = results.filter((result) => result.ok).length;
    const total = dispatchableDeviceIds.length;
    const combinedResults = [...results, ...preflightResults];

    reply.send({
      ok: okCount === total && preflightResults.length === 0,
      request_id: requestId,
      target: "all",
      parsed_type: parsed.command.type,
      message: `Completed ${okCount}/${total}${preflightResults.length > 0 ? ` (${preflightResults.length} skipped)` : ""}`,
      results: combinedResults.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        result_payload: result.result_payload ?? null,
        error_code: result.error_code,
      })),
    });
  });
}
