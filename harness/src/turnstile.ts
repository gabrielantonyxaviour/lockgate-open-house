let tail: Promise<void> = Promise.resolve();

/** One harness write at a time. A failed action does not block the next one. */
export function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(() => undefined, () => undefined);
  return run;
}
