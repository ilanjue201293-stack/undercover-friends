export function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function normalizeClue(input: string) {
  return input.trim().toLocaleLowerCase("fr-FR").replace(/\s+/g, " ");
}

export function normalizeGuess(input: string) {
  return input.trim().toLocaleLowerCase("fr-FR");
}

export function infiltratorCountFor(playerCount: number) {
  return Math.max(1, Math.floor((playerCount + 1) / 3));
}

export function makeId() {
  return crypto.randomUUID();
}

export function sanitizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 18);
}

export function sanitizeCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
