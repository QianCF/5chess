"use strict";

const CELL_EMPTY = 0;

self.onmessage = (ev) => {
  try {
    const data = ev.data;
    if (!data || data.type !== "computeMove") {
      throw new Error("消息类型非法。");
    }
    const { board, ai, opponent } = data;
    const move = chooseAiMove(board, ai, opponent);
    self.postMessage({
      type: "move",
      row: move.row,
      col: move.col,
      reason: move.reason || ""
    });
  } catch (err) {
    // Worker 抛错会触发主线程 onerror
    throw err;
  }
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertPlayer(p) {
  if (p !== 1 && p !== 2) throw new Error("玩家标记非法。");
}

function assertBoard(board) {
  assert(Array.isArray(board) && board.length >= 5, "棋盘非法。");
  const n = board.length;
  for (let r = 0; r < n; r++) {
    assert(Array.isArray(board[r]) && board[r].length === n, "棋盘维度不一致。");
    for (let c = 0; c < n; c++) {
      const v = board[r][c];
      assert(v === 0 || v === 1 || v === 2, "棋盘值非法。");
    }
  }
}

function inBounds(r, c, n) {
  return r >= 0 && r < n && c >= 0 && c < n;
}

function isPlayable(board, r, c) {
  const n = board.length;
  return inBounds(r, c, n) && board[r][c] === CELL_EMPTY;
}

function placeStone(board, r, c, player) {
  assertPlayer(player);
  assertBoard(board);
  const n = board.length;
  assert(inBounds(r, c, n), "落子越界。");
  if (board[r][c] !== CELL_EMPTY) throw new Error("位置已有棋子。");
  board[r][c] = player;
}

function deepCopyBoard(board) {
  return board.map((row) => row.slice());
}

/** B 相对 A 的最远切比雪夫距离；可下空位须在其自身切比雪夫半径内能「看到」至少一枚棋子（见 getAvailableMoves） */
const MAX_B_CHEBYSHEV_FROM_A = 5;

function boardHasAnyStone(board) {
  const n = board.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== CELL_EMPTY) return true;
    }
  }
  return false;
}

/** 在 (row,col) 的切比雪夫闭球内（不含该格自身）是否存在任意棋子 */
function hasStoneWithinChebyshevOf(board, row, col, radius) {
  const n = board.length;
  for (let rr = row - radius; rr <= row + radius; rr++) {
    for (let cc = col - radius; cc <= col + radius; cc++) {
      if (!inBounds(rr, cc, n)) continue;
      if (Math.max(Math.abs(rr - row), Math.abs(cc - col)) > radius) continue;
      if (rr === row && cc === col) continue;
      if (board[rr][cc] !== CELL_EMPTY) return true;
    }
  }
  return false;
}

function getAvailableMoves(board) {
  assertBoard(board);
  const moves = [];
  const n = board.length;
  const restrict = boardHasAnyStone(board);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== CELL_EMPTY) continue;
      if (restrict && !hasStoneWithinChebyshevOf(board, r, c, MAX_B_CHEBYSHEV_FROM_A)) continue;
      moves.push({ row: r, col: c });
    }
  }
  if (moves.length === 0 && restrict) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r][c] === CELL_EMPTY) moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function getShuffledAvailableMoves(board) {
  const moves = getAvailableMoves(board);
  shuffleInPlace(moves);
  return moves;
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/**
 * 当前棋盘空位，按与 ref 的切比雪夫距离升序排列（同距离按行、列）。
 * 用于 A/B 枚举时优先试探离 A 更近的 B。
 */
function sortEmptyMovesByChebyshevFrom(board, ref) {
  const moves = getAvailableMoves(board);
  moves.sort((p, q) => {
    const dp = chebyshevDistance(ref, p);
    const dq = chebyshevDistance(ref, q);
    if (dp !== dq) return dp - dq;
    if (p.row !== q.row) return p.row - q.row;
    return p.col - q.col;
  });
  return moves;
}

function hasWinner(board, player) {
  assertBoard(board);
  assertPlayer(player);
  const n = board.length;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of dirs) {
        let len = 0;
        let rr = r;
        let cc = c;
        while (inBounds(rr, cc, n) && board[rr][cc] === player) {
          len++;
          rr += dr;
          cc += dc;
        }
        if (len >= 5) return true;
      }
    }
  }
  return false;
}

