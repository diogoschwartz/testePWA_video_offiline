import './style.css';
import { db } from './services/db';
import { downloadPlaylistUrls, deleteVideo, downloadVideo } from './services/downloader';
import { getRemoteVideos } from './services/supabase';
import { registerSW } from 'virtual:pwa-register';
import QRCode from 'qrcode';

const app = document.querySelector('#app');

// ==========================================
// ESTADOS DA INTERFACE
// ==========================================
let viewState = 'HOME'; // HOME | PLAYLIST | SETTINGS
let currentPlaylistId = null;
let activeVideoIndex = -1; // Pra tocar sequencial
let playingVideoId = null;

// Cache do catálogo pra não bater no DB toda hora
let cachedCatalog = [];
let isStoragePersistent = false;

// ==========================================
// RENDERIZADOR BASE
// ==========================================
function render() {
  if (viewState === 'HOME') {
    renderHome();
  } else if (viewState === 'PLAYLIST') {
    renderPlaylistView();
  } else if (viewState === 'SETTINGS') {
    renderSettings();
  }
}

// ==========================================
// TELA INITIAL: Criar / Listar Playlists / Catálogo
// ==========================================
async function renderHome() {
  const playlists = await db.playlists.toArray();

  // Fetch do Supabase (Apenas se ainda nao o fez, precisaremos dele dps nas playlists)
  if (cachedCatalog.length === 0) {
    cachedCatalog = await getRemoteVideos();
  }

  app.innerHTML = `
    <!-- APP TITLE HERO -->
    <div class="app-header-card" style="background-image: url('https://dna-positivo.vercel.app/_next/image?url=%2Fimg%2FDNA-Genetics.gif&w=3840&q=75');">
      <div class="header-content" style="justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <img src="https://dna-positivo.vercel.app/_next/image?url=%2Fimg%2Flogo-180x180.jpg&w=384&q=75" alt="Icon" />
          <h1>Dialogo Dirigido</h1>
        </div>
        <button id="btn-settings" class="icon-btn" style="background: rgba(0,0,0,0.4); color: white; border-color: rgba(255,255,255,0.2);" title="Configurações">⚙️</button>
      </div>
    </div>

    <!-- SEÇÃO: PLAYLISTS LOCAIS (Sua Biblioteca) -->
    <div style="width: 100%; max-width: 600px; margin: 0 auto; padding: 0; margin-top: 1rem;">
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="border: none; margin: 0; font-size: 1.4rem;">Minhas Playlists</h2>
        <button id="btn-open-create-modal" style="padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">+ Criar Playlist</button>
      </div>

      <div class="fullscreen-grid" id="playlist-list">
         ${playlists.length === 0 ? '<div style="grid-column: 1 / -1; text-align: center; width: 100%;"><p class="info">Nenhuma playlist. Crie uma acima para começar!</p></div>' : ''}
      </div>
    </div>

    <!-- MODAL DE CRIAÇÃO -->
    <div id="create-playlist-modal" class="modal-overlay">
      <div class="modal-content">
        <h3 style="margin-bottom: 1rem;">Nova Playlist</h3>
        <div class="input-group">
          <input type="text" id="new-playlist-name" placeholder="Nome da Playlist (ex: Viagem)" style="width: 100%; box-sizing: border-box; margin-bottom: 0.5rem;" />
          <input type="text" id="new-playlist-cover" placeholder="URL da Capa (Opcional)" style="width: 100%; box-sizing: border-box; margin-bottom: 1.5rem;" />
          <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
            <button id="btn-cancel-playlist" class="ghost">Cancelar</button>
            <button id="btn-confirm-playlist">Criar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind Open/Close Modal
  const modal = document.getElementById('create-playlist-modal');
  document.getElementById('btn-open-create-modal').addEventListener('click', () => {
    modal.classList.add('active');
    document.getElementById('new-playlist-name').focus();
  });

  document.getElementById('btn-cancel-playlist').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  // Fecha clicando fora
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  // Bind Confirm Create
  document.getElementById('btn-confirm-playlist').addEventListener('click', async () => {
    const nameInput = document.getElementById('new-playlist-name');
    const coverInput = document.getElementById('new-playlist-cover');
    const name = nameInput.value.trim();
    const cover_image_url = coverInput.value.trim();

    if (name) {
      await db.playlists.put({ name, cover_image_url, createdAt: new Date() });
      nameInput.value = '';
      coverInput.value = '';
      render();
    }
  });

  // Bind List de Playlists (Card UI Visual)
  const listEl = document.getElementById('playlist-list');

  if (playlists.length > 0) {
    listEl.innerHTML = '';
  }
  // Adiciona o botão "Criar Playlist" removido, visto que já temos o botão superior.

  // Renderizar Playlists do DB
  for (const pl of playlists) {
    const item = document.createElement('div');
    item.className = 'fullscreen-card';

    // Se preferir manter a imagem caso o usuário preencha a capa, podemos reativar:
    if (pl.cover_image_url) {
      item.style.backgroundImage = `url('${pl.cover_image_url}')`;
    }

    item.innerHTML = `<div class="fullscreen-title">${pl.name}</div>`;
    item.addEventListener('click', () => {
      currentPlaylistId = pl.id;
      activeVideoIndex = -1;
      viewState = 'PLAYLIST';
      render();
    });
    listEl.appendChild(item);
  }

  // NAVEGAR PARA SETTINGS
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    viewState = 'SETTINGS';
    render();
  });
}

// ==========================================
// TELA PLAYLIST: Player, Add via Catalog, Fila
// ==========================================
async function renderPlaylistView() {
  const playlist = await db.playlists.get(currentPlaylistId);
  if (!playlist) { viewState = 'HOME'; return render(); }

  const videos = await db.playlist_videos.where({ playlistId: playlist.id }).sortBy('order');
  const videosMeta = await Promise.all(videos.map(v => db.videos.get(v.videoId)));

  const headerBgStyle = playlist.cover_image_url
    ? `background-image: url('${playlist.cover_image_url}');`
    : `background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);`;

  app.innerHTML = `
    <!-- BACK NAV -->
    <div style="width: 100%; max-width: 800px; margin: 0 auto; display: flex; justify-content: flex-start; padding-bottom: 0.5rem;">
       <button id="btn-back" class="ghost" style="padding: 0.4rem 0.8rem; border-radius: 20px;">← Voltar</button>
    </div>

    <!-- APP TITLE HERO FOR PLAYLIST -->
    <div class="app-header-card" style="${headerBgStyle}">
      <div class="header-content" style="justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <img src="https://dna-positivo.vercel.app/_next/image?url=%2Fimg%2Flogo-180x180.jpg&w=384&q=75" alt="Icon" />
          <h1>${playlist.name}</h1>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          ${(() => {
      const allDownloaded = videos.length > 0 && videos.every((v, idx) => {
        const meta = videosMeta[idx];
        return meta && meta.downloaded >= meta.size && meta.size > 0;
      });

      if (videos.length === 0) return '';

      if (allDownloaded) {
        return `<button id="btn-play-all" class="icon-btn" style="width: auto; padding: 0.5rem 1rem; border-radius: 20px; background: rgba(34, 197, 94, 0.2); color: #86efac; border-color: rgba(34, 197, 94, 0.4);" title="Tocar a Playlist Offline Completa">▶ TOCAR TUDO</button>`;
      } else {
        return `<button id="btn-download-all" class="icon-btn" style="width: auto; padding: 0.5rem 1rem; border-radius: 20px; background: rgba(255,255,255,0.2); color: white; border-color: rgba(255,255,255,0.4);" title="Sincronizar Todos os Vídeos Offline">☁️ BAIXAR</button>`;
      }
    })()}
        </div>
      </div>
    </div>

    <!-- PLAYER SEQUENCIAL E YOUTUBE -->
    <div id="player-container" class="video-container ${activeVideoIndex === -1 ? 'hidden' : ''}" style="margin-top: 1rem;">
      <!-- Placeholder de Player, injetado dinamicamente no playSequence -->
      <video id="player" controls controlsList="nodownload" autoplay></video>
    </div>

    <!-- LISTA DE VIDEOS -->
    <div class="card" style="margin-top: 1rem;">

       <div id="download-panel" class="progress-container hidden" style="margin-bottom: 1rem;">
          <div class="info" id="dl-status">Iniciando download...</div>
          <progress id="dl-progress" value="0" max="100"></progress>
       </div>

       <div class="list-group" id="video-list">
         ${videos.length === 0 ? '<p class="info">Sua playlist está vazia.</p>' : ''}
       </div>
    </div>
    
    <!-- MODAL DE ADICIONAR VIDEO -->
    <div id="add-video-modal" class="modal-overlay">
       <div class="modal-content">
         <h3 style="margin-bottom: 1rem;">Adicionar Vídeo da Nuvem</h3>
         <div class="input-group">
           <select id="catalog-select" style="width:100%; padding: 0.6rem; margin-bottom: 1.5rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit;">
              <option value="">Selecione um vídeo da nuvem...</option>
              ${cachedCatalog.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
           </select>
           <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
             <button id="btn-cancel-add-video" class="ghost">Cancelar</button>
             <button id="btn-confirm-add-video">Inserir</button>
           </div>
         </div>
       </div>
    </div>
  `;

  document.getElementById('btn-back').addEventListener('click', () => {
    viewState = 'HOME';
    render();
  });

  // Bind Modal Add Video
  const addVideoModal = document.getElementById('add-video-modal');

  document.getElementById('btn-cancel-add-video').addEventListener('click', () => {
    addVideoModal.classList.remove('active');
  });

  addVideoModal.addEventListener('click', (e) => {
    if (e.target === addVideoModal) addVideoModal.classList.remove('active');
  });

  // CONFIRM ADD VIDEO
  document.getElementById('btn-confirm-add-video').addEventListener('click', async () => {
    const catalogId = document.getElementById('catalog-select').value;
    if (catalogId) {
      const remoteInfo = cachedCatalog.find(c => c.id === catalogId);
      if (!remoteInfo) return;

      const vidId = 'vid_' + remoteInfo.id + '_' + Date.now();
      await db.playlist_videos.put({
        playlistId: playlist.id,
        videoId: vidId,
        url: remoteInfo.download_url,
        youtube_url: remoteInfo.youtube_url,
        thumbnail_url: remoteInfo.thumbnail_url,
        title: remoteInfo.title,
        order: videos.length
      });
      render();
    }
  });

  // RENDERIZA LISTA DOS VÍDEOS COM BOTÕES DOWNLOAD/PLAY INLINE
  const listEl = document.getElementById('video-list');
  videos.forEach((v, idx) => {
    const meta = videosMeta[idx];
    const isDownloaded = meta && meta.downloaded >= meta.size && meta.size > 0;

    const item = document.createElement('div');
    item.className = 'list-item';
    if (idx === activeVideoIndex) item.classList.add('active');

    let actionBtnHTML = '';
    if (isDownloaded) {
      actionBtnHTML = `<button class="btn-play-item icon-btn" data-idx="${idx}" style="color: var(--success); border-color: var(--success);" title="Tocar Offline">▶</button>`;
    } else {
      actionBtnHTML = `<button class="btn-download-item icon-btn ghost" id="btn-dl-${v.videoId}" data-idx="${idx}" data-vid="${v.videoId}" data-url="${v.url}" title="Baixar Vídeo">⬇️</button>`;

      if (v.youtube_url) {
        actionBtnHTML += `<button class="btn-youtube-item icon-btn ghost" data-idx="${idx}" style="margin-left:0.5rem; color:#ef4444; border-color:#ef4444;" title="Tocar no YouTube">▶</button>`;
      }
    }

    const thumbHtml = v.thumbnail_url
      ? `<img src="${v.thumbnail_url}" class="video-thumbnail" alt="thumbnail" />`
      : `<div class="video-thumbnail"></div>`; // Placeholder vazio se não houver

    item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 0; pointer-events: none;">
           ${thumbHtml}
           <div class="item-info">
              <div class="item-title">${v.order + 1}. ${v.title}</div>
              <div class="item-meta" style="pointer-events: auto;">
                 ${isDownloaded ? '<span style="color:var(--success)" title="Offline Prontinho">✓</span>' : '<span title="Nuvem (Não baixado)">☁️</span>'}
                 <span id="dl-text-${v.videoId}" style="margin-left:8px; color: var(--primary); font-weight: bold; font-size: 0.75rem;"></span>
              </div>
           </div>
        </div>
        <div style="display: flex; align-items: center; z-index: 10;">
           ${idx === activeVideoIndex ? '<span style="margin-right: 0.5rem; color: var(--primary); font-weight:bold; font-size: 0.8rem">Tocando</span>' : ''}
           ${actionBtnHTML}
        </div>
     `;

    // Long Press to Delete Logic
    let pressTimer;
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const startPress = (e) => {
      // Don't trigger if clicking on an interactive button inside the item
      if (e.target.tagName === 'BUTTON') return;
      pressTimer = setTimeout(async () => {
        if (confirm(`Deseja remover "${v.title}" desta playlist?`)) {
          await db.playlist_videos.delete(v.id);
          render();
        }
      }, 600); // 600ms = long press
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
    };

    if (isTouch) {
      item.addEventListener('touchstart', startPress, { passive: true });
      item.addEventListener('touchend', cancelPress);
      item.addEventListener('touchmove', cancelPress); // Cancel if scrolling
    } else {
      item.addEventListener('mousedown', startPress);
      item.addEventListener('mouseup', cancelPress);
      item.addEventListener('mouseleave', cancelPress);
    }

    listEl.appendChild(item);
  });

  // BOTÃO VISUAL PARA ADICIONAR VÍDEO NO FINAL DA LISTA
  const addVideoItem = document.createElement('div');
  addVideoItem.className = 'list-item ghost';
  addVideoItem.style.justifyContent = 'center';
  addVideoItem.style.borderStyle = 'dashed';
  addVideoItem.innerHTML = `<span style="color: var(--text-muted); font-weight: 500;">+ Adicionar Vídeo</span>`;
  addVideoItem.addEventListener('click', () => {
    addVideoModal.classList.add('active');
  });
  listEl.appendChild(addVideoItem);

  // Event Listeners Dinamicos pros botoes da lista
  document.querySelectorAll('.btn-play-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-idx'));
      playSequence(idx, videos, videosMeta);
    });
  });

  document.querySelectorAll('.btn-youtube-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-idx'));
      playSequence(idx, videos, videosMeta, true);
    });
  });

  document.querySelectorAll('.btn-download-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const url = btn.getAttribute('data-url');
      const vId = btn.getAttribute('data-vid');
      btn.disabled = true;
      btn.innerText = "⏳...";

      const txtSpan = document.getElementById(`dl-text-${vId}`);

      try {
        await downloadVideo(url, vId, (d, t) => {
          if (t > 0) {
            const pct = ((d / t) * 100).toFixed(0);
            if (txtSpan) txtSpan.innerText = `Baixando: ${pct}%`;
            btn.innerText = `${pct}%`;
          }
        });
        render(); // Rerenderiza pra virar botaO PLAY verde
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerText = "❌ Falha";
        btn.style.color = "var(--danger)";
        if (txtSpan) txtSpan.innerText = "Erro no download";
      }
    });
  });

  // BOTÕES MESTRES
  const btnDownloadAll = document.getElementById('btn-download-all');
  btnDownloadAll?.addEventListener('click', () => initiateDownloadQueue(videos));

  document.getElementById('btn-delete-all')?.addEventListener('click', async () => {
    for (const v of videos) {
      await deleteVideo(v.videoId);
    }
    render();
  });

  // TOCAR TUDO (RETRÔATIVO QUANDO TUDO BAIXADO)
  document.getElementById('btn-play-all')?.addEventListener('click', () => {
    if (videos.length > 0) playSequence(0, videos, videosMeta);
  });

  // Lógica de PLAY SEQUENCIAL (se já estava tocando e re-renderizou)
  if (activeVideoIndex !== -1) {
    playSequence(activeVideoIndex, videos, videosMeta, false, true); // true = mute render
  }
}

