import { NextRequest, NextResponse } from "next/server";
import type { UnoPlayer, UnoRoom } from "@/lib/uno-types";
import { addUnoMessage, callUno, chooseUnoColor, drawUno, playUnoCard, publicUnoState, startUnoGame, tickUno } from "@/lib/uno-game";
import { createUnoRoomIfFree, withUnoRoomLock } from "@/lib/uno-store";
import { makeId, sanitizeCode, sanitizeName } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(){let c="";for(let i=0;i<5;i++)c+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];return c}
function player(name:string,joinOrder:number):UnoPlayer{return{id:makeId(),token:`${makeId()}${makeId()}`,name,joinOrder,ready:false,connected:true,lastSeen:Date.now(),hand:[]}}
async function body(req:NextRequest){const text=await req.text();if(!text)return{};try{return JSON.parse(text)}catch{return{}}}
function session(b:any){const code=sanitizeCode(b.code),playerId=String(b.playerId??""),token=String(b.token??"");if(!code||!playerId||!token)throw new Error("Session UNO invalide.");return{code,playerId,token}}
function find(room:UnoRoom,id:string,token:string){const p=room.players.find(x=>x.id===id&&x.token===token);if(!p)throw new Error("Session UNO expirée ou invalide.");return p}
export async function POST(req:NextRequest){try{const b=await body(req),action=String(b.action??"");
 if(action==="create"){const name=sanitizeName(b.name);if(name.length<2)throw new Error("Choisis un pseudo d'au moins 2 caractères.");const p=player(name,1);let room:UnoRoom|null=null;for(let i=0;i<10;i++){const code=makeCode();const r:UnoRoom={code,createdAt:Date.now(),updatedAt:Date.now(),status:"lobby",hostId:p.id,nextJoinOrder:2,access:b.access==="private"?"private":b.access==="public"?"public":"code",joinRequests:[],players:[p],game:null,messages:[]};if(await createUnoRoomIfFree(r)){room=r;break}}if(!room)throw new Error("Impossible de créer la room UNO.");return NextResponse.json({ok:true,session:{code:room.code,playerId:p.id,token:p.token,name:p.name},state:publicUnoState(room,p)});}
 if(action==="join"){const code=sanitizeCode(b.code),name=sanitizeName(b.name);if(code.length!==5)throw new Error("Code UNO invalide.");if(name.length<2)throw new Error("Choisis un pseudo d'au moins 2 caractères.");return NextResponse.json(await withUnoRoomLock(code,room=>{tickUno(room);if(room.status!=="lobby")throw new Error("La partie UNO est déjà commencée.");if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw new Error("Ce pseudo est déjà pris.");if(room.players.length>=8)throw new Error("La room UNO est pleine.");const p=player(name,room.nextJoinOrder++);room.players.push(p);return{ok:true,session:{code,playerId:p.id,token:p.token,name:p.name},state:publicUnoState(room,p)}}));}
 const {code,playerId,token}=session(b);return NextResponse.json(await withUnoRoomLock(code,room=>{tickUno(room);const p=find(room,playerId,token);
  if(action==="state")return{ok:true,state:publicUnoState(room,p)};
  if(action==="leaveSignal"){p.connected=false;return{ok:true}};
  if(action==="ready"){if(room.status!=="lobby")throw new Error("Le lobby est terminé.");p.ready=Boolean(b.ready);}
  else if(action==="start"){if(p.id!==room.hostId)throw new Error("Seul l'hôte peut lancer UNO.");startUnoGame(room);}
  else if(action==="play")playUnoCard(room,p,String(b.cardId??""));
  else if(action==="draw")drawUno(room,p);
  else if(action==="uno")callUno(room,p);
  else if(action==="color")chooseUnoColor(room,p,b.color);
  else if(action==="chat")addUnoMessage(room,p,String(b.text??""));
  else throw new Error("Action UNO inconnue.");
  return{ok:true,state:publicUnoState(room,p)};
 }));
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Erreur UNO."},{status:400})}}
