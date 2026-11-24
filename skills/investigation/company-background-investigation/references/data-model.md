# 统一资料模型

目录：顶层对象；主体；关系；来源；主张；证据留存；事件与岗位；正文与档案；图片；时间与金额；构建期分析结果；增量更新。

## 顶层对象

一个 UTF-8 JSON 作为报告的唯一资料源。渲染器不另存股东表或人物名单。根节点可以是任一主体类型：公司、人物、投资方、机构、产品或品牌。

```json
{
  "schema_version": 1,
  "meta": {
    "title": "调查对象｜深度背景调查", "subtitle": "人物、组织、资本与产品",
    "root_id": "co-root", "root_type": "company", "as_of": "2000-12-31", "summary": "核心判断",
    "core_ids": ["co-root"], "language": "zh-CN"
  },
  "entities": [], "relationships": [], "sources": [], "assets": [],
  "findings": [], "sections": [], "questions": [], "archives": [], "timeline": []
}
```

这里的日期仅示范格式。正式报告填写实际资料截至日；`assets/example-data.json` 的主体、事件、来源、图片与日期全部为虚构样本。

这里的两个随附演示文件分别以公司（`example-data.json`）和人物（`example-person-data.json`）为根节点，均为虚构样本。

保留 `schema_version: 1` 和旧字段。新增的 `claims、evidence_manifest、events、role_assessment` 以及下文标注“可选扩展”的多根节点字段均为兼容扩展：旧稿无需修改即可通过检查，可逐步补充；新调查的重要判断使用主张记录。现有渲染字段 `sources[]` 继续保留，同时加入 `claim_ids[]` 连接证据细节。正文和图谱从统一记录生成，避免独立维护不同答案。

新增字段避免使用全局检查器按名称识别的键：任意层级的 `sources、source_ids、entity_ids、image_ids、claim_ids、input_claim_ids` 视为 ID 引用，`date、valid_from、valid_to、published_at、observed_at、as_of、effective_at、accessed_at、captured_at、snapshot_at` 视为日期，`percent` 视为 0–100 数值，`amount` 需同时带 `currency` 与 `unit`。扩展字段只在符合这些含义时使用这些名称。

`meta.as_of` 是整份调查的资料截至日；可用 `meta.snapshot_at` 明确本次研究快照日，二者至少精确到日。`meta.generated_at` 记录成稿时间。各主张保留自己的统计/快照时点，报告日期覆盖不了的材料缺口按原样保存。

`meta.navigation` 可选，格式为 `[{"label":"先认识公司","target":"overview"}, ...]`，用于保留既有八个入口。target 指向实际 DOM id：overview、network、正文 section 的原始 id、questions、archives、timeline、sources。未设置时由渲染器生成目录。正式默认八入口可依次指向 overview、人员正文、network、业务正文、案例正文、团队正文、questions、archives；时间线和来源继续在完整资料中阅读。正文 section.id 不使用 overview、network、questions、archives、timeline、sources 六个保留 ID。

### 根节点 meta 扩展（可选）

| 字段 | 约定 |
| --- | --- |
| `root_type` | 与根主体的 `type` 一致：`company、person、investor、institution、product、brand`。省略时由根主体推导；二者不一致时检查器给出警告 |
| `purpose` | 本次调查目的的一句话，例如入职、合作、投资、供应商或关联方尽调 |
| `ui_labels` | 字符串到字符串的对象，覆盖根类型自动文案。可用键：`reportKind、heroEyebrow、judgmentLabel、questionsTitle、brandSub、networkKicker、emptyJudgment` |

`ui_labels` 只用于案件确有特殊称谓时，例如把“机构判断”改为“基金会判断”；一般情况下交给模板按根类型生成。

## 主体 entities

必填 `id, name, type, summary, sources`。type 取 `company, person, product, brand, investor, institution`。品牌、法律主体、产品、商店发行账号的运营公司分别建档；同名候选身份保留独立 ID。

可选：`short_name, aliases[], role, cluster, status, fields[], facts[], career[], sections[], image_ids[], importance`。

多根节点可选扩展：

