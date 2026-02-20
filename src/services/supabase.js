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
