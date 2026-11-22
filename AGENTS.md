# Repository Guidelines

## Project Structure

This repository has three components. `core/` is the sole source of truth for RDAP parsing, filtering, field explanations, JSON tokenization, the shared renderer, and `viewer.css`. `extension/` contains the browser manifest, content integration, icons, tests, and `build.mjs`, which copies core assets into the local `bundle/` required by extension packaging. `web/` contains the standalone static frontend, URL/IP/domain/ASN lookup and IANA bootstrap resolution, tests, CNAME, and `build.mjs`, which assembles the web app plus required core assets into `site/`. Do not edit generated bundles directly.

## Build and Test

Run from the repository root with Node.js 20 or newer:

```sh
node extension/build.mjs
node web/build.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js
```

Run syntax checks with `node --check` on each `.js` and `.mjs` source. For a local web preview, start `python3 -m http.server 8000` at the repository root and open `/web/`; the frontend loads shared assets from `/core/`. Load the extension by selecting `extension/` as an unpacked extension after building.

## Coding and Testing

Keep dependencies at zero. Use two-space indentation, single quotes, semicolons, and camelCase. Keep parsing and shared presentation behavior in `core/`; frontend-specific lookup validation, IANA bootstrap fetching, navigation, and browser DOM preservation belong in `web/` and `extension/`. Limit remote web requests to the four HTTPS IANA bootstrap registries and selected HTTPS RDAP services; cache bootstrap data with an expiry and a bounded cache. Handle HTTP 429 before parsing a response, respect exposed `Retry-After` values, and retry only after a user action. Abort obsolete bootstrap and RDAP requests on new lookups. Use `textContent` for untrusted values, validate constructed URLs, and keep executable extension assets local. Add tests beside the component they cover and run both builds before tests that compare generated bundles.

## Pull Requests and Security

Use concise imperative commit subjects. Describe user-visible behavior, tests, and manual browser checks in pull requests; include screenshots for visual changes and call out permission/privacy changes. The extension must remain passive and read-only, and website requests must be limited to IANA bootstrap data and the selected RDAP URL. The website's landing and result pages must attribute registry data to its respective source without implying endorsement; result attribution links to the source RDAP endpoint. The Pages workflow deploys only the generated `site/` artifact; do not deploy manually unless requested.
