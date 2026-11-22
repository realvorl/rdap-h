# Repository Guidelines

## Architecture

`core/` is the sole source for RDAP parsing, IANA bootstrap discovery, formatting, safe DOM rendering, filtering, themes, JSON highlighting and shared CSS. `assets/` contains local RDAP -h icon artwork. `extension/` contains browser integration, settings, local lookup UI and release packager. `web/` is an independent static app for self-hosting, Pages and development. `docker/` packages only the built static web app and local favicon assets into nginx. `tests/` verifies distribution artifacts. Do not edit generated bundles or `site/`; rebuild them from source. GitHub Pages uploads only `site/`.

## Development

Use built-in Node.js APIs only; there are no runtime or test dependencies. Build from the repository root:

```sh
node extension/build.mjs
node web/build.mjs
node extension/package.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js tests/*.test.js
find core extension web tests site -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
```

Preview `web/` with `python3 -m http.server 8000` from the root. Docker builds use the pinned Node and nginx versions in `docker/Dockerfile`; Compose maps host port 8080 to container port 8080.

## Code and privacy

Use two-space indentation, single quotes, semicolons and camelCase. Keep browser integration in `extension/`, shared behavior in `core/`, and website navigation/fetching in `web/`. Render untrusted RDAP values through safe DOM APIs, never `innerHTML`. Keep all extension JavaScript local. No analytics, tracking, query logging, backend, or proxy. The extension stores only local mode/theme/view preferences; browser lookups go directly to IANA and the selected RDAP registry and remain subject to browser CORS.

The extension requests `storage`, optional HTTPS host access for bootstrap/selected RDAP origins, and HTTP(S) content-script matching for Automatic RDAP recognition. Document any permission change and its reason. On demand must not parse or modify an RDAP page until the toolbar action is invoked.

## Tests and release

Add regression tests beside the affected component and update package tests when manifest files change. CI runs for pushes and pull requests targeting `main`, runs all Node tests and syntax checks, validates web assets, and builds Docker without publishing. Successful `main` CI runs trigger the Pages workflow; manual Pages dispatch also reruns tests. Pages uses the Actions source setting and deploys only `site/` through the `github-pages` environment. The Docker workflow publishes `ghcr.io/realvorl/rdap-h` for stable `vMAJOR.MINOR.PATCH` tags or manual dispatch with a semantic version; `packages: write` belongs only to that publish job. Confirm Pages paths, direct `?url=` navigation, Docker `/healthz`, and CSS/JS/SVG MIME types during manual release verification. Update `CHANGELOG.md` and the manifest version for extension releases. Never deploy, push, publish or create a release tag without explicit authorization. Preserve `LICENSE` and existing RealVorl attribution. Browser RDAP requests remain subject to registry CORS; never add a proxy to bypass it.
