.PHONY: deploy deploy-icloud deploy-current deploy-icloud-current clean bin install changelog release-dry-run release publish test

ICLOUD_PLUGIN_DIR ?= $(HOME)/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant

install:
	npm install

bin:
	bash scripts/check-platform-guards.sh
	npm run lint
	npm run build
	npm run test:all -- --runInBand

deploy: bin
	node scripts/deploy-current.mjs "test/.obsidian/plugins/personal-assistant"

deploy-icloud: bin
	node scripts/deploy-current.mjs "$(ICLOUD_PLUGIN_DIR)"

# Copy a current production build after appropriate checks have already passed.
# These explicit targets check artifact identity; they do not run tests or lint.
deploy-current:
	node scripts/deploy-current.mjs "test/.obsidian/plugins/personal-assistant"

deploy-icloud-current:
	node scripts/deploy-current.mjs "$(ICLOUD_PLUGIN_DIR)"

clean:
	rm -rf test/.obsidian/plugins/personal-assistant/main.js
	rm -rf test/.obsidian/plugins/personal-assistant/manifest.json
	rm -rf test/.obsidian/plugins/personal-assistant/manifest-beta.json
	rm -rf test/.obsidian/plugins/personal-assistant/styles.css
	rm -rf test/.obsidian/plugins/personal-assistant/vss-sqlite-worker.js
	rm -rf test/.obsidian/plugins/personal-assistant/sqlite3.wasm

test:
	npm test

release:
	node scripts/release.mjs "$(VERSION)"

release-dry-run:
	node scripts/release.mjs --dry-run "$(VERSION)"

changelog:
	node scripts/changelog.mjs --target-version "$(VERSION)" --write

publish:
	node scripts/publish-release.mjs "$(VERSION)"
