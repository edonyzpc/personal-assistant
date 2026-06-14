/* Copyright 2023 edonyzpc */

import { Notice, addIcon, setIcon } from "obsidian";

import { PluginManager } from "./plugin";
import { getPlatformDocument } from "./platform-dom";
import { generateRandomString, icons } from './utils';

export class ProgressBar {
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private noticeEl: DocumentFragment;
    private steps: number;
    private totalSteps: number;
    private idNumber: string;
    private gridID: string;
    private gridDivID: string;
    private gridDivSpanID: string;
    private gridTextID: string;
    private notice!: Notice;

    constructor(plugin: PluginManager, ID: string, total: number) {
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.idNumber = generateRandomString();
        this.gridID = `div-${ID}-progress-bar-grid-${this.idNumber}`;
        this.gridDivID = `div-${ID}-progress-bar-${this.idNumber}`;
        this.gridDivSpanID = `span-${ID}-progress-bar-${this.idNumber}`;
        this.gridTextID = `div-${ID}-progress-bar-text-${this.idNumber}`;
        this.totalSteps = total;
        this.steps = 0;
        const doc = getPlatformDocument();
        this.noticeEl = doc.createDocumentFragment();
        // add progress bar:
        // ```
        // <div class='progress-bar-grid' >
        //   <div class='meter' >
        //     <span style='width:39.3%' > </span>
        //   </div >
        //   <div class='progress-bar-number' > 39.3 % </div > 
        // </div >
        // ```
        const divPluginUpdateProgressBarGrid = this.noticeEl.createEl("div", { attr: { id: this.gridID } });
        divPluginUpdateProgressBarGrid.addClass('progress-bar-grid');
        const divProgressBarMeter = divPluginUpdateProgressBarGrid.createEl("div", { attr: { id: this.gridDivID } });
        divProgressBarMeter.addClass('meter');
        divProgressBarMeter.createEl('span', { attr: { id: this.gridDivSpanID } }).setCssStyles({ width: "0%" });
        const divProgressBarText = divPluginUpdateProgressBarGrid.createEl("div", { attr: { id: this.gridTextID } });
        divProgressBarText.addClass('progress-bar-number');
        divProgressBarText.setText(`0%`);
        addIcon('PLUGIN_UPDATE_STATUS', icons['PLUGIN_UPDATE_STATUS']);
        addIcon('PLUGIN_UPDATED_STATUS', icons['PLUGIN_UPDATED_STATUS']);
        addIcon('SWITCH_ON_STATUS', icons['SWITCH_ON_STATUS']);
        addIcon('SWITCH_OFF_STATUS', icons['SWITCH_OFF_STATUS']);
    }

    addDiv(itemID: string, divText: string) {
        const noticeEl = getPlatformDocument().getElementById(this.gridID);
        if (noticeEl) {
            const div = noticeEl.parentElement?.createEl("div", { attr: { id: `div-${itemID}-${this.idNumber}` } });
            if (div) {
                div.addClass('progress-bar-items-grid');
                div.addClass('progress-bar-items-error');
                setIcon(div, 'SWITCH_OFF_STATUS');
                div.createSpan({ text: divText, attr: { class: "progress-bar-items-text" } });
                div.querySelector('svg')?.addClass("plugin-update-svg");
            } else {
                this.log("fail to find notice DocumentFragment");
            }
        } else {
            this.log("fail to find plugin updating notice HTML Element");
        }
    }

    show() {
        if (this.notice) {
            //  the Notice will stay visible until the user manually hide() it.
            return;
        }
        this.notice = new Notice(this.noticeEl, 0);
        const progressBarGrid = getPlatformDocument().getElementById(this.gridID);
        progressBarGrid?.parentElement?.setAttribute("id", `progress-bar-${this.idNumber}`);
        progressBarGrid?.parentElement?.addClass('progress-bar-notice');
    }

    hide() {
        this.notice.hide();
    }

    stepin(itemID: string, divText: string, total?: number) {
        let totalSteps = this.totalSteps;
        if (total) {
            totalSteps = total;
        }
        this.steps++;
        const progress = this.steps >= totalSteps ? totalSteps : this.steps;
        const doc = getPlatformDocument();
        const spanProgressBar = doc.getElementById(this.gridDivSpanID);
        spanProgressBar?.setCssStyles({ width: `${(100 * (progress / totalSteps)).toFixed(1)}%` });
        const divProgressBarText = doc.getElementById(this.gridTextID);
        divProgressBarText?.setText(`${(100 * (progress / totalSteps)).toFixed(1)}%`);
        const div2Display = doc.getElementById(`div-${itemID}-${this.idNumber}`);
        if (div2Display) {
            const spanItem = div2Display.getElementsByTagName('span').item(0);
            if (spanItem) {
                div2Display.removeChild(spanItem);
            }
            const svgItem = div2Display.getElementsByTagName('svg').item(0);
            if (svgItem) {
                div2Display.removeChild(svgItem);
            }
            setIcon(div2Display, 'SWITCH_ON_STATUS');
            div2Display.createSpan({ text: divText, attr: { class: "progress-bar-items-text" } });
            div2Display.querySelector('svg')?.addClass("plugin-update-svg");
        }
    }

    updateProgress(percentage: number) {
        const doc = getPlatformDocument();
        const spanProgressBar = doc.getElementById(this.gridDivSpanID);
        spanProgressBar?.setCssStyles({ width: `${percentage}%` });
        const divProgressBarText = doc.getElementById(this.gridTextID);
        divProgressBarText?.setText(`${percentage}%`);
    }
}
