import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"编辑选区（增补 / 增量更新）","description":"","frontmatter":{},"headers":[],"relativePath":"skills/jlceda-eda-rest/docs/03-region-edit.md","filePath":"skills/jlceda-eda-rest/docs/03-region-edit.md","lastUpdated":null}');
const _sfc_main = { name: "skills/jlceda-eda-rest/docs/03-region-edit.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="编辑选区-增补-增量更新" tabindex="-1">编辑选区（增补 / 增量更新） <a class="header-anchor" href="#编辑选区-增补-增量更新" aria-label="Permalink to &quot;编辑选区（增补 / 增量更新）&quot;">​</a></h1><blockquote><p>目标：在不破坏原图的前提下，对选区进行增补绘制或局部重画；并尽量避免卡死/DRC 误报。</p></blockquote><h2 id="首选-jlc-schematic-apply-ir-做-增补" tabindex="-1">首选：<code>jlc.schematic.apply_ir</code> 做“增补” <a class="header-anchor" href="#首选-jlc-schematic-apply-ir-做-增补" aria-label="Permalink to &quot;首选：\`jlc.schematic.apply_ir\` 做“增补”&quot;">​</a></h2><ul><li><code>apply_ir</code> 支持 upsert（同 id 重跑会 update/replace），适合“反复迭代修改”。</li><li>建议：<code>page.clear=false</code>，只增补不清空。</li><li>推荐流程： <ol><li><code>读取选区</code>（见 <code>docs/02-region-read.md</code>）</li><li>计算一个 <code>DX/DY</code> 偏移（避免覆盖原选区）</li><li><code>apply_ir</code>：先放器件/网标/文本，再分批画导线</li><li><code>jlc.schematic.select</code> 选中新画出来的 primitiveIds 并缩放定位</li></ol></li></ul><h2 id="编辑-已由-apply-ir-管理-的图元" tabindex="-1">编辑“已由 apply_ir 管理”的图元 <a class="header-anchor" href="#编辑-已由-apply-ir-管理-的图元" aria-label="Permalink to &quot;编辑“已由 apply_ir 管理”的图元&quot;">​</a></h2><p>如果某些图元是你之前用 <code>apply_ir</code> 画的（有稳定的 <code>id</code>）：</p><ul><li>更新：再次 <code>apply_ir</code> 发送同一个 <code>id</code>，改坐标/内容即可</li><li>删除：使用 <code>ir.patch.delete</code> 按 <code>id</code> 删除（只对“已记录在 id-&gt;primitiveId map”的图元可靠）</li></ul><h2 id="编辑-非托管-的原生图元-不推荐" tabindex="-1">编辑“非托管”的原生图元（不推荐） <a class="header-anchor" href="#编辑-非托管-的原生图元-不推荐" aria-label="Permalink to &quot;编辑“非托管”的原生图元（不推荐）&quot;">​</a></h2><p>对非 apply_ir 创建的图元，<code>apply_ir</code> 没有映射表，无法安全 upsert。</p><ul><li>若必须改/删：用 <code>jlc.eda.invoke</code> 直接调用 <code>eda.sch_*</code> 原生 API（风险更高、也更容易卡死）</li><li>建议在操作前先导出/保存（<code>jlc.document.export_epro2</code> 或 <code>jlc.schematic.save</code>）</li></ul><h2 id="连接策略-减少重叠-更清晰" tabindex="-1">连接策略（减少重叠/更清晰） <a class="header-anchor" href="#连接策略-减少重叠-更清晰" aria-label="Permalink to &quot;连接策略（减少重叠/更清晰）&quot;">​</a></h2><ul><li>优先打网络标签而不是把长线拉过去： <ul><li><code>jlc.schematic.netlabel.attach_pin</code>（本质是短导线 + Wire.NET，接近 Alt+N）</li></ul></li><li>需要自动走线：<code>jlc.schematic.connect_pins</code>（manhattan / straight）</li><li>复杂连线：用多段 wire，并保持正交，避免交叉重叠</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("skills/jlceda-eda-rest/docs/03-region-edit.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const _03RegionEdit = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  _03RegionEdit as default
};
