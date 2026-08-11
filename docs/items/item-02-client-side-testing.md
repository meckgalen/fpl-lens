# Item 2 — Client-side testing

Commit `a4cefed`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **2. Client-side testing.** The client had no tests, and everything item 1
      added was verified by looking at a browser. Vitest in jsdom, React Testing
      Library, the API mocked at `services/api.ts`. 14 tests in four files; see
      the test inventory in Current State for what each holds. The step added
      one server test and changed no component.

      **Two runners, not one.** The server suite stays on `node:test` against a
      real Postgres. Root `test` is
      `run-s --continue-on-error test:server test:client` so a red server suite
      does not hide the client result — verified by pointing `DATABASE_URL` at a
      dead port: 34 server failures, 14 client passes, exit code 1.

      **The mutation check found what the plan predicted, which changed what the
      test is allowed to claim.** The obvious mutation — move `loadSeason` back
      inside the `setExpanded` updater — does **not** turn the double-fetch test
      red. Measured, all three:

      | Mutation | Result |
      | --- | --- |
      | call moved back inside the updater | green |
      | `inFlight` ref swapped back to state | green |
      | both together — the bug as it happened | **red**, "expected 2 to be 1" |

      The ref writes synchronously before its first `await`, so it absorbs
      StrictMode's second updater invocation on its own. **That does not make
      either half optional, and the comment in `PlayerDetail.tsx` says so.** The
      ref suppresses the symptom; the call sitting outside the updater is what
      makes the code correct, because React does not promise to invoke an
      updater exactly twice and may discard a render entirely — leaving a fetch
      started for a state change that never committed. None of that is
      observable from outside the component, so no test pins it, and "either
      half alone is green" must not be read as "either half alone is fine".

      **`render.test.tsx` tests the harness rather than the app**, because the
      whole `PlayerDetail` suite is worthless if StrictMode is not actually
      active — and it would be worthless silently. It counts a probe
      component's renders: two on mount, two more after a `rerender`. The second
      half is the one that catches a helper that wraps by hand instead of
      through RTL's `wrapper` option, which loses StrictMode on re-render only.

      **The factories carry explicit return-type annotations.** Nothing in this
      suite ever sees a real payload, so they are a second description of the
      wire shape; the annotation is the only thing that fails `tsc` when a field
      is added to `types/fpl.ts` and missed here.

      **No `@vitejs/plugin-react` in the Vitest config.** Its jobs are Fast
      Refresh, which no test wants, and the JSX transform, which Vite already
      does from `tsconfig.json`'s `jsx: "react-jsx"`. Including it printed
      deprecation warnings on every run, because Vitest 4 carries a newer Vite
      than the app builds with.

      **No `user-event`** — `fireEvent.click` covers a `<tr onClick>`, which is
      all this item touches. That is a decision for this item, not a settled
      one: keyboard handling on career rows is where it earns its place.

      The server addition: the career query's bare `sum()` skips nulls, which is
      safe only while a column is measured for a whole season or none of it. A
      column measured for part of one would total that part and render as a
      whole-season figure. `career.test.ts` now asserts it per season and per
      column over all 253,509 rows. It holds today with a real split — tackles
      are full in 2016-17..2018-19 and 2025-26 and zero in the six between — and
      it fails on the first partially ingested season, which is when the
      incremental sync needs to hear about it.
