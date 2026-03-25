import type { Database, QueuedUpdateRecord } from "../db/database";
import { EventHub } from "../events/eventHub";
import { DeviceRegistry } from "../realtime/deviceRegistry";
import { CommandRouter, DispatchError } from "../router/commandRouter";
import { log } from "../utils/logger";
import {
  inferDesignationPrefixFromPackageUrl,
  prepareDesignationChange,
  shouldPreserveCurrentDeviceForDesignationChange,
} from "./designation";

interface QueuedUpdateDispatcherDeps {
  db: Database;
  eventHub: EventHub;
  registry: DeviceRegistry;
  router: CommandRouter;
  updateCommandTimeoutMs: number;
}

interface DispatchFailure {
  code: string;
  message: string;
  status: "failed" | "timeout";
  retryLater: boolean;
}

function parseDispatchFailure(error: unknown): DispatchFailure {
  if (!(error instanceof DispatchError)) {
    return {
      code: "ROUTING_ERROR",
      message: error instanceof Error ? error.message : "Unknown routing error",
      status: "failed",
      retryLater: false,
    };
  }

  switch (error.code) {
    case "TIMEOUT":
      return {
        code: error.code,
        message: error.message,
        status: "timeout",
        retryLater: false,
      };
    case "DEVICE_OFFLINE":
    case "DEVICE_DISCONNECTED":
    case "SEND_FAILED":
    case "ROUTER_OVERLOADED":
      return {
        code: error.code,
        message: error.message,
        status: "failed",
        retryLater: true,
      };
    default:
      return {
        code: error.code,
        message: error.message,
        status: "failed",
        retryLater: false,
      };
  }
}

function publishCommandLogEvent(
  eventHub: EventHub,
  input: {
    requestId: string;
    deviceId: string;
    source: string;
    rawText: string;
    parsedTarget: string;
    status: string;
    message: string | null;
    resultPayload?: Record<string, unknown> | null;
    errorCode?: string | null;
  },
): void {
  eventHub.publish("command_log", {
    request_id: input.requestId,
    device_id: input.deviceId,
    source: input.source,
    raw_text: input.rawText,
    parsed_target: input.parsedTarget,
    parsed_type: "AGENT_UPDATE",
    status: input.status,
    message: input.message,
    result_payload: input.resultPayload ?? null,
    error_code: input.errorCode ?? null,
    ts: new Date().toISOString(),
  });
}

export class QueuedUpdateDispatcher {
  private readonly deviceQueues = new Map<string, Promise<void>>();

  public constructor(private readonly deps: QueuedUpdateDispatcherDeps) {}

  public kick(deviceId: string): Promise<void> {
    const tail = this.deviceQueues.get(deviceId) ?? Promise.resolve();
    const run = tail.then(
      () => this.processDeviceQueue(deviceId),
      () => this.processDeviceQueue(deviceId),
    );

    const newTail = run.then(
      () => undefined,
      () => undefined,
    );

    this.deviceQueues.set(deviceId, newTail);
    newTail.finally(() => {
      const current = this.deviceQueues.get(deviceId);
      if (current === newTail) {
        this.deviceQueues.delete(deviceId);
      }
    });

    return run;
  }

  private async processDeviceQueue(deviceId: string): Promise<void> {
    const connection = this.deps.registry.get(deviceId);
    if (!connection) {
      return;
    }

    const queuedUpdates = this.deps.db.listQueuedUpdatesForDevice(deviceId);
    if (queuedUpdates.length === 0) {
      return;
    }

    log("info", "Dispatching queued updates", {
      device_id: deviceId,
      queued_count: queuedUpdates.length,
    });

    for (const queuedUpdate of queuedUpdates) {
      const liveConnection = this.deps.registry.get(deviceId);
      if (!liveConnection) {
        return;
      }

      if (!liveConnection.capabilities.includes("updater")) {
        this.failQueuedUpdate(
          queuedUpdate,
          `${deviceId} does not support remote updates yet. Update this device manually once with the latest agent.`,
          "UPDATER_NOT_SUPPORTED",
        );
        continue;
      }

      if (queuedUpdate.use_privileged_helper && !liveConnection.capabilities.includes("privileged_helper_split")) {
        this.failQueuedUpdate(
          queuedUpdate,
          `${deviceId} does not support privileged helper split`,
          "PRIVILEGED_HELPER_NOT_SUPPORTED",
        );
        continue;
      }

      const completed = await this.dispatchQueuedUpdate(queuedUpdate);
      if (!completed) {
        return;
      }
    }
  }

