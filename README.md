# 鄱阳湖湿地 FVC · Poyang Wetland FVC

可复用的 AI Skill 与浏览器本地分析网站源码。支持导入真实 NDVI CSV / 单波段 GeoTIFF，比较 MNDWI、NDWI 和已有水体掩膜方案，以二元像元模型探索植被覆盖度。

**不包含真实观测数据，也不会生成伪造观测值。** 原始文件在浏览器中处理，不上传到分析服务器。

在线工具：[鄱阳湖湿地 FVC 交互分析](https://poyang-wetland-fvc-lab.qhnfasci.chatgpt.site)。该在线版本独立维护；本仓库的源码模板补充了缺失掩膜处理等修正，未自动替换原站点。

## 仓库结构

- `skills/poyang-wetland-fvc/SKILL.md`：Skill 指令与触发说明。
- `skills/poyang-wetland-fvc/assets/site/`：完整前端源码、依赖锁文件和模型测试。
- `skills/poyang-wetland-fvc/scripts/scaffold.mjs`：生成新项目的脚本，不覆盖非空目录。
- `skills/poyang-wetland-fvc/references/`：数据约定、模型计算方法和已知局限。

## 本地运行网站

安装 Node.js（建议 22 或更新版本）后，在命令行运行：

```sh
git clone https://github.com/THE-po8/poyang-wetland-fvc.git
cd poyang-wetland-fvc
node skills/poyang-wetland-fvc/scripts/scaffold.mjs ./fvc-site
cd fvc-site
npm ci
npm test
npm run build
```

使用任意静态 HTTP 服务打开 `dist/`。例如已安装 Python 3 时：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

在浏览器访问 `http://localhost:4173`。不要直接双击源码 HTML；需要先构建 JavaScript 依赖。

## 使用 Skill

Skill 目录是 `skills/poyang-wetland-fvc/`，不是仓库根目录。可将该完整目录安装到支持文件夹式 Skill 的工具中；具体安装方式以所用客户端为准。

例如在 Codex 中将完整目录放入个人技能目录后，可使用：

> 使用 $poyang-wetland-fvc，生成一个本地湿地 FVC 分析网站；没有真实数据时只显示导入入口。

Skill 是指导 AI 执行工作流程的指令与资源集合，不是无需运行环境的独立软件。

## 模型与数据

1. 导入真实 NDVI，并提供至少一种水体指数或水体掩膜。
2. 排除无效 NDVI、缺少掩膜分类的像元及水体像元。
3. 按每种方案的有效非水体 NDVI 独立计算 P5 和 P95，作为 NDVIsoil 与 NDVIveg。
4. 使用 `FVC = clamp((NDVI - P5) / (P95 - P5), 0, 1)`。分位数在排序位置 `(n - 1) × q` 处线性插值。
5. 水体与无效像元的导出 FVC 留空，不设为 0；端元相同或有效像元不足时停止分析。

CSV 表头结构（没有观测数据行）：

```csv
pixel_id,x,y,ndvi,mndwi,ndwi,water_mask
```

NDVI 必需，MNDWI / NDWI / water_mask 至少提供一项。默认指数阈值为 `> 0`，已有掩膜阈值为 `> 0.5`，可交互调整；阈值不是经验证的通用水体标准。

## 科研边界与验证状态

- 非水体不等于湿地植被。请先完成研究区、植被范围及云/阴影的适当掩膜；不要仅凭工具中的界面名称认定所有结果均为湿地植被。
- GeoTIFF 须先在 GIS 中对齐 CRS、分辨率、范围与像元网格。当前程序只检查尺寸和可用包围盒，不验证完整 CRS/仿射变换等价关系，也不重投影或重采样。
- CSV 预览为输入行顺序，不是地理地图；栅格导出中的 x/y 是列/行索引，不是世界坐标。
- 所有栅格加载到浏览器内存，大影像应先裁剪。无可靠像元面积时不可由计数直接宣称植被面积。
- 已通过 8 项模型单元测试及生产构建；不代表真实影像精度验证或完整浏览器兼容性测试。测试中的数值数组仅为数学测试用例，不是鄱阳湖观测数据。
- 不保证输出可直接作为论文结论，请独立进行质量控制、精度评估和方法适用性判断。

## 开源许可

原始代码与 Skill 使用 [MIT License](LICENSE)，允许免费使用、修改和再分发（也允许商业使用），须保留许可及版权声明。第三方依赖保留其各自的许可证；再分发构建产物时应保留相关声明。
