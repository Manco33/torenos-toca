/**
 * TOCA SOCIAL - ARENA LEADERBOARD CLIENT
 * Conexión en tiempo real a Supabase (Realtime + REST)
 */

const SUPABASE_URL = 'https://oemqcvivlbjirewybyfe.supabase.co';
const SUPABASE_ANON = 'sb_publishable_lNTBokUMevI5a_uGPR-6iQ_k8gvKk--';

// Inicializar cliente Supabase de forma segura (evita conflicto léxico con var supabase de la librería)
let sbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  } else {
    console.warn('SDK de Supabase no encontrado en window.supabase.');
  }
} catch (err) {
  console.error('Error al instanciar Supabase client:', err);
}

// Estado global de la aplicación
const state = {
  activeGame: 'atom-splitter',
  activeTab: 'tab-players',
  timerSeconds: 45 * 60,
  timerRunning: false,
  timerInterval: null,
  allBoxes: Array.from({ length: 18 }, (_, i) => `box-${i + 1}`)
};

// Elementos del DOM
const $ = (id) => document.getElementById(id);

// ==============================================================================
// 1. CARGA DE DATOS & RENDERIZADO
// ==============================================================================

/** Carga el Top Jugadores del juego seleccionado (Ranking por Puntos Acumulados - Top 10) */
async function loadTopPlayers() {
  if (!sbClient) {
    console.warn('Supabase no disponible para loadTopPlayers');
    return;
  }
  try {
    const { data, error } = await sbClient
      .from('view_top_players_by_game')
      .select('*')
      .eq('game_id', state.activeGame)
      .order('total_score', { ascending: false })
      .limit(10);

    if (error) throw error;
    renderPodium(data || []);
    renderPlayerTable(data || []);
  } catch (err) {
    console.error('Error cargando top players:', err.message);
  }
}