- `identifiers[]`：`{scheme, value, jurisdiction?}`。scheme 使用小写短名，例如 `cn_uscc`（统一社会信用代码）、`lei`、`sec_cik`、`company_number`、`domain`、`app_id`、`product_model`、`trademark`、`orcid`。scheme 与 value 为非空字符串；跨案件合并只在 `(scheme, value)` 完全相同时自动合并。
- `registry_status`：登记存续状态，取 `active`（存续/在业）、`dissolved`（注销）、`revoked`（吊销）、`deregistered`（撤销/除名）、`unknown`。它与 `status` 分开：`status` 表达调查中的时间/核验状态，`registry_status` 表达登记机关记录的主体状态。已注销或吊销的组织通常同时标 `status: historical`。
- `identity_basis`：`{anchors, decision, notes?, claim_ids?}`。anchors 为 `{name, organization, time, place_or_network}`，每项取 `match、conflict、unknown`；decision 取 `merge、candidate、separate`。用于记录人物或同名主体的四锚点消歧结论，规则见 [evidence-and-identity.md](evidence-and-identity.md)。

- `fields[]`：`{label, value, sources[]}`，用于信用代码、司法辖区、资本等。
- `facts[]`：`{text, sources[], date?, status?}`。
- `career[]`：`{date, title, text, sources[]}`。
- `sections[]`：`{title, text, sources[], image_ids[]}`，用于具体工作、产品角色、案例和争议。
- `status`：`current, historical, candidate`；自述、转述等细分来源属性放到事实和来源记录。
- 产品 metrics 放在 fields 或 sections 中，写全单位、市场、统计周期和观察日。
- 实际控制判断写在有来源的事实或分析中；持股边仍按登记的方向与比例记录。

## 关系 relationships

每条记录必填 `id, from, to, type, label, sources`。两个主体之间允许多条事实；图上的主体配对数量按无序两端去重，事实数量按关系记录计数。

可选：`detail, date, valid_from, valid_to, status, percent, amount, currency, unit, nature, disputed, claim_ids[], event_id`。

- type 为自由文本，建议使用以下词表，各行业通用：

| 关系族 | type | 方向与要点 |
| --- | --- | --- |
| 资本 | `ownership, investment` | 股东/出资人 → 被投主体；合伙份额用 `role_code: gp/lp` 区分 |
| 治理与任职 | `founding, officer, employment` | 人 → 组织；`officer` 记登记职务（董事、监事、法定代表人），`employment` 记经营或雇佣职务 |
| 业务 | `partnership, creation, operation, publishing, client, supplier, counterparty` | 按实际行为方向：开发者 → 产品，供应商 → 客户 |
| 信号 | `shared_address, shared_domain, shared_filing_agent, domain` | 两端为共享同一线索的主体，配 `edge_class: signal` 与 `signal_key` |
| 身份 | `same_as_candidate` | 已确认人物 → 同名候选；配 `status: candidate`、`edge_class: signal` |
| 其他 | `litigation_party, fund_manager, historical, candidate` | 按原始材料命名 |

- `nature` 用于图形样式，取 `capital` 或 `business`。持股方向：股东 → 公司；任职：人 → 公司；发行：发行公司 → 产品。信号边不需要 nature。
- 多根节点可选扩展：
  - `role`：材料中的原始职务或身份称谓，例如“监事”“财务负责人”“普通合伙人兼执行事务合伙人”。
  - `role_code`：归一化角色，取 `founder、shareholder、director、supervisor、executive、legal_rep、gp、lp、employee、advisor、partner、auditor、agent、other`。未识别的值只产生警告，便于各行业、各法域使用原始称谓。
  - `edge_class`：`fact`（默认，直接事实）、`signal`（共同住所、共同域名、共同申报代理等线索）、`derived`（由其他事实推导，如共现伙伴边）。signal 与 derived 边不进入确认路径与控制链计算。
  - `signal_key`：信号所共享的归一化值，例如完整登记住所、域名或代理机构名称，便于跨主体与跨案件聚合。
- `percent` 为 0–100 的数值，金额与币种另存。认缴、实缴分别建事实；完整股东快照需记录日期和覆盖状态。
- `status` 可为 `current, historical, candidate, disputed`。候选/争议边单独着色，默认核心网络不通过这类边推导确认路径。
- `sources` 至少有一条具体出处。分析性连接使用 `type: candidate` 并写明推理依据；把无出处的待查线索留在调查日志。
- `summary/text/detail/answer` 是直接展示给读者的字段，只写事实、必要未知及经营解释。去重说明、为何修改数据、核验动作和开发过程放到内部日志或 revision，不进入这些字段。
- 路径使用可双向遍历的邻接关系寻找，但展示时恢复每条原始边的箭头、标签与状态。关系路径用于解释连接，控制链只沿已支持的持股/控制边计算。
- 同一主体对的同一事项若有多期事实，分别建边并用 `valid_from/valid_to` 或 `status: historical` 区分；穿透计算采用最新一期的当前边，不把多期比例相加。
- 推导出的人物共现边通常由 `analyze_network.py` 或构建器在运行时计算，无需写入数据；确需保存时使用 `edge_class: derived`，并在 `claim_ids` 中引用作为输入的主张。

