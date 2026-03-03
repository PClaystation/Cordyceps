export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };

  const output = JSON.stringify(payload);
  if (level === "error") {
    console.error(output);
    return;
  }

  console.log(output);
}
