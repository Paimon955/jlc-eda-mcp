import { defineConfig } from 'vitepress';

export default defineConfig({
	lang: 'zh-CN',
	title: 'JLC EDA MCP',
	description: 'Bridge JLCEDA Pro local client to an Agent/LLM via WebSocket + tools.',
	base: '/jlc-eda-mcp/',
	lastUpdated: true,
	themeConfig: {
		nav: [
			{ text: '开始', link: '/' },
			{ text: '快速开始', link: '/BRIDGE_QUICKSTART' },
			{ text: '协议', link: '/PROTOCOL' },
			{ text: 'Tools', link: '/MCP_TOOLS' },
			{ text: 'Skills', link: '/skills/Repo-local-skills' },
		],
		sidebar: [
			{
				text: '开始',
				items: [
					{ text: '概览', link: '/' },
					{ text: 'Bridge Quickstart', link: '/BRIDGE_QUICKSTART' },
					{ text: 'Setup', link: '/SETUP' },
					{ text: 'Uninstall', link: '/UNINSTALL' },
				],
			},
			{
				text: '协议与工具',
				items: [
					{ text: 'WebSocket Protocol', link: '/PROTOCOL' },
					{ text: 'EDA Extension RPC', link: '/EDA_EXTENSION_RPC' },
					{ text: 'MCP Tools', link: '/MCP_TOOLS' },
				],
			},
			{
				text: '原理图 / Schematic IR',
				items: [
					{ text: 'Schematic IR', link: '/SCHEMATIC_IR' },
					{ text: 'Schematic Style', link: '/SCHEMATIC_STYLE' },
					{ text: 'Verify Nets', link: '/VERIFY_NETS' },
				],
			},
			{
				text: 'Schematic-as-Code',
				items: [
					{ text: 'Plan', link: '/SCHEMATIC_AS_CODE_PLAN' },
					{ text: 'Demo', link: '/SCHEMATIC_AS_CODE_DEMO' },
				],
			},
			{
				text: '给 AI 的阅读入口',
				items: [
					{ text: 'Welcome New Agent', link: '/eda-extension/welcome_new_agent' },
					{ text: 'LLM 自助阅读', link: '/eda-extension/LLM_自助阅读' },
				],
			},
			{
				text: 'Skills',
				items: [
					{ text: 'Repo-local skills', link: '/skills/Repo-local-skills' },
					{ text: 'jlceda-eda-rest', link: '/skills/jlceda-eda-rest/SKILL' },
					{ text: '01 区域选取', link: '/skills/jlceda-eda-rest/docs/01-region-select' },
					{ text: '02 读取选区', link: '/skills/jlceda-eda-rest/docs/02-region-read' },
					{ text: '03 编辑选区', link: '/skills/jlceda-eda-rest/docs/03-region-edit' },
					{ text: '04 性能与稳定', link: '/skills/jlceda-eda-rest/docs/04-performance' },
					{ text: '05 HTTP Proxy（Legacy）', link: '/skills/jlceda-eda-rest/docs/05-http-proxy' },
					{ text: '10 RPC 基础', link: '/skills/jlceda-eda-rest/docs/10-rpc-basics' },
					{ text: '11 RPC 文档', link: '/skills/jlceda-eda-rest/docs/11-rpc-document' },
					{ text: '12 RPC 网表', link: '/skills/jlceda-eda-rest/docs/12-rpc-netlist' },
					{ text: '13 RPC 器件库', link: '/skills/jlceda-eda-rest/docs/13-rpc-library' },
					{ text: '14 RPC 原理图编辑', link: '/skills/jlceda-eda-rest/docs/14-rpc-schematic-edit' },
					{ text: '15 RPC applyIr', link: '/skills/jlceda-eda-rest/docs/15-rpc-schematic-apply-ir' },
					{ text: '16 RPC inspect', link: '/skills/jlceda-eda-rest/docs/16-rpc-inspect' },
					{ text: '17 RPC EDA 透传', link: '/skills/jlceda-eda-rest/docs/17-rpc-eda-passthrough' },
					{ text: '20 Tools 基础', link: '/skills/jlceda-eda-rest/docs/20-tools-basics' },
					{ text: '21 Tools EDA 透传', link: '/skills/jlceda-eda-rest/docs/21-tools-eda-passthrough' },
					{ text: '22 Tools 文档/导出', link: '/skills/jlceda-eda-rest/docs/22-tools-document-view' },
					{ text: '23 Tools 网表', link: '/skills/jlceda-eda-rest/docs/23-tools-netlist' },
					{ text: '24 Tools 器件库', link: '/skills/jlceda-eda-rest/docs/24-tools-library' },
					{ text: '25 Tools inspect', link: '/skills/jlceda-eda-rest/docs/25-tools-schematic-inspect' },
					{ text: '26 Tools 原理图编辑', link: '/skills/jlceda-eda-rest/docs/26-tools-schematic-edit' },
					{ text: '27 Tools IR', link: '/skills/jlceda-eda-rest/docs/27-tools-schematic-ir' },
					{ text: '28 Tools verify', link: '/skills/jlceda-eda-rest/docs/28-tools-verify' },
				],
			},
		],
		socialLinks: [{ icon: 'github', link: 'https://github.com/XuF163/jlc-eda-mcp' }],
		editLink: {
			pattern: 'https://github.com/XuF163/jlc-eda-mcp/edit/master/docs/:path',
			text: 'Edit this page on GitHub',
		},
	},
});

