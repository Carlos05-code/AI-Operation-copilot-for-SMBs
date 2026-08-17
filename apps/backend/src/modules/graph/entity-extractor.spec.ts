/**
 * Unit tests — EntityExtractor (deterministic, LLM-free).
 */
import { MAX_ENTITIES_PER_CHUNK } from './graph.constants';
import { extractEntities } from './entity-extractor';

describe('extractEntities', () => {
  it('extracts emails and urls with canonical lowercasing', () => {
    const entities = extractEntities(
      'Contact support@Acme.com or visit https://Acme.com/Pricing) today.',
    );
    expect(entities).toContainEqual({ canonical: 'support@acme.com', kind: 'email' });
    expect(entities).toContainEqual({ canonical: 'https://acme.com/pricing', kind: 'url' });
  });

  it('extracts ALL-CAPS acronyms', () => {
    const entities = extractEntities('ACME ships TOS updates with the new SLA.');
    expect(entities).toContainEqual({ canonical: 'acme', kind: 'acronym' });
    expect(entities).toContainEqual({ canonical: 'tos', kind: 'acronym' });
    expect(entities).toContainEqual({ canonical: 'sla', kind: 'acronym' });
  });

  it('extracts capitalized phrases as organizations', () => {
    const entities = extractEntities(
      'The report was prepared by Acme Corporation for Global Bank.',
    );
    expect(entities).toContainEqual({
      canonical: 'acme corporation',
      kind: 'organization',
    });
    expect(entities).toContainEqual({ canonical: 'global bank', kind: 'organization' });
  });

  it('classifies honorific-prefixed names as people', () => {
    const entities = extractEntities('Dr Jane Doe briefed Mr. Smith and Prof Alan Turing.');
    expect(entities).toContainEqual({ canonical: 'jane doe', kind: 'person' });
    expect(entities).toContainEqual({ canonical: 'alan turing', kind: 'person' });
  });

  it('skips sentence-starter phrases like "The Acme Corporation"', () => {
    const entities = extractEntities('The Acme Corporation filed its annual report.');
    expect(entities).not.toContainEqual({
      canonical: 'the acme corporation',
      kind: 'organization',
    });
  });

  it('does not treat plain sentence-initial words as entities', () => {
    const entities = extractEntities('This invoice covers the winter stock levels.');
    expect(entities).toEqual([]);
  });

  it('deduplicates canonicals case-insensitively', () => {
    const entities = extractEntities('Mail support@Acme.com or support@acme.com today.');
    const matches = entities.filter((e) => e.canonical === 'support@acme.com');
    expect(matches).toHaveLength(1);
  });

  it('drops phrases longer than MAX_ENTITY_LENGTH', () => {
    const long = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima';
    expect(extractEntities(long)).toEqual([]);
  });

  it('caps the number of extracted entities per chunk', () => {
    const adjectives = [
      'Brave',
      'Calm',
      'Eager',
      'Fair',
      'Grand',
      'Humble',
      'Ideal',
      'Jolly',
      'Kind',
      'Lively',
      'Mellow',
      'Noble',
      'Open',
      'Proud',
      'Quick',
      'Royal',
      'Sleek',
      'Tidy',
      'Upbeat',
      'Vivid',
      'Wise',
      'Young',
      'Zesty',
      'Bright',
      'Clever',
      'Daring',
      'Elegant',
      'Fierce',
      'Gentle',
      'Happy',
    ];
    const names = adjectives.map((adjective) => `Company ${adjective} Fox`);
    const entities = extractEntities(names.join('. '));
    expect(entities).toHaveLength(MAX_ENTITIES_PER_CHUNK);
  });

  it('returns nothing for empty or lowercase text', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities('just some lowercase words without names')).toEqual([]);
  });
});
