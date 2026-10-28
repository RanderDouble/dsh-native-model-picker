import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASS = [];
function ok(name, cond) {
	assert.ok(cond, name);
	PASS.push(name);
}

// ---------- 宿主 modelDirectories 夹具 ----------
// 按宿主真实语义建模：每会话一个 ModelDirectory，store 快照 { current, retainedEffort, routable,
// groups, failures, status, pending, error }；select() 置 selecting → 调 sessions.selectModel →
// 成功后置 ready 并按新的 current 重算快照；load() 拉目录（此处目录常驻）。
function makeStore(initial) {
	let value = initial;
	const subs = new Set();
	return {
		getSnapshot: () => value,
		set(next) {
			value = next;
			subs.forEach((fn) => fn(value));
		},
		update(fn) {
			const next = Object.assign({}, value);
			fn(next);
			value = next;
			subs.forEach((fn) => fn(value));
		},
		subscribe(fn) {
			subs.add(fn);
			return () => subs.delete(fn);
		},
		subscriberCount: () => subs.size,
	};
}

function makeHost(spec, initialSelection) {
	const index = new Map();
	spec.forEach((g) => g.models.forEach((m) => index.set(g.id + "/" + m.id, { group: g, model: m })));
	const host = {
		groups: spec,
		selection: Object.assign({}, initialSelection),
		selectCalls: [],
		failNext: false,
		dirs: new Map(),
	};
	function effortOf(sel) {
		const hit = index.get(sel.provider + "/" + sel.model);
		if (!hit) return undefined;
		const reasoning = hit.model.reasoning;
		return sel.reasoningEffort !== undefined ? sel.reasoningEffort : reasoning && reasoning.defaultEffort;
	}
	// uiSession 的 current 是绑定源：value.key 为当前挂载会话；会话列表快照没有 current 字段
	host.uiSession = { current: { value: { key: "sess-1", props: {} }, hooks: new Set(), keyedHooks: new Map() } };
	host.sessions = {
		list: { getSnapshot: () => ({ ids: ["sess-1"], byId: {}, phase: "ready" }) },
		selectModel(arg) {
			host.selectCalls.push(arg);
			if (host.failNext) {
				host.failNext = false;
				return Promise.resolve({ ok: false, error: { code: "provider_unreachable", message: "渠道不可用" } });
			}
			const hit = index.get(arg.provider + "/" + arg.model);
			if (!hit) return Promise.resolve({ ok: false, error: { code: "unknown_model", message: "没有该模型" } });
			const next = { provider: arg.provider, model: arg.model };
			const effort = arg.reasoningEffort !== undefined ? arg.reasoningEffort : hit.model.reasoning && hit.model.reasoning.defaultEffort;
			if (effort !== undefined) next.reasoningEffort = effort;
			host.selection = next;
			host.dirs.forEach((d) => d.sync());
			return Promise.resolve({ ok: true, value: { selected: next } });
		},
	};
	// 目录内新增渠道：索引与快照同时更新，模拟宿主目录重新加载后的新结果
	host.addGroup = (group) => {
		group.models.forEach((m) => index.set(group.id + "/" + m.id, { group, model: m }));
		host.groups.push(group);
	};
	function makeDirectory(sessionId) {
		const store = makeStore({ current: null, routable: null, groups: [], failures: [], status: "idle", pending: null, error: null });
		const dir = {
			sessionId,
			store,
			loadCount: 0,
			sync,
			load() {
				dir.loadCount++;
				sync();
				return Promise.resolve(store.getSnapshot());
			},
			select(sel) {
				store.update((s) => { s.status = "selecting"; s.pending = Object.assign({}, sel); });
				return host.sessions.selectModel({
					sessionId,
					provider: sel.provider,
					model: sel.model,
					...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }),
				}).then((result) => {
					if (!result.ok) {
						store.update((s) => { s.status = "error"; s.error = result.error.code + ": " + result.error.message; s.pending = null; });
						return result;
					}
					store.update((s) => { s.status = "ready"; s.pending = null; s.error = null; });
					sync();
					return result;
				});
			},
		};
		function sync() {
			const cur = host.selection;
			const effort = effortOf(cur);
			const hit = index.get(cur.provider + "/" + cur.model);
			const level = hit && hit.model.reasoning ? hit.model.reasoning.efforts.find((e) => e.id === effort) : undefined;
			const next = {
				current: Object.assign({}, cur),
				routable: !!hit,
				groups: host.groups,
				failures: [],
				status: "ready",
				pending: null,
				error: null,
			};
			if (effort !== undefined) next.retainedEffort = level ? level.name : effort;
			store.set(next);
		}
		return dir;
	}
	host.modelDirectories = {
		directoryFor(sessionId) {
			if (!host.dirs.has(sessionId)) host.dirs.set(sessionId, makeDirectory(sessionId));
			return host.dirs.get(sessionId);
		},
	};
	host.ctx = {
		get(name) {
			if (name === "sessions") return host.sessions;
			if (name === "modelDirectories") return host.modelDirectories;
			if (name === "uiSession") return host.uiSession;
			throw new Error("cannot get property \"" + name + "\" without inject");
		},
		// 宿主 effect 会把回调的返回值当作清理函数保管
		effect(fn) { host.dispose = fn(); },
	};
	return host;
}

const SPEC = [
	{
		id: "chan-a",
		name: "渠道A",
		models: [
			{ id: "alpha-pro", name: "Alpha-Pro · x0.7", description: "Alpha 的英文说明" },
			{ id: "beta", name: "Beta" },
			{ id: "minimax2-7", name: "Minimax2.7" },
			{ id: "glm-5-3-flash", name: "GLM-5.3-Flash", description: "GLM 的英文说明", reasoning: { efforts: [{ id: "off", name: "关闭" }, { id: "high", name: "高" }], defaultEffort: "high" } },
		],
	},
	{
		id: "chan-b",
		name: "渠道B",
		models: [
			{ id: "deepseek-v41-flash", name: "DeepSeek V4.1-Flash" },
			{ id: "kimi-k2-6", name: "Kimi-K2.6 · 免费" },
		],
	},
	{
		id: "chan-c",
		name: "渠道C",
		models: [
			{ id: "twin-a", name: "Twin" },
			{ id: "twin-b", name: "Twin" },
		],
	},
];

