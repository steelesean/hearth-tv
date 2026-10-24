# Hedgerows: game source (backup)

The source the playable game in `server/game/` is built from. Saved here so it isn't lost with the cloud session.

- `map/parts/*.js`: the game, in parts. `map/build.sh` joins them into `game/game.js`.
- `map/*.js`: automated tests (Playwright), e.g. `node map/commander.js`.
- `map/*.py`: the map pipeline (Blender scene, tiles, level grid). `map/maps/<id>/`: per-map masks and layout.
- `tank/`: Blender models and render scripts for the Sherman and StuG, with rendered sprites.
- `infantry/`: the soldier model script (kits: german, us, tanker, mg42, para, bazooka) and rendered sprites.

Branch `game-test` and `game-commander` carry the built game; this branch carries what builds it.
