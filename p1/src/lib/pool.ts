// Minimal promise pool: run `jobs` with at most `concurrency` in flight.
// Failures never reject the pool — a failed job resolves to null so one bad
// image can't sink a 50-asset forge run. `onSettle` fires per completion in
// real time (completion order, not submission order) for live progress UIs.

export async function pool<T>(
  jobs: (() => Promise<T>)[],
  concurrency: number,
  onSettle?: (result: T | null, index: number) => void,
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(jobs.length).fill(null);
  let next = 0;

  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = await jobs[i]();
      } catch {
        results[i] = null;
      }
      onSettle?.(results[i], i);
    }
  };

  const width = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
