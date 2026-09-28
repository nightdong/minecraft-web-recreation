import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const OUT = path.resolve('tests/artifacts');
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'final-verification.json'), 'utf8'));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const suites = report.browserSuites || [{ key: 'browser', report: 'browser-report.json' }, { key: 'interface', report: 'interface-report.json' }];
const reports = suites.map(suite => ({ ...suite, data: report[suite.key] })).filter(suite => suite.data);
const images = [...new Set([...reports.flatMap(suite => suite.data.screenshots || []).map(file => path.basename(file.replaceAll('\\', '/'))), ...(report.interface?.viewportChecks || []).map(view => `interface-${view.width}x${view.height}.png`)])];
for (const image of images) assert.ok(fs.existsSync(path.join(OUT, image)), `Missing actual screenshot: ${image}`);
const passed = report.status === 'passed';
const stages = [...report.stages, ...reports.flatMap(suite => (suite.data.stages || []).map(stage => ({ ...stage, name: `[${suite.key}] ${stage.name}` })))];
const frameRows=(report.performanceAudit?.stages||[]).map(stage=>stage.result).filter(Boolean);
const qualityRows=(report.stress?.stages||[]).flatMap(stage=>Array.isArray(stage.result)?stage.result:[]);
const number=value=>Number.isFinite(value)?value.toFixed(2):'未记录';
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>当前项目 · 实际验收报告</title><style>
body{margin:0;background:#15191d;color:#e2e6e9;font:16px/1.65 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:0}h2{margin:32px 0 12px}p{color:#b6c0c7}.status{display:inline-block;padding:4px 12px;border:1px solid currentColor;color:${passed ? '#a0d690' : '#f39e8c'}}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #384149}th{color:#bdc8cf}code,pre{font-family:ui-monospace,monospace;font-size:13px}pre{overflow:auto;background:#0d1114;padding:16px}a{color:#b0d1e5}figure{margin:0;padding:12px;background:#242b30}img{display:block;width:100%;height:auto;image-rendering:pixelated}figcaption{font-size:13px;padding-top:8px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}details{margin-top:18px}summary{cursor:pointer}.small{font-size:13px}footer{margin-top:32px;padding-top:20px;border-top:1px solid #384149;color:#a6b0b7}
</style><main><h1>Minecraft Web Recreation</h1><p>本页仅展示自动化工具生成的实际结果和截图，不是游戏画面的替代或演示。</p>
<div class="status">完整验收：${escape(report.status)}</div><p class="small">运行：${escape(report.started)} → ${escape(report.finished)}<br>Node：${escape(report.node)}<br>已执行单元与回归测试：${escape(report.unitTests ?? '见原始日志')}；测试文件：${escape(report.unitFiles?.length ?? '见原始日志')}<br>测试目标：${escape(report.testTarget?.kind || '未记录')}；生产 HTML 检查：${report.testTarget?.htmlVerified === true ? '通过' : '未通过/未运行'}</p>
<p class="small">源码结束时校验：${report.hashesVerified?.source ? '一致' : '未完成'}；生产文件结束时校验：${report.hashesVerified?.production ? '一致' : '未完成'}</p>
<h2>实际帧时间审计</h2><p>Chromium / SwiftShader 软件 WebGL，1280×720，均衡画质；下表来自真实 requestAnimationFrame 间隔，而不是CPU函数耗时或预设FPS。生成世界：${number(report.performanceAudit?.worldLoadMs)} ms。每次生成与生物随机状态会引起波动，不构成硬件加速性能承诺。</p><table><thead><tr><th>场景</th><th>帧数</th><th>平均 ms</th><th>P95 ms</th><th>最大 ms</th><th>实际距离 m</th></tr></thead><tbody>${frameRows.map(row=>`<tr><td>${escape(row.name)}</td><td>${row.frames}</td><td>${number(row.averageMs)}</td><td>${number(row.p95Ms)}</td><td>${number(row.maxMs)}</td><td>${number(row.distance)}</td></tr>`).join('')}</tbody></table>
<h2>公开画质设置与压力场景</h2><table><thead><tr><th>画质</th><th>真实帧缓冲</th><th>平均 ms</th><th>P95 ms</th><th>视距 / 粒子上限</th></tr></thead><tbody>${qualityRows.map(row=>`<tr><td>${escape(row.after.quality.preset)}</td><td>${row.buffer.width}×${row.buffer.height}</td><td>${number(row.averageMs)}</td><td>${number(row.p95Ms)}</td><td>${row.after.quality.renderDistance} / ${row.after.quality.particleLimit}</td></tr>`).join('')}</tbody></table>
<details><summary>多怪物、连锁爆炸、真实地下水体、长距离与长期内存原始测量</summary><pre>${escape(JSON.stringify({hostiles:report.hostiles?.stages,stress:report.stress?.stages},null,2))}</pre></details>
${report.storage?`<h2>独立IndexedDB组件回归</h2><p>使用真实浏览器IndexedDB和生产SaveStore类，在独立随机命名测试数据库检查旧版本迁移、只读元数据列表、事务失败回滚、关闭重开和删除。不是向游戏注入存档、物品或位置。</p><pre>${escape(JSON.stringify(report.storage.metrics,null,2))}</pre>`:''}
${report.adventure ? `<h2>冒险验收范围</h2><p>通过公开创造物品目录、真实键盘鼠标完成造门、弓箭摧毁水晶、近战、战斗中途重载、胜利后重载、返回及主世界重载。此项是功能集成验收，不是从空背包开始的完整生存通关记录；生存材料合成、物品消耗和奖励一致性由对应生产代码回归另行检查。</p><p class="small">${escape(report.adventure.scope)}</p>` : ''}
<h2>阶段结果</h2><table><thead><tr><th>阶段</th><th>结果</th><th>退出码 / 耗时</th></tr></thead><tbody>${stages.map(stage => `<tr><td>${escape(stage.name)}</td><td>${escape(stage.status)}</td><td>${stage.exitCode === undefined ? '' : escape(stage.exitCode)}${stage.elapsedMs === undefined ? '' : ` / ${(stage.elapsedMs / 1000).toFixed(2)} s`}</td></tr>`).join('')}</tbody></table>
<h2>窗口尺寸检查</h2><table><thead><tr><th>实际视窗</th><th>界面缩放</th><th>遮挡 / 越界记录</th></tr></thead><tbody>${(report.interface?.viewportChecks || []).map(view => `<tr><td>${view.width} × ${view.height}</td><td>${escape(view.scale)}</td><td>${view.violations.length}</td></tr>`).join('')}</tbody></table>
<h2>实际通关后的结尾界面</h2><p>通过真实出口返回主世界后，在四种视窗检查标题、全部文字、页脚和按钮的可见边界与点击中心；不是直接切换游戏状态生成的画面。</p><table><thead><tr><th>实际视窗</th><th>界面缩放</th><th>裁切 / 点击问题</th></tr></thead><tbody>${(report.adventure?.creditsViewportChecks || []).map(view => `<tr><td>${view.width} × ${view.height}</td><td>${escape(view.scale)}</td><td>${view.violations.length}</td></tr>`).join('')}</tbody></table>
<details><summary>独立结尾组件布局回归（真实生产模板与样式，非实玩证据）</summary><pre>${escape(JSON.stringify(report.interface?.creditsFixtureChecks || [], null, 2))}</pre></details>
<h2>真实截图</h2><div class="gallery">${images.map(image => `<figure><a href="${encodeURIComponent(image)}"><img src="${encodeURIComponent(image)}" alt="${escape(image)}" loading="lazy"></a><figcaption>${escape(image)}</figcaption></figure>`).join('')}</div>
<h2>原始数据</h2><p><a href="final-verification.json">完整报告与源码哈希</a> · <a href="core-tests.log">核心与回归测试输出</a> · <a href="build.log">构建输出</a> · ${reports.map(suite => `<a href="${encodeURIComponent(suite.report)}">${escape(suite.key)} 报告</a>`).join(' · ')}</p>
<details><summary>浏览器错误与警告</summary><pre>${escape(JSON.stringify({ suites: Object.fromEntries(reports.map(suite => [suite.key, { errors: suite.data.errors || [], warnings: suite.data.warnings || [] }])), failure: report.failure }, null, 2))}</pre></details>
<details><summary>本次验收源码 SHA-256</summary><pre>${escape(JSON.stringify(report.sourceFiles, null, 2))}</pre></details>
<footer>通过所列测试不等于覆盖全部游戏状态，也不表示完整复制了官方客户端。首次加载的 JavaScript 主包体积较大；原始 build.log 保留真实构建信息与警告。浏览器测试使用软件 WebGL，不能由其帧率推断所有硬件上的性能。</footer></main></html>`;
fs.writeFileSync(path.join(OUT, 'verification.html'), html);
assert.ok(html.includes('完整验收') && html.includes(report.status));
console.log(`Rendered actual report: tests/artifacts/verification.html (${images.length} verified screenshot files; ${report.status})`);
