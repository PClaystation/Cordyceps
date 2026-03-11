import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, constantTimeEqual } from "../auth/auth";
import type { AppConfig } from "../config/env";
import type { Database } from "../db/database";
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

interface ApiDeps {
  config: AppConfig;
  db: Database;
  registry: DeviceRegistry;
  router: CommandRouter;
  eventHub: EventHub;
}

interface CommandRequestBody {
  request_id?: string;
  text?: string;
  source?: string;
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
  queue_if_offline?: unknown;
}

interface RenameDeviceBody {
  display_name?: string;
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
const MAX_CAPABILITIES = 50;
const MAX_GROUP_ID_LEN = 32;
const MAX_GROUP_DISPLAY_NAME_LEN = 80;
const MAX_GROUP_DESCRIPTION_LEN = 240;
const MAX_GROUP_MEMBER_COUNT = 100;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;
const MAX_SSE_TOKEN_LENGTH = 512;
const SSE_PING_INTERVAL_MS = 20_000;
const JSON_CONTENT_TYPE_RE = /^\s*application\/(?:[a-z0-9.+-]+\+)?json\s*(?:;|$)/i;
const GROUP_COMMAND_PATH_RE = /^\/api\/groups\/[^/]+\/command$/;
const GROUP_UPSERT_PATH_RE = /^\/api\/groups\/[^/]+$/;
const DEVICE_RENAME_PATH_RE = /^\/api\/devices\/[^/]+\/display-name$/;

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
]);

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
    (method === "POST" && (path === "/api/command" || path === "/api/update" || GROUP_COMMAND_PATH_RE.test(path)))
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

  if (DEVICE_RENAME_PATH_RE.test(path)) {
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

  if (constantTimeEqual(token, deps.config.phoneApiToken)) {
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

function makeUpdateRawText(target: string, version: string, packageUrl: string): string {
  return `${target} update ${version} ${packageUrl}`;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
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

    const rawToken = randomToken(32);
    const tokenHash = sha256Hex(rawToken);
    let created = null;
    let attempts = 0;

    while (!created && attempts < 5) {
      attempts += 1;
      const keyId = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      try {
        created = deps.db.createApiKey({
          keyId,
          name,
          tokenHash,
          scopes,
        });
      } catch {
        created = null;
      }
    }

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
      key: created,
      api_key: rawToken,
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

    const devices = deps.db.listDevices().map((device) => withProfile(device));

    return {
      ok: true,
      devices,
    };
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

    const targetDeviceIds = group.device_ids.filter((deviceId) => deps.registry.get(deviceId));
    if (targetDeviceIds.length === 0) {
      reply.code(409).send({
        ok: false,
        request_id: requestId,
        message: "No online devices in group",
        error_code: "NO_ONLINE_DEVICES",
      });
      return;
    }

    const requiredCapability = requiredCapabilityForCommand(parsedCommand.type);
    for (const deviceId of targetDeviceIds) {
      const connected = deps.registry.get(deviceId);
      if (!connected) {
        continue;
      }

      const profile = resolveDeviceProfile(deviceId, connected.capabilities);
      if (!isCommandAllowedForProfile(profile, parsedCommand.type)) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} (${profileLabel(profile)} profile) blocks ${parsedCommand.type.toLowerCase()}`,
          error_code: "COMMAND_NOT_ALLOWED_FOR_PROFILE",
        });
        return;
      }

      if (requiredCapability && !connected.capabilities.includes(requiredCapability)) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support ${parsedCommand.type.toLowerCase()} yet`,
          error_code: "COMMAND_NOT_SUPPORTED",
        });
        return;
      }

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

    const results = await deps.router.dispatchToMany({
      requestId,
      deviceIds: targetDeviceIds,
      command: parsedCommand,
    });

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
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
        errorCode: result.error_code,
      });
    }

    const okCount = results.filter((result) => result.ok).length;
    reply.send({
      ok: okCount === results.length,
      request_id: requestId,
      target: `group:${groupId}`,
      parsed_type: parsedCommand.type,
      message: `Completed ${okCount}/${results.length}`,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
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

    log("info", "Update dispatch requested", {
      request_id: requestId,
      target,
      version,
      package_url: resolvedPackageUrl,
      hash_source: hashSource,
      package_size_bytes: packageSizeBytes ?? null,
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
        argsJson: JSON.stringify({
          version,
          url: resolvedPackageUrl,
          sha256,
          ...(packageSizeBytes ? { size_bytes: packageSizeBytes } : {}),
        }),
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
      args: {
        version,
        url: resolvedPackageUrl,
        sha256,
        ...(packageSizeBytes ? { size_bytes: packageSizeBytes } : {}),
      },
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
          designation_change: designationChange
            ? {
                previous_device_id: designationChange.currentDeviceId,
                next_device_id: designationChange.nextDeviceId,
              }
            : null,
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
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
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

    const parsed = parseExternalCommand(text);
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

    if (parsed.target === "all" && parsed.command.type !== "PING") {
      reply.code(400).send({
        ok: false,
        request_id: requestId,
        message: "Command rejected: target all supports only ping in MVP",
        error_code: "GROUP_COMMAND_NOT_ALLOWED",
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

    for (const deviceId of targetDeviceIds) {
      const knownDevice = deps.db.getDevice(deviceId) ?? deps.registry.get(deviceId);
      if (!knownDevice) {
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
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} is offline`,
          error_code: "DEVICE_OFFLINE",
        });
        return;
      }

      const profile = resolveDeviceProfile(deviceId, connected.capabilities);
      if (!isCommandAllowedForProfile(profile, parsed.command.type)) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} (${profileLabel(profile)} profile) blocks ${parsed.command.type.toLowerCase()}`,
          error_code: "COMMAND_NOT_ALLOWED_FOR_PROFILE",
        });
        return;
      }

      if (requiredCapability && !connected.capabilities.includes(requiredCapability)) {
        reply.code(409).send({
          ok: false,
          request_id: requestId,
          message: `${deviceId} does not support ${parsed.command.type.toLowerCase()} yet`,
          error_code: "COMMAND_NOT_SUPPORTED",
        });
        return;
      }

      deps.db.insertCommandLog({
        id: makeLogId(requestId, deviceId),
        requestId,
        deviceId,
        source,
        rawText: parsed.rawText,
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
        rawText: parsed.rawText,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        status: "queued",
        message: null,
      });
    }

    if (parsed.target !== "all") {
      const deviceId = targetDeviceIds[0];
      try {
        const result = await deps.router.dispatchToDevice({
          requestId,
          deviceId,
          command: parsed.command,
        });

        deps.db.completeCommandLog({
          id: makeLogId(requestId, deviceId),
          status: result.ok ? "ok" : "failed",
          resultMessage: result.message,
          errorCode: result.error_code,
        });

        publishCommandLogEvent(deps, {
          requestId,
          deviceId,
          source,
          rawText: parsed.rawText,
          parsedTarget: parsed.target,
          parsedType: parsed.command.type,
          status: result.ok ? "ok" : "failed",
          message: result.message,
          errorCode: result.error_code,
        });

        reply.send({
          ok: result.ok,
          request_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: result.message,
          result,
        });
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
          rawText: parsed.rawText,
          parsedTarget: parsed.target,
          parsedType: parsed.command.type,
          status: dispatch.code === "TIMEOUT" ? "timeout" : "failed",
          message: dispatch.message,
          errorCode: dispatch.code,
        });

        reply.code(dispatch.httpStatus).send({
          ok: false,
          request_id: requestId,
          target: deviceId,
          parsed_type: parsed.command.type,
          message: dispatch.message,
          error_code: dispatch.code,
        });
      }

      return;
    }

    const results = await deps.router.dispatchToMany({
      requestId,
      deviceIds: targetDeviceIds,
      command: parsed.command,
    });

    for (const result of results) {
      deps.db.completeCommandLog({
        id: makeLogId(requestId, result.device_id),
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        errorCode: result.error_code,
      });

      publishCommandLogEvent(deps, {
        requestId,
        deviceId: result.device_id,
        source,
        rawText: parsed.rawText,
        parsedTarget: parsed.target,
        parsedType: parsed.command.type,
        status: result.ok ? "ok" : "failed",
        message: result.message,
        errorCode: result.error_code,
      });
    }

    const okCount = results.filter((result) => result.ok).length;
    const total = results.length;

    reply.send({
      ok: okCount === total,
      request_id: requestId,
      target: "all",
      parsed_type: parsed.command.type,
      message: `Completed ${okCount}/${total}`,
      results: results.map((result: CommandDispatchResult) => ({
        device_id: result.device_id,
        ok: result.ok,
        message: result.message,
        error_code: result.error_code,
      })),
    });
  });
}