function makeCellKey(row, col) {
  return `${row},${col}`;
}

/** 与 dr,dc 方向一致的整条直线标识（同一直线）。 */
function lineKeyFromCellAndDir(r, c, dr, dc) {
  if (dr === 0 && dc === 1) return `0,1,${r}`;
  if (dr === 1 && dc === 0) return `1,0,${c}`;
  if (dr === 1 && dc === 1) return `1,1,${r - c}`;
  if (dr === 1 && dc === -1) return `1,-1,${r + c}`;
  throw new Error("方向非法。");
}

function buildSegmentCellKeys(start, dr, dc, len) {
  const keys = [];
  for (let i = 0; i < len; i++) {
    const rr = start.row + dr * i;
    const cc = start.col + dc * i;
    keys.push(makeCellKey(rr, cc));
  }
  return keys;
}

function cellSetFromKeys(arr) {
  return new Set(arr);
}

/** 两条候选是否共用至少一枚己方棋子（集合相交非空）。 */
function stonesOverlap(a, b) {
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

/**
 * 二级警报去重：
 * 1) 与同一直线（lineKey）上的一级警报共用任一枚棋子者不计入二级；
 * 2) 其余二级候选：仅当在同一直线上且两二级警报的棋子集合有重叠时只计一条；
 *    保留棋子数更多的；同点保留 tier 更小（优先级更高）的。
 * 不同直线、或同线但棋子互不重叠的二级，分别计数。
 */
function countSecondarySameLineOverlapResolved(groups, primaryLineCandidates) {
  if (!Array.isArray(groups)) throw new Error("groups 必须是数组。");
  const items = [];
  for (let tier = 0; tier < groups.length; tier++) {
    const group = groups[tier];
    if (!Array.isArray(group)) throw new Error("group 必须是数组。");
    for (const item of group) {
      if (!item || !Array.isArray(item.cells) || typeof item.lineKey !== "string") {
        throw new Error("二级候选格式非法。");
      }
      items.push({
        cells: cellSetFromKeys(item.cells),
        lineKey: item.lineKey,
        tier
      });
    }
  }

  let secondaryItems = items;
  if (primaryLineCandidates && primaryLineCandidates.length > 0) {
    const primarySets = primaryLineCandidates.map((p) => ({
      lineKey: p.lineKey,
      cells: cellSetFromKeys(p.cells)
    }));
    secondaryItems = items.filter((cand) => {
      for (const p of primarySets) {
        if (cand.lineKey !== p.lineKey) continue;
        if (stonesOverlap(cand.cells, p.cells)) return false;
      }
      return true;
    });
  }

  secondaryItems.sort((a, b) => {
    const ds = b.cells.size - a.cells.size;
    if (ds !== 0) return ds;
    return a.tier - b.tier;
  });
  const kept = [];
  for (const cand of secondaryItems) {
    let skip = false;
    for (const k of kept) {
      if (cand.lineKey !== k.lineKey) continue;
      if (stonesOverlap(cand.cells, k.cells)) {
        skip = true;
        break;
      }
    }
    if (!skip) kept.push(cand);
  }
  return kept.length;
}

function analyzeLines(board, player) {
  assertBoard(board);
  assertPlayer(player);
  const n = board.length;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const enemy = player === 1 ? 2 : 1;

  let primary = 0;
  let secondary = 0;
  const liveSegments = [];
  const deadSegments = [];
  const fullDeadSegments = [];
  const deadFourCandidates = [];
  const liveThreeCandidates = [];
  /** 一级警报对应的直线与棋子集合，供二级与一级「同线不共用棋子」过滤 */
  const primaryLinePatternCandidates = [];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== player) continue;

      for (const [dr, dc] of dirs) {
        const pr = r - dr;
        const pc = c - dc;
        if (inBounds(pr, pc, n) && board[pr][pc] === player) continue;

        let len = 0;
        let er = r;
        let ec = c;
        while (inBounds(er, ec, n) && board[er][ec] === player) {
          len++;
          er += dr;
          ec += dc;
        }

        const end1 = { row: r - dr, col: c - dc };
        const end2 = { row: er, col: ec };
        const open1 = isPlayable(board, end1.row, end1.col);
        const open2 = isPlayable(board, end2.row, end2.col);
        const openCount = (open1 ? 1 : 0) + (open2 ? 1 : 0);
        let backSpace = 0;
        let br = r - dr;
        let bc = c - dc;
        while (inBounds(br, bc, n) && board[br][bc] !== enemy) {
          backSpace++;
          br -= dr;
          bc -= dc;
        }
        let frontSpace = 0;
        let fr = er;
        let fc = ec;
        while (inBounds(fr, fc, n) && board[fr][fc] !== enemy) {
          frontSpace++;
          fr += dr;
          fc += dc;
        }
        const maxPossibleLen = len + backSpace + frontSpace;

        const segment = { length: len, start: { row: r, col: c }, end1, end2 };
        if (maxPossibleLen < 5) {
          // 两端向外延申到敌子/边界后，可形成的总长度仍小于 5，等价于全死线。
          fullDeadSegments.push(segment);
          continue;
        }

        if (openCount === 2) liveSegments.push(segment);
        else if (openCount === 1) deadSegments.push(segment);
        else fullDeadSegments.push(segment);

        if (openCount === 0) continue; // 全死不处理

        const lk = lineKeyFromCellAndDir(r, c, dr, dc);
        if (len >= 5) {
          primary++;
          primaryLinePatternCandidates.push({
            cells: buildSegmentCellKeys({ row: r, col: c }, dr, dc, len),
            lineKey: lk
          });
        }
        if (len === 4 && openCount === 2) {
          primary++;
          primaryLinePatternCandidates.push({
            cells: buildSegmentCellKeys({ row: r, col: c }, dr, dc, len),
            lineKey: lk
          });
        }
        if (len === 3 && openCount === 2) {
          liveThreeCandidates.push({
            cells: buildSegmentCellKeys({ row: r, col: c }, dr, dc, len),
            lineKey: lk
          });
        }
        if (len === 4 && openCount === 1) {
          deadFourCandidates.push({
            cells: buildSegmentCellKeys({ row: r, col: c }, dr, dc, len),
            lineKey: lk
          });
        }
      }
    }
  }

  // 二级警报：同一直线上若公用棋子则去重，保留点数更多（同点保留更高优先级类型）
  const brokenFourCandidates = collectBrokenFourPatterns(board, player);
  const openTwoPlusOneCandidates = collectOpenTwoPlusOpenOne(board, player);
  secondary += countSecondarySameLineOverlapResolved(
    [
      brokenFourCandidates,
      deadFourCandidates,
      liveThreeCandidates,
      openTwoPlusOneCandidates
    ],
    primaryLinePatternCandidates
  );

  return {
    primary,
    secondary,
    live_segments: liveSegments,
    dead_segments: deadSegments,
    full_dead_segments: fullDeadSegments
  };
}

