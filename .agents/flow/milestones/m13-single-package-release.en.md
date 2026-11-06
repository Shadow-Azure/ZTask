# Stage 13: Single-package release and CI release pipeline

English | [中文](m13-single-package-release.md)

```yaml flow
kind: milestone
id: m13
title: 阶段 13：单包发布与 CI 发布流水线
status: active
github:
  number: 13
  url: https://github.com/Shadow-Azure/ZTask/milestone/13
```

ZTask can already be built and run inside the repository, but installation still requires a clone, pnpm, and a local build. This stage puts the CLI, server, and Web build outputs into one publishable `ztask` package, with CI packing, smoke testing, and publishing on a version tag.

## Delivery boundary

- Single-package release only: the `npm pack` artifact contains the CLI, server, shared code, and the prebuilt Web app; no multi-package workspace publish.
- The release pipeline is triggered by a version tag and runs build, tests, package-install smoke, npm publish, and GitHub Release in order.
- No Docker, desktop shell, auto-update, or account system; business, storage, and permission models stay unchanged.

## Stage acceptance

- After installing the tarball in a clean directory, `npx ztask serve` starts the admin UI and API, with Web assets resolved from inside the package.
- Pull requests continuously run the package-install smoke; a `v*` tag produces an npm package and a GitHub Release once credentials exist.
- Documentation covers installation, release, and the minimum required credentials.
