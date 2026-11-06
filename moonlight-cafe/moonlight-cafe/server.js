'use strict';
// Zero-dependency HTTP + WebSocket server. Requires Node.js 20+.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 24;
const rooms = new Map();
const SEATS = [
  [205, 352], [205, 455], [490, 364], [490, 464],
  [784, 353], [784, 459], [397, 522], [564, 522],
];
const COLORS = ['#a17ae6','#6caaa3','#e78a75','#e7ab56','#80a5dd','#d484ad','#98a96e','#ce8c64'];
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const acceptedFiles = new Set(['/','/index.html','/app.js','/styles.css','/favicon.svg']);
function sendFile(req, res) {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch { res.writeHead(400).end(); return; }
  if(url === '/health') {res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,rooms:rooms.size}));return;}
  if(!acceptedFiles.has(url)) {res.writeHead(404).end('Not found');return;}
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url.slice(1));
  fs.readFile(file,(err, data) => { if(err) {res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data);
  });
}
const server = http.createServer(sendFile);
function frame(op, payload=Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const size=body.length;
  let head;
  if(size<126){head=Buffer.from([0x80|op,size]);}
  else if(size<65536){head=Buffer.alloc(4);head[0]=0x80|op;head[1]=126;head.writeUInt16BE(size,2);}
  else {head=Buffer.alloc(10);head[0]=0x80|op;head[1]=127;head.writeBigUInt64BE(BigInt(size),2);}
  return Buffer.concat([head,body]);
}
function send(client, data) {if(client.alive && !client.socket.destroyed){const raw=JSON.stringify(data);if(client.socket.writableLength < 2_000_000)client.socket.write(frame(1,raw));}}
function broadcast(room, data, except) {if(!room)return;for(const p of room.members.values())if(p !== except)send(p,data);}
function cleanup(client) {
  if(!client.alive)return;
  client.alive=false;
  if(client.room){const room=client.room;room.members.delete(client.id);broadcast(room,{type:'left',id:client.id});if(room.members.size===0)rooms.delete(room.code);}
}
function handle(client, data) {
  let msg;try{msg=JSON.parse(data);}catch{return;}
  if(!msg || typeof msg !== 'object' || Array.isArray(msg))return;
  if(msg.type==='join'){
    if(client.room)return;
    const code=String(msg.room || '').trim().toUpperCase();
    const nickname=String(msg.name||'').trim().replace(/[\x00-\x1F\x7F]/g,'').slice(0,14);
    if(!/^[A-Z0-9]{4,10}$/.test(code) || nickname.length<1){send(client,{type:'error',message:'방 코드 또는 닉네임을 확인해 주세요.'});return;}
    let room=rooms.get(code);
    if(!room){room={code,members:new Map(),messages:[]};rooms.set(code,room);}
    if(room.members.size>=MAX_PLAYERS){send(client,{type:'error',message:'카페 정원이 가득 찼어요. (최대 24명)'});return;}
    client.id=crypto.randomUUID().slice(0,8);
    client.name=nickname;
    client.color=COLORS[Math.floor(Math.random()*COLORS.length)];
    client.x=500+Math.random()*70-35;
    client.y=575;
    client.seat=null;
    client.drink=null;
    client.room=room;
    client.lastMove=0;
    client.lastChat=0;
    room.members.set(client.id,client);
    const player=p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,seat:p.seat,drink:p.drink});
    send(client,{type:'welcome',id:client.id,room:code,players:[...room.members.values()].map(player),messages:room.messages});
    broadcast(room,{type:'joined',player:player(client)},client);
    return;
  }
  if(!client.room)return;
  const room=client.room;
  if(msg.type==='move'){
    const now=Date.now();if(now-client.lastMove<35)return;
    if(!Number.isFinite(msg.x)||!Number.isFinite(msg.y))return;
    const x=Math.min(936,Math.max(62,Number(msg.x)));
    const y=Math.min(579,Math.max(328,Number(msg.y)));
    // Prevent remote users from teleporting arbitrarily large distances.
    const dt=Math.min(1,Math.max(0.04,(now-(client.lastMove||now))/1000));
    const maxDelta=Math.max(17,dt*280);
    const dx=x-client.x,dy=y-client.y,dist=Math.hypot(dx,dy);
    const k=dist>maxDelta?maxDelta/dist:1;
    client.x+=dx*k;client.y+=dy*k;
    client.lastMove=now;
    if(client.seat!==null){client.seat=null;broadcast(room,{type:'seat',id:client.id,seat:null});}
    broadcast(room,{type:'move',id:client.id,x:client.x,y:client.y},client);return;
  }
  if(msg.type==='chat'){
    const now=Date.now();if(now-client.lastChat<650)return;
    const text=String(msg.text||'').trim().slice(0,180);
    if(!text)return;
    client.lastChat=now;
    const item={id:client.id,name:client.name,text,at:now};
    room.messages.push(item);if(room.messages.length>60)room.messages.shift();
    broadcast(room,{type:'chat',message:item});return;
  }
  if(msg.type==='seat'){
    if(msg.seat===null){client.seat=null;broadcast(room,{type:'seat',id:client.id,seat:null});return;}
    const index=Number(msg.seat);
    if(!Number.isInteger(index)||index<0||index>=SEATS.length)return;
    if([...room.members.values()].some(p=>p!==client && p.seat===index)){send(client,{type:'error',message:'그 자리에는 이미 친구가 앉아 있어요.'});return;}
    client.seat=index;[client.x,client.y]=SEATS[index];
    broadcast(room,{type:'seat',id:client.id,seat:index,x:client.x,y:client.y});return;
  }
  if(msg.type==='drink'){
    const drinks=['coffee','latte','tea','choco'];
    if(!drinks.includes(msg.drink))return;
    client.drink=msg.drink;
    broadcast(room,{type:'drink',id:client.id,drink:client.drink});return;
  }
  if(msg.type==='action'){
    if(!['wave','heart','cheers'].includes(msg.action))return;
    const now=Date.now();if(now-(client.lastAction||0)<900)return;
    client.lastAction=now;
    broadcast(room,{type:'action',id:client.id,action:msg.action});
  }
}
server.on('upgrade',(req,socket,head)=>{
  let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;}catch{socket.destroy();return;}
  if(url!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.headers['sec-websocket-key']){socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const client={socket,alive:true,room:null,id:null,buffer:Buffer.alloc(0),fragment:[],fragmentOpcode:null};
  function dataReceived(chunk){
    client.buffer=Buffer.concat([client.buffer,chunk]);
    if(client.buffer.length>128*1024){socket.destroy();return;}
    while(client.buffer.length>=2){
      const b=client.buffer;
      const fin=!!(b[0]&128),opcode=b[0]&15,masked=!!(b[1]&128);
      if(!masked){socket.destroy();return;}
      let size=b[1]&127,offset=2;
      if(size===126){if(b.length<4)return;size=b.readUInt16BE(2);offset=4;}
      else if(size===127){if(b.length<10)return;const n=b.readBigUInt64BE(2);if(n>65536n){socket.destroy();return;}size=Number(n);offset=10;}
      if(size>16384){socket.destroy();return;}
      if(b.length<offset+4+size)return;
      const mask=b.subarray(offset,offset+4);offset+=4;
      const payload=Buffer.from(b.subarray(offset,offset+size));
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      client.buffer=b.subarray(offset+size);
      if(opcode===8){socket.end(frame(8));return;}
      if(opcode===9){socket.write(frame(10,payload));continue;}
      if(opcode===10)continue;
      if(opcode===1 && fin){handle(client,payload.toString('utf8'));continue;}
      if(opcode===1 && !fin){client.fragment=[payload];client.fragmentOpcode=1;continue;}
      if(opcode===0 && client.fragmentOpcode===1){client.fragment.push(payload);if(fin){const body=Buffer.concat(client.fragment);client.fragment=[];client.fragmentOpcode=null;if(body.length>16384){socket.destroy();return;}handle(client,body.toString('utf8'));}continue;}
      socket.destroy();return;
    }
  }
  socket.on('data',dataReceived);
  socket.on('end',()=>cleanup(client));socket.on('close',()=>cleanup(client));socket.on('error',()=>cleanup(client));
  if(head.length)dataReceived(head);
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Moonlight Cafe listening on http://localhost:${PORT}`));
