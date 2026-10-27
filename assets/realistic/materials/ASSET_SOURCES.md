# City visual assets

- `new-york-day-panorama.png`, `miami-dusk-panorama.png`, `mountain-pass-panorama.png`, and `fuel-stop-panorama.png` are original images generated for BenTown from the user's scene references. The game switches the distant equirectangular environment and lighting as Oshu enters each matching district. These maps are backdrops, not street geometry.
- `asphalt-01-*` are 1K PBR maps from Poly Haven's [Asphalt 01](https://polyhaven.com/a/asphalt_01) material. Poly Haven marks the material CC0. The game packs 512px RGBA versions in `src/assets/cityAsphaltTextures.ts` for Expo GL.
- `src/assets/nycFacadeTextures.ts` contains the project's previously generated building facade tiles.
- `nyc-brownstone-brick-albedo-v2.png` and `nyc-asphalt-albedo-v2.png` are original seamless textures generated for BenTown. `scripts/generate_photo_city_textures.js` packs them as 512px albedo maps and derives normal and roughness maps for the Three.js city renderer in `src/assets/photoCityTextures.ts`.