## 来源 sources

必填 `id, title, url, kind, observed_at`。可选 `publisher, published_at, accessed_at, locator, excerpt, origin_id, status, web_ref`。

- kind 取 `official, registry, first_party, store, court, media, forum, user, archive, analysis`。
- URL 用原始 HTTPS 地址；用户补充使用 `#source-U001` 这样的内部锚点，并在 title 或 excerpt 写清转述内容。
- locator 写页码、附件行号、商店 ID、版本号、表格工作表或具体段落。
- 同一稿件的转载用 `origin_id` 连接，核验独立性时按原始来源计数。
- published_at 是材料发布日期，observed_at 是实际访问日；事实发生/生效和统计时点写在主张本身。可选 accessed_at 与同一访问记录的 observed_at 保持一致。
- 状态异常在一条来源记录中记清，如 `unavailable, excerpt_only, superseded`，保留已存快照出处。
- HTML 内链接到完整来源索引，索引保留原始 URL；聊天说明使用宿主可解析的引用机制或原始 URL。
- `web_ref` 仅为当前会话引用与内部核对使用；用户页面呈现来源标题、原始 URL 和定位。

## 主张 claims

每条主张只表达一个可核验事项或一个明确分析。重要权益、金额、当前角色、产品工作、岗位判断与首页结论建立记录：

| 字段 | 约定 |
| --- | --- |
| `id, text` | 稳定 ID 与直接陈述 |
| `kind` | `fact、company_statement、user_report、analysis`；与来源种类独立 |
| `entity_ids[], source_ids[]` | 涉及主体和实际支持来源；均使用已有 ID |
| `locator` | 页/表/行/段/版本等原文位置；多来源时用来源 ID 对应定位 |
| `published_at` | 主要支持材料的发布日期；多来源分别在 evidence 中记录 |
| `effective_at` | 事实发生或法律/业务生效时点；有效区间另用 valid_from/valid_to |
| `as_of` | 该事实的统计或快照时点，例如期末余额日或股东快照日 |
| `accessed_at` | 本次实际读取支持材料的日期；多来源时为本轮最晚实际访问日 |

以上字段在新建主张中齐备。`published_at、effective_at、as_of` 允许 `null`，并保留原文精度：`YYYY、YYYY-MM、YYYY-MM-DD` 或 ISO 时间戳。`accessed_at` 至少精确到日。发生、统计和发表日期均从相应材料取得，访问日单独填写。

可选字段：

- `status`：`current、historical、candidate、disputed`。公司自述通过 kind 表达；状态单独描述时间或待核情况。
- `evidence[]`：`{source_id, locator, published_at, accessed_at, snapshot_id?}`。多来源、多版本或不同支持范围时逐条填写前四项；snapshot_id 指向 evidence_manifest。
- `scope`：按需要记录 `jurisdiction、entity_scope、market、platform、period、metric_definition、unit`，保留实际口径。
- `input_claim_ids[], reasoning`：分析所依赖的主张与推理/公式；区分实测输入和情景假设。
- `uncertainty`：该主张真正影响理解的未知或分歧；同一项只维护一次，可由正文引用。
- `valid_from, valid_to, event_id`：有效区间及关联事件。用户报告的直接观察/转述属性可写入 `scope.report_basis`。

`fact` 表达来源直接支持的事项；公司自报业绩、预测和目标按 `company_statement` 呈现。涉及争议时，明确主张的是事件事实、某方提出的说法还是调查分析。公开文件中有一项说法，可记录“该方在何时作此陈述”，其内容另按证据核验。

以下只示范字段，不作为实际调查证据：

```json
{
  "id": "C001", "text": "公司甲在该期末持有公司乙24%的股份。",
  "kind": "fact", "entity_ids": ["co-a", "co-b"], "source_ids": ["S001"],
  "locator": "股东表第3行", "published_at": null,
  "effective_at": null, "as_of": "2000-12-31", "accessed_at": "2001-01-15",
  "evidence": [{"source_id": "S001", "locator": "股东表第3行",
    "published_at": null, "accessed_at": "2001-01-15", "snapshot_id": "E001"}],
  "status": "historical"
}
```

`claim_ids[]` 可放在 entities 的 facts/fields/career/sections、relationships、findings、正文 blocks/steps、questions/evidence、archives/blocks 和 timeline 中。各处的 sources 保持与相应主张的支持范围一致。保持可读日期和关键口径在正文中出现，细节由主张入口展开。

## 证据留存 evidence_manifest

