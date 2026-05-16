.PHONY: deploy deploy-icloud clean bin install changelog release-dry-run release publish tag test

ICLOUD_PLUGIN_DIR ?= $(HOME)/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant

install:
	npm install

bin: test
	npm run lint && npm run build

deploy: clean bin
	cp dist/main.js test/.obsidian/plugins/personal-assistant/
	cp dist/manifest.json test/.obsidian/plugins/personal-assistant/
	cp dist/manifest-beta.json test/.obsidian/plugins/personal-assistant/
	cp dist/styles.css test/.obsidian/plugins/personal-assistant/

deploy-icloud: bin
	mkdir -p "$(ICLOUD_PLUGIN_DIR)"
	cp dist/main.js "$(ICLOUD_PLUGIN_DIR)/"
	cp dist/manifest.json "$(ICLOUD_PLUGIN_DIR)/"
	cp dist/manifest-beta.json "$(ICLOUD_PLUGIN_DIR)/"
	cp dist/styles.css "$(ICLOUD_PLUGIN_DIR)/"

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

tag:
	git tag -a `node tag.mjs` -m "[release] v`node tag.mjs`, check the CHANGELOG.md for details"
	git push --tags