function collectOpenTwoPlusOpenOne(board, player) {
  assertBoard(board);
  assertPlayer(player);
  const n = board.length;
  const empty = CELL_EMPTY;

  const patterns = [];

  function scanLine(startR, startC, dr, dc) {
    const line = [];
    const coords = [];
    let r = startR;
    let c = startC;
    while (inBounds(r, c, n)) {
      line.push(board[r][c]);
      coords.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    if (line.length < 6) return;

    for (let i = 0; i <= line.length - 6; i++) {
      const a = line[i];
      const b = line[i + 1];
      const c1 = line[i + 2];
      const d = line[i + 3];
      const e = line[i + 4];
      const f = line[i + 5];

      // .XX.X.
      const p1 = a === empty && b === player && c1 === player && d === empty && e === player && f === empty;
      // .X.XX.
      const p2 = a === empty && b === player && c1 === empty && d === player && e === player && f === empty;
      if (p1 || p2) {
        const cells = [i + 1, i + 2, i + 3, i + 4]
          .filter((idx) => line[idx] === player)
          .map((idx) => makeCellKey(coords[idx].row, coords[idx].col));
        const lineKey = lineKeyFromCellAndDir(coords[i + 1].row, coords[i + 1].col, dr, dc);
        patterns.push({ cells, lineKey });
      }
    }
  }

  // 横向
  for (let r = 0; r < n; r++) {
    scanLine(r, 0, 0, 1);
  }
  // 纵向
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, 0);
  }
  // 主对角
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, 1);
  }
  for (let r = 1; r < n; r++) {
    scanLine(r, 0, 1, 1);
  }
  // 副对角
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, -1);
  }
  for (let r = 1; r < n; r++) {
    scanLine(r, n - 1, 1, -1);
  }

  return patterns;
}

