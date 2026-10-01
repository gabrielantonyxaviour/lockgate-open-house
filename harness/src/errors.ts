export class HarnessError extends Error {
  readonly details: unknown;

  constructor(message: string, readonly code: string, details?: unknown) {
    super(message);
    this.name = "HarnessError";
    this.details = details;
  }

  toJSON(): { error: string; code: string; details?: unknown } {
    const body: { error: string; code: string; details?: unknown } = { error: this.message, code: this.code };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

export function asHarnessError(err: unknown): HarnessError {
  if (err instanceof HarnessError) return err;
  const message = err instanceof Error ? err.message : "unknown failure";
  return new HarnessError(message, "INTERNAL");
}