为每个实际留存文件或明确的获取结果建档。一个来源可有多个时点和表示形式；原件与派生件分别建记录。

| 字段 | 约定 |
| --- | --- |
| `id, source_id` | 留存记录 ID 与对应来源 ID |
| `representation` | `original_file、web_snapshot、screenshot、extracted_text、excerpt` |
| `status` | `stored、unavailable、metadata_only` |
| `captured_at` | 实际保存或获取尝试时间，至少精确到日 |
| `path, sha256, bytes` | stored 必填：相对数据文件的真实路径、文件字节的64位十六进制 SHA-256、正整数字节数 |
| `origin_url, locator` | 可选；原始地址和取得部分的范围 |
| `parent_snapshot_id` | 可选；OCR、裁剪、转换或节选的直接上游留存记录 |
| `access_note, storage_uri` | 可选；具体取得状态和持久保存位置 |

`unavailable、metadata_only` 的 path/sha256/bytes 省略或为 null，并以 access_note 写清具体状态。只取得检索摘要或工具提取文本时，可把实际收到的内容保存为 excerpt/extracted_text 并计算该文件哈希；标明其表示形式和取得范围。原始页面或附件字节尚未取得时，其原件哈希保持空值。哈希用于检验文件字节一致性，来源身份和支持范围按证据核验。

文件保存后再从磁盘读取计算哈希和字节数；更新证据时新增快照记录，保留旧文件。相对 path 随调查数据一并保存，storage_uri 记录实际可用的持久位置。报告展示必要摘录与出处；完整附件、截图和提取文本由清单连接。

## 事件与岗位扩展

`events[]` 可用 `{id, title, entity_ids[], claim_ids[], date, stage, event_key?, text?}` 记录同一事件。event_key 保存案号、项目号、交易/产品标识等；date 是该阶段日期，stage 使用材料中的宣布、签约、生效、收款或处理阶段。正文与关系可用 event_id 连接。转载按同一事件汇聚，阶段变化保留各自主张。

`role_assessment` 可用 `{target_role, team?, location?, dimensions[]}`。每项 dimension 包含 `{id, title, answer, claim_ids[], sources[]}`；五维 ID 建议为 `actual_technology、operating_systems、prior_experience、domain_knowledge、working_conditions`。按岗位改变问题内容；前台使用 sections/questions 呈现，与现有八入口和十一档案衔接。

## 正文与档案

- `findings[]`：`{id, title, text, sources[], entity_ids[]}`，用于首页关键判断。
- `sections[]`：`{id, title, kicker?, intro?, blocks[]}`。每个 block 为 `{title?, text?, sources[], entity_ids[], image_ids[], steps[]}`；steps 是 `{title,text,sources[]}` 的有序数组，用于业务与资金流程。
- `questions[]`：`{id, question, answer, why_it_matters?, sources[], evidence[]}`，evidence 为 `{text,sources[],entity_ids[]}`。
- `archives[]`：`{id,title,intro?,entity_ids[],source_ids[],blocks[]}`。引用相同实体记录，不复制一份人物数据。
- `timeline[]`：`{date,title,text,sources[],entity_ids[]}`。
- 首次制作默认使用八个阅读入口和八个问题；案件特点可调整标题和数量。更新既有报告时保留已获认可的目录、ID 与阅读顺序。

可选的首页指标与正文图表：

- 顶层 `metrics[]`：`{label, value, detail?, sources[], claim_ids[]?}`。value 是带单位的显示字符串，detail 写时期与范围；优先展示少量最能解释公司的经营指标。
- `block.chart`：`{title, unit, decimals?, rows:[{label, segments:[{name,value}]}], note?, sources[]?, claim_ids[]?}`。value 使用同一单位的非负有限数，decimals 为 0–6 的整数，默认 1；模板绘制同尺度堆叠条形并提供数值详情。不同期间或类别的定义保持可比，负值和不可相加指标改用表格，未知值用文字说明。
- `block.table`：`{headers:[string], rows:[{cells:[string/number], sources[]?, claim_ids[]?}]}`。每行可附出处；使用出处列时 headers 末尾加入“来源”，所有行都提供 sources 数组，使表头与各行列数一致。

图表中的单位、期间、主体范围、来源和分析属性与主张一致。把图形所需数据直接保存在 JSON 中，避免图片里的数字与正文脱节。

## 图片 assets

