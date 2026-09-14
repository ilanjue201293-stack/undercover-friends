import type { PoolClient } from "pg";
import { db } from "./db";
import type { UnoRoom } from "./uno-types";
const TTL_MS = 12 * 60 * 60 * 1000;
declare global { var unoSchemaPromise: Promise<void> | undefined; }
async function ensureSchema() {
  if (!globalThis.unoSchemaPromise) globalThis.unoSchemaPromise = (async () => {
    const database = db();
    await database.query(`create table if not exists uno_rooms (code text primary key, state jsonb not null, updated_at timestamptz not null default now(), expires_at timestamptz not null)`);
    await database.query(`create index if not exists uno_rooms_expires_at_idx on uno_rooms (expires_at)`);
  })().catch((error) => { globalThis.unoSchemaPromise = undefined; throw error; });
  await globalThis.unoSchemaPromise;
}
function expiryDate() { return new Date(Date.now() + TTL_MS); }
async function tx<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await db().connect();try{await client.query("begin");const r=await fn(client);await client.query("commit");return r}catch(e){try{await client.query("rollback")}catch{}throw e}finally{client.release()}}
export async function createUnoRoomIfFree(room:UnoRoom){await ensureSchema();return tx(async(client)=>{await client.query("select pg_advisory_xact_lock(hashtext($1))",[`uno:${room.code}`]);await client.query(`delete from uno_rooms where code=$1 and expires_at<=now()`,[room.code]);const r=await client.query(`insert into uno_rooms(code,state,updated_at,expires_at) values($1,$2::jsonb,now(),$3) on conflict(code) do nothing returning code`,[room.code,JSON.stringify(room),expiryDate()]);return r.rowCount===1;});}
export async function withUnoRoomLock<T>(code:string,fn:(room:UnoRoom)=>Promise<T>|T){await ensureSchema();return tx(async(client)=>{await client.query("select pg_advisory_xact_lock(hashtext($1))",[`uno:${code}`]);const r=await client.query<{state:UnoRoom}>(`select state from uno_rooms where code=$1 and expires_at>now() for update`,[code]);if(r.rowCount===0)throw new Error("Room UNO introuvable ou expirée.");const room=r.rows[0].state;const result=await fn(room);if(!room.players.some(p=>p.connected)){await client.query(`delete from uno_rooms where code=$1`,[code]);return result;}room.updatedAt=Date.now();await client.query(`update uno_rooms set state=$1::jsonb,updated_at=now(),expires_at=$2 where code=$3`,[JSON.stringify(room),expiryDate(),code]);return result;});}