function collectBrokenFourPatterns(board, player) {
  assertBoard(board);
  assertPlayer(player);
  const n = board.length;
  const empty = CELL_EMPTY;

  const patterns = [];

  function scanLine(startR, startC, dr, dc) {
    const line = [];
    const coords = [];
    let r = startR;
    let c = startC;
    while (inBounds(r, c, n)) {
      line.push(board[r][c]);
      coords.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    if (line.length < 5) return;

    for (let i = 0; i <= line.length - 5; i++) {
      const a = line[i];
      const b = line[i + 1];
      const c1 = line[i + 2];
      const d = line[i + 3];
      const e = line[i + 4];

      const p1 = a === player && b === player && c1 === empty && d === player && e === player; // XX.XX
      const p2 = a === player && b === empty && c1 === player && d === player && e === player; // X.XXX
      const p3 = a === player && b === player && c1 === player && d === empty && e === player; // XXX.X
      if (p1 || p2 || p3) {
        const stoneIdx = [i, i + 1, i + 2, i + 3, i + 4].filter((idx) => line[idx] === player);
        const cells = stoneIdx.map((idx) => makeCellKey(coords[idx].row, coords[idx].col));
        const lineKey = lineKeyFromCellAndDir(coords[stoneIdx[0]].row, coords[stoneIdx[0]].col, dr, dc);
        patterns.push({ cells, lineKey });
      }
    }
  }

  // 横向
  for (let r = 0; r < n; r++) {
    scanLine(r, 0, 0, 1);
  }
  // 纵向
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, 0);
  }
  // 主对角
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, 1);
  }
  for (let r = 1; r < n; r++) {
    scanLine(r, 0, 1, 1);
  }
  // 副对角
  for (let c = 0; c < n; c++) {
    scanLine(0, c, 1, -1);
  }
  for (let r = 1; r < n; r++) {
    scanLine(r, n - 1, 1, -1);
  }

  return patterns;
}

function countWarnings(board, player) {
  const x = analyzeLines(board, player);
  return { primary: x.primary, secondary: x.secondary };
}

/**
 * 对手「连线指数」：二级警报*4 + 死三*2 + 活2*2 + 活1 + 死2
 * 基于 analyzeLines 的 live/dead 线段长度分类计数。
 */
function opponentConnectionIndex(board, opponent) {
  const x = analyzeLines(board, opponent);
  let live1 = 0;
  let live2 = 0;
  let dead2 = 0;
  let dead3 = 0;
  for (const seg of x.live_segments) {
    if (seg.length === 1) live1++;
    else if (seg.length === 2) live2++;
  }
  for (const seg of x.dead_segments) {
    if (seg.length === 2) dead2++;
    else if (seg.length === 3) dead3++;
  }
  return x.secondary * 4 + dead3 * 2 + live2 * 2 + live1 + dead2;
}

/** 在所有可下点中选一手，使对手连线指数下降最多；若无任何下降则返回 null。 */
function findMoveToMaxReduceOpponentConnectionIndex(board, selfPlayer, opponent) {
  assertBoard(board);
  assertPlayer(selfPlayer);
  assertPlayer(opponent);
  const baseline = opponentConnectionIndex(board, opponent);
  const moves = getShuffledAvailableMoves(board);
  let bestMove = null;
  let bestReduction = 0;
  for (const mv of moves) {
    const copy = deepCopyBoard(board);
    placeStone(copy, mv.row, mv.col, selfPlayer);
    const after = opponentConnectionIndex(copy, opponent);
    const reduction = baseline - after;
    if (reduction > bestReduction) {
      bestReduction = reduction;
      bestMove = mv;
    }
  }
  return bestReduction > 0 ? bestMove : null;
}

function findMoveByWarning(board, player, warningKey, threshold) {
  if (warningKey !== "primary" && warningKey !== "secondary") {
    throw new Error("warningKey 只能是 primary 或 secondary。");
  }
  const baseline = countWarnings(board, player);
  const moves = getShuffledAvailableMoves(board);
  for (const mv of moves) {
    const copy = deepCopyBoard(board);
    placeStone(copy, mv.row, mv.col, player);
    const warnings = countWarnings(copy, player);
    if (warnings[warningKey]-baseline[warningKey] > threshold && warnings[warningKey] > baseline[warningKey]) {
      return mv;
    }
  }
  return null;
}

