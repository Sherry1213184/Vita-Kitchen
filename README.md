# Vita Kitchen — 开发交接说明

这是已上线的公寓朋友点菜网站的源码快照。
来源提交：988bcbae9c36a34825593cf403b91ec67f61d1e2
目标 GitHub 仓库：https://github.com/Sherry1213184/Vita-Kitchen
线上网址：https://yus-kitchen.candicesy123.chatgpt.site

## 维护迭代
- 面向 10 人以内朋友使用，优先方便、美观、快捷。
- 每轮新增功能、修复和发布状态见 [CHANGELOG.md](CHANGELOG.md)。
- 协作、验证、发布与回退见 [docs/release.md](docs/release.md)。
- 第一轮新增手机点菜单快捷入口、个人历史翻页和厨房待处理筛选。
- 第二轮新增活动出游、报名和默认 GBP 的共享账本，支持活动关联、均分及结清记录；代码待审阅发布。
- 本地检查：`pnpm run typecheck`、`pnpm test`、`pnpm run build`。

## 当前功能和约定
- 中文菜单，不显示价格、菜品介绍和首页分类；番茄炒蛋默认不配图。
- 点菜、口味备注、订单状态、订单成品照片、评价。
- 所有获邀且已登录的朋友都能管理厨房和菜品、上传图片。
- 我的订单只显示自己的订单；所有获邀成员可在厨房管理中共同处理订单。
- 我的订单按每页 20 单独立查询；厨房显示全部待处理订单及最近 50 单已取餐订单。
- 个人昵称、房间号、头像；朋友列表不公开房间号。
- 网站当前为邀请制，访问限制由 ChatGPT Sites 平台执行。
- 活动出游与账本对所有获邀成员共享；只能以自己身份报名，朋友可共同编辑计划、记录结清。
- 分摊名单来自已保存昵称的朋友。金额以整数分/便士保存，默认 GBP，可选 CNY/EUR；不跨币种合计，不执行转账。

## 技术栈
React + TypeScript + Vinext；Cloudflare Workers、D1（SQLite）、R2；Drizzle 管理数据库结构。
不是纯静态网页，不能直接靠 GitHub Pages 运行完整功能。

## 安装及本地运行
需要 Node.js >=22.13 和 package.json 指定版本的 pnpm。先安装依赖：

```sh
pnpm install --frozen-lockfile
pnpm run build
```

首次在本地运行数据库时，按文件名顺序逐个执行 drizzle 目录的 .sql 文件（目前为 0000、0001、0002、0003）：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dark_sasquatch.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_fluffy_the_captain.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_needy_liz_osborn.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_confused_prism.sql
pnpm run dev
```

这些命令只操作本地模拟数据库。同一个本地数据库不要重复执行已经应用的迁移。
干净的源码解压/克隆默认使用 portable 模式，默认开发端口 5173。查看终端输出的本地地址。
portable 开发模式提供仅限 loopback 的模拟 ChatGPT 登录；页面上的登录链接会走该模拟流程。
本地数据库和图片存储与线上独立，不含线上订单、朋友信息或上传的照片。
源码已通过构建、类型检查及部分逻辑检查；接手后仍需做完整浏览器联调。

## 优先修改的文件
- app/kitchen.tsx：菜单、点菜、订单、评价、朋友、厨房管理界面
- app/globals.css：样式和响应式布局
- app/page.tsx：首页服务端数据加载
- lib/kitchen-client.ts：前端接口请求和错误处理
- lib/kitchen.ts：身份、共享厨房权限、数据库查询和初始菜品
- app/api/kitchen/route.ts：点菜、上传、编辑菜品、评价和资料保存接口
- app/api/images/[id]/route.ts：图片读取及访问控制
- db/schema.ts、drizzle/：数据库结构和迁移

## 登录、访问和发布
线上登录依赖 Sites 注入的可信身份头，不能用前端传入的邮箱替代身份验证。
当前所有获邀成员可管理厨房，依赖平台邀请制的访问边界；若迁移到其他平台或改为公开访问，需要先实现成员鉴权，避免任意登录用户都能管理厨房。
ADMIN_EMAIL 不再控制厨房权限，已改为全部获邀成员共同管理。
.openai/hosting.json 中是现有 Site 的关联 ID 和逻辑存储绑定，不是密钥。不要为了发布到其他平台复用这个 ID 或访问配置。
本项目暂未配置 GitHub 自动部署。GitHub 上提交修改不会更新线上网站。先用分支和 PR 讨论修改，合并后再由网站所有者通过 Sites 发布；迁移托管时另行配置登录、数据库、图片存储和部署。
不要改写已经上线的历史 SQL 迁移，新数据库变更应追加迁移。

## 上传到 GitHub
压缩包不包含 .git、node_modules、构建产物、登录令牌和本地/线上数据库。
解压后上传 Vita-Kitchen 文件夹里的源码，不要只上传 ZIP。
浏览器单次上传文件数有限：先上传 components 文件夹，提交；再上传其余所有文件和文件夹，提交。
也可以使用 GitHub Desktop 或由协作者用 Git 提交整个目录。请保留 .gitignore 和 .openai 目录。
