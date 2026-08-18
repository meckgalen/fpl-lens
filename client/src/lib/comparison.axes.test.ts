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
 * **Item 21 added the converse**, and it is a different kind of clause. The
 * others ask whether each axis is explained; that one asks whether anything
 * ELSE carries a `description`, and requires that nothing does. Since item 21
 * the Players header hover reads `gloss`, so a `description` on a non-axis
 * column is read by no surface at all — it cannot be seen to be wrong, and it
 * duplicates the `gloss` beside it. Bounding the field to the eleven is what
 * keeps the split from decaying back into two strings for one fact.
 *
 * `COMPARISON_AXES` is the runtime list, and is itself type-guarded against
 * `ComparisonAxisKey` in both directions — so this file cannot silently test
 * ten of eleven axes, and the converse cannot silently permit an eleventh.
 */

import { describe, expect, it } from 'vitest';
import { COMPARISON_AXES, axisDefinition } from './comparison';
import { PLAYER_COLUMNS, columnByKey } from './playerColumns';

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

    // The same fact one level down, naming the FIELD. Item 21 split the header
    // hover onto `gloss`, so the new way to break a spoke's tooltip is to fill
    // `gloss` and forget `description` — and because `axisDefinition` refuses to
    // fall back, the tooltip then vanishes in silence.
    //
    // Honest about what this adds: the `not.toBeNull()` above ALREADY goes red
    // on that path, since `axisDefinition` is `columnByKey(axis)?.description ??
    // null`. This closes no open hole. What it buys is the failure message —
    // "description is undefined" is what a reader who has just added a `gloss`
    // needs to read, where "definition was null" sends them to the wrong file.
    expect(col!.description).toBeDefined();

    // The clauses that make this more than a string count. A tooltip equal to
    // the caption it hangs off explains nothing, and one equal to the picker's
    // short name is the same failure one step along.
    expect(definition).not.toBe(col!.label);
    expect(definition).not.toBe(col!.title);

    // A definition is a sentence. The shortest real one here is ~60 characters;
    // 25 is a floor against a placeholder, not a style rule.
    expect(definition!.length).toBeGreaterThan(25);
  });

  it('carries a description on the axes and nowhere else', () => {
    /*
     * The converse of the clause above, and the half that makes "a description
     * exists on exactly the eleven axes" an invariant rather than a description
     * of today.
     *
     * Without it the field can regrow on a non-axis column, where **nothing
     * reads it** — item 21 moved the Players header hover to `gloss` — so it
     * would sit beside a `gloss` saying the same thing, with no surface to
     * reveal the two disagreeing. That is the two-fields-one-fact drift the
     * split was made to avoid, reappearing through the door the split opened.
     *
     * `COMPARISON_AXES` rather than the server's `AXIS_POOL`: this is a client
     * suite, and `COMPARISON_AXES` is the same eleven keys, type-guarded against
     * `ComparisonAxisKey` in both directions so it cannot silently drift to ten.
     *
     * Asserting the key LIST rather than a count, so a failure names the column.
     */
    const axes = new Set<string>(COMPARISON_AXES);
    const strays = PLAYER_COLUMNS.filter(
      (c) => !axes.has(c.key) && c.description !== undefined
    );

    expect(strays.map((c) => c.key)).toEqual([]);
  });

  it('says that DCH/St counts starts only, and what happens to a bench hit', () => {
    // The inverse of what this test asserted until item 24, when the axis stopped
    // being able to exceed 1. The bench is still the thing a reader has to be
    // told about — it is where the DCH count and this ratio part company, and a
    // reader who does not know that cannot reconcile the two columns.
    const d = axisDefinition('defcon_hits_per_start')!;
    expect(d).toMatch(/bench/i);
    expect(d).toMatch(/start/i);
    expect(d).toMatch(/1\.00/);
    // The old wording promised the opposite, so it must not survive anywhere in
    // the sentence.
    expect(d).not.toMatch(/above 1\b/i);
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
    // The load-bearing negative. The Players list renders `gloss ?? title`;
    // this must NOT fall back at all, because a caption whose tooltip repeats it
    // is indistinguishable from a working one. A later tidy-up into symmetry
    // with Players turns this red.
    //
    // `starts` has a `gloss` and no `description` since item 21, which is
    // exactly the shape this asserts about — and the shape the forward clause
    // above would catch on an axis.
    const withoutDescription = columnByKey('starts');
    expect(withoutDescription).toBeDefined();
    expect(withoutDescription!.description).toBeUndefined();
    expect(axisDefinition('starts' as never)).toBeNull();
  });
});