function findMoveToReduceOpponentWarning(board, selfPlayer, opponent, warningKey) {
  if (warningKey !== "primary" && warningKey !== "secondary") {
    throw new Error("warningKey 只能是 primary 或 secondary。");
  }
  const baseline = countWarnings(board, opponent);
  const baseVal = baseline[warningKey];
  const moves = getShuffledAvailableMoves(board);
  let bestMove = null;
  let bestReduction = 0;
  for (const mv of moves) {
    const copy = deepCopyBoard(board);
    placeStone(copy, mv.row, mv.col, selfPlayer);
    const after = countWarnings(copy, opponent);
    const reduction = baseVal - after[warningKey];
    if (reduction > bestReduction) {
      bestReduction = reduction;
      bestMove = mv;
    }
  }
  return bestMove;
}

function findWinningMove(board, player) {
  const moves = getShuffledAvailableMoves(board);
  for (const mv of moves) {
    const copy = deepCopyBoard(board);
    placeStone(copy, mv.row, mv.col, player);
    if (hasWinner(copy, player)) return mv;
  }
  return null;
}

function hasAnyWinningMoveOneStep(board, player) {
  return findWinningMove(board, player) !== null;
}

function findSetupMoveForNextWarning(board, player, warningKey, threshold) {
  if (warningKey !== "primary" && warningKey !== "secondary") {
    throw new Error("warningKey 只能是 primary 或 secondary。");
  }
  const movesA = getShuffledAvailableMoves(board);
  for (const a of movesA) {
    const boardA = deepCopyBoard(board);
    placeStone(boardA, a.row, a.col, player);
    const baselineA = countWarnings(boardA, player);

    const movesB = sortEmptyMovesByChebyshevFrom(boardA, a);
    for (const b of movesB) {
      if (chebyshevDistance(a, b) > MAX_B_CHEBYSHEV_FROM_A) break;
      const boardB = deepCopyBoard(boardA);
      placeStone(boardB, b.row, b.col, player);
      const warningsB = countWarnings(boardB, player);
      if (warningsB[warningKey]-baselineA[warningKey] > threshold && warningsB[warningKey] > baselineA[warningKey]) {
        return a;
      }
    }
  }
  return null;
}

