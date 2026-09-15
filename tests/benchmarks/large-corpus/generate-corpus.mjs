#!/usr/bin/env node
/**
 * Generates a synthetic corpus of realistic-shaped business documents for the
 * 200k+-document benchmark (ROADMAP Phase 5). No real large corpus is available to
 * source from, so this recombines a small bank of real-sounding sentence templates
 * (invoices, inventory, purchasing, support conversations, policy) with a seeded
 * PRNG — deterministic (same `--seed` always produces the same corpus) and varied
 * enough to actually exercise chunking/embedding/full-text search, not just
 * repeat one paragraph N times (which would let every vector collapse near-
 * identically and tell you nothing about retrieval at scale).
 *
 * Usage:
 *   node generate-corpus.mjs --count 200000 --out ./corpus --seed 42
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = { count: 1000, out: './corpus', seed: 42, minWords: 200, maxWords: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key in args) {
      args[key] = Number.isNaN(Number(argv[i + 1])) ? argv[i + 1] : Number(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

// mulberry32 — tiny seedable PRNG (Math.random() isn't seedable; this is a widely
// used public-domain algorithm, not something novel written for this task).
function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  'Espresso Beans 1kg',
  'Brewing Scale',
  'Ceramic Mug 350ml',
  'Cold Brew Kit',
  'Pour-Over Filter Pack',
  'Milk Frother',
  'Grinder Burr Set',
  'Insulated Carafe',
];
const CUSTOMERS = [
  'Lighthouse Café',
  'Northside Roasters',
  'Harbor Deli',
  'Union Square Bakery',
  'Maple & Co',
  'Riverside Bistro',
  'Cedar Market',
  'Eastgate Diner',
];
const CITIES = ['Austin', 'Portland', 'Denver', 'Raleigh', 'Madison', 'Tucson', 'Spokane', 'Boise'];
const STAFF = ['Ada', 'Marcus', 'Priya', 'Noor', 'Diego', 'Lena', 'Kwame', 'Yuki'];

const TEMPLATES = [
  (r) =>
    `Invoice for ${r.pick(CUSTOMERS)} covering ${r.int(1, 12)} units of ${r.pick(PRODUCTS)} at ` +
    `$${r.int(8, 60)}.${r.int(0, 99)} per unit, due within ${r.pick([15, 30, 45])} days. ` +
    `Payment terms follow the standard net schedule agreed with the account.`,
  (r) =>
    `Inventory count at the ${r.pick(CITIES)} warehouse shows ${r.pick(PRODUCTS)} at ${r.int(0, 400)} ` +
    `units on hand, against a reorder point of ${r.int(5, 60)}. ${r.pick(STAFF)} flagged the ` +
    `discrepancy after the last cycle count and recommended a purchase order within the week.`,
  (r) =>
    `Support conversation with ${r.pick(CUSTOMERS)}: the customer asked about the return policy for ` +
    `${r.pick(PRODUCTS)} purchased ${r.int(3, 60)} days ago. ${r.pick(STAFF)} confirmed returns are ` +
    `accepted within 30 days with a receipt, and offered a replacement shipped from ${r.pick(CITIES)}.`,
  (r) =>
    `Purchasing note: supplier lead time for ${r.pick(PRODUCTS)} has stretched to ${r.int(2, 10)} weeks. ` +
    `${r.pick(STAFF)} recommends raising the reorder point for the ${r.pick(CITIES)} location and ` +
    `pre-ordering ahead of the seasonal demand increase expected next quarter.`,
  (r) =>
    `Appointment summary: ${r.pick(STAFF)} met with ${r.pick(CUSTOMERS)} in ${r.pick(CITIES)} to discuss ` +
    `a recurring order of ${r.pick(PRODUCTS)}. The customer requested delivery every ${r.pick([2, 4, 6])} ` +
    `weeks and asked whether a volume discount applies above ${r.int(50, 200)} units per order.`,
  (r) =>
    `Policy note: staff handling ${r.pick(PRODUCTS)} returns must verify the batch number before issuing ` +
    `a refund. ${r.pick(STAFF)} updated the internal wiki after a ${r.pick(CITIES)} customer reported a ` +
    `damaged unit; the supplier has been notified and a credit was issued the same day.`,
];

function makeDocument(r, minWords, maxWords) {
  const targetWords = r.int(minWords, maxWords);
  const paragraphs = [];
  let words = 0;
  while (words < targetWords) {
    const paragraph = r.pick(TEMPLATES)(r);
    paragraphs.push(paragraph);
    words += paragraph.split(/\s+/).length;
  }
  return paragraphs.join('\n\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const random = mulberry32(args.seed);
  const r = {
    pick: (arr) => arr[Math.floor(random() * arr.length)],
    int: (min, max) => min + Math.floor(random() * (max - min + 1)),
  };

  mkdirSync(args.out, { recursive: true });

  const startedAt = Date.now();
  for (let i = 0; i < args.count; i += 1) {
    const text = makeDocument(r, args.minWords, args.maxWords);
    const fileName = `doc-${String(i).padStart(6, '0')}.txt`;
    writeFileSync(join(args.out, fileName), text, 'utf8');
    if (i > 0 && i % 10000 === 0) {
      const elapsedS = (Date.now() - startedAt) / 1000;
      console.log(`generated ${i}/${args.count} (${(i / elapsedS).toFixed(0)} docs/s)`);
    }
  }
  console.log(`done: ${args.count} documents written to ${args.out}`);
}

main();
