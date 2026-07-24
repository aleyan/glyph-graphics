# Releasing

Releases are published from GitHub Releases by `.github/workflows/publish.yml`.
The workflow verifies tests, types, both JavaScript module formats, declarations,
and clean consumer installs before it publishes.

## First publication

The `glyph-graphics` name is not yet present on npm, so npm cannot have a
Trusted Publisher configured for it before the first publication.

1. Create an npm granular access token that can create and publish this public
   package, then add it to the GitHub repository as the `NPM_TOKEN` Actions
   secret.
2. Run `bun run check` locally and confirm that `CHANGELOG.md` describes the
   release.
3. Push the version commit and tag:

   ```bash
   git tag v0.1.0
   git push origin main v0.1.0
   ```

4. Create and publish the matching `v0.1.0` GitHub Release. Publishing the
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

1. Update the package version and move changelog entries from `Unreleased` into
   a dated section.
2. Run `bun run check`.
3. Commit, tag the exact version as `vX.Y.Z`, and push the commit and tag.
4. Publish the matching GitHub Release.

Use normal semantic-versioning rules: patch for compatible fixes, minor for
compatible features, and major for incompatible API changes.