// ==========================================
// TOCA SEQUENCIAL (YOUTUBE OU LOCAL)
// ==========================================
function playSequence(index, allVideos, allMeta, forceYoutube = false, noRender = false) {
  activeVideoIndex = index;
  if (!noRender) render(); // reconstrói pra mostrar a caixa de video e marcar active

  // Delay tick pra garatir que a DOM recriou o #player
  setTimeout(() => {
    const videoToPlay = allVideos[index];
    const metaToPlay = allMeta[index]; // array parelelo de metadados
    const playerContainer = document.getElementById('player-container');
    if (!playerContainer) return;

    const isDownloaded = metaToPlay && metaToPlay.downloaded >= metaToPlay.size && metaToPlay.size > 0;

    if (forceYoutube || (!isDownloaded && videoToPlay.youtube_url)) {
      // Converte link do YT pra Embed (ex: watch?v=123 ou youtu.be/123 -> embed/123)
      let embedUrl = videoToPlay.youtube_url;
      if (embedUrl.includes('watch?v=')) {
        embedUrl = embedUrl.replace('watch?v=', 'embed/');
      } else if (embedUrl.includes('youtu.be/')) {
        embedUrl = embedUrl.replace('youtu.be/', 'www.youtube.com/embed/');
      }
      // Limpa parametros antigos e bota autoplay
      embedUrl = embedUrl.split('&')[0];

      playerContainer.innerHTML = `<iframe width="100%" height="100%" src="${embedUrl}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    } else {
      // Player HTML5 nativo
      playerContainer.innerHTML = `<video id="player" controls controlsList="nodownload" autoplay></video>`;
      const player = document.getElementById('player');
      if (isDownloaded) {
        player.src = `/offline-video/${videoToPlay.videoId}`;
      } else {
        player.src = videoToPlay.url; // Fallback final remoto direto no HTML5 do celular
      }

      // UX: Focus Mode Classes
      player.addEventListener('play', () => {
        document.body.classList.add('video-focus-mode');
        playerContainer.classList.add('player-focused');
      });

      const removeFocusMode = () => {
        document.body.classList.remove('video-focus-mode');
        playerContainer.classList.remove('player-focused');
      };

      player.addEventListener('pause', removeFocusMode);
      player.addEventListener('ended', removeFocusMode);

      // Clicar no escuro do body (fora do player) tbem pausa
      document.body.addEventListener('click', (e) => {
        // O overlay eh o proprio pseudo ::before do body (então o clique cai no body direto, nao nos childs)
        if (e.target === document.body && !player.paused) {
          player.pause();
        }
      });

      player.play().catch(e => console.error("Auto-play blindado?:", e));
      player.onended = () => {
        removeFocusMode();
        playNextOffline(index, allVideos, allMeta);
      };
      player.onerror = () => {
        console.warn("Vídeo corrompido ou offline falhou, pulando...");
        removeFocusMode();
        playNextOffline(index, allVideos, allMeta);
      };
    }
  }, 50);
}

// Procura o próximo que esteja offline pra tocar
function playNextOffline(currentIndex, allVideos, allMeta) {
  let nextIdx = currentIndex + 1;

  // Acha o primeiro disponivel pra pular
  while (nextIdx < allVideos.length) {
    const m = allMeta[nextIdx];
    // Se baixado, vai! Se tem youtube, vai tbm!
    if ((m && m.downloaded >= m.size && m.size > 0) || allVideos[nextIdx].youtube_url) {
      break;
    }
    nextIdx++;
  }

  if (nextIdx < allVideos.length) {
    playSequence(nextIdx, allVideos, allMeta);
  } else {
    console.log("Fim da Playlist offline.");
    activeVideoIndex = -1;
    render();
  }
}// ==========================================
// TELA SETTINGS: Configurações Globais
// ==========================================
async function renderSettings() {

  let storageEstimateHtml = '';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
      const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(2);

      storageEstimateHtml = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 1rem; background: var(--bg); border-radius: 8px;">
             <div>
               <div style="font-weight: 500;">Uso de Disco</div>
               <div style="font-size: 0.8rem; color: var(--text-muted);">${usedMB} MB / ${quotaMB} MB</div>
             </div>
             <div>
               ${isStoragePersistent
          ? '<span style="color: var(--success); font-size: 0.8rem; display: flex; align-items: center; gap: 0.2rem;">🔒 Persistente (Protegido)</span>'
          : '<span style="color: var(--warning); font-size: 0.8rem; display: flex; align-items: center; gap: 0.2rem;">⚠️ Volátil (Risco de Limpeza)</span>'}
             </div>
          </div>
       `;
    } catch (e) { console.error('Error estimating storage:', e); }
  }

  app.innerHTML = `
    <!-- HEADER -->
    <div class="app-header-card" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);">
      <div class="header-content" style="flex-direction: column; align-items: flex-start;">
          <button id="btn-back-settings" class="ghost" style="padding: 0; margin-bottom: 0.5rem; color: rgba(255,255,255,0.7); font-size: 0.9rem;">← Voltar</button>
          <div style="display: flex; align-items: center; gap: 1rem;">
             <h1 style="font-size: 1.8rem; margin: 0; color: white;">Configurações</h1>
          </div>
      </div>
    </div>

    <!-- SETTINGS CONTENT -->
    <div style="width: 100%; max-width: 600px; margin: 0 auto; padding: 1rem;">
       ${storageEstimateHtml}
       
       <!-- QR EXPORT SECTION -->
       <div class="card" style="border: 1px solid rgba(59, 130, 246, 0.3); margin-bottom: 1.5rem;">
          <h3 style="color: #93c5fd; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">📡 Compartilhar Playlist</h3>
          <p class="info" style="margin-bottom: 1rem;">Gere um QR Code para outro aparelho (com o app instalado) escanear e importar sua playlist instantaneamente.</p>
          
          <select id="export-playlist-select" style="width:100%; padding: 0.6rem; margin-bottom: 1rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit;">
              <option value="">Selecione a playlist...</option>
          </select>
          <button id="btn-export-qr" style="width: 100%;">Gerar QR Code 📷</button>

          <div id="qr-result-container" style="display:none; text-align:center; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px dashed var(--border);">
              <p style="margin-bottom: 1rem; font-weight: 500;">Leia o código abaixo com a câmera:</p>
              <canvas id="qr-canvas" style="border-radius: 8px; border: 4px solid white;"></canvas>
          </div>
       </div>

       <div class="card" style="border: 1px solid rgba(239, 68, 68, 0.3);">
          <h3 style="color: #fca5a5; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">🗑️ Armazenamento Local</h3>
          <p class="info" style="margin-bottom: 1.5rem;">Apagar os vídeos limpará todo o cache offline baixado para o seu aparelho, liberando espaço na memória. As suas playlists continuam salvas.</p>
          <button id="btn-delete-all-global" class="danger" style="width: 100%;">Esvaziar Todo o Storage Offline</button>
       </div>
    </div>
  `;

  document.getElementById('btn-back-settings').addEventListener('click', () => {
    viewState = 'HOME';
    render();
  });

  // PREENCHER OPÇÕES DO SELECT
  const exportSelect = document.getElementById('export-playlist-select');
  const allPlaylists = await db.playlists.toArray();
  allPlaylists.forEach(pl => {
    const opt = document.createElement('option');
    opt.value = pl.id;
    opt.innerText = pl.name;
    exportSelect.appendChild(opt);
  });

  // GERAR QR CODE
  document.getElementById('btn-export-qr').addEventListener('click', async () => {
    const plId = Number(exportSelect.value);
    if (!plId) return alert('Selecione uma playlist primeiro.');

    const pl = allPlaylists.find(x => x.id === plId);
    const plVideos = await db.playlist_videos.where({ playlistId: plId }).sortBy('order');

    // Simplificando o payload para caber num QR
    const payload = {
      name: pl.name,
      cover: pl.cover_image_url || null,
      videos: plVideos.map(v => ({ id: v.videoId.split('_')[1], title: v.title })) // Pegando a ID remote pura do remoteInfo para re-catálogo
    };

    const encodedData = encodeURIComponent(JSON.stringify(payload));
    const importUrl = `web+vod://import?data=${encodedData}`;

    const qrContainer = document.getElementById('qr-result-container');
    const canvas = document.getElementById('qr-canvas');

    try {
      await QRCode.toCanvas(canvas, importUrl, { width: 250, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      qrContainer.style.display = 'block';
    } catch (err) {
      console.error(err);
      alert("Erro ao gerar QR Code. A playlist pode ser muito grande.");
    }
  });

  document.getElementById('btn-delete-all-global').addEventListener('click', async () => {
    if (!confirm("Atenção: Isso vai apagar TODOS os registros e vídeos do cache offline de todas as playlists. Seu aparelho ficará limpo. Confirma?")) return;

    // Deleta os vídeos globalmente
    const allVideos = await db.videos.toArray();
    for (const v of allVideos) {
      await deleteVideo(v.id);
    }

    // Remove o status das playlists também para forçar reset
    await db.videos.clear();
    await db.chunks.clear();

    alert("Armazenamento esvaziado com sucesso!");
    render();
  });
}

// ==========================================
// ORQUESTRAÇÃO DE DOWNLOAD LOTE
// ==========================================
async function initiateDownloadQueue(videosObjList) {
  const listForQueue = videosObjList.map(v => ({ id: v.videoId, url: v.url, title: v.title }));

  document.getElementById('download-panel').classList.remove('hidden');
  const dlStatus = document.getElementById('dl-status');
  const dlProgress = document.getElementById('dl-progress');
  const btnDown = document.getElementById('btn-download-all');
  btnDown.disabled = true;

  // Track global progress mapping
  const progressMap = {};
  let currentIndexText = `1 de ${listForQueue.length}`;

  // Limpa botoes individuais
  listForQueue.forEach(v => {
    const btn = document.getElementById(`btn-dl-${v.id}`);
    if (btn) btn.disabled = true;
  });

  await downloadPlaylistUrls(
    listForQueue,
    (vId, downloadedObjSize, totalObjSize) => {
      // Update individual
      const pctItem = totalObjSize > 0 ? (downloadedObjSize / totalObjSize) : 0;
      progressMap[vId] = pctItem;
      const txtSpan = document.getElementById(`dl-text-${vId}`);
      if (txtSpan) txtSpan.innerText = `Baixando fila: ${(pctItem * 100).toFixed(0)}%`;

      // Update global
      const totalPercent = Object.values(progressMap).reduce((a, b) => a + b, 0) / listForQueue.length * 100;
      dlProgress.value = totalPercent;
      dlStatus.innerText = `Sincronizando ${currentIndexText}: ${(totalPercent).toFixed(1)}% Completo`;
    },
    (vId, success) => {
      const finishedIdx = listForQueue.findIndex(x => x.id === vId) + 1;
      currentIndexText = `${Math.min(finishedIdx + 1, listForQueue.length)} de ${listForQueue.length}`;
    }
  );

  dlStatus.innerText = "Sincronização 100% Finalizada!";
  dlProgress.value = 100;
  setTimeout(() => {
    btnDown.disabled = false;
    render();
  }, 1500);
}

// ==========================================
// UX: AUTO-FULLSCREEN POR ROTAÇÃO (MOBILE)
// ==========================================
window.addEventListener('orientationchange', () => {
  const player = document.getElementById('player');
  if (!player) return;

  // 90 ou -90 (Landscape) | 0 ou 180 (Portrait)
  if (Math.abs(window.orientation) === 90) {
    if (player.requestFullscreen) {
      player.requestFullscreen().catch(err => console.log('Fullscreen barrado pelo SO:', err));
    } else if (player.webkitRequestFullscreen) { /* Safari */
      player.webkitRequestFullscreen();
    }
  } else {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) { /* Safari */
        document.webkitExitFullscreen();
      }
    }
  }
});

// ==========================================
// PERSISTENT STORAGE (Proteção de Limpeza)
// ==========================================
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      isStoragePersistent = granted;
      console.log(`[Storage] Persistência concedida: ${granted}`);
    } else {
      isStoragePersistent = true;
      console.log("[Storage] Já estava persistente.");
    }
  }
}

