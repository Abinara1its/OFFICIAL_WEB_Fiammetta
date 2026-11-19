# Third-party software

`fia_sim.wasm` and `fia_sim.js` contain the following software, compiled from unmodified sources
except where noted.

| software | version | licence | source |
|---|---|---|---|
| MuJoCo | 3.7.0 | Apache-2.0 | https://github.com/google-deepmind/mujoco (compiled with model-compiler threading off; `src/user/user_init.c`) |
| libccd | as fetched by MuJoCo 3.7.0 | BSD-3-Clause | https://github.com/danfis/libccd |
| lodepng | as fetched by MuJoCo 3.7.0 | Zlib | https://github.com/lvandeve/lodepng |
| MarchingCubeCpp | as fetched by MuJoCo 3.7.0 | MIT or public domain | https://github.com/aparis69/MarchingCubeCpp |
| Qhull | as fetched by MuJoCo 3.7.0 | Qhull licence | http://www.qhull.org |
| tinyobjloader | as fetched by MuJoCo 3.7.0 | MIT | https://github.com/tinyobjloader/tinyobjloader |
| TinyXML-2 | as fetched by MuJoCo 3.7.0 | Zlib | https://github.com/leethomason/tinyxml2 |
| Eigen | 3.4.1 | MPL-2.0 | https://gitlab.com/libeigen/eigen |
| yaml-cpp | 0.8.0 | MIT | https://github.com/jbeder/yaml-cpp |
| Emscripten runtime | 6.0.9 | MIT / University of Illinois NCSA | https://github.com/emscripten-core/emscripten |

The page loads three.js r128 (MIT) from a public CDN; it is not part of this repository.
