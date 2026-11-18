# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kicki2k/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kicki2k/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that reads a sealed DefiLlama snapshot of 758 protocols and ranks the 198 that record no token by what their launch would be worth. The implied value is calibrated from the snapshot itself: each category's peer multiple is the median market-cap / TVL of its live-token protocols, blended toward the global median, then adjusted for seven-day momentum, for how long the protocol has run with no token on record, and for chain breadth. The dashboard covers all 40 watchlist protocols plus 158 early finds beyond it, keeps the 416 live-token protocols in a separate view, and gives every ranked protocol a seven-step farm plan with concrete costs and durations. A model sandbox in the page re-ranks the board under different growth and maturity weights.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18 or later, standard library only, no network. The program writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory, and two runs over the same snapshot produce
identical bytes.

## Layout

- `main.ts` — entry point: snapshot in, deliverables out, dossier last.
- `lib/model.ts` — the peer-calibrated valuation model and the farm-plan
  generator; pure functions of the snapshot's ten fields per protocol.
- `dashboard/` — the static page (board, live view, model sandbox,
  per-protocol detail with the model's workings and the farm plan).
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c6gav229&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
