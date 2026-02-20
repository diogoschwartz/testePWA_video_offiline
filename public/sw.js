importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js');

const db = new Dexie('VodPwaDB');
db.version(2).stores({
    videos: 'id, title, size, downloaded, duration, mimeType',
    chunks: '++id, [videoId+index], videoId, index, size',
    playlists: '++id, name, createdAt',
    playlist_videos: '++id, playlistId, videoId, url, title, order'
});

const VIDEO_PREFIX = '/offline-video/';
const CHUNK_SIZE = 2 * 1024 * 1024; // Deve bater com o downloader.js

const CACHE_NAME = 'vod-app-shell-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/style.css',
    '/src/main.js'
];

self.addEventListener('install', (event) => {
    // Adiciona o esqueleto do site no Cache pre-cache
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Limpa caches antigos do app shell
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Interceptação de Vídeo Offline via IDB
    if (url.pathname.startsWith(VIDEO_PREFIX)) {
        return event.respondWith(handleVideoRequest(event.request, url.pathname));
    }

    // 2. Interceptação de Assets (App Shell) ou API
    // Stale-while-revalidate ou Network-first fallback to cache
    if (event.request.method === 'GET' && !url.pathname.startsWith('/api/') && !url.hostname.includes('s3') && !url.hostname.includes('googleapis')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                // Se ta no cache, devolve. Enquanto busca atualizado escondido (stale)
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return networkResponse;
                }).catch(() => {
                    // Modo full offline e sem cache (ex: arquivo novo nunca visto)
                    // Se for request de pagina, manda index.html
                    if (event.request.headers.get('accept').includes('text/html')) {
                        return caches.match('/');
                    }
                });

                return cachedResponse || fetchPromise;
            })
        );
    }
});

async function handleVideoRequest(request, pathname) {
    const videoId = pathname.replace(VIDEO_PREFIX, '');

    const video = await db.videos.get(videoId);
    if (!video) {
        return new Response('Video not found in IDB', { status: 404 });
    }

    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) {
        // Se não mandar bytes range, devolvemos resposta seca pra instigar requests de range
        return new Response(null, {
            status: 200,
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': video.size,
                'Content-Type': video.mimeType
            }
        });
    }

    // Parseia a requisição de bytes
    const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!matches) {
        return new Response('Invalid Range', { status: 416 });
    }

    const start = parseInt(matches[1], 10);
    // Limita a ~5MB por req 206 para evitar congestionamento na pipe
    const end = matches[2] ? parseInt(matches[2], 10) : Math.min(start + (5 * 1024 * 1024) - 1, video.size - 1);

    const contentLength = (end - start) + 1;

    // Descobre quais chunks possuem esses bytes
    const startChunkIndex = Math.floor(start / CHUNK_SIZE);
    const endChunkIndex = Math.floor(end / CHUNK_SIZE);

    const chunkPromises = [];
    for (let i = startChunkIndex; i <= endChunkIndex; i++) {
        chunkPromises.push(db.chunks.where({ videoId, index: i }).first());
    }

    const chunks = await Promise.all(chunkPromises);

    // Concatena as partes do array buffer
    const fullBuffer = new Uint8Array(chunks.length * CHUNK_SIZE);
    let offset = 0;
    for (const c of chunks) {
        if (c && c.data) {
            fullBuffer.set(c.data, offset);
        }
        offset += CHUNK_SIZE;
    }

    // Corta de volta pro range exato solicitado
    const rangeStartOffset = start - (startChunkIndex * CHUNK_SIZE);
    const responseData = fullBuffer.subarray(rangeStartOffset, rangeStartOffset + contentLength);

    return new Response(responseData, {
        status: 206,
        headers: {
            'Content-Range': `bytes ${start}-${end}/${video.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': video.mimeType
        }
    });
}
