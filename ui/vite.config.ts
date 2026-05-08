import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { rubricApi } from './src/server/api-plugin.js';

const projectRoot = process.env.RUBRIC_PROJECT_ROOT || resolve(process.cwd(), '../..');

export default defineConfig({
	plugins: [
		svelte(),
		rubricApi({
			projectRoot,
			featuresDir: resolve(projectRoot, 'features'),
			aspectsDir: resolve(projectRoot, 'aspects'),
			runsDir: resolve(projectRoot, '.runs'),
			rubricDir: resolve(projectRoot, 'rubric'),
		}),
	],
	server: {
		port: 3010,
	},
});
