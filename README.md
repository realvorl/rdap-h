# RDAP Human Viewer

A dependency-free, read-only RDAP presentation with three parts: shared parsing and rendering, a browser extension, and a standalone static website.

## Repository layout

- `core/` owns RDAP recognition, field metadata and RFC references, safe links, summaries, filtering, the reusable shadow-DOM renderer, JSON tokenizer, and its single shared stylesheet. HUMAN and MACHINE modes both use this renderer; MACHINE displays indented JSON while its copy-raw control retains the exact server response.
- `extension/` owns the Manifest V3 integration, original-document HUMAN/MACHINE switching, icons, and a small build script. The generated `extension/bundle/` contains local copies of core assets required by browser extension packaging; do not edit those generated copies directly.
- `web/` owns the landing page, IP/URL detection, client-side IANA IPv4/IPv6 bootstrap resolution, RDAP fetches, share links, history navigation, and visible error handling. Its results toolbar includes a base-path-aware New lookup link; the extension does not show it. `web/build.mjs` assembles a deployable site from the web files and only the required core assets.
- `.github/workflows/pages.yml` tests the components and publishes the generated `site/` artifact on pushes to `main` or manual dispatch. `web/CNAME` configures `rdap-h.de`.

## Build, preview, and install

From the repository root:

```sh
node extension/build.mjs
node web/build.mjs
```

Preview the source frontend at `http://localhost:8000/web/` with `python3 -m http.server 8000` running from the repository root. Shared assets resolve from `core/`. For GitHub Pages or `rdap-h.de`, deploy the generated `site/` directory.

To load the extension locally, run the extension build and select `extension/` in Chrome or Edge's **Load unpacked** control. The browser package uses only generated local core scripts and a local stylesheet. No runtime executable code is downloaded.

## Testing and style

Run the zero-dependency Node test suite and syntax checks from the repository root:

```sh
node extension/build.mjs
node web/build.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js
node --check core/rdap.js && node --check core/renderer.js && node --check web/src/app.js && node --check extension/src/content.js && node --check extension/build.mjs && node --check web/build.mjs
```

The shared renderer regression tests include the APNIC `123.11.12.13` network response shape, contact details, repeated emails, labeled postal address, events, remarks, links, registry-specific extension fields, expansion state, filtering, mode switching, and exact-response clipboard copying. jCard contacts use readable phone/address labels and preference annotations; nonempty implementation-specific parameters are tucked into optional Technical details. HUMAN and MACHINE share a full-width, margin-padded container and toolbar with a stable viewport scrollbar gutter. MACHINE shows only formatted JSON, its copy control, and the theme/mode controls; HUMAN provides Expand all and Collapse all for nested disclosures.

Use Node.js 20 or newer. Follow the existing JavaScript style: two spaces, single quotes, semicolons, and camelCase. Add behavior tests beside the component in `core/tests/`, `extension/tests/`, or `web/tests/`. Run both build scripts before tests that compare generated extension assets with core sources.

## Behavior and security

The extension runs only on top-level, browser-exposed RDAP JSON documents. The web app accepts public IPv4/IPv6 addresses or complete HTTP(S) RDAP URLs. For IP addresses it fetches the matching IANA bootstrap registry, applies longest-prefix matching per RFC 9224, and then fetches the selected HTTPS RDAP endpoint; bootstrap and RDAP requests run in the user's browser and require suitable CORS headers. Both frontends use the same renderer, syntax highlighting, filter, theme controls, RFC explanations, safe URL checks, and styling. JSON highlighting creates spans with `textContent`; no response data is inserted with `innerHTML`. The web copy-raw control retains the exact fetched response text; the extension copies the exact JSON text exposed by the browser document. No analytics, tracking, backend, or external script dependencies are used.

## Release checks

Manually check Chrome and Edge against IP, ASN, domain, entity, and nameserver responses; verify filtering, HUMAN/MACHINE mode, light/dark themes, and RFC links. For the website, check IPv4 and IPv6 lookups, bootstrap errors, direct `?url=` links, Back/Forward, successful and failed CORS requests, HTTP failures, malformed JSON, mobile layout, and keyboard navigation. Browser integration, accessibility, visual regression, and store review are not covered by the unit suite.