  private async dispatchQueuedUpdate(queuedUpdate: QueuedUpdateRecord): Promise<boolean> {
    const nextDesignationPrefix = inferDesignationPrefixFromPackageUrl(queuedUpdate.package_url);
    const designationChange = prepareDesignationChange(this.deps.db, queuedUpdate.device_id, nextDesignationPrefix);

    const command = {
      type: "AGENT_UPDATE" as const,
      args: {
        version: queuedUpdate.version,
        url: queuedUpdate.package_url,
        sha256: queuedUpdate.sha256,
        ...(queuedUpdate.size_bytes ? { size_bytes: queuedUpdate.size_bytes } : {}),
        ...(queuedUpdate.signature ? { signature: queuedUpdate.signature } : {}),
        ...(queuedUpdate.signature_key_id ? { signature_key_id: queuedUpdate.signature_key_id } : {}),
        ...(queuedUpdate.use_privileged_helper ? { use_privileged_helper: true } : {}),
        ...(designationChange ? { next_device_id: designationChange.nextDeviceId } : {}),
      },
    };

    try {
      const result = await this.deps.router.dispatchToDevice({
        requestId: queuedUpdate.request_id,
        deviceId: queuedUpdate.device_id,
        command,
        timeoutMs: this.deps.updateCommandTimeoutMs,
      });

      this.deps.db.deleteQueuedUpdate(queuedUpdate.id);
      this.deps.db.completeCommandLog({
        id: queuedUpdate.id,
        status: result.ok ? "ok" : "failed",
        resultMessage: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      publishCommandLogEvent(this.deps.eventHub, {
        requestId: queuedUpdate.request_id,
        deviceId: queuedUpdate.device_id,
        source: queuedUpdate.source,
        rawText: queuedUpdate.raw_text,
        parsedTarget: queuedUpdate.parsed_target,
        status: result.ok ? "ok" : "failed",
        message: result.message,
        resultPayload: result.result_payload,
        errorCode: result.error_code,
      });

      if (designationChange) {
        if (result.ok) {
          if (
            !shouldPreserveCurrentDeviceForDesignationChange(
              designationChange.currentDeviceId,
              designationChange.nextDeviceId,
            )
          ) {
            this.deps.db.deleteDevice(designationChange.currentDeviceId);
          }
        } else {
          this.deps.db.deleteDevice(designationChange.nextDeviceId);
        }
      }

      return true;
    } catch (error) {
      const dispatch = parseDispatchFailure(error);
      if (designationChange) {
        this.deps.db.deleteDevice(designationChange.nextDeviceId);
      }

      if (dispatch.retryLater) {
        log("warn", "Queued update dispatch deferred", {
          device_id: queuedUpdate.device_id,
          request_id: queuedUpdate.request_id,
          error_code: dispatch.code,
          error_message: dispatch.message,
        });
        return false;
      }

      this.deps.db.deleteQueuedUpdate(queuedUpdate.id);
      this.deps.db.completeCommandLog({
        id: queuedUpdate.id,
        status: dispatch.status,
        resultMessage: dispatch.message,
        errorCode: dispatch.code,
      });

      publishCommandLogEvent(this.deps.eventHub, {
        requestId: queuedUpdate.request_id,
        deviceId: queuedUpdate.device_id,
        source: queuedUpdate.source,
        rawText: queuedUpdate.raw_text,
        parsedTarget: queuedUpdate.parsed_target,
        status: dispatch.status,
        message: dispatch.message,
        errorCode: dispatch.code,
      });

      return true;
    }
  }

  private failQueuedUpdate(queuedUpdate: QueuedUpdateRecord, message: string, errorCode: string): void {
    this.deps.db.deleteQueuedUpdate(queuedUpdate.id);
    this.deps.db.completeCommandLog({
      id: queuedUpdate.id,
      status: "failed",
      resultMessage: message,
      errorCode,
    });

    publishCommandLogEvent(this.deps.eventHub, {
      requestId: queuedUpdate.request_id,
      deviceId: queuedUpdate.device_id,
      source: queuedUpdate.source,
      rawText: queuedUpdate.raw_text,
      parsedTarget: queuedUpdate.parsed_target,
      status: "failed",
      message,
      errorCode,
    });
  }
}
