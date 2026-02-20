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
            }
        })
    ]
});
