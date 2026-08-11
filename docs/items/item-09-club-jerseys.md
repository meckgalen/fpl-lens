# Item 9 — Club jerseys, and the photo loading work

Commit `79950db`. Phase 1 item record.

Moved verbatim out of `CLAUDE-history.md` in item 15, which was itself the
text split verbatim out of `CLAUDE.md` in item 13. Nothing here has been
reworded on either move.

---

- [x] **9. Club jerseys, and the photo loading work.** Every player row drew a
      grey SVG blob where FPL's own site draws a club shirt. `PlayerShirt` now
      renders one on the Players list and all three Dashboard rankings, and
      behind the header card's photograph. The photograph itself dropped to a
      third of its weight and both image origins are preconnected.

      **The audit ran first and changed the plan, which is the point of running
      it first.** Every URL was probed against the live host over all 35 team
      codes the database holds, rather than written from memory — the task asked
      for that and it earned its keep three times over.

      **The finding that reshaped the item: a shirt exists for exactly the
      twenty clubs in 2026-27 and for no others.** Set equality, not
      approximately — the fifteen misses are every club not in the current
      season, West Ham included, which played ten of the eleven. So 2016-17 has
      nine of twenty clubs with no shirt, and the selector puts it one click
      away. The planned grey-placeholder fallback would have left roughly half
      that season's rows as blobs.

      **So the fallback became the club badge**, which returns 200 for all 35
      codes including clubs gone a decade. **Verified it is keyed on
      `fpl_team_code` by rendering the images** — `t25` really is Middlesbrough,
      `t88` really is Hull — because a badge keyed on some other id space would
      have shown the wrong club quietly, which is the failure this project keeps
      refusing to ship. Same origin as the photographs, so it costs no third
      preconnect. Chain: shirt → badge → grey.

      **The second half of that finding is not fixable and is now a Known Issue:
      the shirt is the current kit, never the season's.** 2016-17 renders
      Arsenal's 2026-27 shirt. Right club, wrong year, by construction — no
      archived path exists, which was checked rather than assumed.

      **`_1` is the goalkeeper variant, confirmed by rendering both images**
      rather than by recall, and then confirmed again in the browser the
      cleanest way available: Steele and Welbeck are both Brighton, and one
      draws the green long-sleeved keeper shirt while the other draws the blue
      outfield one. The suffix is written as `elementType === 1`, never by
      reusing the value — the shirt suffix being `_1` and the position code
      being `1` are unrelated numbering schemes that happen to agree.

      **A module-level `Set` of shirtless team codes, consulted before the first
      render**, was added on review rather than being in the first draft. What it
      buys is **determinism**, not a measured saving: without it the number of
      failed requests depends on whether the browser caches a 503 carrying a
      150-byte body and no cache headers, which is not a thing to rely on in
      either direction. Nothing was ever run with the cache disabled, so no
      before/after saving is claimed here.

      **One cold 2016-17 render, 200 rows, counted from a single run:**

      | | |
      | --- | --- |
      | Shirt requests | **40** — 20 clubs × 2 variants |
      | — succeeded | **22** — 11 clubs × 2 |
      | — failed, 503 | **18** — 9 clubs × 2 |
      | Badge requests | **9**, one per shirtless club, all 200 |
      | **Total** | **49** |
      | Rows showing shirt / badge | **115 / 85** |

      The × 2 is data rather than arithmetic: every one of the twenty clubs has
      both a goalkeeper and an outfield player inside the top 200, checked
      against the bootstrap rather than assumed.

      **Two earlier figures were measurement artefacts and are corrected here**,
      because both are the kind that look like findings. "17 successes" came from
      a network buffer cleared mid-run, so five successful requests landed in the
      window before the clear; all 22 are always requested. "16 failures" came
      from a run contaminated by the cache itself — it already held code 21 from
      a 2025-26 page viewed moments earlier, suppressing both West Ham variants.
      On a cold cache it is 18.

      **What the set cannot do, stated because the measurement shows it.** Both
      variants of a club fire before either error returns, so the first
      observation is never saved — only every render after it. That is visible
      in the numbers: `shirt_20-66` *and* `shirt_20_1-66` both 503, then all
      eleven Southampton rows show the badge.

      **And it persists across a season change, which was observed rather than
      inferred**: passing through 2025-26 before selecting 2016-17 suppressed
      `shirt_21` entirely. Correct — West Ham genuinely has no shirt — and the
      demonstration that the persistence is real.

      **The cache lives in `lib/shirtCache.ts`, and the reason is mechanical
      rather than aesthetic.** It began as a `resetShirtCache` export beside the
      component, and React Fast Refresh only handles a module whose exports are
      all components — so every edit to `PlayerShirt.tsx` logged
      `hmr invalidate … "resetShirtCache" export is incompatible` and forced a
      full page reload instead of a hot update. Found in the dev server log
      **after** the item was otherwise finished and written up, which is the only
      reason it is recorded here rather than silently fixed: nothing in the
      tests, the typecheck or the browser pass could have caught it, because it
      degrades the edit loop rather than the app. Splitting it costs one file and
      is the better seam anyway — module state with a lifetime of its own is not
      a rendering concern. Verified by forcing an HMR cycle afterwards: `hmr
      update` with no `hmr invalidate` and zero Fast Refresh complaints.

      **The photograph's size directory is the CSS size and the file is 2x**,
      which the old code did not know: `250x250` is really 500x500 and 346 KB
      for a box rendered at 56 pixels. `110x140` is 220x280 and 111 KB, still
      comfortably 2x. Interleaved A/B in the browser so both sizes saw identical
      network conditions — necessary, because absolute numbers taken minutes
      apart drifted by 60% during the session:

      | Measurement | Median of 9 |
      | --- | --- |
      | `250x250` | **404 ms** |
      | `110x140` | **170 ms** |

      **The preconnect is a separate question and the two must not be
      multiplied together.** An earlier draft of this record said the header
      photograph "goes from ~706 ms to ~170 ms". That figure was composed from a
      cold *before* and a warm *after*, so it counted the connection saving and
      the size saving as if they stacked, and one of its two numbers was wrong
      as well. It is withdrawn.

      **The cold measurements are not rivals, and an earlier draft of this record
      treated them as though they were.** It tabled 706 ms against 394/399 ms as
      competing estimates of one quantity and called the first an outlier. They
      are **different conditions**, and neither refutes the other. Labelled
      properly:

      | Cold first request | Asset | Preconnect links | Result |
      | --- | --- | --- | --- |
      | Item 9 pre-implementation baseline | `250x250` | **absent** | 706 ms (706, 729, 1021) |
      | Follow-up, fresh socket-pool partitions | `110x140` | **present** | 394 ms, 399 ms |
      | A/B present arm | `110x140` | **present** | median 393.5 ms |
      | A/B absent arm | `110x140` | **absent** | median 534.5 ms |

      Note the first two rows differ in **two** conditions, not one: the links
      *and* the asset size. That is why no subtraction between them means
      anything, and why the A/B — which varies only the links — had to be run.

      What survives of the correction is narrower and still worth keeping: the
      706/863 ms samples were taken by firing the photograph immediately after
      navigation, into contention with the app's own bootstrap, JS and font
      requests, so they carry page-load contention on top of the handshake. A
      first-request timing taken during page load measures bandwidth contention
      as much as connection setup. The audit's phase-level figures — DNS 4 ms,
      TCP 58 ms, TLS complete ~180 ms — remain the cleanest description of the
      handshake itself.

      **The controlled A/B, run to a stopping rule fixed before the first
      sample.** N = 6 pairs, alternating links-present / links-absent so drift is
      shared, each sample on a **fresh loopback alias** — Chrome partitions socket
      pools and the HTTP cache by top-level site, so every sample is both a cold
      socket and a cold cache. `vite --host` serves the aliases; the header
      photograph is read from `performance.getEntriesByType('resource')` on a real
      detail page.

      | Arm | Samples (ms) | Median | Spread |
      | --- | --- | --- | --- |
      | preconnect present | 892, 390, 1321, 375, 359, 397 | 393.5 | 962 |
      | preconnect absent | 540, 605, 423, 731, 529, 514 | 534.5 | 308 |

      **The absent arm is the first clean measurement of cold-without-preconnect
      this project has**, and is worth recording as such: **median 534.5 ms**,
      same asset and same method as the present arm, differing only in the two
      `<link>` tags. Everything before it either had the links in place or varied
      the asset size at the same time.

      **Two sample disclosures, both made because the record should not be read
      as six clean draws:**

      - **The 892 ms sample was the procedure-validation run** — the first pass
        through the click-through, written to check the measurement worked at
        all — and it entered arm A as sample 1 rather than being discarded.
        Dropping it leaves the present arm faster in **4 of 5** pairs with a
        paired-differences median of **170 ms**. The conclusion does not move,
        which is why this is a disclosure and not a re-run.
      - **The 1321 ms sample is an unexplained outlier.** No cause was
        established. It is the single value that sets arm A's 962 ms range, which
        matters for the stopping rule below.

      **What the numbers converge on.** The present arm's median of **393.5 ms**
      reproduces the **394 ms / 399 ms** fresh-partition samples taken on a
      different day by a different method — synthetic image loads rather than the
      app's own header photograph. That is a genuine independent replication of
      the *level*, and it is the strongest thing here, because it validates the
      apparatus rather than the hypothesis.

      On the *gap*: between-arm difference **141 ms**, paired-differences median
      **143.5 ms**, present arm faster in **4 of 6**. Those two statistics are
      computed from the same twelve samples, so they corroborate each other
      without being independent of each other.

      **Written at that strength and no higher: these are converging estimates of
      roughly 140–150 ms, not a significance claim.**

      **The pre-committed rule returned "not resolvable at N = 6 against this
      connection's noise", and the rule rather than the data is what returned
      it.** It compared the between-arm difference against the **range** within
      each arm — and a range is fixed by the single worst sample and grows with
      N. Against arm A's 962 ms range, set entirely by the 1321 ms outlier, **no
      effect smaller than about half a second could have resolved**, so a null
      was the only reachable outcome for an effect of this size. No further
      samples were taken, and none should be read into the verdict.

      Pre-committing was still right, and it did its job: it stopped a
      borderline-looking result from being sampled until it separated. **The
      statistic was the wrong choice.** A paired design should be tested on its
      **paired differences**, which is where its power lives, not on the spread of
      the raw arms — which throws the pairing away. A future measurement of this
      kind should pre-commit to the paired differences.

      **So the honest summary is that the A/B is uninformative about
      significance and informative about magnitude**: it did not resolve an
      effect, and it produced the project's first clean without-preconnect
      number and a gap estimate consistent with two others.

      **What ~155 ms is, and what it is not.** An earlier draft called it "the
      ceiling on what the links can buy". It is the opposite end of the
      transaction: ~395 ms cold **with** the links against ~240 ms warm, so it is
      the **residual** cost still being paid *after* the preconnect has done
      whatever it does. What the links appear to *buy* is the between-arm gap,
      **~141 ms**. The two numbers are close enough to swap by accident, which is
      how the error happened.

      **The links stay.** The measured gap points the right way at about the
      magnitude the mechanism predicts, and the mechanism holds independently of
      whether six pairs could resolve it. Neither link takes `crossorigin`:
      images are fetched in no-CORS mode and a crossorigin preconnect would warm
      a socket the image request cannot reuse.

      **The partial header deliberately gets no shirt.** A season the player has
      no `player_seasons` row for has no club, and the only club available is
      the previously selected season's — rendering it is the stale-snapshot bug
      item 8 fixed, reintroduced as an image in the one case where re-lookup
      cannot help. Confirmed in the browser: Yohanna on 2026-27 shows the
      Brighton shirt, and the same player on 2016-17 shows zero images and the
      grey placeholder.

      **A latent bug fixed while the file was open:** `PlayerPhoto`'s `failed`
      was a boolean that never reset, and the detail page reuses the component
      across players without a key, so one player's missing photograph would
      suppress the next player's real one. It now tracks *which* src failed.

      **Verification.** `npm test`: **77 server, 82 client**, both green.
      `tsc --noEmit` clean in both packages. Browser, console clean: 2026-27's
      Players list renders **39 distinct shirt URLs for 200 rows** — 20
      goalkeeper and 19 outfield, no badges, no broken images — which is the
      predicted ceiling of 40 rather than the 20 a per-club count suggests, the
      goalkeeper variant doubling it. 2016-17 renders 115 shirts and 85 badges
      with no broken image and no grey placeholder; Sigurdsson draws the Swansea
      swan. All three Dashboard rankings draw shirts on 2016-17; on 2026-27 they
      are the three empty states, so the Players list is that season's evidence.

      **Mutation-checked, measured:**

      | Mutation | Result |
      | --- | --- |
      | goalkeeper suffix dropped | **red**, 1 test |
      | badge stage removed | **red**, 5 tests |
      | `alt=""` replaced with a name | **red**, 2 tests |
      | partial header given a shirt | **red**, 1 test |
      | photo size reverted to `250x250` | **red**, 1 test |
      | module-level shirtless set never consulted | **red**, 1 test |
      | per-instance reset removed | **red**, 1 test |


