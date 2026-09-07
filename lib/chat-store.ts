import { Pool } from "pg";

export type ChatMessage = {
  id: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  text: string;
  at: number;
};

declare global {
  // eslint-disable-next-line no-var
  var undercoverChatPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var undercoverChatSchemaPromise: Promise<void> | undefined;
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

function pool() {
  const rawUrl =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!rawUrl) {
    throw new Error("Supabase n'est pas configuré.");
  }

  if (!globalThis.undercoverChatPool) {
    globalThis.undercoverChatPool = new Pool({
      connectionString: normalizedConnectionString(rawUrl),
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return globalThis.undercoverChatPool;
}

async function ensureSchema() {
  if (!globalThis.undercoverChatSchemaPromise) {
    globalThis.undercoverChatSchemaPromise = (async () => {
      const db = pool();
      await db.query(`
        create table if not exists undercover_chat_messages (
          id text primary key,
          room_code text not null,
          player_id text not null,
          player_name text not null,
          message text not null,
          created_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create index if not exists undercover_chat_room_created_idx
        on undercover_chat_messages (room_code, created_at)
      `);
    })().catch((error) => {
      globalThis.undercoverChatSchemaPromise = undefined;
      throw error;
    });
  }

  await globalThis.undercoverChatSchemaPromise;
}

async function cleanupOldMessages() {
  await pool().query(`
    delete from undercover_chat_messages
    where created_at < now() - interval '12 hours'
  `);
}

export async function getRoomChat(roomCode: string): Promise<ChatMessage[]> {
  await ensureSchema();
  await cleanupOldMessages();

  const result = await pool().query<{
    id: string;
    room_code: string;
    player_id: string;
    player_name: string;
    message: string;
    at: string;
  }>(
    `select id, room_code, player_id, player_name, message,
            round(extract(epoch from created_at) * 1000)::bigint as at
     from undercover_chat_messages
     where room_code = $1
     order by created_at desc
     limit 80`,
    [roomCode]
  );

  return result.rows.reverse().map((row) => ({
    id: row.id,
    roomCode: row.room_code,
    playerId: row.player_id,
    playerName: row.player_name,
    text: row.message,
    at: Number(row.at),
  }));
}

export async function addRoomChatMessage(input: {
  id: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  text: string;
}) {
  await ensureSchema();
  await pool().query(
    `insert into undercover_chat_messages (id, room_code, player_id, player_name, message)
     values ($1, $2, $3, $4, $5)`,
    [input.id, input.roomCode, input.playerId, input.playerName, input.text]
  );
}

export async function clearRoomChat(roomCode: string) {
  await ensureSchema();
  await pool().query(`delete from undercover_chat_messages where room_code = $1`, [roomCode]);
}
