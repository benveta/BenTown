# Third-party assets

- `assets/bin/baked-rpm.glb` (+ `tex-baked-rpm-*.bin`): Ready Player Me sample avatar, taken from the three.js repository examples (`examples/models/gltf/readyplayer.me.glb`). Check the Ready Player Me terms before a public/commercial release.
- `assets/bin/baked-anim.glb`: only the "Walk"/"TPose" animation clips are used, from the Mixamo "Soldier" character shipped in the three.js examples. Mixamo content may be used in games but not redistributed as standalone assets; keep this repository private or replace the clips with your own before open-sourcing.
- Vehicle and earlier pedestrian models came from the Kenney asset packs (CC0).

Binary assets in `assets/bin` were converted from their original files (images stripped to raw RGBA) by an offline bake step so they load on React Native.

- `assets/fonts/helvetiker_bold.typeface.json`: Helvetiker font from the three.js examples (Copyright 2004 MAGENTA Ltd., permissive licence — keep this notice with the font).
- `assets/sfx/*.wav`: generated procedurally by a script (no third-party audio).
