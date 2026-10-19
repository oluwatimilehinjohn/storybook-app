# Bundled UI assets

These are the exact library versions the existing UI previously loaded from CDNs. They are committed so every deployment serves the same styles, fonts, icons, and rich-text editor without third-party asset requests.

| Files | Official npm package | License file |
| --- | --- | --- |
| `materialize/1.0.0/materialize.min.css` | `materialize-css@1.0.0` | `materialize/1.0.0/LICENSE` |
| `fontawesome/6.2.1/css/` and `webfonts/` | `@fortawesome/fontawesome-free@6.2.1` | `fontawesome/6.2.1/LICENSE.txt` |
| `ckeditor/35.4.0/ckeditor.js` | `@ckeditor/ckeditor5-build-classic@35.4.0` | `ckeditor/35.4.0/LICENSE.md` |

Upstream assets and licenses are retained unchanged. No additional npm runtime dependencies are required. Existing library security/license considerations still apply; bundling is not a version upgrade. Source maps are not used by the application. Asset URLs receive content hashes from `config/presentation.js`, so changed CSS or scripts do not reuse an old cached URL.
