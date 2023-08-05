# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.3.0](https://github.com/edonyzpc/personal-assistant/compare/1.2.9...1.3.0) (2023-08-05)
### Fix
- `preview record` command cannot preview image
- `preview record` command cannot click the link

### Improvement
- code style

## [1.2.9](https://github.com/edonyzpc/personal-assistant/compare/1.2.8...1.2.9) (2023-08-04)
### Feature
- `preview record` command supports mobile
- `update metadata` command supports excluding path configuration
- `preview record` command supports refresh when the related file content is changed

### Fix
- fix view resizing issue of `hover memos` and `local graph` commands
- fix excluding path configuration empty string issue

## [1.2.8](https://github.com/edonyzpc/personal-assistant/compare/1.2.7...1.2.8) (2023-07-21)
### Improve
- refact manifest module for improving updating plugins/themes performance
- optimize cache mechanism

## [1.2.7](https://github.com/edonyzpc/personal-assistant/compare/1.2.6...1.2.7) (2023-07-05)
### Fix
- theme updater support download zip file of release to update

## [1.2.6](https://github.com/edonyzpc/personal-assistant/compare/1.2.5...1.2.6) (2023-06-30)
### Fix
- view no update after preview-record setting updated

## [1.2.5](https://github.com/edonyzpc/personal-assistant/compare/1.2.4...1.2.5) (2023-06-30)
### Fix
- default setting cause loading failure

## [1.2.4](https://github.com/edonyzpc/personal-assistant/compare/1.2.3...1.2.4) (2023-06-29)
### Feature
- preview multiple records in one view as configured

### Imporve
- plugin updating performance imprvoment

### Fix
- fix CVE-2022-25883

## [1.2.3](https://github.com/edonyzpc/personal-assistant/compare/1.2.2...1.2.3) (2023-06-23)
### Fix
- fix metadata upating conflict issues

## [1.2.2](https://github.com/edonyzpc/personal-assistant/compare/1.2.1...1.2.2) (2023-06-16)
### Feature
- list all callout css style including theme, css snippets, built-in for quick-insert callout
### Improve
- update plugin and theme without prerelease
- style support both light and dark theme
- some UX improvement

## [1.2.1](https://github.com/edonyzpc/personal-assistant/compare/1.2.0...1.2.1) (2023-06-02)
### Improve
- improve status bar to reflecting metadata updating status
- status bar click to open pluging setting tab

## [1.2.0](https://github.com/edonyzpc/personal-assistant/compare/1.1.9...1.2.0) (2023-06-02)
### Improve
- improve setting tab of auto-updating frontmatter of notes
- improve progress bar animation

## [1.1.9](https://github.com/edonyzpc/personal-assistant/compare/1.1.8...1.1.9) (2023-06-01)
### Fix
- apply css grid layout for progress bar
- fix notice UI reentrant issue
- progressing related width display issue


## [1.1.8](https://github.com/edonyzpc/personal-assistant/compare/1.1.7...1.1.8) (2023-05-31)
### Fix
- fix recording command will hide tab header issue
- remove debugging log which is not related

### Docs
- add plugin status in README

## [1.1.7](https://github.com/edonyzpc/personal-assistant/compare/1.1.6...1.1.7) (2023-05-28)
### Features
- supporting updating themes with one command

## [1.1.6](https://github.com/edonyzpc/personal-assistant/compare/1.1.5...1.1.6) (2023-05-26)
### Improve
- updating plugin performance improvement
- updating status notice UI improvement
- other coding improvement

## [1.1.5](https://github.com/edonyzpc/personal-assistant/compare/1.1.4...1.1.5) (2023-05-26)
### Features
- display plugins updating status in notice

## [1.1.4](https://github.com/edonyzpc/personal-assistant/compare/1.1.3...1.1.4) (2023-05-23)
### Features
- supporting updating plugins with one command

## [1.1.3](https://github.com/edonyzpc/personal-assistant/compare/1.1.2...1.1.3) (2023-05-10)
### Fix
- fix local graph resize display issue about with of popover view

## [1.1.1, 1.1.2](https://github.com/edonyzpc/personal-assistant/compare/1.1.0...1.1.2) (2023-05-05)
### Docs
- update README for releasing int Obsidian plugin market

