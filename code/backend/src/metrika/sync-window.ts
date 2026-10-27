/** Окно синка: последние N дней (включая сегодня). ANA-74: крон использует --days=3. */
export function windowFor(
  days: number,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (Math.max(1, days) - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}
