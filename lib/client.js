window.__ModuleLoader__.load({
	id: "dsh-native-model-picker",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// dsh-native-model-picker — 渲染端
	//
	// 数据源是宿主的 modelDirectories 服务（ctx.get("modelDirectories")）：每会话一个
	// ModelDirectory，store 里是全量渠道与模型（含 description 与 reasoning.efforts），
	// current 给出当前 {provider, model, reasoningEffort}，select() 完成切换。
	// 本插件负责展示、收藏与交互，卡片挂在 body 直下，样式完全自带（dsh-nmp-* 类）。
	// 覆盖策略：无论 claude 主题在场与否都接管模型入口；主题自带的弹层由本插件样式压制。

		var STYLE_ID = "dsh-nmp-style";
		var PIN_KEY = "dsh-nmp-pins-v1";
		var EFFORT_NAME_KEY = "dsh-nmp-effort-names-v1";
		// 主题（dsh-claude-style）会克隆一个同样带「选择模型」aria-label 的按钮（类名含 dsh-claude-）。
		// 原生按钮与主题克隆按钮都接管（宽口径）
		var TRIGGER_MATCH_SELECTOR = 'button[aria-label*="选择模型"]';
		// 最近一次被点击的触发按钮：主卡锚在它旁边（主题在场时真实按钮可能不可见）
		var lastTriggerEl = null;
		var OPEN_ATTR = "data-open";
		var PIN_ATTR = "data-nmp-pin";
		var CHANNEL_ATTR = "data-nmp-channel";
		var VIEW_ATTR = "data-nmp-view";

		var MAIN_CLASS = "dsh-nmp-main";
		var CH_CLASS = "dsh-nmp-channels";
		var CH3_CLASS = "dsh-nmp-chmodels";
		var ANCHORED_CLASS = "dsh-nmp-anchored";

		var CHECK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';
		var CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';

		function j(tag, cls, text) {
			var el = document.createElement(tag);
			if (cls) el.className = cls;
			if (text != null) el.textContent = text;
			return el;
		}

		function win() {
			return document.defaultView;
		}


		// ---------- 存储 ----------

		function readJSON(key, fallback) {
			try {
				var raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : fallback;
			} catch (e) {
				return fallback;
			}
		}

		function loadPins() {
			var v = readJSON(PIN_KEY, null);
			if (!v || typeof v !== "object" || !Array.isArray(v.sources) || !Array.isArray(v.models)) {
				return { sources: [], models: [], hidden: [] };
			}
			if (!Array.isArray(v.hidden)) v.hidden = [];
			return v;
		}

		function savePins(pins) {
			try {
				localStorage.setItem(PIN_KEY, JSON.stringify(pins));
			} catch (e) { /* 存储失败不影响功能 */ }
		}

		function loadEffortNameConfig() {
			var v = readJSON(EFFORT_NAME_KEY, null);
			if (v && typeof v === "object") {
				if (typeof v.preset === "string" && EFFORT_PRESET[v.preset]) effortNameConfig.preset = v.preset;
				if (v.overrides && typeof v.overrides === "object") effortNameConfig.overrides = v.overrides;
			}
			return effortNameConfig;
		}

		function saveEffortNameConfig(next) {
			effortNameConfig.preset = EFFORT_PRESET[next.preset] ? next.preset : "plain";
			effortNameConfig.overrides = next.overrides || {};
			try {
				localStorage.setItem(EFFORT_NAME_KEY, JSON.stringify({
					preset: effortNameConfig.preset,
					overrides: effortNameConfig.overrides
				}));
			} catch (e) { /* 存储失败不影响功能 */ }
		}

		// ---------- 样式（完全自带；--dsw-* 同名变量保留为本地值） ----------

		var CSS = [
			// 卡片挂在 body 直下：--dsw-alias-* 由 body（含深色态与主题 palette 态）定义，直接继承
			'.dsh-nmp-main,.dsh-nmp-anchored{position:fixed;z-index:2147483000;display:flex;flex-direction:column;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:12px;box-shadow:0 8px 24px rgba(20,20,19,.12),0 2px 6px rgba(20,20,19,.08);padding:4px;}',
			'.dsh-nmp-main{width:280px;min-height:120px;max-height:calc(100vh - 16px);}',
			'.dsh-nmp-channels,.dsh-nmp-chmodels{min-height:0;}',
			'.dsh-nmp-main[data-open="false"]{display:none!important;}',
			'.dsh-nmp-anchored{min-width:200px;max-width:300px;max-height:calc(100vh - 16px);}',
			'.dsh-nmp-search{position:sticky;top:0;z-index:2;display:flex;gap:6px;align-items:center;margin:2px 6px 4px;padding:0 4px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));}',
			'.dsh-nmp-search > input{flex:1;min-width:0;height:28px;border:0;outline:0!important;box-shadow:none!important;background:transparent;color:var(--dsw-alias-label-primary,#141413);font-size:13px;padding:0 4px;}',
			'.dsh-nmp-search > input:focus,.dsh-nmp-search > input:focus-visible{outline:0!important;border:0!important;box-shadow:none!important;}',
			'.dsh-nmp-search > input::placeholder{color:var(--dsw-alias-label-caption,#a6a094);}',
			'.dsh-nmp-search > .dsh-nmp-search-clear{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-caption,#a6a094);font-size:14px;line-height:1;padding:4px 6px;cursor:pointer;border-radius:6px;}',
			'.dsh-nmp-search > .dsh-nmp-search-clear:hover{background:rgba(0,0,0,.08);}',
			// 接管后主题自带弹层（主卡与子卡都带此类）不再出现
			'.dsh-claude-model-popover{display:none!important;}',
			'.dsh-nmp-view,.dsh-nmp-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 4px 4px;}',
			'.dsh-nmp-anchored .dsh-nmp-body,.dsh-nmp-anchored .dsh-nmp-view{padding:4px;}',
			'.dsh-nmp-view > .dsh-nmp-rule{margin:6px 4px 2px;position:relative;padding-right:26px;}',
			'.dsh-nmp-view > .dsh-nmp-rule:first-child{margin-top:2px;}',
			'.dsh-nmp-view > .dsh-nmp-rule > .dsh-cp-star{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:16px;height:16px;font-size:11px;opacity:.55;}',
			'.dsh-nmp-view > .dsh-nmp-rule > .dsh-cp-star:hover{opacity:1;}',
			'.dsh-nmp-rule-name{font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary,#8f8d84);}',
			// 模型行（复刻 claude-picker 的 option 行视觉）
			'.dsh-nmp-option{display:flex;align-items:center;gap:6px;width:100%;min-height:30px;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,#141413);font-size:13px;font-weight:500;line-height:20px;text-align:left;cursor:pointer;box-sizing:border-box;}',
			'.dsh-nmp-option:hover{background:rgba(0,0,0,.08);}',
			'.dsh-nmp-option .dsh-nmp-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
			'.dsh-nmp-option .dsh-nmp-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
			'.dsh-nmp-check{flex:none;width:16px;display:inline-flex;align-items:center;color:var(--dsw-alias-brand-primary,#d97757);}',
			// 渠道行（复刻 claude-picker 的 cell 行视觉）
			'.dsh-nmp-cell{display:flex;align-items:center;gap:2px;width:100%;min-height:34px;padding:5px 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6a62);font-size:13px;font-weight:500;line-height:20px;text-align:left;cursor:pointer;box-sizing:border-box;}',
			'.dsh-nmp-cell:hover{background:rgba(0,0,0,.08);color:var(--dsw-alias-label-primary,#141413);}',
			'.dsh-nmp-cell-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
			'.dsh-nmp-cell-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-caption,#a6a094);}',
			// 星标（复刻 claude-picker）
			'.dsh-cp-star{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;border:0;background:transparent;color:var(--dsw-alias-label-caption,#a6a094);font-size:12px;line-height:1;padding:0;cursor:pointer;border-radius:5px;opacity:0;transition:opacity .1s ease;}',
			'.dsh-cp-star[data-pinned="1"]{opacity:1;color:var(--dsw-alias-brand-primary,#d97757);}',
			'.dsh-nmp-option:hover > .dsh-cp-star,.dsh-nmp-cell:hover > .dsh-cp-star,.dsh-cp-star[data-pinned="1"]{opacity:1;}',
			'.dsh-cp-star:hover{background:rgba(0,0,0,.08);}',
			'.dsh-nmp-empty,.dsh-nmp-nohit{padding:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8f8d84);user-select:none;}',
			// footer：当前模型格（等级入口在输入框下方按钮区，不在卡内）
			'.dsh-nmp-footer{display:flex;gap:4px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));padding:4px 2px 2px;}',
			'.dsh-nmp-footer .dsh-nmp-cell{flex:1 1 auto;min-width:0;}',
			'.dsh-nmp-footer .dsh-nmp-cell-label{display:flex;flex-direction:column;gap:1px;white-space:normal;}',
			'.dsh-nmp-footer .dsh-nmp-effort-line{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
			// 档位取名入口与编辑弹层
			'.dsh-nmp-cfg{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;align-self:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-caption,#a6a094);font-size:14px;line-height:1;cursor:pointer;}',
			'.dsh-nmp-cfg:hover{background:rgba(0,0,0,.08);color:var(--dsw-alias-label-primary,#141413);}',
			'.dsh-nmp-cfg[data-active="true"]{color:var(--dsw-alias-brand-primary,#d97757);}',
			'.dsh-nmp-names{position:fixed;z-index:2147483002;box-sizing:border-box;width:296px;max-height:min(520px,calc(100vh - 32px));display:flex;flex-direction:column;padding:8px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:12px;box-shadow:0 8px 24px rgba(20,20,19,.12),0 2px 6px rgba(20,20,19,.08);}',
			'.dsh-nmp-names-head{display:flex;align-items:center;gap:6px;padding:2px 4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));}',
			'.dsh-nmp-names-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#141413);}',
			'.dsh-nmp-names-close{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-caption,#a6a094);font-size:14px;line-height:1;cursor:pointer;}',
			'.dsh-nmp-names-close:hover{background:rgba(0,0,0,.08);}',
			'.dsh-nmp-names-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 4px 4px;display:flex;flex-direction:column;gap:8px;}',
			'.dsh-nmp-names-row{display:flex;align-items:center;gap:6px;}',
			'.dsh-nmp-names-label{flex:0 0 76px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8f8d84);}',
			'.dsh-nmp-names-input{flex:1 1 auto;min-width:0;height:26px;box-sizing:border-box;padding:0 6px;border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fbfbf9);color:var(--dsw-alias-label-primary,#141413);font-size:12px;line-height:18px;outline:none;}',
			'.dsh-nmp-names-input:focus{border-color:var(--dsw-alias-brand-primary,#d97757);}',
			'.dsh-nmp-names-input:disabled{color:var(--dsw-alias-label-caption,#a6a094);background:transparent;border-color:transparent;padding-left:0;}',
			'.dsh-nmp-names-hint{padding:2px 4px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#a6a094);}',
			'.dsh-nmp-names-presets{display:flex;gap:6px;padding:4px;}',
			'.dsh-nmp-names-preset{flex:1 1 0;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6a62);font-size:12px;cursor:pointer;}',
			'.dsh-nmp-names-preset[data-on="true"]{border-color:var(--dsw-alias-brand-primary,#d97757);color:var(--dsw-alias-brand-primary,#d97757);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#d97757) 10%,transparent);}',
			'.dsh-nmp-names-foot{display:flex;gap:6px;padding:8px 4px 2px;border-top:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));}',
			'.dsh-nmp-names-btn{flex:1 1 0;height:28px;border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6a62);font-size:12px;cursor:pointer;}',
			'.dsh-nmp-names-btn[data-primary="true"]{border-color:var(--dsw-alias-brand-primary,#d97757);background:var(--dsw-alias-brand-primary,#d97757);color:#fff;}',
			'.dsh-nmp-cell-desc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:400;line-height:15px;color:var(--dsw-alias-label-tertiary,#8f8d84);}',
			// 拼接节点内的官方名称样式（品牌图标尺寸由主题 CSS 控制，这里防走样兜底）
			'.dsh-nmp-name .dsh-claude-model-name,.dsh-nmp-effort-line .dsh-claude-model-name{display:inline;}',
			// 触发按钮品牌化：官方 label 由主题或宿主维护，我们不触碰它，生效期间用类隐藏。
			// 目标两枚：主题克隆按钮 .dsh-claude-model-btn；宿主原生按钮 label 类名带哈希，
			// 用 [class*="triggerLabel"] 匹配，宿主重新构建后哈希变化不影响规则
			'.dsh-claude-model-btn.dsh-nmp-triggered > .dsh-claude-model-btn-label{display:none;}',
			'button[aria-label*="选择模型"].dsh-nmp-triggered > [class*="triggerLabel"]{display:none;}',
			'.dsh-nmp-trigger-brand{display:inline-flex;align-items:center;min-width:0;}',
			'.dsh-nmp-trigger-brand:empty{display:none;}',
			'button[aria-label*="选择模型"]:not(.dsh-nmp-triggered) > .dsh-nmp-trigger-brand{display:none;}',
			// 推理等级入口（提取自 claude 主题）：按钮排在触发按钮之后，弹层是滑块
			'.dsh-nmp-effort-btn{flex:none;display:inline-flex;align-items:center;height:28px;padding:0 2px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6e6a60);font-family:var(--dsw-font-family,inherit);font-size:13px;font-weight:500;line-height:20px;letter-spacing:normal;white-space:nowrap;cursor:pointer;transition:background-color var(--dsh-claude-timing-feedback,.12s ease),color var(--dsh-claude-timing-feedback,.12s ease);}',
			'.dsh-nmp-effort-btn:hover{background:var(--dsh-claude-hover-bg,rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#141413);}',
			'.dsh-nmp-effort-pop{position:fixed;z-index:2147483001;box-sizing:border-box;min-width:264px;max-width:min(320px,calc(var(--dsh-claude-page-width,100vw) - 16px));padding:6px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l1,#e8e6dc);border-radius:12px;box-shadow:0 8px 24px rgba(20,20,19,.12),0 2px 6px rgba(20,20,19,.08);transform-origin:bottom right;visibility:hidden;opacity:0;pointer-events:none;transform:scale(var(--dsh-claude-scale-dropdown-exit,.99));scale:calc(var(--dsh-claude-scale-dropdown,.97) / var(--dsh-claude-scale-dropdown-exit,.99));transition:opacity var(--dsh-claude-duration-exit,.12s) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1)),transform var(--dsh-claude-duration-exit,.12s) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1)),scale 0s linear var(--dsh-claude-duration-exit,.12s),visibility 0s linear var(--dsh-claude-duration-exit,.12s);}',
			'.dsh-nmp-effort-pop[data-open="true"]{visibility:visible;opacity:1;pointer-events:auto;transform:none;scale:1;transition:opacity var(--dsh-claude-duration-open,.25s) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1)),transform var(--dsh-claude-duration-open,.25s) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1)),scale var(--dsh-claude-duration-open,.25s) var(--dsh-claude-ease-settle,cubic-bezier(.22,1,.36,1)),visibility 0s;}',
			'body[data-ds-dark-theme] .dsh-nmp-effort-pop{background:var(--dsh-claude-raised,var(--dsw-alias-bg-overlay,#1c1b1a));box-shadow:0 8px 28px rgba(0,0,0,.65),0 2px 8px rgba(0,0,0,.45);}',
			'.dsh-nmp-effort{display:flex;flex-direction:column;gap:3px;padding:3px 7px 4px;min-width:0;-webkit-user-select:none;user-select:none;}',
			'.dsh-nmp-effort-head{display:flex;align-items:baseline;gap:6px;min-width:0;position:relative;}',
			'.dsh-nmp-effort-label{flex:0 0 auto;font-size:13px;line-height:16px;color:var(--dsw-alias-label-secondary,#6e6a60);}',
			'.dsh-nmp-effort-value{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:16px;color:var(--dsw-alias-label-primary,#141413);transition:color var(--dsh-claude-timing-feedback,.12s ease);animation:dsh-nmp-effort-swap-in var(--dsh-claude-duration-swap,.15s) var(--dsh-claude-swap-ease,ease-in-out);}',
			'.dsh-nmp-effort-value,.dsh-nmp-effort-value-ghost{--dsh-nmp-swap-distance:var(--dsh-claude-distance-nudge,4px);}',
			'.dsh-nmp-effort-value-ghost{position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;font-size:13px;line-height:16px;color:var(--dsw-alias-label-primary,#141413);opacity:0;animation:dsh-nmp-effort-swap-out var(--dsh-claude-duration-swap,.15s) var(--dsh-claude-swap-ease,ease-in-out) forwards;}',
			'.dsh-nmp-effort[data-empty] .dsh-nmp-effort-track:before{opacity:.55;}',
			'.dsh-nmp-effort[data-empty] .dsh-nmp-effort-value{color:var(--dsw-alias-label-caption,#a6a094);}',
			'.dsh-nmp-effort-ends{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:11px;line-height:14px;color:var(--dsw-alias-label-caption,#a6a094);}',
			'.dsh-nmp-effort-track{position:relative;height:30px;margin-top:1px;cursor:pointer;touch-action:none;}',
			'.dsh-nmp-effort-track:before{content:"";position:absolute;left:0;right:0;top:50%;height:26px;margin-top:-13px;border-radius:8px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08));}',
			'.dsh-nmp-effort-fill{position:absolute;left:0;top:50%;height:26px;margin-top:-13px;border-radius:8px 0 0 8px;corner-shape:round;background:color-mix(in srgb,var(--dsw-alias-label-primary,#141413) 26%,transparent);transition:width var(--dsh-claude-duration-move,.2s) var(--dsh-claude-ease-glide,cubic-bezier(.22,.61,.36,1)),opacity var(--dsh-claude-duration-move,.2s) ease;pointer-events:none;}',
			'.dsh-nmp-effort-ticks{position:absolute;inset:0;transition:opacity var(--dsh-claude-duration-move,.2s) ease;pointer-events:none;}',
			'.dsh-nmp-effort-tick{position:absolute;top:50%;width:4px;height:4px;margin-top:-2px;transform:translate(-50%);border-radius:50%;corner-shape:round;background:color-mix(in srgb,var(--dsw-alias-label-primary,#141413) 26%,transparent);}',
			'.dsh-nmp-effort-knob{position:absolute;left:0;top:50%;width:16px;height:30px;margin-top:-15px;border-radius:5px;corner-shape:round;background:var(--dsw-static-neutral-bluish-00,#ffffff);box-shadow:0 1px 3px rgba(20,20,19,.28),0 0 0 1px rgba(20,20,19,.06);scale:1;transition:translate var(--dsh-claude-duration-move,.2s) var(--dsh-claude-ease-glide,cubic-bezier(.22,.61,.36,1)),scale var(--dsh-claude-timing-feedback,.12s ease),background-color var(--dsh-claude-duration-fade,.3s) ease,box-shadow var(--dsh-claude-duration-fade,.3s) ease;will-change:translate,scale;}',
			'body[data-ds-dark-theme] .dsh-nmp-effort-knob{box-shadow:0 1px 3px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4);}',
			'.dsh-nmp-effort[data-dragging] .dsh-nmp-effort-knob{scale:1.1;transition:scale var(--dsh-claude-timing-feedback,.12s ease),background-color var(--dsh-claude-duration-fade,.3s) ease,box-shadow var(--dsh-claude-duration-fade,.3s) ease;}',
			'.dsh-nmp-effort[data-dragging] .dsh-nmp-effort-fill{transition:none;}',
			'.dsh-nmp-effort-track:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:1px;border-radius:10px;}',
			'.dsh-nmp-effort-matrix{position:absolute;left:0;right:0;top:50%;height:26px;margin-top:-13px;border-radius:8px;corner-shape:round;overflow:hidden;box-sizing:border-box;display:none;pointer-events:none;}',
			'.dsh-nmp-effort[data-apex] .dsh-nmp-effort-matrix{display:grid;grid-auto-flow:row;}',
			'.dsh-nmp-effort[data-apex] .dsh-nmp-effort-fill,.dsh-nmp-effort[data-apex] .dsh-nmp-effort-ticks{opacity:0;}',
			'.dsh-nmp-effort[data-apex] .dsh-nmp-effort-value{color:var(--dsh-claude-apex-ink,#5f51b5);}',
			'.dsh-nmp-effort[data-apex] .dsh-nmp-effort-knob{background:color-mix(in srgb,var(--dsh-claude-apex,#8b7ad0) 22%,var(--dsw-static-neutral-bluish-00,#ffffff));box-shadow:0 0 10px color-mix(in srgb,var(--dsh-claude-apex,#8b7ad0) 80%,transparent),0 0 0 1px color-mix(in srgb,var(--dsh-claude-apex,#8b7ad0) 35%,transparent);}',
			'body[data-ds-dark-theme] .dsh-nmp-effort[data-apex] .dsh-nmp-effort-knob{box-shadow:0 0 10px color-mix(in srgb,var(--dsh-claude-apex,#9d8ce0) 80%,transparent),0 0 0 1px color-mix(in srgb,var(--dsh-claude-apex,#9d8ce0) 35%,transparent);}',
			'.dsh-nmp-effort-matrix-cell{animation:dsh-nmp-effort-fade-in var(--dsh-claude-duration-surface,.15s) var(--dsh-claude-ease-standard,ease) both;}',
			'.dsh-nmp-effort-matrix-sq{position:relative;width:100%;height:100%;border-radius:1px;--dsh-flash-light:color-mix(in srgb,var(--dsh-claude-apex,#8b7ad0) var(--dsh-flash-mix,62%),var(--dsh-claude-apex-flash,#d9d2f5));background-color:var(--dsh-claude-apex,#8b7ad0);animation:dsh-nmp-effort-flash var(--dsh-claude-period-flash,1.45s) infinite var(--dsh-claude-ease-in-out,ease-in-out);}',
			'.dsh-nmp-effort-matrix-sq:before{content:"";position:absolute;inset:0;border-radius:inherit;background-color:var(--dsh-claude-apex-flash,#d9d2f5);opacity:0;animation:dsh-nmp-effort-front var(--dsh-claude-duration-surface,.15s) var(--dsh-claude-ease-standard,ease) var(--dsh-front-delay,0s) both;}',
			'.dsh-nmp-effort-matrix-sq:after{content:"";position:absolute;inset:0;border-radius:inherit;background-color:var(--dsh-claude-apex-flash,#d9d2f5);opacity:0;animation:dsh-nmp-effort-flow var(--dsh-claude-period-flow,4s) linear var(--dsh-flow-delay,0s) infinite;}',
			'.dsh-nmp-effort-pop:not([data-open="true"]) .dsh-nmp-effort-matrix-cell,.dsh-nmp-effort-pop:not([data-open="true"]) .dsh-nmp-effort-matrix-sq,.dsh-nmp-effort-pop:not([data-open="true"]) .dsh-nmp-effort-matrix-sq:before,.dsh-nmp-effort-pop:not([data-open="true"]) .dsh-nmp-effort-matrix-sq:after{animation:none;}',
			'@keyframes dsh-nmp-effort-flash{0%,14%{background-color:var(--dsh-claude-apex,#8b7ad0)}20%,34%{background-color:var(--dsh-flash-light,#d9d2f5)}to{background-color:var(--dsh-claude-apex,#8b7ad0)}}',
			'@keyframes dsh-nmp-effort-front{0%{opacity:0}30%{opacity:.9}to{opacity:0}}',
			'@keyframes dsh-nmp-effort-flow{0%{opacity:0}3%{opacity:calc(var(--dsh-flow-strength,1) * .95)}6%{opacity:0}to{opacity:0}}',
			'@keyframes dsh-nmp-effort-fade-in{0%{opacity:0}to{opacity:1}}',
			'@keyframes dsh-nmp-effort-swap-in{0%{opacity:0;filter:blur(var(--dsh-claude-swap-blur,2px));transform:translateY(var(--dsh-nmp-swap-distance,4px))}to{opacity:1;filter:blur(0);transform:translateY(0)}}',
			'@keyframes dsh-nmp-effort-swap-out{0%{opacity:1;filter:blur(0);transform:translateY(0)}to{opacity:0;filter:blur(var(--dsh-claude-swap-blur,2px));transform:translateY(calc(-1 * var(--dsh-nmp-swap-distance,4px)))}}',
			'@media (prefers-reduced-motion: reduce){.dsh-nmp-effort-matrix-cell,.dsh-nmp-effort-matrix-sq,.dsh-nmp-effort-matrix-sq:before,.dsh-nmp-effort-matrix-sq:after{animation:none !important;}.dsh-nmp-effort-matrix-sq:before,.dsh-nmp-effort-matrix-sq:after{opacity:0 !important;}}',
			// 主题自建的等级按钮与弹层由本包接管：压掉它们，避免两枚按钮重叠
			'.dsh-claude-effort-btn,.dsh-claude-effort-popover{display:none!important;}',
			// 主题为它那枚按钮预留的右侧外边距随之一并清掉，否则模型按钮旁会留一块空白
			'.dsh-claude-model-btn{margin-right:0!important;}',
		].join("");

		function ensureStyle() {
			if (document.getElementById(STYLE_ID)) return;
			var style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		// 主题 ou：匹配串是 [渠道名, 模型名]；两者相同或模型名为空时只留渠道名
		function modelNameStrs(groupName, modelName) {
			var a = String(groupName == null ? "" : groupName).toLowerCase();
			var o = String(modelName == null ? "" : modelName).toLowerCase();
			return o === "" || o === a ? [a] : [a, o];
		}

		// ---------- 目录数据层 ----------
		//
		// 数据全部来自宿主的 modelDirectories 服务：每会话一个 ModelDirectory，
		// store 快照 { current, routable, groups, failures, status } 里 groups 是
		// [{ id, name, models: [{ id, name, description?, reasoning?: { efforts, defaultEffort } }] }]，
		// current 是 { provider, model, reasoningEffort }。select() 完成切换。
		//
		// 本插件目录结构：{ groups: [{ id, name, models: [{ key, name, provider, model, hostDesc, checked }] }] }
		// key 为「渠道名::模型名」，与收藏数据（localStorage）保持一致；同渠道内显示名重复的
		// 两条（真实存在于聚合类渠道）用「渠道名::模型名::模型 id」区分
		var catalog = { groups: [], sig: "", currentKey: null, currentModel: "", effortSteps: [], effortIndex: -1 };

		var sessionsService = null;
		var modelDirService = null;
		var uiSessionService = null;
		var dirBound = { sessionId: null, unsub: null };

		// 当前会话 id：uiSession 的 current 绑定源给出当前挂载的会话，没有时回落到会话列表的 current。
		// 会话尚未建立时返回 null，绑定留到下一次重绘再试
		function currentSessionId() {
			var bound = uiSessionService ? uiSessionService.current : null;
			var key = bound && bound.value ? bound.value.key : void 0;
			if (typeof key === "string" && key) return key;
			var snap = sessionsService.list.getSnapshot();
			return snap && typeof snap.current === "string" ? snap.current : null;
		}

		function bindDirectory() {
			var sid = currentSessionId();
			if (!sid || dirBound.sessionId === sid) return;
			var dir = modelDirService.directoryFor(sid);
			if (dirBound.unsub) dirBound.unsub();
			dirBound.sessionId = sid;
			dirBound.unsub = dir.store.subscribe(function () {
				adoptSnapshot(dir.store.getSnapshot());
				scheduleEnhance();
			});
			dir.load().catch(function (e) { console.error("dsh-native-model-picker: 目录加载失败", e); });
			adoptSnapshot(dir.store.getSnapshot());
		}

		function dropDirectory() {
			if (dirBound.unsub) dirBound.unsub();
			dirBound = { sessionId: null, unsub: null };
		}

		// ---------- 模型描述目录：主题包把描述文案放在 model-descriptions.json 里，按
		// 「渠道名 / 模型标识/渠道名 / 模型名」三根字符串逐条正则匹配（主题 nu 的同款算法），
		// 命中即取中文文案。宿主只给英文 description，中文界面用主题文案更贴切 ----------
		var descCatalog = null;
		var descLoading = false;
		function compileRules(list) {
			var out = [];
			for (var i = 0; i < list.length; i++) {
				var f = list[i];
				if (!f || typeof f.match !== "string" || !f.text) continue;
				try { out.push({ re: new RegExp(f.match, "i"), text: f.text }); } catch (e) {}
			}
			return out;
		}
		function setDescCatalog(catalogData) {
			descCatalog = { families: compileRules(catalogData.families || []), tiers: compileRules(catalogData.tiers || []) };
		}
		function loadDescCatalog() {
			if (descCatalog || descLoading) return;
			var preset = window.__nmpDescCatalog;
			if (preset) { setDescCatalog(preset); return; }
			if (typeof fetch !== "function") return;
			descLoading = true;
			fetch("/dsh-claude-style/model-descriptions.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
				descLoading = false;
				if (!j) return;
				setDescCatalog(j);
				if (j.brands && j.brands.models) setBrandRules(j.brands.models);
				scheduleEnhance();
			}).catch(function () { descLoading = false; });
		}
		// 主题 au：先按 families 逐条测匹配串（渠道名 / 模型标识/渠道名 / 模型名），
		// 都没有命中时再按 tiers 测首两项
		function matchRule(rules, strs) {
			for (var s = 0; s < strs.length; s++) {
				for (var i = 0; i < rules.length; i++) {
					if (rules[i].re.test(strs[s])) return rules[i];
				}
			}
			return null;
		}
		function catalogDescFor(groupName, modelName, modelId) {
			if (!descCatalog) return "";
			var pair = modelNameStrs(groupName, modelName);
			var id = String(modelId == null ? "" : modelId).toLowerCase();
			var strs = id === "" ? pair : [pair[0], id + "/" + pair[0]].concat(pair.slice(1));
			var hit = matchRule(descCatalog.families, strs);
			if (!hit) hit = matchRule(descCatalog.tiers, pair);
			if (!hit || !hit.text) return "";
			return hit.text.zh || hit.text.en || "";
		}

		// 克隆官方拼接节点：url(#id) 按文档顺序解析到全篇第一个同名元素。官方弹层树常驻
		// 文档且被隐藏，它那份同 id 定义（React useId 占位符是字面 id，多副本共用）排在
		// 前面就会替全文档引用兜底，隐藏子树里的 paint server 不参与渲染，渐变品牌整枚
		// 不上色、裁剪品牌溢出压字。克隆时把树内全部 id 改成全局唯一并同步替换引用，
		// 每份副本自带定义，与官方副本的文档顺序无关
		var cloneSeq = 0;
		function adoptNameNode(node) {
			var clone = node.cloneNode(true);
			var clips = clone.querySelectorAll("clipPath[id]");
			var withIds = clone.querySelectorAll("[id]");
			var renames = [];
			var idMap = {};
			for (var i = 0; i < withIds.length; i++) {
				var oldId = withIds[i].getAttribute("id");
				if (!oldId) continue;
				if (!idMap[oldId]) idMap[oldId] = "dsh-nmp-def-" + (++cloneSeq);
				withIds[i].setAttribute("id", idMap[oldId]);
			}
			for (var key in idMap) renames.push([key, idMap[key]]);
			if (!renames.length) return clone;
			var walker = clone.querySelectorAll("*");
			for (var k = 0; k < walker.length; k++) {
				var el = walker[k];
				for (var a = 0; a < el.attributes.length; a++) {
					var attr = el.attributes[a];
					var v = attr.value;
					for (var r = 0; r < renames.length; r++) {
						if (v.indexOf("url(#" + renames[r][0] + ")") >= 0) v = v.split("url(#" + renames[r][0] + ")").join("url(#" + renames[r][1] + ")");
					}
					if (v !== attr.value) attr.value = v;
				}
			}
			// 官方裁剪矩形随克隆树一起带过来（id 已改全局唯一且引用已替换），字形段的
			// 选择交给它；svg 层只恢复视口裁剪，拦下越出 viewBox 的笔画
			var svg = clone.tagName === "svg" ? clone : clone.querySelector("svg");
			if (svg) svg.style.overflow = "hidden";
			return clone;
		}

		// ---------- 合成品牌图标层（照原版 db/ru/Tm 三层结构） ----------
		// 原版：brandRules 正则对渠道名与模型名判定 brand id（first-match-wins），cu 表把
		// id 映射为名称里的词（zai→GLM、openai→GPT、microsoft→Azure…），Tm 按词在名称中
		// 的位置拆成 前文+combine图标+型号文本+combine-alt隐藏词。svg 资产表 us 在浏览器
		// 内存里，运行时从主题 bundle 提取（与官方渲染同一份标记）
		var NMP_CU = { baidu: "Baidu", bytedance: "ByteDance", celestoai: "celestoai", claude: "Claude", cohere: "Cohere", deepseek: "DeepSeek", gemini: "Gemini", gemma: "Gemma", grok: "Grok", inception: "inception", kimi: "Kimi", longcat: "longcat", meta: "Meta", microsoft: "Azure", minimax: "Minimax", mistral: "Mistral", nanobanana: "Nano Banana", nova: "Nova", openai: "GPT", perplexity: "Perplexity", qwen: "Qwen", reflection: "Reflection", stepfun: "Step", tencent: "Hunyuan", xiaomimimo: "MiMo", zai: "GLM" };
		var brandSvgs = null;
		var brandLoading = false;
		var brandRules = null;
		function setBrandSvgs(map) {
			brandSvgs = map;
			scheduleEnhance();
		}
		function setBrandRules(models) {
			brandRules = [];
			for (var i = 0; i < models.length; i++) {
				var d = models[i];
				if (!d || typeof d.match !== "string" || typeof d.brand !== "string") continue;
				try { brandRules.push({ re: new RegExp(d.match, "i"), brand: d.brand }); } catch (e) {}
			}
		}
		function loadBrandLogos() {
			if (brandLoading) return;
			// 测试与宿主预置口：规则表与资产表相互独立，各自加载
			var presetRules = window.__nmpBrandRules__;
			if (presetRules && presetRules.length && !brandRules) setBrandRules(presetRules);
			if (brandSvgs) return;
			var preset = window.__nmpBrandLogos__;
			if (preset && Object.keys(preset).length) { setBrandSvgs(preset); return; }
			// 主题代码可能单独成文件，也可能并进 /plugins/?? 的合并包：按已加载资源里
			// 路径含 claude-style 的脚本收集（合并包会命中，尺寸大也无妨，只取其中资产表）
			var urls = [];
			var seen = {};
			function addUrl(u) {
				if (!u || seen[u]) return;
				seen[u] = true;
				urls.push(u);
			}
			for (var i = 0; i < document.scripts.length; i++) {
				var sc = document.scripts[i].src || "";
				if (/claude-style/.test(sc)) addUrl(sc);
			}
			try {
				var ents = window.performance && window.performance.getEntriesByType ? window.performance.getEntriesByType("resource") : [];
				for (var j = 0; j < ents.length; j++) {
					var name = ents[j].name || "";
					if (/claude-style\/(client\.js|assets\/.+\.js)/.test(name)) addUrl(name);
				}
			} catch (e) {}
			if (typeof fetch !== "function") return;
			if (!urls.length) urls.push("/plugins/??dsh-claude-style/client.js");
			brandLoading = true;
			var idx = 0;
			function next() {
				if (idx >= urls.length) { brandLoading = false; return; }
				fetch(urls[idx++], { credentials: "same-origin" }).then(function (r) { return r.text(); }).then(function (t) {
					var re = /(\w+):'(<svg [^']*)'/g, m, map = {};
					while ((m = re.exec(t))) map[m[1]] = m[2];
					if (Object.keys(map).length) { brandLoading = false; setBrandSvgs(map); }
					else next();
				}).catch(function () { next(); });
			}
			next();
		}
		// 原版 ou+au：对 [渠道名, 模型名] 两个字符串逐条测规则，先命中的规则生效
		function brandIdFor(groupName, displayName) {
			if (!brandRules) return null;
			var a = String(groupName == null ? "" : groupName).toLowerCase();
			var o = String(displayName == null ? "" : displayName).toLowerCase();
			var strs = o === "" || o === a ? [a] : [a, o];
			for (var i = 0; i < strs.length; i++) {
				for (var k = 0; k < brandRules.length; k++) {
					if (brandRules[k].re.test(strs[i])) return brandRules[k].brand;
				}
			}
			return null;
		}
		// 原版 db：brand id 有 svg 资产才合成，并给出词在名称中的位置
		function brandPartFor(groupName, displayName) {
			var id = brandIdFor(groupName, displayName);
			if (id === null || !brandSvgs || !brandSvgs[id]) return null;
			var word = NMP_CU[id];
			if (!word) return null;
			var at = String(displayName).toLowerCase().indexOf(word.toLowerCase());
			return { id: id, word: word, svg: brandSvgs[id], at: at };
		}
		// 原版 Tm：前文 + combine 图标 + 型号文本 + combine-alt 隐藏词
		function synthNameNode(groupName, displayName) {
			var n = brandPartFor(groupName, displayName);
			if (n === null) return null;
			var o = String(displayName);
			var wrap = document.createElement("span");
			wrap.className = "dsh-claude-model-combine";
			wrap.setAttribute("aria-hidden", "true");
			wrap.innerHTML = n.svg;
			var svg = wrap.querySelector("svg");
			if (svg) {
				var adopted = adoptNameNode(svg);
				wrap.textContent = "";
				wrap.appendChild(adopted);
			}
			var frag = document.createDocumentFragment();
			if (n.at !== -1 && n.at > 0) frag.appendChild(document.createTextNode(o.slice(0, n.at)));
			frag.appendChild(wrap);
			frag.appendChild(document.createTextNode(n.at === -1 ? o : o.slice(n.at + n.word.length).replace(/^[\s\-–—]+/, "")));
			frag.appendChild(j("span", "dsh-claude-model-combine-alt", n.at === -1 ? n.word : n.word + " "));
			return frag;
		}
		function groupNameOf(key) {
			var i = key.indexOf("::");
			return i < 0 ? key : key.slice(0, i);
		}
		// 宿主快照 → 本插件目录。key 是「渠道名::模型名」；同渠道内显示名重复的两条
		// （聚合类渠道真实存在）在 key 上追加「::模型 id」区分，收藏数据沿用同一形态
		function adoptSnapshot(snap) {
			if (!snap) return;
			var cur = snap.current;
			var groups = [];
			for (var i = 0; i < snap.groups.length; i++) {
				var src = snap.groups[i];
				if (!src || !src.id || !src.models || !src.models.length) continue;
				var seen = {};
				var models = [];
				for (var k = 0; k < src.models.length; k++) {
					var m = src.models[k];
					var base = src.name + "::" + m.name;
					var key = seen[base] ? base + "::" + m.id : base;
					seen[base] = true;
					var reasoning = m.reasoning || null;
					models.push({
						key: key,
						name: m.name,
						provider: src.id,
						model: m.id,
						hostDesc: m.description || "",
						efforts: reasoning && reasoning.efforts ? reasoning.efforts : [],
						defaultEffort: reasoning ? reasoning.defaultEffort : void 0,
						hasReasoning: !!reasoning,
						checked: !!cur && cur.provider === src.id && cur.model === m.id
					});
				}
				models.sort(function (a, b) { return a.name.localeCompare(b.name, "zh"); });
				groups.push({ id: src.id, name: src.name, models: models });
			}
			catalog.groups = groups;
			catalog.sig = groups.map(function (g) { return g.name + ":" + g.models.length; }).join("|");
			catalog.currentKey = null;
			catalog.currentModel = "";
			if (cur) {
				for (var gi = 0; gi < groups.length && !catalog.currentKey; gi++) {
					for (var gk = 0; gk < groups[gi].models.length; gk++) {
						var mm = groups[gi].models[gk];
						if (mm.provider !== cur.provider || mm.model !== cur.model) continue;
						catalog.currentKey = mm.key;
						catalog.currentModel = mm.name;
						break;
					}
				}
			}
			// 切换在途：store 在 select 返回前仍是旧的 current，用点击目标占位，
			// 免得对勾先跳回旧位置再跳到新位置
			if (pendingKey) {
				var pend = catalogModel(pendingKey);
				if (pend) {
					catalog.currentKey = pend.key;
					catalog.currentModel = pend.name;
				}
			}
			adoptEffortSteps(cur);
			syncChecked();
			// 清理只在目录就绪且非空时执行：加载前的空快照与全部渠道故障期间不应清空收藏
			if (snap.status === "ready" && snap.groups && snap.groups.length) pruneMissingPins(groups);
		}

		// 档位强弱次序。disabled 与 none/off 同为「关闭思考」档，必须排在最低；
		// 主题自己的秩表缺 disabled，照抄会让「关闭」落到最右端被当成最强档
		var EFFORT_RANK = { disabled: 0, none: 0, off: 0, minimal: 1, light: 2, low: 3, medium: 4, high: 5, on: 5, xhigh: 6, max: 7, ultra: 8 };
		// 私有梯子里的常见别名，落不到已知档时按语义归位（balanced 同 medium，deep 同 high）
		var EFFORT_ALIAS = { balanced: 4, deep: 5, normal: 4, standard: 4, extended: 6, extreme: 8, extra: 6 };
		function effortRank(id) {
			var key = String(id).toLowerCase();
			var r = EFFORT_RANK[key];
			if (r === void 0) r = EFFORT_ALIAS[key];
			return r === void 0 ? -1 : r;
		}
		// 已知档按秩排好后回填到原有槽位，未知档原地不动：声明顺序与强度冲突时
		// 不会把未知档甩到末尾（disabled 落尾就是这么来的）
		function sortEfforts(ids) {
			var slots = [];
			var known = [];
			for (var i = 0; i < ids.length; i++) {
				if (ids[i] !== void 0 && effortRank(ids[i]) >= 0) {
					slots.push(i);
					known.push(ids[i]);
				}
			}
			known.sort(function (a, b) { return effortRank(a) - effortRank(b); });
			var out = ids.slice();
			for (var k = 0; k < slots.length; k++) out[slots[k]] = known[k];
			return out;
		}

		// ---------- 档位显示名 ----------
		// 各渠道自己声明的档名五花八门（Default/High/Max、Light/Balanced/Deep…），同一个
		// 位置在不同模型上叫法不同。这里统一取名：先认出「关闭」与「默认」两个特殊档，
		// 其余按强度位置取词，于是同一个位置处处同名。

		// 关闭档与默认档的字固定，词表只负责强弱谱系上的档位
		var EFFORT_OFF_LABEL = "关闭";
		var EFFORT_DEF_LABEL = "默认";
		var EFFORT_PRESET = {
			plain: ["最低", "很低", "较低", "中", "较高", "高", "更高", "最高", "极限", "超凡"],
			xianxia: ["炼气", "筑基", "金丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫", "飞升"]
		};
		var EFFORT_OFF_IDS = { disabled: 1, none: 1, off: 1 };
		// 生效中的取名方案：预设名 + 逐档覆盖。overrides 的键是档位 id，
		// 或 "@0"/"@1"… 表示第几个强弱档
		var effortNameConfig = { preset: "plain", overrides: {} };

		function effortPreset() {
			return EFFORT_PRESET[effortNameConfig.preset] || EFFORT_PRESET.plain;
		}
		function effortOffLabel() {
			return EFFORT_OFF_LABEL;
		}
		function effortDefLabel() {
			return EFFORT_DEF_LABEL;
		}

		function effortOffId(id) {
			return id !== void 0 && id !== null && EFFORT_OFF_IDS[String(id).toLowerCase()] === 1;
		}

		// 一串档位 id -> 同长度的显示名。特殊档各取其名，其余按位置从词表取词。
		// 只有一个非特殊档的模型无从推断强弱位置，保留渠道原名，避免把唯一的档说成最强档
		function effortNamesFor(ids, hostNames) {
			var overrides = effortNameConfig.overrides || {};
			// 能取词的档位：全部非特殊档
			var ladder = [];
			for (var i = 0; i < ids.length; i++) {
				var each = ids[i];
				if (each === void 0) continue;
				if (effortOffId(each)) continue;
				ladder.push(i);
			}
			var words = effortPreset();
			var out = [];
			for (var k = 0; k < ids.length; k++) {
				var key = ids[k];
				var manual = key === void 0 ? overrides["@default"] : overrides[String(key)];
				if (manual) { out.push(manual); continue; }
				if (key === void 0) { out.push(effortDefLabel()); continue; }
				if (effortOffId(key)) { out.push(effortOffLabel()); continue; }
				var pos = ladder.indexOf(k);
				var byPos = overrides["@" + pos];
				if (byPos) { out.push(byPos); continue; }
				if (ladder.length === 1) {
					var hostName = hostNames && hostNames[key];
					out.push(hostName || effortLadderWord(words, 0, 1));
					continue;
				}
				out.push(effortLadderWord(words, pos, ladder.length));
			}
			return out;
		}

		// 从词表取词：档数少于词表时按比例铺开，保住「首档最轻、末档最重」两端
		function effortLadderWord(words, pos, total) {
			if (!words.length) return "";
			if (total <= 1) return words[words.length - 1];
			var at = total === words.length ? pos : Math.round(pos * (words.length - 1) / (total - 1));
			return words[at];
		}

		// 档表指纹：长度与逐档 id 任一变化都算变化
		function effortStepsSig(steps) {
			var sig = steps.length + ":";
			for (var i = 0; i < steps.length; i++) sig += (steps[i].id === void 0 ? "~" : steps[i].id) + ",";
			return sig;
		}

		// 当前模型的等级档位：宿主未给 defaultEffort 时最前面插一档「Default」（不传 reasoningEffort）
		function adoptEffortSteps(cur) {
			var model = catalog.currentKey ? catalogModel(catalog.currentKey) : null;
			var steps = [];
			if (model && model.efforts && model.efforts.length) {
				var names = {};
				for (var i = 0; i < model.efforts.length; i++) names[model.efforts[i].id] = model.efforts[i].name;
				var ids = model.efforts.map(function (e) { return e.id; });
				if (model.defaultEffort === void 0) ids.unshift(void 0);
				var ordered = sortEfforts(ids);
				if (model.defaultEffort === void 0) {
					ordered = ordered.filter(function (id) { return id !== void 0; });
					ordered.unshift(void 0);
				}
				var shown = effortNamesFor(ordered, names);
				for (var k = 0; k < ordered.length; k++) {
					var id = ordered[k];
					steps.push({ id: id, name: shown[k], host: id === void 0 ? "Default" : (names[id] || id) });
				}
			}
			catalog.effortSteps = steps;
			var effective = cur ? cur.reasoningEffort : void 0;
			if (effective === void 0 && model) effective = model.defaultEffort;
			var index = 0;
			for (var n = 0; n < steps.length; n++) {
				if (steps[n].id === effective) { index = n; break; }
			}
			// 档表变化意味着外部换了模型，去抖作废；store 写回所选档后去抖解除；
			// 去抖窗口内的旧档快照不回写 index
			var sig = effortStepsSig(steps);
			var changed = sig !== effortSyncSig;
			if (changed) clearEffortPending();
			else if (effortPending) {
				var caughtUp = effortPending.id === void 0
					? (effective === void 0 || (model && model.defaultEffort !== void 0 && effective === model.defaultEffort))
					: effective === effortPending.id;
				if (caughtUp) clearEffortPending();
			}
			if (!effortPending) catalog.effortIndex = index;
		}

		// 描述小字：优先主题的中文文案，没有则用宿主给的英文 description
		function descOf(model, groupName) {
			if (!model) return "";
			var zh = catalogDescFor(groupName, model.name, model.model);
			return zh || model.hostDesc || "";
		}

		// 当前模型来自快照的 current（在 adoptSnapshot 里落到 currentKey/currentModel），
		// 此处只把显示对勾同步到当前选择
		function syncChecked() {
			for (var gi = 0; gi < catalog.groups.length; gi++) {
				for (var gk = 0; gk < catalog.groups[gi].models.length; gk++) {
					catalog.groups[gi].models[gk].checked = catalog.groups[gi].models[gk].key === catalog.currentKey;
				}
			}
		}

		// 收藏清理：渠道或模型从目录消失后，其整组钉选、单模型钉选与隐藏记录一并移除
		function pruneMissingPins(groups) {
			var byName = {};
			for (var i = 0; i < groups.length; i++) {
				var keys = {};
				for (var k = 0; k < groups[i].models.length; k++) keys[groups[i].models[k].key] = true;
				byName[groups[i].name] = keys;
			}
			var pins = loadPins();
			var sources = pins.sources.filter(function (name) { return !!byName[name]; });
			var alive = function (key) {
				var chan = key.split("::")[0];
				return !!byName[chan] && byName[chan][key] === true;
			};
			var models = pins.models.filter(alive);
			var hidden = pins.hidden.filter(alive);
			var changed = sources.length !== pins.sources.length || models.length !== pins.models.length || hidden.length !== pins.hidden.length;
			if (!changed) return;
			savePins({ sources: sources, models: models, hidden: hidden });
		}

		function catalogModel(key) {
			if (!key) return null;
			var parts = key.split("::");
			for (var i = 0; i < catalog.groups.length; i++) {
				if (catalog.groups[i].name !== parts[0]) continue;
				for (var k = 0; k < catalog.groups[i].models.length; k++) {
					if (catalog.groups[i].models[k].key === key) return catalog.groups[i].models[k];
				}
			}
			return null;
		}

		function groupByName(name) {
			for (var i = 0; i < catalog.groups.length; i++) {
				if (catalog.groups[i].name === name) return catalog.groups[i];
			}
			return null;
		}

		// 渠道处于整组钉选且组内没有隐藏成员时才算「已收藏」展示
		function channelFullyShown(name, pins) {
			if (pins.sources.indexOf(name) < 0) return false;
			var g = groupByName(name);
			if (!g) return true;
			for (var i = 0; i < g.models.length; i++) {
				if (pins.hidden.indexOf(g.models[i].key) >= 0) return false;
			}
			return true;
		}

		// ---------- 切换：宿主 modelDirectories 的 select ----------

		// 进行中的切换计数：视图重绘在此期间保持原样，避免半程状态闪动
		var switching = 0;
		var pendingKey = null;

		function boundDirectory() {
			return dirBound.sessionId ? modelDirService.directoryFor(dirBound.sessionId) : null;
		}

		// key → 宿主的选择对象；reasoningEffort 省略，由目录按模型的 defaultEffort 补齐
		function selectionOf(key) {
			var grp = groupByName(key.split("::")[0]);
			if (!grp) return null;
			for (var i = 0; i < grp.models.length; i++) {
				var m = grp.models[i];
				if (m.key === key) return { provider: m.provider, model: m.model };
			}
			return null;
		}

		function switchModel(key) {
			var dir = boundDirectory();
			var sel = dir ? selectionOf(key) : null;
			if (!sel) return Promise.resolve(false);
			switching++;
			pendingKey = key;
			syncChecked();
			var settle = function (ok) {
				switching--;
				if (switching === 0) pendingKey = null;
				adoptSnapshot(dir.store.getSnapshot());
				scheduleEnhance();
				return ok;
			};
			return dir.select(sel).then(function (result) {
				return settle(!!(result && result.ok));
			}, function (e) {
				console.error("dsh-native-model-picker: 切换失败", e);
				return settle(false);
			});
		}
		// ---------- 卡片树 ----------

		// 自建卡挂在 body 直下（fixed 定位）：
		//   主卡（锚在触发按钮上方）→ footer 模型格开二级卡（渠道列表，底边贴主卡底边）
		//   二级卡渠道行悬浮/点击开三级卡（渠道模型，右缘贴二级卡左缘）

		function mainCard() { return document.querySelector("." + MAIN_CLASS + ":not(." + ANCHORED_CLASS + ")"); }
		function level2Card() { return document.querySelector("." + CH_CLASS); }
		function level3Card() { return document.querySelector("." + CH3_CLASS); }

		function isOpen(card) { return !!card && card.getAttribute(OPEN_ATTR) === "true"; }

		// 值未变化时不写属性：setAttribute 同值同样触发 MutationObserver，会造成观察器空转
		// 取当前可见的触发按钮：多枚同名按钮里带尺寸的那枚
		function triggerBtn() {
			var cands = document.querySelectorAll(TRIGGER_MATCH_SELECTOR);
			var pick = null;
			for (var i = 0; i < cands.length; i++) {
				var r = cands[i].getBoundingClientRect();
				if (r.width || r.height) pick = cands[i];
			}
			if (pick) return pick;
			return cands.length ? cands[cands.length - 1] : null;
		}

		function setW(el, name, value) {
			if (el.getAttribute(name) !== value) el.setAttribute(name, value);
		}

		function makeCard(cls) {
			var card = j("div", MAIN_CLASS + " " + cls + " " + ANCHORED_CLASS);
			card.setAttribute(OPEN_ATTR, "false");
			// 卡片内指针按下不外泄：外点收起判定由 document capture 监听统一处理
			card.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			document.body.appendChild(card);
			return card;
		}

		// 侧位几何：右侧缘贴锚点左缘，放不下时回退锚点右侧；底边贴锚点底边，
		// 高度上限 min(锚点底-8, 视口一半)
		function placeSide(side, anchor) {
			var rect = anchor.getBoundingClientRect();
			var vw = window.innerWidth || document.documentElement.clientWidth;
			var vh = window.innerHeight || document.documentElement.clientHeight;
			var w = side.offsetWidth || 240;
			var x = rect.left - w - 2;
			if (x < 8) x = Math.min(rect.right + 2, Math.max(8, vw - w - 8));
			var hMax = Math.max(120, Math.min(rect.bottom - 8, Math.round(vh * 0.5))) + "px";
			var bot = Math.max(8, vh - rect.bottom) + "px";
			if (side.style.left !== x + "px") side.style.left = x + "px";
			if (side.style.maxHeight !== hMax) side.style.maxHeight = hMax;
			if (side.style.bottom !== bot) { side.style.bottom = bot; side.style.top = "auto"; }
		}

		function placeMain(main) {
			var b = triggerBtn();
			// 主题在场时用户点的常是克隆按钮：锚定优先用最近被点击的那个（需仍在文档且可见）
			if (lastTriggerEl && lastTriggerEl.isConnected) {
				var lr = lastTriggerEl.getBoundingClientRect();
				if (lr.width || lr.height) b = lastTriggerEl;
			}
			var vw = window.innerWidth || document.documentElement.clientWidth;
			var vh = window.innerHeight || document.documentElement.clientHeight;
			var w = main.offsetWidth || 280;
			var rect = b ? b.getBoundingClientRect() : null;
			var visible = rect && (rect.width || rect.height);
			// 触发按钮可能被其他主题的 CSS 隐藏（display:none，rect 全 0）：回退到 composer 底部右侧区域
			var bot = visible ? Math.max(8, vh - rect.top + 8) : 80;
			// 高度上限与侧卡同款：min(卡底边到视口顶-8, 视口一半)，最低 120
			var hMax = Math.max(120, Math.min(vh - bot - 8, Math.round(vh * 0.5))) + "px";
			if (main.style.maxHeight !== hMax) main.style.maxHeight = hMax;
			if (!visible) {
				main.style.left = Math.max(8, vw - w - 24) + "px";
				main.style.bottom = "80px";
				return;
			}
			main.style.left = Math.max(8, Math.min(rect.left, vw - w - 8)) + "px";
			main.style.bottom = bot + "px";
		}

		// ---------- 行构建 ----------

		function buildModelRow(model, inGroup) {
			var row = j("button", "dsh-nmp-option");
			row.type = "button";
			row.setAttribute("role", "menuitemradio");
			row.setAttribute("aria-checked", model.checked ? "true" : "false");
			row.setAttribute("data-nmp-model", model.key);
			var grpName = groupNameOf(model.key);
			var copy = j("span", "dsh-nmp-copy");
			var nameSpan = j("span", "dsh-nmp-name");
			var synth = synthNameNode(grpName, model.name);
			if (synth) nameSpan.appendChild(synth);
			else nameSpan.appendChild(document.createTextNode(model.name));
			copy.appendChild(nameSpan);
			row.appendChild(copy);
			var check = j("span", "dsh-nmp-check");
			if (model.checked) check.innerHTML = CHECK_SVG;
			row.appendChild(check);
			row.appendChild(buildStar("model", model.key, inGroup ? "从整组中移除该模型" : "收藏该模型", inGroup ? "group" : null));
			return row;
		}

		function buildRule(name, extra) {
			var rule = j("div", "dsh-nmp-rule");
			rule.appendChild(j("span", "dsh-nmp-rule-name", name));
			if (extra) rule.appendChild(extra);
			return rule;
		}

		function buildChannelRow(group) {
			var row = j("button", "dsh-nmp-cell");
			row.type = "button";
			row.setAttribute("role", "menuitem");
			row.setAttribute(CHANNEL_ATTR, group.name);
			row.appendChild(j("span", "dsh-nmp-cell-label", group.name));
			row.appendChild(buildStar("source", group.name, "收藏整个渠道"));
			var chev = j("span", "dsh-nmp-cell-chevron");
			chev.innerHTML = CHEVRON_SVG;
			row.appendChild(chev);
			// 悬浮渠道行展开三级卡；三级卡钉选存活期间悬浮不切换，点击渠道行才开合
			row.addEventListener("mouseenter", function () {
				var g = groupByName(group.name);
				if (!g) return;
				var card = level3Card();
				if (card && isOpen(card) && card.getAttribute(PIN_ATTR) === "1") return;
				if (!card) card = buildLevel3();
				cancelClose3();
				card.removeAttribute(PIN_ATTR);
				renderLevel3(card, g);
			});
			row.addEventListener("mouseleave", scheduleClose3);
			return row;
		}

		var P3_TIMER = null;
		// 指针是否停留：实时查询 :hover，避免布尔标志陈旧导致侧卡残留
		function p3Hovered() {
			var c = level3Card();
			return !!c && c.matches(":hover");
		}
		function l2Hovered() {
			var s = level2Card();
			return !!s && isOpen(s) && s.matches(":hover");
		}
		function cancelClose3() {
			if (P3_TIMER !== null) { clearTimeout(P3_TIMER); P3_TIMER = null; }
		}
		function scheduleClose3() {
			var p3now = level3Card();
			if (p3now && p3now.getAttribute(PIN_ATTR) === "1") return;
			cancelClose3();
			P3_TIMER = setTimeout(function () {
				P3_TIMER = null;
				if (!p3Hovered() && !l2Hovered()) closeLevel3();
			}, 260);
		}

		function buildStar(kind, target, title, context) {
			var pins = loadPins();
			var pinned;
			if (kind === "model" && context === "group") {
				pinned = pins.hidden.indexOf(target) < 0;
			} else if (kind === "source") {
				pinned = channelFullyShown(target, pins);
			} else {
				pinned = pins.models.indexOf(target) >= 0;
			}
			var star = j("button", "dsh-cp-star", "★");
			star.type = "button";
			star.title = title;
			star.setAttribute("data-pin-kind", kind);
			star.setAttribute("data-pin-target", target);
			if (context) star.setAttribute("data-pin-context", context);
			star.setAttribute("data-pinned", pinned ? "1" : "0");
			return star;
		}

		// 一键清除星标：移除该渠道在收藏里的全部痕迹（整组钉选、单模型钉选、隐藏成员）
		function buildClearStar(chan) {
			var star = j("button", "dsh-cp-star", "★");
			star.type = "button";
			star.title = "一键取消该渠道的所有收藏";
			star.setAttribute("data-pin-kind", "clearChannel");
			star.setAttribute("data-pin-target", chan);
			star.setAttribute("data-pinned", "1");
			return star;
		}

		// ---------- 一级视图：收藏 + 搜索 ----------

		function renderHomeView(main, query) {
			var view = main.querySelector(":scope > .dsh-nmp-view");
			if (!view) {
				view = j("div", "dsh-nmp-view");
				main.insertBefore(view, main.querySelector(":scope > .dsh-nmp-footer"));
			}
			var pins = loadPins();
			var sig = [query || "", catalog.sig, pins.sources.join(","), pins.models.join(","), pins.hidden.join(","), catalog.currentKey].join("§");
			if (view.getAttribute(VIEW_ATTR) === sig) return;
			view.setAttribute(VIEW_ATTR, sig);
			for (var node; (node = view.firstChild);) node.remove();

			var q = (query || "").trim().toLowerCase();

			// 搜索态：按渠道分组，命中渠道名时该渠道全部命中，否则只放命中的模型
			if (q) {
				var hits = 0;
				catalog.groups.forEach(function (g) {
					var chanHit = g.name.toLowerCase().indexOf(q) >= 0;
					var matched = g.models.filter(function (m) {
						return chanHit || m.name.toLowerCase().indexOf(q) >= 0;
					});
					if (!matched.length) return;
					hits += matched.length;
					view.appendChild(buildRule(g.name));
					matched.forEach(function (m) { view.appendChild(buildModelRow(m)); });
				});
				if (hits === 0) view.appendChild(j("div", "dsh-nmp-nohit", "没有匹配的模型"));
				return;
			}

			// 收藏态：按目录顺序输出有收藏的渠道，整组钉选渲染全部成员，单模型钉选只渲染被钉选的模型
			var anyPin = false;
			catalog.groups.forEach(function (g) {
				var whole = pins.sources.indexOf(g.name) >= 0;
				var members = g.models.filter(function (m) {
					return whole ? pins.hidden.indexOf(m.key) < 0 : pins.models.indexOf(m.key) >= 0;
				});
				if (!members.length) return;
				anyPin = true;
				view.appendChild(buildRule(g.name, buildClearStar(g.name)));
				members.forEach(function (m) { view.appendChild(buildModelRow(m, whole)); });
			});

			if (!anyPin) {
				view.appendChild(j("div", "dsh-nmp-empty", catalog.groups.length
					? "还没有收藏。点下方当前模型进入全部渠道，用 ★ 收藏渠道或模型。"
					: "目录收集中…稍候重新打开即可。"));
			}
		}

		// ---------- 二级卡：渠道列表（无搜索框、底边贴主卡底边、内部滚动） ----------

		function openLevel2() {
			var main = mainCard();
			if (!main) return null;
			var card = level2Card();
			if (!card) card = makeCard(CH_CLASS);
			card.style.width = "240px";
			setW(card, OPEN_ATTR, "true");
			renderChannelsView(card);
			placeSide(card, main);
			return card;
		}

		function renderChannelsView(card) {
			var view = card.querySelector(":scope > .dsh-nmp-view");
			if (!view) {
				view = j("div", "dsh-nmp-view");
				card.appendChild(view);
			}
			var pins = loadPins();
			var sig = catalog.sig + "§" + pins.sources.join(",") + "§" + pins.models.join(",");
			if (view.getAttribute(VIEW_ATTR) === sig) return;
			view.setAttribute(VIEW_ATTR, sig);
			for (var node; (node = view.firstChild);) node.remove();
			if (!catalog.groups.length) {
				view.appendChild(j("div", "dsh-nmp-empty", "目录收集中…"));
				return;
			}
			catalog.groups.forEach(function (g) { view.appendChild(buildChannelRow(g)); });
		}

		// ---------- 三级卡：渠道模型列表（侧滑） ----------

		function buildLevel3() {
			var card = makeCard(CH3_CLASS);
			card.appendChild(j("div", "dsh-nmp-body"));
			card.addEventListener("mouseenter", function () { cancelClose3(); });
			card.addEventListener("mouseleave", scheduleClose3);
			return card;
		}

		function renderLevel3(card, group) {
			setW(card, CHANNEL_ATTR, group.name);
			var body = card.querySelector(":scope > .dsh-nmp-body");
			var grouped = loadPins().sources.indexOf(group.name) >= 0;
			var sig = group.name + "§" + (grouped ? "1" : "0") + "§" + (catalog.currentKey || "") + "§" +
				group.models.map(function (m) { return m.name + (m.checked ? "*" : ""); }).join(",");
			if (card.getAttribute(VIEW_ATTR) !== sig) {
				card.setAttribute(VIEW_ATTR, sig);
				for (var node; (node = body.firstChild);) node.remove();
				group.models.forEach(function (m) { body.appendChild(buildModelRow(m, grouped)); });
			}
			setW(card, OPEN_ATTR, "true");
			var anchor = level2Card();
			if (!anchor || !isOpen(anchor)) anchor = mainCard();
			if (anchor) placeSide(card, anchor);
		}

		function openLevel3(groupName, pinned) {
			var group = groupByName(groupName);
			if (!group) return;
			var card = level3Card();
			var reopening = card && card.getAttribute(CHANNEL_ATTR) === groupName && isOpen(card);
			if (reopening) {
				// 悬浮重入已展开渠道：保持现状
				if (!pinned) return;
				// 点击升级为钉选（失焦不关）；已钉选的再次点击收起
				if (card.getAttribute(PIN_ATTR) !== "1") card.setAttribute(PIN_ATTR, "1");
				else card.remove();
				return;
			}
			if (!card) card = buildLevel3();
			cancelClose3();
			renderLevel3(card, group);
			if (pinned) card.setAttribute(PIN_ATTR, "1");
			else card.removeAttribute(PIN_ATTR);
		}

		function closeLevel3() {
			var card = level3Card();
			if (card) card.remove();
		}

		// 入口点击建立的钉选态：二级卡失焦不关，Escape 或再次点击解除
		var pinnedMenu = false;

		// 最近一次整体收起主卡的时间：关闭后短暂冷却，避免指针仍停在按钮上时悬浮立刻重开
		var lastCloseAt = 0;

		// ---------- footer：当前模型格 ----------

		function buildFooter(main) {
			var footer = j("div", "dsh-nmp-footer");
			var modelCell = j("button", "dsh-nmp-cell");
			modelCell.type = "button";
			modelCell.setAttribute("data-nmp-entry", "channels");
			var mlabel = j("span", "dsh-nmp-cell-label");
			mlabel.appendChild(j("span", "dsh-nmp-effort-line", "选择模型"));
			mlabel.appendChild(j("span", "dsh-nmp-cell-desc"));
			modelCell.appendChild(mlabel);
			footer.appendChild(modelCell);
			// 档位取名入口：齿轮图标，与模型格同排
			var cfg = j("button", "dsh-nmp-cfg", "⚙");
			cfg.type = "button";
			cfg.title = "档位取名";
			cfg.setAttribute("data-nmp-entry", "effort-names");
			cfg.setAttribute("aria-label", "档位取名");
			footer.appendChild(cfg);
			main.appendChild(footer);
			return footer;
		}

		function updateFooter(main) {
			var label = main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-cell-label');
			if (!label) return;
			var cur = catalog.currentKey ? catalogModel(catalog.currentKey) : null;
			var grp = cur ? groupNameOf(cur.key) : "";
			var shown = cur ? cur.name : "选择模型";
			var nameEl = label.querySelector(":scope > .dsh-nmp-effort-line");
			if (nameEl) {
				var sig = shown + "|" + (synthNameNode(grp, shown) ? "synth" : "txt");
				if (nameEl.getAttribute("data-sig") !== sig) {
					nameEl.setAttribute("data-sig", sig);
					nameEl.textContent = "";
					var named = synthNameNode(grp, shown);
					if (named) nameEl.appendChild(named);
					else nameEl.textContent = shown;
				}
			}
			var descEl = label.querySelector(":scope > .dsh-nmp-cell-desc");
			if (descEl) {
				var d = cur ? descOf(cur, grp) : "";
				if (descEl.textContent !== d) descEl.textContent = d;
				var disp = d ? "" : "none";
				if (descEl.style.display !== disp) descEl.style.display = disp;
			}
		}

		// ---------- 档位取名面板 ----------
		// 两种编辑方式并存：选预设（普通 / 修仙境界）、逐档改名。
		// 逐档改名按「当前模型的实际档表」列出，键用档位 id 与强弱位置两种写法，
		// 于是换渠道后同位置的档位仍沿用同一份手动设定

		var namesPanel = null;

		function namesPanelCard() {
			return document.querySelector(".dsh-nmp-names");
		}

		function closeNamesPanel() {
			if (namesPanel) { namesPanel.remove(); namesPanel = null; }
			var cfg = document.querySelector(".dsh-nmp-cfg");
			if (cfg) cfg.removeAttribute("data-active");
		}

		function currentStepList() {
			var steps = catalog.effortSteps || [];
			var out = [];
			for (var i = 0; i < steps.length; i++) out.push({ id: steps[i].id, host: steps[i].host || steps[i].name });
			return out;
		}

		function buildNamesPanel(anchorEl) {
			closeNamesPanel();
			var panel = j("div", "dsh-nmp-names");
			panel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

			var head = j("div", "dsh-nmp-names-head");
			head.appendChild(j("span", "dsh-nmp-names-title", "档位取名"));
			var close = j("button", "dsh-nmp-names-close", "✕");
			close.type = "button";
			close.addEventListener("click", closeNamesPanel);
			head.appendChild(close);
			panel.appendChild(head);

			var presets = j("div", "dsh-nmp-names-presets");
			var presetKeys = ["plain", "xianxia"];
			var presetLabels = { plain: "普通", xianxia: "修仙境界" };
			for (var pi = 0; pi < presetKeys.length; pi++) {
				(function (key) {
					var btn = j("button", "dsh-nmp-names-preset", presetLabels[key]);
					btn.type = "button";
					btn.setAttribute("data-preset", key);
					if (effortNameConfig.preset === key) btn.setAttribute("data-on", "true");
					btn.addEventListener("click", function () {
						saveEffortNameConfig({ preset: key, overrides: effortNameConfig.overrides });
						refreshAfterNames();
					});
					presets.appendChild(btn);
				})(presetKeys[pi]);
			}
			panel.appendChild(presets);

			var body = j("div", "dsh-nmp-names-body");
			// 关闭档固定叫「关闭」，不参与取名；其余档按当前模型的实际档表逐档列出
			var steps = currentStepList();
			var nonSpecial = 0;
			for (var si = 0; si < steps.length; si++) {
				var step = steps[si];
				var labelText;
				var keyText;
				if (step.id === void 0) { labelText = "默认档"; keyText = "@default"; }
				else if (effortOffId(step.id)) { labelText = "关闭档"; keyText = String(step.id); }
				else { labelText = "第 " + (nonSpecial + 1) + " 档"; keyText = "@" + nonSpecial; nonSpecial++; }
				(function (label, key, hostName, fixed) {
					var row = j("div", "dsh-nmp-names-row");
					row.appendChild(j("span", "dsh-nmp-names-label", label));
					var input = j("input", "dsh-nmp-names-input");
					input.type = "text";
					var overrides = effortNameConfig.overrides || {};
					var manual = overrides[key];
					input.value = fixed === void 0 ? (manual === void 0 ? "" : manual) : fixed;
					input.placeholder = hostName;
					input.setAttribute("data-override", key);
					if (fixed !== void 0) {
						input.disabled = true;
						row.appendChild(input);
						body.appendChild(row);
						return;
					}
					input.addEventListener("change", function () {
						var next = {};
						var src = effortNameConfig.overrides || {};
						for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) next[k] = src[k];
						var text = input.value.trim();
						if (text) next[key] = text;
						else delete next[key];
						saveEffortNameConfig({ preset: effortNameConfig.preset, overrides: next });
						refreshAfterNames();
					});
					row.appendChild(input);
					body.appendChild(row);
				})(labelText, keyText, step.host, effortOffId(step.id) ? effortOffLabel() : void 0);
			}
			if (!steps.length) body.appendChild(j("div", "dsh-nmp-names-hint", "当前模型没有可选档位。"));
			panel.appendChild(body);
			panel.appendChild(j("div", "dsh-nmp-names-hint", "留空表示沿用预设词表；手动值优先于预设。"));

			var foot = j("div", "dsh-nmp-names-foot");
			var reset = j("button", "dsh-nmp-names-btn", "重置全部");
			reset.type = "button";
			reset.addEventListener("click", function () {
				saveEffortNameConfig({ preset: "plain", overrides: {} });
				refreshAfterNames();
			});
			foot.appendChild(reset);
			var done = j("button", "dsh-nmp-names-btn", "完成");
			done.type = "button";
			done.setAttribute("data-primary", "true");
			done.addEventListener("click", closeNamesPanel);
			foot.appendChild(done);
			panel.appendChild(foot);

			document.body.appendChild(panel);
			namesPanel = panel;
			// 贴着主卡上边摆放，不与主卡重叠；上方空间不足时改放主卡下边
			var vw = window.innerWidth || document.documentElement.clientWidth;
			var vh = window.innerHeight || document.documentElement.clientHeight;
			var host = mainCard();
			var rect = host ? host.getBoundingClientRect() : (anchorEl ? anchorEl.getBoundingClientRect() : null);
			var w = panel.offsetWidth || 296;
			var h = panel.offsetHeight || 320;
			var x = rect ? Math.round(rect.right - w) : 16;
			x = Math.max(8, Math.min(x, vw - w - 8));
			var y = rect ? Math.round(rect.top - h - 8) : 16;
			if (y < 8) y = rect ? Math.min(Math.round(rect.bottom + 8), vh - h - 8) : 16;
			panel.style.left = x + "px";
			panel.style.top = Math.max(8, y) + "px";
			var cfg = document.querySelector(".dsh-nmp-cfg");
			if (cfg) cfg.setAttribute("data-active", "true");
			return panel;
		}

		// 保存后立即反映到按钮文字与滑块；面板留在原地重建，于是能连续调整并看到效果
		function refreshAfterNames() {
			// 取名变化要重算档表；当前档位保持不变
			var keepStep = catalog.effortSteps[catalog.effortIndex];
			adoptEffortSteps(keepStep ? { reasoningEffort: keepStep.id } : null);
			var main = mainCard();
			if (main) renderAll(main);
			updateEffortButton();
			effortSync();
			scheduleEnhance();
			var cfg = document.querySelector(".dsh-nmp-cfg");
			if (namesPanelCard() && cfg) buildNamesPanel(cfg);
		}

		// ---------- 主卡外壳 ----------

		function buildMain() {
			var main = j("div", MAIN_CLASS);
			main.setAttribute(OPEN_ATTR, "false");
			main.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			var search = j("div", "dsh-nmp-search");
			var input = j("input");
			input.type = "text";
			input.placeholder = "搜索全部模型…";
			input.setAttribute("autocomplete", "off");
			input.addEventListener("input", function () {
				syncClear(search, input.value);
				var m = mainCard();
				if (m) renderHomeView(m, input.value);
			});
			input.addEventListener("keydown", function (e) {
				if (e.key === "Escape") {
					e.stopPropagation();
					input.value = "";
					input.dispatchEvent(new Event("input", { bubbles: true }));
				}
			});
			input.addEventListener("mousedown", function (e) { e.stopPropagation(); });
			var clear = j("button", "dsh-nmp-search-clear", "✕");
			clear.type = "button";
			clear.addEventListener("mousedown", function (e) { e.stopPropagation(); });
			clear.addEventListener("click", function () {
				input.value = "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.focus();
			});
			search.appendChild(input);
			search.appendChild(clear);
			syncClear(search, input.value);
			main.appendChild(search);
			buildFooter(main);
			document.body.appendChild(main);
			return main;
		}

		function syncClear(bar, value) {
			var clear = bar.querySelector(".dsh-nmp-search-clear");
			if (clear) clear.style.display = value ? "" : "none";
		}

		function currentQuery(main) {
			var input = main.querySelector(":scope > .dsh-nmp-search input");
			return input ? input.value : "";
		}

		// ---------- 主卡开合 ----------

		function openMain() {
			var main = mainCard();
			if (!main) main = buildMain();
			// 先定位再显示：先显示后定位会让卡片初始帧出现在 fixed 默认位置（左上角），产生闪现
			placeMain(main);
			setW(main, OPEN_ATTR, "true");
			updateFooter(main);
			renderHomeView(main, currentQuery(main));
			// 打开时拉一次目录：服务内部有缓存与 in-flight 合并，重复调用代价很小
			var dir = boundDirectory();
			if (dir) {
				dir.load().then(function () {
					var m = mainCard();
					if (m && isOpen(m)) renderAll(m);
				}, function (e) { console.error("dsh-native-model-picker: 目录加载失败", e); });
			}
		}

		function closeLevel2() {
			var l2 = level2Card();
			if (!l2) return;
			l2.setAttribute(OPEN_ATTR, "false");
			l2.remove();
			closeLevel3();
		}

		// 失焦自动收起：不计入悬浮冷却（旧插件指针离开即关、再悬浮立即可重开）
		function closeAuto() {
			cancelMenuClose();
			cancelL2Close();
			closeLevel2();
			var main = mainCard();
			if (main) main.setAttribute(OPEN_ATTR, "false");
		}
		function closeEverything() {
			pinnedMenu = false;
			lastCloseAt = Date.now();
			closeAuto();
		}

		function renderAll(main) {
			syncChecked();
			updateFooter(main);
			renderHomeView(main, currentQuery(main));
			var l2 = level2Card();
			if (l2 && isOpen(l2)) renderChannelsView(l2);
			var l3 = level3Card();
			if (l3 && isOpen(l3)) {
				var g3 = groupByName(l3.getAttribute(CHANNEL_ATTR) || "");
				if (g3) renderLevel3(l3, g3);
			}
		}

		// ---------- 触发按钮品牌化（复刻官方拼接观感） ----------
		// 官方主题持续重写它自己的 .dsh-claude-model-btn-label 纯文本；直接替换其子内容会让
		// 两边的观察器互相触发。品牌节点挂在兄弟 span，生效期间用类隐藏官方 label，不触碰官方节点

		var triggerLabelWatched = null;
		var triggerLabelObserver = null;
		function watchTriggerLabel(label) {
			if (triggerLabelWatched === label) return;
			if (!triggerLabelObserver) triggerLabelObserver = new MutationObserver(function () { scheduleEnhance(); });
			if (triggerLabelWatched) triggerLabelObserver.disconnect();
			triggerLabelObserver.observe(label, { childList: true, characterData: true, subtree: true });
			triggerLabelWatched = label;
		}

		// 品牌化目标优先主题克隆按钮；主题弹层选项关闭时退回宿主原生按钮。
		// 两枚的文本节点都由宿主或主题持续重写，label 观察器随挂载对象切换重挂
		function findTriggerBtn() {
			var cands = document.querySelectorAll("button.dsh-claude-model-btn");
			if (cands.length) return cands[cands.length - 1];
			var nat = document.querySelectorAll(TRIGGER_MATCH_SELECTOR);
			return nat.length ? nat[nat.length - 1] : null;
		}
		function triggerLabelOf(btn) {
			var themeLabel = btn.querySelector(":scope > .dsh-claude-model-btn-label");
			if (themeLabel) return themeLabel;
			return btn.querySelector(":scope > [class*=\"triggerLabel\"]");
		}

		function enhanceTrigger() {
			// 页面上可能有多枚同名按钮（含未挂载的），取最后一枚；品牌 span 幂等，隐藏按钮被写到也无碍
			var btn = findTriggerBtn();
			if (!btn) return;
			var label = triggerLabelOf(btn);
			var span = btn.querySelector(":scope > .dsh-nmp-trigger-brand");
			if (!span) {
				span = j("span", "dsh-nmp-trigger-brand");
				// 原生按钮尾部还有等级与箭头节点，品牌段插在文本 label 的位置上
				if (label) btn.insertBefore(span, label);
				else btn.appendChild(span);
			}
			if (label) watchTriggerLabel(label);
			var cur = catalog.currentKey ? catalogModel(catalog.currentKey) : null;
			var grp = cur ? groupNameOf(cur.key) : "";
			var named = cur ? synthNameNode(grp, cur.name) : null;
			if (!named) {
				btn.classList.remove("dsh-nmp-triggered");
				span.removeAttribute("data-nmp-trigger-sig");
				for (var node; (node = span.firstChild);) span.removeChild(node);
				return;
			}
			var sig = catalog.currentKey;
			if (span.getAttribute("data-nmp-trigger-sig") === sig && span.firstElementChild) return;
			span.setAttribute("data-nmp-trigger-sig", sig);
			for (var node2; (node2 = span.firstChild);) span.removeChild(node2);
			span.appendChild(synthNameNode(grp, cur.name));
			btn.classList.add("dsh-nmp-triggered");
		}

		// ---------- 推理等级入口（提取自 claude 主题） ----------
		//
		// 主题把等级按钮做成 body 直下的 fixed 元素，再给模型按钮补一块右侧外边距腾位，
		// 每次滚动或布局变化重算坐标。本插件把它放进触发按钮所在的行里当兄弟节点，
		// 位置交给行容器排版；按钮文字是当前档位名，点击打开滑块弹层

		var EFFORT_LABEL = "推理等级";
