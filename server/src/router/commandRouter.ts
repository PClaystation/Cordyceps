import type {
  AgentResultMessage,
  CommandDispatchResult,
  ServerToAgentCommandMessage,
  TypedCommand,
} from "../types/protocol";
import { DeviceRegistry } from "../realtime/deviceRegistry";

interface PendingResult {
  resolve: (result: CommandDispatchResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CommandRouter {
  private readonly pending = new Map<string, PendingResult>();

  public constructor(
    private readonly registry: DeviceRegistry,
    private readonly timeoutMs: number,
  ) {}

  public async dispatchToDevice(input: {
    requestId: string;
    deviceId: string;
    command: TypedCommand;
  }): Promise<CommandDispatchResult> {
    const connection = this.registry.get(input.deviceId);
    if (!connection) {
      throw new Error(`${input.deviceId} is offline`);
    }

    const key = this.pendingKey(input.deviceId, input.requestId);

    const message: ServerToAgentCommandMessage = {
      kind: "command",
      request_id: input.requestId,
      device_id: input.deviceId,
      type: input.command.type,
      args: input.command.args,
      issued_at: new Date().toISOString(),
    };

    const promise = new Promise<CommandDispatchResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`${input.deviceId} did not respond in time`));
      }, this.timeoutMs);

      this.pending.set(key, { resolve, reject, timer });
    });

    try {
      connection.socket.send(JSON.stringify(message));
    } catch (error) {
      const pending = this.pending.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
      }

      throw error instanceof Error ? error : new Error("Failed to send command");
    }

    return promise;
  }

  public async dispatchToMany(input: {
    requestId: string;
    deviceIds: string[];
    command: TypedCommand;
  }): Promise<CommandDispatchResult[]> {
    return Promise.all(
      input.deviceIds.map((deviceId) =>
        this.dispatchToDevice({
          requestId: input.requestId,
          deviceId,
          command: input.command,
        }).catch((error) => ({
          request_id: input.requestId,
          device_id: deviceId,
          ok: false,
          message: error instanceof Error ? error.message : "Unknown routing error",
          error_code: "ROUTING_ERROR",
          completed_at: new Date().toISOString(),
        })),
      ),
    );
  }

  public handleAgentResult(message: AgentResultMessage): boolean {
    const key = this.pendingKey(message.device_id, message.request_id);
    const pending = this.pending.get(key);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pending.delete(key);

    pending.resolve({
      request_id: message.request_id,
      device_id: message.device_id,
      ok: message.ok,
      message: message.message,
      error_code: message.error_code,
      completed_at: message.completed_at,
    });

    return true;
  }

  public clearDevicePending(deviceId: string): void {
    for (const [key, pending] of this.pending.entries()) {
      if (!key.startsWith(`${deviceId}:`)) {
        continue;
      }

      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.reject(new Error(`${deviceId} disconnected`));
    }
  }

  private pendingKey(deviceId: string, requestId: string): string {
    return `${deviceId}:${requestId}`;
  }
}
