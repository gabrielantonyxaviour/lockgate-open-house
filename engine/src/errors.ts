/** API failures serialize as `{ error, code? }`. Refusals are quotes, not errors. */
export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, error: string) {
    super(error);
    this.name = "EngineError";
    this.code = code;
  }

  toJSON(): { error: string; code: string } {
    return { error: this.message, code: this.code };
  }
}

export function asApiError(err: unknown): { error: string; code?: string } {
  if (err instanceof EngineError) return err.toJSON();
  if (err instanceof Error) return { error: err.message, code: "internal" };
  return { error: "unknown failure", code: "internal" };
}