function findForkSetupMove(board, player) {
  // 先计算初始状态下，有多少个位置落子后能增加 2 个威胁
  let initialThreatCount = 0;
  const initialMoves = getShuffledAvailableMoves(board);
  const initialWarnings = countWarnings(board, player);
  const initialSecondary = initialWarnings.secondary;

  for (const testMove of initialMoves) {
    const testBoard = deepCopyBoard(board);
    placeStone(testBoard, testMove.row, testMove.col, player);
    const afterWarnings = countWarnings(testBoard, player);
    if (afterWarnings.secondary - initialSecondary > 1) {
      initialThreatCount++;
    }
  }

  const movesA = getShuffledAvailableMoves(board);
  for (const a of movesA) {
    const boardA = deepCopyBoard(board);
    placeStone(boardA, a.row, a.col, player);

    const afterAWarnings = countWarnings(boardA, player);
    const origin = afterAWarnings.secondary;

    const movesB = sortEmptyMovesByChebyshevFrom(boardA, a);
    const validBList = [];  // 存储有效的B位置
    
    // 逐个测试B位置，每找到一个就和之前的所有有效B配对测试
    for (const b of movesB) {
      if (chebyshevDistance(a, b) > MAX_B_CHEBYSHEV_FROM_A) break;
      // 先检查b本身是否能增加2个以上威胁
      const boardB = deepCopyBoard(boardA);
      placeStone(boardB, b.row, b.col, player);
      const w = countWarnings(boardB, player);
      if (w.secondary - origin <= 1) {
        continue;  // b本身不能形成威胁，跳过
      }
      
      // b本身有效，现在测试与之前所有有效B的配对
      let foundValidPair = false;
      
      for (const existingB of validBList) {
        // 测试场景1：下A和existingB，将b当作敌方棋子占据
        const testBoard1 = deepCopyBoard(board);
        placeStone(testBoard1, a.row, a.col, player);
        placeStone(testBoard1, existingB.row, existingB.col, player);
        placeStone(testBoard1, b.row, b.col, getOpponent(player));
        
        const afterExistingWarnings = countWarnings(testBoard1, player);
        const originForExisting = (() => {
          const temp = deepCopyBoard(board);
          placeStone(temp, a.row, a.col, player);
          return countWarnings(temp, player).secondary;
        })();
        
        const existingValid = afterExistingWarnings.secondary - originForExisting > 1;
        
        // 测试场景2：下A和b，将existingB当作敌方棋子占据
        const testBoard2 = deepCopyBoard(board);
        placeStone(testBoard2, a.row, a.col, player);
        placeStone(testBoard2, b.row, b.col, player);
        placeStone(testBoard2, existingB.row, existingB.col, getOpponent(player));
        
        const afterBWarnings = countWarnings(testBoard2, player);
        const originForB = (() => {
          const temp = deepCopyBoard(board);
          placeStone(temp, a.row, a.col, player);
          return countWarnings(temp, player).secondary;
        })();
        
        const bValid = afterBWarnings.secondary - originForB > 1;
        
        // 如果两个方向都有效，找到有效配对
        if (existingValid && bValid) {
          foundValidPair = true;
          break;
        }
      }
      
      if (foundValidPair) {
        // 找到有效配对，返回A位置
        return a;
      }
      
      // 没有找到有效配对，但b本身有效，加入列表供后续配对
      validBList.push(b);
    }
  }
  return null;
}
/**
 * 二级铺垫点：player 占 A 后二级警报增加，且存在 B，在“A 已下”时于 B 落子可造成
 * （二级警报一次增加超过 1）或（一级警报），但若没有 A，单独在 B 落子达不到同等威胁。
 * 预计算空位 B 的「仅下 B」警报增量，再枚举 A 与后续 B。
 */
function findSecondarySetupThreatPoint(board, player) {
  assertBoard(board);
  assertPlayer(player);

  const baseline = countWarnings(board, player);
  const soloByKey = new Map();
  const emptyMoves = getAvailableMoves(board);
  for (const cell of emptyMoves) {
    const key = makeCellKey(cell.row, cell.col);
    const soloBoard = deepCopyBoard(board);
    placeStone(soloBoard, cell.row, cell.col, player);
    const w = countWarnings(soloBoard, player);
    soloByKey.set(key, {
      dPri: w.primary - baseline.primary,
      dSec: w.secondary - baseline.secondary
    });
  }
  function soloAlreadyDangerous(key) {
    const o = soloByKey.get(key);
    if (!o) return false;
    return (o.dSec > 1 || o.dPri > 0) && o.dSec>=0 && o.dPri>=0;
  }

  const movesA = getShuffledAvailableMoves(board);
  for (const a of movesA) {
    const boardA = deepCopyBoard(board);
    placeStone(boardA, a.row, a.col, player);
    const baselineA = countWarnings(boardA, player);
    if (baselineA.secondary - baseline.secondary <= 0) continue;

    const movesB = sortEmptyMovesByChebyshevFrom(boardA, a);
    for (const b of movesB) {
      if (chebyshevDistance(a, b) > MAX_B_CHEBYSHEV_FROM_A) break;
      const keyB = makeCellKey(b.row, b.col);
      if (soloAlreadyDangerous(keyB)) continue;

      const boardAB = deepCopyBoard(boardA);
      placeStone(boardAB, b.row, b.col, player);
      const wAB = countWarnings(boardAB, player);
      const dPri = wAB.primary - baselineA.primary;
      const dSec = wAB.secondary - baselineA.secondary;
      if ((dSec > 1 || dPri > 0) && dSec>=0 && dPri>=0) {
        return { row: a.row, col: a.col };
      }
    }
  }
  return null;
}

/** 防守：对手二级铺垫点（逻辑同 findSecondarySetupThreatPoint(opponent)） */
function findDefendOpponentSecondarySetupPoint(board, opponent) {
  return findSecondarySetupThreatPoint(board, opponent);
}

function getOpponent(player) {
  return player === 1 ? 2 : 1;
}

