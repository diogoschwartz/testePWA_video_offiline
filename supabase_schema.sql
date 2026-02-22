-- Schema para o Catálogo Global de Vídeos no Supabase
-- Rode este SQL no "SQL Editor" do seu painel Supabase.

-- 1. Criar a Tabela principal
CREATE TABLE public.remote_videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    download_url TEXT NOT NULL,
    youtube_url TEXT,
    thumbnail_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Configurar Políticas de Segurança (Row Level Security - RLS)
-- Isso permite que o aplicativo React (Client-side) consiga LER os vídeos, mas não consiga DELETAR ou MODIFICAR.
-- Somente você pelo painel do Supabase poderá inserir e deletar o catálogo oficial.
ALTER TABLE public.remote_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura anonima de VODs" ON public.remote_videos
    FOR SELECT USING (true);

-- 3. Tabela de Playlists Remotas (para Sincronização)
CREATE TABLE public.remote_playlists (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    cover_image_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabela de Relacionamento Playlist -> Vídeos
CREATE TABLE public.remote_playlist_videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    playlist_id UUID REFERENCES public.remote_playlists(id) ON DELETE CASCADE,
    video_id UUID REFERENCES public.remote_videos(id),
    "order" INTEGER NOT NULL
);

-- 5. RLS para Playlists
ALTER TABLE public.remote_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remote_playlist_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura anonima playlists" ON public.remote_playlists FOR SELECT USING (true);
CREATE POLICY "Leitura anonima playlist_videos" ON public.remote_playlist_videos FOR SELECT USING (true);

