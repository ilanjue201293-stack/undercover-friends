import { Pool, type PoolClient } from "pg";
import type { Room } from "./types";

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

export type PublicRoomSummary = {
  code: string;
  hostName: string;
  players: number;
  connectedPlayers: number;
  mode: "impostor" | "mrwhite";
  updatedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var undercoverPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var undercoverSchemaPromise: Promise<void> | undefined;
}

function normalizedConnectionString(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch { return rawUrl; }
}

function pool() {
  const rawUrl = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!rawUrl) throw new Error("Supabase n'est pas configuré. Connecte ta base Supabase au projet Vercel pour obtenir POSTGRES_URL.");
  if (!globalThis.undercoverPool) {
    globalThis.undercoverPool = new Pool({
      connectionString: normalizedConnectionString(rawUrl),
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.undercoverPool;
}

async function ensureSchema() {
  if (!globalThis.undercoverSchemaPromise) {
    globalThis.undercoverSchemaPromise = (async () => {
      const db = pool();
      await db.query(`
        create table if not exists undercover_rooms (
          code text primary key,
          state jsonb not null,
          updated_at timestamptz not null default now(),
          expires_at timestamptz not null
        )
      `);
      await db.query(`create index if not exists undercover_rooms_expires_at_idx on undercover_rooms (expires_at)`);
    })().catch((error) => { globalThis.undercoverSchemaPromise = undefined; throw error; });
  }
  await globalThis.undercoverSchemaPromise;
}

function expiryDate() { return new Date(Date.now() + ROOM_TTL_MS); }

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function getRoom(code: string): Promise<Room | null> {
  await ensureSchema();
  const db = pool();
  const result = await db.query<{ state: Room }>(
    `select state from undercover_rooms where code=$1 and expires_at>now() limit 1`, [code]
  );
  if (result.rowCount === 0) {
    await db.query(`delete from undercover_rooms where code=$1 and expires_at<=now()`, [code]);
    return null;
  }
  return result.rows[0].state;
}

export async function listPublicRooms(): Promise<PublicRoomSummary[]> {
  await ensureSchema();
  const result = await pool().query<{ state: Room }>(
    `select state
     from undercover_rooms
     where expires_at>now()
       and coalesce(state->>'access','code')='public'
       and state->>'status'='lobby'
       and exists (
         select 1
         from jsonb_array_elements(coalesce(state->'players','[]'::jsonb)) as player
         where coalesce((player->>'connected')::boolean,false)=true
           and coalesce((player->>'lastSeen')::bigint,0) > (extract(epoch from now())*1000 - 20000)
       )
     order by updated_at desc
     limit 40`
  );
  return result.rows.map(({ state }) => {
    const players = Array.isArray(state.players) ? state.players : [];
    const host = players.find((player) => player.id === state.hostId);
    return {
      code: state.code,
      hostName: host?.name ?? "Hôte",
      players: players.length,
      connectedPlayers: players.filter((player) => player.connected).length,
      mode: state.settings?.mode === "mrwhite" ? "mrwhite" : "impostor",
      updatedAt: Number(state.updatedAt || 0),
    };
  });
}

export async function saveRoom(room: Room) {
  await ensureSchema();
  const db = pool();
  room.updatedAt = Date.now();
  await db.query(
    `insert into undercover_rooms (code,state,updated_at,expires_at)
     values ($1,$2::jsonb,now(),$3)
     on conflict (code) do update set state=excluded.state,updated_at=excluded.updated_at,expires_at=excluded.expires_at`,
    [room.code, JSON.stringify(room), expiryDate()]
  );
}

export async function createRoomIfFree(room: Room) {
  await ensureSchema();
  return inTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [room.code]);
    await client.query(`delete from undercover_rooms where code=$1 and expires_at<=now()`, [room.code]);
    room.updatedAt = Date.now();
    const inserted = await client.query(
      `insert into undercover_rooms (code,state,updated_at,expires_at)
       values ($1,$2::jsonb,now(),$3) on conflict (code) do nothing returning code`,
      [room.code, JSON.stringify(room), expiryDate()]
    );
    return inserted.rowCount === 1;
  });
}

export async function withRoomLock<T>(code: string, fn: (room: Room) => Promise<T> | T): Promise<T> {
  await ensureSchema();
  return inTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [code]);
    const result = await client.query<{ state: Room }>(
      `select state from undercover_rooms where code=$1 and expires_at>now() for update`, [code]
    );
    if (result.rowCount === 0) {
      await client.query(`delete from undercover_rooms where code=$1 and expires_at<=now()`, [code]);
      throw new Error("Room introuvable ou expirée.");
    }
    const room = result.rows[0].state;
    room.access ??= "code";
    room.joinRequests ??= [];
    room.settings.clueTimeSec = Number.isFinite(room.settings.clueTimeSec) ? room.settings.clueTimeSec : room.settings.actionTimeSec ?? 30;
    room.settings.voteTimeSec = Number.isFinite(room.settings.voteTimeSec) ? room.settings.voteTimeSec : room.settings.actionTimeSec ?? 30;
    const callbackResult = await fn(room);

    // Dès qu'il ne reste réellement plus personne dans une room, on supprime
    // la ligne entière. Elle disparaît donc du code, de la liste publique,
    // du chat et du vocal au lieu de survivre jusqu'au TTL de 12 h.
    if (room.players.length > 0 && !room.players.some((player) => player.connected)) {
      await client.query(`delete from undercover_rooms where code=$1`, [code]);
      return callbackResult;
    }

    room.updatedAt = Date.now();
    await client.query(
      `update undercover_rooms set state=$1::jsonb,updated_at=now(),expires_at=$2 where code=$3`,
      [JSON.stringify(room), expiryDate(), code]
    );
    return callbackResult;
  });
}
