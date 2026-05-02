.PHONY: deploy clean bin install release tag test

install:
	npm install

bin: test
	npm run lint && npm run build

deploy: clean bin
	cp dist/main.js test/.obsidian/plugins/personal-assistant/
	cp dist/manifest.json test/.obsidian/plugins/personal-assistant/
	cp dist/manifest-beta.json test/.obsidian/plugins/personal-assistant/
	cp dist/styles.css test/.obsidian/plugins/personal-assistant/

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

tag:
	git tag -a `node tag.mjs` -m "[release] v`node tag.mjs`, check the CHANGELOG.md for details"
	git push --tags
