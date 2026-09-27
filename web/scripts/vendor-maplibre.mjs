// Воркер MapLibre 6 и его общий модуль кладутся в public/assets как есть, из пакета.
// Библиотека ищет воркер рядом со своим бандлом (new URL('./maplibre-gl-worker.mjs',
// import.meta.url)), а сборщик его не эмитит; собранный сборщиком воркер
// поднимался, но тайлы не качал. Запускается хуками predev и prebuild;
// скопированные файлы в git не входят.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', 'maplibre-gl', 'dist')
const dst = join(root, 'public', 'assets')
mkdirSync(dst, { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(src, f), join(dst, f))
console.log('maplibre worker → public/assets')