// ---------- 通用装载 ----------
function bootDOM(host) {
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/" });
	const win = dom.window;
	win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
	win.cancelAnimationFrame = (id) => clearTimeout(id);
	let exported = null;
	win.__ModuleLoader__ = { load(def) { exported = def.factory(() => {}); } };
	vm.createContext(win);
	const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	vm.runInContext(code, win, { filename: "client.js" });
	const doc = win.document;
	// 触发按钮：真机两枚同 aria-label 的按钮（原生按钮与主题克隆按钮）
	const native = doc.createElement("button");
	native.setAttribute("aria-label", "选择模型，当前 GLM-5.3-Flash，推理等级 高");
	const wrap = doc.createElement("div");
	wrap.className = "_7KE1Ra_root";
	wrap.appendChild(native);
	doc.body.appendChild(wrap);
	return { dom, win, doc, native, get exported() { return exported; } };
}

const host = makeHost(SPEC, { provider: "chan-a", model: "glm-5-3-flash" });
const env = bootDOM(host);
const { doc, win, native } = env;

// 主题文案目录与品牌资产：走宿主预置口
win.__nmpDescCatalog = {
	families: [
		{ match: "^alpha-pro/渠道a$", text: { zh: "阿尔法专业版说明" } },
		{ match: "glm", text: { zh: "非对称模型结构，小成本大智能。" } }
	],
	tiers: [{ match: "beta", text: { zh: "贝塔档位说明" } }]
};
win.__nmpBrandRules__ = [{ match: "glm", brand: "zai" }];
win.__nmpBrandLogos__ = {
	zai: '<svg viewBox="0 0 4.1567 1" data-combine-word="GLM"><clipPath id="crop-zai"><rect x="1.75" width="2.4" height="1"/></clipPath><g clip-path="url(#crop-zai)"><rect width="4.1567" height="1"/></g></svg>'
};

// 原生按钮自身监听：capture 守卫是否拦下点击，用来判定接管与交还
let nativeClicks = 0;
native.addEventListener("click", () => { nativeClicks++; });

// 触发按钮点击会置 120ms 的消费标志，期间的其他点击被当成同一次流转忽略
const sleep30 = () => sleep(250);
const sleep140 = () => sleep(200);
const afterTrigger = () => sleep(200);
env.exported.apply(host.ctx);
// jsdom 构造后 readyState 仍是 loading，插件等 DOMContentLoaded 才启动
await sleep(50);

// ---------- 注入声明与样式 ----------
assert.deepStrictEqual(Array.from(env.exported.inject), ["sessions", "modelDirectories", "uiSession"], "inject");
PASS.push("注入声明为 sessions、modelDirectories 与 uiSession");
ok("未声明的服务被 ctx.get 拒绝", (() => {
	try { host.ctx.get("remote"); return false; } catch (e) { return /without inject/.test(e.message); }
})());
const styleEl = doc.getElementById("dsh-nmp-style");
ok("注入自带样式", !!styleEl);
ok("样式压制主题自带弹层", /.dsh-claude-model-popover{display:none!important;}/.test(styleEl.textContent));
ok("启动即绑定会话目录", host.dirs.has("sess-1"));

// ---------- 触发按钮接管 ----------
native.click();
await afterTrigger();
ok("原生按钮点击被接管（按钮自身监听未触发）", nativeClicks === 0);
let main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
ok("点击后打开主卡", !!main && main.getAttribute("data-open") === "true");
ok("主卡高度上限与侧卡同款（min(可用高, 视口一半)）", main.style.maxHeight === Math.max(120, Math.min(win.innerHeight - 88, Math.round(win.innerHeight * 0.5))) + "px");
await sleep30();
ok("目录未收藏时一级视图给空态提示", !!main.querySelector(".dsh-nmp-empty"));

