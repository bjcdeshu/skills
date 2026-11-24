(() => {
  'use strict';
  // Core helpers
  const $ = id => document.getElementById(id);
  const arr = value => Array.isArray(value) ? value : [];
  const uniq = values => [...new Set(values)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => `<p class="text">${esc(value)}</p>`;
  const valueText = value => value == null ? '未列明' : Array.isArray(value) ? value.join('、') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const anchor = (kind, id) => `${kind}-${id}`;
  const href = id => `#${encodeURIComponent(id)}`;
  const pad = n => String(n).padStart(2, '0');
  const safeUrl = value => /^(https:\/\/|#[^\s]*)/i.test(String(value || '')) ? String(value) : '';
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; return el; };
  const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; return el; };
  const setHidden = (id, hidden) => { const el = $(id); if (el) el.hidden = hidden; return el; };
  const on = (target, type, fn, opts) => { const el = typeof target === 'string' ? $(target) : target; if (el) el.addEventListener(type, fn, opts); return el; };
  const media = query => Boolean(window.matchMedia && window.matchMedia(query).matches);
  const reduceMotion = () => media('(prefers-reduced-motion: reduce)');
  const isOn = el => !el ? false : el.type === 'checkbox' ? el.checked : el.getAttribute('aria-pressed') === 'true';
  const setOn = (el, value) => { if (!el) return; if (el.type === 'checkbox') el.checked = Boolean(value); else el.setAttribute('aria-pressed', String(Boolean(value))); };
  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); } catch (_) {} }
  };
  const num = value => { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  const fmtNum = (value, digits = 2) => { const n = num(value); return n == null ? '' : n.toLocaleString('zh-CN', {maximumFractionDigits:digits}); };
  const fmtPct = value => { const n = num(value); return n == null ? '' : `${fmtNum(n)}%`; };
  const round = n => Math.round(n * 10) / 10;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const hash = string => [...String(string)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 17);
  const imageUri = uri => /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)(?:;[a-z0-9=+._-]+)*,/i.test(String(uri || ''));

  // Data
  let D;
  try { D = JSON.parse(($('dossierData') || {}).textContent || 'null'); }
  catch (_) { D = null; }
  if (!D || typeof D !== 'object') { const main = $('main'); if (main) main.innerHTML = '<p class="empty">报告资料无法读取。</p>'; return; }
  const CP = D.__computed && typeof D.__computed === 'object' ? D.__computed : {};
  const meta = D.meta && typeof D.meta === 'object' ? D.meta : {};
  const entities = arr(D.entities).filter(e => e && e.id != null);
  const relationships = arr(D.relationships).filter(r => r && r.from != null && r.to != null);
  const sources = arr(D.sources).filter(s => s && s.id != null);
  const sections = arr(D.sections), archives = arr(D.archives), questions = arr(D.questions), events = arr(D.timeline);
  const E = new Map(entities.map(e => [e.id, e])), S = new Map(sources.map(s => [s.id, s]));
  const A = new Map(arr(D.assets).filter(a => a && a.id != null).map(a => [a.id, a]));
  const C = new Map(arr(D.claims).filter(c => c && c.id != null).map(c => [c.id, c]));
  const snapshots = arr(D.evidence_manifest);
  const rootId = meta.root_id ?? CP.root?.id, root = E.get(rootId);
  const name = id => E.get(id)?.name || String(id ?? '调查主体');
  const etype = id => E.get(id)?.type || 'unknown';
  const tcls = id => `t-${etype(id)}`;

  // Vocabulary
  const types = {company:'公司',person:'人物',product:'产品',brand:'品牌',investor:'投资方',institution:'机构'};
  const letters = {company:'司',person:'人',product:'产',brand:'品',investor:'投',institution:'机'};
  const statuses = {current:'现行',historical:'历史',candidate:'待核',disputed:'有争议',unavailable:'无法访问',excerpt_only:'仅见摘要',superseded:'已被替代',metadata_only:'仅记录出处'};
  const registryStatuses = {active:'存续',dissolved:'已注销',revoked:'已吊销',deregistered:'已注销',unknown:'登记状态未知'};
  const DEAD = new Set(['dissolved','revoked','deregistered']);
  const sourceKinds = {official:'官方',registry:'登记资料',first_party:'当事方',store:'应用商店',court:'司法文书',media:'媒体',forum:'社区',user:'用户补充',archive:'存档',analysis:'分析'};
  const sourceGlyphs = {official:'官',registry:'登',first_party:'自',store:'店',court:'司',media:'媒',forum:'坛',user:'用',archive:'档',analysis:'析'};
  const relationTypes = {ownership:'持股',investment:'投资',employment:'任职',partnership:'合作',creation:'创作',operation:'运营',publishing:'发行',client:'客户',domain:'域名',historical:'历史关系',candidate:'候选关系',founding:'创办',co_founding:'共同创办',officer:'董监高',counterparty:'交易对手',supplier:'供应商',shared_address:'共同地址',shared_domain:'共用域名',shared_filing_agent:'共同代理',same_as_candidate:'疑似同一主体',litigation_party:'诉讼当事方',fund_manager:'基金管理'};
  const CAPITAL_TYPES = new Set(['ownership','investment']);
  const GOV_TYPES = new Set(['employment','officer','founding','co_founding','fund_manager']);
  const GOV_ROLES = new Set(['founder','director','supervisor','executive','legal_rep','employee','advisor','partner','auditor','agent']);
  const SIGNAL_TYPES = new Set(['shared_address','shared_domain','shared_filing_agent','same_as_candidate']);
  const ORG_TYPES = new Set(['company','investor','institution']);
  const FAMILY = {capital:'资本',governance:'任职/治理',business:'业务',signal:'信号/关联',uncertain:'待核/争议'};
  const FAMILY_ORDER = ['capital','governance','business','signal','uncertain'];
  const GRADES = {fact:{cls:'ev-fact',glyph:'●',label:'公开事实'},company_statement:{cls:'ev-statement',glyph:'◐',label:'公司披露'},user_report:{cls:'ev-user',glyph:'○',label:'用户提供'},analysis:{cls:'ev-analysis',glyph:'◇',label:'综合分析'}};
  const STATUS_CLS = {candidate:'st-candidate',disputed:'st-disputed',historical:'st-historical'};
  const CONF = {A_registry:['A','登记资料','a'],B_multi_independent:['B','多源独立','b'],C_single:['C','单一来源','c'],signal:['S','关联信号','signal'],candidate:['?','待核','candidate'],disputed:['!','有争议','disputed']};

  // Root-type adaptive copy
  const PROFILES = {
    company:{noun:'公司',reportKind:'公司背景调查',heroEyebrow:'公司画像与关键判断',judgmentLabel:'公司判断',questionsTitle:'读懂这家公司',brandSub:'人物 · 资本 · 业务',networkKicker:'人物、公司与产品'},
    person:{noun:'人物',reportKind:'人物背景调查',heroEyebrow:'人物画像与关键判断',judgmentLabel:'人物判断',questionsTitle:'读懂这位人物',brandSub:'履历 · 任职 · 关联',networkKicker:'任职、持股与关联主体'},
    product:{noun:'产品',reportKind:'产品背景调查',heroEyebrow:'产品画像与关键判断',judgmentLabel:'产品判断',questionsTitle:'读懂这款产品',brandSub:'开发 · 发行 · 运营',networkKicker:'开发、发行与运营方'},
    brand:{noun:'品牌',reportKind:'品牌背景调查',heroEyebrow:'品牌画像与关键判断',judgmentLabel:'品牌判断',questionsTitle:'读懂这个品牌',brandSub:'权利 · 运营 · 产品',networkKicker:'权利方、运营方与产品'},
    investor:{noun:'投资方',reportKind:'投资方背景调查',heroEyebrow:'投资方画像与关键判断',judgmentLabel:'投资方判断',questionsTitle:'读懂这家投资方',brandSub:'出资 · 组合 · 退出',networkKicker:'被投企业与共同出资方'},
    institution:{noun:'机构',reportKind:'机构背景调查',heroEyebrow:'机构画像与关键判断',judgmentLabel:'机构判断',questionsTitle:'读懂这家机构',brandSub:'职能 · 隶属 · 关联',networkKicker:'隶属、合作与相关主体'}
  };
  const NEUTRAL = {noun:'调查对象',reportKind:'背景调查',heroEyebrow:'画像与关键判断',judgmentLabel:'核心判断',questionsTitle:'读懂调查对象',brandSub:'主体 · 关系 · 来源',networkKicker:'主体与关系'};
  const rootType = root?.type || meta.root_type || CP.root?.type || '';
  const LBL = {...(PROFILES[rootType] || NEUTRAL)};
  LBL.emptyJudgment = `现有资料尚未形成${LBL.judgmentLabel}。`;
  const labelAliases = {kind:'reportKind',report_kind:'reportKind',eyebrow:'heroEyebrow',hero_eyebrow:'heroEyebrow',judgment:'judgmentLabel',judgment_label:'judgmentLabel',questions:'questionsTitle',questions_title:'questionsTitle',brand_sub:'brandSub',network_kicker:'networkKicker',empty_judgment:'emptyJudgment'};
  for (const overrides of [meta.labels, meta.ui_labels]) {
    if (!overrides || typeof overrides !== 'object') continue;
    for (const [key, value] of Object.entries(overrides)) if (typeof value === 'string' && value.trim()) LBL[labelAliases[key] || key] = value.trim();
  }

  // Palette and theme
  const htmlEl = document.documentElement, PALETTES = ['ink','slate','celadon'];
  function applyPalette(choice, persist) {
    const palette = PALETTES.includes(choice) ? choice : 'ink';
    htmlEl.dataset.palette = palette;
    document.querySelectorAll('[data-palette-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paletteChoice === palette)));
    if (persist) store.set('dossier.palette', palette);
  }
  const effectiveTheme = () => htmlEl.dataset.theme || (media('(prefers-color-scheme: dark)') ? 'dark' : 'light');
  function applyTheme(choice, persist) {
    if (choice === 'light' || choice === 'dark') htmlEl.dataset.theme = choice; else delete htmlEl.dataset.theme;
    const button = $('themeToggle'), dark = effectiveTheme() === 'dark';
    if (button) { button.setAttribute('aria-pressed', String(dark)); button.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式'); button.title = dark ? '切换到浅色模式' : '切换到深色模式'; }
    if (persist) store.set('dossier.theme', choice);
  }
  applyPalette(store.get('dossier.palette') || meta.palette || htmlEl.dataset.palette || 'ink');
  applyTheme(store.get('dossier.theme') || '');
  if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(htmlEl.dataset.theme || '')); }

  // Relationship semantics
  const uncertain = edge => edge.type === 'candidate' || edge.type === 'same_as_candidate' || ['candidate','disputed'].includes(edge.status) || Boolean(edge.disputed);
  const isDisputed = edge => Boolean(edge.disputed) || edge.status === 'disputed';
  const isSignal = edge => edge.edge_class === 'signal' || edge.edge_class === 'derived' || SIGNAL_TYPES.has(edge.type);
  const isCapital = edge => edge.nature === 'capital' || (CAPITAL_TYPES.has(edge.type) && edge.nature !== 'business');
  const confirmed = edge => !uncertain(edge) && !isSignal(edge) && E.get(edge.from)?.status !== 'candidate' && E.get(edge.to)?.status !== 'candidate';
  function family(edge) {
    if (uncertain(edge)) return 'uncertain';
    if (isSignal(edge)) return 'signal';
    if (isCapital(edge)) return 'capital';
    if (GOV_TYPES.has(edge.type) || GOV_ROLES.has(edge.role_code)) return 'governance';
    return 'business';
  }
  const styleKey = edge => { const f = family(edge); return f === 'uncertain' ? (isDisputed(edge) ? 'disputed' : 'candidate') : f === 'governance' ? 'business' : f; };
  const edgeClass = edge => `${styleKey(edge)}${family(edge) === 'governance' ? ' governance' : ''}${edge.status === 'historical' ? ' historical' : ''}`;
  const relLabel = edge => relationTypes[edge.type] || edge.type || '关系';
  const edgeStatus = edge => isDisputed(edge) ? 'disputed' : edge.status || (edge.type === 'candidate' ? 'candidate' : '');

  const relationMap = new Map(), adjacency = new Map(entities.map(e => [e.id, []]));
  const pairKey = (a, b) => JSON.stringify([String(a), String(b)].sort());
  for (const edge of relationships) {
    if (!E.has(edge.from) || !E.has(edge.to)) continue;
    adjacency.get(edge.from).push(edge);
    if (edge.to !== edge.from) adjacency.get(edge.to).push(edge);
    const key = pairKey(edge.from, edge.to);
    if (!relationMap.has(key)) relationMap.set(key, {key, a:edge.from, b:edge.to, records:[]});
    relationMap.get(key).records.push(edge);
  }
  const pairs = [...relationMap.values()], adj = id => adjacency.get(id) || [], other = (edge, id) => edge.from === id ? edge.to : edge.from;
  const validRelationships = relationships.filter(e => E.has(e.from) && E.has(e.to));

  // Badges, chips and small renderers
  const status = value => value ? `<span class="status grade-badge ${STATUS_CLS[value] || ''}">${esc(statuses[value] || value)}</span>` : '';
  const registryBadge = entity => entity?.registry_status && entity.registry_status !== 'active' ? `<span class="status grade-badge ${DEAD.has(entity.registry_status) ? 'st-historical' : ''}">${esc(registryStatuses[entity.registry_status] || entity.registry_status)}</span>` : '';
  const typeTag = id => `<span class="type-tag ${tcls(id)}"><i class="dot ${tcls(id)}" aria-hidden="true"></i>${esc(types[etype(id)] || etype(id))}</span>`;
  function gradeBadge(kind, count = 1) {
    const g = GRADES[kind], tail = count > 1 ? `<small>×${count}</small>` : '';
    return g ? `<span class="grade-badge ${g.cls}"><b aria-hidden="true">${g.glyph}</b> ${g.label}${tail}</span>` : `<span class="grade-badge">${esc(kind || '依据')}${tail}</span>`;
  }
  function confBadge(kind, id) {
    const record = CP.confidence?.[kind]?.[id];
    if (!record || !CONF[record.grade]) return '';
    const [g, label, cls] = CONF[record.grade], n = num(record.independent_sources);
    return `<span class="status conf-badge conf-${cls}" title="独立来源 ${n ?? 0} 个">${g} · ${label}${n ? ` · ${n} 源` : ''}</span>`;
  }
  function claimLinks(ids, label = '依据') {
    const valid = uniq(arr(ids)).filter(id => C.has(id));
    if (!valid.length) return '';
    const kinds = new Map(), states = new Map();
    for (const id of valid) {
      const claim = C.get(id); kinds.set(claim.kind, (kinds.get(claim.kind) || 0) + 1);
      if (STATUS_CLS[claim.status]) states.set(claim.status, (states.get(claim.status) || 0) + 1);
    }
    const badges = [...kinds].map(([kind, n]) => gradeBadge(kind, n)).join('') + [...states].map(([s, n]) => `<span class="grade-badge ${STATUS_CLS[s]}">${esc(statuses[s])}${n > 1 ? `<small>×${n}</small>` : ''}</span>`).join('');
    return `<button type="button" class="claim-link" data-claims="${esc(valid.join(','))}" aria-label="查看 ${valid.length} 条判断依据">${badges}<span class="claim-link-label">${esc(label)} ${valid.length} →</span></button>`;
  }
  function sourceChip(id) {
    const source = S.get(id);
    return `<a class="source-ref" href="${href(anchor('source', id))}" data-source="${esc(id)}" aria-label="来源 ${esc(id)}：${esc(source.title)}"><span class="source-kind-glyph" aria-hidden="true">${esc(sourceGlyphs[source.kind] || '源')}</span>${esc(id)}</a>`;
  }
  function refs(ids) {
    const valid = uniq(arr(ids)).filter(id => S.has(id));
    return valid.length ? `<div class="source-refs">${valid.map(sourceChip).join('')}</div>` : '';
  }
  function entityLinks(ids) {
    const valid = uniq(arr(ids)).filter(id => E.has(id));
    return valid.length ? `<div class="entity-links">${valid.map(id => `<button type="button" class="entity-link ${tcls(id)}" data-open-entity="${esc(id)}"><i class="dot ${tcls(id)}" aria-hidden="true"></i>${esc(name(id))} →</button>`).join('')}</div>` : '';
  }
  const snapshotKinds = {original_file:'原文件',web_snapshot:'网页快照',screenshot:'页面截图',extracted_text:'提取文本',excerpt:'摘录'};
  function snapshotHtml(item) {
    const state = item.status === 'stored' ? '已存档' : item.status === 'unavailable' ? '访问未完成' : '已记录出处';
    const detail = item.status === 'stored' ? `<code>${esc(item.path)}</code><small>${fmtNum(item.bytes, 0)} bytes · SHA-256</small><code>${esc(item.sha256)}</code>` : item.access_note ? text(item.access_note) : '';
    return `<div class="snapshot"><strong>${esc(snapshotKinds[item.representation] || item.representation)}</strong><span>${esc(state)} · ${esc(item.captured_at || '')}</span>${detail}</div>`;
  }
  function sourceLines(ids) {
    return uniq(arr(ids)).filter(id => S.has(id)).map(id => {
      const source = S.get(id);
      const info = [sourceKinds[source.kind] || source.kind, source.publisher, source.published_at && `发布 ${source.published_at}`, (source.accessed_at || source.observed_at) && `访问 ${source.accessed_at || source.observed_at}`].filter(Boolean).join(' · ');
      return `<div class="profile-source">${sourceChip(id)}<button type="button" class="link-button" data-open-source="${esc(id)}"><strong>${esc(source.title)}</strong></button><small>${esc(info)}</small></div>`;
    }).join('');
  }
  function claimHtml(claim) {
    const g = GRADES[claim.kind];
    const dates = [['资料发布',claim.published_at],['事实生效',claim.effective_at],['事实截至',claim.as_of],['本次访问',claim.accessed_at]].filter(([, v]) => v);
    const evidence = arr(claim.evidence).map(item => `<div class="claim-evidence">${S.has(item.source_id) ? sourceChip(item.source_id) : `<span class="source-ref">${esc(item.source_id)}</span>`} ${esc(item.locator || '')}${item.published_at ? ` · 发布 ${esc(item.published_at)}` : ''}${item.accessed_at ? ` · 访问 ${esc(item.accessed_at)}` : ''}${item.snapshot_id ? snapshots.filter(s => s.id === item.snapshot_id).map(snapshotHtml).join('') : ''}</div>`).join('');
    return `<article class="claim-record ${g ? g.cls : ''}"><div class="claim-heading"><span class="source-id">${esc(claim.id)}</span>${gradeBadge(claim.kind)}${status(claim.status)}</div><h3>${esc(claim.text)}</h3>${dates.length ? `<dl class="claim-dates">${dates.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}${claim.locator ? `<p class="source-locator">定位：${esc(claim.locator)}</p>` : ''}${claim.reasoning ? text(claim.reasoning) : ''}${entityLinks(claim.entity_ids)}${sourceLines(claim.source_ids)}${evidence}${claim.uncertainty ? `<p class="claim-context">${esc(valueText(claim.uncertainty))}</p>` : ''}${arr(claim.input_claim_ids).length ? claimLinks(claim.input_claim_ids, '输入依据') : ''}</article>`;
  }
  function chartHtml(chart) {
    if (!chart || !arr(chart.rows).length) return '';
    const rows = chart.rows.map(row => ({...row, segments:arr(row.segments).filter(s => Number.isFinite(Number(s.value)) && Number(s.value) >= 0)}));
    const total = row => row.segments.reduce((n, s) => n + Number(s.value), 0);
    const maximum = Math.max(1, ...rows.map(total));
    const labels = uniq(rows.flatMap(row => row.segments.map(s => s.name)));
    const seg = label => `seg-${labels.indexOf(label) % 6}`;
    const format = n => Number(n).toLocaleString('zh-CN', {maximumFractionDigits:chart.decimals ?? 1});
    const bars = rows.map(row => `<div class="bar-row"><span class="bar-label">${esc(row.label)}</span><div class="bar-track">${row.segments.map(s => `<span class="bar-segment ${seg(s.name)}" style="width:${(Number(s.value) / maximum * 100).toFixed(3)}%" title="${esc(s.name)}：${format(s.value)} ${esc(chart.unit || '')}"><span>${Number(s.value) / maximum > .13 ? format(s.value) : ''}</span></span>`).join('')}</div><strong class="num-cell">${format(total(row))}</strong></div>`).join('');
    const table = `<details class="chart-data"><summary>查看数值</summary><div class="table-scroll"><table><thead><tr><th>时期 / 类别</th>${labels.map(l => `<th class="num-cell">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th>${esc(row.label)}</th>${labels.map(l => `<td class="num-cell">${row.segments.some(s => s.name === l) ? format(row.segments.filter(s => s.name === l).reduce((n, s) => n + Number(s.value), 0)) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    return `<figure class="data-chart"><figcaption>${esc(chart.title || '')}${chart.unit ? `<small>单位：${esc(chart.unit)}</small>` : ''}</figcaption><div class="chart-legend">${labels.map(l => `<span><i class="${seg(l)}" aria-hidden="true"></i>${esc(l)}</span>`).join('')}</div>${bars}${table}${chart.note ? `<p class="chart-note">${esc(chart.note)}</p>` : ''}${refs(chart.sources)}${claimLinks(chart.claim_ids)}</figure>`;
  }
  const NUMERIC = /^[(（]?[-+−]?(?:[A-Z]{3}\s?|[¥￥$€£]\s?)?\d[\d,，]*(?:\.\d+)?\s*(?:%|％|‰|[万亿千百]+)?\s*(?:元|美元|港元|欧元|人民币|股|人|家|个|项|次|倍|年|月|天|bp|x|USD|CNY|RMB|HKD|EUR)?[)）]?$/;
  const isNumeric = value => NUMERIC.test(String(value ?? '').trim());
  function tableHtml(table) {
    if (!table || !arr(table.headers).length) return '';
    const rows = arr(table.rows).map(row => ({cells:arr(row?.cells || row).map(valueText), row}));
    const width = Math.max(0, ...rows.map(r => r.cells.length));
    const numericCols = new Set();
    for (let c = 0; c < width; c++) {
      const filled = rows.map(r => r.cells[c]).filter(v => v != null && v !== '' && v !== '未列明' && v !== '—');
      if (filled.length && filled.filter(isNumeric).length / filled.length >= .6) numericCols.add(c);
    }
    const hasRefs = rows.some(r => r.row && (r.row.sources || r.row.claim_ids));
    const head = table.headers.map((h, c) => `<th scope="col"${numericCols.has(c) ? ' class="num-cell"' : ''}>${esc(h)}</th>`).join('') + (hasRefs && table.headers.length <= width ? '<th scope="col">依据</th>' : '');
    const body = rows.map(r => `<tr>${r.cells.map((cell, c) => `<td${numericCols.has(c) ? ' class="num-cell"' : ''}>${esc(cell)}</td>`).join('')}${hasRefs ? `<td>${refs(r.row?.sources)}${claimLinks(r.row?.claim_ids)}</td>` : ''}</tr>`).join('');
    return `<div class="table-scroll"><table class="fact-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function imageFigure(asset) {
    return `<figure class="evidence-image"><button type="button" class="image-zoom" data-lightbox="${esc(asset.id)}" aria-label="放大查看：${esc(asset.alt || asset.caption || '图片')}"><img src="${esc(asset.data_uri)}" alt="${esc(asset.alt || asset.caption || '')}" loading="lazy"></button><figcaption>${esc(asset.caption || asset.alt || '')}${asset.observed_at ? `<small> · ${esc(asset.observed_at)}</small>` : ''}${refs(asset.sources)}</figcaption></figure>`;
  }
  const assetsOf = ids => uniq(arr(ids)).map(id => A.get(id)).filter(a => a && imageUri(a.data_uri));
  function imageGrid(ids) { const list = assetsOf(ids); return list.length ? `<div class="image-grid">${list.map(imageFigure).join('')}</div>` : ''; }
  function renderBlock(block) {
    const wide = arr(block.steps).length || arr(block.image_ids).length || block.chart || block.table;
    const steps = arr(block.steps).length ? `<ol class="steps">${block.steps.map(step => `<li>${step.title ? `<h4>${esc(step.title)}</h4>` : ''}${step.text ? text(step.text) : ''}${refs(step.sources)}${claimLinks(step.claim_ids)}</li>`).join('')}</ol>` : '';
    return `<article class="content-block${wide ? ' wide' : ''}">${block.title ? `<h3>${esc(block.title)}</h3>` : ''}${block.text ? text(block.text) : ''}${chartHtml(block.chart)}${tableHtml(block.table)}${steps}${imageGrid(block.image_ids)}${entityLinks(block.entity_ids)}${refs(block.sources)}${claimLinks(block.claim_ids)}</article>`;
  }
  const renderBlocks = blocks => arr(blocks).length ? `<div class="block-grid">${blocks.map(renderBlock).join('')}</div>` : '';

  // Root paths (confirmed relationships only, traversed in either direction)
  const parent = new Map(), distance = new Map(), branch = new Map();
  if (root) {
    const queue = [rootId]; distance.set(rootId, 0); branch.set(rootId, rootId);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const edges = adj(id).filter(confirmed).slice().sort((a, b) => Number(a.status === 'historical') - Number(b.status === 'historical'));
      for (const edge of edges) {
        const next = other(edge, id);
        if (distance.has(next)) continue;
        parent.set(next, {id, edge}); distance.set(next, distance.get(id) + 1);
        branch.set(next, id === rootId ? next : branch.get(id)); queue.push(next);
      }
    }
  }
  function pathTo(id) {
    if (!root || !distance.has(id)) return null;
    const ids = [id], edges = []; let cursor = id;
    while (cursor !== rootId) { const step = parent.get(cursor); edges.unshift(step.edge); ids.unshift(step.id); cursor = step.id; }
    return {ids, edges};
  }
  function chainHtml(ids, edges, action = 'select-entity') {
    return `<div class="path-chain">${ids.map((pid, i) => {
      const edge = edges[i - 1], forward = edge && edge.from === ids[i - 1];
      const step = i ? `<span class="path-step"><span>${esc(edge.label || relLabel(edge))}${edge.status === 'historical' ? ' · 历史' : ''}${edge.percent != null && !String(edge.label || '').includes('%') ? ` · ${esc(fmtPct(edge.percent))}` : ''}</span><b aria-label="${forward ? '指向右侧' : '指向左侧'}">${forward ? '→' : '←'}</b></span>` : '';
      return `${step}<button type="button" class="path-node ${tcls(pid)}" data-${action}="${esc(pid)}">${esc(name(pid))}</button>`;
    }).join('')}</div>`;
  }
  function pathHtml(id, action = 'select-entity') {
    const heading = `<span class="path-title">与 ${esc(name(rootId))} 的关系路径</span>`;
    if (!root) return `${heading}<p>尚未指定调查主体，无法建立关系路径。</p>`;
    if (id === rootId) return `${heading}<p>调查主体 · 网络中心</p>`;
    const path = pathTo(id);
    if (!path) {
      const hasUncertain = adj(id).some(e => !confirmed(e)) || E.get(id)?.status === 'candidate';
      return `${heading}<p>${hasUncertain ? '现有资料未建立有来源的确定连接路径；待核、争议或信号类关系保留在图中。' : '现有资料未发现与调查主体相连的有来源路径。可查看直接关系与出处。'}</p>`;
    }
    return `${heading}${chainHtml(path.ids, path.edges, action)}${refs(path.edges.flatMap(e => arr(e.sources)))}`;
  }

  // Computed look-through ownership
  function ownershipRecords(id) {
    const record = CP.ownership?.[id];
    if (!record || typeof record !== 'object') return [];
    return [record, record.reverse].filter(r => r && typeof r === 'object' && num(r.effective_pct) != null);
  }
  function ownershipText(record, id) {
    const holder = record.holder_id ?? (record.direction === 'downstream' ? rootId : id);
    const target = record.target_id ?? (record.direction === 'downstream' ? id : rootId);
    const notes = [];
    if (num(record.direct_pct)) notes.push(`直接 ${fmtPct(record.direct_pct)}`);
    if (record.coverage === 'partial') notes.push('部分覆盖');
    if (record.has_cycle) notes.push('含交叉持股');
    return `${name(holder)} 穿透持有 ${name(target)} ${fmtPct(record.effective_pct)}${notes.length ? `（${notes.join('，')}）` : ''}`;
  }
  const ownershipHtml = id => ownershipRecords(id).map(r => `<p class="ownership-note">${esc(ownershipText(r, id))}</p>`).join('');

  // Relationship and entity renderers
  function relationMetrics(edge) {
    const metrics = [];
    if (edge.percent != null) metrics.push(fmtPct(edge.percent) || `${valueText(edge.percent)}%`);
    if (edge.amount != null) metrics.push([valueText(edge.amount), edge.currency, edge.unit].filter(v => v != null && v !== '').join(' '));
    if (edge.date) metrics.push(edge.date);
    if (edge.valid_from || edge.valid_to) metrics.push(`${edge.valid_from || '起始未列明'} — ${edge.valid_to || '结束未列明'}`);
    return metrics;
  }
  function relationHtml(edge) {
    const fam = family(edge);
    return `<article class="edge-record fam-${fam}${uncertain(edge) ? ' is-candidate' : ''}"><div class="edge-direction"><button type="button" class="link-button" data-open-entity="${esc(edge.from)}">${esc(name(edge.from))}</button> → <button type="button" class="link-button" data-open-entity="${esc(edge.to)}">${esc(name(edge.to))}</button></div><h4>${esc(edge.label || relLabel(edge))}</h4><div class="edge-meta"><span>${esc(relLabel(edge))}</span><span>${esc(FAMILY[fam])}</span>${edge.role ? `<span>${esc(edge.role)}</span>` : ''}${relationMetrics(edge).map(m => `<span class="num-cell">${esc(m)}</span>`).join('')}${status(edgeStatus(edge))}${confBadge('relationships', edge.id)}</div>${edge.detail ? text(edge.detail) : ''}${refs(edge.sources)}${claimLinks(edge.claim_ids)}</article>`;
  }
  function entitySourceIds(entity) {
    const imageIds = uniq([...arr(entity.image_ids), ...arr(entity.sections).flatMap(s => arr(s.image_ids))]);
    return uniq([...arr(entity.sources), ...['fields','facts','career','sections'].flatMap(key => arr(entity[key]).flatMap(item => arr(item?.sources))), ...adj(entity.id).flatMap(e => arr(e.sources)), ...imageIds.flatMap(id => arr(A.get(id)?.sources))]);
  }
  const profileSection = (title, html) => html ? `<section class="profile-section"><h4>${esc(title)}</h4>${html}</section>` : '';
  const sortRelations = list => list.slice().sort((a, b) => FAMILY_ORDER.indexOf(family(a)) - FAMILY_ORDER.indexOf(family(b)) || (num(b.percent) ?? -1) - (num(a.percent) ?? -1));
  function entityParts(id) {
    const entity = E.get(id); if (!entity) return {};
    const sectionImages = new Set(arr(entity.sections).flatMap(section => arr(section.image_ids)));
    const fields = arr(entity.fields).length ? `<dl class="field-grid">${entity.fields.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(valueText(f.value))}${refs(f.sources)}${claimLinks(f.claim_ids)}</dd></div>`).join('')}</dl>` : '';
    const identifiers = arr(entity.identifiers).filter(x => x && x.value).map(x => `<div><dt>${esc(x.scheme || '标识')}</dt><dd class="num-cell">${esc(x.value)}${x.jurisdiction ? ` · ${esc(x.jurisdiction)}` : ''}</dd></div>`).join('');
    const career = arr(entity.career).length ? `<div class="career">${entity.career.map(item => `<article class="career-item"><time>${esc(item.date || '')}</time><h4>${esc(item.title || '')}</h4>${item.text ? text(item.text) : ''}${refs(item.sources)}${claimLinks(item.claim_ids)}</article>`).join('')}</div>` : '';
    const facts = arr(entity.facts).length ? `<ul class="facts">${entity.facts.map(f => `<li>${f.date ? `<span class="fact-date">${esc(f.date)}</span>` : ''}${status(f.status)}${esc(f.text)}${refs(f.sources)}${claimLinks(f.claim_ids)}</li>`).join('')}</ul>` : '';
    const customSection = withImages => arr(entity.sections).map(section => profileSection(section.title || '档案记录', `${section.text ? text(section.text) : ''}${withImages ? imageGrid(section.image_ids) : ''}${refs(section.sources)}${claimLinks(section.claim_ids)}`)).join('');
    const custom = customSection(true), customText = customSection(false);
    const membership = archives.filter(a => arr(a.entity_ids).includes(id)).map(a => `<a class="entity-link" href="${href(anchor('archive', a.id))}" data-jump="${esc(anchor('archive', a.id))}">${esc(a.title)} ↓</a>`).join('');
    const images = imageGrid(arr(entity.image_ids).filter(imageId => !sectionImages.has(imageId)));
    const relations = sortRelations(adj(id)).map(relationHtml).join('');
    const srcIds = entitySourceIds(entity);
    return {entity, fields, identifiers, career, facts, custom, customText, membership, images, relations, relationCount:adj(id).length, sources:sourceLines(srcIds), sourceCount:srcIds.filter(s => S.has(s)).length, ownership:ownershipHtml(id)};
  }
  function entityIntro(id, headingTag = 'h3', headingId = '') {
    const entity = E.get(id);
    return `<div class="inspect-type">${typeTag(id)} ${status(entity.status)}${registryBadge(entity)}${confBadge('entities', id)}</div><div class="profile-heading"><div><${headingTag}${headingId ? ` id="${headingId}"` : ''}>${esc(entity.name)}</${headingTag}>${entity.role ? `<div class="profile-role">${esc(entity.role)}</div>` : ''}${arr(entity.aliases).length ? `<div class="profile-alias">别名：${esc(entity.aliases.join(' · '))}</div>` : ''}</div></div><p class="profile-summary text">${esc(entity.summary || '')}</p>${refs(entity.sources)}`;
  }
  function entityBody(id) {
    const p = entityParts(id); if (!p.entity) return '';
    return `${profileSection('穿透持股（计算值）', p.ownership)}${profileSection('基本信息', p.fields)}${profileSection('登记标识', p.identifiers ? `<dl class="field-grid">${p.identifiers}</dl>` : '')}${profileSection('履历与具体工作', p.career)}${profileSection('事实与记录', p.facts)}${p.custom}${profileSection('图片与材料', p.images)}${profileSection('收录档案', p.membership ? `<div class="entity-links">${p.membership}</div>` : '')}${profileSection(`直接关系 · ${p.relationCount} 条`, p.relations)}${profileSection('完整来源', p.sources)}`;
  }

  // Page chrome and root-adaptive copy
  const title = meta.title || `${name(rootId)}｜${LBL.reportKind}`;
  document.title = title; htmlEl.lang = meta.language || htmlEl.lang || 'zh-CN';
  function setLabel(id, value) {
    const el = $(id); if (!el) return;
    if (!el.querySelector('[id]')) { el.textContent = value; return; }
    let label = el.querySelector('[data-label]');
    if (!label) { [...el.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove()); label = document.createElement('span'); label.dataset.label = ''; el.prepend(label); }
    label.textContent = value;
  }
  setText('reportTitle', title); setText('reportSubtitle', meta.subtitle || '');
  setText('mobileTitle', root?.short_name || root?.name || title);
  setHtml('brandTitle', `${esc(root?.short_name || root?.name || LBL.reportKind)}<small>${esc(LBL.brandSub)}</small>`);
  setText('topbarKind', LBL.reportKind);
  setLabel('reportEyebrow', LBL.heroEyebrow);
  setText('reportDate', [meta.as_of && `截至 ${meta.as_of}`, `${S.size} 个来源`, `${E.size} 个主体`].filter(Boolean).join(' · '));
  setText('sidebarDate', meta.as_of ? `截至 ${meta.as_of}` : LBL.reportKind);
  setText('sidebarCounts', `${E.size} 个主体 · ${pairs.length} 组连接 · ${S.size} 个来源`);
  setText('footerTitle', [title, meta.as_of].filter(Boolean).join(' · '));
  setLabel('networkKicker', LBL.networkKicker);
  setText('networkSummary', `${E.size} 个主体 · ${pairs.length} 组连接 · ${validRelationships.length} 条关系事实`);
  setText('questionsTitle', LBL.questionsTitle);

  // Hero 2.0
  const heroActions = $('heroActions');
  if (heroActions && !heroActions.children.length) heroActions.innerHTML = `<a class="primary" href="#network">打开关系网络 <span aria-hidden="true">↓</span></a>${questions.length ? '<a class="secondary" href="#questions">核心问题 ↓</a>' : ''}<button type="button" class="secondary" data-action="search">搜索 <kbd>/</kbd></button>`;
  else if (heroActions && !questions.length) heroActions.querySelectorAll('a[href="#questions"]').forEach(a => { a.hidden = true; });
  const verdictClaims = arr(meta.claim_ids).length ? meta.claim_ids : uniq([...arr(D.findings), ...arr(D.metrics)].flatMap(item => arr(item?.claim_ids)));
  setHtml('judgment', `<blockquote class="verdict-quote"><span class="verdict-label">${esc(LBL.judgmentLabel)}</span><p class="verdict-text text">${esc(meta.summary || root?.summary || LBL.emptyJudgment)}</p><div class="verdict-evidence">${claimLinks(verdictClaims, arr(meta.claim_ids).length ? '依据' : '关键发现依据')}${refs(meta.sources)}</div></blockquote>`);
  function identityCard() {
    if (!root) return '';
    const thumb = assetsOf(root.image_ids)[0];
    const idFields = [...arr(root.identifiers).filter(x => x && x.value).slice(0, 2).map(x => ({label:x.scheme || '标识', value:x.value})), ...arr(root.fields).filter(f => f && f.value != null)].slice(0, 4);
    const sig = arr(CP.ownership_meta?.significant_holders || CP.ownership_meta?.top_owners).filter(h => h && h.id !== rootId).slice(0, 3);
    const downstream = Object.entries(CP.ownership || {}).filter(([, r]) => r && r.direction === 'downstream').sort((a, b) => (num(b[1].effective_pct) || 0) - (num(a[1].effective_pct) || 0)).slice(0, 3);
    const control = sig.length ? `<div class="identity-control"><span>重要穿透持有人（计算值）</span>${sig.map(h => `<button type="button" class="entity-link ${tcls(h.id)}" data-open-entity="${esc(h.id)}"><i class="dot ${tcls(h.id)}" aria-hidden="true"></i>${esc(h.name || name(h.id))} <b class="num-cell">${esc(fmtPct(h.effective_pct))}</b>${h.coverage === 'partial' ? ' · 部分覆盖' : ''}</button>`).join('')}</div>`
      : downstream.length ? `<div class="identity-control"><span>穿透持股（计算值）</span>${downstream.map(([id, r]) => `<button type="button" class="entity-link ${tcls(id)}" data-open-entity="${esc(id)}"><i class="dot ${tcls(id)}" aria-hidden="true"></i>${esc(name(id))} <b class="num-cell">${esc(fmtPct(r.effective_pct))}</b></button>`).join('')}</div>` : '';
    const aliases = uniq([root.short_name, ...arr(root.aliases)].filter(v => v && v !== root.name));
    return `<div class="identity-card ${tcls(rootId)}"><div class="identity-head">${typeTag(rootId)}${status(root.status)}${registryBadge(root)}${confBadge('entities', rootId)}</div><h3 class="identity-name">${esc(root.name)}</h3>${aliases.length ? `<p class="identity-alias">${esc(aliases.join(' · '))}</p>` : ''}${root.role ? `<p class="profile-role">${esc(root.role)}</p>` : ''}${thumb ? `<button type="button" class="identity-thumb" data-lightbox="${esc(thumb.id)}" aria-label="放大查看：${esc(thumb.alt || thumb.caption || '图片')}"><img src="${esc(thumb.data_uri)}" alt="${esc(thumb.alt || thumb.caption || '')}"></button>` : ''}${idFields.length ? `<dl class="identity-fields">${idFields.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(valueText(f.value))}</dd></div>`).join('')}</dl>` : ''}${control}${refs(root.sources)}<button type="button" class="secondary" data-open-entity="${esc(rootId)}">完整档案 →</button></div>`;
  }
  setHtml('heroMedia', identityCard());
  const metrics = arr(D.metrics).slice(0, 8);
  const metricsEl = setHtml('businessMetrics', metrics.map(m => `<article class="business-metric"><span>${esc(m.label)}</span><strong class="num-cell">${esc(m.value)}</strong>${m.detail ? `<small>${esc(m.detail)}</small>` : ''}${refs(m.sources)}${claimLinks(m.claim_ids)}</article>`).join(''));
  if (metricsEl) { metricsEl.hidden = !metrics.length; metricsEl.dataset.count = String(metrics.length); }
  const findings = arr(D.findings);
  const findingsEl = setHtml('findings', findings.map((f, i) => `<article class="finding-row" id="${esc(anchor('finding', f.id ?? i))}"><span class="finding-num" aria-hidden="true">${pad(i + 1)}</span><div class="finding-body"><h3>${esc(f.title)}</h3>${text(f.text)}<div class="finding-meta">${claimLinks(f.claim_ids)}${entityLinks(f.entity_ids)}${refs(f.sources)}</div></div></article>`).join(''));
  if (findingsEl) findingsEl.hidden = !findings.length;

  // Narrative sections
  setHtml('reportSections', sections.map((section, i) => `<section class="section" id="${esc(section.id)}" aria-labelledby="${esc(anchor('heading', section.id))}"><div class="section-head"><div><span class="eyebrow">${pad(i + 1)} · ${esc(section.kicker || '调查方向')}</span><h2 id="${esc(anchor('heading', section.id))}">${esc(section.title)}</h2></div></div>${section.intro ? `<p class="section-intro text">${esc(section.intro)}</p>` : ''}${renderBlocks(section.blocks)}</section>`).join(''));

  // Two-hop co-occurrence
  const ROLE_WEIGHT = {founder:1,shareholder:1,legal_rep:1,gp:1,director:.8,executive:.8,partner:.8,supervisor:.7,lp:.6,employee:.4,advisor:.4};
  const roleCode = edge => edge.role_code || (isCapital(edge) ? 'shareholder' : edge.type === 'founding' || edge.type === 'co_founding' ? 'founder' : '');
  const roleText = edge => edge.role || edge.label || relLabel(edge);
  function computeCooccurrence(subject) {
    const orgEdges = id => adj(id).filter(e => confirmed(e) && ORG_TYPES.has(etype(other(e, id))) && etype(id) === 'person');
    const mine = new Map();
    for (const e of orgEdges(subject)) { const org = other(e, subject); if (!mine.has(org)) mine.set(org, e); }
    const partners = new Map();
    for (const [org, se] of mine) {
      for (const pe of adj(org)) {
        const pid = other(pe, org);
        if (pid === subject || etype(pid) !== 'person' || !confirmed(pe)) continue;
        if (!partners.has(pid)) partners.set(pid, new Map());
        const orgMap = partners.get(pid);
        if (!orgMap.has(org)) orgMap.set(org, {se, pe});
      }
    }
    const dateOf = e => [e.valid_from, e.date, e.valid_to].filter(Boolean);
    return [...partners].map(([pid, orgMap]) => {
      const orgs = [...orgMap].map(([org, {se, pe}]) => ({id:org, name:name(org), registry_status:E.get(org)?.registry_status || 'unknown', subject_role:roleText(se), partner_role:roleText(pe), weight:(ROLE_WEIGHT[roleCode(se)] ?? .6) * (ROLE_WEIGHT[roleCode(pe)] ?? .6), dates:[...dateOf(se), ...dateOf(pe)]}));
      const dates = orgs.flatMap(o => o.dates).map(String).sort();
      return {partner_id:pid, partner_name:name(pid), score:round(orgs.reduce((n, o) => n + o.weight, 0) * 10) / 10, shared_count:orgs.length, shared_active:orgs.filter(o => !DEAD.has(o.registry_status)).length, shared_dissolved:orgs.filter(o => DEAD.has(o.registry_status)).length, organizations:orgs, first_seen:dates[0] || null, last_seen:dates[dates.length - 1] || null};
    }).sort((a, b) => b.score - a.score || b.shared_count - a.shared_count);
  }
  const cooc = {subjects:new Map(), current:null};
  (() => {
    const computed = CP.co_occurrence;
    if (computed && typeof computed === 'object') {
      if (computed.subject_id != null && arr(computed.rows).length) cooc.subjects.set(computed.subject_id, arr(computed.rows));
      if (computed.by_person && typeof computed.by_person === 'object') for (const [pid, rows] of Object.entries(computed.by_person)) if (E.has(pid) && arr(rows).length && !cooc.subjects.has(pid)) cooc.subjects.set(pid, arr(rows));
    }
    if (!cooc.subjects.size) {
      let subject = rootType === 'person' ? rootId : null;
      if (!subject) {
        const people = entities.filter(e => e.type === 'person' && e.status !== 'candidate').map(e => ({id:e.id, n:adj(e.id).filter(x => confirmed(x) && ORG_TYPES.has(etype(other(x, e.id)))).length, near:distance.get(e.id) ?? 99})).filter(p => p.n >= 2).sort((a, b) => b.n - a.n || a.near - b.near);
        subject = people[0]?.id;
      }
      if (subject != null) { const rows = computeCooccurrence(subject); if (rows.length) cooc.subjects.set(subject, rows); }
    }
    cooc.current = cooc.subjects.keys().next().value ?? null;
  })();
  const cooccurrenceVisible = () => cooc.current != null && arr(cooc.subjects.get(cooc.current)).length >= 2;
  function renderCooccurrence() {
    const section = $('cooccurrenceSection'); if (!section) return;
    if (!cooccurrenceVisible()) { section.hidden = true; return; }
    section.hidden = false;
    const subject = cooc.current, rows = arr(cooc.subjects.get(subject)).slice(0, 30);
    setLabel('cooccurrenceKicker', '二跳共现');
    setText('cooccurrenceTitle', `${name(subject)} 的共现网络`);
    setText('cooccurrenceIntro', `以 ${name(subject)} 为中心，统计其任职或持股机构（含已注销、吊销主体）中反复同时出现的人物。评分按双方角色加权累加；共现说明公开记录中的共同经历，不代表控制或亲属关系。`);
    const switcher = cooc.subjects.size > 1 ? `<div class="cooccur-subjects" role="group" aria-label="切换共现中心">${[...cooc.subjects.keys()].slice(0, 6).map(pid => `<button type="button" class="cooccur-subject chip" data-cooccur-subject="${esc(pid)}" aria-pressed="${String(pid === subject)}">${esc(name(pid))}</button>`).join('')}</div>` : '';
    const body = rows.map((row, i) => {
      const pid = row.partner_id, orgs = arr(row.organizations);
      const partner = E.has(pid) ? `<button type="button" class="entity-link ${tcls(pid)}" data-open-entity="${esc(pid)}"><i class="dot ${tcls(pid)}" aria-hidden="true"></i>${esc(name(pid))} →</button>` : esc(row.partner_name || pid);
      const orgList = orgs.map(o => `<li>${E.has(o.id) ? `<button type="button" class="link-button" data-open-entity="${esc(o.id)}">${esc(o.name || name(o.id))}</button>` : esc(o.name || o.id)}${DEAD.has(o.registry_status) ? ` <span class="grade-badge st-historical">${esc(registryStatuses[o.registry_status])}</span>` : ''} <small>${esc([o.subject_role, o.partner_role].filter(Boolean).join(' / '))}</small></li>`).join('');
      return `<tr><td class="num-cell">${i + 1}</td><td>${partner}</td><td class="num-cell">${esc(fmtNum(row.score, 2))}</td><td class="num-cell">${esc(String(row.shared_count ?? orgs.length))} <small>（存续 ${esc(String(row.shared_active ?? 0))} · 注销 ${esc(String(row.shared_dissolved ?? 0))}）</small></td><td><ul class="cooccur-orgs">${orgList}</ul></td><td class="num-cell">${esc([row.first_seen, row.last_seen].filter(Boolean).join(' — ') || '未列明')}</td></tr>`;
    }).join('');
    setHtml('cooccurrenceContent', `${switcher}<div class="table-scroll"><table class="cooccur-table fact-table"><thead><tr><th scope="col" class="num-cell">#</th><th scope="col">共现人物</th><th scope="col" class="num-cell">评分</th><th scope="col" class="num-cell">共同机构</th><th scope="col">机构与双方角色</th><th scope="col" class="num-cell">时间跨度</th></tr></thead><tbody>${body}</tbody></table></div>`);
  }
  renderCooccurrence();

  // Questions
  setText('questionKicker', `${questions.length} 个核心问题`);
  setHtml('questionList', questions.map((q, i) => `<details class="question" id="${esc(anchor('question', q.id ?? i))}"${i === 0 ? ' open' : ''}><summary><span class="item-number">${pad(i + 1)}</span><span>${esc(q.question)}</span></summary><div class="question-body">${text(q.answer)}<div class="finding-meta">${claimLinks(q.claim_ids)}${refs(q.sources)}</div>${q.why_it_matters ? `<div class="why"><strong>为什么重要</strong>${text(q.why_it_matters)}</div>` : ''}${arr(q.evidence).length ? `<ul class="evidence-list">${q.evidence.map(item => `<li>${esc(item.text)}${entityLinks(item.entity_ids)}${refs(item.sources)}${claimLinks(item.claim_ids)}</li>`).join('')}</ul>` : ''}</div></details>`).join(''));

  // Archives
  const filed = new Set();
  function archiveEntities(ids) {
    return uniq(arr(ids)).filter(id => E.has(id)).map(id => {
      if (filed.has(id)) return entityLinks([id]);
      filed.add(id); const entity = E.get(id);
      return `<details class="entity-record" id="${esc(anchor('entity', id))}" data-entity-record="${esc(id)}"><summary>${typeTag(id)}<span><strong>${esc(entity.name)}</strong>${entity.role ? `<small>${esc(entity.role)}</small>` : ''}</span>${registryBadge(entity)}</summary><div class="record-body" data-entity-body="${esc(id)}"></div></details>`;
    }).join('');
  }
  setHtml('archiveList', archives.map(archive => `<details class="archive" id="${esc(anchor('archive', archive.id))}"><summary><span><h3>${esc(archive.title)}</h3><small>${uniq(arr(archive.entity_ids)).filter(id => E.has(id)).length} 个主体 · ${uniq(arr(archive.source_ids)).filter(id => S.has(id)).length} 个档案来源</small></span></summary><div class="archive-body">${archive.intro ? `<p class="archive-intro text">${esc(archive.intro)}</p>` : ''}${renderBlocks(archive.blocks)}${archiveEntities(archive.entity_ids)}${refs(archive.source_ids)}</div></details>`).join(''));
  const unfiled = entities.filter(e => !filed.has(e.id));
  if (unfiled.length && $('archiveList')) $('archiveList').insertAdjacentHTML('beforeend', `<details class="archive" id="other-entities"><summary><span><h3>${archives.length ? '其他主体档案' : '主体档案'}</h3><small>${unfiled.length} 个主体</small></span></summary><div class="archive-body">${archiveEntities(unfiled.map(e => e.id))}</div></details>`);
  setText('archiveCount', `${E.size} 个主体 · 履历、字段、事实与直接关系`);
  function materialize(record) {
    const body = record.querySelector('[data-entity-body]');
    if (!body || body.dataset.loaded) return;
    const id = body.dataset.entityBody;
    body.innerHTML = `${entityIntro(id, 'h4')}<div class="network-path">${pathHtml(id, 'open-entity')}</div><button type="button" class="secondary profile-action" data-locate="${esc(id)}">在关系网络中定位 →</button>${entityBody(id)}`;
    body.dataset.loaded = 'true';
  }

  // Timeline
  setHtml('timelineList', events.map((event, i) => `<article class="timeline-item" id="${esc(anchor('event', event.id ?? i))}"><time>${esc(event.date)}</time><h3>${esc(event.title)}</h3>${event.text ? text(event.text) : ''}${entityLinks(event.entity_ids)}${refs(event.sources)}${claimLinks(event.claim_ids)}</article>`).join(''));

  // Sources
  function sourceMeta(source) {
    return [sourceKinds[source.kind] || source.kind, source.publisher, source.published_at && `发布 ${source.published_at}`, source.effective_at && `生效 ${source.effective_at}`, source.as_of && `事实截至 ${source.as_of}`, (source.accessed_at || source.observed_at) && `访问 ${source.accessed_at || source.observed_at}`].filter(Boolean);
  }
  function sourceBody(source) {
    const url = safeUrl(source.url), shots = snapshots.filter(s => s.source_id === source.id);
    const link = url && !url.startsWith('#') ? `<a class="source-url" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)} ↗</a>` : source.url && !String(source.url).startsWith('#') ? `<span class="source-url">${esc(source.url)}</span>` : '';
    return `<div class="source-meta">${sourceMeta(source).map(item => `<span>${esc(item)}</span>`).join('')}</div>${source.locator ? `<p class="source-locator">定位：${esc(source.locator)}</p>` : ''}${source.excerpt ? `<p class="source-excerpt">${esc(source.excerpt)}</p>` : ''}${link}${shots.length ? `<details class="source-snapshots"><summary>证据存档 · ${shots.length}</summary>${shots.map(snapshotHtml).join('')}</details>` : ''}${source.origin_id && S.has(source.origin_id) ? `<div class="source-meta"><span>原始来源</span>${refs([source.origin_id])}</div>` : ''}`;
  }
  const sourceHtml = source => `<article class="source-card" id="${esc(anchor('source', source.id))}" data-source-card="${esc(source.id)}" tabindex="-1"><div class="source-heading"><span class="source-id"><span class="source-kind-glyph" aria-hidden="true">${esc(sourceGlyphs[source.kind] || '源')}</span>${esc(source.id)}</span><h3>${esc(source.title)}</h3>${status(source.status)}</div>${sourceBody(source)}</article>`;
  setHtml('sourceList', sources.map(sourceHtml).join(''));
  setText('sourceCount', `${S.size} 个来源 · ${sources.filter(s => !s.origin_id).length} 个原始来源条目`);
  setText('sourceSearchCount', `${S.size} 条`);
  function filterSources() {
    const input = $('sourceSearch'), query = (input?.value || '').trim().toLocaleLowerCase(); let count = 0;
    document.querySelectorAll('[data-source-card]').forEach(card => {
      const s = S.get(card.dataset.sourceCard), matched = [s.id, s.title, s.publisher, s.url, s.kind, sourceKinds[s.kind], s.locator, s.excerpt].join(' ').toLocaleLowerCase().includes(query);
      card.hidden = !matched; if (matched) count++;
    });
    setText('sourceSearchCount', `${count} / ${S.size} 条`);
  }

  // Navigation
  const autoNavItems = [{id:'overview', title:LBL.judgmentLabel}, {id:'network', title:'关系网络'}, ...(cooccurrenceVisible() ? [{id:'cooccurrenceSection', title:'二跳共现'}] : []), ...sections.map(s => ({id:s.id, title:s.title})), ...(questions.length ? [{id:'questions', title:'核心问题'}] : []), ...(entities.length || archives.length ? [{id:'archives', title:'完整档案'}] : []), ...(events.length ? [{id:'timeline', title:'时间线'}] : []), {id:'sources', title:'资料来源'}];
  const configuredNav = arr(meta.navigation).filter(item => item && typeof item.target === 'string' && $(item.target));
  const navItems = (configuredNav.length ? configuredNav.map(item => ({id:item.target, title:item.label || item.target})) : autoNavItems).filter(item => $(item.id));
  setHtml('reportNav', navItems.map((item, i) => `<a href="${href(item.id)}" data-nav="${esc(item.id)}"${i === 0 ? ' class="active" aria-current="location"' : ''}><span>${pad(i + 1)}</span>${esc(item.title)}</a>`).join(''));
  setHidden('questions', !questions.length); setHidden('archives', !entities.length && !archives.length); setHidden('timeline', !events.length);

  // Slide-over drawer
  const drawer = {stack:[], index:-1, lastFocus:null};
  const narrow = () => media('(max-width: 1023px)');
  const current = () => drawer.stack[drawer.index];
  function validEntry(entry) {
    if (!entry) return false;
    if (entry.kind === 'entity') return E.has(entry.id);
    if (entry.kind === 'pair') return relationMap.has(entry.id);
    if (entry.kind === 'source') return S.has(entry.id);
    if (entry.kind === 'claims') return arr(entry.ids).some(id => C.has(id));
    return false;
  }
  const entryTitle = entry => entry.kind === 'entity' ? name(entry.id) : entry.kind === 'pair' ? `${name(relationMap.get(entry.id).a)} ↔ ${name(relationMap.get(entry.id).b)}` : entry.kind === 'source' ? S.get(entry.id).title : '判断与依据';
  const entrySame = (a, b) => a && b && a.kind === b.kind && (a.kind === 'claims' ? arr(a.ids).join(',') === arr(b.ids).join(',') : a.id === b.id);
  function openDrawer(entry, options = {}) {
    if (!validEntry(entry)) return;
    if (entry.kind === 'claims') entry = {...entry, ids:uniq(arr(entry.ids)).filter(id => C.has(id))};
    const el = $('drawer'); if (!el) return;
    if (el.hidden) drawer.lastFocus = document.activeElement;
    hidePopover();
    if (!entrySame(current(), entry)) {
      drawer.stack = drawer.stack.slice(0, drawer.index + 1); drawer.stack.push({tab:'overview', ...entry});
      if (drawer.stack.length > 20) drawer.stack.shift();
      drawer.index = drawer.stack.length - 1;
    } else if (entry.tab) current().tab = entry.tab;
    renderDrawer(); showDrawer(); if (!options.keepHash) writeHash();
    const heading = $('drawerTitle'); if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({preventScroll:true}); }
  }
  function entityTabs(id) {
    const p = entityParts(id), entity = p.entity;
    const allImages = imageGrid(uniq([...arr(entity.image_ids), ...arr(entity.sections).flatMap(s => arr(s.image_ids))]));
    const overview = `<div class="network-path">${pathHtml(id, 'open-entity')}</div>${entityIntro(id, 'h3')}${profileSection('穿透持股（计算值）', p.ownership)}${profileSection('基本信息', p.fields)}${profileSection('登记标识', p.identifiers ? `<dl class="field-grid">${p.identifiers}</dl>` : '')}${p.customText}${profileSection('收录档案', p.membership ? `<div class="entity-links">${p.membership}</div>` : '')}`;
    return [
      {key:'overview', label:'概览', html:overview},
      {key:'relations', label:`关系 · ${p.relationCount}`, html:p.relations},
      {key:'records', label:'履历与事实', html:`${profileSection('履历与具体工作', p.career)}${profileSection('事实与记录', p.facts)}`},
      {key:'images', label:'图片', html:allImages},
      {key:'sources', label:`来源 · ${p.sourceCount}`, html:p.sources}
    ].filter((tab, i) => i === 0 || tab.html);
  }
  function renderDrawer() {
    const entry = current(); if (!entry) return;
    const badge = $('drawerBadge'), tabsEl = $('drawerTabs'), body = $('drawerBody');
    setText('drawerTitle', entryTitle(entry));
    if (badge) badge.innerHTML = entry.kind === 'entity' ? `${typeTag(entry.id)}${status(E.get(entry.id).status)}` : entry.kind === 'pair' ? `<span class="type-tag">逐条关系 · ${relationMap.get(entry.id).records.length}</span>` : entry.kind === 'source' ? `<span class="type-tag"><span class="source-kind-glyph" aria-hidden="true">${esc(sourceGlyphs[S.get(entry.id).kind] || '源')}</span>${esc(sourceKinds[S.get(entry.id).kind] || '来源')} · ${esc(entry.id)}</span>` : `<span class="type-tag">${entry.ids.length} 条依据</span>`;
    const crumbs = drawer.stack.slice(Math.max(0, drawer.index - 3), drawer.index);
    setHtml('drawerCrumb', crumbs.map((c, i) => `<button type="button" class="crumb" data-crumb="${drawer.index - crumbs.length + i}">${esc(entryTitle(c))}</button>`).join('<span aria-hidden="true"> / </span>'));
    const back = $('drawerBack'); if (back) back.disabled = drawer.index <= 0;
    const locate = $('drawerLocate'); if (locate) locate.hidden = !(entry.kind === 'entity' || entry.kind === 'pair');
    let html = '';
    if (entry.kind === 'entity') {
      const tabs = entityTabs(entry.id);
      if (!tabs.some(t => t.key === entry.tab)) entry.tab = 'overview';
      if (tabsEl) { tabsEl.hidden = tabs.length < 2; tabsEl.setAttribute('role', 'tablist'); tabsEl.innerHTML = tabs.map(t => `<button type="button" class="drawer-tab" role="tab" id="drawer-tab-${t.key}" aria-controls="drawerPanel" aria-selected="${String(t.key === entry.tab)}" tabindex="${t.key === entry.tab ? '0' : '-1'}" data-drawer-tab="${t.key}">${esc(t.label)}</button>`).join(''); }
      html = `<div class="drawer-panel" id="drawerPanel" role="tabpanel" aria-labelledby="drawer-tab-${entry.tab}">${tabs.find(t => t.key === entry.tab).html}</div>`;
    } else {
      if (tabsEl) { tabsEl.hidden = true; tabsEl.innerHTML = ''; }
      if (entry.kind === 'pair') { const pair = relationMap.get(entry.id); html = `<div class="drawer-panel">${sortRelations(pair.records).map(relationHtml).join('')}${entityLinks([pair.a, pair.b])}</div>`; }
      else if (entry.kind === 'claims') html = `<div class="drawer-panel">${entry.ids.map(id => claimHtml(C.get(id))).join('')}</div>`;
      else {
        const source = S.get(entry.id);
        const citing = entities.filter(e => entitySourceIds(e).includes(entry.id)).map(e => e.id);
        const citingClaims = [...C.values()].filter(c => arr(c.source_ids).includes(entry.id) || arr(c.evidence).some(ev => ev.source_id === entry.id)).map(c => c.id);
        html = `<div class="drawer-panel"><article class="source-card"><div class="source-heading"><span class="source-id">${esc(source.id)}</span>${status(source.status)}</div>${sourceBody(source)}</article><p><a class="secondary" href="${href(anchor('source', source.id))}" data-jump-source="${esc(source.id)}">在来源索引中查看 ↓</a></p>${profileSection(`引用此来源的主体 · ${citing.length}`, entityLinks(citing))}${profileSection('相关判断依据', claimLinks(citingClaims))}</div>`;
      }
    }
    if (body) { body.innerHTML = html; body.scrollTop = 0; }
  }
  function updateLock() {
    const locked = expandedGraph() || Boolean($('searchDialog')?.open) || Boolean($('lightboxDialog')?.open) || (!$('drawer')?.hidden && narrow());
    document.body.classList.toggle('lock-scroll', locked);
  }
  function showDrawer() {
    const el = $('drawer'); if (!el) return;
    el.hidden = false; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', String(narrow()));
    document.body.classList.add('drawer-open'); setHidden('drawerBackdrop', false); updateLock();
  }
  function closeDrawer() {
    const el = $('drawer'); if (!el || el.hidden) return;
    el.hidden = true; document.body.classList.remove('drawer-open'); setHidden('drawerBackdrop', true);
    drawer.stack = []; drawer.index = -1; clearHash(); updateLock();
    const back = drawer.lastFocus; drawer.lastFocus = null;
    if (back && document.contains(back) && typeof back.focus === 'function') back.focus({preventScroll:true});
  }
  function drawerGo(index) { if (index < 0 || index >= drawer.stack.length) return; drawer.index = index; renderDrawer(); writeHash(); }
  function writeHash() {
    const entry = current(); if (!entry) return;
    const code = {entity:'e', pair:'p', source:'s', claims:'c'}[entry.kind];
    const value = entry.kind === 'claims' ? entry.ids.map(encodeURIComponent).join(',') : encodeURIComponent(entry.id);
    try { history.replaceState(null, '', `#/${code}/${value}`); } catch (_) {}
  }
  function clearHash() { if (/^#\//.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} } }
  function readHash() {
    const match = /^#\/([epsc])\/(.+)$/.exec(location.hash || ''); if (!match) return false;
    let value; try { value = decodeURIComponent(match[2]); } catch (_) { return false; }
    const kind = {e:'entity', p:'pair', s:'source', c:'claims'}[match[1]];
    const entry = kind === 'claims' ? {kind, ids:match[2].split(',').map(v => { try { return decodeURIComponent(v); } catch (_) { return v; } })} : {kind, id:value};
    if (!validEntry(entry)) return false;
    openDrawer(entry, {keepHash:true}); return true;
  }
  function copyDrawerLink() {
    writeHash();
    const url = location.href, button = $('drawerCopyLink');
    const done = ok => { if (!button) return; const label = button.dataset.label || button.textContent; button.dataset.label = label; button.textContent = ok ? '已复制' : '复制失败'; setTimeout(() => { button.textContent = button.dataset.label; }, 1500); };
    const fallback = () => { const input = document.createElement('textarea'); input.value = url; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} input.remove(); done(ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), fallback); else fallback();
  }

  // Source citation popover
  const pop = {timer:0, hideTimer:0, chip:null};
  function hidePopover() {
    clearTimeout(pop.timer); clearTimeout(pop.hideTimer);
    const el = $('sourcePopover'); if (el) el.hidden = true;
    if (pop.chip) pop.chip.removeAttribute('aria-describedby'); pop.chip = null;
  }
  function showPopover(chip) {
    const el = $('sourcePopover'), source = S.get(chip?.dataset.source); if (!el || !source) return;
    const url = safeUrl(source.url), info = sourceMeta(source).slice(1);
    el.innerHTML = `<div class="pop-kind"><span class="source-kind-glyph" aria-hidden="true">${esc(sourceGlyphs[source.kind] || '源')}</span>${esc(sourceKinds[source.kind] || source.kind || '来源')} · ${esc(source.id)}</div><div class="pop-title">${esc(source.title)}</div>${info.length ? `<div class="pop-meta">${esc(info.join(' · '))}</div>` : ''}${source.locator ? `<div class="pop-locator">定位：${esc(source.locator)}</div>` : ''}${source.excerpt ? `<p class="pop-excerpt">${esc(source.excerpt)}</p>` : ''}<div class="pop-actions"><button type="button" class="secondary" data-open-source="${esc(source.id)}">在侧栏打开 →</button>${url && !url.startsWith('#') ? `<a class="secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a>` : ''}</div>`;
    el.setAttribute('role', 'tooltip'); el.hidden = false;
    const rect = chip.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let top = rect.bottom + 8; if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    el.style.top = `${Math.round(top)}px`; el.style.left = `${Math.round(clamp(rect.left, 8, Math.max(8, window.innerWidth - w - 8)))}px`;
    if (pop.chip && pop.chip !== chip) pop.chip.removeAttribute('aria-describedby');
    pop.chip = chip; chip.setAttribute('aria-describedby', 'sourcePopover');
  }
  function schedulePopover(chip) {
    if (chip.closest('dialog')) return;
    clearTimeout(pop.hideTimer); clearTimeout(pop.timer);
    if (pop.chip === chip && !$('sourcePopover')?.hidden) return;
    pop.timer = setTimeout(() => showPopover(chip), 300);
  }
  function scheduleHide() { clearTimeout(pop.timer); clearTimeout(pop.hideTimer); pop.hideTimer = setTimeout(hidePopover, 220); }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const chip = event.target.closest?.('.source-ref[data-source]');
    if (chip) schedulePopover(chip); else if (event.target.closest?.('#sourcePopover')) clearTimeout(pop.hideTimer);
  });
  document.addEventListener('pointerout', event => {
    const from = event.target.closest?.('.source-ref[data-source], #sourcePopover');
    if (!from) return;
    const to = event.relatedTarget?.closest?.('.source-ref[data-source], #sourcePopover');
    if (!to) scheduleHide();
  });
  document.addEventListener('focusin', event => {
    const chip = event.target.closest?.('.source-ref[data-source]');
    if (chip) schedulePopover(chip); else if (!event.target.closest?.('#sourcePopover')) scheduleHide();
  });

  // Image lightbox
  const LB = {items:[], index:0, scale:1, x:0, y:0, drag:null};
  function lightboxTransform() {
    const img = $('lightboxImg'); if (img) img.style.transform = `translate(${LB.x}px, ${LB.y}px) scale(${LB.scale})`;
    const stage = $('lightboxStage'); if (stage) stage.classList.toggle('is-zoomed', LB.scale > 1);
  }
  function lightboxZoom(factor, cx = 0, cy = 0) {
    const next = clamp(LB.scale * factor, 1, 6), k = next / LB.scale;
    LB.x = cx - (cx - LB.x) * k; LB.y = cy - (cy - LB.y) * k; LB.scale = next;
    if (next === 1) { LB.x = 0; LB.y = 0; }
    lightboxTransform();
  }
  function renderLightbox() {
    const asset = A.get(LB.items[LB.index]), img = $('lightboxImg'); if (!asset || !img) return;
    img.src = asset.data_uri; img.alt = asset.alt || asset.caption || '';
    setHtml('lightboxCaption', `<span>${esc(asset.caption || asset.alt || '')}</span>${asset.observed_at ? `<small> · ${esc(asset.observed_at)}</small>` : ''}${LB.items.length > 1 ? `<small> · ${LB.index + 1} / ${LB.items.length}</small>` : ''}${refs(asset.sources)}`);
    const single = LB.items.length < 2;
    ['lightboxPrev', 'lightboxNext'].forEach(id => { const b = $(id); if (b) { b.hidden = single; b.disabled = single; } });
    LB.scale = 1; LB.x = 0; LB.y = 0; lightboxTransform();
  }
  function openLightbox(trigger) {
    const dialog = $('lightboxDialog'), id = trigger?.dataset.lightbox;
    if (!dialog || !A.has(id) || !imageUri(A.get(id).data_uri)) return;
    const scope = trigger.closest('.image-grid, .drawer-panel, .identity-card, .archive-body, .content-block') || trigger.parentElement;
    const ids = uniq([...scope.querySelectorAll('[data-lightbox]')].map(b => b.dataset.lightbox).filter(x => A.has(x) && imageUri(A.get(x).data_uri)));
    LB.items = ids.length ? ids : [id]; LB.index = Math.max(0, LB.items.indexOf(id));
    hidePopover(); renderLightbox();
    if (!dialog.open) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
    updateLock();
  }
  function lightboxStep(delta) { if (LB.items.length < 2) return; LB.index = (LB.index + delta + LB.items.length) % LB.items.length; renderLightbox(); }
  function closeLightbox() { const d = $('lightboxDialog'); if (d?.open) { if (d.close) d.close(); else d.removeAttribute('open'); } updateLock(); }
  on('lightboxPrev', 'click', () => lightboxStep(-1)); on('lightboxNext', 'click', () => lightboxStep(1));
  on('lightboxZoomIn', 'click', () => lightboxZoom(1.25)); on('lightboxZoomOut', 'click', () => lightboxZoom(.8));
  on('lightboxReset', 'click', () => { LB.scale = 1; LB.x = 0; LB.y = 0; lightboxTransform(); });
  on('closeLightbox', 'click', closeLightbox);
  on('lightboxDialog', 'close', updateLock);
  on('lightboxDialog', 'click', event => { if (event.target === $('lightboxDialog')) closeLightbox(); });
  on('lightboxDialog', 'keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); lightboxStep(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); lightboxStep(1); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); lightboxZoom(1.25); }
    else if (event.key === '-') { event.preventDefault(); lightboxZoom(.8); }
    else if (event.key === '0') { event.preventDefault(); LB.scale = 1; LB.x = 0; LB.y = 0; lightboxTransform(); }
  });
  const stageCenter = event => { const r = $('lightboxStage').getBoundingClientRect(); return [event.clientX - r.left - r.width / 2, event.clientY - r.top - r.height / 2]; };
  on('lightboxStage', 'wheel', event => { event.preventDefault(); const [cx, cy] = stageCenter(event); lightboxZoom(event.deltaY > 0 ? .88 : 1.14, cx, cy); }, {passive:false});
  on('lightboxStage', 'dblclick', event => { const [cx, cy] = stageCenter(event); if (LB.scale > 1) { LB.scale = 1; LB.x = 0; LB.y = 0; lightboxTransform(); } else lightboxZoom(2, cx, cy); });
  on('lightboxStage', 'pointerdown', event => { if (LB.scale <= 1 || event.button !== 0) return; LB.drag = {id:event.pointerId, x:event.clientX, y:event.clientY}; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); });
  on('lightboxStage', 'pointermove', event => { if (!LB.drag || LB.drag.id !== event.pointerId) return; LB.x += event.clientX - LB.drag.x; LB.y += event.clientY - LB.drag.y; LB.drag.x = event.clientX; LB.drag.y = event.clientY; lightboxTransform(); });
  const endDrag = () => { LB.drag = null; };
  on('lightboxStage', 'pointerup', endDrag); on('lightboxStage', 'pointercancel', endDrag);

  // ───────────── Graph 2.0: state, filters and layouts ─────────────
  const coreIds = uniq([rootId, ...arr(meta.core_ids)]).filter(id => E.has(id));
  if (coreIds.length < 2 && root) coreIds.push(...uniq(adj(rootId).filter(confirmed).map(e => other(e, rootId))).sort((a, b) => (num(E.get(b).importance) || adj(b).length) - (num(E.get(a).importance) || adj(a).length)).slice(0, 22));
  if (!coreIds.length) coreIds.push(...entities.slice(0, 30).map(e => e.id));
  const coreSet = new Set(coreIds);
  const G = {view:'core', layout:'radial', selected:E.has(rootId) ? rootId : coreIds[0], pair:null, visible:[], vpairs:[], ghost:new Set(), layoutPos:new Map(), extra:new Set(), typeOff:new Set(), famOff:new Set(), showHistorical:true, hiddenNodes:0, hiddenEdges:0,
    box:{x:-500, y:-350, w:1000, h:700}, fitWidth:1000, expanded:false, active:false, list:false, pointer:null, touches:new Map(), pinch:null, anim:0, peek:false, printing:false, toastTimer:0, toastAt:0,
    nodeEls:new Map(), edgeEls:new Map(), labelEls:new Map(), path:{open:false, results:[], chosen:-1}};
  function expandedGraph() { return G.expanded; }
  const recordVisible = edge => !G.famOff.has(family(edge)) && (G.showHistorical || edge.status !== 'historical');
  const nodeRadius = (id, degree) => id === rootId ? 26 : Math.min(18, 11 + Math.sqrt(degree || 1) * 1.2);

  function computeVisibleSets() {
    let base = G.view === 'all' ? entities.map(e => e.id) : G.view === 'near' ? [G.selected, ...adj(G.selected).map(e => other(e, G.selected)), rootId] : [...coreIds];
    base.push(...G.extra);
    if (G.path.chosen >= 0 && G.path.results[G.path.chosen]) base.push(...G.path.results[G.path.chosen].ids);
    base = uniq(base).filter(id => E.has(id));
    const withPaths = uniq([...base, ...base.flatMap(id => pathTo(id)?.ids || [])]);
    const keep = id => id === rootId || id === G.selected || !G.typeOff.has(etype(id));
    let kept = withPaths.filter(keep);
    const ghost = new Set(), pathPairs = new Set();
    for (const id of kept) { const p = pathTo(id); if (!p) continue; p.ids.forEach(pid => { if (!keep(pid)) ghost.add(pid); }); p.edges.forEach(e => pathPairs.add(pairKey(e.from, e.to))); }
    let ids = new Set([...kept, ...ghost]), vpairs = [], hiddenEdges = 0;
    const filtering = G.famOff.size > 0 || !G.showHistorical;
    for (const pair of pairs) {
      if (!ids.has(pair.a) || !ids.has(pair.b)) continue;
      const recs = pair.records.filter(recordVisible);
      if (recs.length && !ghost.has(pair.a) && !ghost.has(pair.b)) { vpairs.push({pair, recs, ghost:false}); hiddenEdges += pair.records.length - recs.length; }
      else if (pathPairs.has(pair.key)) vpairs.push({pair, recs:pair.records.filter(confirmed), ghost:true});
      else hiddenEdges += pair.records.length;
    }
    if (filtering) {
      const linked = new Set(vpairs.flatMap(v => [v.pair.a, v.pair.b]));
      const hadPairs = new Set(pairs.filter(p => ids.has(p.a) && ids.has(p.b)).flatMap(p => [p.a, p.b]));
      kept = kept.filter(id => id === rootId || id === G.selected || linked.has(id) || !hadPairs.has(id));
      ids = new Set([...kept, ...ghost]);
      vpairs = vpairs.filter(v => ids.has(v.pair.a) && ids.has(v.pair.b));
    }
    G.ghost = ghost; G.hiddenNodes = withPaths.length - kept.length; G.hiddenEdges = hiddenEdges;
    return {ids:[...ids], vpairs};
  }

  function relax(nodes, vpairs, layout, options) {
    const {anchor = .017, steps: maxSteps = 200, gravity = 0} = options;
    const steps = Math.min(maxSteps, Math.max(30, Math.floor(24000 / Math.max(1, nodes.length))));
    for (let step = 0; step < steps; step++) {
      const alpha = 1 - step / (steps + 24);
      for (const n of nodes) { n.fx = (n.ax - n.x) * anchor - n.x * gravity; n.fy = (n.ay - n.y) * anchor - n.y * gravity; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y;
        if (Math.abs(dx) + Math.abs(dy) < .01) { dx = .2; dy = .13; }
        const d2 = dx * dx + dy * dy, d = Math.sqrt(d2), gap = a.r + b.r + (a.id === rootId || b.id === rootId ? 96 : 52);
        const force = Math.min(9, 2200 / (d2 + 50)) + (d < gap ? (gap - d) * .11 : 0);
        const fx = dx / d * force, fy = dy / d * force; a.fx += fx; a.fy += fy; b.fx -= fx; b.fy -= fy;
        const labelGap = G.view === 'all' && !coreSet.has(a.id) && !coreSet.has(b.id) ? 88 : 138;
        if (Math.abs(dy) < 38 && Math.abs(dx) < labelGap) { const push = (labelGap - Math.abs(dx)) * .038 * (dx >= 0 ? 1 : -1); a.fx += push; b.fx -= push; }
      }
      for (const v of vpairs) {
        const a = layout.get(v.pair.a), b = layout.get(v.pair.b); if (!a || !b || a === b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const target = 156 + Math.min(80, (a.degree + b.degree) * 3.5), f = (d - target) * .014;
        a.fx += dx / d * f; a.fy += dy / d * f; b.fx -= dx / d * f; b.fy -= dy / d * f;
      }
      for (const n of nodes) { if (n.id === rootId) continue; n.x += clamp(n.fx, -12, 12) * alpha; n.y += clamp(n.fy, -12, 12) * alpha; }
    }
  }
  function sectorOf(id) {
    const entity = E.get(id);
    if (entity.status === 'candidate' || !distance.has(id)) return 'outer';
    const step = parent.get(id);
    if (step && isCapital(step.edge) && step.edge.from === id) return 'owners';
    if (entity.type === 'investor') return 'owners';
    if (entity.type === 'product' || entity.type === 'brand') return 'products';
    if (entity.type === 'person') return 'people';
    return 'business';
  }
  const SECTOR_ANGLE = {owners:-Math.PI / 2, business:0, products:Math.PI / 2, people:Math.PI};
  function radialTargets(nodes) {
    const groups = new Map(), byId = new Map(nodes.map(n => [n.id, n]));
    let maxR = 170;
    for (const n of nodes) {
      if (n.id === rootId) { n.ax = 0; n.ay = 0; continue; }
      const sector = sectorOf(n.id), depth = Math.max(1, distance.get(n.id) || 1), key = sector === 'outer' ? 'outer' : `${sector}:${depth}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(n.id);
    }
    const order = id => [String(branch.get(id) ?? ''), -(num(E.get(id).importance) || 0), hash(id)];
    const cmp = (a, b) => { const x = order(a), y = order(b); return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2]; };
    for (const [key, list] of groups) {
      if (key === 'outer') continue;
      const [sector, depthText] = key.split(':'), depth = Number(depthText), center = SECTOR_ANGLE[sector];
      list.sort(cmp);
      let radius = 235 + (depth - 1) * 145, index = 0;
      while (index < list.length) {
        const stepAngle = Math.max(115 / radius, .24), capacity = Math.max(1, Math.floor(2.62 / stepAngle) + 1), chunk = list.slice(index, index + capacity);
        chunk.forEach((id, i) => { const angle = center + (i - (chunk.length - 1) / 2) * stepAngle, n = byId.get(id); n.ax = Math.cos(angle) * radius; n.ay = Math.sin(angle) * radius; });
        maxR = Math.max(maxR, radius); index += capacity; radius += 75;
      }
    }
    const outer = (groups.get('outer') || []).sort(cmp), outerR = maxR + 140;
    outer.forEach((id, i) => { const angle = -Math.PI / 2 + Math.PI / Math.max(2, outer.length) + Math.PI * 2 * i / Math.max(1, outer.length), n = byId.get(id); n.ax = Math.cos(angle) * outerR; n.ay = Math.sin(angle) * outerR; });
  }
  function hierarchyTargets(nodes, vpairs) {
    const set = new Set(nodes.map(n => n.id)), byId = new Map(nodes.map(n => [n.id, n])), vadj = new Map(nodes.map(n => [n.id, []]));
    const capCandidates = [];
    for (const v of vpairs) for (const rec of v.recs.length ? v.recs : v.pair.records) {
      if (!set.has(rec.from) || !set.has(rec.to) || rec.from === rec.to) continue;
      vadj.get(rec.from).push({other:rec.to, rec}); vadj.get(rec.to).push({other:rec.from, rec});
      if (family(rec) === 'capital') capCandidates.push(rec);
    }
    const layer = new Map(), lane = new Map(), start = set.has(rootId) ? rootId : nodes.slice().sort((a, b) => b.degree - a.degree)[0]?.id;
    if (start == null) return;
    capCandidates.sort((a, b) => Number(a.status === 'historical') - Number(b.status === 'historical') || Number(a.from !== start && a.to !== start) - Number(b.from !== start && b.to !== start) || (num(b.percent) || 0) - (num(a.percent) || 0));
    const capOut = new Map(nodes.map(n => [n.id, []])), capIn = new Map(nodes.map(n => [n.id, []])), capSeen = new Set();
    const canReach = (src, dst) => { const q = [src], vis = new Set([src]); for (let i = 0; i < q.length; i++) { if (q[i] === dst) return true; for (const nx of capOut.get(q[i])) if (!vis.has(nx)) { vis.add(nx); q.push(nx); } } return false; };
    for (const rec of capCandidates) {
      const key = `${rec.from}->${rec.to}`;
      if (capSeen.has(key) || canReach(rec.to, rec.from)) continue;
      capSeen.add(key); capOut.get(rec.from).push(rec.to); capIn.get(rec.to).push(rec.from);
    }
    const indeg = new Map(nodes.map(n => [n.id, capIn.get(n.id).length]));
    const topo = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    for (let i = 0; i < topo.length; i++) for (const v of capOut.get(topo[i])) { indeg.set(v, indeg.get(v) - 1); if (indeg.get(v) === 0) topo.push(v); }
    const revTopo = topo.slice().reverse();
    const propagateCapital = () => {
      let prev = -1;
      while (layer.size !== prev) {
        prev = layer.size;
        const fixed = new Set(layer.keys());
        for (const u of topo) {
          if (!layer.has(u)) continue;
          for (const v of capOut.get(u)) if (!fixed.has(v)) { layer.set(v, Math.max(layer.get(v) ?? -Infinity, layer.get(u) + 1)); lane.set(v, lane.get(u) || 'main'); }
        }
        for (const u of revTopo) {
          if (layer.has(u)) continue;
          const targets = capOut.get(u).filter(v => layer.has(v));
          if (targets.length) { layer.set(u, Math.min(...targets.map(v => layer.get(v) - 1))); lane.set(u, lane.get(targets[0]) || 'main'); }
        }
      }
    };
    layer.set(start, 0); lane.set(start, 'main');
    propagateCapital();
    const queue = [...layer.keys()];
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i], lu = layer.get(u), pl = lane.get(u);
      const list = vadj.get(u).slice().sort((a, b) => FAMILY_ORDER.indexOf(family(a.rec)) - FAMILY_ORDER.indexOf(family(b.rec)));
      for (const {other:v, rec} of list) {
        if (layer.has(v)) continue;
        const tv = etype(v), tu = etype(u);
        let L = lu, ln = pl;
        if (tv === 'product' || tv === 'brand') L = lu + 1;
        else if (tu === 'person' && ORG_TYPES.has(tv)) { L = lu + 1; ln = pl === 'left' ? 'main' : pl; }
        else if (tv === 'person' && tu !== 'person') ln = pl === 'main' ? 'left' : pl;
        else ln = pl === 'main' ? 'right' : pl;
        layer.set(v, L); lane.set(v, ln);
        propagateCapital();
        for (const k of layer.keys()) if (!queue.includes(k)) queue.push(k);
      }
    }
    const reachedLayers = [...layer.values()], maxLayer = reachedLayers.length ? Math.max(...reachedLayers) : 0;
    for (const n of nodes) if (!layer.has(n.id)) { layer.set(n.id, maxLayer + 1); lane.set(n.id, 'detached'); }
    const groups = new Map();
    for (const n of nodes) { const key = `${layer.get(n.id)}|${lane.get(n.id)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(n.id); }
    for (const list of groups.values()) list.sort((a, b) => (num(E.get(b).importance) || 0) - (num(E.get(a).importance) || 0) || hash(a) - hash(b));
    const SX = 168, SY = 152;
    const assign = () => {
      let mainHalf = 0;
      for (const [key, list] of groups) if (key.endsWith('|main') || key.endsWith('|detached')) mainHalf = Math.max(mainHalf, (list.length - 1) / 2 * SX);
      for (const [key, list] of groups) {
        const [L, ln] = key.split('|'), y = (ln === 'detached' ? Number(L) + .5 : Number(L)) * SY;
        list.forEach((id, i) => {
          const n = byId.get(id); n.ay = y;
          n.ax = ln === 'left' ? -mainHalf - 195 - (list.length - 1 - i) * SX : ln === 'right' ? mainHalf + 195 + i * SX : (i - (list.length - 1) / 2) * SX;
        });
      }
    };
    assign();
    const layers = uniq([...groups.keys()].map(k => Number(k.split('|')[0]))).sort((a, b) => a - b);
    for (let sweep = 0; sweep < 4; sweep++) {
      const seq = sweep % 2 ? layers.slice().reverse() : layers;
      for (const L of seq) for (const [key, list] of groups) {
        if (Number(key.split('|')[0]) !== L) continue;
        const bary = new Map(list.map((id, i) => { const ns = vadj.get(id).map(x => byId.get(x.other)).filter(n => n && layer.get(n.id) !== L); return [id, ns.length ? ns.reduce((s, n) => s + n.ax, 0) / ns.length : byId.get(id).ax + i * 1e-3]; }));
        list.sort((a, b) => bary.get(a) - bary.get(b));
        assign();
      }
    }
    G.hLayer = layer;
  }
  function chooseInitialLayout() {
    const set = new Set(coreIds);
    const recs = pairs.filter(p => set.has(p.a) && set.has(p.b)).flatMap(p => p.records).filter(e => !uncertain(e));
    return recs.length && recs.filter(e => family(e) === 'capital').length / recs.length >= .6 ? 'hierarchy' : 'radial';
  }
  function computeLayout(options = {}) {
    const {ids, vpairs} = computeVisibleSets(), set = new Set(ids), degrees = new Map(ids.map(id => [id, 0]));
    for (const v of vpairs) { degrees.set(v.pair.a, degrees.get(v.pair.a) + 1); if (v.pair.b !== v.pair.a) degrees.set(v.pair.b, degrees.get(v.pair.b) + 1); }
    const old = G.layoutPos;
    const nodes = ids.map(id => ({id, r:nodeRadius(id, degrees.get(id)), degree:degrees.get(id), x:0, y:0, ax:0, ay:0, fx:0, fy:0}));
    const layout = new Map(nodes.map(n => [n.id, n]));
    G.hLayer = null;
    if (G.layout === 'hierarchy') { hierarchyTargets(nodes, vpairs); nodes.forEach(n => { n.x = n.ax; n.y = n.ay; }); }
    else {
      radialTargets(nodes);
      nodes.forEach(n => { const h = hash(n.id), spread = n.id === rootId ? 0 : 18; n.x = n.ax + Math.cos(h % 628 / 100) * spread; n.y = n.ay + Math.sin(h % 628 / 100) * spread; });
      if (G.layout === 'force') { nodes.forEach(n => { const o = old.get(n.id); if (o) { n.x = o.x; n.y = o.y; } }); relax(nodes, vpairs, layout, {anchor:.004, steps:300, gravity:.0015}); }
      else relax(nodes, vpairs, layout, {anchor:.05, steps:90});
    }
    const targets = new Map(nodes.map(n => [n.id, {x:n.x, y:n.y}]));
    nodes.forEach(n => {
      const o = old.get(n.id) || (pathTo(n.id)?.ids.slice(0, -1).reverse().map(pid => old.get(pid)).find(Boolean));
      if (o && !options.instant) { n.x = o.x; n.y = o.y; }
    });
    G.visible = nodes; G.vpairs = vpairs.filter(v => set.has(v.pair.a) && set.has(v.pair.b)); G.layoutPos = layout;
    drawGraph();
    fitGraph(targets);
    animateTo(targets, options.instant);
  }
  function animateTo(targets, instant) {
    cancelAnimationFrame(G.anim);
    const starts = new Map(G.visible.map(n => [n.id, {x:n.x, y:n.y}]));
    const moved = G.visible.some(n => { const s = starts.get(n.id), t = targets.get(n.id); return Math.abs(s.x - t.x) + Math.abs(s.y - t.y) > .5; });
    if (instant || reduceMotion() || !moved) { G.visible.forEach(n => { const t = targets.get(n.id); n.x = t.x; n.y = t.y; }); updatePositions(); applyLOD(); return; }
    const t0 = performance.now();
    const frame = now => {
      const k = Math.min(1, (now - t0) / 260), e = 1 - Math.pow(1 - k, 3);
      G.visible.forEach(n => { const s = starts.get(n.id), t = targets.get(n.id); n.x = s.x + (t.x - s.x) * e; n.y = s.y + (t.y - s.y) * e; });
      updatePositions();
      if (k < 1) G.anim = requestAnimationFrame(frame); else applyLOD();
    };
    G.anim = requestAnimationFrame(frame);
  }

  // ───────────── Graph 2.0: drawing ─────────────
  const f1 = n => round(n);
  function shapeSvg(type, r, cls = 'node-shape') {
    const k = f1;
    switch (type) {
      case 'company': return `<rect class="${cls}" x="${k(-r)}" y="${k(-r)}" width="${k(2 * r)}" height="${k(2 * r)}" rx="${k(r * .32)}"/>`;
      case 'product': return `<path class="${cls}" d="M0,${k(-1.22 * r)} L${k(1.22 * r)},0 L0,${k(1.22 * r)} L${k(-1.22 * r)},0Z"/>`;
      case 'brand': return `<path class="${cls} hollow" d="M0,${k(-1.22 * r)} L${k(1.22 * r)},0 L0,${k(1.22 * r)} L${k(-1.22 * r)},0Z"/>`;
      case 'investor': return `<path class="${cls}" d="${[0, 1, 2, 3, 4, 5].map(i => { const a = -Math.PI / 2 + i * Math.PI / 3; return `${i ? 'L' : 'M'}${k(Math.cos(a) * r * 1.12)},${k(Math.sin(a) * r * 1.12)}`; }).join(' ')}Z"/>`;
      case 'institution': return `<path class="${cls}" stroke-linejoin="round" d="M0,${k(-1.25 * r)} L${k(1.15 * r)},${k(.85 * r)} L${k(-1.15 * r)},${k(.85 * r)}Z"/>`;
      default: return `<circle class="${cls}" r="${k(r)}"/>`;
    }
  }
  const MARKERS = ['capital', 'business', 'signal', 'candidate', 'disputed', 'active'];
  setHtml('networkDefs', MARKERS.map(key => `<marker id="arrow-${key}" class="arrow arrow-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="arrow-head ${key}" d="M0,1 L9,5 L0,9 z"/></marker>`).join(''));
  function lanesOf(v) {
    if (v.ghost) return [{key:'ghost', cls:'ghost', from:v.pair.a, to:v.pair.b, both:false, recs:v.recs, arrow:false}];
    const groups = new Map();
    for (const rec of v.recs) { const key = styleKey(rec); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rec); }
    const keys = [...groups.keys()].sort((a, b) => MARKERS.indexOf(a) - MARKERS.indexOf(b));
    return keys.map((key, i) => {
      const recs = groups.get(key), forward = recs.some(r => r.from === v.pair.a), backward = recs.some(r => r.from === v.pair.b && v.pair.a !== v.pair.b);
      const from = forward || !backward ? v.pair.a : v.pair.b, to = from === v.pair.a ? v.pair.b : v.pair.a;
      const historical = recs.every(r => r.status === 'historical'), governance = recs.some(r => family(r) === 'governance');
      return {key, cls:`${key}${governance ? ' governance' : ''}${historical ? ' historical' : ''}`, from, to, both:forward && backward, recs, arrow:true, offset:(i - (keys.length - 1) / 2) * 9};
    });
  }
  const posOf = id => G.layoutPos.get(id);
  const CANDIDATE_T = [.5, .34, .66, .25, .75, .42, .58];
  function geometry(v, lane) {
    const a = posOf(lane.from), b = posOf(lane.to), offset = lane.offset || 0;
    if (!a || !b) return {d:'', lx:0, ly:0, sample:() => ({x:0, y:0})};
    if (a === b) { const ly = a.y - 70; return {d:`M${f1(a.x - 8)},${f1(a.y - a.r)} C${f1(a.x - 65)},${f1(a.y - 85)} ${f1(a.x + 65)},${f1(a.y - 85)} ${f1(a.x + 8)},${f1(a.y - a.r)}`, lx:a.x, ly, sample:() => ({x:a.x, y:ly})}; }
    const trimA = a.r + (lane.both ? 5 : 2), trimB = b.r + (lane.arrow ? 5 : 2);
    if (G.layout === 'hierarchy' && Math.abs(a.y - b.y) > 20) {
      const x1 = a.x + offset, x2 = b.x + offset, dir = b.y > a.y ? 1 : -1;
      const sy = a.y + dir * trimA, ey = b.y - dir * trimB;
      const minY = Math.min(a.y, b.y) + 28, maxY = Math.max(a.y, b.y) - 28;
      const mids = G.visible.filter(n => n.id !== lane.from && n.id !== lane.to && n.y > minY && n.y < maxY);
      if (Math.abs(x2 - x1) < 52 && mids.some(n => Math.abs(n.x - (x1 + x2) / 2) < n.r + 42)) {
        const rightBlocked = mids.filter(n => n.x >= (x1 + x2) / 2 && n.x < (x1 + x2) / 2 + 150).length;
        const leftBlocked = mids.filter(n => n.x < (x1 + x2) / 2 && n.x > (x1 + x2) / 2 - 150).length;
        const side = leftBlocked <= rightBlocked ? -1 : 1, bx = (x1 + x2) / 2 + side * 96 + offset, r = 8;
        const y1 = a.y + dir * Math.min(54, Math.abs(b.y - a.y) * .28), y2 = b.y - dir * Math.min(54, Math.abs(b.y - a.y) * .28);
        const d = `M${f1(x1)},${f1(sy)} L${f1(x1)},${f1(y1 - dir * r)} Q${f1(x1)},${f1(y1)} ${f1(x1 + side * r)},${f1(y1)} L${f1(bx - side * r)},${f1(y1)} Q${f1(bx)},${f1(y1)} ${f1(bx)},${f1(y1 + dir * r)} L${f1(bx)},${f1(y2 - dir * r)} Q${f1(bx)},${f1(y2)} ${f1(bx - side * r)},${f1(y2)} L${f1(x2 + side * r)},${f1(y2)} Q${f1(x2)},${f1(y2)} ${f1(x2)},${f1(y2 + dir * r)} L${f1(x2)},${f1(ey)}`;
        const sample = t => ({x:bx, y:y1 + (y2 - y1) * clamp((t - .15) / .7, .08, .92)});
        return {d, lx:bx, ly:(y1 + y2) / 2, sample};
      }
      if (Math.abs(x2 - x1) < 1) {
        const sample = t => ({x:x2, y:sy + (ey - sy) * t});
        return {d:`M${f1(x1)},${f1(sy)} L${f1(x2)},${f1(ey)}`, lx:x2, ly:(sy + ey) / 2, sample};
      }
      let ym = (a.y + b.y) / 2;
      if (mids.some(n => Math.abs(n.y - ym) < 38)) {
        const blockAtX2 = mids.some(n => Math.abs(n.x - x2) < n.r + 36);
        ym = blockAtX2 ? b.y - dir * 74 : a.y + dir * 74;
      }
      const r = Math.min(8, Math.abs(x2 - x1) / 2, Math.abs(ym - sy), Math.abs(ey - ym)), hx = x2 > x1 ? 1 : -1;
      const lx = (x1 + x2) / 2, ly = Math.abs(x2 - x1) >= 24 ? ym : (sy + ey) / 2;
      const sample = t => {
        if (Math.abs(x2 - x1) < 24) return {x:lx, y:sy + (ey - sy) * t};
        if (t === .25) return {x:x1, y:(sy + ym) / 2};
        if (t === .75) return {x:x2, y:(ym + ey) / 2};
        const u = clamp(.5 + (t - .5) * 1.35, .18, .82);
        return {x:x1 + (x2 - x1) * u, y:ym};
      };
      return {d:`M${f1(x1)},${f1(sy)} L${f1(x1)},${f1(ym - dir * r)} Q${f1(x1)},${f1(ym)} ${f1(x1 + hx * r)},${f1(ym)} L${f1(x2 - hx * r)},${f1(ym)} Q${f1(x2)},${f1(ym)} ${f1(x2)},${f1(ym + dir * r)} L${f1(x2)},${f1(ey)}`, lx, ly, sample};
    }
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const sameRowArch = G.layout === 'hierarchy' && Math.abs(a.y - b.y) <= 20 && Math.abs(dx) > 190;
    const bend = sameRowArch ? 0 : (hash(v.pair.key) % 2 ? 1 : -1) * Math.min(20, d * .055) + offset * (lane.from === v.pair.a ? 1 : -1);
    const cx = sameRowArch ? (a.x + b.x) / 2 : (a.x + b.x) / 2 - dy / d * bend;
    const cy = sameRowArch ? (a.y + b.y) / 2 - Math.min(82, 42 + Math.abs(dx) * .06) - offset : (a.y + b.y) / 2 + dx / d * bend;
    const toward = (p, q, t) => { const ex = q.x - p.x, ey2 = q.y - p.y, l = Math.hypot(ex, ey2) || 1; return {x:p.x + ex / l * t, y:p.y + ey2 / l * t}; };
    const s = toward(a, {x:cx, y:cy}, Math.min(trimA, d / 3)), e = toward(b, {x:cx, y:cy}, Math.min(trimB, d / 3));
    const sample = t => { const u = 1 - t; return {x:u * u * s.x + 2 * u * t * cx + t * t * e.x, y:u * u * s.y + 2 * u * t * cy + t * t * e.y}; };
    const mid = sample(.5);
    return {d:`M${f1(s.x)},${f1(s.y)} Q${f1(cx)},${f1(cy)} ${f1(e.x)},${f1(e.y)}`, lx:mid.x, ly:mid.y, sample};
  }
  function graphName(id) {
    const value = E.get(id)?.short_name || name(id), limit = /[\u3400-\u9fff]/.test(value) ? 12 : 22;
    return [...value].length > limit ? `${[...value].slice(0, limit - 1).join('')}…` : value;
  }
  function pillText(v) {
    const caps = v.recs.filter(r => family(r) === 'capital');
    const pcts = uniq(caps.map(r => fmtPct(r.percent)).filter(Boolean));
    if (pcts.length) return pcts.slice(0, 2).join(' / ') + (pcts.length > 2 ? '…' : '');
    const amount = caps.find(r => r.amount != null);
    return amount ? [fmtNum(amount.amount) || valueText(amount.amount), amount.unit || amount.currency].filter(Boolean).join(' ') : '';
  }
  function shortLabel(v) {
    const recs = v.recs.filter(r => family(r) !== 'capital' || !pillText(v));
    if (!recs.length) return '';
    const labels = uniq(recs.map(r => r.role || relLabel(r)));
    let label = labels[0]; if ([...label].length > 8) label = `${[...label].slice(0, 7).join('')}…`;
    return `${label}${labels.length > 1 ? ` +${labels.length - 1}` : ''}${recs.every(r => r.status === 'historical') ? ' · 历史' : ''}`;
  }
  function drawGraph() {
    G.nodeEls.clear(); G.edgeEls.clear(); G.labelEls.clear();
    setHtml('networkLinks', G.vpairs.map(v => {
      const lanes = lanesOf(v); v.lanes = lanes;
      const paths = lanes.map((lane, i) => { const g = geometry(v, lane); const marker = lane.arrow ? ` marker-end="url(#arrow-${lane.key})"${lane.both ? ` marker-start="url(#arrow-${lane.key})"` : ''}` : ''; return `<path class="net-edge ${lane.cls}" data-lane="${i}" d="${g.d}"${marker}/>`; }).join('');
      const tip = v.pair.records.map(edge => `${name(edge.from)} → ${name(edge.to)}：${edge.label || relLabel(edge)}${edge.percent != null ? ` ${fmtPct(edge.percent)}` : ''}`).join('\n');
      return `<g class="edge-group${v.ghost ? ' ghost' : ''}" data-edge="${esc(v.pair.key)}" role="button" tabindex="-1" aria-label="${esc(`${name(v.pair.a)}与${name(v.pair.b)}，${v.pair.records.length} 条关系`)}">${paths}<path class="edge-hit" d="${geometry(v, {...lanes[0], offset:0}).d}"/><title>${esc(tip)}</title></g>`;
    }).join(''));
    setHtml('networkEdgeLabels', G.vpairs.filter(v => !v.ghost).map(v => {
      const pill = pillText(v), label = shortLabel(v), pillHist = pill && v.recs.filter(r => family(r) === 'capital').every(r => r.status === 'historical');
      const w = [...pill].length * 7.6 + 16;
      return `${pill ? `<g class="edge-pill capital${pillHist ? ' historical' : ''}" data-edge-label="${esc(v.pair.key)}" data-kind="pill"><rect x="${f1(-w / 2)}" y="-10" width="${f1(w)}" height="20" rx="10"/><text text-anchor="middle">${esc(pill)}</text></g>` : ''}${label ? `<text class="edge-label" data-edge-label="${esc(v.pair.key)}" data-kind="label" text-anchor="middle">${esc(label)}</text>` : ''}`;
    }).join(''));
    setHtml('networkNodes', G.visible.map(node => {
      const entity = E.get(node.id), isRoot = node.id === rootId, secondary = G.view === 'all' && !coreSet.has(node.id) && node.degree < 5;
      const cls = `net-node ${tcls(node.id)}${isRoot ? ' is-root' : ''}${entity.status === 'candidate' ? ' is-candidate' : ''}${G.ghost.has(node.id) ? ' ghost' : ''}`;
      return `<g class="${cls}" data-node="${esc(node.id)}" transform="translate(${f1(node.x)},${f1(node.y)})" tabindex="0" role="button" aria-label="${esc(`${entity.name}，${types[entity.type] || entity.type}${isRoot ? '，调查主体' : ''}。回车查看摘要，Shift 加回车打开档案`)}">${isRoot ? `<circle class="node-ring" r="${f1(node.r + 7)}"/>` : ''}${shapeSvg(entity.type, node.r)}<text class="node-glyph" text-anchor="middle">${esc(letters[entity.type] || '档')}</text><text class="node-label${isRoot ? ' root-label' : ''}${secondary ? ' secondary-label' : ''}" text-anchor="middle" y="${f1(node.r + (isRoot ? 26 : 19))}">${esc(graphName(node.id))}</text><title>${esc([entity.name, entity.role, types[entity.type]].filter(Boolean).join(' · '))}</title></g>`;
    }).join(''));
    document.querySelectorAll('#networkNodes [data-node]').forEach(el => G.nodeEls.set(el.dataset.node, el));
    document.querySelectorAll('#networkLinks [data-edge]').forEach(el => G.edgeEls.set(el.dataset.edge, el));
    document.querySelectorAll('#networkEdgeLabels [data-edge-label]').forEach(el => { const key = el.dataset.edgeLabel; if (!G.labelEls.has(key)) G.labelEls.set(key, []); G.labelEls.get(key).push(el); });
    const records = G.vpairs.reduce((n, v) => n + v.pair.records.length, 0);
    setText('networkCount', `${G.visible.length} / ${E.size} 个主体 · ${G.vpairs.length} 组连接 · ${records} 条关系`);
    renderFilterBanner(); highlightGraph(); renderNetworkPath(); if (G.list) renderListView();
  }
  function boxSep(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
    const dx = Math.abs(ax - bx) - (ahw + bhw), dy = Math.abs(ay - by) - (ahh + bhh);
    return dx <= 0 && dy <= 0 ? Math.max(dx, dy) : Math.hypot(Math.max(0, dx), Math.max(0, dy));
  }
  function updatePositions() {
    for (const node of G.visible) { const el = G.nodeEls.get(node.id); if (el) el.setAttribute('transform', `translate(${f1(node.x)},${f1(node.y)})`); }
    const geoms = new Map();
    for (const v of G.vpairs) {
      const el = G.edgeEls.get(v.pair.key); if (!el || !v.lanes) continue;
      el.querySelectorAll('path.net-edge').forEach(path => { const lane = v.lanes[Number(path.dataset.lane)] || v.lanes[0]; path.setAttribute('d', geometry(v, lane).d); });
      const centerGeom = geometry(v, {...v.lanes[0], offset:0}); const hit = el.querySelector('.edge-hit'); if (hit) hit.setAttribute('d', centerGeom.d);
      geoms.set(v.pair.key, centerGeom);
    }
    const titleBoxes = G.visible.map(n => {
      const label = graphName(n.id), fs = n.id === rootId ? 16 : 13;
      const hw = [...label].reduce((s, c) => s + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? fs : fs * .6), 0) / 2 + 5;
      return {id:n.id, x:n.x, y:n.y, r:n.r, tx:n.x, ty:n.y + n.r + (n.id === rootId ? 20 : 15), thw:hw, thh:fs / 2 + 4};
    });
    const placed = [];
    const ordered = G.vpairs.filter(v => !v.ghost && (G.labelEls.get(v.pair.key) || []).length).slice().sort((a, b) => {
      const ap = (G.labelEls.get(a.pair.key) || []).some(l => l.dataset.kind === 'pill') ? 0 : 1;
      const bp = (G.labelEls.get(b.pair.key) || []).some(l => l.dataset.kind === 'pill') ? 0 : 1;
      return ap - bp;
    });
    for (const v of ordered) {
      const centerGeom = geoms.get(v.pair.key), labels = G.labelEls.get(v.pair.key) || [];
      if (!centerGeom || !labels.length) continue;
      const hasPill = labels.some(l => l.dataset.kind === 'pill'), hasText = labels.some(l => l.dataset.kind === 'label');
      const hw = hasPill ? Math.max(22, [...pillText(v)].length * 3.8 + 9) : 28, hh = hasPill && hasText ? 18 : 11;
      const clearance = pt => {
        let minC = Infinity;
        for (const nb of titleBoxes) {
          const end = nb.id === v.pair.a || nb.id === v.pair.b;
          minC = Math.min(minC, Math.hypot(pt.x - nb.x, pt.y - nb.y) - (nb.r + (end ? 12 : 26)), boxSep(pt.x, pt.y + (hasPill && hasText ? 4 : 0), hw, hh, nb.tx, nb.ty, nb.thw, nb.thh));
        }
        for (const p of placed) minC = Math.min(minC, boxSep(pt.x, pt.y, hw, hh, p.x, p.y, p.hw + 4, p.hh + 3));
        return minC;
      };
      let best = centerGeom.sample(.5), bestScore = clearance(best);
      if (bestScore < 20) {
        for (const t of CANDIDATE_T) {
          const pt = centerGeom.sample(t), score = clearance(pt) - Math.abs(t - .5) * 6;
          if (score > bestScore) { best = pt; bestScore = score; }
        }
      }
      if (hasPill) placed.push({x:best.x, y:best.y, hw, hh:11});
      labels.forEach(l => l.setAttribute('transform', `translate(${f1(best.x)},${f1(best.y + (l.dataset.kind === 'label' && hasPill ? 16 : 0))})`));
    }
    if (G.expanded) renderMinimap();
  }
  const zoomLevel = () => G.fitWidth / Math.max(1, G.box.w);
  function applyLOD() {
    const svg = $('networkSvg'); if (!svg) return;
    const zoom = zoomLevel();
    svg.classList.toggle('show-edge-labels', G.printing || zoom >= 1.2);
    const hp = G.path.chosen >= 0 ? G.path.results[G.path.chosen] : null;
    const prio = new Set([rootId, G.selected, ...(hp ? hp.ids : (pathTo(G.selected)?.ids || []))]);
    if (G.selected !== rootId) adj(G.selected).forEach(e => prio.add(other(e, G.selected)));
    const rank = n => n.id === rootId || n.id === G.selected ? 0 : prio.has(n.id) ? 1 : coreSet.has(n.id) || n.r >= 14 ? 2 : 3;
    const accepted = [];
    const sorted = G.visible.slice().sort((a, b) => rank(a) - rank(b) || b.degree - a.degree);
    for (const n of sorted) {
      const el = G.nodeEls.get(n.id)?.querySelector('.node-label'); if (!el) continue;
      const r = rank(n), label = graphName(n.id), fs = n.id === rootId ? 18 : r === 3 && G.view === 'all' ? 10 : 13;
      const w = [...label].reduce((s, c) => s + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? fs : fs * .6), 0), top = n.y + n.r + 6;
      const rect = {x1:n.x - w / 2, x2:n.x + w / 2, y1:top, y2:top + fs + 6};
      let show = G.printing || r <= 2 || zoom >= 1.4;
      if (show && r > 0 && !G.printing) show = !accepted.some(b => rect.x1 < b.x2 && rect.x2 > b.x1 && rect.y1 < b.y2 && rect.y2 > b.y1);
      if (show) accepted.push(rect);
      el.classList.toggle('is-hidden', !show);
    }
  }
  function highlightGraph() {
    const hp = G.path.chosen >= 0 ? G.path.results[G.path.chosen] : null;
    const path = hp || pathTo(G.selected);
    const related = hp ? new Set(hp.ids) : new Set([G.selected, ...adj(G.selected).map(e => other(e, G.selected)), ...(path?.ids || [])]);
    const pathPairs = new Set((path?.edges || []).map(e => pairKey(e.from, e.to)));
    const pairSel = G.pair ? relationMap.get(G.pair) : null, focusing = Boolean(hp) || G.selected !== rootId;
    for (const [id, el] of G.nodeEls) {
      el.classList.toggle('active', id === G.selected && !G.pair);
      el.classList.toggle('neighbor', related.has(id));
      el.classList.toggle('dim', pairSel ? ![pairSel.a, pairSel.b].includes(id) : focusing && !related.has(id));
    }
    for (const v of G.vpairs) {
      const el = G.edgeEls.get(v.pair.key); if (!el) continue;
      const active = pairSel ? v.pair.key === G.pair : !hp && G.selected !== rootId && (v.pair.a === G.selected || v.pair.b === G.selected);
      const onPath = !pairSel && pathPairs.has(v.pair.key);
      el.classList.toggle('active', active); el.classList.toggle('path-active', onPath);
      el.classList.toggle('dim', pairSel ? !active : focusing && !active && !onPath);
      el.querySelectorAll('path.net-edge').forEach(p => {
        const lane = v.lanes?.[Number(p.dataset.lane)]; if (!lane || !lane.arrow) return;
        const key = active || onPath ? 'active' : lane.key;
        p.setAttribute('marker-end', `url(#arrow-${key})`); if (lane.both) p.setAttribute('marker-start', `url(#arrow-${key})`);
      });
      (G.labelEls.get(v.pair.key) || []).forEach(l => { l.classList.toggle('active', active); l.classList.toggle('path-active', onPath); l.classList.toggle('is-visible', active || onPath); l.classList.toggle('dim', pairSel ? !active : focusing && !active && !onPath); });
    }
    applyLOD();
  }

  // ───────────── Graph 2.0: panels, filters, pathfinder ─────────────
  function renderPeek() {
    const el = $('networkPeek'); if (!el) return;
    if (!G.peek) { el.hidden = true; return; }
    let html = '';
    if (G.pair && relationMap.has(G.pair)) {
      const pair = relationMap.get(G.pair);
      html = `<button type="button" class="peek-close" data-close-peek aria-label="关闭摘要">×</button><div class="peek-type">逐条关系 · ${pair.records.length}</div><h3>${esc(name(pair.a))} ↔ ${esc(name(pair.b))}</h3>${sortRelations(pair.records).slice(0, 4).map(e => `<div class="peek-rel"><span>${esc(name(e.from))} → ${esc(name(e.to))}</span><b>${esc(e.label || relLabel(e))}</b>${e.percent != null ? `<span class="num-cell">${esc(fmtPct(e.percent))}</span>` : ''}${status(edgeStatus(e))}</div>`).join('')}<div class="peek-actions"><button type="button" class="primary" data-open-pair="${esc(pair.key)}">查看逐条关系 →</button></div>`;
    } else if (E.has(G.selected)) {
      const id = G.selected, entity = E.get(id);
      const rels = sortRelations(adj(id)).slice(0, 3).map(e => `<div class="peek-rel"><button type="button" class="link-button" data-select-entity="${esc(other(e, id))}">${esc(name(other(e, id)))}</button><b>${esc(e.label || relLabel(e))}</b>${e.percent != null ? `<span class="num-cell">${esc(fmtPct(e.percent))}</span>` : ''}</div>`).join('');
      const own = ownershipRecords(id).map(r => `<p class="ownership-note">${esc(ownershipText(r, id))}</p>`).join('');
      html = `<button type="button" class="peek-close" data-close-peek aria-label="关闭摘要">×</button><div class="peek-type">${typeTag(id)}${status(entity.status)}${registryBadge(entity)}${confBadge('entities', id)}</div><h3>${esc(entity.name)}</h3>${entity.role ? `<p class="profile-role">${esc(entity.role)}</p>` : ''}${own}${rels}${adj(id).length > 3 ? `<p class="muted">另有 ${adj(id).length - 3} 条直接关系</p>` : ''}<div class="peek-actions"><button type="button" class="primary" data-open-entity="${esc(id)}">打开完整档案 →</button>${id !== rootId ? `<button type="button" class="secondary" data-path-to="${esc(id)}">寻路</button>` : ''}</div>`;
    }
    el.innerHTML = html; el.hidden = !html;
  }
  function renderNetworkPath() {
    const el = $('networkPath'); if (!el) return;
    const hp = G.path.chosen >= 0 ? G.path.results[G.path.chosen] : null;
    if (hp) el.innerHTML = `<span class="path-title">${esc(name(hp.ids[0]))} ↔ ${esc(name(hp.ids[hp.ids.length - 1]))} · ${hp.edges.length} 步</span>${chainHtml(hp.ids, hp.edges)}${refs(hp.edges.flatMap(e => arr(e.sources)))}`;
    else if (G.pair && relationMap.has(G.pair)) { const pair = relationMap.get(G.pair); el.innerHTML = `<span class="path-title">${esc(name(pair.a))} ↔ ${esc(name(pair.b))}</span><p>${pair.records.length} 条关系分别保留原始方向、时间、性质与来源。</p>`; }
    else el.innerHTML = E.has(G.selected) ? pathHtml(G.selected) : '<p class="empty">尚未收录可展示的调查主体。</p>';
  }
  function renderFilterBanner() {
    const el = $('filterBanner'); if (!el) return;
    const active = G.typeOff.size || G.famOff.size || !G.showHistorical;
    if (!active || (!G.hiddenNodes && !G.hiddenEdges)) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span>已隐藏 ${G.hiddenNodes} 个主体 · ${G.hiddenEdges} 条关系${G.ghost.size ? ` · ${G.ghost.size} 个路径节点以淡色保留` : ''}</span><button type="button" class="secondary" data-clear-filters>清除筛选</button>`;
  }
  function renderChips() {
    const typeCounts = new Map(); entities.forEach(e => typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1));
    setHtml('networkTypeFilters', Object.keys(types).filter(t => typeCounts.has(t)).map(t => `<button type="button" class="chip filter-chip t-${t}" data-type-filter="${t}" aria-pressed="${String(!G.typeOff.has(t))}"><i class="shape-icon t-${t}" aria-hidden="true"></i>${types[t]}<small>${typeCounts.get(t)}</small></button>`).join(''));
    const famCounts = new Map(); validRelationships.forEach(e => famCounts.set(family(e), (famCounts.get(family(e)) || 0) + 1));
    setHtml('networkRelFilters', FAMILY_ORDER.filter(f => famCounts.has(f)).map(f => `<button type="button" class="chip filter-chip rel-${f}" data-rel-filter="${f}" aria-pressed="${String(!G.famOff.has(f))}"><i class="legend-line ${f === 'governance' ? 'business' : f === 'uncertain' ? 'candidate' : f}" aria-hidden="true"></i>${FAMILY[f]}<small>${famCounts.get(f)}</small></button>`).join(''));
    setOn($('toggleHistorical'), G.showHistorical);
  }
  function renderLegend() {
    const present = Object.keys(types).filter(t => entities.some(e => e.type === t));
    const fams = new Set(validRelationships.map(styleKey));
    const line = (cls, label) => `<span class="legend-item"><i class="legend-line ${cls}" aria-hidden="true"></i>${label}</span>`;
    setHtml('networkLegend', `${present.map(t => `<span class="legend-item t-${t}"><i class="shape-icon t-${t}" aria-hidden="true"></i>${types[t]}</span>`).join('')}<span class="legend-item ${tcls(rootId)}"><i class="shape-icon ${tcls(rootId)}" style="outline:1.5px solid var(--accent);outline-offset:2px" aria-hidden="true"></i>调查主体</span>${line('capital', '资本 →')}${line('business', '任职 / 业务')}${fams.has('signal') ? line('signal', '关联信号') : ''}${fams.has('candidate') || fams.has('disputed') ? line('candidate', '待核 / 争议') : ''}${validRelationships.some(e => e.status === 'historical') ? line('historical', '历史') : ''}<span class="legend-item"><b class="edge-pill-sample">60%</b>持股比例</span>`);
  }
  function setBox() { const svg = $('networkSvg'); if (svg) svg.setAttribute('viewBox', `${f1(G.box.x)} ${f1(G.box.y)} ${f1(G.box.w)} ${f1(G.box.h)}`); if (G.expanded) renderMinimap(); }
  function fitGraph(targets, ratioOverride) {
    if (!G.visible.length) { setBox(); return; }
    const vp = $('networkViewport'), rect = vp ? vp.getBoundingClientRect() : {width:1000, height:600};
    const ratio = ratioOverride || (rect.width > 10 && rect.height > 10 ? rect.width / rect.height : 1.6);
    const at = n => (targets instanceof Map && targets.get(n.id)) || n;
    const xs = G.visible.map(n => [at(n).x - (n.id === rootId ? 115 : 91), at(n).x + (n.id === rootId ? 115 : 91)]).flat();
    const ys = G.visible.map(n => [at(n).y - n.r - 28, at(n).y + n.r + 60]).flat();
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    let w = Math.max(300, maxX - minX), h = Math.max(250, maxY - minY);
    if (w / h < ratio) w = h * ratio; else h = w / ratio;
    G.box = {x:(minX + maxX - w) / 2, y:(minY + maxY - h) / 2, w, h}; G.fitWidth = w; setBox(); applyLOD();
  }
  function zoom(factor, clientX, clientY) {
    const svg = $('networkSvg'); if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const rx = clientX == null ? .5 : (clientX - rect.left) / Math.max(1, rect.width), ry = clientY == null ? .5 : (clientY - rect.top) / Math.max(1, rect.height);
    const nextWidth = Math.min(Math.max(5000, G.fitWidth * 4), Math.max(170, G.box.w * factor)), scale = nextWidth / G.box.w;
    G.box.x += G.box.w * rx * (1 - scale); G.box.y += G.box.h * ry * (1 - scale); G.box.w *= scale; G.box.h *= scale; setBox(); applyLOD();
  }
  function renderMinimap() {
    const mini = $('networkMinimap'); if (!mini) return;
    if (!G.expanded || !G.visible.length) { mini.hidden = true; return; }
    mini.hidden = false;
    const xs = G.visible.map(n => n.x), ys = G.visible.map(n => n.y), pad = 80;
    const minX = Math.min(...xs, G.box.x) - pad, minY = Math.min(...ys, G.box.y) - pad, maxX = Math.max(...xs, G.box.x + G.box.w) + pad, maxY = Math.max(...ys, G.box.y + G.box.h) + pad;
    const content = `<g class="minimap-svg">${G.visible.map(n => `<circle class="mini-node ${tcls(n.id)}" cx="${f1(n.x)}" cy="${f1(n.y)}" r="${f1(Math.max(6, (maxX - minX) * .012))}"/>`).join('')}<rect class="mini-view" x="${f1(G.box.x)}" y="${f1(G.box.y)}" width="${f1(G.box.w)}" height="${f1(G.box.h)}"/></g>`;
    if (mini.tagName.toLowerCase() === 'svg') { mini.setAttribute('viewBox', `${f1(minX)} ${f1(minY)} ${f1(maxX - minX)} ${f1(maxY - minY)}`); mini.innerHTML = content; }
    else mini.innerHTML = `<svg class="minimap-svg" viewBox="${f1(minX)} ${f1(minY)} ${f1(maxX - minX)} ${f1(maxY - minY)}">${content}</svg>`;
    mini.dataset.bounds = JSON.stringify([minX, minY, maxX - minX, maxY - minY]);
  }
  function renderListView() {
    const el = $('networkListView'); if (!el) return;
    const id = E.has(G.selected) ? G.selected : rootId; if (!E.has(id)) { el.innerHTML = '<p class="empty">尚无可列出的关系。</p>'; return; }
    const groups = FAMILY_ORDER.map(f => [f, adj(id).filter(e => family(e) === f && recordVisible(e))]).filter(([, list]) => list.length);
    el.innerHTML = `<div class="list-head"><span class="path-title">以 ${esc(name(id))} 为中心的关系清单</span>${id !== rootId ? `<button type="button" class="secondary" data-select-entity="${esc(rootId)}">回到 ${esc(name(rootId))}</button>` : ''}<button type="button" class="secondary" data-open-entity="${esc(id)}">打开档案 →</button></div>${groups.map(([f, list]) => `<section class="list-group"><h4>${FAMILY[f]} · ${list.length}</h4><ul>${sortRelations(list).map(e => { const o = other(e, id); return `<li class="list-row"><button type="button" class="entity-link ${tcls(o)}" data-select-entity="${esc(o)}"><i class="dot ${tcls(o)}" aria-hidden="true"></i>${esc(name(o))}</button><span>${e.from === id ? '→' : '←'} ${esc(e.label || relLabel(e))}</span>${e.percent != null ? `<span class="num-cell">${esc(fmtPct(e.percent))}</span>` : ''}<span class="num-cell">${esc(e.date || [e.valid_from, e.valid_to].filter(Boolean).join(' — ') || '')}</span>${status(edgeStatus(e))}${refs(e.sources)}</li>`; }).join('')}</ul></section>`).join('') || '<p class="empty">当前筛选下没有直接关系。</p>'}`;
  }

  // Pathfinder (all shortest paths, up to five)
  const pathOptions = () => [...entities].sort((a, b) => Object.keys(types).indexOf(a.type) - Object.keys(types).indexOf(b.type) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  function populatePathSelects() {
    const options = pathOptions().map(e => `<option value="${esc(e.id)}">${esc(e.name)}（${esc(types[e.type] || e.type)}）</option>`).join('');
    const from = $('pathFrom'), to = $('pathTo');
    if (from && from.tagName === 'SELECT') from.innerHTML = options;
    if (to && to.tagName === 'SELECT') to.innerHTML = `<option value="">选择终点</option>${options}`;
  }
  function allShortestPaths(a, b, opts) {
    if (!E.has(a) || !E.has(b) || a === b) return [];
    const usable = e => (opts.confirmedOnly ? confirmed(e) : true) && (opts.includeHistory || e.status !== 'historical');
    const best = (x, y) => { const score = e => (e.status === 'historical' ? 2 : 0) + (family(e) === 'capital' ? 0 : 1); return score(x) <= score(y) ? x : y; };
    const dist = new Map([[a, 0]]), preds = new Map(), queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i], du = dist.get(u);
      if (dist.has(b) && du >= dist.get(b)) break;
      if (du >= 8) continue;
      for (const e of adj(u)) {
        if (!usable(e)) continue;
        const v = other(e, u);
        if (!dist.has(v)) { dist.set(v, du + 1); queue.push(v); }
        if (dist.get(v) === du + 1) { if (!preds.has(v)) preds.set(v, new Map()); const m = preds.get(v); m.set(u, m.has(u) ? best(m.get(u), e) : e); }
      }
    }
    if (!dist.has(b)) return [];
    const results = []; let guard = 0;
    const walk = (node, ids, edges) => {
      if (results.length >= 5 || ++guard > 4000) return;
      if (node === a) { results.push({ids:[a, ...ids], edges:[...edges]}); return; }
      for (const [prev, e] of preds.get(node) || []) walk(prev, [node, ...ids], [e, ...edges]);
    };
    walk(b, [], []);
    return results.map(r => ({ids:r.ids, edges:r.edges}));
  }
  function runPathfinder() {
    const from = $('pathFrom')?.value, to = $('pathTo')?.value;
    const opts = {confirmedOnly:$('pathConfirmedOnly') ? isOn($('pathConfirmedOnly')) : true, includeHistory:isOn($('pathIncludeHistory'))};
    G.path.results = from && to ? allShortestPaths(from, to, opts) : [];
    G.path.chosen = G.path.results.length ? 0 : -1;
    const cards = $('pathCards');
    if (cards) {
      if (!from || !to) cards.innerHTML = '<p class="muted">选择起点与终点，查找两者之间的最短关系路径。也可按住 Shift 点击图中的主体设为终点。</p>';
      else if (from === to) cards.innerHTML = '<p class="muted">起点与终点相同。</p>';
      else if (!G.path.results.length) cards.innerHTML = `<p class="muted">在当前条件下未找到 ${esc(name(from))} 与 ${esc(name(to))} 之间的路径（最多 8 步）。${opts.confirmedOnly ? '可取消“仅确认关系”以纳入待核与信号类关系。' : ''}</p>`;
      else cards.innerHTML = `<p class="muted">找到 ${G.path.results.length} 条最短路径 · 每条 ${G.path.results[0].edges.length} 步</p>${G.path.results.map((p, i) => `<article class="path-card${i === G.path.chosen ? ' active' : ''}" data-path-card="${i}"><button type="button" class="path-card-head" data-path-index="${i}" aria-pressed="${String(i === G.path.chosen)}">路径 ${i + 1} · ${p.edges.length} 步${p.edges.some(e => !confirmed(e)) ? ' · 含待核/信号' : ''}${p.edges.some(e => e.status === 'historical') ? ' · 含历史' : ''}</button>${chainHtml(p.ids, p.edges)}${refs(p.edges.flatMap(e => arr(e.sources)))}</article>`).join('')}`;
    }
    applyPathChoice();
  }
  function applyPathChoice() {
    const hp = G.path.results[G.path.chosen]; if (hp) G.pair = null;
    document.querySelectorAll('[data-path-card]').forEach(card => { const on = Number(card.dataset.pathCard) === G.path.chosen; card.classList.toggle('active', on); const head = card.querySelector('[data-path-index]'); if (head) head.setAttribute('aria-pressed', String(on)); });
    if (hp && hp.ids.some(id => !G.layoutPos.has(id))) { hp.ids.forEach(id => G.extra.add(id)); computeLayout(); }
    else { highlightGraph(); renderNetworkPath(); }
  }
  function openPathfinder(open, target) {
    const bar = $('pathfinderBar'); if (!bar) return;
    G.path.open = open; bar.hidden = !open; setOn($('togglePathfinder'), open);
    if (!open) { G.path.results = []; G.path.chosen = -1; highlightGraph(); renderNetworkPath(); return; }
    const from = $('pathFrom'), to = $('pathTo');
    if (target != null) {
      if (from) from.value = G.selected !== target && E.has(G.selected) ? G.selected : (target !== rootId ? rootId : from.value);
      if (to) to.value = target;
      runPathfinder();
    } else {
      if (from && E.has(G.selected)) from.value = G.selected;
      if (to && !to.value && G.selected !== rootId && E.has(rootId)) to.value = rootId;
      runPathfinder(); (to && !to.value ? to : from)?.focus();
    }
  }

  // Selection, views and layouts
  function selectEntity(id, options = {}) {
    if (!E.has(id)) return;
    G.selected = id; G.pair = null; if (options.peek !== false) G.peek = true;
    const required = [id, ...(pathTo(id)?.ids || [])];
    const changed = required.some(pid => !G.layoutPos.has(pid)) || (G.typeOff.has(etype(id)) && !G.layoutPos.has(id));
    required.forEach(pid => G.extra.add(pid));
    if (changed || G.view === 'near') computeLayout(); else { highlightGraph(); renderNetworkPath(); if (G.list) renderListView(); }
    renderPeek();
  }
  function selectEdge(key) {
    if (!relationMap.has(key)) return;
    G.pair = key; G.peek = true; highlightGraph(); renderNetworkPath(); renderPeek();
  }
  function setView(next) {
    if (!['core', 'all', 'near'].includes(next)) return;
    G.view = next; G.pair = null; G.extra.clear();
    if (next === 'core' && !coreSet.has(G.selected)) G.selected = E.has(rootId) ? rootId : coreIds[0];
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === G.view)));
    computeLayout(); renderPeek();
  }
  function setLayout(next) {
    if (!['radial', 'hierarchy', 'force'].includes(next)) return;
    G.layout = next;
    document.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === G.layout)));
    computeLayout();
  }
  function toggleFull(force) {
    G.expanded = typeof force === 'boolean' ? force : !G.expanded;
    const panel = $('networkPanel'); if (panel) panel.classList.toggle('expanded', G.expanded);
    const button = $('networkFull'); if (button) { setOn(button, G.expanded); button.setAttribute('aria-label', G.expanded ? '退出全屏' : '全屏查看关系网络'); }
    updateLock(); renderMinimap(); requestAnimationFrame(() => fitGraph());
  }
  function setCanvasActive(active) { G.active = active; const vp = $('networkViewport'); if (vp) vp.classList.toggle('is-active', active); }
  function showToast(message) {
    const el = $('canvasToast'); if (!el) return;
    const now = Date.now(); if (now - G.toastAt < 4000 && !el.hidden) return;
    G.toastAt = now; el.textContent = message; el.hidden = false;
    clearTimeout(G.toastTimer); G.toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }
  function toggleList(force) {
    G.list = typeof force === 'boolean' ? force : !G.list;
    setOn($('toggleListView'), G.list);
    const panel = $('networkPanel'); if (panel) panel.classList.toggle('list-mode', G.list);
    setHidden('networkListView', !G.list); setHidden('networkViewport', G.list);
    if (G.list) renderListView(); else requestAnimationFrame(() => fitGraph());
  }
  function clearFilters() {
    G.typeOff.clear(); G.famOff.clear(); G.showHistorical = true;
    renderChips(); computeLayout();
  }

  // ───────────── Navigation helpers & global search ─────────────
  function goTo(id) {
    const search = $('searchDialog'); if (search?.open) search.close();
    if (narrow()) closeDrawer();
    if (G.expanded) toggleFull(false);
    const target = $(id); if (!target) return;
    let node = target; while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; }
    requestAnimationFrame(() => target.scrollIntoView({behavior:reduceMotion() ? 'auto' : 'smooth', block:'start'}));
  }
  function revealSource(id) { const input = $('sourceSearch'); if (input) input.value = ''; filterSources(); const key = anchor('source', id); goTo(key); $(key)?.focus({preventScroll:true}); }
  function appendHighlighted(container, value, query) {
    const string = String(value || ''), lower = string.toLocaleLowerCase(), needle = query.toLocaleLowerCase();
    let start = 0, at = lower.indexOf(needle);
    if (!needle || at < 0) { container.textContent = string; return; }
    while (at >= 0) {
      container.append(document.createTextNode(string.slice(start, at)));
      const mark = document.createElement('mark'); mark.textContent = string.slice(at, at + query.length); container.append(mark);
      start = at + query.length; at = lower.indexOf(needle, start);
    }
    container.append(document.createTextNode(string.slice(start)));
  }
  const blockSearchText = block => [block?.title, block?.text, ...arr(block?.steps).flatMap(step => [step.title, step.text]), ...arr(block?.entity_ids).map(name), ...arr(block?.sources), ...arr(block?.image_ids).flatMap(id => [A.get(id)?.alt, A.get(id)?.caption])].filter(v => v != null).join(' ');
  const searchIndex = [];
  function indexSearch(kind, id, label, heading, body, target) { searchIndex.push({kind, id, label, title:String(heading || ''), body:String(body || ''), target, key:[id, label, heading, body].join(' ').toLocaleLowerCase()}); }
  indexSearch('jump', 'overview', LBL.judgmentLabel, title, [meta.subtitle, meta.summary].filter(Boolean).join(' '), 'overview');
  entities.forEach(entity => indexSearch('entity', entity.id, types[entity.type] || '主体', entity.name, [entity.short_name, entity.role, entity.summary, ...arr(entity.aliases), ...arr(entity.identifiers).map(x => x?.value), ...arr(entity.fields).flatMap(f => [f.label, valueText(f.value)]), ...arr(entity.facts).flatMap(f => [f.date, f.text]), ...arr(entity.career).flatMap(c => [c.date, c.title, c.text]), ...arr(entity.sections).flatMap(s => [s.title, s.text]), ...adj(entity.id).flatMap(e => [e.label, e.role, e.detail, e.date, e.percent != null ? `${e.percent}%` : '', name(other(e, entity.id))]), ...entitySourceIds(entity)].filter(v => v != null).join(' ')));
  sections.forEach(section => indexSearch('jump', section.id, '章节', section.title, [section.kicker, section.intro, ...arr(section.blocks).map(blockSearchText)].filter(Boolean).join(' '), section.id));
  questions.forEach((q, i) => indexSearch('jump', q.id ?? i, '问题', q.question, [q.answer, q.why_it_matters, ...arr(q.evidence).map(blockSearchText), ...arr(q.sources)].filter(Boolean).join(' '), anchor('question', q.id ?? i)));
  archives.forEach(archive => indexSearch('jump', archive.id, '档案', archive.title, [archive.intro, ...arr(archive.blocks).map(blockSearchText), ...arr(archive.entity_ids).map(name), ...arr(archive.source_ids)].filter(Boolean).join(' '), anchor('archive', archive.id)));
  sources.forEach(source => indexSearch('source', source.id, '来源', source.title, [source.id, sourceKinds[source.kind], source.publisher, source.published_at, source.observed_at, source.locator, source.excerpt, source.url].filter(Boolean).join(' ')));
  [...C.values()].forEach(claim => indexSearch('claim', claim.id, '核查依据', claim.text, [GRADES[claim.kind]?.label, claim.locator, claim.reasoning, claim.as_of, ...arr(claim.source_ids)].filter(Boolean).join(' ')));
  arr(D.findings).forEach((f, i) => indexSearch('jump', f.id ?? i, '关键发现', f.title, [f.text, ...arr(f.entity_ids).map(name), ...arr(f.sources)].filter(Boolean).join(' '), anchor('finding', f.id ?? i)));
  events.forEach((event, i) => indexSearch('jump', event.id ?? i, '时间线', event.title, [event.date, event.text, ...arr(event.entity_ids).map(name), ...arr(event.sources)].filter(Boolean).join(' '), anchor('event', event.id ?? i)));
  function renderGlobalSearch() {
    const input = $('globalSearch'), out = $('globalSearchResults'); if (!input || !out) return;
    const query = input.value.trim(); out.replaceChildren();
    if (!query) {
      setText('globalSearchStatus', '搜索人物、公司、产品、正文、问题、档案与来源。');
      const note = document.createElement('p'); note.className = 'site-search-empty'; note.textContent = '输入主体名称、工作内容、事件或来源编号。'; out.append(note); return;
    }
    const q = query.toLocaleLowerCase(), matches = searchIndex.map((record, index) => ({record, index})).filter(({record}) => record.key.includes(q));
    const rank = r => r.title.toLocaleLowerCase() === q ? 3 : r.title.toLocaleLowerCase().includes(q) ? 2 : String(r.id).toLocaleLowerCase() === q ? 1 : 0;
    matches.sort((a, b) => rank(b.record) - rank(a.record) || a.index - b.index);
    setText('globalSearchStatus', matches.length ? `${matches.length} 个结果${matches.length > 80 ? ' · 显示前 80 个，请补充关键词' : ''}` : '没有匹配结果');
    if (!matches.length) { const note = document.createElement('p'); note.className = 'site-search-empty'; note.textContent = `没有找到与“${query}”匹配的内容。试试其他主体名称、关键词或来源编号。`; out.append(note); return; }
    matches.slice(0, 80).forEach(({record, index}) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'site-search-result'; button.dataset.globalResult = String(index);
      const category = document.createElement('span'); category.className = 'site-search-kind'; category.textContent = record.label;
      const heading = document.createElement('strong'), snippet = document.createElement('span'); snippet.className = 'site-search-snippet';
      appendHighlighted(heading, record.title, query);
      const at = record.body.toLocaleLowerCase().indexOf(q), start = Math.max(0, at - 44), end = Math.min(record.body.length, start + Math.max(145, query.length + 70));
      appendHighlighted(snippet, `${start ? '…' : ''}${record.body.slice(start, end)}${end < record.body.length ? '…' : ''}`, query);
      button.append(category, heading, snippet); out.append(button);
    });
  }
  function openGlobalSearch() {
    const dialog = $('searchDialog'); if (!dialog) return;
    hidePopover(); renderGlobalSearch();
    if (!dialog.open) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
    updateLock(); const input = $('globalSearch'); if (input) { input.focus(); input.select(); }
  }
  function chooseGlobalResult(index) {
    const record = searchIndex[Number(index)]; if (!record) return;
    const dialog = $('searchDialog'); if (dialog?.open) dialog.close();
    if (record.kind === 'entity') openDrawer({kind:'entity', id:record.id});
    else if (record.kind === 'source') openDrawer({kind:'source', id:record.id});
    else if (record.kind === 'claim') openDrawer({kind:'claims', ids:[record.id]});
    else { goTo(record.target); const target = $(record.target); if (target) { target.setAttribute('tabindex', '-1'); target.focus({preventScroll:true}); } }
  }
  on('openSearch', 'click', openGlobalSearch);
  on('closeSearch', 'click', () => $('searchDialog').close());
  on('searchDialog', 'close', updateLock);
  on('searchDialog', 'click', event => { const d = $('searchDialog'); if (event.target !== d) return; const r = d.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) d.close(); });
  on('globalSearch', 'input', renderGlobalSearch);
  on('globalSearch', 'keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('globalSearchResults')?.querySelector('button')?.focus(); }
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('globalSearchResults')?.querySelector('button')?.click(); }
  });
  on('globalSearchResults', 'keydown', event => {
    const buttons = [...$('globalSearchResults').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index > 0) buttons[index - 1].focus(); else $('globalSearch')?.focus(); }
  });

  // Network search
  on('networkSearch', 'input', () => {
    const input = $('networkSearch'), out = $('networkResults'); if (!out) return;
    const query = input.value.trim(); out.replaceChildren();
    if (!query) { out.hidden = true; return; }
    const q = query.toLocaleLowerCase();
    const matches = entities.filter(e => [e.name, e.short_name, ...arr(e.aliases), e.role, e.summary, ...arr(e.identifiers).map(x => x?.value), ...arr(e.career).map(c => `${c.title} ${c.text}`)].join(' ').toLocaleLowerCase().includes(q)).sort((a, b) => Number(String(b.name).toLocaleLowerCase().includes(q)) - Number(String(a.name).toLocaleLowerCase().includes(q)) || Number(coreSet.has(b.id)) - Number(coreSet.has(a.id)));
    for (const entity of matches.slice(0, 15)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `search-result ${tcls(entity.id)}`; button.dataset.searchResult = entity.id;
      const dot = document.createElement('i'); dot.className = `dot ${tcls(entity.id)}`; button.append(dot);
      const words = document.createElement('span'), heading = document.createElement('strong'), sub = document.createElement('small');
      appendHighlighted(heading, entity.name, query); appendHighlighted(sub, [types[entity.type], entity.role, arr(entity.aliases).join(' · ')].filter(Boolean).join(' · '), query);
      words.append(heading, sub); button.append(words); out.append(button);
    }
    if (!matches.length || matches.length > 15) { const note = document.createElement('div'); note.className = 'search-empty'; note.textContent = matches.length ? `显示前 15 / ${matches.length} 个结果，请补充关键词。` : '没有找到对应主体。'; out.append(note); }
    out.hidden = false;
  });
  on('networkSearch', 'keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('networkResults')?.querySelector('button')?.focus(); }
    if (event.key === 'Enter' && !$('networkResults')?.hidden) { event.preventDefault(); $('networkResults').querySelector('button')?.click(); }
  });
  on('networkResults', 'keydown', event => {
    const buttons = [...$('networkResults').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index > 0) buttons[index - 1].focus(); else $('networkSearch')?.focus(); }
  });
  on('sourceSearch', 'input', filterSources);

  // ───────────── Global event delegation ─────────────
  document.addEventListener('toggle', event => { if (event.target.matches?.('[data-entity-record]') && event.target.open) materialize(event.target); }, true);
  document.addEventListener('click', event => {
    const target = event.target.closest?.('button, a');
    if (target) {
      const data = target.dataset;
      if (data.globalResult !== undefined) chooseGlobalResult(data.globalResult);
      else if (data.lightbox !== undefined) { event.preventDefault(); openLightbox(target); }
      else if (data.claims !== undefined) openDrawer({kind:'claims', ids:data.claims.split(',')});
      else if (data.openSource !== undefined) { event.preventDefault(); closeLightbox(); openDrawer({kind:'source', id:data.openSource}); }
      else if (data.source !== undefined) { event.preventDefault(); if (target.closest('#lightboxDialog')) closeLightbox(); openDrawer({kind:'source', id:data.source}); }
      else if (data.jumpSource !== undefined) { event.preventDefault(); revealSource(data.jumpSource); }
      else if (data.openEntity !== undefined) openDrawer({kind:'entity', id:data.openEntity});
      else if (data.openPair !== undefined) openDrawer({kind:'pair', id:data.openPair});
      else if (data.selectEntity !== undefined) selectEntity(data.selectEntity);
      else if (data.searchResult !== undefined) { selectEntity(data.searchResult); const out = $('networkResults'); if (out) out.hidden = true; const input = $('networkSearch'); if (input) input.value = ''; }
      else if (data.view) setView(data.view);
      else if (data.layout) setLayout(data.layout);
      else if (data.paletteChoice) applyPalette(data.paletteChoice, true);
      else if (data.typeFilter) { const t = data.typeFilter; if (G.typeOff.has(t)) G.typeOff.delete(t); else G.typeOff.add(t); setOn(target, !G.typeOff.has(t)); computeLayout(); }
      else if (data.relFilter) { const f = data.relFilter; if (G.famOff.has(f)) G.famOff.delete(f); else G.famOff.add(f); setOn(target, !G.famOff.has(f)); computeLayout(); }
      else if (data.clearFilters !== undefined) clearFilters();
      else if (data.closePeek !== undefined) { G.peek = false; renderPeek(); }
      else if (data.pathTo !== undefined) openPathfinder(true, data.pathTo);
      else if (data.pathIndex !== undefined) { G.path.chosen = Number(data.pathIndex); applyPathChoice(); }
      else if (data.cooccurSubject !== undefined) { cooc.current = cooc.subjects.has(data.cooccurSubject) ? data.cooccurSubject : cooc.current; renderCooccurrence(); }
      else if (data.drawerTab) { const entry = current(); if (entry) { entry.tab = data.drawerTab; renderDrawer(); $('drawerTabs')?.querySelector(`[data-drawer-tab="${data.drawerTab}"]`)?.focus(); } }
      else if (data.crumb !== undefined) drawerGo(Number(data.crumb));
      else if (data.action === 'search') openGlobalSearch();
      else if (data.jump !== undefined) { event.preventDefault(); goTo(data.jump); }
      else if (data.locate !== undefined) { if (narrow()) closeDrawer(); if (G.expanded) toggleFull(false); selectEntity(data.locate); goTo('network'); }
      else if (target.matches('#reportNav a, #heroActions a[href^="#"]')) { /* native anchor */ }
    }
    if (!event.target.closest?.('.network-search')) { const out = $('networkResults'); if (out) out.hidden = true; }
    const sidebar = $('sidebar');
    if (sidebar && (event.target.closest?.('#reportNav a') || (!sidebar.contains(event.target) && !event.target.closest?.('#menuToggle')))) { sidebar.classList.remove('open'); $('menuToggle')?.setAttribute('aria-expanded', 'false'); }
    if (!event.target.closest?.('#networkViewport') && G.active) setCanvasActive(false);
  });
  on('menuToggle', 'click', () => { const sidebar = $('sidebar'); if (!sidebar) return; const open = sidebar.classList.toggle('open'); $('menuToggle').setAttribute('aria-expanded', String(open)); });
  on('themeToggle', 'click', () => applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark', true));
  on('printReport', 'click', () => window.print());
  on('networkFull', 'click', () => toggleFull());
  on('zoomIn', 'click', () => zoom(.8)); on('zoomOut', 'click', () => zoom(1.25));
  on('fitGraph', 'click', () => fitGraph());
  on('resetGraph', 'click', () => { G.selected = E.has(rootId) ? rootId : coreIds[0]; G.peek = false; G.path.chosen = -1; G.typeOff.clear(); G.famOff.clear(); G.showHistorical = true; renderChips(); setView('core'); });
  on('toggleHistorical', 'click', event => { if (event.currentTarget.type === 'checkbox') return; G.showHistorical = !G.showHistorical; setOn(event.currentTarget, G.showHistorical); computeLayout(); });
  on('toggleHistorical', 'change', event => { if (event.currentTarget.type !== 'checkbox') return; G.showHistorical = event.currentTarget.checked; computeLayout(); });
  on('togglePathfinder', 'click', () => openPathfinder(!G.path.open));
  on('toggleListView', 'click', () => toggleList());
  on('pathFrom', 'change', runPathfinder); on('pathTo', 'change', runPathfinder);
  on('pathConfirmedOnly', 'change', runPathfinder); on('pathIncludeHistory', 'change', runPathfinder);
  on('pathSwap', 'click', () => { const a = $('pathFrom'), b = $('pathTo'); if (!a || !b) return; const t = a.value; a.value = b.value || a.value; b.value = t; runPathfinder(); });
  on('drawerBack', 'click', () => drawerGo(drawer.index - 1));
  on('closeDrawer', 'click', closeDrawer);
  on('drawerBackdrop', 'click', closeDrawer);
  on('drawerCopyLink', 'click', copyDrawerLink);
  on('drawerLocate', 'click', () => {
    const entry = current(); if (!entry) return;
    if (narrow()) closeDrawer();
    if (entry.kind === 'entity') selectEntity(entry.id); else if (entry.kind === 'pair') { const pair = relationMap.get(entry.id); [pair.a, pair.b].forEach(id => G.extra.add(id)); if (!G.layoutPos.has(pair.a) || !G.layoutPos.has(pair.b)) computeLayout(); selectEdge(entry.id); }
    const network = $('network'); if (network) network.scrollIntoView({behavior:reduceMotion() ? 'auto' : 'smooth', block:'start'});
  });
  on('drawerTabs', 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...$('drawerTabs').querySelectorAll('[data-drawer-tab]')], index = tabs.indexOf(document.activeElement); if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
  });
  on('drawer', 'keydown', event => {
    if (event.key !== 'Tab' || !narrow()) return;
    const focusable = [...$('drawer').querySelectorAll('button:not([disabled]), a[href], input, select, [tabindex="0"]')].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown', event => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing) { event.preventDefault(); openGlobalSearch(); return; }
    if (event.altKey && event.key === 'ArrowLeft' && !$('drawer')?.hidden) { event.preventDefault(); drawerGo(drawer.index - 1); return; }
    if (event.key !== 'Escape') return;
    if ($('lightboxDialog')?.open || $('searchDialog')?.open) return;
    if (!$('sourcePopover')?.hidden) { hidePopover(); return; }
    if (!$('networkResults')?.hidden) { $('networkResults').hidden = true; return; }
    if ($('sidebar')?.classList.contains('open')) { $('sidebar').classList.remove('open'); $('menuToggle')?.setAttribute('aria-expanded', 'false'); return; }
    if (!$('drawer')?.hidden) { event.preventDefault(); closeDrawer(); return; }
    if (G.active) { setCanvasActive(false); return; }
    if (G.expanded) toggleFull(false);
  });
  window.addEventListener('hashchange', () => { if (!readHash() && location.hash && !/^#\//.test(location.hash)) { try { const target = $(decodeURIComponent(location.hash.slice(1))); let node = target; while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; } } catch (_) {} } });
  window.addEventListener('scroll', () => hidePopover(), {passive:true});

  // ───────────── Graph pointer, wheel and keyboard interaction ─────────────
  const svg = $('networkSvg'), viewport = $('networkViewport');
  function nearestNode(fromId, key) {
    const from = posOf(fromId); if (!from) return null;
    const dir = {ArrowRight:[1, 0], ArrowLeft:[-1, 0], ArrowDown:[0, 1], ArrowUp:[0, -1]}[key];
    let best = null, bestScore = Infinity;
    for (const n of G.visible) {
      if (n.id === fromId) continue;
      const dx = n.x - from.x, dy = n.y - from.y, d = Math.hypot(dx, dy) || 1, cos = (dx * dir[0] + dy * dir[1]) / d;
      if (cos < .5) continue;
      const score = d * (2 - cos); if (score < bestScore) { bestScore = score; best = n.id; }
    }
    return best;
  }
  if (svg) {
    svg.addEventListener('keydown', event => {
      const node = event.target.closest('[data-node]'), edge = event.target.closest('[data-edge]');
      if (['Enter', ' '].includes(event.key) && (node || edge)) {
        event.preventDefault();
        if (node && event.shiftKey) openDrawer({kind:'entity', id:node.dataset.node});
        else if (node) selectEntity(node.dataset.node); else selectEdge(edge.dataset.edge);
        return;
      }
      if (node && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const next = nearestNode(node.dataset.node, event.key); if (next) G.nodeEls.get(next)?.focus(); }
    });
    svg.addEventListener('dblclick', event => {
      const node = event.target.closest('[data-node]'), edge = event.target.closest('[data-edge]');
      if (node) openDrawer({kind:'entity', id:node.dataset.node});
      else if (edge) openDrawer({kind:'pair', id:edge.dataset.edge});
      else zoom(.7, event.clientX, event.clientY);
    });
    svg.addEventListener('pointerover', event => {
      const node = event.target.closest('[data-node]'); if (node) node.querySelector('.node-label')?.classList.remove('is-hidden');
      const edge = event.target.closest('[data-edge]'); if (edge) (G.labelEls.get(edge.dataset.edge) || []).forEach(l => l.classList.add('is-visible'));
    });
    svg.addEventListener('pointerout', event => {
      const node = event.target.closest('[data-node]'); if (node && !node.contains(event.relatedTarget)) applyLOD();
      const edge = event.target.closest('[data-edge]'); if (edge && !edge.contains(event.relatedTarget)) { const active = edge.classList.contains('active') || edge.classList.contains('path-active'); (G.labelEls.get(edge.dataset.edge) || []).forEach(l => l.classList.toggle('is-visible', active)); }
    });
    svg.addEventListener('pointerdown', event => {
      setCanvasActive(true);
      G.touches.set(event.pointerId, {x:event.clientX, y:event.clientY});
      if (G.touches.size === 2) { const [p, q] = [...G.touches.values()]; G.pinch = {d:Math.hypot(p.x - q.x, p.y - q.y) || 1}; G.pointer = null; return; }
      if (event.button !== 0 || G.pointer) return;
      G.pointer = {id:event.pointerId, startX:event.clientX, startY:event.clientY, x:event.clientX, y:event.clientY, node:event.target.closest('[data-node]')?.dataset.node, edge:event.target.closest('[data-edge]')?.dataset.edge, shift:event.shiftKey, moved:false};
      try { svg.setPointerCapture(event.pointerId); } catch (_) {}
    });
    svg.addEventListener('pointermove', event => {
      if (G.touches.has(event.pointerId)) G.touches.set(event.pointerId, {x:event.clientX, y:event.clientY});
      if (G.pinch && G.touches.size === 2) {
        const [p, q] = [...G.touches.values()], d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        zoom(G.pinch.d / d, (p.x + q.x) / 2, (p.y + q.y) / 2); G.pinch.d = d; return;
      }
      const ptr = G.pointer; if (!ptr || ptr.id !== event.pointerId) return;
      const rect = svg.getBoundingClientRect(), dx = (event.clientX - ptr.x) / Math.max(1, rect.width) * G.box.w, dy = (event.clientY - ptr.y) / Math.max(1, rect.height) * G.box.h;
      ptr.moved ||= Math.hypot(event.clientX - ptr.startX, event.clientY - ptr.startY) > 4;
      ptr.x = event.clientX; ptr.y = event.clientY;
      if (!ptr.moved) return;
      if (ptr.node) { const node = posOf(ptr.node); if (node) { node.x += dx; node.y += dy; updatePositions(); } }
      else { G.box.x -= dx; G.box.y -= dy; setBox(); }
    });
    const release = event => {
      G.touches.delete(event.pointerId); if (G.touches.size < 2) G.pinch = null;
      const ptr = G.pointer; if (!ptr || ptr.id !== event.pointerId) return;
      G.pointer = null;
      try { if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch (_) {}
      if (event.type !== 'pointerup' || ptr.moved) { if (ptr.moved && ptr.node) applyLOD(); return; }
      if (ptr.node && ptr.shift) openPathfinder(true, ptr.node);
      else if (ptr.node) selectEntity(ptr.node);
      else if (ptr.edge) selectEdge(ptr.edge);
    };
    svg.addEventListener('pointerup', release); svg.addEventListener('pointercancel', release);
    svg.addEventListener('lostpointercapture', event => { if (G.pointer && G.pointer.id === event.pointerId) G.pointer = null; });
  }
  if (viewport) {
    viewport.addEventListener('wheel', event => {
      if (event.ctrlKey || G.active || G.expanded) { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : .89, event.clientX, event.clientY); return; }
      showToast('点击图谱后可用滚轮缩放 · Ctrl + 滚轮随时缩放');
    }, {passive:false});
    viewport.addEventListener('keydown', event => {
      if (event.target.closest('input, select, textarea')) return;
      const k = event.key;
      if (k === '+' || k === '=') { event.preventDefault(); zoom(.8); }
      else if (k === '-' || k === '_') { event.preventDefault(); zoom(1.25); }
      else if (k === '0') { event.preventDefault(); fitGraph(); }
    });
  }
  on('networkPanel', 'keydown', event => {
    if (event.target.closest('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    const k = event.key.toLowerCase();
    if (k === 'f') { event.preventDefault(); toggleFull(); }
    else if (k === 'p') { event.preventDefault(); openPathfinder(!G.path.open); }
    else if (k === 'l') { event.preventDefault(); toggleList(); }
  });
  on('networkMinimap', 'click', event => {
    const mini = $('networkMinimap'), bounds = JSON.parse(mini.dataset.bounds || 'null'); if (!bounds) return;
    const rect = mini.getBoundingClientRect(), scale = Math.max(bounds[2] / Math.max(1, rect.width), bounds[3] / Math.max(1, rect.height));
    const cx = bounds[0] + bounds[2] / 2 + (event.clientX - rect.left - rect.width / 2) * scale, cy = bounds[1] + bounds[3] / 2 + (event.clientY - rect.top - rect.height / 2) * scale;
    G.box.x = cx - G.box.w / 2; G.box.y = cy - G.box.h / 2; setBox();
  });
  let resizeFrame = 0;
  if ('ResizeObserver' in window && viewport) new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (!G.printing) fitGraph(); }); }).observe(viewport);

  // ───────────── Scrollspy & reading progress ─────────────
  if ('IntersectionObserver' in window) {
    const observed = new Map();
    const navObserver = new IntersectionObserver(entries => {
      for (const entry of entries) observed.set(entry.target.id, entry.isIntersecting);
      const active = navItems.find(item => observed.get(item.id));
      if (active) document.querySelectorAll('[data-nav]').forEach(link => { const on = link.dataset.nav === active.id; link.classList.toggle('active', on); if (on) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
    }, {rootMargin:'-10% 0px -60% 0px'});
    navItems.forEach(item => { const el = $(item.id); if (el) navObserver.observe(el); });
  }
  let progressFrame = 0;
  function updateProgress() {
    const el = $('readingProgress'); if (!el) return;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight), p = clamp(window.scrollY / max, 0, 1);
    el.style.width = `${(p * 100).toFixed(2)}%`; el.style.setProperty('--progress', p.toFixed(4));
    el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (el.tagName === 'PROGRESS') { el.max = 1; el.value = p; }
  }
  window.addEventListener('scroll', () => { cancelAnimationFrame(progressFrame); progressFrame = requestAnimationFrame(updateProgress); }, {passive:true});

  // ───────────── Print (A4) ─────────────
  function printRelationsHtml() {
    const rows = validRelationships.slice().sort((a, b) => FAMILY_ORDER.indexOf(family(a)) - FAMILY_ORDER.indexOf(family(b)) || String(name(a.from)).localeCompare(String(name(b.from)), 'zh-CN'));
    if (!rows.length) return '';
    return `<div class="table-scroll"><table class="fact-table print-relations-table"><thead><tr><th scope="col">起点</th><th scope="col">关系</th><th scope="col">终点</th><th scope="col" class="num-cell">比例 / 金额</th><th scope="col" class="num-cell">日期 / 期间</th><th scope="col">状态</th><th scope="col">来源</th></tr></thead><tbody>${rows.map(e => `<tr class="fam-${family(e)}"><td>${esc(name(e.from))}</td><td>${esc(e.label || relLabel(e))}<small> · ${esc(FAMILY[family(e)])}</small></td><td>${esc(name(e.to))}</td><td class="num-cell">${esc([e.percent != null ? fmtPct(e.percent) : '', e.amount != null ? [valueText(e.amount), e.currency, e.unit].filter(Boolean).join(' ') : ''].filter(Boolean).join(' · ') || '—')}</td><td class="num-cell">${esc(e.date || [e.valid_from, e.valid_to].filter(Boolean).join(' — ') || '—')}</td><td>${esc(statuses[edgeStatus(e)] || (isSignal(e) ? '关联信号' : '现行'))}</td><td>${esc(arr(e.sources).map(id => `[${id}]`).join(' '))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function printEvidenceHtml() {
    const order = [...Object.keys(GRADES), ...uniq([...C.values()].map(c => c.kind)).filter(k => !GRADES[k])];
    return order.map(kind => {
      const list = [...C.values()].filter(c => c.kind === kind); if (!list.length) return '';
      return `<section class="print-grade-group"><h3>${gradeBadge(kind)} · ${list.length}</h3>${list.map(claimHtml).join('')}</section>`;
    }).join('');
  }
  let printState = null;
  window.addEventListener('beforeprint', () => {
    if (printState) return;
    hidePopover();
    printState = {details:[...document.querySelectorAll('details')].map(el => [el, el.open]), box:{...G.box}, fitWidth:G.fitWidth, list:G.list, viewportHidden:$('networkViewport')?.hidden};
    G.printing = true;
    setHidden('networkViewport', false);
    setHtml('printRelationsContent', printRelationsHtml());
    setHtml('printEvidenceContent', printEvidenceHtml());
    document.querySelectorAll('[data-entity-record]').forEach(materialize);
    document.querySelectorAll('img').forEach(image => { image.loading = 'eager'; });
    printState.details.forEach(([el]) => { el.open = true; });
    document.querySelectorAll('.source-card[hidden]').forEach(card => { card.dataset.printHidden = '1'; card.hidden = false; });
    fitGraph(null, 180 / 130);
    applyLOD();
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    printState.details.forEach(([el, open]) => { el.open = open; });
    document.querySelectorAll('.source-card[data-print-hidden]').forEach(card => { card.hidden = true; delete card.dataset.printHidden; });
    G.printing = false; G.box = printState.box; G.fitWidth = printState.fitWidth;
    setHidden('networkViewport', Boolean(printState.viewportHidden));
    printState = null;
    setHtml('printRelationsContent', ''); setHtml('printEvidenceContent', '');
    setBox(); applyLOD(); requestAnimationFrame(() => fitGraph());
  });

  // ───────────── Initialise ─────────────
  G.layout = chooseInitialLayout();
  document.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === G.layout)));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === G.view)));
  renderChips(); renderLegend(); populatePathSelects();
  setHidden('pathfinderBar', true); setOn($('togglePathfinder'), false);
  setHidden('networkListView', true); setOn($('toggleListView'), false);
  setOn($('networkFull'), false); setHidden('networkMinimap', true); setHidden('canvasToast', true); setHidden('networkPeek', true);
  if (G.visible.length === 0) computeLayout({instant:true});
  renderPeek(); updateProgress();
  if (!readHash() && location.hash && !/^#\//.test(location.hash)) {
    try { const target = $(decodeURIComponent(location.hash.slice(1))); let node = target; while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; } } catch (_) {}
  }
})();
