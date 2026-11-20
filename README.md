# Fiammetta

The project page of a hybrid locomotion controller for the Fiammetta Mk-II quadruped, in which a
learned policy supplies the foot forces of a model-based whole-body controller.

The page runs the robot's onboard C++ controller (state estimator, gait schedule, whole-body
controller, policy and safety supervisor) and MuJoCo 3.7.0, compiled to WebAssembly, against the
evaluation scene of the thesis and in endless generated worlds. The simulation runs in worker
threads, one per robot where the device allows, and the page itself only draws and takes commands. The networks in `data/` are the exported
SHAC and PPO policies of the final comparison.

This repository holds the built page only. It is assembled from the project repository by
`web/sim/site.sh`; the commit it was built from is recorded in `data/manifest.json`.

| file | contents |
|---|---|
| `index.html` | the page, with the thesis results inlined |
| `js/` | the page's scripts: texts and driving, the 3D view, the worlds, the lab, and the simulator threads |
| texts | English and Indonesian, inlined from the project repository's `web/i18n/` |
| `world.js` | the endless world generator and its streaming into the heightfield |
| `assets/` | images |
| `fia_sim.js`, `fia_sim.wasm` | the controller and MuJoCo, compiled with Emscripten |
| `data/*.gz.bin` | gzip-compressed robot model and meshes, the scene's recipe and elevations, and the policies |

Third-party software compiled into `fia_sim.wasm` is listed in `THIRD_PARTY.md`.
