/**
 * The four ways a season comes back empty.
 *
 * They all render as an absence, so the wording is the only thing telling them
 * apart, and the wording is what these tests pin. Two of the four were one
 * sentence until item 1 split them — "no rows" turned out to have two causes and
 * only one of them is about time — so a regression that merges them back is not
 * a crash or a blank page. It is a plausible sentence that happens to be false
 * about a player who was never in the game that season. That is why the
 * registered-but-empty case asserts what must **not** appear as well as what
 * must.
 *
 * Assertions match the shortest fragment that distinguishes one state from the
 * others, not the whole rendered sentence. The strings carry a curly apostrophe
 * and a singular/plural branch, and a suite that goes red because a caption was
 * reworded teaches people to skim failures instead of reading them. The fixture
 * count is the one number kept, because stating it is the caption's entire job.
 *
 * Two of these states are unreachable from the UI today — see CLAUDE.md. Both
 * are reachable here, which is the point of testing the component rather than
 * the page.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GameweekSection from './GameweekSection';
import { aGameweek, aTeam } from '../test/factories';

const teams = [aTeam(), aTeam({ id: 43, name: 'Man City', short_name: 'MCI' })];

/** A full season of rows for a player who never got on the pitch. */
const neverPlayed = Array.from({ length: 38 }, (_, i) =>
  aGameweek({
    fixture: i + 1,
    round: i + 1,
    total_points: 0,
    minutes: 0,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    bonus: 0,
    bps: 0,
  })
);

const NOT_REGISTERED = /was not in the game/;
const UNDERWAY = /is underway/;
const NEVER_PLAYED = /played none of them/;
const FILTERED_OUT = /match the selected filters/;

function table() {
  return document.querySelector('table');
}

describe('GameweekSection: not in the game that season', () => {
  it('says so, and renders no table', () => {
    render(
      <GameweekSection
        history={[]}
        teams={teams}
        season="2025-26"
        playerName="Cresswell"
        registered={false}
      />
    );

    expect(screen.getByText(NOT_REGISTERED)).toBeInTheDocument();
    expect(screen.getByText(/2025-26/)).toBeInTheDocument();
    // Nothing to show and nothing that will ever appear, so no empty grid of
    // headers either.
    expect(table()).toBeNull();
  });
});

describe('GameweekSection: registered, no rows yet', () => {
  it('promises the data will appear, and does not claim he was absent', () => {
    render(
      <GameweekSection
        history={[]}
        teams={teams}
        season="2026-27"
        playerName="Saka"
        registered
      />
    );

    expect(screen.getByText(UNDERWAY)).toBeInTheDocument();

    // The assertion this file exists for. These two states were one sentence
    // before item 1, and "data will appear once the season is underway" is
    // simply false about a player who has no squad place that year. If the
    // branch is ever collapsed again, this is what catches it — the positive
    // assertion above would keep passing.
    expect(screen.queryByText(NOT_REGISTERED)).not.toBeInTheDocument();
    expect(table()).toBeNull();
  });
});

describe('GameweekSection: in the squad all season, never played', () => {
  it('renders the table and says how many fixtures it covers', () => {
    render(
      <GameweekSection
        history={neverPlayed}
        teams={teams}
        season="2025-26"
        playerName="Onana"
        registered
      />
    );

    // Thirty-eight rows of zeroes is the answer, not a failure to load — so the
    // table renders, with a line saying what it is.
    expect(table()).not.toBeNull();
    expect(screen.getByText(/squad for 38/)).toBeInTheDocument();
    expect(screen.getByText(NEVER_PLAYED)).toBeInTheDocument();

    expect(screen.queryByText(NOT_REGISTERED)).not.toBeInTheDocument();
    expect(screen.queryByText(UNDERWAY)).not.toBeInTheDocument();
  });
});

describe('GameweekSection: the filters excluded everything', () => {
  it('says the rows exist and the filters removed them', () => {
    const history = [aGameweek({ fixture: 1, round: 1 }), aGameweek({ fixture: 2, round: 2 })];

    render(
      <GameweekSection
        history={history}
        filtered={[]}
        teams={teams}
        season="2025-26"
        playerName="Saka"
        registered
      />
    );

    expect(screen.getByText(FILTERED_OUT)).toBeInTheDocument();
    // Distinct from having no data: the rows are there, they are just not
    // being shown, so neither absence message belongs here.
    expect(screen.queryByText(UNDERWAY)).not.toBeInTheDocument();
    expect(screen.queryByText(NEVER_PLAYED)).not.toBeInTheDocument();
  });
});

describe('GameweekSection: never played AND filtered out', () => {
  it('states both, because they are independent facts', () => {
    // The two captions are separate `&&` branches rather than an if/else chain,
    // and this is the case that tells them apart. A player who never played can
    // also have his rows filtered away, and then both things are worth saying:
    // one explains the zeroes, the other explains why even the zeroes are
    // missing. Collapsing them into one branch loses whichever is second.
    render(
      <GameweekSection
        history={neverPlayed}
        filtered={[]}
        teams={teams}
        season="2025-26"
        playerName="Onana"
        registered
      />
    );

    expect(screen.getByText(NEVER_PLAYED)).toBeInTheDocument();
    expect(screen.getByText(FILTERED_OUT)).toBeInTheDocument();
  });
});
