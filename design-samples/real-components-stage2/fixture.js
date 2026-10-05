(async () => {
  const plugin = app.plugins.plugins['personal-assistant'];
  const originalLeaves = app.workspace.getLeavesOfType('sidellm-view');
  if (window.__paDesignStage2) throw new Error('Design fixture is already installed');
  if (originalLeaves.some(leaf => leaf.view.isStreaming)) throw new Error('An original Chat is streaming');
  const baseline = {
    activeLeafId: app.workspace.activeLeaf?.id,
    leafIds: new Set(),
    theme: app.vault.getConfig('theme'),
    fontSize: document.body.style.getPropertyValue('--font-text-size'),
    mobile: app.isMobile,
    debug: require('electron').remote.getCurrentWebContents().debugger.isAttached(),
    panelOpen: plugin.pageletOrchestrator?.panelView?.isOpen ?? false,
  };
  app.workspace.iterateAllLeaves(leaf => baseline.leafIds.add(leaf.id));
  const response = `## 结论

Cat 笔记把猫描述为社会性动物，同时说明它通常独自狩猎。这两种特点对应不同的行为：与人或同类建立关系，并不要求一起获取食物。因此，理解猫的行为时，可以把“社会互动”和“狩猎方式”作为两个维度，避免只用“独居”或“群居”概括全部表现。

整理时，先保留笔记已经写明的特点，再把自己的解释与原始描述分开。关于社会互动，可以继续记录交流方式、与人的关系及具体观察；关于狩猎方式，则记录捕猎对象、活动时段和独自行动的场景。这些都是后续整理的入口，不表示当前笔记已经提供了所有答案。

需要再次判断时，先回到 [[Cat]] 的原文，再查看相关的 [[Dog]] 笔记作比较。来源中的概括是：

> It is a social species, but a solitary hunter and a crepuscular predator.

这条结论用于组织已有信息；它没有要求立即修改笔记，也不把后续比较当成待完成任务。`;
  const fixture = window.__paDesignStage2 = {
    baseline, response,
    prompt: '请归纳 Cat 笔记中猫的社会互动与狩猎方式，形成一条便于以后回看的结论。',
    calls: [], errors: [], mode: 'complete', timers: new Set(), ownedLeafIds: new Set(),
    createPanel(longTitle = false) {
      this.panel?.destroy();
      const original = plugin.pageletOrchestrator?.panelView;
      if (!original || baseline.panelOpen) throw new Error('Pagelet base unavailable or original panel open');
      const sample = this;
      const panel = new original.constructor({
        app, getLocale: () => 'en',
        callbacks: {
          onClose: () => sample.panelEvents.push('close'),
          onSourceClick: path => {sample.panelEvents.push('source:'+path); void app.workspace.openLinkText(path, 'Cat.md', 'tab');},
          onRelatedNoteClick: (name, path) => {sample.panelEvents.push('related:'+name); void app.workspace.openLinkText(name, path || 'Cat.md', 'tab');},
          onExpandToTab: () => sample.panelEvents.push('expand-excluded'),
          onSaveAsReviewNote: () => sample.panelEvents.push('save-excluded'),
          onResearchFinding: () => sample.panelEvents.push('research-excluded'),
        },
      });
      this.panelEvents = [];
      this.panel = panel;
      const finding = {
        title: longTitle ? '区分社会互动与狩猎方式——从具体观察回到原始依据，并保留后续比较的空间' : '区分社会互动与狩猎方式',
        description: '保留原始描述，方便回到具体依据。',
        sourceFile:'Cat.md', sourceTitle:'Cat', sourceId:'Cat.md',
        suggestion: {
          source_id:'Cat.md', kind:'clarify',
          rationale:'社会互动和独自狩猎对应不同的观察维度，拆开记录便于回到具体依据。',
          proposed_action:'保留原文，将后续观察分为“社会互动”和“狩猎方式”，并从相关笔记中比较。',
          related_notes:['Dog'],
        },
      };
      panel.mount(document.body);
      panel.open('current', [finding], {sourcePath:'Cat.md'});
      return {open:panel.isOpen,layout:panel.currentLayoutType};
    },
    measure() {
      const root = this.view.containerEl;
      const rect = element => {const r = element.getBoundingClientRect();const s=getComputedStyle(element);return {width:r.width,height:r.height,font:s.fontSize,padding:s.padding,gap:s.gap,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};};
      return {
        root:rect(root), theme:document.body.classList.contains('theme-dark')?'dark':'light',mobile:document.body.classList.contains('is-mobile'),font:getComputedStyle(root.querySelector('.llm-message') || root).fontSize,
        save: Array.from(root.querySelectorAll('.pa-operations-save-suggestion__actions > button')).map(el=>({label:el.textContent,...rect(el),hidden:el.hidden,disabled:el.disabled})),
        composer:root.querySelector('.llm-input')?rect(root.querySelector('.llm-input')):null,
        tools:Array.from(root.querySelectorAll('.llm-buttons button')).filter(el=>!el.hidden && getComputedStyle(el).display!=='none').map(el=>({label:el.getAttribute('aria-label'),...rect(el)})),
        calls:this.calls.length,errors:this.errors,
      };
    },
    async createChat() {
      if (this.view?.isStreaming) throw new Error('Fixture Chat is streaming');
      if (this.leaf) await this.leaf.detach();
      const sample = this;
      const base = plugin.createChatHost();
      const settings = Object.create(base.settings);
      Object.assign(settings, {debug:false, memoryEnabled:false, operationsAgentEnabled:true, operationsProactiveSaveSuggestionsEnabled:true});
      const delay = (ms, signal) => new Promise(resolve => {
        if (signal.aborted) return resolve();
        const id = setTimeout(done, ms);
        sample.timers.add(id);
        function done() {clearTimeout(id); sample.timers.delete(id); signal.removeEventListener('abort', done); resolve();}
        signal.addEventListener('abort', done, {once:true});
      });
      const service = {
        subscribeOperations: () => () => {}, resetContext() {}, cancelPendingOperations() {}, dispose() {},
        getImageCapability: () => 'supported',
        refreshOperationsActionState: state => state,
        async streamLLM(prompt, onChunk, signal, history, options) {
          sample.calls.push({prompt, mode:sample.mode, simulated:true});
          options.onTurnMetadata?.({hasMemoryContent:false, allowedMemorySourcePaths:[], contextUsed:[{category:'current-note',label:'Current note',sources:[{path:'Cat.md'}]}]});
          if (sample.mode === 'error') throw new Error('Controlled DESIGN sample: response unavailable');
          if (sample.mode === 'stream') {
            onChunk('## 结论\n\nCat 笔记把猫描述为社会性动物。');
            await delay(45000, signal);
            if (!signal.aborted) onChunk(response);
            return;
          }
          const body = sample.calls.length === 1 ? response : '受控 DESIGN 样板已收到请求；未调用模型、创建写入预览或保存笔记。';
          onChunk(body);
        },
      };
      const overrides = {
        settings, isOperationsAgentEnabled:true, createChatService:()=>service,
        getAISetupIssue:()=>null, chatHistoryManager:undefined,
        scheduleMemoryExtractionAfterChatTurn() {},
        imageGenerationService:undefined, imageAssetService:undefined, writingVersions:undefined,
        writingSave:undefined, prepareWritingStyleForScene:undefined,
        createGhostPublishingBinding:undefined,
        memoryStatus:{getMaintenancePlan:async()=>({reason:'unavailable',action:'none',notesToCheck:0,requiresApproval:false,canAnswerNow:true}),prepareFromCommand:async()=>{throw new Error('Memory preparation excluded');},updateFromCommand:async()=>{throw new Error('Memory update excluded');},showTechnicalStatus(){},onStatusChanged:()=>()=>{}},
        onSettingsChanged:()=>()=>{},
        log:(message,error)=>{if(error) sample.errors.push({message:String(message),error:String(error)});},
      };
      const host = new Proxy(base, {get(target,key){if(Object.prototype.hasOwnProperty.call(overrides,key)) return overrides[key];return Reflect.get(target,key);}});
      const leaf = app.workspace.getLeaf('tab');
      const view = new originalLeaves[0].view.constructor(leaf, host);
      view.getDisplayText = () => 'Chat · DESIGN test';
      sample.leaf = leaf; sample.view = view; sample.calls = [];
      await leaf.open(view);
      app.workspace.setActiveLeaf(leaf, {focus:true});
      return {id:leaf.id,responseLength:response.length,type:view.getViewType()};
    },
    async restore() {
      this.panel?.destroy();
      if (this.leaf) await this.leaf.detach();
      for(const id of this.ownedLeafIds) {
        const leaf = app.workspace.getLeafById(id);
        if(leaf) await leaf.detach();
      }
      for(const id of this.timers) clearTimeout(id);
      this.timers.clear();
      const active = app.workspace.getLeafById(baseline.activeLeafId);
      if(active) app.workspace.setActiveLeaf(active,{focus:true});
      return {timers:this.timers.size, originalLeafCount:baseline.leafIds.size, restoredActive:app.workspace.activeLeaf?.id === baseline.activeLeafId};
    },
  };
  return await fixture.createChat();
})()
