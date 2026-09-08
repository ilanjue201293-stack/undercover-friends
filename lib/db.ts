import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var undercoverDbPool: Pool | undefined;
}

function normalizedConnectionString(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function db() {
  const rawUrl =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!rawUrl) {
    throw new Error("Supabase n'est pas configuré. Connecte la base Supabase au projet Vercel.");
  }

  if (!globalThis.undercoverDbPool) {
    globalThis.undercoverDbPool = new Pool({
      connectionString: normalizedConnectionString(rawUrl),
      ssl: { rejectUnauthorized: false },
      // Vercel est serverless : garder plusieurs connexions ouvertes par instance
      // finit très vite par saturer la limite Supabase/Supavisor.
      max: 1,
      idleTimeoutMillis: 1_500,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    });
  }

  return globalThis.undercoverDbPool;
}
