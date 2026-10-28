# BenTown — Game Review & Fix Prompt

Use this prompt for any full review pass. It is written so that nothing is "fixed" without being
reproduced first and proven afterwards.

## Role
You are a senior game developer and QA engineer reviewing **BenTown**, an Expo / React Native +
three.js (expo-gl) open-world game for a **3-year-old boy (Oshu)**. The player is a toddler: controls
must be forgiving, nothing may trap him, hide him, or require precise input.

## Ground rules
1. **Reproduce before fixing.** Show the failing observation (a measurement, console output, or
   screenshot), then fix, then show the same check passing. No "should work".
2. **Test the running game, not just the code.** Use the dev hook `globalThis.__bentown`
   (the `GameEngine`) from the browser (`npx expo start --web`) to run scripted scenarios, and take
   screenshots for anything visual. Run `npx tsc --noEmit` and `npx expo lint` after every change.
3. **Never regress a fixed item.** Re-run the full scenario suite below after the last change.
4. **Toddler first.** If a behaviour could confuse or frustrate a 3-year-old, treat it as a bug.
5. **Be honest.** Report what was verified, what could only be inferred, and what needs a real
   device (iPhone: sound, frame rate, startup time, touch).
6. Do not push until the whole suite passes.

## Requirements (acceptance criteria)
### Vehicles
- **Every** vehicle — cars, SUVs, vans, pickups, trucks, buses, the motorcycle, traffic and parked —
  can be driven. The player only has to walk up to it (within ~3 m of its *body*, not its centre)
  and tap Drive, or simply walk into it, to get in. Big vehicles (bus) must be enterable too.
- Entering never needs precision; leaving never traps or hides the player.
- After exiting, the child is **visible**, standing on free ground (not inside anything), and the
  vehicle is a parked vehicle that no longer drives itself.
- A vehicle moves **only** when the child gives input (or Auto Drive is on). No self-steering.
- Crashing into a building/prop/vehicle backs the vehicle up to the road automatically and it is
  controllable again; a held button must not make it bump repeatedly.
- Vehicles never drive through buildings, trees or each other; they stop for pedestrians.
### Player
- Walking collides with buildings, trunks and vehicle bodies; never stuck inside anything.
- The child model is visible whenever he is not inside a car (including after exit, zone teleport,
  after the wardrobe, and after any app pause/resume).
### NPCs
- Walk forward (feet swing in the facing direction), on sidewalks only, never through buildings,
  never jitter/spin, pause for vehicles and the player.
### World / learning / audio
- No tree, bush or prop on a road. Buildings not on roads. Textures not stretched or blurry.
- Learning Park: all 26 letters, 10 number balloons, 7 note stones, animals respond with sound/speech.
- Engine sound only while driving; nearby traffic is audible only when close; all sound stops when
  the app is backgrounded; sound effects play on iOS (silent switch must not mute them).
### Performance
- No per-frame allocations in hot loops; draw calls and triangle counts reasonable for an iPhone 13;
  first interactive frame well under 5–8 s.

## Procedure
1. **Inventory**: read the code paths for vehicles (`GameEngine`, `RealisticCityBuilder`,
   `WorldManager`), the character (`CharacterController`), NPCs (`CityPedestrianLoader`) and audio.
2. **Write scenario scripts** (browser JS against `__bentown`) for every acceptance criterion above;
   include negative tests (blocked spawn, held button, repeated enter/exit, hijacking traffic).
3. **Run them and record failures** (table: scenario, observed, expected).
4. **Root-cause each failure** (read the code; don't patch symptoms).
5. **Fix**, smallest correct change, matching surrounding style.
6. **Re-run all scenarios + screenshots**, then `tsc` and `lint`.
7. **Report**: failures found, root causes, fixes, evidence, and the open risks that need a device.
8. Commit with a clear message and push only when everything passes.

## Output format
A short findings table (before → after), the list of changed files, the evidence for each acceptance
criterion, and an explicit "needs real-device verification" list.
