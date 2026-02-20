import Dexie from 'dexie';

export const db = new Dexie('VodPwaDB');

db.version(1).stores({
    videos: 'id, title, size, downloaded, duration, mimeType',
    chunks: '++id, [videoId+index], videoId, index, size'
});
