const fs = require("fs");
const path = require("path");
const os = require("os");
const obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
  path: ".obsidian-current-file.json",
};

module.exports = class CurrentFilePlugin extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    if (!this.app.isMobile) {
      // navigation
      this.registerEvent(
        this.app.workspace.on(
          "active-leaf-change",
          this.writeCurrentFilename.bind(this)
        )
      );

      // opening a new file
      this.registerEvent(
        this.app.workspace.on("file-open", this.writeCurrentFilename.bind(this))
      );

      // renaming a file (needed in case someone renames the current file they're editing!)
      this.registerEvent(
        this.app.vault.on("rename", this.writeCurrentFilename.bind(this))
      );

      this.addSettingTab(new CurrentFileSettingTab(this.app, this));
    }
  }

  writeCurrentFilename() {
    // get the vault path
    let adapter = app.vault.adapter;
    if (!adapter instanceof obsidian.FileSystemAdapter) {
      // this isn't a filesystem adapter, so we can't get the path of the
      // file we're viewing.  Do not update the file
      return;
    }
    const vaultPath = adapter.getBasePath();

    // get the current active file path
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      // we're not looking at an active file, don't update the path of the
      // file we're viewing
      return;
    }
    const filePath = activeFile.path;

    // create the output
    const encodedJSON = JSON.stringify({
      file: filePath,
      vault: vaultPath,
      fullpath: path.join(vaultPath, filePath),
    });

    // write the file out
    // by using resolve instead of join, we can handle the case where the
    // filename is a filename is an absolute path
    const destFilename = path.resolve(os.homedir(), this.settings.path);
    fs.writeFile(destFilename, encodedJSON, (err) => {
      if (err) {
        console.error("Error writing filename to file", err);
      }
    });
  }
};

// Settings tab
class CurrentFileSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName("Path")
      .setDesc(
        "Where to save the current file information. " +
          "If this is not an absolute path then it will be treated as " +
          "relative to your home directory / profile directory."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.path).onChange(async (value) => {
          this.plugin.settings.path = value;
          await this.plugin.saveData(this.plugin.settings);
        })
      );
  }
}
/* nosourcemap */