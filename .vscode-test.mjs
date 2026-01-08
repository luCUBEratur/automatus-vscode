import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: [
		'out/test/**/*.test.js',
		'!out/test/type-safety/**/*.test.js'
	],
});
