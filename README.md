# 考研任务管理器

一个为考研人设计的任务规划网页：把"大任务 + 速度 + 截止日期"自动拆解到每一天，
告诉你今天该做什么、剩余多少，并随你的进度更新后续计划。

![tech](https://img.shields.io/badge/React-18-61dafb)
![tech](https://img.shields.io/badge/TypeScript-5-3178c6)
![tech](https://img.shields.io/badge/Vite-5-646cff)
![tech](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e)

## 特性

- **8 大类任务**：看书、看网课、刷题、背诵知识点、背诵单词、梳理教材、整理论文、整理框架
- **智能分摊**：输入"总量 + 速度 + 截止日期"，自动算出每天该做多少
- **可视化**：
  - 月历视图（每天的任务量、超额标记）
  - 甘特图视图（所有任务时间线）
- **每日可用时间**：默认 6h，可临时调整
- **超额处理**：任务超出当天可用时间时，引导你选择处理方案
- **单用户、零账号**：打开就用，数据存 Supabase

## 技术栈

- React 18 + Vite + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL)
- @tanstack/react-query
- Zustand
- date-fns

## 本地开发

### 1. 克隆并安装依赖

```bash
npm install
```

### 2. 配置 Supabase

1. 在 [supabase.com](https://supabase.com) 创建免费项目
2. 进入项目 → SQL Editor → 运行 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
3. 在 Project Settings → API 找到 `URL` 和 `anon public key`
4. 复制 `.env.example` 为 `.env.local`，填入上面两个值：

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 3. 启动开发服务器

```bash
npm run dev
```

打开 `http://localhost:5173`。

## 部署到 Vercel

1. 把代码推到 GitHub
2. 进入 [vercel.com](https://vercel.com) → Import Project → 选择该仓库
3. 在 **Environment Variables** 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 部署。完成后会得到 `https://xxx.vercel.app`

> 也可以用 Netlify / Cloudflare Pages，配置相同。

## 使用流程

### 1. 添加子任务

进入「任务」页 → 点击 + 添加：
- **大类**：8 个预设
- **任务名称**：如"现代汉语教程"
- **总量**：300（页）
- **速度**：每 2 小时看 1 页 → 数量=1，耗时=2
- **截止日期**：6 月 30 日

### 2. 系统自动规划

提交后：
- 计算剩余总时长 = 300 页 × 2h/页 = 600h
- 按今天到 6/30 的天数平均分摊
- 每天大约 8h，分配到日历和甘特图

### 3. 更新进度

- 在「任务」列表或在「今日」点击 +/− 按钮直接调整完成量
- 系统自动重算后续计划

### 4. 处理超额

如果某天任务超出可用时间，日历上会显示 ⚠️：
- 提高当天可用时间
- 延长当天所有任务的截止日期
- 暂停某任务

## 数据模型

- `categories` — 8 大类（种子数据）
- `sub_tasks` — 子任务
- `daily_settings` — 每日可用时间
- `daily_plan_entries` — 每日计划（planner 自动写入的缓存）
- `progress_logs` — 进度历史

## 目录结构

```
src/
├── components/
│   ├── calendar/   # 月历 + 日详情抽屉 + 超额对话框
│   ├── gantt/      # 甘特图
│   ├── layout/     # 顶部导航 + 视图切换
│   ├── tasks/      # 子任务表单、列表、进度更新
│   └── ui/         # 通用 UI（Button、Input、Modal、ProgressBar）
├── hooks/          # React Query 数据 hooks
├── lib/            # supabase 客户端、planner 算法、types
├── pages/          # DashboardPage / TasksPage / SettingsPage
├── store/          # Zustand UI store
├── App.tsx
└── main.tsx
supabase/
└── migrations/
    └── 0001_init.sql
```

## Roadmap

- [ ] 暗色模式完善
- [ ] 移动端甘特图自适应
- [ ] 进度统计图表（按周/月）
- [ ] 任务模板（快速创建同类任务）
- [ ] 番茄钟集成

## License

MIT
