import './style.css';
import { db } from './services/db';
import { downloadPlaylistUrls, deleteVideo } from './services/downloader';

const app = document.querySelector('#app');

// ==========================================
// ESTADOS DA INTERFACE
// ==========================================
let viewState = 'HOME'; // HOME | PLAYLIST
let currentPlaylistId = null;
let activeVideoIndex = -1; // Pra tocar sequencial
let playingVideoId = null;

// ==========================================
// RENDERIZADOR BASE
// ==========================================
function render() {
  if (viewState === 'HOME') {
    renderHome();
  } else if (viewState === 'PLAYLIST') {
    renderPlaylistView();
  }
}

// ==========================================
// TELA INITIAL: Criar / Listar Playlists
// ==========================================
async function renderHome() {
  const playlists = await db.playlists.toArray();

  app.innerHTML = `
    <div class="card">
      <h1>Playlists Offline</h1>
      <p>Crie coleções de vídeos para assistir sem internet.</p>
      
      <div class="input-group" style="margin-top: 1rem;">
         <label style="font-size: 0.85rem; font-weight: 500;">Nova Playlist:</label>
         <div class="input-row">
           <input type="text" id="new-playlist-name" placeholder="Ex: Curso de Dentista Módulo 1" />
           <button id="btn-create-playlist">Criar</button>
         </div>
      </div>
    </div>

    <div class="card">
      <h2>Suas Playlists</h2>
      <div class="list-group" id="playlist-list">
         ${playlists.length === 0 ? '<p class="info">Nenhuma playlist. Crie uma acima!</p>' : ''}
      </div>
    </div>
  `;

  // Bind Create
  document.getElementById('btn-create-playlist').addEventListener('click', async () => {
    const nameInput = document.getElementById('new-playlist-name');
    const name = nameInput.value.trim();
    if (name) {
      await db.playlists.put({ name, createdAt: new Date() });
      nameInput.value = '';
      render();
    }
  });

  // Bind List
  const listEl = document.getElementById('playlist-list');
  for (const pl of playlists) {
    const count = await db.playlist_videos.where({ playlistId: pl.id }).count();
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
        <div class="item-info">
           <div class="item-title">${pl.name}</div>
           <div class="item-meta">${count} vídeos</div>
        </div>
        <button class="ghost" style="padding: 0.4rem 0.8rem;">Abrir</button>
     `;
    item.addEventListener('click', () => {
      currentPlaylistId = pl.id;
      activeVideoIndex = -1;
      viewState = 'PLAYLIST';
      render();
    });
    listEl.appendChild(item);
  }
}

// ==========================================
// TELA PLAYLIST: Player, Add URL, Lista
// ==========================================
async function renderPlaylistView() {
  const playlist = await db.playlists.get(currentPlaylistId);
  if (!playlist) { viewState = 'HOME'; return render(); }

  // Busca do DB
  const videos = await db.playlist_videos.where({ playlistId: playlist.id }).sortBy('order');
  const videosMeta = await Promise.all(videos.map(v => db.videos.get(v.videoId)));

  app.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
       <button id="btn-back" class="ghost">← Voltar</button>
       <h2 style="border: none; margin:0; padding:0;">${playlist.name}</h2>
    </div>

    <!-- PLAYER SEQUENCIAL -->
    <div class="video-container ${activeVideoIndex === -1 ? 'hidden' : ''}">
      <video id="player" controls controlsList="nodownload" autoplay></video>
    </div>
    
    <!-- ADD NOVO VIDEO NA PLAYLIST -->
    <div class="card">
       <h3>Adicionar Vídeo</h3>
       <div class="input-group">
         <div class="input-row">
            <input type="text" id="new-video-title" placeholder="Título. Ex: Aula 01" style="width: 30%" />
            <input type="text" id="new-video-url" placeholder="URL do arquivo .mp4..." style="flex:1" />
         </div>
         <button id="btn-add-video" style="align-self: flex-start; margin-top: 0.5rem">Adicionar na Fila</button>
       </div>
    </div>

    <!-- LISTA DE VIDEOS -->
    <div class="card">
       <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 1rem;">
          <h3>Fila de Reprodução</h3>
          <div>
            <button id="btn-download-all">Baixar Offline</button>
            <button id="btn-delete-all" class="danger">Limpar Mídia</button>
          </div>
       </div>

       <!-- Painel de Porgresso Global Oculto -->
       <div id="download-panel" class="progress-container hidden" style="margin-bottom: 1rem;">
          <div class="info" id="dl-status">Iniciando download...</div>
          <progress id="dl-progress" value="0" max="100"></progress>
       </div>

       <div class="list-group" id="video-list">
         ${videos.length === 0 ? '<p class="info">Sua playlist está vazia.</p>' : ''}
       </div>
    </div>
  `;

  document.getElementById('btn-back').addEventListener('click', () => {
    viewState = 'HOME';
    render();
  });

  // ADD VIDEO
  document.getElementById('btn-add-video').addEventListener('click', async () => {
    const tEl = document.getElementById('new-video-title');
    const uEl = document.getElementById('new-video-url');
    if (tEl.value.trim() && uEl.value.trim()) {
      const vidId = 'vid_' + Date.now();
      await db.playlist_videos.put({
        playlistId: playlist.id,
        videoId: vidId,
        url: uEl.value.trim(),
        title: tEl.value.trim(),
        order: videos.length
      });
      render(); // Reload rapido
    }
  });

  // RENDERIZA LISTA DOS VÍDEOS COM STATUS GHOST
  const listEl = document.getElementById('video-list');
  videos.forEach((v, idx) => {
    const meta = videosMeta[idx];
    const isDownloaded = meta && meta.downloaded >= meta.size && meta.size > 0;

    const item = document.createElement('div');
    item.className = 'list-item';
    if (!isDownloaded) item.classList.add('not-downloaded');
    if (idx === activeVideoIndex) item.classList.add('active');

    item.innerHTML = `
        <div class="item-info">
           <div class="item-title">${v.order + 1}. ${v.title}</div>
           <div class="item-meta">${isDownloaded ? 'Disponível Offline ✓' : 'Precisa de Download (Remoto)'}</div>
        </div>
        <button class="ghost" style="padding: 0.3rem 0.6rem;">${idx === activeVideoIndex ? 'Tocando' : 'Tocar'}</button>
     `;

    item.addEventListener('click', () => {
      playSequence(idx, videos, videosMeta);
    });
    listEl.appendChild(item);
  });

  // BOTÕES DE AÇÃO LOTE
  const btnDownloadAll = document.getElementById('btn-download-all');
  btnDownloadAll.addEventListener('click', () => initiateDownloadQueue(videos));

  document.getElementById('btn-delete-all').addEventListener('click', async () => {
    for (const v of videos) {
      await deleteVideo(v.videoId);
    }
    render();
  });

  // SE JÁ ESTIVER TOCANDO, CONECTA EVENTOS NO PLAYER
  if (activeVideoIndex !== -1) {
    const player = document.getElementById('player');
    player.onended = () => {
      // Auto-play next available!
      playNextOffline(activeVideoIndex, videos, videosMeta);
    };
    // Se houver erro de decodificacao (falta conexao e nao ta baixado), pula pro prox tbm
    player.onerror = () => {
      console.warn("Vídeo corrompido ou offline falhou, pulando...");
      playNextOffline(activeVideoIndex, videos, videosMeta);
    }
  }
}

// ==========================================
// TOCA SEQUENCIAL
// ==========================================
function playSequence(index, allVideos, allMeta) {
  activeVideoIndex = index;
  render(); // reconstrói pra mostrar a caixa de video e marcar active

  // Delay tick pra garatir que a DOM recriou o #player
  setTimeout(() => {
    const videoToPlay = allVideos[index];
    const metaToPlay = allMeta[index]; // array parelelo de metadados
    const player = document.getElementById('player');
    const isDownloaded = metaToPlay && metaToPlay.downloaded >= metaToPlay.size && metaToPlay.size > 0;

    // ESTRATÉGIA:
    // Se baixado, usa o Service Worker Proxy (que toca perfeitamente Range Headers locais)
    // Se NÃO baixado (apertou play ansioso online), toca a URL real remota (CORS limit)
    if (isDownloaded) {
      player.src = `/offline-video/${videoToPlay.videoId}`;
    } else {
      player.src = videoToPlay.url;
    }

    player.play().catch(e => console.error("Auto-play blindado?:", e));
  }, 50);
}

// Procura o próximo que esteja offline pra tocar
function playNextOffline(currentIndex, allVideos, allMeta) {
  let nextIdx = currentIndex + 1;

  // Acha o primeiro disponivel pra pular
  while (nextIdx < allVideos.length) {
    const m = allMeta[nextIdx];
    // Pula se for "not-downloaded", para forçar reproducao confiavel offline
    // Mas permitiria remoto se não fosse estrito. Vamos ser estritos.
    if (m && m.downloaded >= m.size && m.size > 0) {
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

  // A track dos progressos isolados de cada arquivo pra fazer uma media global
  const progressMap = {};
  let currentIndexText = `1 de ${listForQueue.length}`;

  await downloadPlaylistUrls(
    listForQueue,
    (vId, downloadedObjSize, totalObjSize) => {
      // Update progresso
      if (totalObjSize > 0) {
        progressMap[vId] = downloadedObjSize / totalObjSize;
      } else {
        progressMap[vId] = 0;
      }
      // Soma todos pra dar media da fila
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
    render(); // Dá f5 visual pra tirar a transparencia (ghost) dos novos offline
  }, 1500);
}


// ==========================================
// BOOT INIT
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }));
}
render();