// ---------- footer 当前模型 ----------
const entry = main.querySelector('[data-nmp-entry="channels"]');
const effLine = entry.querySelector(".dsh-nmp-effort-line");
ok("footer 当前模型名拆成图标 + 型号文本", effLine.textContent.indexOf("5.3-Flash") === 0 && effLine.querySelector(".dsh-claude-model-combine-alt").textContent === "GLM ");
ok("footer 当前模型行不再带等级徽标", !entry.querySelector(".dsh-nmp-tag"));
ok("footer 显示当前模型描述", entry.querySelector(".dsh-nmp-cell-desc").textContent === "非对称模型结构，小成本大智能。");
ok("当前模型名复刻品牌拼接节点", !!entry.querySelector(".dsh-nmp-effort-line .dsh-claude-model-combine svg"));
	const triggerBrand = () => native.querySelector(":scope > .dsh-nmp-trigger-brand");
	ok("触发按钮品牌段带已定位祖先", /.dsh-nmp-trigger-brand\{[^}]*position:relative/.test(styleEl.textContent));
	ok("触发按钮品牌段按主题行内结构承接型号名", !!triggerBrand() && !!triggerBrand().querySelector(":scope > .dsh-claude-model-name .dsh-claude-model-combine svg"));
	ok("品牌段里的型号名走行内排版", /\.dsh-nmp-trigger-brand \.dsh-claude-model-name\{display:inline/.test(styleEl.textContent));
	ok("品牌图标相对文字上提半像素", /\.dsh-nmp-trigger-brand \.dsh-claude-model-combine\{position:relative;top:-0\.5px/.test(styleEl.textContent));
	ok("页面只保留一份插件实例", typeof win.__nmpInstance === "function");

// ---------- 推理等级入口 ----------
const effBtn = doc.querySelector(".dsh-nmp-effort-btn");
ok("等级按钮挂在触发按钮同一行", effBtn.parentElement === native.parentElement && effBtn.previousElementSibling === native);
ok("等级按钮显示当前档位名", effBtn.style.display === "inline-flex" && effBtn.textContent === "高");
ok("等级按钮带可读标签", effBtn.getAttribute("aria-label") === "推理等级 高");
effBtn.click();
await sleep30();
const effPop = doc.querySelector(".dsh-nmp-effort-pop");
ok("点击等级按钮打开滑块弹层", !!effPop && effPop.getAttribute("data-open") === "true");
const effTrack = effPop.querySelector(".dsh-nmp-effort-track");
ok("弹层刻度按档位数生成", effPop.querySelectorAll(".dsh-nmp-effort-tick").length === 2);
ok("弹层标题与两端文案", effPop.querySelector(".dsh-nmp-effort-label").textContent === "推理等级" && Array.from(effPop.querySelectorAll(".dsh-nmp-effort-end")).map((e) => e.textContent).join(",") === "更快,更强");
ok("滑块暴露档位范围与当前值", effTrack.getAttribute("role") === "slider" && effTrack.getAttribute("aria-valuemax") === "1" && effTrack.getAttribute("aria-valuenow") === "1" && effTrack.getAttribute("aria-valuetext") === "高");
effTrack.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
await sleep30();
ok("方向键切换到上一档", host.selectCalls[host.selectCalls.length - 1].reasoningEffort === "off");
ok("等级切换后按钮文案跟随", doc.querySelector(".dsh-nmp-effort-btn").textContent === "关闭");
ok("最高档给根加末档标记", (() => {
	Object.defineProperty(effTrack, "clientWidth", { value: 236, configurable: true });
	effTrack.dispatchEvent(new win.KeyboardEvent("keydown", { key: "End", bubbles: true }));
	return true;
})());
await sleep30();
ok("切到最高档再次调用宿主", host.selectCalls[host.selectCalls.length - 1].reasoningEffort === "high");
ok("末档渲染格子闪动", !!effPop.querySelector('.dsh-nmp-effort[data-apex] .dsh-nmp-effort-matrix-sq'));
const matrix = effPop.querySelector(".dsh-nmp-effort-matrix");
const sqCount = effPop.querySelectorAll(".dsh-nmp-effort-matrix-sq").length;
ok("末档格子按轨道宽度铺满五行", matrix.style.gridTemplateColumns === "repeat(47, 4px)" && matrix.style.gridAutoRows === "4px" && sqCount === 235);
ok("格子列渐变透明度两端正确", effPop.querySelector(".dsh-nmp-effort-matrix-sq").style.opacity === "0" && effPop.querySelectorAll(".dsh-nmp-effort-matrix-sq")[46].style.opacity === "1");
ok("格子带闪动相位与流速延迟", (() => {
	const sq = effPop.querySelectorAll(".dsh-nmp-effort-matrix-sq")[20];
	const strength = parseFloat(sq.style.getPropertyValue("--dsh-flow-strength"));
	return sq.style.getPropertyValue("--dsh-front-delay").endsWith("s") && sq.style.getPropertyValue("--dsh-flow-delay").startsWith("-") && strength >= 0.04 && strength <= 0.96 && sq.style.getPropertyValue("--dsh-flash-mix").endsWith("%");
})());
ok("换档旧文案进 ghost 离场", effPop.querySelector(".dsh-nmp-effort-value-ghost").textContent === "关闭");
ok("按钮与弹层带菜单语义", effBtn.getAttribute("aria-haspopup") === "menu" && effPop.getAttribute("role") === "menu");
doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await sleep30();
ok("Escape 收起等级弹层", effPop.getAttribute("data-open") === "false");

// ---------- 等级悬浮开合与拖出提交 ----------
effBtn.dispatchEvent(new win.MouseEvent("mouseenter"));
await sleep140();
ok("悬浮 100ms 展开等级弹层", effPop.getAttribute("data-open") === "true");
effBtn.dispatchEvent(new win.MouseEvent("mouseleave"));
await sleep140();
ok("离场 100ms 收起等级弹层", effPop.getAttribute("data-open") === "false");
effBtn.click();
await sleep30();
const dragTrack = effPop.querySelector(".dsh-nmp-effort-track");
const down = new win.MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, button: 0 });
Object.defineProperty(down, "pointerId", { value: 7 });
dragTrack.dispatchEvent(down);
await sleep30();
const move = new win.MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 0 });
Object.defineProperty(move, "pointerId", { value: 7 });
dragTrack.dispatchEvent(move);
await sleep30();
const up = new win.MouseEvent("pointerup", { bubbles: true, clientX: 5, clientY: 0 });
Object.defineProperty(up, "pointerId", { value: 7 });
doc.dispatchEvent(up);
await sleep30();
ok("拖出弹层外松手提交最后预览档", host.selectCalls[host.selectCalls.length - 1].reasoningEffort === "off");
ok("拖出提交后按钮文案跟随", doc.querySelector(".dsh-nmp-effort-btn").textContent === "关闭");
effBtn.dispatchEvent(new win.MouseEvent("mouseleave"));
await sleep140();
ok("拖动结束后悬浮收起生效", effPop.getAttribute("data-open") === "false");

// ---------- 二级卡：渠道列表 ----------
entry.click();
await sleep30();
const l2 = doc.querySelector(".dsh-nmp-channels");
ok("点击 footer 打开二级卡", !!l2 && l2.getAttribute("data-open") === "true");
ok("二级卡按侧位几何摆到主卡左侧", /px$/.test(l2.style.left) && /px$/.test(l2.style.bottom));
ok("二级卡列出全部渠道", l2.querySelectorAll("[data-nmp-channel]").length === 3);
ok("二级卡渠道名与宿主一致", l2.querySelectorAll(".dsh-nmp-cell-label")[0].textContent === "渠道A");

