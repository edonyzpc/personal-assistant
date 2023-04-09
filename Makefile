.PHONY: deploy clean bin install

install:
	yarn install

bin:
	yarn build

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