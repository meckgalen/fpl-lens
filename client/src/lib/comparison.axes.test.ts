/**
 * That every comparison axis can explain itself.
 *
 * **The assertion this file refuses to make is "eleven non-empty strings
 * exist".** That would pass against `description = label`, against
 * `description = title`, and against any placeholder — it counts strings rather
 * than checking they say anything. A radar caption is the one place in the app
 * where an abbreviation has no header row and no picker beside it, so a tooltip
 * that restates the caption is a silent no-op wearing the costume of a fix.
 *
 * So the clauses here are: every axis resolves to a description at all; that
 * description is not merely the label or the title back again; and the two
 * derived axes carry the specific facts items 13 and 14 settled, which are the
 * ones a reader cannot infer from the name.
 *
 * `COMPARISON_AXES` is the runtime list, and is itself type-guarded against
 * `ComparisonAxisKey` in both directions — so this file cannot silently test
 * ten of eleven axes.
 */

import { describe, expect, it } from 'vitest';
import { COMPARISON_AXES, axisDefinition } from './comparison';
import { columnByKey } from './playerColumns';

describe('axis definitions', () => {
  it('covers all eleven axes', () => {
    // Guards the guard: if COMPARISON_AXES were trimmed, the type-level
    // `_exhaustive` catches it at compile time and this catches it at run time.
    expect(COMPARISON_AXES).toHaveLength(11);
  });

  it.each(COMPARISON_AXES)('%s resolves to a real definition', (axis) => {
    const definition = axisDefinition(axis);
    const col = columnByKey(axis);

    expect(col).toBeDefined();
    expect(definition).not.toBeNull();

    // The clauses that make this more than a string count. A tooltip equal to
    // the caption it hangs off explains nothing, and one equal to the picker's
    // short name is the same failure one step along.
    expect(definition).not.toBe(col!.label);
    expect(definition).not.toBe(col!.title);

    // A definition is a sentence. The shortest real one here is ~60 characters;
    // 25 is a floor against a placeholder, not a style rule.
    expect(definition!.length).toBeGreaterThan(25);
  });

  it('says that DCH/St can exceed 1, and why', () => {
    // Item 14's finding, and the single most misreadable number on the chart:
    // hits off the bench are in the numerator, only starts in the denominator.
    // A reader who does not know that reads a value above 1 as a bug.
    const d = axisDefinition('defcon_hits_per_start')!;
    expect(d).toMatch(/above 1/i);
    expect(d).toMatch(/bench/i);
    expect(d).toMatch(/start/i);
  });

  it('distinguishes PPM from points per million', () => {
    // `PPM` and `Pts/£` are adjacent spokes and the abbreviation is overloaded
    // in FPL's own vocabulary, which is exactly why the column comment warns
    // about it. The tooltip has to do the same or the two axes read as one.
    const ppm = axisDefinition('ppm')!;
    expect(ppm).toMatch(/per match/i);
    expect(ppm).toMatch(/not points per million/i);

    const value = axisDefinition('pts_per_now')!;
    expect(value).toMatch(/current price/i);
    // It must point at its sibling, which is the whole reason both exist.
    expect(value).toMatch(/Pts\/£s/);
  });

  it('returns null rather than falling back for a key with no description', () => {
    // The load-bearing negative. The Players list renders
    // `description ?? title`; this must NOT, because a caption whose tooltip
    // repeats it is indistinguishable from a working one. A later tidy-up into
    // symmetry with Players turns this red.
    const withoutDescription = columnByKey('starts');
    expect(withoutDescription).toBeDefined();
    expect(withoutDescription!.description).toBeUndefined();
    expect(axisDefinition('starts' as never)).toBeNull();
  });
});