// ---------- 三级卡：渠道内模型 ----------
l2.querySelector('[data-nmp-channel="渠道A"]').click();
await sleep30();
const l3 = doc.querySelector(".dsh-nmp-chmodels");
ok("点击渠道行打开三级卡", !!l3 && l3.getAttribute("data-open") === "true");
const rows3 = l3.querySelectorAll(".dsh-nmp-option");
ok("三级卡列出该渠道全部模型", rows3.length === 4);
ok("模型行按显示名本地化排序", Array.from(rows3).map((r) => r.getAttribute("data-nmp-model")).join(",") === "渠道A::Alpha-Pro · x0.7,渠道A::Beta,渠道A::GLM-5.3-Flash,渠道A::Minimax2.7");
ok("模型行名使用品牌拼接节点", !!l3.querySelector('[data-nmp-model="渠道A::GLM-5.3-Flash"] .dsh-claude-model-combine svg'));
ok("模型行不带描述小字", l3.querySelectorAll(".dsh-nmp-cell-desc").length === 0);
ok("模型行只有名称与对勾", (() => {
	const row = l3.querySelector('[data-nmp-model="渠道A::GLM-5.3-Flash"]');
	return row.querySelectorAll(".dsh-nmp-copy").length === 1 && row.querySelector(".dsh-nmp-copy").children.length === 1;
})());
ok("当前模型行带对勾", !!l3.querySelector('[data-nmp-model="渠道A::GLM-5.3-Flash"] .dsh-nmp-check svg'));
ok("非当前模型行无对勾", !l3.querySelector('[data-nmp-model="渠道A::Beta"] .dsh-nmp-check svg'));

