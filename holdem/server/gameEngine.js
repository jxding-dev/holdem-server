/**
 * gameEngine.js — 서버 사이드 게임 로직
 *
 * 멀티플레이의 핵심: 모든 상태는 여기서만 변경된다.
 * 클라이언트는 action을 보내고, 서버가 유일한 진실의 원천이다.
 *
 * 해결하는 문제:
 * 1. 덱 공유 — 서버가 하나의 덱을 관리, 카드 중복 불가
 * 2. 턴 순서 — currentActor 서버에서만 변경
 * 3. 레이스 컨디션 — 액션 큐로 직렬 처리
 * 4. 연결 끊김 — 타임아웃 자동 폴드
 */

// ─── 카드 ─────────────────────────────────────────────────
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠','♥','♦','♣'];
const RANK_VAL = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit, val: RANK_VAL[rank] });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── 족보 판정 ────────────────────────────────────────────
function evaluateHand(cards) {
  if (!cards || cards.length < 2) return { power: -1, name: '?', emoji: '?', tieBreak: [] };
  if (cards.length < 5) return _quickEval(cards);
  const combos = _combos(cards, 5);
  let best = null;
  for (const c of combos) {
    const r = _eval5(c);
    if (!best || compareHands(r, best) > 0) best = r;
  }
  return best;
}