`{id, path, mime?, alt, caption?, sources[]}`；`path` 相对 JSON 所在目录，或当前系统可读取的绝对本地文件路径。分享 JSON 与图片时优先使用相对路径，并用 `/` 分隔目录，例如 `images/product.png`。在 Windows 上可以使用 `C:/资料/product.png`；使用反斜杠时须遵守 JSON 转义规则。其他系统的盘符、URL 和网络共享路径不作为本地图片路径。构建器将真实已获取图像嵌入 data URI，输出 HTML 不依赖图片服务器。也可直接给 `data_uri`。

保留图像来源、观察日期和标题；优先官网实图、商店截图、产品界面、官方附件。图像不能代替文字来源。关系图和财务图直接由结构化数据生成，不用生成式图像绘制事实。

图片同时承担证据时，在 evidence_manifest 记录实际文件及其派生关系；assets 负责页面展示，证据清单负责留存追溯。

## 时间与金额

注册资本、认缴、实缴、融资宣布/到账、项目预算、政策拟支持、拨付安排、收入、流水、现金余额、现金流、净利润分别存储。人物现职、历史任职、离开转述分别标时间。金额的数值、币种、单位、期间、所属主体、合并范围与来源同时保留。

仅在存在足够可核验输入时建立财务情景模型，保存公式、输入来源、低中高假设和敏感性；模型输出使用明确的情景名称。未知数值使用 null，不填 0。

## 构建期分析结果 `__computed`

`build_report.py` 在验证通过后，对内存中的数据副本调用 `network_core.compute_analytics()`，把结果写入 HTML 内嵌数据的 `__computed` 键。dossier.json 本身不保存这些派生值，避免与事实记录脱节；`analyze_network.py --out` 可另存同结构的分析文件供核对。报告脚本在缺少 `__computed` 时回退到基于 entities/relationships 的简化计算。

| 键 | 结构 | 计算口径 |
| --- | --- | --- |
| `root` | `{id, type}` | 根主体 ID 与类型 |
| `ownership` | `{entity_id: {effective_pct, direct_pct, coverage, has_cycle, paths[{ids, edge_ids, pct}]}}` | 公司根计算各主体在根中的穿透权益；人物、投资方等根计算根在各主体中的穿透权益。只用当前、有来源、非候选的 `ownership/investment` 或 `nature: capital` 边，且 0 < percent ≤ 100；各路径比例连乘后相加，`coverage: partial` 表示股东快照合计不足 100%，`has_cycle` 标记交叉持股 |
| `co_occurrence` | `{subject_id, rows[{partner_id, partner_name, score, shared_count, shared_active, shared_dissolved, organizations[{id, name, registry_status, subject_role, partner_role}], first_seen, last_seen}], by_person?}` | 统计确认的人物—组织边（含历史边）；组织的 `registry_status` 为 dissolved、revoked、deregistered 时计入 shared_dissolved。人物根以根为主体，其他根计算与根相连的关键人物并放入 `by_person` |
| `confidence` | `{entities: {id: {grade, independent_sources}}, relationships: {id: {...}}}` | grade 取 `A_registry、B_multi_independent、C_single、signal、candidate、disputed`；独立来源数先按 `origin_id` 合并转载 |
| `centrality` | `{id: {degree, betweenness}}` | 基于确认边的无向图 |

这些数值服务于阅读与核对，判断仍以主张和原文为准：穿透比例是经济权益的算术结果，实际控制另依表决权、协议与治理材料；共现分数提示值得深查的伙伴，不单独构成关系结论。

## 增量更新

保留稳定 ID。更正身份合并需要保存别名与合并依据；替代旧事实保留其历史时间。新增来源回填相关主体、关系、案例、问题和首页判断。

`revision.kind` 使用 `research_update` 或 `presentation_only`。研究更新推进实际复核范围和 meta.snapshot_at/as_of，未重查主张保留原来的访问与统计日期；表现调整只更新 meta.generated_at，保留研究快照及来源访问日。可在 revision 中记录本次更新的 claim_ids 和保留的基线文件身份。

运行 `validate_dossier.py --previous 旧数据.json 新数据.json` 检查消失的实体、关系、来源、图片、章节、问题和档案，以及本次已采用的主张与证据记录；有意替换通过 `revision.retired_ids` 写出 `{kind,id,reason}`，必要时保留 replacement_id。单独添加新章节不能完成更正传播。

`diff_dossier.py 旧数据.json 新数据.json --md` 列出两版之间新增、删除与变更的主体、关系、持股比例、登记状态、主张与来源，用于撰写版本说明和复核更正是否传播到位。多个案件共享主体时，`merge_dossiers.py` 按 `identifiers` 精确匹配合并，冲突的本地 ID 加案件前缀，`x_cases` 记录每条记录的来源案件；仅姓名相同的人物以 `same_as_candidate` 边连接，留待四锚点复核。