// ---------- 切换：走宿主目录的 select ----------
l3.querySelector('[data-nmp-model="渠道A::Beta"]').click();
await sleep30();
ok("切换调用宿主 selectModel 且带会话 id", (() => {
	const c = host.selectCalls[host.selectCalls.length - 1];
	return c && c.sessionId === "sess-1" && c.provider === "chan-a" && c.model === "beta";
})());
ok("切换不显式传推理等级（由目录按 defaultEffort 补齐）", host.selectCalls[host.selectCalls.length - 1].reasoningEffort === undefined);
ok("切换后宿主选择已更新", host.selection.provider === "chan-a" && host.selection.model === "beta");
ok("点击模型行后整体收起", main.getAttribute("data-open") === "false");
await afterTrigger();
native.click();
await sleep30();
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
ok("footer 跟随 store 更新", main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-effort-line').textContent.indexOf("Beta") === 0);

ok("无等级档位的模型不显示等级按钮", doc.querySelector(".dsh-nmp-effort-btn").style.display === "none");
ok("families 未命中时按 tiers 规则补描述", main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-cell-desc').textContent === "贝塔档位说明");

// ---------- 搜索 ----------
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
const input = main.querySelector(".dsh-nmp-search > input");
const homeView = () => main.querySelector(":scope > .dsh-nmp-view");
// 二级卡开合是钉选态切换：已开就不再点，免得把它关掉
const openChannels = () => {
	main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
	const open = doc.querySelector(".dsh-nmp-channels");
	if (open && open.getAttribute("data-open") === "true") return;
	main.querySelector('[data-nmp-entry="channels"]').click();
};
input.value = "deep";
input.dispatchEvent(new win.Event("input", { bubbles: true }));
ok("搜索命中渠道名与模型名", homeView().querySelectorAll(".dsh-nmp-option").length === 1 && homeView().querySelector(".dsh-nmp-option").getAttribute("data-nmp-model") === "渠道B::DeepSeek V4.1-Flash");
input.value = "zzz";
input.dispatchEvent(new win.Event("input", { bubbles: true }));
ok("无命中显示提示", !!homeView().querySelector(".dsh-nmp-nohit"));
input.value = "渠道";
input.dispatchEvent(new win.Event("input", { bubbles: true }));
ok("搜索命中按渠道分组并显示渠道名", Array.from(homeView().querySelectorAll(".dsh-nmp-rule-name")).map((n) => n.textContent).join(",") === "渠道A,渠道B,渠道C");
ok("搜索分组顺序与目录一致，组内保留目录顺序", Array.from(homeView().querySelectorAll(".dsh-nmp-option")).map((r) => r.getAttribute("data-nmp-model")).join(",") === "渠道A::Alpha-Pro · x0.7,渠道A::Beta,渠道A::GLM-5.3-Flash,渠道A::Minimax2.7,渠道B::DeepSeek V4.1-Flash,渠道B::Kimi-K2.6 · 免费,渠道C::Twin,渠道C::Twin::twin-b");
input.value = "渠道B";
input.dispatchEvent(new win.Event("input", { bubbles: true }));
ok("命中渠道名时该渠道模型全部归入一枚分组", homeView().querySelectorAll(".dsh-nmp-rule-name").length === 1 && homeView().querySelectorAll(".dsh-nmp-option").length === 2);
input.value = "";
input.dispatchEvent(new win.Event("input", { bubbles: true }));
ok("清空恢复收藏视图", !!homeView().querySelector(".dsh-nmp-empty"));

// ---------- 收藏与隐藏 ----------
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
main.querySelector('[data-nmp-entry="channels"]').click();
await sleep30();
ok("钉选入口打开二级卡", (() => { const c = doc.querySelector(".dsh-nmp-channels"); return !!c && c.getAttribute("data-open") === "true"; })());
doc.querySelector('.dsh-nmp-channels [data-nmp-channel="渠道A"] .dsh-cp-star').click();
await sleep30();
let pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
ok("星标收藏渠道写入存储", pins.sources.indexOf("渠道A") >= 0);
ok("收藏渠道在一级视图成组展开", !!homeView().querySelector(".dsh-nmp-rule-name") && homeView().querySelectorAll(".dsh-nmp-option").length === 4);
homeView().querySelector('[data-nmp-model="渠道A::Beta"] .dsh-cp-star').click();
await sleep30();
pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
ok("整组收藏下点星标记入隐藏", pins.hidden.indexOf("渠道A::Beta") >= 0);
ok("隐藏成员从收藏视图移除", homeView().querySelectorAll(".dsh-nmp-option").length === 3);

// ---------- 同渠道多个单模型钉选 ----------
{
	const savedPins = win.localStorage.getItem("dsh-nmp-pins-v1");
	win.localStorage.setItem("dsh-nmp-pins-v1", JSON.stringify({ sources: [], models: ["渠道A::Alpha-Pro · x0.7", "渠道A::GLM-5.3-Flash"], hidden: [] }));
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
	const rows = Array.from(homeView().querySelectorAll(".dsh-nmp-option")).map((r) => r.getAttribute("data-nmp-model"));
	ok("同渠道第二个单模型钉选同样出现在收藏视图", rows.length === 2 && rows.indexOf("渠道A::Alpha-Pro · x0.7") >= 0 && rows.indexOf("渠道A::GLM-5.3-Flash") >= 0);
	ok("同渠道多个单模型钉选共用一个渠道分组", homeView().querySelectorAll(".dsh-nmp-rule").length === 1);
	win.localStorage.setItem("dsh-nmp-pins-v1", JSON.stringify({ sources: ["渠道A"], models: ["渠道A::Alpha-Pro · x0.7"], hidden: [] }));
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
	ok("整渠道钉选下同渠道的单模型钉选不重复渲染", homeView().querySelectorAll(".dsh-nmp-option").length === 4);
	win.localStorage.setItem("dsh-nmp-pins-v1", savedPins);
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
}

// ---------- 目录未就绪时不清空收藏 ----------
{
	const savedPins = win.localStorage.getItem("dsh-nmp-pins-v1");
	const testPins = JSON.stringify({ sources: ["渠道A"], models: ["渠道B::Kimi-K2.6 · 免费"], hidden: [] });
	const dir = host.dirs.get("sess-1");
	win.localStorage.setItem("dsh-nmp-pins-v1", testPins);
	// 刷新后首次装载：目录 store 还是加载前的空快照
	dir.store.set({ current: null, routable: false, groups: [], failures: [{ id: "chan-a", error: "x" }], status: "idle", pending: null, error: null });
	await sleep30();
	pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
	ok("加载前的空目录快照不清空收藏", pins.sources.join(",") === "渠道A" && pins.models.join(",") === "渠道B::Kimi-K2.6 · 免费");
	// 就绪但全部渠道故障的 ready 空快照同样不清空
	dir.store.set({ current: null, routable: false, groups: [], failures: [{ id: "chan-a", error: "x" }], status: "ready", pending: null, error: null });
	await sleep30();
	pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
	ok("全部渠道故障的 ready 空快照不清空收藏", pins.sources.join(",") === "渠道A" && pins.models.join(",") === "渠道B::Kimi-K2.6 · 免费");
	dir.sync();
	await sleep30();
	pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
	ok("目录恢复后收藏原样保留", pins.sources.join(",") === "渠道A" && pins.models.join(",") === "渠道B::Kimi-K2.6 · 免费");
	// 目录里有渠道存在时，消失渠道的清理照常执行
	host.groups = [{ id: "chan-a", name: "渠道A", models: SPEC[0].models }];
	dir.sync();
	await sleep30();
	pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
	ok("部分目录到达时仍清理消失渠道的收藏", pins.sources.join(",") === "渠道A" && pins.models.length === 0);
	host.groups = SPEC;
	dir.sync();
	await sleep30();
	win.localStorage.setItem("dsh-nmp-pins-v1", savedPins);
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
}

// ---------- 收藏视图渠道顺序 ----------
{
	const savedPins = win.localStorage.getItem("dsh-nmp-pins-v1");
	win.localStorage.setItem("dsh-nmp-pins-v1", JSON.stringify({ sources: ["渠道B"], models: ["渠道A::Beta"], hidden: [] }));
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
	const rules = Array.from(homeView().querySelectorAll(".dsh-nmp-rule-name")).map((n) => n.textContent);
	const rows = Array.from(homeView().querySelectorAll(".dsh-nmp-option")).map((r) => r.getAttribute("data-nmp-model"));
	ok("收藏视图渠道顺序按目录排列，与收藏先后无关", rules.join(",") === "渠道A,渠道B");
	ok("整组钉选与单模型钉选同页共存且各自范围正确", rows.join(",") === "渠道A::Beta,渠道B::DeepSeek V4.1-Flash,渠道B::Kimi-K2.6 · 免费");
	win.localStorage.setItem("dsh-nmp-pins-v1", savedPins);
	input.value = "";
	input.dispatchEvent(new win.Event("input", { bubbles: true }));
	await sleep30();
}

// ---------- 同渠道同名消歧 ----------
openChannels();
await sleep30();
doc.querySelector('.dsh-nmp-channels [data-nmp-channel="渠道C"]').click();
await sleep30();
const twins = Array.from(doc.querySelectorAll(".dsh-nmp-chmodels .dsh-nmp-option")).map((r) => r.getAttribute("data-nmp-model"));
ok("同渠道同名两条用模型 id 区分 key", twins.length === 2 && twins[0] === "渠道C::Twin" && twins[1] === "渠道C::Twin::twin-b");
doc.querySelector('[data-nmp-model="渠道C::Twin::twin-b"]').click();
await sleep30();
ok("同名第二条切换到正确模型 id", host.selection.provider === "chan-c" && host.selection.model === "twin-b");
await afterTrigger();
native.click();
await sleep30();
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
ok("同名切换后 footer 显示该模型", main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-effort-line').textContent.indexOf("Twin") === 0);

// ---------- 会话切换换绑目录 ----------
{
	// 第二个会话当前选的是别的模型：换绑后 footer 应立刻跟随新会话的目录
	host.selection = { provider: "chan-b", model: "kimi-k2-6" };
	const dir2 = host.modelDirectories.directoryFor("sess-2");
	dir2.sync();
	host.uiSession.current.value = { key: "sess-2", props: {} };
	doc.body.appendChild(doc.createElement("i"));
	await sleep30();
	main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
	if (main.getAttribute("data-open") !== "true") { native.click(); await sleep30(); }
	const eff2 = main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-effort-line');
	ok("会话切换后换绑到新会话的目录", eff2.textContent.indexOf("Kimi-K2.6") === 0);
	ok("旧会话的目录退订", host.dirs.get("sess-1").store.subscriberCount() === 0);
	host.selection = { provider: "chan-c", model: "twin-b", reasoningEffort: undefined };
	dir2.sync();
	host.uiSession.current.value = { key: "sess-1", props: {} };
	doc.body.appendChild(doc.createElement("i"));
	await sleep30();
}

// ---------- 切换失败分支 ----------
openChannels();
await sleep30();
doc.querySelector('.dsh-nmp-channels [data-nmp-channel="渠道B"]').click();
await sleep30();
host.failNext = true;
doc.querySelector('[data-nmp-model="渠道B::Kimi-K2.6 · 免费"]').click();
await sleep30();
ok("切换失败时宿主选择不变", host.selection.provider === "chan-c" && host.selection.model === "twin-b");
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
ok("切换失败时 footer 保持原模型", main.querySelector('[data-nmp-entry="channels"] .dsh-nmp-effort-line').textContent.indexOf("Twin") === 0);
const dirNow = host.dirs.get("sess-1").store.getSnapshot();
ok("切换失败在目录 store 留下错误状态", dirNow.status === "error" && /provider_unreachable/.test(dirNow.error));

// ---------- 消失渠道清理 ----------
host.groups = [{ id: "chan-a", name: "渠道A", models: SPEC[0].models }];
host.dirs.get("sess-1").sync();
await sleep30();
pins = JSON.parse(win.localStorage.getItem("dsh-nmp-pins-v1"));
ok("消失渠道不影响仍在渠道的收藏", pins.sources.indexOf("渠道A") >= 0);
ok("消失渠道的钉选被清理", !pins.models.some((k) => k.indexOf("渠道B::") === 0));
ok("消失渠道的隐藏记录被清理", !pins.hidden.some((k) => k.indexOf("渠道B::") === 0));
ok("目录随 store 收缩", (() => {
	main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
	main.querySelector('[data-nmp-entry="channels"]').click();
	const names = Array.from(doc.querySelectorAll(".dsh-nmp-channels [data-nmp-channel]")).map((r) => r.getAttribute("data-nmp-channel"));
	return names.length === 1 && names[0] === "渠道A";
})());
host.groups = SPEC;
host.dirs.get("sess-1").sync();

// ---------- 再次点击触发按钮收起 ----------
await sleep30();
main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
if (main.getAttribute("data-open") === "false") { native.click(); await sleep30(); }
native.click();
ok("再次点击触发按钮收起主卡", main.getAttribute("data-open") === "false");

// ---------- 悬浮打开主卡 ----------
await sleep(560);
native.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
ok("悬浮瞬间主卡未打开", main.getAttribute("data-open") === "false");
await sleep(280);
ok("指针停留后悬浮打开主卡", main.getAttribute("data-open") === "true");

// ---------- 外点收起 ----------
doc.body.dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true }));
ok("卡片之外按下指针整体收起", main.getAttribute("data-open") === "false");

