# Developement

## Env Preparation
- Node: 16.x
- Obsidian API: latest

## Develop
### install
```sh
yarn install
```

### build
```sh
yarn build
```

### test
```sh
mkdir -p test/.obsidian/plugins/personal-assistant/
yarn build
make deploy
```

### lint
```sh
yarn lint
```