import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: '/',
    plugins: [
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            injectManifest: {
                injectionPoint: 'self.__WB_MANIFEST'
            },
            devOptions: {
                enabled: true,
                type: 'module'
            },
            manifest: {
                name: 'Dialogo Dirigido Offline',
                short_name: 'Dialogo Off',
                description: 'PWA de vídeos corporativos para acesso offline',
                theme_color: '#0f172a',
                icons: [
                    {
                        src: 'https://dna-positivo.vercel.app/_next/image?url=%2Fimg%2Flogo-180x180.jpg&w=384&q=75',
                        sizes: '192x192',
                        type: 'image/png'
                    }
                ],
                protocol_handlers: [
                    {
                        protocol: 'web+vod',
                        url: '/?import=%s'
                    }
                ]
            }
        })
    ]
});
