import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Serviço Helper para centralizar a busca
export async function getRemoteVideos() {
    const { data, error } = await supabase
        .from('remote_videos')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Erro ao buscar vídeos do Supabase:', error);
        return [];
    }
    return data;
}

export async function getRemotePlaylist(name) {
    const { data, error } = await supabase
        .from('remote_playlists')
        .select('*')
        .eq('name', name)
        .single();
    if (error) {
        console.error('Erro ao buscar playlist remota:', error);
        return null;
    }
    return data;
}

export async function getRemotePlaylistVideos(remotePlaylistId) {
    const { data, error } = await supabase
        .from('remote_playlist_videos')
        .select('video_id, order, remote_videos(*)')
        .eq('playlist_id', remotePlaylistId)
        .order('order', { ascending: true });

    if (error) {
        console.error('Erro ao buscar vídeos da playlist remota:', error);
        return [];
    }
    return data;
}

export async function upsertRemotePlaylist(playlist) {
    // Tenta inserir ou atualizar pelo NOME UNIQUE
    const { data, error } = await supabase
        .from('remote_playlists')
        .upsert({
            name: playlist.name.replace('db:', '').trim(),
            cover_image_url: playlist.cover_image_url,
            updated_at: new Date()
        }, { onConflict: 'name' })
        .select()
        .single();

    if (error) {
        console.error('Erro ao subir playlist para Supabase:', error);
        throw error;
    }
    return data;
}

export async function upsertRemotePlaylistVideos(remotePlaylistId, videos) {
    // 1. Limpa os vídeos atuais da playlist remota (para bater com a local atual)
    await supabase.from('remote_playlist_videos').delete().eq('playlist_id', remotePlaylistId);

    // 2. Insere os novos (referenciando o ID do vídeo no catálogo remoto)
    const toInsert = videos.map(v => ({
        playlist_id: remotePlaylistId,
        video_id: v.videoId.replace('vid_', ''),
        order: v.order
    }));

    const { error } = await supabase.from('remote_playlist_videos').insert(toInsert);
    if (error) {
        console.error('Erro ao subir vídeos da playlist remota:', error);
        throw error;
    }
}