### Improve
- update description for plugin market display

### Fix
- fix `window.app` using issue

## [1.1.0](https://github.com/edonyzpc/personal-assistant/compare/1.0.21...1.1.0) (2023-05-01)
### Improve
- plugin switch on/off command support searching by its name
- plugin switch on/off command UX improving

### Docs
- update the related documents

## [1.0.21](https://github.com/edonyzpc/personal-assistant/compare/1.0.20...1.0.21) (2023-04-28)
### Test
- init test framework for UT

### Improve
- update dependencies
- update github action configuration

## [1.0.20](https://github.com/edonyzpc/personal-assistant/compare/1.0.19...1.0.20) (2023-04-19)
### Fix
- fix mobile hover command view issue


## [1.0.19](https://github.com/edonyzpc/personal-assistant/compare/1.0.18...1.0.19) (2023-04-18)
### Improve
- fix review issue of obsidian plugin community

## [1.0.17, 1.0.18](https://github.com/edonyzpc/personal-assistant/compare/1.0.16...1.0.18) (2023-04-10)

### Imporve
- update old plugin-id as new one
- code style formatting and updating comments
- remove unnecessary code

## [1.0.16](https://github.com/edonyzpc/personal-assistant/compare/1.0.15...1.0.16) (2023-04-10)

### Featrues
- support graph view color configuration and auto-setting

## [1.0.13, 1.0.14, 1.0.15](https://github.com/edonyzpc/personal-assistant/compare/1.0.12...1.0.15) (2023-04-09)

### Test
- update Makefile for plugin manifest changed

### Docs
- update readme by adding video to show usage
- update manifest for plugin info

## [1.0.12](https://github.com/edonyzpc/personal-assistant/compare/1.0.11...1.0.12) (2023-04-08)

### Improve
- hover commands are supported to configure resize style in setting tab

## [1.0.11](https://github.com/edonyzpc/personal-assistant/compare/1.0.10...1.0.11) (2023-04-07)

### Features
- support multiple views auto-resize
- support hover memos auto-resize

## [1.0.10](https://github.com/edonyzpc/personal-assistant/compare/1.0.9...1.0.10) (2023-04-06)

### Features
- hover local graph support auto-resize

## [1.0.9](https://github.com/edonyzpc/personal-assistant/compare/1.0.8...1.0.9) (2023-04-05)

### Features
- add enable/disable plugins command

## [1.0.8](https://github.com/edonyzpc/personal-assistant/compare/1.0.7...1.0.8) (2023-04-04)

### Fix
- local graph view setting option missed issue
- statusbar icon position issue

## [1.0.7](https://github.com/edonyzpc/personal-assistant/compare/1.0.6...1.0.7) (2023-04-02)

### Features
- add hover local graph command

## [1.0.6](https://github.com/edonyzpc/personal-assistant/compare/1.0.5...1.0.6) (2023-03-30)

### Features
- add hover memos command

## [1.0.5](https://github.com/edonyzpc/personal-assistant/compare/1.0.4...1.0.5) (2023-03-25)

### Features
- rename the plugin as obsidian-assistant

### Docs
- update README and README-CN
- update CHANGELOG
- update DEVELOPEMENT

## [1.0.4](https://github.com/edonyzpc/personal-assistant/compare/1.0.2...1.0.4) (2023-03-21)

### Features
- create note in specified directory

## [1.0.2](https://github.com/edonyzpc/personal-assistant/compare/v0.0.1...v0.0.2) (2022-07-23)

### Featrues

- add automatically release github action ([c0f78ae](https://github.com/edonyzpc/personal-assistant/commit/c0f78ae))
- support obsidian BRAT plugin install ([228dc5d](https://github.com/edonyzpc/personal-assistant/commit/228dc5d))

## [1.0.1](https://github.com/edonyzpc/personal-assistant/commit/c0f78aeae3571eda678d6fcc8ccbbae84736c7c9) (2022-7-23)

### Features

- selecting suggested disabled plugins to trigger enable command ([72a44e5](https://github.com/edonyzpc/personal-assistant/commit/72a44e5))

### Bugfix

- callback command related issue ([a37e3f6](https://github.com/edonyzpc/personal-assistant/commit/a37e3f6))
