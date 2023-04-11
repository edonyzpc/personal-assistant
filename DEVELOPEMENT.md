# Developement

## 1. Env Preparation
- Node: 18.x
- yarn: >= 1.22
- Obsidian API: latest

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
yarn install
```

#### 2. add dependency
```sh
yarn add {package-name}@{version}
```

#### 3. build
```sh
yarn build
# use watching mode which will auto build when code files are changed
yarn dev
```

#### 4. lint
```sh
yarn lint
```

#### 5. test
```sh
mkdir -p test/.obsidian/plugins/personal-assistant/
yarn build
make deploy
# open obsidian vault whose path is `test` and do the testing
```

#### 6. release
```sh
# update version with interaction and add new commit and version tag
yarn version
```