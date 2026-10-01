export type ApiError = { error: string; code?: string };

export function fail(error: string, code?: string): never {
  const payload: ApiError = code === undefined ? { error } : { error, code };
  const err = new Error(error) as Error & { payload: ApiError };
  err.payload = payload;
  throw err;
}
