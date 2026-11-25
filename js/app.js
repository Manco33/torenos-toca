/**
 * TOCA SOCIAL · TORNEO & LEADERBOARD OFICIAL (v6.0)
 * - Juegos oficiales de Toca Social (con regla estricta Toca Challenge = 100% Individual)
 * - Podio (1º, 2º, 3º) + Tabla Top 10 por juego + Pestaña Ranking General del Torneo
 * - Selector de Cabinas / Boxes participantes (Box 1 a Box 18) y Juegos participantes
 * - Botón Reiniciar Panel (marca de tiempo en vivo a cero sin borrar histórico de BD)
 * - Selector rápido en 1 clic entre Modo TV Horizontal (0°) y Modo Kiosk Tótem (270°)
 */

const SUPABASE_URL = 'https://oemqcvivlbjirewybyfe.supabase.co';
const SUPABASE_ANON = 'sb_publishable_lNTBokUMevI5a_uGPR-6iQ_k8gvKk--';

let sbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
} catch (err) {
  console.error('Error al instanciar Supabase client:', err);
}

const ALL_BOX_IDS = Array.from({ length: 18 }, (_, i) => `box-${i + 1}`);

// Catálogo exclusivo de juegos oficiales de Toca Social
const GAME_DEFS = {
  'overall': {
    name: 'RANKING GENERAL',
    shortName: 'GENERAL',
    icon: '🏆',
    descBest: 'Suma de la mejor marca de cada jugador en los juegos activos del torneo',
    descSum: 'Suma total de puntos acumulados en todos los juegos activos del torneo'
  },
  'striker': {
    name: 'STRIKER',
    shortName: 'STRIKER',
    icon: '🔺',
    desc: 'Precisión, velocidad de disparo y definición al arco'
  },
  'atom-splitter': {
    name: 'ATOM SPLITTER',
    shortName: 'ATOM SPLITTER',
    icon: '⚛️',
    desc: 'Reacción explosiva rompiendo átomos a máxima velocidad'
  },
  'zombies': {
    name: 'ZOMBIES',
    shortName: 'ZOMBIES',
    icon: '🧟',
    desc: 'Supervivencia y puntería contra oleadas de zombies'
  },
  'toca-challenge': {
    name: 'TOCA CHALLENGE',
    shortName: 'TOCA CHALLENGE',
    icon: '💀',
    desc: 'Reto oficial 100% individual de habilidad pura'
  },
  'tug-of-war': {
    name: 'TUG OF WAR',
    shortName: 'TUG OF WAR',
    icon: '⚔️',
    desc: 'Duelo de potencia y ritmo constante bajo presión'
  },
  'angry-birds': {
    name: 'ANGRY BIRDS',
    shortName: 'ANGRY BIRDS',
    icon: '🐦',
    desc: 'Demolición estratégica de estructuras con impactos certeros'
  },
  'eliminator': {
    name: 'ELIMINATOR',
    shortName: 'ELIMINATOR',
    icon: '🎯',
    desc: 'Eliminación directa de objetivos de alta precisión'
  }
};

const state = {
  displayMode: 'tv',     // 'tv' (0° Horizontal) | 'kiosk' (270° Vertical)
  showOverall: true,
  scoringMode: 'best',   // 'best' (mejor puntaje por juego) | 'sum' (suma total)
  phaseMode: 'today',    // 'today' (solo torneo actual) | 'cycle' (Torneo <-> Histórico) | 'all'
  timeFilter: 'today',   // Fase activa en este momento: 'today' | 'all'
  tournamentGames: ['striker', 'atom-splitter', 'zombies', 'toca-challenge'],
  enabledBoxes: [...ALL_BOX_IDS],
  resetAt: null,         // ISO string cuando se presiona "Reiniciar Panel"
  activeTab: 'overall',
  autoRotate: true,
  rotateIntervalSec: 14,
  rotateTimer: null,
  toastTimer: null,
  todayRows: [],
  allTimeRows: [],
  recentFeed: []
};

const $ = (id) => document.getElementById(id);

function normalizeBoxId(raw) {
  if (!raw) return 'box-1';
  const clean = String(raw).trim().toLowerCase().replace(/\s+/g, '-');
  const m = clean.match(/(\d+)/);
  return m ? `box-${parseInt(m[1], 10)}` : clean;
}

function getTournamentCutoffDate() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (state.resetAt) {
    const r = new Date(state.resetAt);
    if (!isNaN(r.getTime()) && r >= todayStart) {
      return r;
    }
  }
  return todayStart;
}

