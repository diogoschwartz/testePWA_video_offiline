import { db } from './db';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB por chunk

export async function downloadVideo(url, videoId, onProgress) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            let errorTxt = '';
            try { errorTxt = await response.text(); } catch (e) { }
            throw new Error(`Falha HTTP ${response.status} ${response.statusText}: ${errorTxt.substring(0, 100)}`);
        }

        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        const mimeType = response.headers.get('content-type') || 'video/mp4';

        // Registrando metadados do vídeo no IDB
        await db.videos.put({
            id: videoId,
            title: url.split('/').pop() || 'video.mp4',
            size: totalSize,
            downloaded: 0,
            mimeType
        });

        const reader = response.body.getReader();
        let downloadedSize = 0;
        let chunkIndex = 0;

        // Buffer para ir guardando pedaços do stream até dar 2MB
        let buffer = new Uint8Array(CHUNK_SIZE);
        let bufferOffset = 0;

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                // Salva o restinho de dados que sobrou no buffer
                if (bufferOffset > 0) {
                    const finalChunk = buffer.slice(0, bufferOffset);
                    await db.chunks.put({
                        videoId,
                        index: chunkIndex,
                        size: finalChunk.length,
                        data: finalChunk
                    });
                }
                break;
            }

            // Processa os dados que vieram do getReader()
            let valueOffset = 0;
            while (valueOffset < value.length) {
                const spaceInBuffer = CHUNK_SIZE - bufferOffset;
                const bytesToCopy = Math.min(spaceInBuffer, value.length - valueOffset);

                buffer.set(value.subarray(valueOffset, valueOffset + bytesToCopy), bufferOffset);
                bufferOffset += bytesToCopy;
                valueOffset += bytesToCopy;
                downloadedSize += bytesToCopy;

                if (bufferOffset === CHUNK_SIZE) {
                    // Buffer cheio (2MB), faz o flush para o IndexedDB
                    await db.chunks.put({
                        videoId,
                        index: chunkIndex,
                        size: CHUNK_SIZE,
                        data: new Uint8Array(buffer) // copia o ref de mem pra não colidir
                    });
                    chunkIndex++;
                    bufferOffset = 0; // reseta buffer logicamente

                    // Notifica progresso e avança o registrador
                    await db.videos.update(videoId, { downloaded: downloadedSize });
                    if (onProgress) {
                        onProgress(downloadedSize, totalSize);
                    }
                }
            }
        }

        // Download 100% finalizado
        await db.videos.update(videoId, { downloaded: downloadedSize, size: Math.max(totalSize, downloadedSize) });
        if (onProgress) {
            onProgress(downloadedSize, Math.max(totalSize, downloadedSize));
        }

        console.log(`🎬 Download [${videoId}] concluído!`);
    } catch (err) {
        console.error(`Erro baixando [${videoId}]:`, err);
        throw err;
    }
}

export async function deleteVideo(videoId) {
    await db.chunks.where({ videoId }).delete();
    await db.videos.delete(videoId);
}
