
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.get("/health", (req, res) => res.send("KOODBALL ONLINE"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function createRoom(name, mode) {
 return {
  id: Math.random().toString(36).slice(2,9),
  name,
  mode,
  owner: null,
  players: {},
  scoreBlue: 0,
  scoreRed: 0,
  ball: {x:500,y:300,vx:0,vy:0}
 };
}

for(let i=1;i<=4;i++){
 let r=createRoom("Futsal #"+i,"futsal");
 rooms.set(r.id,r);
}
for(let i=1;i<=4;i++){
 let r=createRoom("Iceball #"+i,"iceball");
 rooms.set(r.id,r);
}

function listRooms(){
 return [...rooms.values()].map(r=>({
  id:r.id,name:r.name,mode:r.mode,
  count:Object.keys(r.players).length
 }));
}

function broadcastRooms(){
 io.emit("roomList",listRooms());
}

function leave(socket){
 let id=socket.data.room;
 if(!id)return;
 let r=rooms.get(id);
 if(r){
  delete r.players[socket.id];
  if(r.owner===socket.id)
   r.owner=Object.keys(r.players)[0]||null;
  if(!Object.keys(r.players).length&&r.private)
   rooms.delete(id);
 }
 socket.leave(id);
 socket.data.room=null;
 broadcastRooms();
}

function join(socket,id){
 let r=rooms.get(id);
 if(!r)return socket.emit("notice","Sala no encontrada");
 if(Object.keys(r.players).length>=12)
  return socket.emit("notice","Sala llena");

 leave(socket);

 let team=Object.values(r.players).filter(p=>p.team==="blue").length
 <=Object.values(r.players).filter(p=>p.team==="red").length
 ?"blue":"red";

 r.players[socket.id]={
  id:socket.id,
  name:socket.data.name,
  avatar:"⚽",
  team,
  x:team==="blue"?280:720,
  y:300,vx:0,vy:0,fx:team==="blue"?1:-1,fy:0,
  input:{up:false,down:false,left:false,right:false}
 };

 if(!r.owner)r.owner=socket.id;
 socket.join(id);
 socket.data.room=id;

 socket.emit("joined",{
  id,name:r.name,mode:r.mode,playerId:socket.id
 });

 broadcastRooms();
}

function state(r){
 io.to(r.id).emit("state",{
  mode:r.mode,
  scoreBlue:r.scoreBlue,
  scoreRed:r.scoreRed,
  ball:r.ball,
  players:Object.values(r.players).map(p=>({
   id:p.id,name:p.name,avatar:p.avatar,
   team:p.team,x:p.x,y:p.y,vx:p.vx,vy:p.vy
  }))
 });
}

io.on("connection",socket=>{
 socket.data.name="Jugador"+Math.floor(Math.random()*9999);
 socket.emit("roomList",listRooms());

 socket.on("setName",n=>{
  if(typeof n==="string")
   socket.data.name=n.replace(/[<>]/g,"").slice(0,18);
 });

 socket.on("createRoom",data=>{
  let r=createRoom(
   String(data?.name||"Mi sala").slice(0,24),
   data?.mode==="iceball"?"iceball":"futsal"
  );
  r.owner=socket.id;
  r.private=true;
  rooms.set(r.id,r);
  join(socket,r.id);
 });

 socket.on("joinRoom",id=>join(socket,id));
 socket.on("leaveRoom",()=>{
  leave(socket);
  socket.emit("leftRoom");
 });

 socket.on("input",data=>{
  let r=rooms.get(socket.data.room);
  let p=r?.players[socket.id];
  if(!p||!data)return;
  for(let k of ["up","down","left","right"])
   p.input[k]=!!data[k];
 });

 socket.on("shoot",()=>{
  let r=rooms.get(socket.data.room);
  let p=r?.players[socket.id];
  if(!p)return;
  let b=r.ball;
  if(Math.hypot(b.x-p.x,b.y-p.y)<65){
   b.vx+=p.fx*10;
   b.vy+=p.fy*10;
  }
 });

 socket.on("chat",msg=>{
  let r=rooms.get(socket.data.room);
  let p=r?.players[socket.id];
  if(!r||!p||typeof msg!=="string")return;
  msg=msg.trim().slice(0,120);
  if(!msg)return;

  if(msg==="!help"){
   socket.emit("chat",{system:true,text:
    "!avatar 😀 | !red | !blue | !bb | !futsal | !iceball | !admin"});
   return;
  }
  if(msg==="!bb"){
   leave(socket);
   socket.emit("leftRoom");
   return;
  }
  if(msg.startsWith("!avatar ")){
   p.avatar=Array.from(msg.slice(8)).slice(0,2).join("");
   return;
  }
  if(msg==="!red"||msg==="!blue"){
   p.team=msg==="!red"?"red":"blue";
   p.x=p.team==="blue"?280:720;
   p.y=300;p.vx=p.vy=0;
   return;
  }
  if(msg==="!admin"){
   socket.emit("chat",{system:true,text:
    r.owner===socket.id?"Eres administrador":"No eres administrador"});
   return;
  }
  if(msg==="!futsal"||msg==="!iceball"){
   if(r.owner!==socket.id){
    socket.emit("notice","Solo el administrador puede cambiar el modo");
    return;
   }
   r.mode=msg==="!iceball"?"iceball":"futsal";
   return;
  }

  io.to(r.id).emit("chat",{
   name:p.name,text:msg,team:p.team
  });
 });

 socket.on("disconnect",()=>leave(socket));
});

function collide(a,b){
 let dx=b.x-a.x,dy=b.y-a.y;
 let d=Math.hypot(dx,dy)||0.001;
 if(d>=38)return;
 let nx=dx/d,ny=dy/d,over=38-d;
 a.x-=nx*over/2;a.y-=ny*over/2;
 b.x+=nx*over/2;b.y+=ny*over/2;
 let rel=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
 if(rel<0){
  let impulse=-rel*.8;
  a.vx-=impulse*nx;a.vy-=impulse*ny;
  b.vx+=impulse*nx;b.vy+=impulse*ny;
 }
}

function reset(r){
 r.ball={x:500,y:300,vx:0,vy:0};
 for(let p of Object.values(r.players)){
  p.x=p.team==="blue"?280:720;
  p.y=300;p.vx=p.vy=0;
 }
}

setInterval(()=>{
 for(let r of rooms.values()){
  let players=Object.values(r.players);
  let ice=r.mode==="iceball";

  for(let p of players){
   let i=p.input;
   let ax=Number(i.right)-Number(i.left);
   let ay=Number(i.down)-Number(i.up);
   let len=Math.hypot(ax,ay);
   if(len){
    ax/=len;ay/=len;
    p.fx=ax;p.fy=ay;
    p.vx+=ax*.55;p.vy+=ay*.55;
   }
   p.vx*=ice?.985:.91;
   p.vy*=ice?.985:.91;
   p.x+=p.vx;p.y+=p.vy;
   let s=Math.hypot(p.vx,p.vy);
   if(s>6){p.vx*=6/s;p.vy*=6/s}
   p.x=Math.max(54,Math.min(946,p.x));
   p.y=Math.max(54,Math.min(546,p.y));
  }

  for(let i=0;i<players.length;i++)
   for(let j=i+1;j<players.length;j++)
    collide(players[i],players[j]);

  let b=r.ball;
  for(let p of players){
   let dx=b.x-p.x,dy=b.y-p.y;
   let d=Math.hypot(dx,dy)||.001;
   if(d<30){
    let nx=dx/d,ny=dy/d;
    b.x=p.x+nx*30;b.y=p.y+ny*30;
    b.vx+=p.vx*.45+nx*1.3;
    b.vy+=p.vy*.45+ny*1.3;
   }
  }

  b.x+=b.vx;b.y+=b.vy;
  b.vx*=ice?.993:.98;
  b.vy*=ice?.993:.98;

  if(b.y<30||b.y>570){
   b.y=Math.max(30,Math.min(570,b.y));
   b.vy*=-.85;
  }
  if(b.x<20||b.x>980){
   if(b.y>225&&b.y<375){
    if(b.x<20)r.scoreBlue++;
    else r.scoreRed++;
    reset(r);
   }else{
    b.x=Math.max(20,Math.min(980,b.x));
    b.vx*=-.85;
   }
  }
  state(r);
 }
},1000/30);

server.listen(PORT,"0.0.0.0",()=>{
 console.log("KOODBALL ONLINE "+PORT);
});
