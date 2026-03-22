import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"原理图绘图偏好（MCP）","description":"","frontmatter":{},"headers":[],"relativePath":"SCHEMATIC_STYLE.md","filePath":"SCHEMATIC_STYLE.md","lastUpdated":1766840491000}');
const _sfc_main = { name: "SCHEMATIC_STYLE.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="原理图绘图偏好-mcp" tabindex="-1">原理图绘图偏好（MCP） <a class="header-anchor" href="#原理图绘图偏好-mcp" aria-label="Permalink to &quot;原理图绘图偏好（MCP）&quot;">​</a></h1><p>本文件记录当前项目的“原理图绘制风格/偏好”，用于约束 MCP 自动化绘图与后续增量修改的输出，使原理图<strong>更可读、可审查、便于采购</strong>。</p><h2 id="_1-元件与属性-采购优先" tabindex="-1">1) 元件与属性（采购优先） <a class="header-anchor" href="#_1-元件与属性-采购优先" aria-label="Permalink to &quot;1) 元件与属性（采购优先）&quot;">​</a></h2><ul><li>放置/更新器件时，尽量同步填写元件的 <strong>Value/值</strong>（如：<code>5.1k</code>、<code>10uF</code>、<code>3.3V LDO</code> 型号/料号等），减少 DRC “值为空”的信息提示。</li><li>优先使用嘉立创 EDA 自带库（可标准化/可采购），避免引入来源不明的符号导致后期替换成本。</li><li>需要保留可追溯信息时，尽量保持库关联字段一致（避免 “属性与供应商编号不匹配”）；若确实需要改值/改型号，应同步相关属性（后续通过 MCP 增加 <code>set_properties</code> 工具支持）。</li></ul><h2 id="_2-布局与可读性" tabindex="-1">2) 布局与可读性 <a class="header-anchor" href="#_2-布局与可读性" aria-label="Permalink to &quot;2) 布局与可读性&quot;">​</a></h2><ul><li><strong>模块化分区</strong>：按功能块分组（如：USB 供电、LDO、电源输出、MCU/芯片本体等），模块之间留白，便于人类审查。</li><li><strong>元件分散</strong>：避免所有元件挤在一起；同一模块内器件靠近但不堆叠。</li><li><strong>走线避让</strong>：导线尽量不压到元件符号/文字上；跨区域长导线尽量避免。</li></ul><h2 id="_3-网络连接策略-优先网络标签" tabindex="-1">3) 网络连接策略（优先网络标签） <a class="header-anchor" href="#_3-网络连接策略-优先网络标签" aria-label="Permalink to &quot;3) 网络连接策略（优先网络标签）&quot;">​</a></h2><ul><li><strong>跨模块优先使用“网络标签（Net Label）”连接</strong>，而不是用长导线跨越整个页面。</li><li>供电入口/出口应在模块边界处引出清晰的网络标签： <ul><li>USB 供电侧引出 <code>VBUS</code>、<code>GND</code>（必要时还包括 <code>CC1</code>、<code>CC2</code> 等信号）。</li><li>下游芯片/模块同样在对应引脚处引出同名网络标签（如 <code>VBUS</code>、<code>3V3</code>、<code>GND</code>），形成“标签对标签”的连接，图面更简洁。</li></ul></li><li>注意区分：<strong>网络标签（Net Label）≠ 网络端口（Net Port）</strong>。当前项目偏好使用网络标签。 <ul><li>在实现上，网络标签等效于导线的 <code>NET</code> 属性（类似 EDA 中 Alt+N 的效果）。</li><li>MCP 侧应优先使用 <code>jlc.schematic.netlabel.attach_pin</code> 来生成网络标签，避免误用 netPort 元件。</li></ul></li><li><strong>避免重复标签</strong>：同一个连接点不应出现多个相同的网络标签（例如重复的 <code>VCC</code>/<code>GND</code>）。</li></ul><h2 id="_4-走线规范-尽量规整" tabindex="-1">4) 走线规范（尽量规整） <a class="header-anchor" href="#_4-走线规范-尽量规整" aria-label="Permalink to &quot;4) 走线规范（尽量规整）&quot;">​</a></h2><ul><li>走线风格优先 Manhattan（直角折线），必要时再用直线。</li><li>线段端点应落在引脚端点附近，避免穿过符号边框或遮挡注释文字。</li><li>对重复/未使用的引脚： <ul><li>若应并网（如 Type‑C 的重复 <code>VBUS/GND</code> 脚），则连接到对应网络；</li><li>若明确不使用，则放置“非连接标识（NC）”以消除悬空告警。</li></ul></li></ul><h2 id="_5-验收期望-自动化应尽量达到" tabindex="-1">5) 验收期望（自动化应尽量达到） <a class="header-anchor" href="#_5-验收期望-自动化应尽量达到" aria-label="Permalink to &quot;5) 验收期望（自动化应尽量达到）&quot;">​</a></h2><ul><li>DRC：无致命错误/错误；警告尽量可解释且最小化（例如明确的 NC 允许存在）。</li><li>网表/连通性：<code>verify_netlist</code>（或兜底 <code>verify_nets</code>）应能验证关键网络归属正确。</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("SCHEMATIC_STYLE.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const SCHEMATIC_STYLE = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  SCHEMATIC_STYLE as default
};
