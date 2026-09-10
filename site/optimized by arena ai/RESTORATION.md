# ASHEO Source Restoration

The original supplied HTML is the design reference. This revision restores its
typefaces, text, color tokens, section order, 1260px container, hero proportions,
artifact case, feature ring, cream ledger, certificate, and architect section.
There is no replacement photography or new marketing copy on the page.

## Original Artwork Needed

The image attached in chat was not available as a file to the project tools.
The previously generated portrait was removed rather than substituted for it.

Place the supplied 1087 x 976 PNG at `public/assets/dev-cutout.png`. The architect
section will load it automatically. Its local file picker can also preview that
PNG immediately, without uploading it anywhere. A locally selected file is not
part of the deployed website and must still be added to the project path above.

The supplied vertex and fragment shaders are in `src/lib/dither.ts`. Bayer8,
contain fit, alpha handling, monochrome palette, dot sizing, and glow math are
unchanged. The configured values match the original page: pixel-size 2.0,
levels 4, spread 0.68, brightness -0.01, contrast 1.24, monochrome 1, invert 0,
dark #050508, light #f5f2eb, wobble 0.06, and speed 0.4.

## Runtime Changes

- All JS animation jobs share `src/lib/frames.ts` and stop when the page is hidden.
- The gallery and portrait only animate while near or inside the viewport.
- Slower devices receive a static gold shader frame instead of a removed background.
- Dither uniforms update together, image decoding is asynchronous, and the canvas
  backing store only changes on a real resize.
- Textures, shader programs, buffers, observers, event listeners, timers, object
  URLs, animation subscriptions, and audio resources have cleanup paths.
- Pointer effects are sampled once per frame. Native scrolling is not hijacked.
- Case dragging no longer toggles its lid, keyboard activation works, the feature
  controls stay in sync, and the three numeric displays render the correct values.
- The original section geometry remains on mobile; decorative motion is reduced
  without removing the feature ring or changing the site's content.

## Missing Release Destinations

The original source supplied no extension archive, Chrome Web Store URL, or
social URLs. Buttons open honest installation/help dialogs instead of claiming
an extension was installed. These destinations still need the owner's URLs.

## Verification

The Vite production build was run successfully. Browser screenshot comparison,
real-device FPS measurements, and heap profiling could not be run with the
available tools. Do not treat the build result as a pixel-perfect or performance
benchmark certification.

For visual acceptance, compare at the same viewport and browser zoom after the
fonts and vault intro settle. Check the serif italic line, case width, four
feature positions, ledger alignment, and supplied PNG after adding it. Also test
Tab/Enter, Escape in dialogs, touch scrolling, reduced motion, background tabs,
and repeated route/hot-reload teardown.