/** Renderiza el podio (Top 1, 2 y 3) */
function renderPodium(players) {
  const container = $('playerPodium');
  if (!players || players.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="margin: auto;">
        No hay puntajes registrados aún en <strong>${state.activeGame}</strong>.
      </div>`;
    return;
  }

  const p1 = players[0] || null;
  const p2 = players[1] || null;
  const p3 = players[2] || null;

  function renderSpot(p, rank, crownEmoji, rankLabel) {
    if (!p) {
      return `<div class="podium-pillar" style="opacity:0.3;"><div class="podium-rank-tag">${rank}º</div></div>`;
    }
    const isDuo = p.player_name.includes(' & ');
    return `
      <div class="podium-avatar">${isDuo ? '👥' : crownEmoji}</div>
      <div class="podium-name" title="${escapeHtml(p.player_name)}">
        ${isDuo ? '<span class="podium-duo-indicator">DÚO</span>' : ''}${escapeHtml(p.player_name)}
      </div>
      <div class="podium-box">${p.box_name.toUpperCase()}</div>
      <div class="podium-pillar">
        <div class="podium-score">${Number(p.total_score).toLocaleString()}</div>
        <div style="font-size:0.75rem; color:${rank === 1 ? 'var(--gold)' : 'var(--text-muted)'}; margin-bottom:6px; font-weight:700;">
          ${p.matches_played} part. · Mejor: ${p.best_score}
        </div>
        <div class="podium-rank-tag">${rankLabel}</div>
      </div>
    `;
  }

  container.innerHTML = `
    <!-- 2do Lugar -->
    <div class="podium-spot rank-2">
      ${renderSpot(p2, 2, '🥈', '2º LUGAR')}
    </div>

    <!-- 1er Lugar (Centro, más alto) -->
    <div class="podium-spot rank-1">
      ${renderSpot(p1, 1, '👑', '1º LUGAR')}
    </div>

    <!-- 3er Lugar -->
    <div class="podium-spot rank-3">
      ${renderSpot(p3, 3, '🥉', '3º LUGAR')}
    </div>
  `;
}

/** Renderiza la tabla de posiciones desde el 4º al 10º (máximo 7 filas para no deformar la web) */
function renderPlayerTable(players) {
  const tbody = $('playerTableBody');
  const rest = players.slice(3, 10);

  if (rest.length === 0) {
    if (players.length <= 3 && players.length > 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Solo los mejores 3 en el podio. Esperando más tiradores en el Top 10...</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Sin partidas registradas aún.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = rest.map((p, idx) => {
    const isDuo = p.player_name.includes(' & ');
    const tagContent = isDuo ? '👥' : escapeHtml(p.player_name.substring(0, 2).toUpperCase());
    const tagClass = isDuo ? 'player-tag duo-tag' : 'player-tag';

    return `
      <tr>
        <td class="pos-badge">#${idx + 4}</td>
        <td>
          <div class="player-cell">
            <div class="${tagClass}" title="${isDuo ? 'Pareja / Dúo' : 'Individual'}">${tagContent}</div>
            <span title="${escapeHtml(p.player_name)}">${escapeHtml(p.player_name)}</span>
          </div>
        </td>
        <td><span class="box-pill">${p.box_name.toUpperCase()}</span></td>
        <td class="score-cell">
          <strong>${Number(p.total_score).toLocaleString()}</strong>
          <span style="font-size:0.75rem; color:var(--text-dim); margin-left:6px;">(${p.matches_played} part. · Récord: ${p.best_score})</span>
        </td>
        <td style="text-align: right; color: var(--text-dim); font-family: var(--font-mono);">${p.avg_response_time ? p.avg_response_time + 's' : '--'}</td>
      </tr>
    `;
  }).join('');
}

/** Carga el ranking de las 18 boxes */
async function loadBoxesLeaderboard() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('view_leaderboard_by_box')
      .select('*')
      .order('total_box_score', { ascending: false });

    if (error) throw error;
    renderBoxesGrid(data || []);
  } catch (err) {
    console.error('Error cargando boxes:', err.message);
  }
}

/** Renderiza las 18 tarjetas de cabinas */
function renderBoxesGrid(scoresData) {
  const container = $('boxesGrid');
  const scoresMap = new Map();
  scoresData.forEach(item => scoresMap.set(item.box_id, item));

  // Ordenar las 18 boxes: primero las que tienen puntos, luego las demás
  const boxesRanked = state.allBoxes.map(boxId => {
    const record = scoresMap.get(boxId);
    return {
      box_id: boxId,
      name: `Box ${boxId.replace('box-', '')}`,
      total_score: record ? record.total_box_score : 0,
      active_players: record ? record.active_players : 0,
      games_played: record ? record.total_games_played : 0
    };
  }).sort((a, b) => b.total_score - a.total_score);

  container.innerHTML = boxesRanked.map((b, idx) => {
    const isLeader = idx === 0 && b.total_score > 0;
    return `
      <div class="box-card ${isLeader ? 'leader' : ''}">
        <div class="box-card-top">
          <div class="box-card-num">${b.name.toUpperCase()}</div>
          <div class="box-card-rank">#${idx + 1}</div>
        </div>
        <div class="box-card-score">
          ${b.total_score} <small>PTS</small>
        </div>
        <div class="box-card-meta">
          <span>👥 ${b.active_players} Jugadores</span>
          <span>🎮 ${b.games_played} Partidas</span>
        </div>
      </div>
    `;
  }).join('');
}

/** Carga los MVPs y Parejas Ganadoras de cada cabina */
async function loadMvpLeaderboard() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('match_scores')
      .select('box_id, player_name, score');

    if (error) throw error;
    renderMvpGrid(data || []);
  } catch (err) {
    console.error('Error cargando MVPs / Parejas:', err.message);
  }
}

function renderMvpGrid(scoresData) {
  const container = $('mvpGrid');
  if (!scoresData || scoresData.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No hay líderes de cabina aún.</div>`;
    return;
  }

  // Agrupar por cabina y por jugador/pareja
  const boxMap = {};
  for (let i = 1; i <= 18; i++) {
    const boxId = `box-${i}`;
    boxMap[boxId] = {
      box_id: boxId,
      box_name: `BOX ${i}`,
      duos: {},
      singles: {},
      total: 0
    };
  }

  scoresData.forEach(row => {
    const b = boxMap[row.box_id];
    if (!b) return;
    const score = Number(row.score) || 0;
    b.total += score;
    const isDuo = row.player_name && row.player_name.includes(' & ');
    const target = isDuo ? b.duos : b.singles;
    target[row.player_name] = (target[row.player_name] || 0) + score;
  });

  // Filtrar solo las boxes que tengan puntajes ordenadas por puntaje
  const activeBoxes = Object.values(boxMap)
    .filter(b => b.total > 0)
    .map(b => {
      // Priorizar la pareja ganadora si existe
      const duoEntries = Object.entries(b.duos).sort((a, b) => b[1] - a[1]);
      const singleEntries = Object.entries(b.singles).sort((a, b) => b[1] - a[1]);

      let winnerName = '';
      let winnerScore = 0;
      let isDuo = false;

      if (duoEntries.length > 0) {
        winnerName = duoEntries[0][0];
        winnerScore = duoEntries[0][1];
        isDuo = true;
      } else if (singleEntries.length > 0) {
        winnerName = singleEntries[0][0];
        winnerScore = singleEntries[0][1];
        isDuo = false;
      }

      return {
        box_id: b.box_id,
        box_name: b.box_name,
        player_name: winnerName,
        total_score: winnerScore,
        isDuo: isDuo
      };
    })
    .filter(b => b.player_name)
    .sort((a, b) => b.total_score - a.total_score);

  if (activeBoxes.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No hay líderes de cabina aún.</div>`;
    return;
  }

  container.innerHTML = activeBoxes.map(mvp => `
    <div class="mvp-card ${mvp.isDuo ? 'mvp-duo' : ''}">
      <div class="mvp-avatar">${mvp.isDuo ? '👥' : '⭐'}</div>
      <div class="mvp-info" style="flex:1; min-width:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div class="mvp-box-badge">${mvp.box_name.toUpperCase()}</div>
          ${mvp.isDuo ? '<span class="duo-badge-pill">👥 PAREJA GANADORA</span>' : '<span class="duo-badge-pill solo">⭐ MVP</span>'}
        </div>
        <h4 style="margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(mvp.player_name)}">
          ${escapeHtml(mvp.player_name)}
        </h4>
        <div class="mvp-score">${Number(mvp.total_score).toLocaleString()} PTS</div>
      </div>
    </div>
  `).join('');
}

// ==============================================================================
// 2. REALTIME (Escuchar nuevos puntajes en vivo de las 18 boxes)
// ==============================================================================
function initRealtime() {
  if (!sbClient) return;
  try {
    const channel = sbClient
      .channel('arena-live-scores')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_scores' },
        (payload) => {
          const row = payload.new;
          console.log('⚡ Nuevo puntaje recibido en tiempo real:', row);
          
          // Disparar toast animado
          showToast(`¡PUNTAJE EN VIVO EN ${row.box_id.toUpperCase()}!`, `${row.player_name} anotó ${row.score} pts en ${row.game_id}`);
          
          // Actualizar ticker inferior
          updateTicker(`⚡ ${row.player_name} (${row.box_id.toUpperCase()}) sumó ${row.score} pts en ${row.game_id}`);

          // Recargar datos automáticamente
          refreshAllData();
        }
      )
      .subscribe((status) => {
        console.log('[Supabase Realtime Status]:', status);
      });
  } catch (err) {
    console.error('Error iniciando realtime:', err);
  }
}

function refreshAllData() {
  loadTopPlayers();
  loadBoxesLeaderboard();
  loadMvpLeaderboard();
}

// ==============================================================================
// 3. TOAST & TICKER NOTIFICACIONES
// ==============================================================================
let toastTimeout = null;
function showToast(title, detail) {
  const toast = $('scoreToast');
  $('toastTitle').textContent = title;
  $('toastDetail').textContent = detail;
  toast.classList.add('show');
  
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 4500);
}

function updateTicker(message) {
  const track = $('tickerTrack');
  const span = document.createElement('span');
  span.style.marginRight = '40px';
  span.textContent = message;
  track.prepend(span);
}

// ==============================================================================
// 4. TEMPORIZADOR DE ETAPA (Persistente con LocalStorage)
// ==============================================================================
function updateTimerDisplay() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  $('stageTimer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startTimer(updateStorage = true) {
  if (state.timerRunning) return;
  state.timerRunning = true;
  $('stageStatus').textContent = 'ETAPA EN VIVO';
  if (updateStorage) {
    const endTime = Date.now() + state.timerSeconds * 1000;
    localStorage.setItem('toca_stage_end_time', endTime);
    localStorage.setItem('toca_stage_running', 'true');
    localStorage.setItem('toca_stage_game', state.activeGame);
  }
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.timerSeconds > 0) {
      state.timerSeconds--;
      updateTimerDisplay();
    } else {
      clearInterval(state.timerInterval);
      state.timerRunning = false;
      localStorage.setItem('toca_stage_running', 'false');
      $('stageStatus').textContent = 'ETAPA FINALIZADA';
      showToast('¡TIEMPO!', 'La etapa ha finalizado.');
    }
  }, 1000);
}

function pauseTimer() {
  state.timerRunning = false;
  clearInterval(state.timerInterval);
  localStorage.setItem('toca_stage_running', 'false');
  localStorage.setItem('toca_stage_seconds', state.timerSeconds);
  $('stageStatus').textContent = 'EN PAUSA';
}

function resetTimer(minutes) {
  pauseTimer();
  state.timerSeconds = minutes * 60;
  localStorage.setItem('toca_stage_seconds', state.timerSeconds);
  updateTimerDisplay();
}

function initTimerState() {
  const savedEndTime = localStorage.getItem('toca_stage_end_time');
  const savedGame = localStorage.getItem('toca_stage_game');
  const savedRunning = localStorage.getItem('toca_stage_running');

  if (savedGame) {
    state.activeGame = savedGame;
    $('currentStageGame').textContent = savedGame.replace('-', ' ').toUpperCase();
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', c.dataset.game === savedGame);
    });
  }

  if (savedEndTime && savedRunning === 'true') {
    const diff = Math.max(0, Math.floor((parseInt(savedEndTime, 10) - Date.now()) / 1000));
    state.timerSeconds = diff;
    if (diff > 0) {
      startTimer(false);
    } else {
      $('stageStatus').textContent = 'ETAPA FINALIZADA';
      updateTimerDisplay();
    }
  } else if (localStorage.getItem('toca_stage_seconds')) {
    state.timerSeconds = parseInt(localStorage.getItem('toca_stage_seconds'), 10) || 45 * 60;
    updateTimerDisplay();
  } else {
    // Si es primera vez, arrancar la cuenta regresiva de 45 minutos
    startTimer(true);
  }
}

// ==============================================================================
// 5. EVENT LISTENERS & INICIALIZACIÓN
// ==============================================================================
function initUI() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
      state.activeTab = btn.dataset.tab;
    });
  });

  // Chips de juego
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeGame = chip.dataset.game;
      loadTopPlayers();
    });
  });

  // Admin Modal
  const modal = $('adminModal');
  $('btnAdmin').addEventListener('click', () => modal.classList.add('open'));
  $('btnCloseAdmin').addEventListener('click', () => modal.classList.remove('open'));

  // Clic en el banner del temporizador abre el panel de control
  const stageBanner = $('stageBanner');
  if (stageBanner) {
    stageBanner.style.cursor = 'pointer';
    stageBanner.title = 'Click para abrir Panel de Control / Temporizador';
    stageBanner.addEventListener('click', () => modal.classList.add('open'));
  }

  // Controles de etapa
  $('btnStartStage').addEventListener('click', () => {
    const game = $('stageGameSelect').value;
    const mins = parseInt($('stageDurationInput').value, 10) || 45;
    
    state.activeGame = game;
    $('currentStageGame').textContent = game.replace('-', ' ').toUpperCase();
    
    // Activar chip correspondiente
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', c.dataset.game === game);
    });

    resetTimer(mins);
    startTimer(true);
    loadTopPlayers();
    modal.classList.remove('open');
    showToast('¡ETAPA INICIADA!', `${game.toUpperCase()} - ${mins} MINUTOS`);
  });

  $('btnPauseStage').addEventListener('click', () => {
    pauseTimer();
    modal.classList.remove('open');
  });

  $('btnEndStage').addEventListener('click', () => {
    pauseTimer();
    state.timerSeconds = 0;
    localStorage.setItem('toca_stage_seconds', '0');
    localStorage.setItem('toca_stage_running', 'false');
    updateTimerDisplay();
    $('stageStatus').textContent = 'ETAPA FINALIZADA';
    modal.classList.remove('open');
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// Arranque
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initTimerState();
  refreshAllData();
  initRealtime();

  // Refresco de respaldo cada 20s
  setInterval(refreshAllData, 20000);
});