function extendRandomLiveLine(board, player) {
  const analysis = analyzeLines(board, player);
  const segs = analysis.live_segments.slice();
  if (segs.length === 0) return null;
  shuffleInPlace(segs);
  for (const seg of segs) {
    const candidates = [];
    if (isPlayable(board, seg.end1.row, seg.end1.col)) candidates.push(seg.end1);
    if (isPlayable(board, seg.end2.row, seg.end2.col)) candidates.push(seg.end2);
    if (candidates.length > 0) {
      shuffleInPlace(candidates);
      return { row: candidates[0].row, col: candidates[0].col };
    }
  }
  return null;
}

function extendRandomDeadLine(board, player) {
  const analysis = analyzeLines(board, player);
  const segs = analysis.dead_segments.slice();
  if (segs.length === 0) return null;
  shuffleInPlace(segs);
  for (const seg of segs) {
    const e1 = isPlayable(board, seg.end1.row, seg.end1.col);
    const e2 = isPlayable(board, seg.end2.row, seg.end2.col);
    if ((e1 && !e2) || (!e1 && e2)) {
      return e1
        ? { row: seg.end1.row, col: seg.end1.col }
        : { row: seg.end2.row, col: seg.end2.col };
    }
  }
  return null;
}

function garbageMove(board) {
  const moves = getAvailableMoves(board);
  if (moves.length === 0) throw new Error("棋盘已满，无法垃圾落子。");
  const mode = Math.random() < 0.5 ? 1 : 2;
  if (mode === 1) {
    moves.sort((a, b) => (a.row - b.row) || (a.col - b.col));
    return moves[moves.length - 1];
  }
  shuffleInPlace(moves);
  return moves[0];
}

function moveWithOpponentInNeighborhood(board, opponent) {
  assertBoard(board);
  assertPlayer(opponent);
  const n = board.length;
  const dirs8 = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  const moves = getShuffledAvailableMoves(board);
  for (const mv of moves) {
    for (const [dr, dc] of dirs8) {
      const rr = mv.row + dr;
      const cc = mv.col + dc;
      if (inBounds(rr, cc, n) && board[rr][cc] === opponent) {
        return mv;
      }
    }
  }
  return null;
}

function centerMove(board) {
  assertBoard(board);
  const n = board.length;
  if (n % 2 === 1) {
    const mid = Math.floor(n / 2);
    return isPlayable(board, mid, mid) ? { row: mid, col: mid } : null;
  }

  // 偶数边长时中心有 2x2 区域，随机尝试其中可下位置。
  const m = n / 2;
  const candidates = [
    { row: m - 1, col: m - 1 },
    { row: m - 1, col: m },
    { row: m, col: m - 1 },
    { row: m, col: m }
  ];
  shuffleInPlace(candidates);
  for (const p of candidates) {
    if (isPlayable(board, p.row, p.col)) return p;
  }
  return null;
}

