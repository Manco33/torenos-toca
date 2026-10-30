/**
 * TOCA SOCIAL · KIOSK ARCADE LEADERBOARD ENGINE (v4.0)
 * Conexión en tiempo real a Supabase, rotación 180°, modo torneo y soporte para Toca Challenge Individual
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

// Configuración de juegos conocidos con sus iconos y nombres visuales
const GAME_DEFS = {
  'striker': { name: 'STRIKER', icon: '🔺', iconSvg: '▲' },
  'atom-splitter': { name: 'ATOM SPLITTER', icon: '⚛️', iconSvg: '⚛' },
  'zombies': { name: 'ZOMBIES', icon: '🧟', iconSvg: '🧟' },
  'toca-challenge': { name: 'TOCA CHALLENGE', icon: '💀', iconSvg: '💀' },
  'eliminator': { name: 'ELIMINATOR', icon: '🎯', iconSvg: '🎯' },
  'tug-of-war': { name: 'TUG OF WAR', icon: '⚔️', iconSvg: '⚔' }
};

// Estado global de la aplicación Kiosk
const state = {
  // Juegos activos en el modo torneo
  tournamentGames: ['striker', 'atom-splitter', 'zombies', 'toca-challenge'],
  activeGame: 'striker',
  autoRotate: true,
  rotateIntervalSec: 15,
  rotateTimer: null,
  timeFilter: 'today', // 'today' o 'all'
  currentTop10: []
};

const $ = (id) => document.getElementById(id);

// ==============================================================================
// 1. CARGA DE CONFIGURACIÓN PERSISTENTE (LOCALSTORAGE)
// ==============================================================================
function loadSavedSettings() {
  const savedGames = localStorage.getItem('toca_tournament_games');
  if (savedGames) {
    try {
      const parsed = JSON.parse(savedGames);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.tournamentGames = parsed;
      }
    } catch (e) {}
  }

  const savedAuto = localStorage.getItem('toca_kiosk_autorotate');
  if (savedAuto !== null) {
    state.autoRotate = (savedAuto === 'true');
  }

  const savedSec = localStorage.getItem('toca_kiosk_rotatesec');
  if (savedSec) {
    state.rotateIntervalSec = parseInt(savedSec, 10) || 15;
  }

  const savedFilter = localStorage.getItem('toca_kiosk_timefilter');
  if (savedFilter) {
    state.timeFilter = savedFilter;
  }

  // Asegurar que activeGame pertenezca a los habilitados
  if (!state.tournamentGames.includes(state.activeGame)) {
    state.activeGame = state.tournamentGames[0] || 'striker';
  }
}

// ==============================================================================
// 2. RENDER DE NAVEGACIÓN Y HERO BANNER
// ==============================================================================
function renderGameTabs() {
  const container = $('gamesNavList');
  container.innerHTML = state.tournamentGames.map(gameId => {
    const def = GAME_DEFS[gameId] || { name: gameId.toUpperCase(), icon: '🎮' };
    const isActive = (gameId === state.activeGame);
    return `
      <button class="game-tab-item ${isActive ? 'active' : ''}" data-game="${gameId}">
        <span class="tab-icon">${def.icon}</span>
        <span class="tab-name">${def.name}</span>
      </button>
    `;
  }).join('');

  // Event listener en las pestañas
  container.querySelectorAll('.game-tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.game;
      state.timeFilter = 'today'; // Al hacer clic manual, mostrar primero records de hoy
      switchActiveGame(g);
      resetAutoRotateTimer();
    });
  });

  updateHeroBanner();
}

function updateHeroBanner() {
  const def = GAME_DEFS[state.activeGame] || { name: state.activeGame.toUpperCase(), icon: '🎮' };
  $('heroGameName').textContent = def.name;
  $('heroGameIcon').textContent = def.icon;
  
  const subbadge = $('heroSubbadge');
  const tagLabel = $('recordsTagLabel');
  const banner = $('gameHeroBanner');
  const bar = $('indicatorBar');

  if (state.timeFilter === 'today') {
    $('subbadgeText').textContent = 'LOS MEJORES RÉCORDS DE HOY';
    if (tagLabel) tagLabel.textContent = 'RÉCORDS DE HOY';
    if (subbadge) subbadge.classList.remove('badge-historical');
    if (banner) banner.classList.remove('phase-historical');
    if (bar) bar.classList.remove('bar-historical');
  } else {
    $('subbadgeText').textContent = 'MEJORES RÉCORDS HISTÓRICOS';
    if (tagLabel) tagLabel.textContent = 'RÉCORDS HISTÓRICOS';
    if (subbadge) subbadge.classList.add('badge-historical');
    if (banner) banner.classList.add('phase-historical');
    if (bar) bar.classList.add('bar-historical');
  }
}

function switchActiveGame(gameId) {
  if (!state.tournamentGames.includes(gameId)) return;
  state.activeGame = gameId;
  
  // Actualizar estilos tabs
  document.querySelectorAll('.game-tab-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.game === gameId);
  });

  updateHeroBanner();
  loadLeaderboard();
}

// ==============================================================================
// 3. CARGA DE DATOS DESDE SUPABASE Y TOP 10 EN VIVO
// ==============================================================================
async function loadLeaderboard() {
  if (!sbClient) return;

  try {
    let query = sbClient
      .from('match_scores')
      .select('player_name, score, played_at, box_id')
      .eq('game_id', state.activeGame);

    // Filtro por fecha si está activado "today"
    if (state.timeFilter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte('played_at', todayStart.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    const scoresList = data || [];

    // Agrupación de puntajes por jugador/pareja
    // REGLA CRÍTICA:
    // En 'toca-challenge' NUNCA es en parejas; cada jugador cuenta por separado
    const isTocaChallenge = (state.activeGame === 'toca-challenge');
    const playerTotals = {};
    const playerBox = {};
    const playerLastPlayed = {};

    scoresList.forEach(row => {
      let pName = (row.player_name || 'Jugador').trim();
      const score = Number(row.score) || 0;

      // Si es toca-challenge y por alguna razón vino con '&', se desglosa
      if (isTocaChallenge && pName.includes(' & ')) {
        const parts = pName.split(' & ');
        parts.forEach(part => {
          const cleanName = part.trim();
          playerTotals[cleanName] = (playerTotals[cleanName] || 0) + Math.round(score / parts.length);
          playerBox[cleanName] = row.box_id;
          playerLastPlayed[cleanName] = row.played_at;
        });
      } else {
        playerTotals[pName] = (playerTotals[pName] || 0) + score;
        playerBox[pName] = row.box_id;
        playerLastPlayed[pName] = row.played_at;
      }
    });

    // Ordenar de mayor a menor y tomar el TOP 10 exacto
    const ranked = Object.entries(playerTotals)
      .map(([name, totalScore]) => ({
        name: name,
        score: totalScore,
        box_id: playerBox[name] || 'box-1',
        played_at: playerLastPlayed[name],
        isDuo: (!isTocaChallenge && name.includes(' & '))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    state.currentTop10 = ranked;
    renderLeaderboardRows(ranked);

  } catch (err) {
    console.error('Error cargando leaderboard:', err.message);
  }
}

// ==============================================================================
// 4. RENDERIZADO DE LAS 10 FILAS NEÓN
// ==============================================================================
function renderLeaderboardRows(ranked) {
  const tbody = $('leaderboardRows');

  if (!ranked || ranked.length === 0) {
    const gameDef = GAME_DEFS[state.activeGame] || { name: state.activeGame.toUpperCase() };
    const phaseMsg = (state.timeFilter === 'today')
      ? `Aún no hay disparos registrados hoy en <strong>${gameDef.name}</strong>.<br><span style="color:var(--neon-cyan);font-size:0.85rem;margin-top:6px;display:inline-block;">⚡ ¡Sé el primer jugador en entrar al Top 10 hoy!</span>`
      : `Esperando mejores registros históricos en <strong>${gameDef.name}</strong>...`;

    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-kiosk">
          ${phaseMsg}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = ranked.map((item, idx) => {
    const pos = idx + 1;
    let rankClass = 'rank-rest';
    if (pos === 1) rankClass = 'rank-1';
    else if (pos === 2) rankClass = 'rank-2';
    else if (pos === 3) rankClass = 'rank-3';

    const formattedScore = Number(item.score).toLocaleString();
    const boxLabel = item.box_id ? item.box_id.toUpperCase() : 'BOX';

    // Fecha formateada (ej. 30 oct 2026)
    let dateStr = 'Hoy';
    if (item.played_at) {
      try {
        const d = new Date(item.played_at);
        dateStr = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {}
    }

    return `
      <tr class="kiosk-row ${rankClass}">
        <td class="cell-pos">
          <div class="cell-pos-box">${pos}</div>
        </td>
        <td class="cell-player">
          <div class="cell-player-wrapper">
            <div class="cell-player-name" title="${escapeHtml(item.name)}">
              ${item.isDuo ? '<span class="duo-icon-tag">👥 DÚO</span>' : ''}
              ${escapeHtml(item.name)}
            </div>
            <div class="cell-player-meta">${dateStr} · ${boxLabel}</div>
          </div>
        </td>
        <td class="cell-score">
          <span class="cell-score-num">${formattedScore}</span>
          <span class="cell-score-pts">PTS</span>
        </td>
      </tr>
    `;
  }).join('');
}

// ==============================================================================
// 5. AUTOMATIZACIÓN DE PANTALLA Y BARRA DE PROGRESO DE FASES
// ==============================================================================
function triggerProgressBar(durationSec) {
  const bar = $('indicatorBar');
  if (!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth; // Forzar reflujo de diseño
  bar.style.transition = `width ${durationSec}s linear`;
  bar.style.width = '100%';
}

function startAutoRotate() {
  clearInterval(state.rotateTimer);
  if (!state.autoRotate) return;

  // Barra de progreso de la fase inicial
  triggerProgressBar(state.rotateIntervalSec);

  state.rotateTimer = setInterval(() => {
    // Si estábamos mostrando "today", pasamos a mostrar "all" (Récords Históricos) del mismo juego
    if (state.timeFilter === 'today') {
      state.timeFilter = 'all';
      updateHeroBanner();
      loadLeaderboard();
      triggerProgressBar(state.rotateIntervalSec);
    } else {
      // Si ya mostramos los históricos de este juego, pasamos al siguiente juego y volvemos a "today"
      state.timeFilter = 'today';
      if (state.tournamentGames.length > 0) {
        const currentIndex = state.tournamentGames.indexOf(state.activeGame);
        const nextIndex = (currentIndex + 1) % state.tournamentGames.length;
        switchActiveGame(state.tournamentGames[nextIndex]);
      }
      triggerProgressBar(state.rotateIntervalSec);
    }
  }, state.rotateIntervalSec * 1000);
}

function resetAutoRotateTimer() {
  if (state.autoRotate) {
    startAutoRotate();
  }
}

// ==============================================================================
// 6. RELOJ NEÓN EN TIEMPO REAL
// ==============================================================================
function startNeonClock() {
  function update() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    $('clockTime').textContent = `${h}:${m}:${s}`;

    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dName = days[now.getDay()];
    const dNum = now.getDate();
    const mName = months[now.getMonth()];
    const year = now.getFullYear();
    $('clockDate').textContent = `${dName}, ${dNum} ${mName} ${year}`;
  }
  update();
  setInterval(update, 1000);
}

// ==============================================================================
// 7. REALTIME DE SUPABASE (ACTUALIZACIONES AL VUELO)
// ==============================================================================
function initRealtime() {
  if (!sbClient) return;
  try {
    sbClient
      .channel('kiosk-live-stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_scores' }, payload => {
        const row = payload.new;
        // Actualizar ticker inferior
        const gameName = (GAME_DEFS[row.game_id] ? GAME_DEFS[row.game_id].name : row.game_id.toUpperCase());
        updateTicker(`⚡ ${row.player_name} anotó ${Number(row.score).toLocaleString()} pts en ${gameName} (${(row.box_id||'').toUpperCase()})`);

        // Si el puntaje es del juego activo, recargar tabla de inmediato
        if (row.game_id === state.activeGame) {
          loadLeaderboard();
        }
      })
      .subscribe();
  } catch (err) {
    console.error('Error suscribiendo a Realtime:', err);
  }
}

function updateTicker(msg) {
  $('tickerText').textContent = msg;
}

// ==============================================================================
// 8. MODAL DE CONFIGURACIÓN DEL TORNEO
// ==============================================================================
function initModal() {
  const modal = $('kioskModal');
  $('btnAdminModal').addEventListener('click', () => {
    // Sincronizar checkboxes con el estado actual
    document.querySelectorAll('#tournamentGamesChecklist input').forEach(chk => {
      chk.checked = state.tournamentGames.includes(chk.value);
    });
    $('chkAutoRotate').checked = state.autoRotate;
    $('rotateSecondsInput').value = state.rotateIntervalSec;
    $('timeFilterSelect').value = state.timeFilter;

    modal.classList.add('open');
  });

  $('btnCloseModal').addEventListener('click', () => modal.classList.remove('open'));

  $('btnSaveConfig').addEventListener('click', () => {
    const selected = [];
    document.querySelectorAll('#tournamentGamesChecklist input:checked').forEach(chk => {
      selected.push(chk.value);
    });

    if (selected.length === 0) {
      alert('Debes seleccionar al menos 1 juego para el torneo.');
      return;
    }

    state.tournamentGames = selected;
    state.autoRotate = $('chkAutoRotate').checked;
    state.rotateIntervalSec = parseInt($('rotateSecondsInput').value, 10) || 15;
    state.timeFilter = $('timeFilterSelect').value;

    // Guardar en localStorage
    localStorage.setItem('toca_tournament_games', JSON.stringify(state.tournamentGames));
    localStorage.setItem('toca_kiosk_autorotate', state.autoRotate ? 'true' : 'false');
    localStorage.setItem('toca_kiosk_rotatesec', state.rotateIntervalSec);
    localStorage.setItem('toca_kiosk_timefilter', state.timeFilter);

    modal.classList.remove('open');

    // Recargar pestañas y ranking
    renderGameTabs();
    loadLeaderboard();
    startAutoRotate();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// ==============================================================================
// 9. ARRANQUE
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  startNeonClock();
  renderGameTabs();
  loadLeaderboard();
  initModal();
  startAutoRotate();
  initRealtime();

  // Polling de respaldo cada 12 segundos
  setInterval(loadLeaderboard, 12000);
});
