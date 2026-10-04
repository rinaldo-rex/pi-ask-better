# Releases

The fork publishes **`pi-ask-better`**, never `@eko24ive/pi-ask`. Versions are chosen explicitly; the inherited semantic-release workflow remains disabled.

## One-time npm trust setup

In the `pi-ask-better` package settings on npmjs.com, add a **GitHub Actions trusted publisher**:

| Field | Value |
|---|---|
| Organization or user | `rinaldo-rex` |
| Repository | `pi-ask-better` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions, if shown | Allow direct `npm publish` |

Enter only the filename, not `.github/workflows/publish.yml`. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. Existing account/token permissions are not changed by this setup.

See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers).

## Prepare and publish

1. Update `package.json` and `CHANGELOG.md` for the chosen stable version.
2. Run `pnpm format`, `pnpm check:ci`, `pnpm typecheck`, and `pnpm test`. Inspect `npm pack --dry-run --ignore-scripts` for unintended files.
3. Commit and push the release changes to this fork's `main`.
4. Confirm the npm trust setup is saved before pushing the version tag. For example:

```bash
git tag -a v1.3.1 -m "Release pi-ask-better 1.3.1"
git push origin v1.3.1
```

`.github/workflows/publish.yml` validates that the tag exactly matches the stable package version, the package/repository identify this fork, and the tagged commit belongs to `main`. It installs dependencies and runs CI checks before a separate job publishes with npm OIDC and provenance. Only the publishing job has `id-token: write`; it installs no project dependencies and uses no dependency cache or static credentials.

The publication targets the public npm registry with the `latest` dist-tag. Version tags trigger publication automatically; ordinary branch pushes and pull requests do not.

After the workflow succeeds, verify with `npm view pi-ask-better version dist-tags --json`. Do not move or reuse a published version tag. If publishing fails because npm trust is missing or mismatched, fix the trust configuration and rerun the failed workflow; do not create another version just to retry authentication.
