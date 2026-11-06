import './scene.js';
import { writeFileSync } from 'node:fs';

// The SVG shares the exact composition used by the animated OpenDemo scene.
const output = new URL('../docs/assets/connectduet-overview.svg', import.meta.url);
writeFileSync(output, globalThis.ConnectDuetScene.frame(10.8));
console.log('Wrote docs/assets/connectduet-overview.svg');
