# Repository instructions

## Release process

- Follow semantic versioning and update `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` together.
- Run `npm run build`, `npm run lint`, and `git diff --check` before creating a release commit or tag.
- Every release tag must be an annotated tag. Do not create lightweight release tags.
- The tag annotation must describe the user-facing changes in that version. Include a short release title followed by concise bullet points for new features, compatibility changes, and important fixes.
- Create the tag with an explicit message, for example:

  ```bash
  git tag -a 1.2.0 -m "Release 1.2.0" -m "- Add feature X" -m "- Fix issue Y"
  ```

- Push both the release commit and the annotated tag, then verify that the GitHub Release workflow succeeds and that `main.js` and `manifest.json` are downloadable.
