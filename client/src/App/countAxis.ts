/** Whole-number ticks for values that count rows; none for other values. */
export function countAxis(whole: boolean, maximum: number) {
  if (!whole) return;
  const desired = Math.max(1, maximum / 4);
  const magnitude = 10 ** Math.floor(Math.log10(desired));
  const step =
    magnitude * ([1, 2, 5, 10].find((n) => n * magnitude >= desired) ?? 10);
  const intervals = Math.max(1, Math.ceil(maximum / step));
  return {
    maximum: intervals * step,
    ticks: Array.from({ length: intervals + 1 }, (_, i) => i * step),
  };
}
