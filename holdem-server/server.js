/**
 * server.js — Texas Hold'em WebSocket 서버
 *
 * 닷홈은 PHP 공유 호스팅이므로 WebSocket 서버를 직접 올릴 수 없습니다.
 * 이 서버는 별도 Node.js 환경(예: Render.com 무료 티어, Railway, fly.io)에 배포하고
 * 닷홈 HTML 파일은 WEBSOCKET_URL을 해당 서버 주소로 변경하면 됩니다.
 *
 * 배포 방법 (Render.com 무료):
 * 1. GitHub에 server/ 폴더 올리기
 * 2. Render.com → New Web Service → Node → npm start
 * 3. 생성된 URL (예: wss://holdem-xxx.onrender.com) 을 client의 WS_URL에 입력
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { GameRoom, MAX_PLAYERS } = require('./gameEngine');

const PORT  = process.env.PORT || 8080;
const rooms = new Map();       // roomId → GameRoom
const clients = new Map();     // ws → { playerId, roomId, playerName }

const wss = new WebSocket.Server({ port: PORT });

console.log(`🃏 Texas Hold'em WebSocket Server running on port ${PORT}`);

// ─── 연결 처리 ────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return send(ws, { type: 'ERROR', message: '잘못된 메시지 형식' }); }

    handleMessage(ws, msg);
  });

  ws.on('close', () => { handleDisconnect(ws); });
  ws.on('error', (err) => { console.error('WS error:', err.message); });
});

// ─── Heartbeat (연결 유지 체크) ───────────────────────────
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ─── 메시지 처리 ──────────────────────────────────────────
function handleMessage(ws, msg) {
  const { type } = msg;

  switch (type) {

    // 방 목록 조회
    case 'LIST_ROOMS': {
      const list = [...rooms.values()]
        .filter(r => r.phase === 'lobby')
        .map(r => ({
          roomId:      r.roomId,
          playerCount: r.players.filter(p => p.connected).length,
          maxPlayers:  MAX_PLAYERS,
          hostName:    r.players.find(p => p.id === r.hostId)?.name || '?',
        }));
      send(ws, { type: 'ROOM_LIST', rooms: list });
      break;
    }

    // 방 생성
    case 'CREATE_ROOM': {
      const { playerName } = msg;
      if (!playerName?.trim()) return send(ws, { type: 'ERROR', message: '이름을 입력하세요.' });
      const roomId   = _generateRoomCode();
      const playerId = uuidv4();
      const room     = new GameRoom(roomId);
      rooms.set(roomId, room);
      const result = room.addPlayer(playerId, playerName.trim());
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      clients.set(ws, { playerId, roomId, playerName: playerName.trim() });
      send(ws, { type: 'ROOM_JOINED', playerId, roomId });
      broadcastLobby(room);
      break;
    }

    // 방 입장
    case 'JOIN_ROOM': {
      const { roomId, playerName } = msg;
      const room = rooms.get(roomId?.toUpperCase());
      if (!room) return send(ws, { type: 'ERROR', message: '방을 찾을 수 없어요.' });
      const playerId = uuidv4();
      const result   = room.addPlayer(playerId, (playerName || '플레이어').trim());
      if (result.error) {
        const errMsg = { ROOM_FULL: '방이 꽉 찼어요.', GAME_IN_PROGRESS: '게임이 진행 중이에요.' }[result.error] || result.error;
        return send(ws, { type: 'ERROR', message: errMsg });
      }
      clients.set(ws, { playerId, roomId: room.roomId, playerName: playerName.trim() });
      send(ws, { type: 'ROOM_JOINED', playerId, roomId: room.roomId });
      broadcastLobby(room);
      break;
    }

    // 준비 상태 변경
    case 'SET_READY': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      room.setReady(ctx.playerId, msg.ready);
      broadcastLobby(room);
      break;
    }

    // 게임 시작 (방장만)
    case 'START_GAME': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      const result = room.startGame(ctx.playerId, msg.mode || 'multi');
      if (result.error) {
        const errMsg = {
          NOT_HOST: '방장만 게임을 시작할 수 있어요.',
          NOT_ENOUGH_PLAYERS: '플레이어가 부족해요.',
        }[result.error] || result.error;
        return send(ws, { type: 'ERROR', message: errMsg });
      }
      broadcastGameState(room);
      break;
    }

    // 플레이어 액션
    case 'ACTION': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      room.enqueueAction(ctx.playerId, msg.action, msg.amount || 0);
      // ★ 큐 처리 완료 후 상태 전송 (100ms로 여유 확보)
      setTimeout(() => broadcastGameState(room), 100);
      break;
    }

    // 다음 라운드 요청 (방장)
    case 'NEXT_ROUND': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room || ctx.playerId !== room.hostId) return;
      room.continueRound();
      setTimeout(() => broadcastGameState(room), 100);
      break;
    }

    // 채팅
    case 'CHAT': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      const text = (msg.text || '').trim().slice(0, 100);
      if (!text) return;
      broadcastToRoom(room, {
        type: 'CHAT',
        from: ctx.playerName,
        text,
        ts: Date.now(),
      });
      break;
    }

    // 이모지 반응
    case 'EMOTE': {
      const ctx = clients.get(ws);
      if (!ctx) return;
      const room = rooms.get(ctx.roomId);
      if (!room) return;
      broadcastToRoom(room, {
        type: 'EMOTE',
        from: ctx.playerName,
        emote: msg.emote,
      });
      break;
    }

    // 방 나가기
    case 'LEAVE_ROOM': {
      handleDisconnect(ws);
      break;
    }

    default:
      send(ws, { type: 'ERROR', message: `알 수 없는 메시지 타입: ${type}` });
  }
}

// ─── 연결 해제 처리 ───────────────────────────────────────
function handleDisconnect(ws) {
  const ctx = clients.get(ws);
  if (!ctx) return;

  const room = rooms.get(ctx.roomId);
  if (room) {
    room.removePlayer(ctx.playerId);

    if (room.players.filter(p => p.connected).length === 0) {
      // 모두 나가면 방 삭제
      rooms.delete(ctx.roomId);
    } else if (room.phase === 'lobby') {
      broadcastLobby(room);
    } else {
      broadcastGameState(room);
    }
  }

  clients.delete(ws);
}

// ─── 브로드캐스트 함수 ────────────────────────────────────
function broadcastLobby(room) {
  const state = room.getLobbyState();
  broadcastToRoom(room, { type: 'LOBBY_STATE', state });
}

function broadcastGameState(room) {
  // 각 플레이어에게 개인화된 상태 전송
  clients.forEach((ctx, ws) => {
    if (ctx.roomId !== room.roomId) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = room.getStateFor(ctx.playerId);
    send(ws, { type: 'GAME_STATE', state });
  });
}

function broadcastToRoom(room, msg) {
  clients.forEach((ctx, ws) => {
    if (ctx.roomId !== room.roomId) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    send(ws, msg);
  });
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ─── 방 코드 생성 ──────────────────────────────────────────
function _generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ─── 빈 방 정리 (5분마다) ────────────────────────────────
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, id) => {
    const connected = room.players.filter(p => p.connected).length;
    if (connected === 0) rooms.delete(id);
  });
}, 5 * 60 * 1000);

module.exports = wss;
