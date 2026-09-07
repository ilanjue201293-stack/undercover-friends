import { Redis } from "@upstash/redis";
import type { Room } from "./types";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function client() {
  if (!url || !token) throw new Error("Redis n'est pas configuré. Ajoute UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN dans Vercel.");
  return new Redis({ url, token });
}

const roomKey = (code: string) => `undercover:room:${code}`;
const lockKey = (code: string) => `undercover:lock:${code}`;
const ROOM_TTL_SECONDS = 60 * 60 * 12;

export async function getRoom(code: string): Promise<Room | null> {
  const raw = await client().get<string | Room>(roomKey(code));
  if (!raw) return null;
  if (typeof raw === "string") return JSON.parse(raw) as Room;
  return raw as Room;
}

export async function saveRoom(room: Room) {
  room.updatedAt = Date.now();
  await client().set(roomKey(room.code), JSON.stringify(room), { ex: ROOM_TTL_SECONDS });
}

export async function createRoomIfFree(room: Room) {
  const result = await client().set(roomKey(room.code), JSON.stringify(room), { nx: true, ex: ROOM_TTL_SECONDS });
  return result === "OK";
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRoomLock<T>(code: string, fn: (room: Room) => Promise<T> | T): Promise<T> {
  const redis = client();
  const lock = `${Date.now()}:${crypto.randomUUID()}`;
  let acquired = false;
  for (let i = 0; i < 20; i++) {
    const ok = await redis.set(lockKey(code), lock, { nx: true, ex: 8 });
    if (ok === "OK") {
      acquired = true;
      break;
    }
    await sleep(35 + Math.floor(Math.random() * 35));
  }
  if (!acquired) throw new Error("La room est occupée, réessaie.");

  try {
    const room = await getRoom(code);
    if (!room) throw new Error("Room introuvable ou expirée.");
    const result = await fn(room);
    await saveRoom(room);
    return result;
  } finally {
    const current = await redis.get<string>(lockKey(code));
    if (current === lock) await redis.del(lockKey(code));
  }
}