function compareHands(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  if (a.power !== b.power) return a.power - b.power;
  for (let i = 0; i < Math.max(a.tieBreak.length, b.tieBreak.length); i++) {
    const d = (a.tieBreak[i] ?? 0) - (b.tieBreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const HAND_DEF = [
  { power:0, name:'하이카드',          emoji:'🃏' },
  { power:1, name:'원페어',            emoji:'👤' },
  { power:2, name:'투페어',            emoji:'👥' },
  { power:3, name:'트리플',            emoji:'🔺' },
  { power:4, name:'스트레이트',        emoji:'➡️' },
  { power:5, name:'플러시',            emoji:'🌊' },
  { power:6, name:'풀하우스',          emoji:'🏠' },
  { power:7, name:'포카드',            emoji:'🎯' },
  { power:8, name:'스트레이트 플러시', emoji:'✨' },
  { power:9, name:'로열 플러시',       emoji:'👑' },
];

function _eval5(cards) {
  const sorted = [...cards].sort((a,b)=>b.val-a.val);
  const vals = sorted.map(c=>c.val);
  const suits = sorted.map(c=>c.suit);
  const freq = {};
  for (const v of vals) freq[v]=(freq[v]||0)+1;
  const counts = Object.values(freq).sort((a,b)=>b-a);
  const flush = suits.every(s=>s===suits[0]);
  const strHigh = _strHigh(vals);
  const str = strHigh>0;
  const mk = (p,tb) => ({ ...HAND_DEF[p], tieBreak: tb });
  if (flush&&str&&strHigh===14) return mk(9,[14]);
  if (flush&&str) return mk(8,[strHigh]);
  if (counts[0]===4) { const q=_top(freq,4),k=_top(freq,1); return mk(7,[q,k]); }
  if (counts[0]===3&&counts[1]===2) { const t=_top(freq,3),p=_top(freq,2); return mk(6,[t,p]); }
  if (flush) return mk(5,vals);
  if (str) return mk(4,[strHigh]);
  if (counts[0]===3) { const t=_top(freq,3); return mk(3,[t,...vals.filter(v=>v!==t)]); }
  if (counts[0]===2&&counts[1]===2) {
    const ps=Object.keys(freq).filter(k=>freq[k]===2).map(Number).sort((a,b)=>b-a);
    return mk(2,[...ps, vals.find(v=>freq[v]===1)??0]);
  }
  if (counts[0]===2) { const p=_top(freq,2); return mk(1,[p,...vals.filter(v=>v!==p)]); }
  return mk(0,vals);
}
function _top(freq,c){ return Math.max(...Object.keys(freq).filter(k=>freq[k]===c).map(Number)); }
function _strHigh(vals){
  const u=[...new Set(vals)].sort((a,b)=>b-a);
  for(let i=0;i<=u.length-5;i++) if(u[i]-u[i+4]===4&&new Set(u.slice(i,i+5)).size===5) return u[i];
  if([14,5,4,3,2].every(v=>vals.includes(v))) return 5;
  return 0;
}
function _combos(arr,k){
  if(k===0) return [[]];
  if(arr.length<k) return [];
  const [h,...t]=arr;
  return [..._combos(t,k-1).map(c=>[h,...c]),..._combos(t,k)];
}
function _quickEval(cards){
  const vals=cards.map(c=>c.val).sort((a,b)=>b-a);
  const freq={};
  for(const v of vals) freq[v]=(freq[v]||0)+1;
  const counts=Object.values(freq).sort((a,b)=>b-a);
  if(counts[0]===3) return {...HAND_DEF[3],tieBreak:vals};
  if(counts[0]===2&&counts[1]===2) return {...HAND_DEF[2],tieBreak:vals};
  if(counts[0]===2) return {...HAND_DEF[1],tieBreak:vals};
  return {...HAND_DEF[0],tieBreak:vals};
}

// ─── 상수 ─────────────────────────────────────────────────
const STARTING_CHIPS = 5000;
const SMALL_BLIND    = 25;
const BIG_BLIND      = 50;
const TURN_TIMEOUT   = 30000; // 30초 안에 액션 안 하면 자동 폴드
const MAX_PLAYERS    = 5;

// ─── GameRoom 클래스 ──────────────────────────────────────
class GameRoom {
  constructor(roomId) {
    this.roomId   = roomId;
    this.players  = [];      // [{ id, name, chips, hand, bet, folded, allIn, connected, isReady }]
    this.deck     = [];
    this.community = [];
    this.pot      = 0;
    this.sidePots = [];      // 올인 시 사이드팟
    this.phase    = 'lobby'; // lobby | preflop | flop | turn | river | showdown
    this.currentBet   = 0;
    this.dealerIdx    = -1;  // 딜러 포지션 인덱스
    this.currentIdx   = -1;  // 현재 액션해야 할 플레이어 인덱스
    this.hostId       = null;
    this.minPlayers   = 2;
    this.roundNum     = 0;
    this.turnTimer    = null;
    this.actionQueue  = [];  // 직렬 처리용 큐
    this.processing   = false;
    this.lastActions  = [];  // 최근 액션 로그 (UI 표시용)
    this.gameMode     = 'multi'; // 'solo' | 'multi'
    this.actedThisStreet = new Set(); // 이번 스트리트에서 액션한 플레이어 id 목록
  }

  // ── 플레이어 관리 ──────────────────────────────────────

  addPlayer(id, name) {
    if (this.players.length >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
    if (this.phase !== 'lobby') return { error: 'GAME_IN_PROGRESS' };
    const existing = this.players.find(p => p.id === id);
    if (existing) { existing.connected = true; return { ok: true }; }

    const player = {
      id, name,
      chips:     STARTING_CHIPS,
      hand:      [],
      bet:       0,           // 현재 라운드 낸 총액
      totalBet:  0,           // 이번 게임 전체 낸 총액
      folded:    false,
      allIn:     false,
      connected: true,
      isReady:   false,
      seatIdx:   this.players.length,
      avatar:    _randomAvatar(),
    };

    if (this.players.length === 0) this.hostId = id;
    this.players.push(player);
    return { ok: true };
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (this.phase === 'lobby') {
      this.players.splice(idx, 1);
      if (this.hostId === id && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }
    } else {
      // 게임 중: 연결 끊김으로 처리 → 자동 폴드
      this.players[idx].connected = false;
      if (this.currentIdx === idx) {
        this._autoFold(idx);
      }
    }
    // 남은 연결된 플레이어가 1명 이하면 게임 종료
    const connected = this.players.filter(p => p.connected);
    if (this.phase !== 'lobby' && connected.length <= 1) {
      this._handleLastManStanding();
    }
  }

  reconnectPlayer(id) {
    const p = this.players.find(p => p.id === id);
    if (p) { p.connected = true; return true; }
    return false;
  }

  setReady(id, ready) {
    const p = this.players.find(p => p.id === id);
    if (p) p.isReady = ready;
  }

  // ── 게임 시작 (방장만 가능) ────────────────────────────

  startGame(requesterId, mode = 'multi') {
    if (requesterId !== this.hostId) return { error: 'NOT_HOST' };
    if (this.players.length < (mode === 'solo' ? 1 : 2)) return { error: 'NOT_ENOUGH_PLAYERS' };

    this.gameMode = mode;

    // 솔로 모드: AI 딜러 1명 추가
    if (mode === 'solo') {
      const aiExists = this.players.find(p => p.id === 'AI_DEALER');
      if (!aiExists) {
        this.players.push({
          id: 'AI_DEALER', name: '딜러 AI',
          chips: STARTING_CHIPS * 10, hand: [], bet: 0, totalBet: 0,
          folded: false, allIn: false, connected: true, isReady: true,
          seatIdx: 1, avatar: '🤖', isAI: true,
        });
      }
    }

    this._startNewRound();
    return { ok: true };
  }

  // ── 새 라운드 시작 ─────────────────────────────────────

  _startNewRound() {
    this.roundNum++;
    this.deck      = createDeck();
    this.community = [];
    this.pot       = 0;
    this.sidePots  = [];
    this.currentBet = 0;
    this.lastActions = [];
    this.phase     = 'preflop';

    // 플레이어 상태 초기화
    this.players.forEach(p => {
      p.hand    = [];
      p.bet     = 0;
      p.totalBet = 0;
      p.folded  = false;
      p.allIn   = false;
    });

    // 딜러 포지션 순환
    const activePlayers = this.players.filter(p => p.connected && p.chips > 0);
    if (activePlayers.length === 0) return;

    this.dealerIdx = (this.dealerIdx + 1) % this.players.length;
    // 칩 없는 플레이어는 딜러 스킵
    while (!this.players[this.dealerIdx]?.connected ||
           this.players[this.dealerIdx]?.chips <= 0) {
      this.dealerIdx = (this.dealerIdx + 1) % this.players.length;
    }

    // 카드 배분 (2장씩)
    this.players.forEach(p => {
      if (p.connected && p.chips > 0) {
        p.hand = [this.deck.pop(), this.deck.pop()];
      }
    });

    // 블라인드 처리
    const sbIdx = this._nextActiveIdx(this.dealerIdx);
    const bbIdx = this._nextActiveIdx(sbIdx);

    this._postBlind(sbIdx, SMALL_BLIND);
    this._postBlind(bbIdx, BIG_BLIND);
    this.currentBet = BIG_BLIND;

    // UTG (BB 다음)부터 베팅 시작
    this.currentIdx = this._nextActiveIdx(bbIdx);
    // 프리플랍: actedThisStreet 초기화 (블라인드는 액션으로 안 침)
    this.actedThisStreet = new Set();

    this._startTurnTimer();
    this._triggerAIIfNeeded();
  }

  _postBlind(idx, amount) {
    const p = this.players[idx];
    if (!p) return;
    const pay = Math.min(amount, p.chips);
    p.chips -= pay;
    p.bet   += pay;
    p.totalBet += pay;
    this.pot  += pay;
    if (p.chips === 0) p.allIn = true;
  }

  // ── 플레이어 액션 ──────────────────────────────────────

  /**
   * 액션을 큐에 넣어 직렬 처리 (레이스 컨디션 방지)
   */
  enqueueAction(playerId, action, amount = 0) {
    this.actionQueue.push({ playerId, action, amount });
    if (!this.processing) this._processQueue();
  }

  async _processQueue() {
    if (this.processing || this.actionQueue.length === 0) return;
    this.processing = true;
    while (this.actionQueue.length > 0) {
      const item = this.actionQueue.shift();
      this._handleAction(item.playerId, item.action, item.amount);
    }
    this.processing = false;
  }

  _handleAction(playerId, action, amount) {
    const pIdx = this.players.findIndex(p => p.id === playerId);
    if (pIdx === -1) return { error: 'PLAYER_NOT_FOUND' };
    if (pIdx !== this.currentIdx) return { error: 'NOT_YOUR_TURN' };
    const p = this.players[pIdx];
    if (p.folded || p.allIn) return { error: 'CANNOT_ACT' };

    this._clearTurnTimer();

    let log = { actor: p.name, action, amount: 0 };

    switch (action) {
      case 'fold':
        p.folded = true;
        log.amount = 0;
        break;

      case 'check': {
        const diff = this.currentBet - p.bet;
        if (diff > 0) return { error: 'MUST_CALL_OR_RAISE' };
        break;
      }

      case 'call': {
        const callAmt = Math.min(this.currentBet - p.bet, p.chips);
        if (callAmt <= 0) { this._handleAction(playerId, 'check', 0); return; }
        p.chips -= callAmt;
        p.bet   += callAmt;
        p.totalBet += callAmt;
        this.pot  += callAmt;
        log.amount = callAmt;
        if (p.chips === 0) p.allIn = true;
        break;
      }

      case 'raise': {
        const callDiff = Math.max(0, this.currentBet - p.bet);
        const minRaise = Math.max(BIG_BLIND, this.currentBet);
        const raiseAmt = Math.max(minRaise, amount);
        const totalPay = callDiff + raiseAmt;
        const actualPay = Math.min(totalPay, p.chips);
        p.chips -= actualPay;
        p.bet   += actualPay;
        p.totalBet += actualPay;
        this.pot  += actualPay;
        this.currentBet = p.bet;  // 새 기준액
        log.amount = actualPay;
        if (p.chips === 0) p.allIn = true;
        // 레이즈 시 다른 모든 플레이어의 액션 기록 초기화 (다시 콜/레이즈 기회 줘야 함)
        this.actedThisStreet = new Set([playerId]);
        break;
      }

      case 'allin': {
        const pay = p.chips;
        p.chips = 0;
        p.bet  += pay;
        p.totalBet += pay;
        this.pot += pay;
        if (p.bet > this.currentBet) {
          this.currentBet = p.bet;
          // 올인으로 베팅 올라가면 레이즈 취급 → 다른 플레이어 기회 초기화
          this.actedThisStreet = new Set([playerId]);
        } else {
          this.actedThisStreet.add(playerId);
        }
        p.allIn = true;
        log.amount = pay;
        break;
      }

      default: return { error: 'UNKNOWN_ACTION' };
    }

    // 이번 액션을 기록 (raise/allin은 위에서 이미 처리)
    this.actedThisStreet.add(playerId);
    this.lastActions.push(log);
    if (this.lastActions.length > 10) this.lastActions.shift();

    this._advanceTurn();
  }

  _advanceTurn() {
    // 폴드 안 하고 연결된 플레이어 수 확인
    const remaining = this.players.filter(p => !p.folded && p.connected);
    if (remaining.length <= 1) {
      // 한 명만 남으면 바로 라운드 종료 (상대 폴드)
      this._endRound(remaining);
      return;
    }

    // 액션 가능한 플레이어 (폴드X, 올인X, 연결됨)
    const canAct = remaining.filter(p => !p.allIn);

    if (canAct.length === 0) {
      // 모두 올인 → 나머지 카드 자동 공개
      this._nextStreet();
      return;
    }

    // 다음으로 액션할 플레이어
    const nextIdx = this._nextActionIdx(this.currentIdx);

    if (this._isBettingComplete(nextIdx)) {
      // 베팅 완료 → 다음 스트리트
      this._nextStreet();
    } else {
      // 아직 베팅 안 맞은 플레이어가 있음 → 턴 넘김
      this.currentIdx = nextIdx;
      this._startTurnTimer();
      this._triggerAIIfNeeded();
    }
  }

  _isBettingComplete(nextIdx) {
    // 액션 가능한 플레이어 목록 (폴드X, 올인X, 연결됨)
    const active = this.players.filter(p => !p.folded && !p.allIn && p.connected);
    if (active.length <= 1) return true;

    // ★ 올바른 베팅 완료 판단
    //
    // 두 조건을 모두 만족해야 완료:
    //   1) 모든 active 플레이어가 이번 스트리트에서 액션을 했다
    //   2) 모든 active 플레이어의 bet이 currentBet과 같다
    //
    // 이 방식은 폴드로 플레이어 수가 줄어들어도 정확하게 동작하고,
    // 레이즈 시 actedThisStreet를 초기화해서 모두에게 다시 기회를 준다.

    // 조건 1: 아직 액션 안 한 active 플레이어가 있으면 미완료
    const allActed = active.every(p => this.actedThisStreet.has(p.id));
    if (!allActed) return false;

    // 조건 2: 모두 currentBet에 맞췄는가?
    return active.every(p => p.bet === this.currentBet);
  }

  _nextStreet() {
    // 폴드로 한 명만 남으면 바로 종료
    const remaining = this.players.filter(p => !p.folded && p.connected);
    if (remaining.length <= 1) {
      this._endRound(remaining);
      return;
    }

    // 모두 올인이면 나머지 카드 자동 공개
    const canAct = remaining.filter(p => !p.allIn);
    if (canAct.length <= 1) {
      this._runOutAllCards();
      return;
    }

    // 베팅 리셋
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;
    // 새 스트리트: 액션 기록 초기화
    this.actedThisStreet = new Set();

    switch (this.phase) {
      case 'preflop':
        this.community = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
        this.phase = 'flop';
        break;
      case 'flop':
        this.community.push(this.deck.pop());
        this.phase = 'turn';
        break;
      case 'turn':
        this.community.push(this.deck.pop());
        this.phase = 'river';
        break;
      case 'river':
        this.phase = 'showdown';
        this._endRound(this.players.filter(p => !p.folded && p.connected));
        return;
    }

    // SB부터 새 베팅 라운드
    this.currentIdx = this._nextActiveIdx(this.dealerIdx);
    this._startTurnTimer();
    this._triggerAIIfNeeded();
  }

  _runOutAllCards() {
    while (this.community.length < 5) {
      this.community.push(this.deck.pop());
    }
    this.phase = 'showdown';
    this._endRound(this.players.filter(p => !p.folded && p.connected));
  }

  _endRound(contestants) {
    this._clearTurnTimer();

    // ★ 이미 쇼다운이 처리됐으면 중복 실행 방지
    if (this.phase === 'showdown' && this.lastRoundResult) return;
    this.phase = 'showdown';

    // ★ 실제로 폴드 안 하고 연결된 사람만 contestants로 (방어 코드)
    contestants = contestants.filter(p => !p.folded && p.connected);

    if (contestants.length === 0) {
      // 전원 폴드 (이상 케이스) — pot 환불 없이 그냥 종료
      return;
    }

    if (contestants.length === 1) {
      // 나 혼자 남음 → 팟 전체
      const winner = contestants[0];
      winner.chips += this.pot;
      this._addRoundResult([{ player: winner, amount: this.pot, hand: null }]);
      return;
    }

    // 쇼다운: 족보 비교
    const results = contestants.map(p => ({
      player: p,
      result: evaluateHand([...p.hand, ...this.community]),
    })).sort((a, b) => compareHands(b.result, a.result));

    // 사이드팟 없는 단순 케이스
    const topResult = results[0].result;
    const winners = results.filter(r => compareHands(r.result, topResult) === 0);
    const share = Math.floor(this.pot / winners.length);
    const rem   = this.pot - share * winners.length;

    const payouts = winners.map((w, i) => ({
      player: w.player,
      amount: share + (i === 0 ? rem : 0),
      hand:   w.result,
    }));

    payouts.forEach(pw => { pw.player.chips += pw.amount; });
    this._addRoundResult(payouts, results);
  }

  _addRoundResult(payouts, allResults = []) {
    this.lastRoundResult = {
      payouts,
      allResults,
      community: [...this.community],
      pot: this.pot,
    };
  }

  _handleLastManStanding() {
    const alive = this.players.filter(p => p.connected && !p.folded);
    if (alive.length === 1) {
      alive[0].chips += this.pot;
      this._addRoundResult([{ player: alive[0], amount: this.pot, hand: null }]);
      this.phase = 'showdown';
    }
  }

  // ── AI 딜러 ────────────────────────────────────────────

  _triggerAIIfNeeded() {
    const current = this.players[this.currentIdx];
    if (!current || !current.isAI) return;

    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      if (this.players[this.currentIdx]?.id !== current.id) return;
      const result = evaluateHand([...current.hand, ...this.community]);
      const power  = result.power;
      const diff   = this.currentBet - current.bet;

      let action, amount = 0;
      if (power >= 5) {
        action = 'raise';
        amount = Math.min(Math.floor(this.pot * 0.6) + 50, current.chips, 300);
      } else if (power >= 3) {
        action = diff > 0 ? 'call' : 'check';
      } else {
        if (diff > 0 && Math.random() < 0.4) action = 'fold';
        else action = diff > 0 ? 'call' : 'check';
      }
      this.enqueueAction(current.id, action, amount);
    }, delay);
  }

  _autoFold(idx) {
    const p = this.players[idx];
    if (!p || p.folded) return;
    p.folded = true;
    this.lastActions.push({ actor: p.name, action: 'fold', amount: 0, auto: true });
    this._advanceTurn();
  }

  // ── 타이머 ────────────────────────────────────────────

  _startTurnTimer() {
    this._clearTurnTimer();
    // ★ 타이머 시작 시각을 기록해 클라이언트에 남은 시간 전달
    this.turnStartedAt = Date.now();
    this.turnTimer = setTimeout(() => {
      const p = this.players[this.currentIdx];
      if (p && !p.folded && !p.allIn) {
        // 타임아웃: 체크 가능하면 체크, 아니면 폴드
        const diff = this.currentBet - p.bet;
        this.enqueueAction(p.id, diff > 0 ? 'fold' : 'check', 0);
      }
    }, TURN_TIMEOUT);
  }

  _clearTurnTimer() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.turnStartedAt = null;
  }

  // ── 인덱스 유틸 ───────────────────────────────────────

  _nextActiveIdx(fromIdx) {
    let idx = (fromIdx + 1) % this.players.length;
    let guard = 0;
    while (guard++ < this.players.length) {
      const p = this.players[idx];
      if (p && p.connected && p.chips > 0 && !p.folded) return idx;
      idx = (idx + 1) % this.players.length;
    }
    return fromIdx;
  }

  _nextActionIdx(fromIdx) {
    let idx = (fromIdx + 1) % this.players.length;
    let guard = 0;
    while (guard++ < this.players.length) {
      const p = this.players[idx];
      if (p && p.connected && !p.folded && !p.allIn) return idx;
      idx = (idx + 1) % this.players.length;
    }
    return fromIdx;
  }

  // ── 공개 상태 생성 (클라이언트 전송용) ───────────────

  /**
   * 각 플레이어에게 보낼 상태를 개인화해서 반환
   * 자기 패만 보이고, 남의 패는 숨김
   */
  getStateFor(playerId) {
    const myIdx = this.players.findIndex(p => p.id === playerId);

    const players = this.players.map((p, i) => ({
      id:        p.id,
      name:      p.name,
      chips:     p.chips,
      bet:       p.bet,
      totalBet:  p.totalBet,
      folded:    p.folded,
      allIn:     p.allIn,
      connected: p.connected,
      isHost:    p.id === this.hostId,
      avatar:    p.avatar,
      isAI:      !!p.isAI,
      seatIdx:   p.seatIdx,
      isDealer:  i === this.dealerIdx,
      isCurrentActor: i === this.currentIdx,
      // 패: 자기 것만 공개, 쇼다운에서는 모두 공개
      hand: (i === myIdx || this.phase === 'showdown')
        ? p.hand
        : p.hand.map(() => null), // null = 뒷면
    }));

    return {
      roomId:      this.roomId,
      phase:       this.phase,
      pot:         this.pot,
      community:   this.community,
      currentBet:  this.currentBet,
      currentIdx:  this.currentIdx,
      dealerIdx:   this.dealerIdx,
      myIdx,
      isMyTurn:    myIdx === this.currentIdx && !this.players[myIdx]?.folded,
      turnTimeLeft: this.turnStartedAt
        ? Math.max(0, Math.round((TURN_TIMEOUT - (Date.now() - this.turnStartedAt)) / 1000))
        : TURN_TIMEOUT / 1000,
      players,
      lastActions: this.lastActions.slice(-5),
      roundNum:    this.roundNum,
      hostId:      this.hostId,
      gameMode:    this.gameMode,
      lastRoundResult: this.phase === 'showdown' ? this.lastRoundResult : null,
    };
  }

  // 로비 상태 (패 정보 없음)
  getLobbyState() {
    return {
      roomId:   this.roomId,
      phase:    this.phase,
      hostId:   this.hostId,
      gameMode: this.gameMode,
      players:  this.players.map(p => ({
        id: p.id, name: p.name, chips: p.chips,
        isReady: p.isReady, isHost: p.id === this.hostId,
        connected: p.connected, avatar: p.avatar, seatIdx: p.seatIdx,
      })),
    };
  }

  continueRound() {
    // 쇼다운 → 다음 라운드 준비
    if (this.phase === 'showdown') {
      this.lastRoundResult = null;
      // 칩 없는 플레이어 제거
      this.players = this.players.filter(p => p.chips > 0 || p.isAI);
      if (this.players.filter(p => p.connected).length >= 2) {
        setTimeout(() => this._startNewRound(), 500);
      } else {
        this.phase = 'lobby';
      }
    }
  }
}

// ─── 유틸 ─────────────────────────────────────────────────
const AVATARS = ['🎩','🦊','🐺','🦁','🐯','🐸','🦅','🐲','🦈','🐻'];
function _randomAvatar() { return AVATARS[Math.floor(Math.random() * AVATARS.length)]; }

module.exports = { GameRoom, STARTING_CHIPS, SMALL_BLIND, BIG_BLIND, TURN_TIMEOUT, MAX_PLAYERS };
