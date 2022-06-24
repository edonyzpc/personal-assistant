.PHONY: debug clean

debug:
	mkdir -p dist/.obsidian/plugins/obsidian-plugins-mng/
	npm i
	npm run build
	cp main.js dist/.obsidian/plugins/obsidian-plugins-mng/
	cp manifest.json dist/.obsidian/plugins/obsidian-plugins-mng/
	cp styles.css dist/.obsidian/plugins/obsidian-plugins-mng/

clean:
	rm -rf dist/.obsidian/plugins/obsidian-plugins-mng/*