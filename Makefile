.PHONY: debug

debug:
	mkdir -p bin/.obsidian/plugins/obsidian-plugins-mng/
	cp main.js bin/.obsidian/plugins/obsidian-plugins-mng/
	cp manifest.json bin/.obsidian/plugins/obsidian-plugins-mng/
	cp styles.css bin/.obsidian/plugins/obsidian-plugins-mng/