import './style.css';
import { db } from './services/db';
import { downloadPlaylistUrls, deleteVideo, downloadVideo } from './services/downloader';
import { getRemoteVideos } from './services/supabase';

const app = document.querySelector('#app');

// ==========================================
// ESTADOS DA INTERFACE
// ==========================================
let viewState = 'HOME'; // HOME | PLAYLIST
let currentPlaylistId = null;
let activeVideoIndex = -1; // Pra tocar sequencial
let playingVideoId = null;

// Cache do catálogo pra não bater no DB toda hora
let cachedCatalog = [];

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
// TELA INITIAL: Criar / Listar Playlists / Catálogo
// ==========================================
async function renderHome() {
  const playlists = await db.playlists.toArray();

  // Fetch do Supabase (Apenas se ainda nao o fez)
  if (cachedCatalog.length === 0) {
    cachedCatalog = await getRemoteVideos();
  }

  app.innerHTML = `
    <!-- HEADER APP -->
    <div style="text-align:center; padding-bottom: 2rem;">
        <h1 style="color: var(--primary); font-size: 2.2rem;">PWA Premium VOD</h1>
        <p>Filmes e Cursos. Offline First.</p>
    </div>

    <!-- SEÇÃO 1: CATÁLOGO NUVEM (SUPABASE) -->
    <div class="card" style="border-top: 4px solid var(--primary);">
       <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2>Catálogo em Nuvem ☁️</h2>
          <span style="font-size:0.8rem; color: var(--text-muted)">via Supabase</span>
       </div>
       <div class="list-group">
          ${cachedCatalog.length === 0 ? '<p class="info">Nenhum vídeo cadastrado no Supabase ainda.</p>' : ''}
          ${cachedCatalog.map(v => `
              <div class="list-item" style="display: flex; gap: 1rem; align-items:flex-start;">
                 ${v.thumbnail_url ? `<img src="${v.thumbnail_url}" style="width: 100px; border-radius: 6px; aspect-ratio: 16/9; object-fit: cover; background: #eee" />` : ''}
                 <div class="item-info">
                     <div class="item-title">${v.title}</div>
                     <div class="item-meta" style="white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${v.description || 'Sem descrição.'}</div>
                 </div>
              </div>
          `).join('')}
       </div>
    </div>

    <!-- SEÇÃO 2: PLAYLISTS LOCAIS (Sua Biblioteca) -->
    <div class="card">
      <h2>Sua Biblioteca Offline</h2>
      <div class="input-group" style="margin-top: 1rem;">
         <div class="input-row">
           <input type="text" id="new-playlist-name" placeholder="Criar nova playlist... Ex: Minha Viagem" />
           <button id="btn-create-playlist">+ Criar</button>
         </div>
      </div>
      <div class="list-group" id="playlist-list" style="margin-top: 1rem;">
         ${playlists.length === 0 ? '<p class="info">Nenhuma playlist. Crie uma acima para começar a adicionar os vídeos da nuvem!</p>' : ''}
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

  // Bind List de Playlists
  const listEl = document.getElementById('playlist-list');
  for (const pl of playlists) {
    const count = await db.playlist_videos.where({ playlistId: pl.id }).count();
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
        <div class="item-info">
           <div class="item-title">${pl.name}</div>
           <div class="item-meta">${count} mídia(s)</div>
        </div>
        <button class="ghost" style="padding: 0.4rem 0.8rem;">Entrar</button>
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
// TELA PLAYLIST: Player, Add via Catalog, Fila
// ==========================================
async function renderPlaylistView() {
  const playlist = await db.playlists.get(currentPlaylistId);
  if (!playlist) { viewState = 'HOME'; return render(); }

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
    
    <!-- ADD NOVO VIDEO NA PLAYLIST (VIA CATALOGO AGORA) -->
    <div class="card">
       <h3>Adicionar Mídia à Lista</h3>
       <div class="input-row">
         <select id="catalog-select" style="flex:1; padding: 0.6rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit;">
            <option value="">Selecione um vídeo da nuvem...</option>
            ${cachedCatalog.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
         </select>
         <button id="btn-add-video" style="align-self: flex-start;">+ Inserir</button>
       </div>
    </div>

    <!-- LISTA DE VIDEOS COM BOTÕES VISUAIS -->
    <div class="card">
       <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 1rem;">
          <h3>🎬 Reprodução e Downloads</h3>
          <div>
            <button id="btn-download-all" class="ghost" style="font-size: 0.8rem; padding: 0.4rem 0.6rem">Sincronizar Tudo</button>
            <button id="btn-delete-all" class="danger" style="font-size: 0.8rem; padding: 0.4rem 0.6rem">Esvaziar Storage</button>
          </div>
       </div>

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

  // ADD VIDEO (From Catalog)
  document.getElementById('btn-add-video').addEventListener('click', async () => {
    const catalogId = document.getElementById('catalog-select').value;
    if (catalogId) {
      const remoteInfo = cachedCatalog.find(c => c.id === catalogId);
      if (!remoteInfo) return;

      const vidId = 'vid_' + remoteInfo.id + '_' + Date.now();
      await db.playlist_videos.put({
        playlistId: playlist.id,
        videoId: vidId,
        url: remoteInfo.download_url,
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
      actionBtnHTML = `<button class="btn-play-item" data-idx="${idx}" style="background-color: var(--success);">▶ Play</button>`;
    } else {
      actionBtnHTML = `<button class="btn-download-item ghost" data-idx="${idx}" data-vid="${v.videoId}" data-url="${v.url}">⬇️ Baixar</button>`;
    }

    item.innerHTML = `
        <div class="item-info">
           <div class="item-title">${v.order + 1}. ${v.title}</div>
           <div class="item-meta">
              ${isDownloaded ? '<span style="color:var(--success)">✓ Offline Prontinho</span>' : '☁️ Nuvem (Não baixado)'}
           </div>
        </div>
        <div>
           ${idx === activeVideoIndex ? '<span style="margin-right: 1rem; color: var(--primary); font-weight:bold; font-size: 0.8rem">Tocando</span>' : ''}
           ${actionBtnHTML}
        </div>
     `;

    listEl.appendChild(item);
  });

  // Event Listeners Dinamicos pros botoes da lista
  document.querySelectorAll('.btn-play-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-idx'));
      playSequence(idx, videos, videosMeta);
    });
  });

  document.querySelectorAll('.btn-download-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const url = btn.getAttribute('data-url');
      const vId = btn.getAttribute('data-vid');
      btn.disabled = true;
      btn.innerText = "⏳...";

      try {
        await downloadVideo(url, vId, (d, t) => { });
        render(); // Rerenderiza pra virar botaO PLAY verde
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.innerText = "❌ Falha";
        btn.style.color = "var(--danger)";
      }
    });
  });

  // BOTÕES MESTRES
  const btnDownloadAll = document.getElementById('btn-download-all');
  btnDownloadAll.addEventListener('click', () => initiateDownloadQueue(videos));

  document.getElementById('btn-delete-all').addEventListener('click', async () => {
    for (const v of videos) {
      await deleteVideo(v.videoId);
    }
    render();
  });

  // Lógica de PLAY SEQUENCIAL
  if (activeVideoIndex !== -1) {
    const player = document.getElementById('player');
    player.onended = () => {
      playNextOffline(activeVideoIndex, videos, videosMeta);
    };
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
// BOOT INIT E SW REGISTRATION
// ==========================================
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    console.log("Novo conteúdo disponível. O SW vai atualizar o App Shell na próxima recarga.");
  },
  onOfflineReady() {
    console.log("App pronto para trabalhar 100% offline nativamente.");
  },
});

render();
