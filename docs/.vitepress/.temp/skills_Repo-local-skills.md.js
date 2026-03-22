import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Repo-local skills","description":"","frontmatter":{},"headers":[],"relativePath":"skills/Repo-local-skills.md","filePath":"skills/Repo-local-skills.md","lastUpdated":null}');
const _sfc_main = { name: "skills/Repo-local-skills.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="repo-local-skills" tabindex="-1">Repo-local skills <a class="header-anchor" href="#repo-local-skills" aria-label="Permalink to &quot;Repo-local skills&quot;">​</a></h1><p>这些 skills 用来把“如何驱动嘉立创 EDA Pro（通过 <code>jlceda-eda-mcp</code> 桥接）”固化成可复用流程，方便 LLM 侧在 <strong>不安装 Node/MCP</strong> 的前提下，直接通过 <strong>WebSocket RPC + websocat（短驻）</strong> 调用 <code>jlc.*</code> 工具与 <code>eda.*</code> 透传能力。</p><p>新接入/零上下文建议先看：<code>../eda-extension/welcome_new_agent.md</code></p><h2 id="skills" tabindex="-1">Skills <a class="header-anchor" href="#skills" aria-label="Permalink to &quot;Skills&quot;">​</a></h2><ul><li><code>jlceda-eda-rest</code>：推荐走 <code>websocat</code> 作为本机 WS 服务端（短驻/按需启动），通过 <code>tools.call</code> 调用全部 <code>jlc.*</code> tools；也可直接调用扩展 RPC（<code>ping/getStatus/eda.invoke/...</code>）</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("skills/Repo-local-skills.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const RepoLocalSkills = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  RepoLocalSkills as default
};
