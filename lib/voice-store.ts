import { Pool } from "pg";

export type VoiceParticipant = {
  playerId: string;
  playerName: string;
  muted: boolean;
  lastSeen: number;
};

export type VoiceSignal = {
  id: number;
  senderId: string;
  targetId: string;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
};

declare global {
  // eslint-disable-next-line no-var
  var undercoverVoicePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var undercoverVoiceSchemaPromise: Promise<void> | undefined;
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

  if (!rawUrl) throw new Error("Supabase n'est pas configuré.");

  if (!globalThis.undercoverVoicePool) {
    globalThis.undercoverVoicePool = new Pool({
      connectionString: normalizedConnectionString(rawUrl),
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.undercoverVoicePool;
}

async function ensureSchema() {
  if (!globalThis.undercoverVoiceSchemaPromise) {
    globalThis.undercoverVoiceSchemaPromise = (async () => {
      const db = pool();
      await db.query(`
        create table if not exists undercover_voice_participants (
          room_code text not null,
          player_id text not null,
          player_name text not null,
          muted boolean not null default false,
          last_seen timestamptz not null default now(),
          primary key (room_code, player_id)
        )
      `);
      await db.query(`
        create table if not exists undercover_voice_signals (
          id bigserial primary key,
          room_code text not null,
          sender_id text not null,
          target_id text not null,
          kind text not null,
          payload jsonb not null,
          created_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create index if not exists undercover_voice_signals_target_idx
        on undercover_voice_signals (room_code, target_id, id)
      `);
    })().catch((error) => {
      globalThis.undercoverVoiceSchemaPromise = undefined;
      throw error;
    });
  }
  await globalThis.undercoverVoiceSchemaPromise;
}

async function cleanup(roomCode: string) {
  await ensureSchema();
  const db = pool();
  await db.query(
    `delete from undercover_voice_participants
     where room_code = $1 and last_seen < now() - interval '12 seconds'`,
    [roomCode]
  );
  await db.query(
    `delete from undercover_voice_signals
     where room_code = $1 and created_at < now() - interval '3 minutes'`,
    [roomCode]
  );
}

export async function touchVoiceParticipant(roomCode: string, playerId: string, playerName: string, muted: boolean) {
  await ensureSchema();
  await pool().query(
    `insert into undercover_voice_participants (room_code, player_id, player_name, muted, last_seen)
     values ($1, $2, $3, $4, now())
     on conflict (room_code, player_id) do update
     set player_name = excluded.player_name,
         muted = excluded.muted,
         last_seen = now()`,
    [roomCode, playerId, playerName, muted]
  );
}

export async function leaveVoice(roomCode: string, playerId: string) {
  await ensureSchema();
  await pool().query(
    `delete from undercover_voice_participants where room_code = $1 and player_id = $2`,
    [roomCode, playerId]
  );
}

export async function listVoiceParticipants(roomCode: string): Promise<VoiceParticipant[]> {
  await cleanup(roomCode);
  const result = await pool().query<{
    player_id: string;
    player_name: string;
    muted: boolean;
    last_seen: string;
  }>(
    `select player_id, player_name, muted, last_seen
     from undercover_voice_participants
     where room_code = $1
     order by last_seen asc`,
    [roomCode]
  );

  return result.rows.map((row) => ({
    playerId: row.player_id,
    playerName: row.player_name,
    muted: row.muted,
    lastSeen: new Date(row.last_seen).getTime(),
  }));
}

export async function getVoiceCursor(roomCode: string, playerId: string) {
  await ensureSchema();
  const result = await pool().query<{ id: string }>(
    `select coalesce(max(id), 0)::text as id
     from undercover_voice_signals
     where room_code = $1 and target_id = $2`,
    [roomCode, playerId]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function addVoiceSignal(input: {
  roomCode: string;
  senderId: string;
  targetId: string;
  kind: VoiceSignal["kind"];
  payload: unknown;
}) {
  await ensureSchema();
  await pool().query(
    `insert into undercover_voice_signals (room_code, sender_id, target_id, kind, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [input.roomCode, input.senderId, input.targetId, input.kind, JSON.stringify(input.payload ?? null)]
  );
}

export async function getVoiceSignals(roomCode: string, playerId: string, afterId: number): Promise<VoiceSignal[]> {
  await cleanup(roomCode);
  const result = await pool().query<{
    id: string;
    sender_id: string;
    target_id: string;
    kind: VoiceSignal["kind"];
    payload: unknown;
  }>(
    `select id::text, sender_id, target_id, kind, payload
     from undercover_voice_signals
     where room_code = $1 and target_id = $2 and id > $3
     order by id asc
     limit 200`,
    [roomCode, playerId, afterId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    senderId: row.sender_id,
    targetId: row.target_id,
    kind: row.kind,
    payload: row.payload,
  }));
}
