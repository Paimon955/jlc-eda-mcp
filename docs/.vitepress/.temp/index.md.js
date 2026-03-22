import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"JLC EDA MCP","description":"","frontmatter":{"title":"JLC EDA MCP"},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":null}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="jlc-eda-mcp" tabindex="-1">JLC EDA MCP <a class="header-anchor" href="#jlc-eda-mcp" aria-label="Permalink to &quot;JLC EDA MCP&quot;">​</a></h1><p>在 <strong>嘉立创EDA 专业版本地客户端</strong> 中通过“扩展 + 本机服务”桥接，把 EDA 能力暴露为一组 <code>jlc.*</code> 工具，供 LLM 自动化完成原理图的 <strong>读取 / 局部编辑 / 增补绘制 / 导出</strong> 等工作。</p><h2 id="快速开始" tabindex="-1">快速开始 <a class="header-anchor" href="#快速开始" aria-label="Permalink to &quot;快速开始&quot;">​</a></h2><ul><li><a href="./BRIDGE_QUICKSTART.html">Bridge Quickstart</a></li><li><a href="./SETUP.html">Setup</a></li><li><a href="./PROTOCOL.html">Protocol</a></li><li><a href="./EDA_EXTENSION_RPC.html">EDA Extension RPC</a></li><li><a href="./MCP_TOOLS.html">MCP Tools</a></li></ul><h2 id="skills-给-ai-的上手文档" tabindex="-1">Skills / 给 AI 的上手文档 <a class="header-anchor" href="#skills-给-ai-的上手文档" aria-label="Permalink to &quot;Skills / 给 AI 的上手文档&quot;">​</a></h2><ul><li><a href="./eda-extension/welcome_new_agent.html">Welcome New Agent</a></li><li><a href="./eda-extension/LLM_自助阅读.html">LLM 自助阅读</a></li><li><a href="./skills/Repo-local-skills.html">Repo-local skills</a></li><li><a href="./skills/jlceda-eda-rest/SKILL.html">jlceda-eda-rest</a></li></ul><h2 id="原理图即代码-schematic-as-code" tabindex="-1">原理图即代码（Schematic-as-Code） <a class="header-anchor" href="#原理图即代码-schematic-as-code" aria-label="Permalink to &quot;原理图即代码（Schematic-as-Code）&quot;">​</a></h2><ul><li><a href="./SCHEMATIC_IR.html">Schematic IR</a></li><li><a href="./SCHEMATIC_AS_CODE_PLAN.html">Schematic-as-Code Plan</a></li><li><a href="./SCHEMATIC_AS_CODE_DEMO.html">Schematic-as-Code Demo</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
