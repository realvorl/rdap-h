# Repository Guidelines

## Project Structure

`core/` is the single source of truth for RDAP recognition, filtering, field help, HUMAN/MACHINE rendering, JSON highlighting, and shared CSS. `extension/` contains the Manifest V3 integration, toolbar action, settings page, local lookup page, icons, and tests. `extension/build.mjs` copies shared core assets and the web lookup controller into generated extension paths; do not edit generated files. `web/` is retained only for local development and browser testing. `.github/workflows/tests.yml` runs CI; there is no publishing workflow.

## Build, Test, and Preview

Use Node.js 20 or newer from the repository root:

```sh
node extension/build.mjs
node web/build.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js
find core extension web site -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
```

Load `extension/` as an unpacked extension in Chrome or Edge after building. Preview the development interface with `python3 -m http.server 8000` from the root and open `/web/`.

## Coding and Testing

Keep dependencies at zero. Use two-space indentation, single quotes, semicolons, and camelCase. Shared display behavior belongs in `core/`; browser integration and settings belong in `extension/`; lookup discovery and the local testing interface belong in `web/`. Use safe DOM APIs and `textContent` for untrusted data. Keep executable code local. Extension cross-origin lookup requests must ask for optional host access to the IANA bootstrap and RDAP origins needed for that lookup. Add automated tests next to each component and run both build scripts before tests that compare generated assets.

## Extension Behavior and Privacy

Automatic mode is the default and may inspect only candidate RDAP response pages before rendering. On-demand mode must not parse or modify page content until the user clicks the toolbar icon. The icon opens the bundled lookup interface on non-RDAP pages. Store operating mode and viewer theme/mode preferences with `chrome.storage.local`. Preserve a control that restores the original browser-rendered response. Do not add analytics, remote executable code, broad network requests, or unrelated permissions.

## Changes and Release Checks

Use concise imperative commit subjects. Document user-visible changes, permission changes, tests, and manual browser checks. Check both Automatic and On demand in Chrome and Edge, including toolbar lookup and original-response restoration. Keep the MIT license and contributor attribution intact. Never deploy or publish unless explicitly instructed.
