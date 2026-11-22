# RDAP Human Viewer

A dependency-free browser extension that turns RDAP registration responses into a readable, standards-aware view. The extension is the only distributed product. `web/` remains as a local development and browser-testing interface; it is not deployed.

## Architecture

- `core/` contains RDAP recognition, filtering, field explanations, the shared HUMAN/MACHINE renderer, JSON highlighting, and shared CSS.
- `extension/` contains the Manifest V3 integration, toolbar action, settings page, and extension-local lookup interface. Run the build before loading the unpacked extension; shared assets are copied into `extension/bundle/` and the lookup app into `extension/lookup/app.js`.
- `web/` contains the standalone local development frontend and its tests. It reuses `core/` and is not part of extension runtime.
- `.github/workflows/tests.yml` runs builds, automated tests, and JavaScript syntax checks. There is no website deployment workflow.

## Build, preview, and install

Use Node.js 20 or newer. From the repository root:

```sh
node extension/build.mjs
node web/build.mjs
```

Load `extension/` as an unpacked extension in Chrome or Edge. Open the extension's **Details → Extension options** to choose Automatic or On demand. The local web testing interface can be previewed with `python3 -m http.server 8000` from the repository root at `http://localhost:8000/web/`.

Automatic is the default and recognizes supported RDAP JSON responses. On demand leaves pages untouched until the toolbar icon is clicked on an RDAP response. The icon opens the extension's local lookup page on other pages. Lookups support public IPv4/IPv6 addresses, domains, ASNs, and complete HTTPS RDAP URLs. Extension lookups may ask permission to contact IANA and the selected RDAP service; the extension requests only the HTTPS origins needed for that lookup. Bootstrap data is cached in memory. Network and CORS failures, invalid responses, and HTTP rate limits are shown in the UI.

## Tests and style

```sh
node extension/build.mjs
node web/build.mjs
node --test core/tests/*.test.js extension/tests/*.test.js web/tests/*.test.js
find core extension web site -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
```

Keep dependencies at zero. Use two-space indentation, single quotes, semicolons, and camelCase. Add tests beside the component they cover. Do not edit generated bundles directly.

## Security and attribution

The extension uses the `storage` permission for operating mode and viewer preferences. Optional HTTPS host access is requested for IANA bootstrap and selected RDAP registry origins when a lookup requires it. Automatic RDAP recognition uses the existing HTTP(S) content-script matches; the script only reads response bodies for supported RDAP URLs, and On demand does not inspect page content until the toolbar action is invoked. No analytics, tracking, backend, remote executable code, or new runtime dependencies are used.

The project retains its [MIT license](LICENSE) and contributor copyright attribution. Manual release checks should cover Automatic and On demand behavior, the original-response return control, toolbar lookups and permission prompts, stored preferences across extension reload/restart, Chrome and Edge, CORS/network errors, and invalid RDAP responses.
