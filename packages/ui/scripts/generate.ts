/**
 * CLI entrypoint: regenerate committed platform artifacts.
 * Run: `pnpm build` or `pnpm generate`.
 */
import { writeGenerated } from '../src/generate/generate.js';

const files = writeGenerated();
console.log(`[generate] regenerated ${files.join(', ')}`);
