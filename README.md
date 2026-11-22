# RDAP, but for Humans

A privacy-first RDAP viewer distributed as a browser extension and a self-hosted static web application. RDAP requests originate in your browser. The Docker image serves static files only: it does not proxy requests or record lookup queries.

## Project structure

- `core/` is the shared source of truth for RDAP recognition, IANA bootstrap lookup, safe rendering, filtering, themes, syntax highlighting and styles.
- `assets/` contains the local RDAP -h icon artwork. Extension icons are selected by size from this pack; the static web build copies its SVG favicon and PNG fallbacks.
- `extension/` contains the Manifest V3 browser integration, settings, local lookup page and packaging script. `node extension/build.mjs` bundles the shared core locally.
- `web/` is the standalone static frontend, also used for local development and browser testing.
- `docker/` contains the unprivileged nginx image configuration. `tests/` covers packaging and Docker assets.
- `.github/workflows/` contains CI, Pages deployment and GHCR release automation. The existing extension release workflow remains separate.

## Browser extension

Use Chrome or Edge 121+ (Manifest V3). Firefox 121+ support is intended through the WebExtension background script fallback; verify the current release in Firefox before distribution.

Build and load `extension/` as an unpacked extension from the browser's extensions page:

```sh
node extension/build.mjs
```

Open **Extension options** to choose **Automatic** (default) or **On demand**. Automatic mode recognizes supported RDAP JSON pages and opens the HUMAN view. On demand leaves page content alone until the toolbar icon is clicked. On an RDAP response, the icon opens the viewer with a control to restore the original response; elsewhere it opens the bundled lookup page.

The single lookup input accepts IPv4, IPv6, domain names (including internationalized names), ASNs, and complete HTTPS RDAP URLs. IANA bootstrap registries select a service for address, domain, and ASN lookups. HUMAN/MACHINE mode, JSON highlighting and exact raw copying, filtering, expand/collapse, an Auto/Light/Dark theme selector with inline monitor/sun/moon icons on both landing and results views, help tooltips, share links, and readable rate-limit/network errors are supported. Auto follows live OS theme changes; manual selections override the OS theme.

### Extension permissions

- `storage`: saves operating mode and local view/theme preferences.
- Optional `https://*/*` host access: the extension asks at runtime for the HTTPS IANA bootstrap origin and selected RDAP service origins needed for a lookup. Registries are discovered dynamically, so a fixed list would break valid lookups.
- HTTP(S) content-script matches: required to recognize RDAP responses in Automatic mode. The script only parses candidate RDAP documents; On demand does not parse or alter the page until the icon action. The broad match is necessary because RDAP services are hosted across many registries.

No `tabs`, `scripting`, or persistent broad host permission is requested. Content scripts and all executable code are packaged locally. Browser user/enterprise policies may still restrict optional host permission prompts.

## Docker self-hosting

The image is an nginx static server, runs as a non-root user, listens on port 8080, and disables access logs so request query strings are not written to container logs. Stable multi-architecture images are published to `ghcr.io/realvorl/rdap-h`.

```sh
docker run -d \
  --name rdap-h \
  -p 8080:8080 \
  ghcr.io/realvorl/rdap-h:latest
```

Or use Compose from the repository checkout:

```sh
docker compose up -d --build
```

Then open `http://localhost:8080/`. Stop the Compose service with `docker compose down`.

The web app fetches IANA bootstrap data and RDAP responses directly from the user's browser. Browser CORS policy may block a registry even when it is reachable; the static container does not bypass CORS and does not include a proxy or backend. A self-hosted domain does not change that browser restriction.

## Privacy, attribution and support

There is no analytics, telemetry, tracking cookie, lookup-history collection, third-party script, or server-side RDAP query recording. The extension stores view and theme preferences locally; the standalone site stores only view and theme preferences in browser local storage. The website/container does not persist user lookups. Registry attribution is shown in the interface; RDAP, but for Humans is independent and is not affiliated with registries. RealVorl attribution and links to [GitHub](https://github.com/realvorl/rdap-h), [GitHub Issues](https://github.com/realvorl/rdap-h/issues), and [Ko-fi](https://ko-fi.com/realvorl) are included in the UI.

Report bugs or request support through [GitHub Issues](https://github.com/realvorl/rdap-h/issues). Donations are optional via [Ko-fi](https://ko-fi.com/realvorl).

## Local development and tests

Requires Node.js 24 for the pinned Docker build stage (the scripts and tests use built-in Node APIs only).

```sh
node extension/build.mjs
node web/build.mjs
node extension/package.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js tests/*.test.js
find core extension web tests site -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
```

Preview locally with `python3 -m http.server 8000` at `http://localhost:8000/web/`. Generated outputs are `extension/bundle/`, `extension/lookup/app.js`, `site/`, and `dist/`; edit their source files instead.

## GitHub Pages

The standalone static app deploys to [https://realvorl.github.io/rdap-h/](https://realvorl.github.io/rdap-h/). Pushes to `main` deploy only after the CI workflow succeeds; `workflow_dispatch` also runs the build, complete tests and syntax checks before deployment. The Pages artifact is generated in `site/` and contains only the web app, shared core files and required local icon assets. It includes `.nojekyll`; assets use relative paths so the site works under the `/rdap-h/` project path. No extension, tests, or Docker configuration is uploaded.

Before the first deployment, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Ensure the `github-pages` environment is available and allow GitHub Actions to deploy Pages. Do not configure a custom domain. After deployment, verify the landing page and a direct `?url=` link, use **New lookup** to return home, and check CSS, JavaScript and favicon requests under `/rdap-h/`.

## Release procedure

CI runs on pushes to `main` and pull requests targeting `main`, with read-only repository access. It builds the web and extension test artifacts, runs the full Node test suite and JavaScript syntax checks, validates referenced assets, and builds the Docker image without publishing.

The Docker workflow reruns the complete tests and syntax checks before publishing on a stable `vMAJOR.MINOR.PATCH` tag or a manual workflow dispatch from `main` with an explicit `MAJOR.MINOR.PATCH` version. It builds `linux/amd64` and `linux/arm64`, publishes the immutable version tag and `latest`, and refuses to overwrite an existing version tag. `latest` advances with each approved stable release. Authentication uses the workflow's `GITHUB_TOKEN`; Docker Hub credentials are not used. To publish, allow GitHub Actions to use the repository `GITHUB_TOKEN`, then create the repository package through the workflow and set package visibility to **Public** in the package settings if public pulls are intended. Check that the package is linked to `realvorl/rdap-h` (the image supplies `org.opencontainers.image.source`). No image is published during ordinary CI or pull requests.

The extension artifact workflow is independent and remains tag-triggered. Never create or push a release tag, dispatch a publishing workflow, or deploy without explicit release approval.

The project is distributed under the existing [MIT License](LICENSE).
