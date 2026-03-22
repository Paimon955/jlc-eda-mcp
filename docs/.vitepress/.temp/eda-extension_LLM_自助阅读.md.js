import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Docs（LLM 自助阅读）","description":"","frontmatter":{},"headers":[],"relativePath":"eda-extension/LLM_自助阅读.md","filePath":"eda-extension/LLM_自助阅读.md","lastUpdated":null}');
const _sfc_main = { name: "eda-extension/LLM_自助阅读.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="docs-llm-自助阅读" tabindex="-1">Docs（LLM 自助阅读） <a class="header-anchor" href="#docs-llm-自助阅读" aria-label="Permalink to &quot;Docs（LLM 自助阅读）&quot;">​</a></h1><p>本目录是给 LLM 自助阅读的本地文档集合（包含 skills）。</p><p>建议阅读顺序：</p><ul><li>新接入/零上下文：<code>welcome_new_agent.md</code></li><li>然后从 skills 开始：<code>../skills/Repo-local-skills.md</code>、<code>../skills/jlceda-eda-rest/SKILL.md</code></li></ul><p>说明：</p><ul><li><strong>推荐 websocat 短驻方案</strong>：只提供 WS（不带 HTTP），因此不会自动出现 <code>http://127.0.0.1:9050/docs/</code> 这样的静态站点入口。</li><li>如需 <code>/docs</code> 静态入口，只能使用 legacy <code>packages/mcp-server --http</code>（计划废弃）。</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("eda-extension/LLM_自助阅读.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const LLM_____ = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  LLM_____ as default
};
