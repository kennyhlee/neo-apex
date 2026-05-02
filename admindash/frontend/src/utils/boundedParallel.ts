// admindash/frontend/src/utils/boundedParallel.ts

export interface RunBoundedOptions<T, R> {
  concurrency: number;
  onProgress?: (item: T, result: R | Error, index: number) => void;
  signal?: AbortSignal;
}

export async function runBounded<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: RunBoundedOptions<T, R>,
): Promise<(R | Error)[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const results: (R | Error)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      if (opts.signal?.aborted) {
        const err = new Error('aborted');
        results[i] = err;
        opts.onProgress?.(items[i], err, i);
        continue;
      }
      try {
        const r = await fn(items[i], i);
        results[i] = r;
        opts.onProgress?.(items[i], r, i);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        results[i] = err;
        opts.onProgress?.(items[i], err, i);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
