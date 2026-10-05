# Developement

## 1. Env Preparation
- Node: 22 LTS
- npm: 10.x or 11.x
- Obsidian API: the dependency declared in `package.json`; the minimum runtime version is declared in `manifest.json`

## 2. Develop
### 2.1 developing workflow
1. install dependent packages
2. coding for anything that you would be like(add dependent packages if needed)
3. do lint checking
4. build
5. test
6. update CHANGELOG.md and release

The details about how to do in the above steps, you can check the developing commands.

### 2.2 developing commands
#### 1. update dependency
```sh
npm install
```

#### 2. add dependency
```sh
npm install {package-name}@{version}
```

#### 3. build
```sh
npm run build
# use watching mode which will auto build when code files are changed
npm run dev
# tailwind watch (run in another terminal during dev)
npm run dev:tailwind
```

#### 4. lint
```sh
npm run lint
```

#### 5. test
```sh
mkdir -p test/.obsidian/plugins/personal-assistant/
make deploy
# open obsidian vault whose path is `test` and do the testing
```

#### 6. release

Release preparation and publication are separate actions. Use the current
[release process](./docs/operations/release-process.md) for authority and gates.
Replace `<next-version>` with a semantic version greater than the current
`package.json` version; the placeholder is not an executable release target.

```sh
# choose a version interactively and create the local release commit/tag
make release
# or prepare an explicitly chosen version locally
make release VERSION="<next-version>"
```

Updated against repository commands on 2026-10-06.
