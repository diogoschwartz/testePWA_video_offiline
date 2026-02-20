import './style.css';
import { downloadVideo, deleteVideo } from './services/downloader';
import { db } from './services/db';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="card">
    <h1>Premium VOD Offline</h1>
    
    <div class="video-container">
      <video id="player" controls controlsList="nodownload"></video>
    </div>

    <div class="controls">
      <button id="btn-download">Baixar Vídeo</button>
      <button id="btn-play" disabled>Reproduzir Offline</button>
      <button id="btn-delete" class="danger">Limpar</button>
    </div>

    <div class="progress-container">
      <progress id="progress-bar" value="0" max="100"></progress>
      <div class="info" id="status-text">Pronto. Nenhum vídeo offline.</div>
    </div>
  </div>
`;

// Variables
const SAMPLE_VIDEO_URL = 'http://s3-rustfs-c19102-157-173-125-254.traefik.me/teste/129%20-%20Profissa%CC%83o%20Dentista%20e%20doenc%CC%A7as%20bucaiss.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=rustfsadmin%2F20260220%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260220T133750Z&X-Amz-Expires=7200&X-Amz-Signature=1a837c031af6b800c056d9a65d2a1b7685035834e8f47b9b230c211ec9d42cba&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject';
const VIDEO_ID = 'elephants-dream';

const btnDownload = document.getElementById('btn-download');
const btnDelete = document.getElementById('btn-delete');
const btnPlay = document.getElementById('btn-play');
const progressBar = document.getElementById('progress-bar');
const statusText = document.getElementById('status-text');
const player = document.getElementById('player');

// Registrar SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => console.log('SW Registrado no controle de rota!', reg.scope))
      .catch(err => console.error('Erro no SW:', err));
  });
}

async function updateUI() {
  const video = await db.videos.get(VIDEO_ID);
  if (video && video.downloaded > 0 && video.downloaded >= video.size) {
    statusText.innerText = 'Vídeo salvo 100% offline!';
    progressBar.value = 100;
    btnDownload.disabled = true;
    btnPlay.disabled = false;
  } else {
    statusText.innerText = 'Vídeo não existe em cache.';
    progressBar.value = 0;
    btnDownload.disabled = false;
    btnPlay.disabled = true;
  }
}

btnDownload.addEventListener('click', async () => {
  btnDownload.disabled = true;
  statusText.innerText = 'Conectando e baixando em chunks...';
  try {
    await downloadVideo(SAMPLE_VIDEO_URL, VIDEO_ID, (downloaded, total) => {
      if (total > 0) {
        const percent = Math.round((downloaded / total) * 100);
        progressBar.value = percent;
        statusText.innerText = `Baixando... ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)} MB - Salvo no IndexedDB)`;
      }
    });
    updateUI();
  } catch (err) {
    statusText.innerText = 'Erro no download!';
    btnDownload.disabled = false;
  }
});

btnDelete.addEventListener('click', async () => {
  await deleteVideo(VIDEO_ID);
  player.removeAttribute('src'); // Limpa player
  player.load();
  updateUI();
  statusText.innerText = 'Chunks deletados do aparelho.';
});

btnPlay.addEventListener('click', () => {
  // A mágica: passamos uma URL virtual que sabemos que o Service Worker
  // vai interceptar. O SW vai pegar a URL, consultar o IDB e montar a resposta pseudo-HTTP 206
  player.src = `/offline-video/${VIDEO_ID}`;
  player.play();
  statusText.innerText = 'Reproduzindo localmente pelo IndexedDB e SW Proxy 🔥';
});

// Init
updateUI();
