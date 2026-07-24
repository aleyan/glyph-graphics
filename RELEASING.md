# Releasing

Release Drafter updates a draft GitHub Release whenever changes land on `main`.
Publishing that draft triggers `.github/workflows/publish.yml`, which verifies
tests, types, both JavaScript module formats, declarations, and clean consumer
installs before publishing the package to npm.

## First publication

The `glyph-graphics` name is not yet present on npm, so npm cannot have a
Trusted Publisher configured for it before the first publication.

1. Create an npm granular access token that can create and publish this public
   package, then add it to the GitHub repository as the `NPM_TOKEN` Actions
   secret.
2. Run `bun run check` locally and confirm that `CHANGELOG.md` describes the
   release.
3. Commit the release version and push it to `main`:

   ```bash
   git push origin main
   ```

4. Open the draft GitHub Release maintained by Release Drafter. Confirm its tag
   is `v0.1.0` and its target is the version commit, edit the notes if needed,
   and click **Publish release**. GitHub creates the tag and publishing the
   release starts the npm workflow.

The workflow deliberately rejects a release whose `vX.Y.Z` tag does not match
the version in `package.json`.

## Trusted publishing

After the package exists on npm, configure its Trusted Publisher with:

- Organization or user: `aleyan`
- Repository: `glyph-graphics`
- Workflow filename: `publish.yml`
- Environment: leave blank

The publish workflow grants only `contents: read` and `id-token: write`. Once a
Trusted Publisher release succeeds, remove the `NPM_TOKEN` repository secret;
the workflow's optional token value is retained only to bootstrap the first
publication.

## Later releases

1. Review the version suggested by the draft release. Release Drafter chooses
   major, minor, or patch from pull-request labels and defaults to patch.
2. Update `package.json` to that exact version and move changelog entries from
   `Unreleased` into a dated section.
3. Run `bun run check`.
4. Commit the version change and push it to `main`.
5. Open the updated draft release, verify its `vX.Y.Z` tag matches
   `package.json`, and click **Publish release**.

Use normal semantic-versioning rules: patch for compatible fixes, minor for
compatible features, and major for incompatible API changes.
