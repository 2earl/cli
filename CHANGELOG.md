# Changelog

From 0.2.0 on, each version is tagged `v<version>` and has a GitHub release with an installable
package. A version reaches users when its bump is merged to `main`; the release workflow tags it
then.

## 0.2.0 (2026-11-25)

- The CLI speaks Turkish as well as English. It follows the terminal's locale (`LC_ALL`,
  `LC_MESSAGES`, `LANG`); `TWOEARL_LANG=en` or `TWOEARL_LANG=tr` chooses.
- The device sign-in link opens login.2earl.com in the same language.
- Releases are tagged, and each comes with a package you can install without git.

## 0.1.1 (2026-11-12)

- Fix HTTP 400 from the gateway: requests carry the MCP 2026-07-28 envelope and headers.

## 0.1.0 (2026-11-12)

- Sign in with a device code (`2earl login`), sign out and revoke (`2earl logout`), `2earl whoami`.
- Prompt share from the terminal: search, get with `{{variables}}` filled, save.
