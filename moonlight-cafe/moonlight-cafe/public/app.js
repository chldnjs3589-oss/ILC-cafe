'use strict';
(() => {
  const W=1000,H=625;
  const $=id=>document.getElementById(id);
  const canvas=$('worldCanvas'), ctx=canvas.getContext('2d');
  const entry=$('entryDialog'), menu=$('drinkDialog');
  const SEATS=[[205,352],[205,455],[490,364],[490,464],[784,353],[784,459],[397,522],[564,522]];
  const DRINKS={coffee:'☕',latte:'🥛',tea:'🍵',choco:'🍫'};
  let me={id:'preview',name:'손님',color:'#e4aa79',x:505,y:566,rx:505,ry:566,seat:null,drink:null,action:null,actionAt:0,speech:'',speechAt:0};
  let players=new Map([[me.id,me]]),room='',ws=null,connected=false,entered=false,online=false,lastSend=0,lastFrame=performance.now(),target=null,toastTimer=0;
  let viewport={scale:1,ox:0,oy:0,dpr:1,w:1000,h:625};
  let audioContext=null,audioNodes=[],ambientTimer=null,ambientOn=false;
  let keydown=new Set();
  let roomFromUrl=new URLSearchParams(location.search).get('room')||'';
  roomFromUrl=/^[a-z0-9]{4,10}$/i.test(roomFromUrl)?roomFromUrl.toUpperCase():'';
  $('roomInput').value=roomFromUrl;
  const savedName=(()=>{try{return localStorage.getItem('moonlight-name')||''}catch{return''}})();
  $('nameInput').value=savedName;
  setTimeout(()=>{if(typeof entry.showModal==='function')entry.showModal();else entry.setAttribute('open','');},70);

  function randCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let v='';for(let i=0;i<6;i++)v+=chars[Math.floor(Math.random()*chars.length)];return v;}
  function toast(text){const el=$('toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3200);}
  function send(data){if(ws?.readyState===WebSocket.OPEN&&connected)ws.send(JSON.stringify(data));}
  function status(text){$('statusLabel').textContent=text;}
  function player(p){return {...p,rx:p.x,ry:p.y,action:null,actionAt:0,speech:'',speechAt:0};}
  function updateCounts(){ $('onlineCount').textContent=online?players.size:0;$('guestCount').textContent=online?players.size:0;
    const list=$('guestList');list.replaceChildren();
    if(!online){const empty=document.createElement('div');empty.className='empty-guests';empty.textContent=entered?'오프라인 미리보기 · 서버 연결이 필요해요.':'입장하면 친구들이 여기에 표시돼요.';list.append(empty);return;}
    [...players.values()].forEach(p=>{const chip=document.createElement('div');chip.className='guest-chip';const dot=document.createElement('span');dot.className='guest-dot';dot.style.background=p.color;dot.textContent=Array.from(p.name)[0]||'☕';const name=document.createElement('span');name.textContent=p.name;chip.append(dot,name);if(p.id===me.id){const you=document.createElement('small');you.textContent='나';chip.append(you);}list.append(chip);});
  }
  function addChat(m){const item=document.createElement('div');item.className='chat-message'+(m.id===me.id?' mine':'');const avatar=document.createElement('span');avatar.className='chat-avatar';avatar.style.background=players.get(m.id)?.color||'#b69ac0';avatar.textContent=Array.from(m.name||'손님')[0]||'☕';const body=document.createElement('div');body.className='chat-body';const meta=document.createElement('div');meta.className='chat-meta';const nick=document.createElement('b');nick.textContent=m.name;const time=document.createElement('small');time.textContent=new Date(m.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});const txt=document.createElement('p');txt.textContent=m.text;meta.append(nick,time);body.append(meta,txt);item.append(avatar,body);$('chatList').append(item);while($('chatList').children.length>65)$('chatList').children[0].remove();$('chatList').scrollTop=$('chatList').scrollHeight;const p=players.get(m.id);if(p){p.speech=m.text;p.speechAt=performance.now();}}
  function connect(){online=false;connected=false;status('연결 중...');updateCounts();if(location.protocol==='file:'){preview('파일 미리보기 · 서버 실행 시 실시간 연결');return;}
    try{ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);}catch{preview('연결 실패 · 서버 상태 확인');return;}
    ws.addEventListener('open',()=>{ws.send(JSON.stringify({type:'join',name:me.name,room}));});
    ws.addEventListener('message',evt=>{let m;try{m=JSON.parse(evt.data);}catch{return;}
      if(m.type==='welcome'){
        connected=true;online=true;me.id=m.id;room=m.room;players=new Map(m.players.map(p=>[p.id,player(p)]));me=players.get(m.id);$('roomId').textContent=room;status('실시간 연결됨');$('worldSubtitle').textContent='친구들이 기다리는 곳';$('chatList').replaceChildren();if(!m.messages.length){const welcome=document.createElement('div');welcome.className='welcome-chat';welcome.innerHTML='<span>✦</span><b>우리들의 작은 카페에 오신 걸 환영해요!</b><p>방 링크를 공유하고 함께 이야기를 나눠요.</p>';$('chatList').append(welcome);}m.messages.forEach(addChat);updateCounts();toast('달빛다방에 입장했어요 ☕');
      } else if(m.type==='joined'){players.set(m.player.id,player(m.player));updateCounts();toast(`${m.player.name}님이 입장했어요 👋`);}
      else if(m.type==='left'){const p=players.get(m.id);if(p)toast(`${p.name}님이 나갔어요.`);players.delete(m.id);updateCounts();}
      else if(m.type==='move'){const p=players.get(m.id);if(p){p.x=m.x;p.y=m.y;p.seat=null;}}
      else if(m.type==='chat')addChat(m.message);
      else if(m.type==='seat'){const p=players.get(m.id);if(p){p.seat=m.seat;if(m.seat!==null){p.x=m.x;p.y=m.y;if(p.id===me.id){p.rx=m.x;p.ry=m.y;}}}}
      else if(m.type==='drink'){const p=players.get(m.id);if(p)p.drink=m.drink;}
      else if(m.type==='action'){const p=players.get(m.id);if(p){p.action=m.action;p.actionAt=performance.now();}}
      else if(m.type==='error')toast(m.message);
    });
    ws.addEventListener('close',()=>{if(!entered)return;const was=connected;connected=false;online=false;status('연결 끊김');if(was)toast('연결이 끊겼어요. 페이지를 새로고침해 주세요.');else preview('서버 연결 실패 · 미리보기');updateCounts();});
    ws.addEventListener('error',()=>{if(!connected)status('연결 실패');});
  }
  function preview(message){online=false;connected=false;status('오프라인 미리보기');$('worldSubtitle').textContent='로컬 미리보기';players=new Map([[me.id,me]]);updateCounts();toast(message);}
  $('entryForm').addEventListener('submit',ev=>{ev.preventDefault();
    const name=$('nameInput').value.trim().slice(0,14),code=$('roomInput').value.trim().toUpperCase()||randCode();
    if(!name){toast('닉네임을 입력해 주세요.');return;}
    if(!/^[A-Z0-9]{4,10}$/.test(code)){toast('방 코드는 영문/숫자 4~10자여야 해요.');return;}
    room=code;me.name=name;entered=true;me.x=505;me.y=566;me.rx=505;me.ry=566;me.seat=null;me.drink=null;
    try{localStorage.setItem('moonlight-name',name);}catch{}
    const url=new URL(location.href);url.searchParams.set('room',room);history.replaceState({},'',url);
    $('roomId').textContent=room;entry.close();connect();
  });
  $('shareBtn').addEventListener('click',async()=>{if(!entered){toast('먼저 카페에 입장해 주세요.');return;}
    const invite=location.href;
    if(location.protocol==='file:'||['localhost','127.0.0.1'].includes(location.hostname)){try{await navigator.clipboard.writeText(room);toast(`방 코드 ${room} 복사됨 · 배포하면 링크로 초대 가능`);}catch{toast(`방 코드: ${room} · 배포 후 초대하세요`);}return;}
    try{await navigator.clipboard.writeText(invite);toast('초대 링크를 복사했어요! 친구에게 보내세요 📋');}
    catch{const box=document.createElement('textarea');box.value=invite;document.body.append(box);box.select();try{document.execCommand('copy');toast('초대 링크 복사 완료!');}catch{toast('주소창의 링크를 친구에게 보내세요.');}box.remove();}
  });
  $('chatForm').addEventListener('submit',ev=>{ev.preventDefault();const input=$('chatInput'),txt=input.value.trim();if(!txt)return;if(!online){toast('채팅은 서버에 연결된 뒤 사용할 수 있어요.');return;}send({type:'chat',text:txt});input.value='';});
  $('drinkBtn').addEventListener('click',()=>{if(!entered)return toast('카페에 먼저 입장해 주세요.');menu.showModal();});
  $('closeMenu').addEventListener('click',()=>menu.close());
  document.querySelectorAll('[data-drink]').forEach(b=>b.addEventListener('click',()=>{const drink=b.dataset.drink;me.drink=drink;send({type:'drink',drink});menu.close();toast(`${DRINKS[drink]} 음료를 받았어요!`);}));
  function useAction(action){if(!entered)return toast('카페에 먼저 입장해 주세요.');me.action=action;me.actionAt=performance.now();send({type:'action',action});}
  document.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>useAction(b.dataset.act)));
  $('sitBtn').addEventListener('click',()=>{if(!entered)return toast('카페에 먼저 입장해 주세요.');if(me.seat!==null){me.seat=null;send({type:'seat',seat:null});toast('자리에서 일어났어요.');return;}
    const free=SEATS.map(([x,y],index)=>({index,x,y,dist:Math.hypot(me.x-x,me.y-y)})).filter(s=>![...players.values()].some(p=>p.id!==me.id&&p.seat===s.index)).sort((a,b)=>a.dist-b.dist);
    if(!free.length)return toast('남아 있는 자리가 없어요.');const s=free[0];me.seat=s.index;me.x=me.rx=s.x;me.y=me.ry=s.y;target=null;keydown.clear();send({type:'seat',seat:s.index});toast('자리에 앉았어요 🪑');
  });
  function clearSit(){if(me.seat!==null){me.seat=null;send({type:'seat',seat:null});}}
  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(document.activeElement?.matches('input,textarea')||entry.open||menu.open)return;if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)){e.preventDefault();keydown.add(k);target=null;}});
  window.addEventListener('keyup',e=>keydown.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keydown.clear());
  document.querySelectorAll('[data-dir]').forEach(b=>{const dir=b.dataset.dir;const k={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright'}[dir];b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keydown.add(k);target=null;});for(const evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>keydown.delete(k));});
  canvas.addEventListener('pointerdown',e=>{if(!entered||entry.open||menu.open)return;const r=canvas.getBoundingClientRect();const sx=e.clientX-r.left,sy=e.clientY-r.top;const x=(sx-viewport.ox)/viewport.scale,y=(sy-viewport.oy)/viewport.scale;target={x:Math.min(935,Math.max(64,x)),y:Math.min(576,Math.max(329,y))};clearSit();});

  // Original procedural cafe ambience; no audio tracks or third-party media.
  $('soundBtn').addEventListener('click',async()=>{try{if(!audioContext){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return toast('이 브라우저는 오디오를 지원하지 않아요.');audioContext=new AC();
      const chordSets=[[174.61,220,261.63,329.63],[146.83,174.61,220,293.66],[130.81,164.81,196,261.63],[155.56,196,233.08,311.13]];
      const master=audioContext.createGain();master.gain.value=.055;master.connect(audioContext.destination);
      const gains=[];for(let i=0;i<4;i++){const osc=audioContext.createOscillator();osc.type='sine';osc.frequency.value=chordSets[0][i];const gain=audioContext.createGain();gain.gain.value=.11;osc.connect(gain);gain.connect(master);osc.start();audioNodes.push(osc);gains.push(gain);}
      let n=0;ambientTimer=setInterval(()=>{if(!ambientOn||audioContext.state!=='running')return;n=(n+1)%chordSets.length;audioNodes.forEach((osc,i)=>osc.frequency.setTargetAtTime(chordSets[n][i],audioContext.currentTime,.8));},9000);
      // Faint filtered noise supplies a cozy, rain-like texture.
      const length=audioContext.sampleRate*2;const buffer=audioContext.createBuffer(1,length,audioContext.sampleRate);const data=buffer.getChannelData(0);let prev=0;for(let i=0;i<length;i++){prev=(prev+(.055*(Math.random()*2-1)))/1.055;data[i]=prev*1.8;}const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=600;const noiseGain=audioContext.createGain();noiseGain.gain.value=.012;source.connect(filter);filter.connect(noiseGain);noiseGain.connect(audioContext.destination);source.start();
    }
    ambientOn=!ambientOn;if(ambientOn)await audioContext.resume();else await audioContext.suspend();$('soundBtn').querySelector('span').textContent=ambientOn?'분위기 소리 끄기':'분위기 소리 켜기';toast(ambientOn?'잔잔한 카페 소리를 켰어요 ♫':'분위기 소리를 껐어요');}catch{toast('오디오를 실행하지 못했어요.');}});

  function rr(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function line(x1,y1,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function ellipse(x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
  function text(t,x,y,size,color,align='center',weight=700){ctx.fillStyle=color;ctx.font=`${weight} ${size}px 'Noto Sans KR',system-ui,sans-serif`;ctx.textAlign=align;ctx.fillText(t,x,y);}
  function drawWindow(x,y,w=226,h=155){
    rr(x-7,y-7,w+14,h+14,12,'#765364');rr(x,y,w,h,7,'#252f4f');
    const grad=ctx.createLinearGradient(0,y,0,y+h);grad.addColorStop(0,'#3b3e69');grad.addColorStop(.7,'#706188');grad.addColorStop(1,'#ad7c8a');rr(x+5,y+5,w-10,h-10,3,grad);
    ellipse(x+w*.69,y+40,17,17,'#ffe6bd');ellipse(x+w*.72,y+36,17,17,'#61618a');
    for(let i=0;i<18;i++){const sx=x+12+(i*73%Math.max(20,w-24)),sy=y+12+(i*37%Math.max(30,h-75));ellipse(sx,sy,1.4,1.4,'#f9e6be');}
    for(let i=0;i<10;i++){const bx=x+i*26,by=y+h-42-(i*29%38);rr(bx,by,17,y+h-by-5,0,i%2?'#413955':'#51415c');if(i%2===0)for(let j=0;j<3;j++)rr(bx+4,by+7+j*12,3,5,1,'#e5b58b');}
    rr(x+w/2-3,y,6,h,0,'#91677a');rr(x,y+h*.52,w,6,0,'#91677a');
    rr(x-13,y-8,20,h+22,5,'#765669');rr(x+w-7,y-8,20,h+22,5,'#765669');
    rr(x-10,y+h+3,w+20,11,4,'#aa7c70');
  }
  function drawPlant(x,y,s=1){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ellipse(0,12,30,9,'#3028334d');rr(-15,-26,30,35,4,'#ca947a');rr(-19,-27,38,8,3,'#edb99b');for(let i=0;i<7;i++){const a=i*2.4;ctx.save();ctx.rotate(a*.18-.4);ellipse((i-3)*6,-43-(i*17%34),11,24,i%2?'#427c65':'#5d9a77');ctx.restore();}line(0,-25,0,-84,'#37664e',3);ctx.restore();}
  function drawTable(x,y,variant=0){
    ellipse(x,y+23,91,29,'#573e4b44');
    const chair=(cx,cy)=>{ellipse(cx,cy+10,23,13,'#513a4740');rr(cx-22,cy-16,44,28,12,'#7d5964');rr(cx-18,cy-12,36,20,8,'#ba8a7c');};
    chair(x,y-62);chair(x,y+66);
    rr(x-8,y-6,16,35,3,'#80545b');ellipse(x,y+14,70,17,'#895d5c');ellipse(x,y,84,37,'#a57765');ellipse(x,y-6,80,32,'#d4a27c');ellipse(x,y-10,73,27,'#dcb08c');
    ellipse(x-25,y-13,14,6,'#e9d4b2');ellipse(x-25,y-14,11,5,'#765053');ellipse(x+26,y+6,12,5,'#f7e4c8');text(variant===1?'✦':'❀',x+27,y+11,15,'#a77a77');
  }
  function drawCafe(time){
    const wall=ctx.createLinearGradient(0,0,0,290);wall.addColorStop(0,'#6a4d68');wall.addColorStop(1,'#99746f');ctx.fillStyle=wall;ctx.fillRect(0,0,W,280);
    for(let x=0;x<W;x+=52)line(x,4,x,254,'#ffffff08',2);
    rr(0,0,1000,24,0,'#473447');rr(0,246,1000,25,0,'#6d4b54');rr(0,260,1000,13,0,'#d4a17c');
    drawWindow(66,58,230,155);drawWindow(344,58,212,155);
    rr(611,35,331,174,12,'#503a4a');rr(626,49,301,144,9,'#e9c6a0');rr(635,57,283,128,6,'#5f485b');text('MOONLIGHT',777,100,27,'#fbd6a5');text('café  ·  since tonight',777,127,13,'#e7bdab');line(670,144,882,144,'#bb916f',1);text('COFFEE   &   CONVERSATIONS',777,164,10,'#d6a69b');
    // Hanging lamps.
    for(const x of [184,474,807]){line(x,0,x,52,'#291e31',4);ellipse(x,59,35,11,'#56394b');ellipse(x,68,44,9,'#ffc9971e');ctx.beginPath();ctx.moveTo(x-33,56);ctx.lineTo(x-19,27);ctx.lineTo(x+19,27);ctx.lineTo(x+33,56);ctx.closePath();ctx.fillStyle='#4c3348';ctx.fill();ellipse(x,58,27,7,'#eac39c');}
    const floor=ctx.createLinearGradient(0,260,0,H);floor.addColorStop(0,'#ccab95');floor.addColorStop(1,'#b5867e');ctx.fillStyle=floor;ctx.fillRect(0,271,W,H-271);
    for(let y=283;y<670;y+=52)line(0,y,1000,y,'#694f6650',2);
    for(let i=0;i<26;i++)line((i*71)%1025,277,((i*71)%1025)-170,625,'#ffffff0e',1);
    rr(46,325,916,267,28,'#c29c89');rr(60,339,888,238,24,'#bd9685');
    // Broad rugs.
    ellipse(210,407,140,96,'#ab7e8358');ellipse(773,400,145,95,'#a6798156');ellipse(482,418,141,99,'#a67c8952');
    // Espresso bar and pastry shelf at the back wall.
    rr(613,218,354,18,7,'#493643');rr(610,232,359,63,7,'#9d6c66');rr(605,280,372,21,5,'#ddaa81');rr(604,298,373,11,4,'#764a50');
    for(const xx of [650,688,727]){rr(xx,217,22,18,4,'#e6d7bf');ellipse(xx+11,216,9,3,'#f4e5cf');}
    rr(802,199,76,36,6,'#433641');rr(811,204,40,25,4,'#a5a6a7');rr(851,212,30,19,3,'#302b37');
    rr(909,199,40,29,4,'#e4c29e');ellipse(924,204,10,5,'#f4d9b0');ellipse(924,208,9,4,'#d2a87c');
    // Little cat resting on shelf.
    ellipse(566,282,25,12,'#6c5b62');ellipse(563,262,18,18,'#e5b49a');ctx.beginPath();ctx.moveTo(549,252);ctx.lineTo(552,236);ctx.lineTo(561,249);ctx.moveTo(568,250);ctx.lineTo(577,237);ctx.lineTo(579,253);ctx.fillStyle='#e5b49a';ctx.fill();ellipse(558,263,2.1,2.1,'#533c47');ellipse(570,263,2.1,2.1,'#533c47');
    drawPlant(64,314,.8);drawPlant(958,345,.8);drawPlant(79,577,.68);drawPlant(938,577,.7);
    drawTable(205,405,0);drawTable(490,420,1);drawTable(784,405,0);
    rr(378,550,211,18,7,'#7d5967');rr(395,525,175,34,15,'#a2777a');rr(408,524,150,12,7,'#c99a87');
    // Chalkboard on far left.
    rr(27,76,27,139,5,'#513a47');rr(31,83,19,119,2,'#c99b7c');
    // Delicate floating dust specks.
    for(let i=0;i<17;i++){const px=(i*131+31)%1000,py=285+(i*67)%290;ellipse(px,py,1.2,1.2,`rgba(255,228,193,${.2+.1*Math.sin(time*.001+i)})`);}
    if(target){ellipse(target.x,target.y,12+Math.sin(time*.007)*4,5,'#fae2bf70');}
  }
  function drawAvatar(p,time){const x=p.rx,y=p.ry,bob=(p.seat!==null?0:Math.sin(time*.005+(p.id.length||3))*.9);
    ellipse(x,y+4,23,7,'#3e33444a');
    if(p.seat!==null){ellipse(x,y-1,23,12,'#d9b19a');}
    ctx.save();ctx.translate(x,y+bob);
    // legs and shoes
    rr(-12,-15,10,19,4,'#403e56');rr(2,-15,10,19,4,'#403e56');rr(-14,0,13,6,3,'#554047');rr(1,0,13,6,3,'#554047');
    rr(-21,-41,42,31,13,p.color||'#e8b38e');rr(-25,-37,10,23,5,p.color||'#e8b38e');rr(15,-37,10,23,5,p.color||'#e8b38e');
    rr(-8,-47,16,13,5,'#e2a583');ellipse(0,-61,23,23,'#edb795');
    // hair and face
    ellipse(0,-76,23,12,'#463342');ellipse(-17,-69,8,14,'#463342');ellipse(16,-68,7,12,'#463342');
    ellipse(-8,-61,2.1,2.5,'#49363a');ellipse(8,-61,2.1,2.5,'#49363a');line(-3,-52,3,-52,'#bb7775',1.5);
    if(p.drink){text(DRINKS[p.drink],22,-42,21,'#fff');}
    if(p.action && time-p.actionAt<1700){const em={wave:'👋',heart:'💕',cheers:'🥂'}[p.action]||'✨';text(em,8,-99+(time-p.actionAt)*-.013,24,'#fff');}
    ctx.restore();
    const label=p.id===me.id?`✦ ${p.name}`:p.name;
    ctx.font=`700 12px 'Noto Sans KR',system-ui,sans-serif`;const width=Math.min(178,ctx.measureText(label).width+20);
    rr(x-width/2,y+13,width,25,12,p.id===me.id?'#f1c49b':'#392c42');text(label,x,y+30,12,p.id===me.id?'#39273a':'#f9e9ee');
    if(p.speech&&time-p.speechAt<5800){const content=Array.from(p.speech).slice(0,27).join('')+(Array.from(p.speech).length>27?'…':'');ctx.font='600 12px system-ui';const w=Math.max(66,Math.min(272,ctx.measureText(content).width+27));rr(x-w/2,y-127,w,34,12,'#fff0e4');text(content,x,y-105,12,'#513c46','center',600);}
  }
  function drawFrame(time){const r=canvas.getBoundingClientRect();if(r.width<1)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);const cw=Math.round(r.width*dpr),ch=Math.round(r.height*dpr);
    if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
    const scale=Math.max(r.width/W,r.height/H);
    const follow=me||{x:500,y:450};
    // Center-follow camera, clamped to world bounds. On desktop the full cafe fits.
    const ox=Math.min(0,Math.max(r.width-W*scale,r.width/2-follow.rx*scale));
    const oy=Math.min(0,Math.max(r.height-H*scale,r.height/2-follow.ry*scale));
    viewport={scale,ox,oy,dpr,w:r.width,h:r.height};
    ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*ox,dpr*oy);
    ctx.clearRect(-ox/scale,-oy/scale,r.width/scale,r.height/scale);
    drawCafe(time);
    [...players.values()].sort((a,b)=>a.ry-b.ry).forEach(p=>drawAvatar(p,time));
    if(!online && entered){rr(22,16,233,34,11,'#35263eeb');text('오프라인 미리보기 · 실시간 연결 안 됨',35,38,12,'#fff0df','left',700);}
  }
  function tick(time){const dt=Math.min(.06,(time-lastFrame)/1000||0);lastFrame=time;
    if(entered && !entry.open && !menu.open){let dx=0,dy=0;
      if(keydown.has('arrowleft')||keydown.has('a'))dx--;
      if(keydown.has('arrowright')||keydown.has('d'))dx++;
      if(keydown.has('arrowup')||keydown.has('w'))dy--;
      if(keydown.has('arrowdown')||keydown.has('s'))dy++;
      if(dx||dy){const l=Math.hypot(dx,dy);dx/=l;dy/=l;clearSit();}
      else if(target){const tx=target.x-me.x,ty=target.y-me.y,d=Math.hypot(tx,ty);if(d<5){target=null;}else{dx=tx/d;dy=ty/d;}}
      if(dx||dy){const step=180*dt;me.x=Math.max(62,Math.min(936,me.x+dx*step));me.y=Math.max(328,Math.min(579,me.y+dy*step));me.rx=me.x;me.ry=me.y;
        if(time-lastSend>70){send({type:'move',x:me.x,y:me.y});lastSend=time;}}
    }
    players.forEach(p=>{if(p.id!==me.id){p.rx+=(p.x-p.rx)*Math.min(1,dt*12);p.ry+=(p.y-p.ry)*Math.min(1,dt*12);}});
    drawFrame(time);requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  updateCounts();
})();
