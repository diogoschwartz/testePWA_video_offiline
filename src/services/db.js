import Dexie from 'dexie';

export const db = new Dexie('VodPwaDB');

db.version(2).stores({
    videos: 'id, title, size, downloaded, duration, mimeType',
    chunks: '++id, [videoId+index], videoId, index, size',
    playlists: '++id, name, createdAt',
    playlist_videos: '++id, playlistId, videoId, url, title, order'
});
