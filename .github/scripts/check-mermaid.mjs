#!/usr/bin/env node
/**
 * Lightweight, dependency-free structural check for ```mermaid code blocks.
 *
 * A full parse needs a headless browser (mermaid renders in the DOM), which is
 * flaky in CI. This instead catches the mistakes that actually happen in docs:
 * empty blocks, an unclosed fence, or a first line that is not a recognised
 * Mermaid diagram directive (typo'd/omitted diagram type, prose pasted in).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIAGRAM_DIRECTIVES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey',
  'sankey-beta',
  'xychart',
  'xychart-beta',
  'block',
  'block-beta',
  'packet',
  'packet-beta',
  'architecture',
  'architecture-beta',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

function statSyncSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

const files = new Set();

function walk(dir, recurse) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recurse) walk(full, true);
    } else if (entry.name.endsWith('.md')) {
      files.add(full);
    }
  }
}

walk('.', false); // top-level *.md
if (statSyncSafe('docs')) walk('docs', true);

let blocks = 0;
const errors = [];

for (const file of [...files].sort()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inBlock = false;
  let start = 0;
  let body = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inBlock && /^\s*```\s*mermaid\s*$/.test(line)) {
      inBlock = true;
      start = i + 1;
      body = [];
      continue;
    }
    if (inBlock && /^\s*```\s*$/.test(line)) {
      inBlock = false;
      blocks += 1;
      const content = body.map((l) => l.trim()).filter(Boolean);
      if (content.length === 0) {
        errors.push(`${file}:${start}: empty mermaid block`);
      } else {
        const first = content[0];
        const ok = DIAGRAM_DIRECTIVES.some(
          (d) => first === d || first.startsWith(`${d} `) || first.startsWith(`${d}\t`),
        );
        if (!ok) {
          errors.push(
            `${file}:${start}: first line "${first}" is not a recognised Mermaid diagram directive`,
          );
        }
      }
      continue;
    }
    if (inBlock) body.push(line);
  }
  if (inBlock) {
    errors.push(`${file}:${start}: unterminated \`\`\`mermaid block`);
  }
}

if (errors.length > 0) {
  console.error(`Mermaid check failed (${errors.length} problem(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Mermaid check passed: ${blocks} block(s) across ${files.size} markdown file(s).`);
