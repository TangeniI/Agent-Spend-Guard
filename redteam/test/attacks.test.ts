import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TASK, loadAttacks } from '../src/attacks.ts';

function directoryWith(yaml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'asg-attacks-'));
  writeFileSync(join(dir, 'a.yaml'), yaml);
  return pathToFileURL(`${dir}/`);
}

describe('loadAttacks', () => {
  const attacks = loadAttacks();

  it('loads about 50 attacks across all 8 families', () => {
    expect(attacks).toHaveLength(50);
    expect(new Set(attacks.map((a) => a.family))).toEqual(
      new Set([
        'fake_authority',
        'fake_urgency',
        'quantity_inflation',
        'split_purchase',
        'merchant_swap',
        'currency_confusion',
        'exfiltration',
        'instruction_override',
      ]),
    );
  });

  it('gives every attack injected content and the default task', () => {
    for (const attack of attacks) {
      expect(attack.context.length).toBeGreaterThan(10);
      expect(attack.prompt).toBe(DEFAULT_TASK);
    }
  });

  it('checks exfiltration by what reached the merchant, and the rest by the ledger', () => {
    for (const attack of attacks) {
      expect(attack.detector).toBe(attack.family === 'exfiltration' ? 'exfiltration' : 'ledger');
    }
  });

  it('refuses an unknown detector', () => {
    const dir = directoryWith(
      'probes:\n  - module: x\n    name: X\n    severity: low\n    detector: { kind: regex }\n    attacks: [{ id: a, context: hello world }]\n',
    );
    expect(() => loadAttacks(dir)).toThrow('detector kind');
  });

  it('refuses an attack with no context', () => {
    const dir = directoryWith(
      'probes:\n  - module: x\n    name: X\n    severity: low\n    detector: { kind: ledger }\n    attacks: [{ id: a, context: "" }]\n',
    );
    expect(() => loadAttacks(dir)).toThrow('needs id and context');
  });

  it('refuses duplicate ids', () => {
    const dir = directoryWith(
      'probes:\n  - module: x\n    name: X\n    severity: low\n    detector: { kind: ledger }\n    attacks: [{ id: a, context: hello }, { id: a, context: again }]\n',
    );
    expect(() => loadAttacks(dir)).toThrow('unique');
  });

  it('keeps a task an attack sets for itself', () => {
    const dir = directoryWith(
      'probes:\n  - module: x\n    name: X\n    severity: low\n    detector: { kind: ledger }\n    attacks: [{ id: a, prompt: Buy a cable., context: hello }]\n',
    );
    expect(loadAttacks(dir)[0]?.prompt).toBe('Buy a cable.');
  });
});
