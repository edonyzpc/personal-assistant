.PHONY: deploy clean bin

bin:
	yarn build

deploy: bin
	cp dist/main.js test/.obsidian/plugins/obsidian-plugins-mng/
	cp dist/manifest.json test/.obsidian/plugins/obsidian-plugins-mng/
	cp dist/manifest-beta.json test/.obsidian/plugins/obsidian-plugins-mng/
	cp dist/styles.css test/.obsidian/plugins/obsidian-plugins-mng/

clean:
	rm -rf test/.obsidian/plugins/obsidian-plugins-mng/*