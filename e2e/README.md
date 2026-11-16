# Browser tests (Playwright)

These tests drive the real portal UI against a throwaway local stack. They never touch the
production database. Cloudinary is faked unless you opt in.

## One-time setup

```
cd e2e
npm install
set PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers
npm run install-browser
```

## Run

```
cd e2e
set PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers
npm test
```

The run starts and stops the stack:

- MongoDB on port 27099, with its data in the temp folder.
- The TCG server from `..\..\TCG` on port 3005. Point `TCG_DIR` elsewhere if needed.
- The portal dev server on port 3000.

The portal's first compile takes about 3 to 4 minutes. To keep the stack running between runs,
`set E2E_KEEP_STACK=1`.

To test real uploads to Cloudinary, `set E2E_REAL_CLOUDINARY=1`:

- Port 3005 must be free, so the server starts with the keys from `TCG\.env`.
- Only the Cloudinary keys are read from that file.
- Test files are deleted afterwards.

The whole stack uses about 1.5 GB of RAM. Close spare browser windows on a 16 GB machine.

Never build the portal for tests with `npm run build`: its postbuild step overwrites `docs/`,
which is the live portal.