var EFFORT_NONE = "—";
		var EFFORT_FASTER = "更快";
		var EFFORT_SMARTER = "更强";

		var effortBtn = null;
		var effortPop = null;
		var effortMeasureKey = "";
		var effortParts = null;
		var effortDrag = null;
		var effortRelease = null;
		var effortHoverTimers = null;
		var effortPending = null;
		var effortPendingTimer = 0;
		var effortSynced = false;
		var effortSyncSig = "";
		var effortSyncIndex = -1;
		var effortMatrixKey = null;
		var effortKnobPos = "";
		var effortFillPos = "";

		function effortOpen() {
			return !!effortPop && effortPop.getAttribute(OPEN_ATTR) === "true";
		}

		// 悬浮意图与离场宽限：与主题一致，指针停留 100ms 展开、离场 100ms 收起，拖动中不收
		function scheduleEffortOpen() {
			if (!effortHoverTimers) effortHoverTimers = { open: 0, close: 0 };
			if (effortHoverTimers.close) { clearTimeout(effortHoverTimers.close); effortHoverTimers.close = 0; }
			if (effortHoverTimers.open) return;
			effortHoverTimers.open = setTimeout(function () {
				effortHoverTimers.open = 0;
				if (!effortOpen()) openEffort();
			}, 100);
		}
		function scheduleEffortClose() {
			if (!effortHoverTimers) effortHoverTimers = { open: 0, close: 0 };
			if (effortDrag) return;
			if (effortHoverTimers.open) { clearTimeout(effortHoverTimers.open); effortHoverTimers.open = 0; }
			if (effortHoverTimers.close) return;
			effortHoverTimers.close = setTimeout(function () {
				effortHoverTimers.close = 0;
				if (!effortDrag && effortOpen()) closeEffort();
			}, 100);
		}
		function cancelEffortHoverOpen() {
			if (effortHoverTimers && effortHoverTimers.open) { clearTimeout(effortHoverTimers.open); effortHoverTimers.open = 0; }
		}
		function cancelEffortHoverClose() {
			if (effortHoverTimers && effortHoverTimers.close) { clearTimeout(effortHoverTimers.close); effortHoverTimers.close = 0; }
		}
		function cancelEffortHover() {
			cancelEffortHoverOpen();
			cancelEffortHoverClose();
		}

		// 按钮插到触发按钮所在的那一行里：向上找第一个用 flex 排版行的祖先
		// （触发按钮在主题下被包在 display:contents 的插槽里，插槽本身不排版），
		// 插到该祖先下、包住触发按钮的那一层之后；没有这样的祖先就排在按钮本身之后
		function placeEffortButton(btn) {
			var host = null;
			var anchor = btn;
			var node = btn.parentElement;
			for (var i = 0; i < 6 && node && node !== document.body; i++) {
				if (getComputedStyle(node).display === "flex") { host = node; break; }
				anchor = node;
				node = node.parentElement;
			}
			if (!host) {
				host = btn.parentElement;
				anchor = btn;
			}
			if (!host || anchor.parentElement !== host) return false;
			if (effortBtn.parentElement !== host || effortBtn.previousElementSibling !== anchor) {
				host.insertBefore(effortBtn, anchor.nextSibling);
			}
			// 主题把按钮定位在模型按钮 right+2px；行内是 flex gap 排版，用负外边距补出同样的 2px，
			// 触发按钮不可见（无主题时原生按钮隐藏）的场合不补偿
			var gapPx = 12;
			var rowStyle = getComputedStyle(host);
			var gapRaw = parseFloat(rowStyle.columnGap);
			if (isNaN(gapRaw)) gapRaw = parseFloat(rowStyle.gap);
			if (!isNaN(gapRaw)) gapPx = gapRaw;
			var margin = btn.getBoundingClientRect().width > 0 ? Math.round(2 - gapPx) + "px" : "";
			if (effortBtn.style.marginLeft !== margin) effortBtn.style.marginLeft = margin;
			return true;
		}

		function buildEffortButton() {
			var btn = j("button", "dsh-nmp-effort-btn");
			btn.type = "button";
			btn.setAttribute("aria-haspopup", "menu");
			btn.setAttribute("aria-expanded", "false");
			btn.appendChild(j("span", "dsh-nmp-effort-btn-label"));
			btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
			btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			btn.addEventListener("mouseenter", function () {
				cancelMenuClose();
				cancelEffortHoverClose();
				scheduleEffortOpen();
			});
			btn.addEventListener("mouseleave", function () {
				cancelEffortHoverOpen();
				scheduleEffortClose();
			});
			btn.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				cancelEffortHover();
				if (effortOpen()) closeEffort();
				else openEffort();
			});
			return btn;
		}

		function effortSteps() {
			return catalog.effortSteps || [];
		}

		// 按钮宽度按最长的档名预留：换档时按钮不变宽，行内其他控件不会被推移
		function effortMeasure() {
			var steps = effortSteps();
			var names = steps.map(function (s) { return s.name; });
			var key = names.join("|");
			if (key === effortMeasureKey) return;
			effortMeasureKey = key;
			if (!names.length) {
				effortBtn.style.minWidth = "";
				return;
			}
			var style = getComputedStyle(effortBtn);
			var canvas = document.createElement("canvas");
			var context = canvas.getContext ? canvas.getContext("2d") : null;
			if (!context) {
				effortBtn.style.minWidth = "";
				return;
			}
			context.font = style.fontStyle + " " + style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
			var widest = 0;
			for (var i = 0; i < names.length; i++) widest = Math.max(widest, context.measureText(names[i]).width);
			effortBtn.style.minWidth = Math.ceil(widest + 4) + "px";
		}

		// 按钮可见性：模型没有可选档位（宿主未给 reasoning.efforts）时不留空位
		function updateEffortButton() {
			var btn = triggerBtn();
			if (!btn) {
				if (effortBtn) effortBtn.remove();
				closeEffort();
				return;
			}
			if (!effortBtn) effortBtn = buildEffortButton();
			if (!placeEffortButton(btn)) return;
			effortMeasure();
			var steps = effortSteps();
			var model = catalogModel(catalog.currentKey);
			var usable = !!model && model.hasReasoning === true && steps.length > 0 && !!catalog.currentKey;
			var shown = usable ? "inline-flex" : "none";
			if (effortBtn.style.display !== shown) effortBtn.style.display = shown;
			if (!usable) {
				closeEffort();
				return;
			}
			var text = catalog.effortIndex >= 0 && steps[catalog.effortIndex] ? steps[catalog.effortIndex].name : EFFORT_NONE;
			var label = effortBtn.querySelector(".dsh-nmp-effort-btn-label");
			if (label && label.textContent !== text) label.textContent = text;
			var aria = EFFORT_LABEL + " " + text;
			if (effortBtn.getAttribute("aria-label") !== aria) effortBtn.setAttribute("aria-label", aria);
			// 弹层开着时档位随目录走：切换回来的是宿主认定的档，滑块跟着对齐
			if (effortOpen() && !effortDrag) effortSync();
		}

		function buildEffortPop() {
			var pop = j("div", "dsh-nmp-effort-pop");
			pop.setAttribute(OPEN_ATTR, "false");
			var root = j("div", "dsh-nmp-effort");
			var head = j("div", "dsh-nmp-effort-head");
			head.appendChild(j("span", "dsh-nmp-effort-label", EFFORT_LABEL));
			var value = j("span", "dsh-nmp-effort-value");
			var ghost = j("span", "dsh-nmp-effort-value-ghost");
			head.appendChild(value);
			head.appendChild(ghost);
			var ends = j("div", "dsh-nmp-effort-ends");
			ends.appendChild(j("span", "dsh-nmp-effort-end", EFFORT_FASTER));
			ends.appendChild(j("span", "dsh-nmp-effort-end", EFFORT_SMARTER));
			var track = j("div", "dsh-nmp-effort-track");
			track.setAttribute("role", "slider");
			track.setAttribute("aria-valuemin", "0");
			track.setAttribute("aria-valuemax", "1");
			track.setAttribute("aria-valuenow", "0");
			track.setAttribute("aria-valuetext", EFFORT_LABEL);
			track.setAttribute("tabindex", "0");
			track.setAttribute("aria-label", EFFORT_LABEL);
			var fill = j("div", "dsh-nmp-effort-fill");
			var ticks = j("div", "dsh-nmp-effort-ticks");
			var matrix = j("div", "dsh-nmp-effort-matrix");
			var knob = j("div", "dsh-nmp-effort-knob");
			track.appendChild(fill);
			track.appendChild(ticks);
			track.appendChild(matrix);
			track.appendChild(knob);
			root.appendChild(head);
			root.appendChild(ends);
			root.appendChild(track);
			pop.appendChild(root);
			// 弹层内指针按下不外泄：外点收起由 document capture 统一处理
			pop.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
			pop.addEventListener("mouseenter", function () {
				cancelEffortHoverClose();
			});
			pop.addEventListener("mouseleave", function () {
				scheduleEffortClose();
			});
			pop.setAttribute("role", "menu");
			pop.setAttribute("aria-label", EFFORT_LABEL);
			document.body.appendChild(pop);
			effortParts = { root: root, value: value, ghost: ghost, track: track, fill: fill, ticks: ticks, matrix: matrix, knob: knob };
			bindEffortTrack();
			return pop;
		}

		// 轨道几何：knob 是滑块本体，可移动范围是「轨道宽 - knob 宽」
		function effortSpan() {
			var p = effortParts;
			if (!p) return { size: 16, span: 0 };
			var size = p.knob.offsetWidth || 16;
			return { size: size, span: Math.max(0, p.track.clientWidth - size) };
		}

		function effortLeftOf(index) {
			var steps = effortSteps();
			var g = effortSpan();
			if (index < 0 || steps.length < 2) return g.span;
			return index / (steps.length - 1) * g.span;
		}

		// 磁吸：靠近刻度时向刻度收拢，观感上「吸附」到档位
		function effortMagnet(x) {
			var steps = effortSteps();
			if (steps.length < 2) return x;
			var g = effortSpan();
			if (g.span === 0) return x;
			var unit = g.span / (steps.length - 1);
			var cell = Math.floor(x / unit);
			if (cell >= steps.length - 1) return x;
			var t = (x - cell * unit) / unit;
			var pull = 0.8;
			return (cell + t - pull * Math.sin(2 * Math.PI * t) / (2 * Math.PI)) * unit;
		}

		function effortIndexAt(x) {
			var steps = effortSteps();
			if (!steps.length) return -1;
			if (steps.length === 1) return 0;
			var g = effortSpan();
			var ratio = g.span === 0 ? 0 : x / g.span;
			return Math.max(0, Math.min(steps.length - 1, Math.round(ratio * (steps.length - 1))));
		}

		function effortSetPos(left, glide) {
			var p = effortParts;
			if (!p) return;
			var steps = effortSteps();
			var px = Math.round(left);
			var knobPos = px + "px";
			var fillPos = steps.length === 0 ? "0px" : (px + 8) + "px";
			// 写入值没变就跳过，避免无谓的过渡重排
			if (knobPos === effortKnobPos && fillPos === effortFillPos) return;
			effortKnobPos = knobPos;
			effortFillPos = fillPos;
			if (glide || effortDrag) {
				p.knob.style.translate = knobPos;
				p.fill.style.width = fillPos;
				return;
			}
			// 瞬时写入：压掉过渡再恢复
			var knobT = p.knob.style.transition;
			var fillT = p.fill.style.transition;
			p.knob.style.transition = "none";
			p.fill.style.transition = "none";
			p.knob.style.translate = knobPos;
			p.fill.style.width = fillPos;
			void p.knob.offsetWidth;
			p.knob.style.transition = knobT;
			p.fill.style.transition = fillT;
		}

		// 重新触发元素上样式表定义的动画（离场/入场各一次）
		function restartEffortAnim(el) {
			el.style.setProperty("animation", "none", "important");
			void el.offsetWidth;
			el.style.removeProperty("animation");
		}

		// 档名换字：旧字交给 ghost 走离场动画，新字走入场动画；同字不动画
		function swapEffortLabel(text) {
			var p = effortParts;
			if (!p) return;
			if (p.value.textContent === text) return;
			p.ghost.textContent = p.value.textContent;
			p.ghost.style.left = p.value.offsetLeft + "px";
			restartEffortAnim(p.ghost);
			p.value.textContent = text;
			restartEffortAnim(p.value);
		}

		// 与主题一致的格子相位散列：同一格在不同周期里取互不相同的相位
		function effortHash(y, x, t) {
			var b = (Math.imul(y + 1, 2654435761) ^ Math.imul(x + 1, 2246822507) ^ Math.imul(t + 1, 668265263)) >>> 0;
			b = Math.imul(b ^ (b >>> 15), 625341585) >>> 0;
			b = (b ^ (b >>> 13)) >>> 0;
			return b / 4294967296;
		}
		// 左暗右亮的列渐变：两端之外用平滑阶梯
		function effortColFade(ratio) {
			if (ratio <= 0.05) return 0;
			if (ratio >= 0.75) return 1;
			var t = (ratio - 0.05) / 0.7;
			return t * t * (3 - 2 * t);
		}

		// 末档（最高一级）换成格子闪动，与主题在 data-apex 下的处理一致：
		// 列数/行高/格子尺寸都按轨道宽度与设备像素比现算，宽度拿不到时返回 false 留待重试
		function ensureEffortMatrix() {
			var p = effortParts;
			if (!p) return false;
			var w = p.track.clientWidth;
			if (!w) return false;
			var dpr = window.devicePixelRatio || 1;
			var reduced = false;
			try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (err) { reduced = false; }
			var key = Math.round(w) + "@" + dpr + (reduced ? "@still" : "");
			if (key === effortMatrixKey && p.matrix.childElementCount) return true;
			effortMatrixKey = key;
			var deviceW = Math.round(w * dpr);
			var gap = Math.max(1, Math.round(1 * dpr));
			var half = Math.max(1, Math.round(0.5 * dpr));
			var rowH = Math.round(26 * dpr);
			var sq = Math.max(3, Math.floor((rowH - 2 * half - 4 * gap) / 5));
			var cols = Math.max(1, Math.floor((deviceW + gap) / (sq + gap)));
			var rest = deviceW - (cols * sq + (cols - 1) * gap);
			var spare = rowH - (5 * sq + 4 * gap);
			p.matrix.style.gap = gap + "px";
			p.matrix.style.padding = Math.floor(spare / 2) + "px " + Math.floor(rest / 2) + "px";
			p.matrix.style.gridTemplateColumns = "repeat(" + cols + ", " + sq + "px)";
			p.matrix.style.gridAutoRows = sq + "px";
			for (var n; (n = p.matrix.firstChild);) p.matrix.removeChild(n);
			var flashPeriod = 1.45;
			var flowPeriod = 4;
			for (var r = 0; r < 5; r++) {
				for (var c = 0; c < cols; c++) {
					var cell = j("div", "dsh-nmp-effort-matrix-cell");
					var sqEl = j("div", "dsh-nmp-effort-matrix-sq");
					var ratio = cols > 1 ? c / (cols - 1) : 1;
					sqEl.style.opacity = String(effortColFade(ratio));
					if (!reduced) {
						var frontDelay = (1 - ratio) * flashPeriod * 0.31 + effortHash(r, c, 4) * flashPeriod * 0.055;
						var flowDelay = ratio * flowPeriod + r * flowPeriod * 0.03 + effortHash(r, c, 5) * flowPeriod * 0.05;
						// 流光按列分桶取强度：多数格子几乎不闪、少数明显；负延迟让波纹开场即处于稳态
						var bucket = Math.min(8, Math.floor(ratio * 9));
						var mix = effortHash(bucket, r, 6) * 0.4 + effortHash(r, c, 7) * 0.6;
						var clamped = Math.min(1, Math.max(0, (mix - 0.46) / 0.12));
						var strength = 0.04 + clamped * clamped * (3 - 2 * clamped) * 0.92;
						cell.style.setProperty("animation-delay", frontDelay.toFixed(3) + "s", "important");
						sqEl.style.setProperty("--dsh-front-delay", frontDelay.toFixed(3) + "s");
						sqEl.style.setProperty("--dsh-flow-delay", "-" + flowDelay.toFixed(3) + "s");
						sqEl.style.setProperty("--dsh-flow-strength", strength.toFixed(3));
						sqEl.style.setProperty("--dsh-flash-mix", (62 - effortHash(r, c, 1) * 22).toFixed(1) + "%");
						sqEl.style.setProperty("animation-delay", (effortHash(r, c, 2) * flashPeriod * 0.95 + flashPeriod * 0.21).toFixed(3) + "s", "important");
						sqEl.style.setProperty("animation-duration", (flashPeriod * (0.92 + effortHash(r, c, 3) * 0.16)).toFixed(3) + "s", "important");
					}
					cell.appendChild(sqEl);
					p.matrix.appendChild(cell);
				}
			}
			return true;
		}

		function effortSync() {
			var p = effortParts;
			if (!p) return;
			var steps = effortSteps();
			var index = catalog.effortIndex;
			// 首次同步或档表变化时瞬移，其余走过渡；与主题 Se 的判定一致
			var sig = effortStepsSig(steps);
			var animate = effortSynced && sig === effortSyncSig && index !== effortSyncIndex && steps.length > 1;
			effortSyncSig = sig;
			effortSyncIndex = index;
			effortSynced = true;
			if (p.ticks.childElementCount !== steps.length) {
				for (var n; (n = p.ticks.firstChild);) p.ticks.removeChild(n);
				for (var i = 0; i < steps.length; i++) {
					var tick = j("span", "dsh-nmp-effort-tick");
					tick.style.left = Math.round(effortLeftOf(i) + effortSpan().size / 2) + "px";
					p.ticks.appendChild(tick);
				}
			}
			var text = steps[index] ? steps[index].name : EFFORT_NONE;
			swapEffortLabel(text);
			if (steps.length === 0) p.root.setAttribute("data-empty", "");
			else p.root.removeAttribute("data-empty");
			p.track.setAttribute("aria-valuemin", "0");
			p.track.setAttribute("aria-valuemax", String(Math.max(0, steps.length - 1)));
			p.track.setAttribute("aria-valuenow", String(Math.max(0, index)));
			p.track.setAttribute("aria-valuetext", text);
			// 末档格子：轨道宽度拿不到（弹层尚未参与布局）时留待下次重试
			var apex = steps.length > 1 && index === steps.length - 1;
			if (apex) {
				p.root.setAttribute("data-apex", "");
				ensureEffortMatrix();
			} else p.root.removeAttribute("data-apex");
			effortSetPos(effortLeftOf(index), animate);
		}

		// 12 秒去抖：宿主 store 尚未写回所选档的窗口期里，快照推送不得把滑块拽回旧档
		function clearEffortPending() {
			if (effortPendingTimer) { clearTimeout(effortPendingTimer); effortPendingTimer = 0; }
			effortPending = null;
		}
		function armEffortPending(id) {
			clearEffortPending();
			effortPending = { id: id };
			effortPendingTimer = setTimeout(clearEffortPending, 12000);
		}

		// 档位切换：宿主 select；落到「Default」这一步时不传 reasoningEffort，
		// 由目录按模型自带的 defaultEffort 补齐
		function pickEffort(index) {
			var dir = boundDirectory();
			var model = catalog.currentKey ? catalogModel(catalog.currentKey) : null;
			var steps = effortSteps();
			if (!dir || !model) return;
			if (index < 0 || index >= steps.length || index === catalog.effortIndex) return;
			var step = steps[index];
			var sel = { provider: model.provider, model: model.model };
			if (step.id !== void 0) sel.reasoningEffort = step.id;
			// 感知优先：先按点击档位点亮，结果由 store 订阅校正
			catalog.effortIndex = index;
			armEffortPending(step.id);
			effortSync();
			updateEffortButton();
			dir.select(sel).catch(function (e) {
				clearEffortPending();
				console.error("dsh-native-model-picker: 推理等级切换失败", e);
			});
		}

		function bindEffortTrack() {
			var p = effortParts;
			var track = p.track;
			var pendingFrame = 0;
			var pendingEvent = null;
			function positionOf(clientX) {
				var rect = track.getBoundingClientRect();
				var raw = clientX - rect.left - effortSpan().size / 2;
				return Math.max(0, Math.min(effortSpan().span, raw));
			}
			function previewAt(x, glide) {
				effortSetPos(effortMagnet(x), glide);
				effortDrag.index = effortIndexAt(x);
				var steps = effortSteps();
				swapEffortLabel(steps[effortDrag.index] ? steps[effortDrag.index].name : EFFORT_NONE);
			}
			// 指针移动经 rAF 批处理，一帧至多一次几何写入
			function moveNow() {
				pendingFrame = 0;
				if (!effortDrag || !pendingEvent) return;
				var re = pendingEvent;
				pendingEvent = null;
				previewAt(positionOf(re.clientX), true);
			}
			track.addEventListener("pointerdown", function (e) {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				effortDrag = { pointerId: e.pointerId, index: catalog.effortIndex, x: e.clientX, y: e.clientY };
				try { track.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器无指针捕获 */ }
				// data-dragging 随首次移动挂上：按下此刻先滑到抓取点
				previewAt(positionOf(e.clientX), true);
			});
			track.addEventListener("pointermove", function (e) {
				if (!effortDrag || e.pointerId !== effortDrag.pointerId) return;
				effortDrag.x = e.clientX;
				effortDrag.y = e.clientY;
				if (!p.root.hasAttribute("data-dragging")) p.root.setAttribute("data-dragging", "");
				pendingEvent = e;
				if (!pendingFrame) pendingFrame = requestAnimationFrame(moveNow);
			});
			function endEffortDrag(e) {
				if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = 0; }
				pendingEvent = null;
				var drag = effortDrag;
				effortDrag = null;
				p.root.removeAttribute("data-dragging");
				try { track.releasePointerCapture(drag.pointerId); } catch (err) { /* 已释放 */ }
				// 松手即提交最后预览档（拖出弹层外松手同样提交）
				if (e.type === "pointerup" && drag.index >= 0) pickEffort(drag.index);
				effortSync();
				updateEffortButton();
			}
			function release(e) {
				if (!effortDrag || (e && e.pointerId !== effortDrag.pointerId)) return;
				endEffortDrag(e);
			}
			// 拖动可能移出轨道：松手监听挂在全局。jsdom 沙箱里全局 window 与文档视图不同源，退回 document
			var releaseTarget = document.defaultView === window ? window : document;
			releaseTarget.addEventListener("pointerup", release, true);
			releaseTarget.addEventListener("pointercancel", release, true);
			effortRelease = { target: releaseTarget, fn: release };
			track.addEventListener("keydown", function (e) {
				var steps = effortSteps();
				if (!steps.length) return;
				var base = catalog.effortIndex < 0 ? 0 : catalog.effortIndex;
				var next = base;
				if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, base - 1);
				else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(steps.length - 1, base + 1);
				else if (e.key === "Home") next = 0;
				else if (e.key === "End") next = steps.length - 1;
				else return;
				e.preventDefault();
				e.stopPropagation();
				pickEffort(next);
				effortSync();
				updateEffortButton();
			});
		}

		// 弹层贴在按钮上方，右缘对齐按钮右缘，越出视口时向内收
		function placeEffortPop() {
			if (!effortPop || !effortBtn) return;
			var b = effortBtn.getBoundingClientRect();
			var vw = window.innerWidth || document.documentElement.clientWidth;
			var vh = window.innerHeight || document.documentElement.clientHeight;
			var w = effortPop.offsetWidth || 264;
			var h = effortPop.offsetHeight || 96;
			var x = Math.round(Math.min(b.right - w, vw - w - 8));
			if (x < 8) x = 8;
			var y = Math.round(b.top - h - 6);
			if (y < 8) y = Math.round(b.bottom + 6);
			if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
			effortPop.style.left = x + "px";
			effortPop.style.top = y + "px";
		}

		function openEffort() {
			if (!effortBtn) return;
			// 两个弹层不同时在场：等级弹层贴在按钮上方，会压住主卡
			closeEverything();
			cancelEffortHover();
			if (!effortPop) effortPop = buildEffortPop();
			// 先定位再开：弹层处于 visibility:hidden 时即可读尺寸
			placeEffortPop();
			effortPop.setAttribute(OPEN_ATTR, "true");
			if (effortBtn) effortBtn.setAttribute("aria-expanded", "true");
			effortSync();
			var p = effortParts;
			if (p) p.track.focus();
		}

		function closeEffort() {
			cancelEffortHover();
			if (effortPop) effortPop.setAttribute(OPEN_ATTR, "false");
			if (effortBtn) effortBtn.setAttribute("aria-expanded", "false");
			if (effortParts) effortParts.root.removeAttribute("data-dragging");
			effortDrag = null;
		}

		// ---------- 主循环 ----------

		function enhance() {
			bindDirectory();
			enhanceTrigger();
			updateEffortButton();
			var main = mainCard();
			if (!main || !isOpen(main)) return;
			// 切换进行中：视图保持原样，store 订阅与切换收尾会各自触发重绘
			if (switching > 0) return;
			renderAll(main);
		}

		var frame = 0;
		function scheduleEnhance() {
			if (frame) return;
			frame = requestAnimationFrame(function () {
				frame = 0;
				enhance();
			});
		}

		// ---------- 事件 ----------

		// 原生菜单在按钮 pointerdown 时就展开（左上角闪现的来源）：capture 层压掉按钮的指针按下序列，
		// click 仍送达 onTriggerCapture 处理自家开合；程序化 click() 不产生指针事件，不受影响
		function onTriggerPointerCapture(e) {
			var b = e.target && e.target.closest ? e.target.closest(TRIGGER_MATCH_SELECTOR) : null;
			if (!b) return;
			e.preventDefault();
			e.stopImmediatePropagation();
		}

		// 触发按钮接管：capture 阶段拦下原生弹层与主题弹层
		function onTriggerCapture(e) {
			var b = e.target && e.target.closest ? e.target.closest(TRIGGER_MATCH_SELECTOR) : null;
			if (!b) return;
			e.preventDefault();
			e.stopPropagation();
			lastTriggerEl = b;
			// 按钮 click 会顺冒泡到 document，置标志让 onDocClick 忽略这次程序化流转
			win().__nmpConsumed = true;
			setTimeout(function () { win().__nmpConsumed = false; }, 120);
			var main = mainCard();
			if (main && isOpen(main)) closeEverything();
			else openMain();
		}

		// 悬浮打开主卡（与原生菜单行为一致）：指针在触发按钮上停留 160ms 即打开；
		// 中途移开取消；主卡刚收起过需要短暂冷却，避免关闭动作还没落地又悬浮重开
		var hoverTriggerEl = null;
		var hoverTimer = 0;
		var hoverEntryTimer = 0;
		var hoverChanEl = null;
		var hoverChanTimer = 0;

		// 指针保护圈：主卡、二级卡、三级卡与触发按钮之内视为菜单之中
		function inMenuZone(t) {
			if (!t || !t.closest) return false;
			if (t.closest(".dsh-nmp-effort-btn,.dsh-nmp-effort-pop")) return true;
			return !!t.closest("." + MAIN_CLASS + ",." + CH_CLASS + ",." + CH3_CLASS + "," + TRIGGER_MATCH_SELECTOR);
		}
		// 指针离开二级/三级卡后延迟收起侧卡（穿缝隙宽限与整体收起一致）；回到侧卡或入口取消
		var l2CloseTimer = 0;
		function cancelL2Close() {
			if (l2CloseTimer) clearTimeout(l2CloseTimer);
			l2CloseTimer = 0;
		}
		function scheduleL2Close() {
			if (l2CloseTimer) return;
			l2CloseTimer = setTimeout(function () {
				l2CloseTimer = 0;
				var l2 = level2Card();
				if (!l2 || !isOpen(l2) || pinnedMenu) return;
				if (document.querySelector("." + CH_CLASS + ":hover,." + CH3_CLASS + ":hover")) return;
				if (document.querySelector('[data-nmp-entry="channels"]:hover')) return;
				closeLevel2();
			}, 260);
		}

		// 指针离开保护圈后延迟整体收起（复刻原生 scheduleClose）；回到圈内取消
		var menuCloseTimer = 0;
		function cancelMenuClose() {
			if (menuCloseTimer) clearTimeout(menuCloseTimer);
			menuCloseTimer = 0;
		}
		function scheduleMenuClose() {
			if (menuCloseTimer) return;
			menuCloseTimer = setTimeout(function () {
				menuCloseTimer = 0;
				var main = mainCard();
				if (!main || !isOpen(main) || pinnedMenu) return;
				var a = document.activeElement;
				if (a && a !== document.body && main.contains(a)) return;
				if (document.querySelector("." + MAIN_CLASS + ":hover,." + CH_CLASS + ":hover,." + CH3_CLASS + ":hover")) return;
				closeAuto();
			}, 260);
		}
		function clearHoverTimer() {
			if (hoverTimer) clearTimeout(hoverTimer);
			hoverTimer = 0;
			hoverTriggerEl = null;
			if (hoverEntryTimer) clearTimeout(hoverEntryTimer);
			hoverEntryTimer = 0;
			if (hoverChanTimer) clearTimeout(hoverChanTimer);
			hoverChanTimer = 0;
			hoverChanEl = null;
		}
		function onDocMouseOver(e) {
			var t = e.target;
			var main = mainCard();
			// 指针回到任意一张卡或按钮：取消收起；完全离开保护圈：延时整体收起（复刻原生失焦即关）
			if (inMenuZone(t)) cancelMenuClose();
			else if (main && isOpen(main) && !pinnedMenu) scheduleMenuClose();
			// 二级卡跟随收起：指针在主卡其他区域或卡外活动时，侧卡宽限后收起（回到入口或侧卡取消）
			var inL2 = t && t.closest ? t.closest("." + CH_CLASS + ",." + CH3_CLASS + ',[data-nmp-entry="channels"]') : null;
			if (inL2) cancelL2Close();
			else if (pinnedMenu) cancelL2Close();
			else {
				var l2now = level2Card();
				if (l2now && isOpen(l2now)) scheduleL2Close();
				else cancelL2Close();
			}
			// 悬浮触发按钮打开主卡
			var b = t && t.closest ? t.closest(TRIGGER_MATCH_SELECTOR) : null;
			// 指针已移到别处：撤销尚未到点的悬浮计时（mouseover 每次元素切换都会到达，比到点复查 :hover 更可靠）
			if (!b && hoverTimer) clearHoverTimer();
			var entry = t && t.closest ? t.closest('[data-nmp-entry="channels"]') : null;
			if (!entry && hoverEntryTimer) { clearTimeout(hoverEntryTimer); hoverEntryTimer = 0; }
			var chan = t && t.closest ? t.closest("." + CH_CLASS + " [" + CHANNEL_ATTR + "]") : null;
			if (!chan && hoverChanTimer) { clearTimeout(hoverChanTimer); hoverChanTimer = 0; hoverChanEl = null; }
			if (b) {
				if (main && isOpen(main)) return;
				if (b === hoverTriggerEl && hoverTimer) return;
				if (Date.now() - lastCloseAt < 500) return;
				clearHoverTimer();
				hoverTriggerEl = b;
				hoverTimer = setTimeout(function () {
					hoverTimer = 0;
					hoverTriggerEl = null;
					var m2 = mainCard();
					if (m2 && isOpen(m2)) return;
					lastTriggerEl = b;
					openMain();
				}, 160);
			}
			// 悬浮 footer 当前模型格打开二级卡（悬浮态不钉选，指针离开即收）
			if (entry && main && isOpen(main) && !isOpen(level2Card())) {
				if (hoverEntryTimer) clearTimeout(hoverEntryTimer);
				hoverEntryTimer = setTimeout(function () {
					hoverEntryTimer = 0;
					var m3 = mainCard();
					if (!m3 || !isOpen(m3) || isOpen(level2Card())) return;
					openLevel2();
				}, 160);
			}
			// 悬浮二级卡渠道行滑出三级卡；钉选的三卡不受悬浮影响
			var l3 = level3Card();
			if (l3 && isOpen(l3) && l3.getAttribute(PIN_ATTR) === "1") return;
			if (chan && isOpen(level2Card()) && chan !== hoverChanEl) {
				hoverChanEl = chan;
				if (hoverChanTimer) clearTimeout(hoverChanTimer);
				hoverChanTimer = setTimeout(function () {
					hoverChanTimer = 0;
					if (!isOpen(level2Card())) return;
					openLevel3(chan.getAttribute(CHANNEL_ATTR), false);
				}, 160);
			}
		}
		function onDocMouseOut(e) {
			var to = e.relatedTarget;
			// 同一元素内部的移动（父子之间）不打断悬浮计时；真正离开或移出窗口才取消
			if (to && e.target && e.target.contains && e.target.contains(to)) return;
			clearHoverTimer();
		}

		function togglePin(kind, target) {
			var pins = loadPins();
			var list = kind === "source" ? pins.sources : kind === "hidden" ? pins.hidden : pins.models;
			var idx = list.indexOf(target);
			if (idx >= 0) list.splice(idx, 1);
			else list.push(target);
			savePins(pins);
		}

		function refreshStars() {
			var pins = loadPins();
			var stars = document.querySelectorAll(".dsh-cp-star[data-pin-kind]");
			for (var i = 0; i < stars.length; i++) {
				var s = stars[i];
				var kind = s.getAttribute("data-pin-kind");
				if (kind === "clearChannel") continue;
				var target = s.getAttribute("data-pin-target");
				var pinned;
				if (kind === "model" && s.getAttribute("data-pin-context") === "group") {
					pinned = pins.hidden.indexOf(target) < 0;
				} else if (kind === "source") {
					pinned = channelFullyShown(target, pins);
				} else {
					pinned = pins.models.indexOf(target) >= 0;
				}
				s.setAttribute("data-pinned", pinned ? "1" : "0");
			}
		}

		function onDocClick(e) {
			var t = e.target;
			if (!t || !t.closest) return;
			if (win().__nmpConsumed) return;

			// 星标：翻转收藏
			var star = t.closest(".dsh-cp-star");
			if (star) {
				e.preventDefault();
				e.stopPropagation();
				var kind = star.getAttribute("data-pin-kind");
				var target = star.getAttribute("data-pin-target");
				if (kind === "clearChannel" && target) {
					var pinsCh = loadPins();
					pinsCh.sources = pinsCh.sources.filter(function (n) { return n !== target; });
					pinsCh.models = pinsCh.models.filter(function (k) { return k.split("::")[0] !== target; });
					pinsCh.hidden = pinsCh.hidden.filter(function (k) { return k.split("::")[0] !== target; });
					savePins(pinsCh);
				} else if (kind && target) {
					var pinsNow = loadPins();
					var groupCtx = kind === "model" && pinsNow.sources.indexOf(target.split("::")[0]) >= 0;
					togglePin(groupCtx ? "hidden" : kind, target);
				} else {
					return;
				}
				refreshStars();
				var main = mainCard();
				if (main) renderAll(main);
				return;
			}

			// 档位取名入口
			var cfgBtn = t.closest('[data-nmp-entry="effort-names"]');
			if (cfgBtn) {
				e.preventDefault();
				e.stopPropagation();
				if (namesPanelCard()) closeNamesPanel();
				else buildNamesPanel(cfgBtn);
				return;
			}
			// 面板内的输入框点击不触发外点收起
			if (t.closest(".dsh-nmp-names")) return;

			// footer 模型格：开合二级卡并进入钉选态（失焦不关，再点或 Escape 解除）
			var entry = t.closest('[data-nmp-entry="channels"]');
			if (entry) {
				e.preventDefault();
				e.stopPropagation();
				var l2 = level2Card();
				if (pinnedMenu && l2 && isOpen(l2)) {
					pinnedMenu = false;
					closeLevel2();
					return;
				}
				pinnedMenu = true;
				openLevel2();
				return;
			}

			// 二级卡渠道行：侧滑三级卡（点击钉选/收起）
			var chan = t.closest("." + CH_CLASS + " [" + CHANNEL_ATTR + "]");
			if (chan) {
				e.preventDefault();
				e.stopPropagation();
				openLevel3(chan.getAttribute(CHANNEL_ATTR), true);
				return;
			}
			// 三级卡/一级收藏里的模型行：走宿主目录的 select 完成切换
			var row = t.closest(".dsh-nmp-option[data-nmp-model]");
			if (row) {
				e.preventDefault();
				e.stopPropagation();
				var key = row.getAttribute("data-nmp-model");
				// 感知优先：点击即收卡并预点亮对勾，切换结果由 store 订阅校正
				closeEverything();
				switchModel(key);
				return;
			}

		}

		// 外点收起：主卡与所有侧卡之外按下时逐级收起；钉选态由 Escape 或再次点击解除
		// 外点收起：主卡与所有侧卡之外按下指针时，未钉选则整体收起（复刻原生菜单失焦即关）；
		// 钉选态（入口钉选或三级卡钉选）期间仅收起悬浮态侧卡，主卡与钉选侧卡保留，由 Escape 或再次点击解除
		function outsideClose(e) {
			var t2 = e.target;
			if (namesPanelCard() && !t2.closest(".dsh-nmp-names,.dsh-nmp-cfg")) closeNamesPanel();
			if (effortOpen() && !t2.closest(".dsh-nmp-effort-pop,.dsh-nmp-effort-btn")) closeEffort();
			var main = mainCard();
			if (!main || !isOpen(main)) return;
			if (t2.closest && t2.closest(TRIGGER_MATCH_SELECTOR)) return;
			if (main.contains(t2)) return;
			var l2 = level2Card();
			if (l2 && l2.contains(t2)) return;
			var l3 = level3Card();
			if (l3 && l3.contains(t2)) return;
			// 钉选只对悬浮与失焦收起生效；明确点在卡片之外一律整体收起（与原生菜单一致）
			closeEverything();
		}

		function onKeyCapture(e) {
			if (e.key !== "Escape") return;
			if (namesPanelCard()) {
				e.preventDefault();
				e.stopPropagation();
				closeNamesPanel();
				return;
			}
			if (effortOpen()) {
				e.preventDefault();
				e.stopPropagation();
				closeEffort();
				return;
			}
			var main = mainCard();
			if (!main || !isOpen(main)) return;
			// 拦截原生/上层默认行为后逐级收起：入口钉选态 → 钉选的三级卡
			e.preventDefault();
			e.stopPropagation();
			if (pinnedMenu) {
				pinnedMenu = false;
				closeLevel2();
				return;
			}
			var l3 = level3Card();
			if (l3 && isOpen(l3)) { closeLevel3(); return; }
			closeEverything();
		}

		// ---------- 启动 ----------

		function start() {
			ensureStyle();
			loadEffortNameConfig();

			var observer = new MutationObserver(function () { scheduleEnhance(); });
			observer.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-label", OPEN_ATTR, "data-pinned", CHANNEL_ATTR],
			});

			// 触发按钮可能晚于插件出现；capture 监听挂在 document，不依赖按钮已在场
			document.addEventListener("click", onTriggerCapture, true);
			document.addEventListener("click", onDocClick, true);
			document.addEventListener("pointerdown", outsideClose, true);
			// window capture 先于页面在 document/root 上的按下监听，原生菜单在按下瞬间不再被打开；
			// 全局 window 与文档视图不同源的环境（jsdom 沙箱）直接注册会抛跨 realm 错误，退回 document
			var pressTargets = document.defaultView === window
				? [window, document]
				: [document];
			for (var pt = 0; pt < pressTargets.length; pt++) {
				pressTargets[pt].addEventListener("pointerdown", onTriggerPointerCapture, true);
				pressTargets[pt].addEventListener("mousedown", onTriggerPointerCapture, true);
			}
			document.addEventListener("keydown", onKeyCapture, true);
			document.addEventListener("mouseover", onDocMouseOver, true);
			document.addEventListener("mouseout", onDocMouseOut, true);
			// 描述文案与品牌图标都从主题包取：主题不在场时描述退回宿主的英文说明，图标不合成
			loadDescCatalog();
			loadBrandLogos();
			enhance();

			return function dispose() {
				if (frame) cancelAnimationFrame(frame);
				frame = 0;
				observer.disconnect();
				cancelClose3();
				document.removeEventListener("click", onTriggerCapture, true);
				document.removeEventListener("click", onDocClick, true);
				document.removeEventListener("pointerdown", outsideClose, true);
				var pressTargets2 = document.defaultView === window
					? [window, document]
					: [document];
				for (var pt2 = 0; pt2 < pressTargets2.length; pt2++) {
					pressTargets2[pt2].removeEventListener("pointerdown", onTriggerPointerCapture, true);
					pressTargets2[pt2].removeEventListener("mousedown", onTriggerPointerCapture, true);
				}
				document.removeEventListener("pointerdown", onTriggerPointerCapture, true);
				document.removeEventListener("mousedown", onTriggerPointerCapture, true);
				cancelMenuClose();
				document.removeEventListener("keydown", onKeyCapture, true);
				document.removeEventListener("mouseover", onDocMouseOver, true);
				document.removeEventListener("mouseout", onDocMouseOut, true);
				clearHoverTimer();
				var style = document.getElementById(STYLE_ID);
				if (style) style.remove();
				closeEverything();
				closeNamesPanel();
				var main = mainCard();
				if (main) main.remove();
				if (triggerLabelObserver) { triggerLabelObserver.disconnect(); triggerLabelObserver = null; triggerLabelWatched = null; }
				closeEffort();
				if (effortBtn) { effortBtn.remove(); effortBtn = null; }
				if (effortPop) { effortPop.remove(); effortPop = null; }
				if (effortRelease) {
					effortRelease.target.removeEventListener("pointerup", effortRelease.fn, true);
					effortRelease.target.removeEventListener("pointercancel", effortRelease.fn, true);
					effortRelease = null;
				}
				effortParts = null;
				effortMeasureKey = "";
				cancelEffortHover();
				clearEffortPending();
				effortSynced = false;
				effortSyncSig = "";
				effortSyncIndex = -1;
				effortMatrixKey = null;
				effortKnobPos = "";
				effortFillPos = "";
				catalog = { groups: [], sig: "", currentKey: null, currentModel: "", effortSteps: [], effortIndex: -1 };
				switching = 0;
				pinnedMenu = false;
				dropDirectory();
			};
		}

		module.exports.inject = ["sessions", "modelDirectories", "uiSession"];
		module.exports.apply = function apply(ctx) {
			sessionsService = ctx.get("sessions");
			modelDirService = ctx.get("modelDirectories");
			uiSessionService = ctx.get("uiSession");
			ctx.effect(function () {
				var boot = function () {
					return start();
				};
				if (document.readyState === "loading") {
					var inner = null;
					var onReady = function () {
						document.removeEventListener("DOMContentLoaded", onReady);
						inner = boot();
					};
					document.addEventListener("DOMContentLoaded", onReady);
					return function () {
						document.removeEventListener("DOMContentLoaded", onReady);
						if (typeof inner === "function") inner();
					};
				}
				return boot();
			}, "dsh-native-model-picker: host-directory three-level model picker");
		};

		return module.exports;
	}
});

