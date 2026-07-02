# Library — publishing your books

The **Library** app downloads system PDF books from a source you control and
caches them inside Foundry, so players read them locally (no need for the
source to stay online afterwards). You publish books in three steps.

## 1. Put your PDFs in a folder

Any layout works; sub-folders become folders in the Library app:

```
books/
  Core/
    Cyberpunk RED Core Rulebook.pdf
  DLC/
    Black Chrome.pdf
    Danger Gal Dossier.pdf
```

## 2. Serve the folder

The bundled server has **no dependencies** (Node 18+):

```bash
node tools/library-server.mjs "path/to/books" 8777
```

It indexes every `.pdf` recursively and serves:

- `http://localhost:8777/index.json` — the file list the module reads
- `http://localhost:8777/<relative path>.pdf` — each book, with CORS enabled

## 3. Expose it to the internet with a tunnel

The Foundry client must be able to reach the URL. Pick one:

```bash
# Cloudflare (free, no account needed for quick tunnels)
cloudflared tunnel --url http://localhost:8777

# or ngrok
ngrok http 8777
```

Copy the `https://…` address the tunnel prints.

## 4. Pull the books in-game

Open **Library → Update files** (GM only), paste the tunnel URL
(e.g. `https://random-name.trycloudflare.com`) and confirm.

- The module reads `<url>/index.json`, downloads every **new** PDF, renders a
  cover from the first page, and rebuilds the folder tree.
- Books already downloaded (matched by their source path) are **skipped**, so
  re-running only fetches what's new.
- After the download you can stop the server/tunnel — the books live in
  `Data/cyberpunk-red-agent-os-modified-library/` on the Foundry host.

Players get read-only access to everything. The GM can right-click a book to
**rename** or **delete** it.

---

### Alternative: static hosting

You don't have to use this server. Any host that serves an `index.json` plus
the PDFs with CORS works — GitHub Releases, an S3 bucket, a static site, etc.
Generate just the index with:

```bash
node tools/library-server.mjs "path/to/books" --index-only
```

`index.json` accepts any of these shapes:

```jsonc
// flat list of relative paths
["Core/Core Rulebook.pdf", "DLC/Black Chrome.pdf"]

// objects with an optional display name
{ "files": [ { "path": "Core/Core Rulebook.pdf", "name": "Core Rulebook" } ] }
```
