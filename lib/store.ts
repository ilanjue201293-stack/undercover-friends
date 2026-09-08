import type { PoolClient } from "pg";
import { db } from "./db";
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
  var undercoverSchemaPromise: Promise<void> | undefined;
}

async function ensureSchema() {
  if (!globalThis.undercoverSchemaPromise) {
    globalThis.undercoverSchemaPromise = (async () => {
      const database = db();
      await database.query(`
        create table if not exists undercover_rooms (
          code text primary key,
          state jsonb not null,
          updated_at timestamptz not null default now(),
          expires_at timestamptz not null
        )
      `);
      await database.query(`create index if not exists undercover_rooms_expires_at_idx on undercover_rooms (expires_at)`);
    })().catch((error) => { globalThis.undercoverSchemaPromise = undefined; throw error; });
  }
  await globalThis.undercoverSchemaPromise;
}

function expiryDate() { return new Date(Date.now() + ROOM_TTL_MS); }

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
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
  const database = db();
  const result = await database.query<{ state: Room }>(
    `select state from undercover_rooms where code=$1 and expires_at>now() limit 1`, [code]
  );
  if (result.rowCount === 0) {
    await database.query(`delete from undercover_rooms where code=$1 and expires_at<=now()`, [code]);
    return null;
  }
  return result.rows[0].state;
}

export async function listPublicRooms(): Promise<PublicRoomSummary[]> {
  await ensureSchema();
  const result = await db().query<{ state: Room }>(
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
  const database = db();
  room.updatedAt = Date.now();
  await database.query(
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