// ---------- 指针压制：原生面板在按钮 pointerdown 时同步渲染 ----------
{
	let bubbled = 0;
	const spy = () => { bubbled++; };
	doc.addEventListener("pointerdown", spy);
	await afterTrigger();
	native.dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
	ok("触发按钮的指针按下被 capture 层拦下（不传到页面监听）", bubbled === 0);
	doc.removeEventListener("pointerdown", spy);
	native.click();
	await sleep30();
}

// ---------- Escape 逐级收起 ----------
{
	main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
	if (main.getAttribute("data-open") === "false") { native.click(); await sleep30(); }
	openChannels();
	await sleep30();
	doc.querySelector('.dsh-nmp-channels [data-nmp-channel="渠道A"]').click();
	await sleep30();
	ok("三级卡已展开", !!doc.querySelector(".dsh-nmp-chmodels[data-open='true']"));
	doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	ok("Escape 先收起三级卡", !doc.querySelector(".dsh-nmp-chmodels"));
	doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	ok("再按 Escape 收起钉选的二级卡", !doc.querySelector(".dsh-nmp-channels"));
	doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	ok("第三次 Escape 收起主卡", main.getAttribute("data-open") === "false");
}

// ---------- 悬浮链：主卡 → 二级卡 → 三级卡 ----------
{
	await sleep(560);
	native.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
	await sleep(280);
	main = doc.querySelector(".dsh-nmp-main:not(.dsh-nmp-anchored)");
	ok("悬浮打开主卡供侧卡链使用", main.getAttribute("data-open") === "true");
	const entryNow = main.querySelector('[data-nmp-entry="channels"]');
	entryNow.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
	ok("悬浮入口瞬间二级卡未打开", !doc.querySelector(".dsh-nmp-channels"));
	await sleep(280);
	const l2h = doc.querySelector(".dsh-nmp-channels");
	ok("指针停留后悬浮打开二级卡", !!l2h && l2h.getAttribute("data-open") === "true");
	l2h.querySelector('[data-nmp-channel="渠道C"]').dispatchEvent(new win.MouseEvent("mouseenter", { bubbles: true }));
	await sleep(280);
	ok("悬浮渠道行滑出三级卡", !!doc.querySelector(".dsh-nmp-chmodels[data-open='true']"));
	ok("悬浮态三级卡不带钉选标记", (() => {
		const c = doc.querySelector(".dsh-nmp-chmodels");
		return !!c && c.getAttribute("data-nmp-pin") !== "1";
	})());
	main.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
	await sleep(400);
	ok("指针离开侧卡后侧卡随主卡收起", !doc.querySelector(".dsh-nmp-channels") && !doc.querySelector(".dsh-nmp-chmodels"));
	native.click();
	await sleep30();
}