// ==============================================================================
// 1. PERSISTENCIA Y PARÁMETROS DE URL (?mode=tv | ?mode=kiosk)
// ==============================================================================
function loadSavedSettings() {
  const params = new URLSearchParams(window.location.search);
  const urlMode = params.get('mode');

  const savedMode = localStorage.getItem('toca_arena_display_mode');
  if (urlMode === 'kiosk' || urlMode === '270') {
    state.displayMode = 'kiosk';
  } else if (urlMode === 'tv' || urlMode === '0') {
    state.displayMode = 'tv';
  } else if (savedMode === 'kiosk' || savedMode === 'tv') {
    state.displayMode = savedMode;
  }

  const savedOverall = localStorage.getItem('toca_tournament_show_overall');
  if (savedOverall !== null) state.showOverall = (savedOverall === 'true');

  const savedScoring = localStorage.getItem('toca_tournament_scoring_mode');
  if (savedScoring === 'best' || savedScoring === 'sum') state.scoringMode = savedScoring;

  const savedPhase = localStorage.getItem('toca_tournament_phase_mode');
  if (savedPhase === 'cycle' || savedPhase === 'today' || savedPhase === 'all') {
    state.phaseMode = savedPhase;
  }
  state.timeFilter = (state.phaseMode === 'all') ? 'all' : 'today';

  const savedGames = localStorage.getItem('toca_tournament_games');
  if (savedGames) {
    try {
      const parsed = JSON.parse(savedGames);
      const valid = Array.isArray(parsed) ? parsed.filter(g => GAME_DEFS[g] && g !== 'overall') : [];
      if (valid.length > 0) state.tournamentGames = valid;
    } catch (_) {}
  }

  const savedBoxes = localStorage.getItem('toca_tournament_boxes');
  if (savedBoxes) {
    try {
      const parsed = JSON.parse(savedBoxes);
      const valid = Array.isArray(parsed)
        ? parsed.map(normalizeBoxId).filter(b => ALL_BOX_IDS.includes(b))
        : [];
      if (valid.length > 0) state.enabledBoxes = Array.from(new Set(valid));
    } catch (_) {}
  }

  const savedReset = localStorage.getItem('toca_tournament_reset_at');
  if (savedReset) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const rDate = new Date(savedReset);
    if (!isNaN(rDate.getTime()) && rDate >= todayStart) {
      state.resetAt = rDate.toISOString();
    } else {
      localStorage.removeItem('toca_tournament_reset_at');
    }
  }

  const savedAuto = localStorage.getItem('toca_kiosk_autorotate');
  if (savedAuto !== null) state.autoRotate = (savedAuto === 'true');

  const savedSec = localStorage.getItem('toca_kiosk_rotatesec');
  if (savedSec) state.rotateIntervalSec = Math.max(5, parseInt(savedSec, 10) || 14);

  const tabs = getEnabledTabs();
  if (!tabs.includes(state.activeTab)) {
    state.activeTab = tabs[0] || 'striker';
  }
}

function getEnabledTabs() {
  return state.showOverall ? ['overall', ...state.tournamentGames] : [...state.tournamentGames];
}

// ==============================================================================
// 2. SELECTOR DE MODO (TV 0° <-> KIOSK 270°) E INDICADORES DE BOXES / REINICIO
// ==============================================================================
function applyDisplayMode(mode) {
  state.displayMode = (mode === 'kiosk') ? 'kiosk' : 'tv';
  localStorage.setItem('toca_arena_display_mode', state.displayMode);

  const body = $('arenaBody');
  body.classList.toggle('mode-kiosk', state.displayMode === 'kiosk');
  body.classList.toggle('mode-tv', state.displayMode === 'tv');

  $('btnModeTv')?.classList.toggle('active', state.displayMode === 'tv');
  $('btnModeKiosk')?.classList.toggle('active', state.displayMode === 'kiosk');

  $('modalBtnTv')?.classList.toggle('active', state.displayMode === 'tv');
  $('modalBtnKiosk')?.classList.toggle('active', state.displayMode === 'kiosk');
}