---

## Moved here from `CLAUDE.md` in item 15

Item 15 trimmed `CLAUDE.md` against its context budget. These passages were
measurements and narrative restating this item's work; they are the original
text, moved verbatim, and they are no longer in `CLAUDE.md`.

### The shirt coverage and 503-determinism measurements

_Was `CLAUDE.md` lines 1350-1379._

  **Half one: coverage, which the badge fallback handles.** Nine of twenty clubs
  on 2016-17 have no shirt and render their club badge instead, and the badge
  covers all 35 codes including clubs relegated a decade ago. Measured in the
  browser on a full 200-row render of 2016-17: 115 rows shirt, 85 rows badge,
  zero broken images, zero grey placeholders — from 49 requests, being 40 shirt
  (22 × 200, 18 × 503) and 9 badge.

  **A missing shirt returns 503 to the browser, and that 503 is deterministic
  rather than a rate limit** — which matters, because `recordMissingShirt`
  writes its conclusion for the rest of the session and 200 rows hitting one
  origin at once is exactly the shape that draws a limit. Measured before the
  cache was trusted:

  - Five rounds of all 40 shirt URLs fired in parallel, cache-busted: **18
    failures every round, the failing set byte-for-byte identical across all
    five**, and exactly the nine shirtless clubs × two variants.
  - **No URL that should succeed ever failed**, in any round.
  - 40 simultaneous requests at a good URL: 40/40 succeeded. At a bad URL: 0/40.
    At a good URL *immediately after* the bad burst: 40/40. Every failure 503,
    never 429, under 40-way concurrency.

  **The qualification, which the evidence does not cover: the host is
  deterministic, the cache is not self-correcting.** `onError` carries no status,
  so it cannot tell "this asset does not exist" from "this request failed" — a
  dropped connection while 200 rows are painting would record that club as
  shirtless for the rest of the session, with nothing to detect or expire it.
  Left as is deliberately: the cost is bounded (a badge instead of a shirt, on
  historical seasons, until reload) and separating the two cases needs a status
  code, which an `<img>` cannot give. It would take a `fetch` per shirt, a
  heavier mechanism than the defect justifies.
