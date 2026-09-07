import postgres from "postgres";
import type { Room } from "./types";

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var undercoverSql: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var undercoverSchemaPromise: Promise<void> | undefined;
}

function client() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error(
      "Supabase n'est pas configuré. Connecte la base Supabase au projet Vercel pour obtenir POSTGRES_URL."
    );
  }

  if (!globalThis.undercoverSql) {
    globalThis.undercoverSql = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return globalThis.undercoverSql;
}

async function ensureSchema() {
  if (!globalThis.undercoverSchemaPromise) {
    globalThis.undercoverSchemaPromise = (async () => {
      const sql = client();
      await sql`
        create table if not exists undercover_rooms (
          code text primary key,
          state jsonb not null,
          updated_at timestamptz not null default now(),
          expires_at timestamptz not null
        )
      `;
      await sql`
        create index if not exists undercover_rooms_expires_at_idx
        on undercover_rooms (expires_at)
      `;
    })().catch((error) => {
      globalThis.undercoverSchemaPromise = undefined;
      throw error;
    });
  }

  await globalThis.undercoverSchemaPromise;
}

function expiryDate() {
  return new Date(Date.now() + ROOM_TTL_MS);
}

export async function getRoom(code: string): Promise<Room | null> {
  await ensureSchema();
  const sql = client();

  const rows = await sql<{ state: Room }[]>`
    select state
    from undercover_rooms
    where code = ${code}
      and expires_at > now()
    limit 1
  `;

  if (rows.length === 0) {
    await sql`
      delete from undercover_rooms
      where code = ${code}
        and expires_at <= now()
    `;
    return null;
  }

  return rows[0].state as Room;
}

export async function saveRoom(room: Room) {
  await ensureSchema();
  const sql = client();
  room.updatedAt = Date.now();

  await sql`
    insert into undercover_rooms (code, state, updated_at, expires_at)
    values (${room.code}, ${sql.json(room)}, now(), ${expiryDate()})
    on conflict (code) do update
    set state = excluded.state,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
  `;
}

export async function createRoomIfFree(room: Room) {
  await ensureSchema();
  const sql = client();

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${room.code}))`;

    await tx`
      delete from undercover_rooms
      where code = ${room.code}
        and expires_at <= now()
    `;

    room.updatedAt = Date.now();
    const inserted = await tx`
      insert into undercover_rooms (code, state, updated_at, expires_at)
      values (${room.code}, ${tx.json(room)}, now(), ${expiryDate()})
      on conflict (code) do nothing
      returning code
    `;

    return inserted.length === 1;
  });
}

export async function withRoomLock<T>(
  code: string,
  fn: (room: Room) => Promise<T> | T
): Promise<T> {
  await ensureSchema();
  const sql = client();

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${code}))`;

    const rows = await tx<{ state: Room }[]>`
      select state
      from undercover_rooms
      where code = ${code}
        and expires_at > now()
      for update
    `;

    if (rows.length === 0) {
      await tx`
        delete from undercover_rooms
        where code = ${code}
          and expires_at <= now()
      `;
      throw new Error("Room introuvable ou expirée.");
    }

    const room = rows[0].state as Room;
    const result = await fn(room);
    room.updatedAt = Date.now();

    await tx`
      update undercover_rooms
      set state = ${tx.json(room)},
          updated_at = now(),
          expires_at = ${expiryDate()}
      where code = ${code}
    `;

    return result;
  });
}
