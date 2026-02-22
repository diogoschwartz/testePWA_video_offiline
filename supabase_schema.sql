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