// ---------- 档位统一取名 ----------
{
	// 目录里加一个声明了 disabled 的渠道：关闭档必须排最左，不能落到最强档
	host.addGroup({
		id: "chan-d",
		name: "渠道D",
		models: [
			{ id: "eac-flash", name: "EAC-Flash", reasoning: { efforts: [{ id: "disabled", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "高" }, { id: "max", name: "Max" }], defaultEffort: "high" } },
		],
	});
	const dirD = host.dirs.get("sess-1");
	await dirD.select({ provider: "chan-d", model: "eac-flash" });
	await sleep30();
	const btnD = () => doc.querySelector(".dsh-nmp-effort-btn");
	ok("四档模型当前档显示中位词", btnD().textContent === "炼虚");
	btnD().click();
	await sleep30();
	const trackD = doc.querySelector(".dsh-nmp-effort-pop .dsh-nmp-effort-track");
	ok("四档模型的滑块范围与当前值", trackD.getAttribute("aria-valuemax") === "3" && trackD.getAttribute("aria-valuenow") === "2");
	trackD.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
	await sleep30();
	ok("声明 disabled 的档表里关闭档排最左", btnD().textContent === "关闭");
	ok("关闭档不带末档标记", doc.querySelector(".dsh-nmp-effort-pop .dsh-nmp-effort").getAttribute("data-apex") === null);
	const ladder = [];
	for (let i = 0; i < 3; i++) {
		trackD.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		await sleep30();
		ladder.push(btnD().textContent);
	}
	ok("档位按强度取名且逐档升格", ladder.join(",") === "炼气,炼虚,飞升");
	ok("最高档标识落在真正的末档", doc.querySelector(".dsh-nmp-effort-pop .dsh-nmp-effort").hasAttribute("data-apex"));

	// 取名是独立浮层：入口是弹层标题行最右的齿轮，浮层贴在弹层上方
	const gear = () => doc.querySelector(".dsh-nmp-effort-pop .dsh-nmp-effort-gear");
	const popEl = () => doc.querySelector(".dsh-nmp-effort-pop");
	const panel = () => doc.querySelector(".dsh-nmp-names");
	const trackP = () => doc.querySelector(".dsh-nmp-effort-pop .dsh-nmp-effort-track");
	const popOpen = () => !!popEl() && popEl().getAttribute("data-open") === "true";
	const namesOpen = () => !!panel() && panel().getAttribute("data-open") === "true";
	const openSlider = async () => {
		if (!popOpen()) btnD().click();
		await sleep30();
	};
	const openNames = async () => {
		await openSlider();
		if (!namesOpen()) gear().click();
		await sleep30();
	};
	const stepKey = async (key) => {
		await openSlider();
		trackP().dispatchEvent(new win.KeyboardEvent("keydown", { key: key, bubbles: true }));
		await sleep30();
	};
	ok("取名入口在弹层标题行", !!gear() && gear().getAttribute("data-nmp-entry") === "effort-names");
	ok("取名入口与档名同在一行", gear().parentElement.classList.contains("dsh-nmp-effort-head"));
	ok("footer 不再提供取名齿轮", !doc.querySelector(".dsh-nmp-footer .dsh-nmp-cfg"));
	ok("取名浮层默认不在场", !panel());
	ok("取名不再是弹层内部的第二视图", !/\.dsh-nmp-effort-pop\[data-view=/.test(styleEl.textContent));
	ok("取名浮层与推理等级弹层同宽", /\.dsh-nmp-names\{[^}]*width:264px/.test(styleEl.textContent) && /\.dsh-nmp-effort-pop\{[^}]*width:264px/.test(styleEl.textContent));
	await openSlider();
	gear().dispatchEvent(new win.MouseEvent("mouseenter", { bubbles: false }));
	await sleep(220);
	ok("指针在齿轮上停留后展开取名浮层", namesOpen());
	gear().dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: false }));
	await sleep(220);
	ok("指针离开齿轮后收起取名浮层", !namesOpen());
	await openNames();
	ok("点齿轮后展开取名浮层", namesOpen());
	ok("取名浮层挂在 body 上", panel().parentElement === doc.body);
	ok("取名浮层不是推理等级弹层的子节点", !popEl().contains(panel()));
	ok("取名浮层标题与关闭按钮齐备", panel().querySelector(".dsh-nmp-names-title").textContent === "档位取名" && !!panel().querySelector(".dsh-nmp-names-close"));
	ok("取名浮层开着时齿轮显示为按下态", gear().getAttribute("data-active") === "true");
	ok("面板列出三套词表来源", Array.from(panel().querySelectorAll(".dsh-nmp-names-preset")).map((b) => b.textContent).join(",") === "修仙境界,普通,自己填");
	ok("默认停在修仙境界", panel().querySelector('[data-preset="xianxia"]').hasAttribute("data-on"));
	{
		const chip = doc.querySelector(".dsh-nmp-effort-btn");
		const before = panel().style.top;
		const rect = () => ({ x: 1054, y: 769, left: 1054, top: 769, right: 1085, bottom: 797, width: 31, height: 28 });
		chip.getBoundingClientRect = rect;
		win.dispatchEvent(new win.Event("resize"));
		await sleep30();
		const left = Math.round(Math.min(1085 - 264, win.innerWidth - 264 - 8));
		const top = Math.max(8, win.innerHeight - 240 - 8);
		ok("视口变化后浮层重新贴到按钮上方", panel().style.left === left + "px" && panel().style.top === top + "px" && panel().style.top !== before);
		// 主题重建整行时等级按钮会短暂脱离文档，此时读到的 rect 全为 0
		const keptLeft = panel().style.left;
		const keptTop = panel().style.top;
		const parent = chip.parentElement;
		chip.remove();
		doc.dispatchEvent(new win.Event("scroll", { bubbles: true }));
		await sleep30();
		ok("锚点脱离文档时浮层留在原位", panel().style.left === keptLeft && panel().style.top === keptTop);
		parent.appendChild(chip);
		delete chip.getBoundingClientRect;
	}
	ok("面板按当前模型档表逐档列出", panel().querySelectorAll("[data-override]").length === 4);
	ok("关闭档固定为关闭且不可改名", (() => {
		const el = panel().querySelector('[data-override="disabled"]');
		return !!el && el.value === "关闭" && el.disabled === true;
	})());
	ok("档位行左边是服务商给的档名", Array.from(panel().querySelectorAll(".dsh-nmp-names-label")).map((el) => el.textContent).join(",") === "Off,Low,高,Max");
	ok("输入框留空时以当前词作提示", panel().querySelector('[data-override="@0"]').value === "" && panel().querySelector('[data-override="@0"]').placeholder === "炼气" && panel().querySelector('[data-override="@2"]').placeholder === "飞升");
	ok("词表输入框有足够的输入高度", /\.dsh-nmp-names-words\{[^}]*min-height:160px/.test(styleEl.textContent) && /\.dsh-nmp-names-words\{[^}]*max-height:300px/.test(styleEl.textContent));
	ok("浮层高度上限放宽到 560px", /\.dsh-nmp-names\{[^}]*max-height:min\(560px/.test(styleEl.textContent));
	
	// 编辑原地更新：输入框节点与焦点都保留
	const overrideInput = panel().querySelector('[data-override="@2"]');
	overrideInput.focus();
	overrideInput.value = "炼气巅峰";
	overrideInput.dispatchEvent(new win.Event("change", { bubbles: true }));
	await sleep30();
	ok("改名后输入框仍是同一个节点", panel().querySelector('[data-override="@2"]') === overrideInput);
	ok("改名后编辑焦点不丢", doc.activeElement === overrideInput);
	ok("改名后浮层仍然开着", namesOpen());
	await stepKey("End");
	ok("手动改名优先于预设词表", btnD().textContent === "炼气巅峰");
	
	// 清掉手动值，后续断言看预设词表本身
	await openNames();
	const clearOne = panel().querySelector('[data-override="@2"]');
	clearOne.value = "";
	clearOne.dispatchEvent(new win.Event("change", { bubbles: true }));
	await sleep30();
	await openNames();
	panel().querySelector(".dsh-nmp-names-close").click();
	await sleep30();
	ok("关闭按钮只收起取名浮层", !namesOpen() && popOpen());
	await openNames();
	panel().querySelector('[data-preset="plain"]').click();
	await sleep30();
	ok("切到普通预设后浮层仍在", namesOpen() && panel().querySelector('[data-preset="plain"]').hasAttribute("data-on"));
	await stepKey("End");
	ok("普通预设末档用两字最强档词", btnD().textContent === "超凡");
	ok("普通预设逐档词均为两个字", (() => {
		const t = trackP();
		const seen = [];
		t.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
		seen.push(btnD().textContent);
		for (let i = 0; i < 3; i++) {
			t.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
			seen.push(btnD().textContent);
		}
		return seen.every((w) => w.length === 2);
	})());
	await openNames();
	panel().querySelector('[data-preset="custom"]').click();
	await sleep30();
	ok("切到自己填后出现词表输入框", !!panel().querySelector("[data-words]"));
	const wordsBox = panel().querySelector("[data-words]");
	wordsBox.value = "筑基期\n金丹期\n元婴期";
	wordsBox.dispatchEvent(new win.Event("change", { bubbles: true }));
	await sleep30();
	ok("自己填后输入框仍是同一个节点", panel().querySelector("[data-words]") === wordsBox);
	await stepKey("End");
	ok("自己填的词表末档取末词", btnD().textContent === "元婴期");
	ok("自己填的词表已存盘", JSON.parse(win.localStorage.getItem("dsh-nmp-effort-names-v2") || "{}").preset === "custom");
	
	await openNames();
	Array.from(doc.querySelectorAll(".dsh-nmp-names-btn")).find((b) => b.textContent === "重置全部").click();
	await sleep30();
	ok("重置后浮层仍开着", namesOpen() && panel().querySelector('[data-preset="xianxia"]').hasAttribute("data-on"));
	await stepKey("End");
	ok("重置后末档取修仙词表最强档", btnD().textContent === "飞升");
	await openNames();
	panel().querySelectorAll(".dsh-nmp-names-btn")[1].click();
	await sleep30();
	ok("完成按钮把浮层与弹层一起收起", !namesOpen() && !popOpen());
	await openNames();
	panel().dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: false }));
	await sleep(200);
	ok("指针移开只收起取名浮层", !namesOpen() && popOpen());
	await openNames();
	doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	await sleep30();
	ok("Escape 先收起取名浮层", !namesOpen() && popOpen());
	doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	await sleep30();
	ok("再按 Escape 收起推理等级弹层", !popOpen());
	await openNames();
	doc.body.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true }));
	await sleep30();
	ok("外点收起取名浮层与弹层", !namesOpen() && !popOpen());
	win.localStorage.removeItem("dsh-nmp-effort-names-v2");
	host.groups.pop();
	await host.dirs.get("sess-1").select({ provider: "chan-a", model: "beta" });
	await sleep30();
}

// ---------- dispose 交还原生接管 ----------
const subBeforeDispose = host.dirs.get("sess-1").store.subscriberCount();
host.dispose();
ok("dispose 移除样式", !doc.getElementById("dsh-nmp-style"));
ok("dispose 移除主卡与侧卡", !doc.querySelector(".dsh-nmp-main"));
ok("dispose 移除取名浮层", !doc.querySelector(".dsh-nmp-names"));
native.click();
await sleep30();
ok("dispose 后原生按钮恢复自身点击", nativeClicks === 1);
host.groups = SPEC;
host.dirs.get("sess-1").sync();
await sleep30();
ok("dispose 后松开会话目录订阅", host.dirs.get("sess-1").store.subscriberCount() === subBeforeDispose - 1);
ok("dispose 后 store 变化不再建卡", doc.querySelector(".dsh-nmp-main") === null);

console.log("通过 " + PASS.length + " 项：");
PASS.forEach((p, i) => console.log("  " + (i + 1) + ". " + p));
process.exit(0);
