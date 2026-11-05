// Synthetic demo prices only; replace with explicit verified candle inputs for historical/live integrations.
export function createSyntheticCandles() {
  const start = Date.UTC(2026, 0, 1);
  const closes = Array.from({length: 90}, (_, i) => i < 30 ? 100 - i * 2 : i < 60 ? 40 + (i - 30) * 2 : 100 - (i - 60) * 2);
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return {openTimeMs: start + i * 60000, closeTimeMs: start + (i + 1) * 60000, open, close, low: Math.min(open,close) - 1, high: Math.max(open,close) + 1};
  });
}
