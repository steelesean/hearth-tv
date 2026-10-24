#!/bin/sh
# Assembles game/game.js from the parts, in dependency order, and checks it parses.
cd "$(dirname "$0")"
cat parts/a_head.js parts/b_grid.js parts/c_units.js parts/k_ai.js parts/e_update.js parts/i_mission.js parts/l_campaign.js parts/n_paras.js parts/o_commander.js parts/m_hud.js parts/f_sound.js parts/g_draw.js parts/d_occlusion.js parts/j_remote.js parts/h_ui.js > game/game.js
node -e "new Function(require('fs').readFileSync('game/game.js','utf8'))" && echo built