function chooseAiMove(board, ai, opponent) {
  assertBoard(board);
  assertPlayer(ai);
  assertPlayer(opponent);
  if (ai === opponent) throw new Error("AI 与对手标记不能相同。");
  if (getAvailableMoves(board).length === 0) throw new Error("棋盘已满。");

  // 1) 若本手可直接获胜，则立即获胜
  let move = findWinningMove(board, ai);
  if (move) return { ...move, reason: "先手策略：本手直接获胜" };
  console.log("先手策略：本手直接获胜");
  // 2) 若对手存在一步致胜点，优先封堵该点
  move = findWinningMove(board, opponent);
  if (move) return { ...move, reason: "先手策略：封堵对手一步致胜点" };
  console.log("先手策略：封堵对手一步致胜点");
  // 3) 若对手无一步致胜点，优先主动制造一级警报
  if (!hasAnyWinningMoveOneStep(board, opponent)) {
    move = findMoveByWarning(board, ai, "primary", 0);
    if (move) return { ...move, reason: "先手策略：对手无一步致胜，主动制造一级警报" };
  }
  console.log("先手策略：对手无一步致胜，主动制造一级警报");
  // 4) 防守一级警报
  move = findMoveByWarning(board, opponent, "primary", 0);
  console.log("防守：拦截对手一级警报");
  if (move) return { ...move, reason: "防守：拦截对手一级警报" };
  // 5) 防守补充：若可降低对手一级警报，则落子
  move = findMoveToReduceOpponentWarning(board, ai, opponent, "primary");
  console.log("防守：降低对手一级警报");
  if (move) return { ...move, reason: "防守：降低对手一级警报" };
  // 6) 防守二级警报
  move = findMoveByWarning(board, opponent, "secondary", 1);
  console.log("防守：拦截对手二级警报");
  if (move) return { ...move, reason: "防守：拦截对手二级警报" };
  // 7) 防守补充：若可降低对手二级警报，则落子
  move = findMoveToReduceOpponentWarning(board, ai, opponent, "secondary");
  console.log("防守：降低对手二级警报");
  if (move) return { ...move, reason: "防守：降低对手二级警报" };
  // 7.5) 防守：对手二级铺垫点（A 制造二级，某 B 在 A 后才成双重二级或一级；仅下 B 时达不到）
  move = findDefendOpponentSecondarySetupPoint(board, opponent);
  console.log("防守：封堵对手二级铺垫点");
  if (move) return { ...move, reason: "防守：封堵对手二级铺垫点" };
  // 8) 防守二级双威胁预判
  move = findForkSetupMove(board, opponent);
  console.log("防守：拦截对手二级双威胁起手");
  if (move) return { ...move, reason: "防守：拦截对手二级双威胁起手" };
  // 9) 进攻二级警报
  move = findMoveByWarning(board, ai, "secondary", 1);
  console.log("进攻：制造二级警报");
  if (move) return { ...move, reason: "进攻：制造二级警报" };
  // 10) 进攻一级警报
  move = findMoveByWarning(board, ai, "primary", 0);
  console.log("进攻：制造一级警报");
  if (move) return { ...move, reason: "进攻：制造一级警报" };
  // 10.5) 进攻：己方二级铺垫点（与 7.5 对称，A 后某 B 才成双二级或一级；仅下 B 达不到）
  move = findSecondarySetupThreatPoint(board, ai);
  console.log("进攻：抢占二级铺垫点");
  if (move) return { ...move, reason: "进攻：抢占二级铺垫点" };
  // 11) 进攻二级双威胁预判
  move = findForkSetupMove(board, ai);
  console.log("进攻：布局二级双威胁");
  if (move) return { ...move, reason: "进攻：布局二级双威胁" };
  // 12) 进攻铺垫：下一手可制造两个二级警报
  move = findSetupMoveForNextWarning(board, ai, "secondary", 1);
  console.log("进攻：铺垫下一手二级双警报");
  if (move) return { ...move, reason: "进攻：铺垫下一手二级双警报" };
  // 13) 进攻铺垫：下一手可制造一级警报
  move = findSetupMoveForNextWarning(board, ai, "primary", 0);
  console.log("进攻：铺垫下一手一级警报");
  if (move) return { ...move, reason: "进攻：铺垫下一手一级警报" };
  // 15.5) 常规：阻挡对手连线（优先最大化降低对手连线指数；若无降低则进入后续兜底）
  move = findMoveToMaxReduceOpponentConnectionIndex(board, ai, opponent);
  if(Math.random() < 0.8){
    console.log("常规：阻挡对手连线");
    if (move) return { ...move, reason: "常规：阻挡对手连线" };
  }
  // 14) 延长活连线
  move = extendRandomLiveLine(board, ai);
  console.log("常规：延长活连线");
  if (move) return { ...move, reason: "常规：延长活连线" };
  // 15) 延长死连线
  move = extendRandomDeadLine(board, ai);  
  console.log("常规：延长死连线");
  if (move) return { ...move, reason: "常规：延长死连线" };
  // 16) 垃圾前兜底：随机下在八邻域含对手棋子的空位
  move = moveWithOpponentInNeighborhood(board, opponent);
  console.log("兜底：贴近对手八邻域落子");
  if (move) return { ...move, reason: "兜底：贴近对手八邻域落子" };
  // 17) 垃圾前兜底：尝试下在棋盘中间
  move = centerMove(board);
  console.log("兜底：下在棋盘中间");
  if (move) return { ...move, reason: "兜底：下在棋盘中间" };
  // 18) 垃圾策略
  move = garbageMove(board);
  console.log("垃圾策略"); 
  return { ...move, reason: "垃圾策略" };
  
}
