import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { listThemes, loadTheme, resolveLayout } from '../src/theme/load.js';
import { listNarratives, loadHooks, loadNarrative } from '../src/narrative/load.js';
import { assignRoles, budgetFor, expandRoles, slideCountRange } from '../src/narrative/resolve.js';
import { isForgeError } from '../src/errors.js';

/**
 * A directory with no `themes/` or `narratives/` of its own, so these tests
 * only ever see what the package itself ships.
 */
const NO_PROJECT = path.join(os.tmpdir(), 'carousel-forge-tests-empty-project');

const SHIPPED_THEMES = ['warm-editorial', 'studio-minimal', 'poster'];

describe('theme registry', () => {
  it('lists every shipped theme', async () => {
    const names = (await listThemes(NO_PROJECT)).map((t) => t.name);
    for (const name of SHIPPED_THEMES) expect(names).toContain(name);
  });

  it('loads a theme with its template and stylesheet', async () => {
    const theme = await loadTheme('warm-editorial', NO_PROJECT);
    expect(theme.manifest.name).toBe('warm-editorial');
    expect(theme.manifest.canvas).toEqual({ w: 1080, h: 1350 });
    expect(theme.template.length).toBeGreaterThan(0);
    expect(theme.css.length).toBeGreaterThan(0);
  });

  it('explains itself when the theme does not exist', async () => {
    await expect(loadTheme('no-such-theme', NO_PROJECT)).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && /no-such-theme/.test(error.message),
    );
  });

  describe.each(SHIPPED_THEMES)('%s', (name) => {
    it('declares a canvas, a safe area inside it, and at least one layout', async () => {
      const { manifest } = await loadTheme(name, NO_PROJECT);
      const { canvas, safeArea } = manifest;
      expect(canvas.w).toBeGreaterThan(0);
      expect(safeArea.left + safeArea.right).toBeLessThan(canvas.w);
      expect(safeArea.top + safeArea.bottom).toBeLessThan(canvas.h);
      expect(manifest.layouts).toContain('default');
    });

    it('supports every layout the shipped narratives ask for', async () => {
      const { manifest } = await loadTheme(name, NO_PROJECT);
      for (const layout of ['hook', 'value', 'cta']) {
        expect(manifest.layouts).toContain(layout);
      }
    });

    it('consumes tokens only through custom properties', async () => {
      const { css, manifest } = await loadTheme(name, NO_PROJECT);
      // Every token the theme declares should be reachable as a CSS variable.
      for (const token of ['accent', 'ink']) {
        if (token in manifest.tokens) expect(css).toContain(`--${token}`);
      }
    });
  });
});

describe('resolveLayout', () => {
  it('uses the requested layout when the theme has it', async () => {
    const theme = await loadTheme('warm-editorial', NO_PROJECT);
    expect(resolveLayout(theme, 'cta')).toBe('cta');
  });

  it('falls back to default so any narrative composes with any theme', async () => {
    const theme = await loadTheme('warm-editorial', NO_PROJECT);
    expect(resolveLayout(theme, 'a-layout-this-theme-never-heard-of')).toBe('default');
  });

  it('falls back to default when nothing was requested', async () => {
    const theme = await loadTheme('warm-editorial', NO_PROJECT);
    expect(resolveLayout(theme, undefined)).toBe('default');
  });
});

describe('narrative registry', () => {
  it('lists the shipped narratives and never lists hooks.yaml as one', async () => {
    const names = (await listNarratives(NO_PROJECT)).map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['viral-5', 'listicle-10', 'story-arc']));
    expect(names).not.toContain('hooks');
  });

  it('loads a narrative with unique role ids', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const ids = narrative.manifest.roles.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('hook');
  });

  it('loads the hook library', async () => {
    const hooks = await loadHooks(NO_PROJECT);
    expect(hooks.length).toBeGreaterThan(5);
    for (const hook of hooks) {
      expect(hook.pattern).toBeTruthy();
      expect(hook.example).toBeTruthy();
    }
  });
});

describe('expandRoles', () => {
  it('anchors the CTA to the last slide whatever the slide count', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    for (const count of [3, 5, 8, 12]) {
      const roles = expandRoles(narrative, count);
      expect(roles).toHaveLength(count);
      expect(roles.at(-1)?.id).toBe('cta');
      expect(roles[0]?.id).toBe('hook');
    }
  });

  it('gives every role its minimum before growing any of them', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const range = slideCountRange(narrative);
    const roles = expandRoles(narrative, range.min);
    for (const role of narrative.manifest.roles) {
      const seen = roles.filter((r) => r?.id === role.id).length;
      expect(seen).toBeGreaterThanOrEqual(1);
    }
  });

  it('absorbs extra slides into the flexible role rather than the CTA', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const roles = expandRoles(narrative, 8);
    expect(roles.filter((r) => r?.id === 'cta')).toHaveLength(1);
    expect(roles.filter((r) => r?.id === 'value').length).toBeGreaterThan(1);
  });

  it('leaves surplus slides roleless rather than inventing roles', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const { max } = slideCountRange(narrative);
    const roles = expandRoles(narrative, max + 3);
    expect(roles.filter((r) => r === null)).toHaveLength(3);
    expect(roles.at(-1)?.id).toBe('cta');
  });
});

describe('assignRoles', () => {
  it('assigns positionally when no slide names a role', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const assignments = assignRoles(narrative, [{}, {}, {}, {}, {}]);
    expect(assignments.map((a) => a.source)).toEqual(Array(5).fill('positional'));
    expect(assignments[0]?.role?.id).toBe('hook');
  });

  it('lets an explicit role on a slide win', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const assignments = assignRoles(narrative, [{}, { role: 'cta' }, {}, {}, {}]);
    expect(assignments[1]?.source).toBe('explicit');
    expect(assignments[1]?.role?.id).toBe('cta');
  });

  it('reports an unknown explicit role as explicit-but-unresolved', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const assignments = assignRoles(narrative, [{ role: 'nonsense' }]);
    expect(assignments[0]?.source).toBe('explicit');
    expect(assignments[0]?.role).toBeNull();
  });

  it('assigns nothing at all without a narrative', () => {
    const assignments = assignRoles(undefined, [{}, {}]);
    expect(assignments.every((a) => a.role === null && a.source === 'none')).toBe(true);
  });
});

describe('budgetFor', () => {
  it('merges narrative defaults with the role budget, role winning', async () => {
    const narrative = await loadNarrative('viral-5', NO_PROJECT);
    const hook = narrative.manifest.roles.find((r) => r.id === 'hook') ?? null;
    const budget = budgetFor(narrative, hook);
    expect(budget.title?.maxWords).toBeGreaterThan(0);
  });

  it('is empty when there is no narrative and no role', () => {
    expect(budgetFor(undefined, null)).toEqual({});
  });
});
