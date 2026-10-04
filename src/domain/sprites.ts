/** Frame indexes are zero-based internally; the UI displays one-based numbers. */
export function advanceFrame(
  current: number,
  steps: number,
  start: number,
  end: number,
  loop: boolean,
) {
  const next = current + steps;
  if (loop)
    return {
      frame: start + ((next - start) % (end - start + 1)),
      finished: false,
    };
  return { frame: Math.min(end, next), finished: next > end };
}