// Request imediato ao carregar script
requestPersistentStorage();

// ==========================================
// DEEP LINKING (PWA Protocol Handlers URL Interceptor)
// ==========================================
async function checkDeepLinks() {
  const urlParams = new URLSearchParams(window.location.search);
  const importData = urlParams.get('import');

  if (importData && importData.startsWith('web+vod://import?data=')) {
    const encodedPayload = importData.replace('web+vod://import?data=', '');

    try {
      const payload = JSON.parse(decodeURIComponent(encodedPayload));

      if (confirm(`Alguém compartilhou "${payload.name}" com ${payload.videos?.length} vídeos. Deseja importar?`)) {

        const newPlId = await db.playlists.put({
          name: payload.name + ' (Importada)',
          cover_image_url: payload.cover,
          createdAt: new Date()
        });

        // Carrega catalogo antes pra cruzar dados ricos
        if (cachedCatalog.length === 0) {
          cachedCatalog = await getRemoteVideos();
        }

        let orderCounter = 0;
        for (const simpleVid of payload.videos) {
          const remoteReference = cachedCatalog.find(c => c.id == simpleVid.id);
          if (remoteReference) {
            const localVidId = 'vid_' + remoteReference.id + '_' + Date.now() + Math.random().toString(36).substr(2, 5);
            await db.playlist_videos.put({
              playlistId: newPlId,
              videoId: localVidId,
              url: remoteReference.download_url,
              youtube_url: remoteReference.youtube_url,
              thumbnail_url: remoteReference.thumbnail_url,
              title: remoteReference.title,
              order: orderCounter++
            });
          }
        }

        alert('Playlist importada com sucesso!');

        // Limpar URL bar depois
        window.history.replaceState({}, document.title, window.location.pathname);
        currentPlaylistId = newPlId;
        viewState = 'PLAYLIST';
      } else {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {
      console.error('Falha ao decodificar QR', e);
      alert("O QR Code lido é inválido ou está corrompido.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

// ==========================================
// BOOT INIT E SW REGISTRATION
// ==========================================

const updateSW = registerSW({
  onNeedRefresh() {
    console.log("Novo conteúdo disponível. O SW vai atualizar o App Shell na próxima recarga.");
  },
  onOfflineReady() {
    console.log("App pronto para trabalhar 100% offline nativamente.");
  },
});

async function boot() {
  await checkDeepLinks();
  render();
}
boot();