function updateHeaderAndFooterBadges() {
  // Badge de reinicio de panel
  const resetBadge = $('resetSinceBadge');
  const resetTimeSpan = $('resetSinceTime');
  if (resetBadge && resetTimeSpan) {
    if (state.resetAt) {
      const d = new Date(state.resetAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      resetTimeSpan.textContent = `${hh}:${mm}`;
      resetBadge.style.display = 'inline-flex';
    } else {
      resetBadge.style.display = 'none';
    }
  }

  // Contador de boxes activas
  const count = state.enabledBoxes.length;
  if ($('statBoxesCount')) {
    $('statBoxesCount').textContent = `${count}/18`;
  }

  const footerLbl = $('footerBoxesLabel');
  if (footerLbl) {
    if (count === 18) {
      footerLbl.textContent = 'EN VIVO · 18 BOXES';
    } else if (count <= 5) {
      const nums = state.enabledBoxes
        .map(b => parseInt(b.replace('box-', ''), 10))
        .sort((a, b) => a - b)
        .join(', ');
      footerLbl.textContent = `EN VIVO · BOX ${nums}`;
    } else {
      footerLbl.textContent = `EN VIVO · ${count} BOXES ACTIVAS`;
    }
  }
}

// ==============================================================================
// 3. PESTAÑAS Y HERO BANNER
// ==============================================================================
function renderGameTabs() {
  const container = $('gamesNavList');
  const tabs = getEnabledTabs();

  container.innerHTML = tabs.map(tabId => {
    const def = GAME_DEFS[tabId] || { shortName: tabId.toUpperCase(), icon: '🎮' };
    const isActive = (tabId === state.activeTab);
    const extraCls = (tabId === 'overall') ? 'tab-overall' : '';
    return `
      <button class="game-tab-item ${extraCls} ${isActive ? 'active' : ''}" data-tab="${tabId}" type="button">
        <span class="tab-icon">${def.icon}</span>
        <span class="tab-name">${def.shortName || def.name}</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.game-tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      if (state.phaseMode === 'cycle') state.timeFilter = 'today';
      switchActiveTab(targetTab);
      resetAutoRotateTimer();
    });
  });

  updateHeroBanner();
}

function switchActiveTab(tabId) {
  const tabs = getEnabledTabs();
  if (!tabs.includes(tabId)) tabId = tabs[0] || 'striker';
  state.activeTab = tabId;

  document.querySelectorAll('.game-tab-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  updateHeroBanner();
  renderCurrentView();
}

function updateHeroBanner() {
  const isOverall = (state.activeTab === 'overall');
  const def = GAME_DEFS[state.activeTab] || { name: state.activeTab.toUpperCase(), icon: '🎮', desc: '' };

  $('heroGameName').textContent = def.name;
  $('heroGameIcon').textContent = def.icon;
  $('heroGameDesc').textContent = isOverall
    ? (state.scoringMode === 'best' ? def.descBest : def.descSum)
    : (def.desc || '');

  const isHistorical = (state.timeFilter === 'all');
  const subbadge = $('heroSubbadge');
  const tagContainer = $('recordsTagContainer');
  const tagLabel = $('recordsTagLabel');
  const banner = $('gameHeroBanner');
  const bar = $('indicatorBar');

  banner?.classList.toggle('is-overall', isOverall);
  banner?.classList.toggle('phase-historical', isHistorical);
  subbadge?.classList.toggle('badge-historical', isHistorical);
  tagContainer?.classList.toggle('is-historical', isHistorical);
  bar?.classList.toggle('bar-historical', isHistorical);

  if (isHistorical) {
    $('subbadgeText').textContent = isOverall ? 'RANKING HISTÓRICO GLOBAL' : 'MEJORES RÉCORDS HISTÓRICOS';
    if (tagLabel) tagLabel.textContent = 'RÉCORDS HISTÓRICOS';
  } else {
    $('subbadgeText').textContent = isOverall ? 'CLASIFICACIÓN DEL TORNEO ACTUAL' : 'LOS MEJORES DEL TORNEO ACTUAL';
    if (tagLabel) tagLabel.textContent = state.resetAt ? 'TORNEO EN CURSO' : 'TORNEO DE HOY';
  }
}

// ==============================================================================
// 4. PROCESAMIENTO DE PUNTAJES (BOXES PARTICIPANTES + REGLA TOCA CHALLENGE)
// ==============================================================================
function expandRowForRules(row) {
  const gameId = String(row.game_id || '').toLowerCase();
  const rawName = String(row.player_name || 'Jugador').trim();
  const score = Number(row.score) || 0;
  const normBox = normalizeBoxId(row.box_id);

  // REGLA CRÍTICA DE NEGOCIO: Toca Challenge NUNCA es en dúos, es por persona individual
  if (gameId === 'toca-challenge' && rawName.includes(' & ')) {
    const parts = rawName.split(' & ').map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const splitScore = Math.round(score / parts.length);
      return parts.map(pName => ({
        player_name: pName,
        game_id: gameId,
        score: splitScore,
        box_id: normBox,
        played_at: row.played_at,
        isDuo: false
      }));
    }
  }

  return [{
    player_name: rawName,
    game_id: gameId,
    score,
    box_id: normBox,
    played_at: row.played_at,
    isDuo: (gameId !== 'toca-challenge' && rawName.includes(' & '))
  }];
}

function computeStandings() {
  const isTodayPhase = (state.timeFilter === 'today');
  const sourceRows = isTodayPhase ? state.todayRows : state.allTimeRows;
  const enabledGamesSet = new Set(state.tournamentGames);
  const enabledBoxesSet = new Set(state.enabledBoxes);
  const cutoffIso = getTournamentCutoffDate().toISOString();

  // Filtrar por juego activo, boxes participantes y marca de reinicio (en fase Torneo Actual)
  const filteredRaw = sourceRows.filter(r => {
    const gid = String(r.game_id || '').toLowerCase();
    const bid = normalizeBoxId(r.box_id);

    if (state.activeTab === 'overall') {
      if (!enabledGamesSet.has(gid)) return false;
    } else if (gid !== state.activeTab) {
      return false;
    }

    // En el Torneo Actual solo participan las boxes seleccionadas y partidas posteriores al reinicio
    if (isTodayPhase) {
      if (!enabledBoxesSet.has(bid)) return false;
      if (r.played_at && r.played_at < cutoffIso) return false;
    }

    return true;
  });

  const expanded = [];
  filteredRaw.forEach(r => expanded.push(...expandRowForRules(r)));

  const totalMatches = filteredRaw.length;

  if (state.activeTab === 'overall') {
    const byPlayer = new Map();

    expanded.forEach(entry => {
      const key = entry.player_name.toLowerCase();
      if (!byPlayer.has(key)) {
        byPlayer.set(key, {
          name: entry.player_name,
          isDuo: entry.isDuo,
          box_id: entry.box_id,
          played_at: entry.played_at,
          matches: 0,
          sumScore: 0,
          bestByGame: {}
        });
      }
      const p = byPlayer.get(key);
      p.matches += 1;
      p.sumScore += entry.score;
      if (!p.bestByGame[entry.game_id] || entry.score > p.bestByGame[entry.game_id]) {
        p.bestByGame[entry.game_id] = entry.score;
      }
      if (entry.played_at && (!p.played_at || entry.played_at > p.played_at)) {
        p.played_at = entry.played_at;
        p.box_id = entry.box_id || p.box_id;
      }
    });

    const allRanked = Array.from(byPlayer.values()).map(p => {
      const gamesPlayedCount = Object.keys(p.bestByGame).length;
      const bestSum = Object.values(p.bestByGame).reduce((acc, v) => acc + v, 0);
      const finalScore = (state.scoringMode === 'best') ? bestSum : p.sumScore;
      return {
        name: p.name,
        score: finalScore,
        box_id: p.box_id,
        played_at: p.played_at,
        isDuo: p.isDuo,
        detailText: `${gamesPlayedCount}/${state.tournamentGames.length} juegos · ${p.matches} ${p.matches === 1 ? 'partida' : 'partidas'}`
      };
    }).sort((a, b) => b.score - a.score);

    return {
      totalMatches,
      totalPlayers: allRanked.length,
      top10: allRanked.slice(0, 10)
    };
  }

  // Juego oficial específico
  const byPlayer = new Map();
  expanded.forEach(entry => {
    const key = entry.player_name.toLowerCase();
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        name: entry.player_name,
        isDuo: entry.isDuo,
        box_id: entry.box_id,
        played_at: entry.played_at,
        bestScore: entry.score,
        sumScore: 0,
        matches: 0
      });
    }
    const p = byPlayer.get(key);
    p.matches += 1;
    p.sumScore += entry.score;
    if (entry.score >= p.bestScore) {
      p.bestScore = entry.score;
      p.box_id = entry.box_id || p.box_id;
      p.played_at = entry.played_at || p.played_at;
    }
  });

  const allRanked = Array.from(byPlayer.values()).map(p => {
    const finalScore = (state.scoringMode === 'best') ? p.bestScore : p.sumScore;
    const dateStr = formatShortDate(p.played_at);
    return {
      name: p.name,
      score: finalScore,
      box_id: p.box_id,
      played_at: p.played_at,
      isDuo: p.isDuo,
      detailText: `${dateStr} · ${p.matches} ${p.matches === 1 ? 'partida' : 'partidas'}`
    };
  }).sort((a, b) => b.score - a.score);

  return {
    totalMatches,
    totalPlayers: allRanked.length,
    top10: allRanked.slice(0, 10)
  };
}

// ==============================================================================
// 5. RENDERIZADO DEL PODIO (1º, 2º, 3º) Y TABLA TOP 10
// ==============================================================================
function renderCurrentView() {
  updateHeaderAndFooterBadges();
  const { totalMatches, totalPlayers, top10 } = computeStandings();

  $('statMatchesCount').textContent = totalMatches.toLocaleString();
  $('statPlayersCount').textContent = totalPlayers.toLocaleString();

  renderPodium(top10);
  renderLeaderboardRows(top10);
}

function renderPodium(ranked) {
  const container = $('podiumContainer');
  if (!ranked || ranked.length === 0) {
    const def = GAME_DEFS[state.activeTab] || { name: state.activeTab.toUpperCase() };
    container.innerHTML = `
      <div class="podium-empty">
        <div style="font-size:2.2rem;margin-bottom:8px;">🏆</div>
        <div>El podio de <strong>${escapeHtml(def.name)}</strong> está listo para recibir nuevos puntajes.</div>
      </div>
    `;
    return;
  }

  const slots = [
    { pos: 2, icon: '🥈', item: ranked[1] || null },
    { pos: 1, icon: '👑', item: ranked[0] || null },
    { pos: 3, icon: '🥉', item: ranked[2] || null }
  ];

  container.innerHTML = slots.map(slot => {
    if (!slot.item) {
      return `
        <div class="podium-slot place-${slot.pos}" style="opacity:0.38;">
          <div class="podium-player-card">
            <div class="podium-crown">${slot.icon}</div>
            <div class="podium-name">Disponible</div>
            <div class="podium-meta">--</div>
          </div>
          <div class="podium-pedestal">
            <div class="pedestal-rank">${slot.pos}º</div>
            <div class="pedestal-score">--<span class="pedestal-pts-unit">PTS</span></div>
          </div>
        </div>
      `;
    }

    const boxLabel = formatBoxLabel(slot.item.box_id);
    const scoreStr = Number(slot.item.score).toLocaleString();

    return `
      <div class="podium-slot place-${slot.pos}">
        <div class="podium-player-card">
          <div class="podium-crown">${slot.icon}</div>
          <div class="podium-name" title="${escapeHtml(slot.item.name)}">${escapeHtml(slot.item.name)}</div>
          <div class="podium-meta">${escapeHtml(boxLabel)}</div>
        </div>
        <div class="podium-pedestal">
          <div class="pedestal-rank">${slot.pos}º</div>
          <div class="pedestal-score">
            ${scoreStr}
            <span class="pedestal-pts-unit">PTS</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLeaderboardRows(ranked) {
  const tbody = $('leaderboardRows');

  if (!ranked || ranked.length === 0) {
    const def = GAME_DEFS[state.activeTab] || { name: state.activeTab.toUpperCase() };
    const boxNote = state.enabledBoxes.length === 18
      ? 'las 18 cabinas'
      : `las ${state.enabledBoxes.length} cabinas participantes`;

    const msg = (state.timeFilter === 'today')
      ? `Sin partidas registradas aún en <strong>${escapeHtml(def.name)}</strong>.<br><span style="color:var(--neon-cyan);font-size:0.88rem;margin-top:6px;display:inline-block;">⚡ Esperando tiros en ${boxNote}...</span>`
      : `Sin registros históricos disponibles para <strong>${escapeHtml(def.name)}</strong>.`;

    tbody.innerHTML = `<tr><td colspan="4" class="empty-kiosk">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = ranked.map((item, idx) => {
    const pos = idx + 1;
    const rankClass = pos <= 3 ? `rank-${pos}` : 'rank-rest';
    const scoreStr = Number(item.score).toLocaleString();
    const boxLabel = formatBoxLabel(item.box_id);

    return `
      <tr class="kiosk-row ${rankClass}">
        <td class="cell-pos">
          <div class="cell-pos-box">${pos}</div>
        </td>
        <td class="cell-player">
          <div class="cell-player-name" title="${escapeHtml(item.name)}">
            ${item.isDuo ? '<span class="duo-icon-tag">👥 DÚO</span>' : ''}
            <span>${escapeHtml(item.name)}</span>
          </div>
        </td>
        <td class="cell-box">
          <div class="cell-box-info">
            <span class="box-pill">${escapeHtml(boxLabel)}</span>
            <span class="cell-submeta">${escapeHtml(item.detailText || '')}</span>
          </div>
        </td>
        <td class="cell-points">
          <span class="cell-score-num">${scoreStr}</span>
          <span class="cell-score-pts">PTS</span>
        </td>
      </tr>
    `;
  }).join('');
}

// ==============================================================================
// 6. SINCRONIZACIÓN CON SUPABASE (FILTRADO DESDE EL REINICIO Y BOXES ACTIVAS)
// ==============================================================================
async function fetchScoresFromSupabase() {
  if (!sbClient) return;

  try {
    const cutoffIso = getTournamentCutoffDate().toISOString();
    const officialGameIds = Object.keys(GAME_DEFS).filter(k => k !== 'overall');

    const [todayRes, allRes] = await Promise.all([
      sbClient
        .from('match_scores')
        .select('player_name, game_id, score, played_at, box_id')
        .in('game_id', officialGameIds)
        .gte('played_at', cutoffIso)
        .order('played_at', { ascending: false })
        .limit(1000),
      sbClient
        .from('match_scores')
        .select('player_name, game_id, score, played_at, box_id')
        .in('game_id', officialGameIds)
        .order('score', { ascending: false })
        .limit(1000)
    ]);

    if (!todayRes.error && Array.isArray(todayRes.data)) {
      state.todayRows = todayRes.data;
    }
    if (!allRes.error && Array.isArray(allRes.data)) {
      state.allTimeRows = allRes.data;
    }

    const enabledBoxesSet = new Set(state.enabledBoxes);
    const enabledGamesSet = new Set(state.tournamentGames);
    const validTodayForTicker = state.todayRows.filter(r =>
      enabledBoxesSet.has(normalizeBoxId(r.box_id)) &&
      enabledGamesSet.has(String(r.game_id || '').toLowerCase())
    );

    if (validTodayForTicker.length > 0) {
      state.recentFeed = validTodayForTicker.slice(0, 6).map(formatTickerEntry);
      refreshTickerText();
    }

    renderCurrentView();
  } catch (err) {
    console.error('Error sincronizando puntajes desde Supabase:', err);
  }
}

function initRealtime() {
  if (!sbClient) return;
  try {
    sbClient
      .channel('toca-tournament-live-v6')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_scores' }, payload => {
        const row = payload.new;
        if (!row) return;
        const gid = String(row.game_id || '').toLowerCase();
        if (!GAME_DEFS[gid]) return;

        const normBox = normalizeBoxId(row.box_id);
        state.allTimeRows.push(row);

        const cutoffIso = getTournamentCutoffDate().toISOString();
        if (!row.played_at || row.played_at >= cutoffIso) {
          state.todayRows.unshift(row);
        }

        // Solo lanzar alerta eSports y ticker si proviene de una Box y Juego participante
        if (state.enabledBoxes.includes(normBox) && state.tournamentGames.includes(gid)) {
          const feedItem = formatTickerEntry(row);
          state.recentFeed.unshift(feedItem);
          if (state.recentFeed.length > 6) state.recentFeed.pop();
          refreshTickerText();
          showLiveToast(row);
        }

        renderCurrentView();
      })
      .subscribe();
  } catch (err) {
    console.error('Error suscribiendo a Supabase Realtime:', err);
  }
}

function formatTickerEntry(row) {
  const gid = String(row.game_id || '').toLowerCase();
  const gName = GAME_DEFS[gid] ? GAME_DEFS[gid].shortName : gid.toUpperCase();
  const box = formatBoxLabel(row.box_id);
  return `⚡ ${row.player_name} marcó ${Number(row.score || 0).toLocaleString()} PTS en ${gName} (${box})`;
}

function refreshTickerText() {
  if (state.recentFeed.length > 0) {
    $('tickerText').textContent = state.recentFeed.join('   ·   ');
  }
}

function showLiveToast(row) {
  const toast = $('liveShotToast');
  if (!toast) return;
  const gid = String(row.game_id || '').toLowerCase();
  const gName = GAME_DEFS[gid] ? GAME_DEFS[gid].shortName : gid.toUpperCase();
  const box = formatBoxLabel(row.box_id);

  $('toastPlayerName').textContent = row.player_name || 'JUGADOR';
  $('toastGameInfo').textContent = `${gName} · ${box}`;
  $('toastScoreVal').textContent = `${Number(row.score || 0).toLocaleString()} PTS`;

  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

// ==============================================================================
// 7. ROTACIÓN AUTOMÁTICA DE PESTAÑAS Y FASES
// ==============================================================================
function triggerProgressBar(durationSec) {
  const bar = $('indicatorBar');
  if (!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth;
  bar.style.transition = `width ${durationSec}s linear`;
  bar.style.width = '100%';
}

function advanceRotationStep() {
  const tabs = getEnabledTabs();
  if (tabs.length === 0) return;

  if (state.phaseMode === 'cycle' && state.activeTab !== 'overall' && state.timeFilter === 'today') {
    state.timeFilter = 'all';
    updateHeroBanner();
    renderCurrentView();
    triggerProgressBar(state.rotateIntervalSec);
    return;
  }

  state.timeFilter = (state.phaseMode === 'all') ? 'all' : 'today';
  const idx = tabs.indexOf(state.activeTab);
  const nextTab = tabs[(idx + 1) % tabs.length];
  switchActiveTab(nextTab);
  triggerProgressBar(state.rotateIntervalSec);
}

function startAutoRotate() {
  clearInterval(state.rotateTimer);
  const bar = $('indicatorBar');
  if (!state.autoRotate) {
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '100%';
    }
    return;
  }

  triggerProgressBar(state.rotateIntervalSec);
  state.rotateTimer = setInterval(advanceRotationStep, state.rotateIntervalSec * 1000);
}

function resetAutoRotateTimer() {
  if (state.autoRotate) startAutoRotate();
}

// ==============================================================================
// 8. BOTÓN REINICIAR PANEL, RELOJ Y MODAL DE CONFIGURACIÓN (BOXES + JUEGOS)
// ==============================================================================
function startNeonClock() {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    $('clockTime').textContent = `${h}:${m}:${s}`;
    $('clockDate').textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
  tick();
  setInterval(tick, 1000);
}

function initResetPanelModal() {
  const resetModal = $('resetConfirmModal');
  const statusEl = $('resetModalStatus');

  function openResetModal() {
    if (state.resetAt) {
      const d = new Date(state.resetAt);
      const tStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      statusEl.textContent = `Estado actual: Panel reiniciado hoy a las ${tStr}.`;
    } else {
      statusEl.textContent = 'Estado actual: Mostrando todas las partidas de hoy desde las 00:00.';
    }
    resetModal.classList.add('open');
  }

  $('btnResetPanel')?.addEventListener('click', openResetModal);
  $('btnCloseResetModal')?.addEventListener('click', () => resetModal.classList.remove('open'));
  $('btnCancelReset')?.addEventListener('click', () => resetModal.classList.remove('open'));

  $('btnConfirmResetNow')?.addEventListener('click', () => {
    const now = new Date();
    state.resetAt = now.toISOString();
    localStorage.setItem('toca_tournament_reset_at', state.resetAt);

    // Forzar vista de Torneo Actual en cero
    if (state.phaseMode === 'all') {
      state.phaseMode = 'today';
      localStorage.setItem('toca_tournament_phase_mode', 'today');
    }
    state.timeFilter = 'today';
    state.todayRows = [];
    state.recentFeed = [];

    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    $('tickerText').textContent = `🔄 Panel reiniciado a cero a las ${hh}:${mm}:${ss} · Esperando nuevas partidas del torneo...`;

    resetModal.classList.remove('open');
    updateHeroBanner();
    renderCurrentView();
    fetchScoresFromSupabase();
    resetAutoRotateTimer();
  });

  $('btnRestoreFullDay')?.addEventListener('click', () => {
    state.resetAt = null;
    localStorage.removeItem('toca_tournament_reset_at');
    state.timeFilter = 'today';
    $('tickerText').textContent = '📅 Mostrando nuevamente todas las partidas registradas hoy desde las 00:00...';

    resetModal.classList.remove('open');
    updateHeroBanner();
    fetchScoresFromSupabase();
    resetAutoRotateTimer();
  });
}

function initControlsAndModal() {
  // Conmutador rápido en 1 clic en el Header
  $('btnModeTv')?.addEventListener('click', () => applyDisplayMode('tv'));
  $('btnModeKiosk')?.addEventListener('click', () => applyDisplayMode('kiosk'));

  // Botón Pantalla Completa
  $('btnFullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Modal de Configuración (Boxes + Juegos + Opciones)
  const modal = $('kioskModal');
  const boxesGrid = $('boxesChecklistGrid');
  let draftMode = state.displayMode;
  let draftBoxes = new Set(state.enabledBoxes);

  function renderDraftBoxesGrid() {
    if (!boxesGrid) return;
    boxesGrid.innerHTML = ALL_BOX_IDS.map((boxId, idx) => {
      const isSelected = draftBoxes.has(boxId);
      return `
        <button type="button" class="box-chip-toggle ${isSelected ? 'selected' : ''}" data-box="${boxId}">
          BOX ${idx + 1}
        </button>
      `;
    }).join('');

    if ($('selectedBoxesCounter')) {
      $('selectedBoxesCounter').textContent = String(draftBoxes.size);
    }

    boxesGrid.querySelectorAll('.box-chip-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = btn.dataset.box;
        if (draftBoxes.has(b)) draftBoxes.delete(b);
        else draftBoxes.add(b);
        btn.classList.toggle('selected', draftBoxes.has(b));
        if ($('selectedBoxesCounter')) {
          $('selectedBoxesCounter').textContent = String(draftBoxes.size);
        }
      });
    });
  }

  // Presets rápidos de Boxes
  $('btnBoxesAll')?.addEventListener('click', () => {
    draftBoxes = new Set(ALL_BOX_IDS);
    renderDraftBoxesGrid();
  });
  $('btnBoxesNone')?.addEventListener('click', () => {
    draftBoxes = new Set();
    renderDraftBoxesGrid();
  });
  $('btnBoxes1to6')?.addEventListener('click', () => {
    draftBoxes = new Set(ALL_BOX_IDS.slice(0, 6));
    renderDraftBoxesGrid();
  });
  $('btnBoxes7to12')?.addEventListener('click', () => {
    draftBoxes = new Set(ALL_BOX_IDS.slice(6, 12));
    renderDraftBoxesGrid();
  });
  $('btnBoxes13to18')?.addEventListener('click', () => {
    draftBoxes = new Set(ALL_BOX_IDS.slice(12, 18));
    renderDraftBoxesGrid();
  });

  // Presets rápidos de Juegos Oficiales
  $('btnGamesTop4')?.addEventListener('click', () => {
    const top4 = new Set(['striker', 'atom-splitter', 'zombies', 'toca-challenge']);
    document.querySelectorAll('#tournamentGamesChecklist input').forEach(chk => {
      chk.checked = top4.has(chk.value);
    });
  });
  $('btnGamesAll')?.addEventListener('click', () => {
    document.querySelectorAll('#tournamentGamesChecklist input').forEach(chk => {
      chk.checked = true;
    });
  });

  $('modalBtnTv')?.addEventListener('click', () => {
    draftMode = 'tv';
    $('modalBtnTv').classList.add('active');
    $('modalBtnKiosk').classList.remove('active');
  });
  $('modalBtnKiosk')?.addEventListener('click', () => {
    draftMode = 'kiosk';
    $('modalBtnKiosk').classList.add('active');
    $('modalBtnTv').classList.remove('active');
  });

  $('btnAdminModal')?.addEventListener('click', () => {
    draftMode = state.displayMode;
    draftBoxes = new Set(state.enabledBoxes);
    renderDraftBoxesGrid();

    $('modalBtnTv')?.classList.toggle('active', draftMode === 'tv');
    $('modalBtnKiosk')?.classList.toggle('active', draftMode === 'kiosk');

    $('chkShowOverall').checked = state.showOverall;
    $('scoringModeSelect').value = state.scoringMode;
    $('phaseCycleSelect').value = state.phaseMode;
    $('chkAutoRotate').checked = state.autoRotate;
    $('rotateSecondsInput').value = state.rotateIntervalSec;

    document.querySelectorAll('#tournamentGamesChecklist input').forEach(chk => {
      chk.checked = state.tournamentGames.includes(chk.value);
    });

    modal.classList.add('open');
  });

  $('btnCloseModal')?.addEventListener('click', () => modal.classList.remove('open'));

  $('btnSaveConfig')?.addEventListener('click', () => {
    const selectedGames = [];
    document.querySelectorAll('#tournamentGamesChecklist input:checked').forEach(chk => {
      selectedGames.push(chk.value);
    });

    if (selectedGames.length === 0) {
      alert('Selecciona al menos 1 juego oficial para el torneo.');
      return;
    }

    if (draftBoxes.size === 0) {
      alert('Selecciona al menos 1 cabina (Box) participante para el torneo.');
      return;
    }

    applyDisplayMode(draftMode);
    state.enabledBoxes = ALL_BOX_IDS.filter(b => draftBoxes.has(b));
    state.tournamentGames = selectedGames;
    state.showOverall = $('chkShowOverall').checked;
    state.scoringMode = $('scoringModeSelect').value;
    state.phaseMode = $('phaseCycleSelect').value;
    state.timeFilter = (state.phaseMode === 'all') ? 'all' : 'today';
    state.autoRotate = $('chkAutoRotate').checked;
    state.rotateIntervalSec = Math.max(5, parseInt($('rotateSecondsInput').value, 10) || 14);

    localStorage.setItem('toca_tournament_boxes', JSON.stringify(state.enabledBoxes));
    localStorage.setItem('toca_tournament_games', JSON.stringify(state.tournamentGames));
    localStorage.setItem('toca_tournament_show_overall', String(state.showOverall));
    localStorage.setItem('toca_tournament_scoring_mode', state.scoringMode);
    localStorage.setItem('toca_tournament_phase_mode', state.phaseMode);
    localStorage.setItem('toca_kiosk_autorotate', String(state.autoRotate));
    localStorage.setItem('toca_kiosk_rotatesec', String(state.rotateIntervalSec));

    const tabs = getEnabledTabs();
    if (!tabs.includes(state.activeTab)) {
      state.activeTab = tabs[0];
    }

    modal.classList.remove('open');
    renderGameTabs();
    fetchScoresFromSupabase();
    startAutoRotate();
  });
}

// ==============================================================================
// UTILIDADES
// ==============================================================================
function formatBoxLabel(boxId) {
  const norm = normalizeBoxId(boxId);
  return norm.toUpperCase().replace('-', ' ');
}

function formatShortDate(isoStr) {
  if (!isoStr) return 'Hoy';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `Hoy ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch (_) {
    return 'Hoy';
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// ==============================================================================
// ARRANQUE
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  applyDisplayMode(state.displayMode);
  startNeonClock();
  renderGameTabs();
  renderCurrentView();
  initResetPanelModal();
  initControlsAndModal();
  fetchScoresFromSupabase();
  initRealtime();
  startAutoRotate();

  // Polling de respaldo cada 12 segundos
  setInterval(fetchScoresFromSupabase, 12000);
});
