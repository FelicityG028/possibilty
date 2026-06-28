# Supabase 部署步骤

1. 注册 [supabase.com](https://supabase.com)（免费 tier 即可）
2. 创建新项目，等待约 1 分钟
3. 进入项目 → 左侧 **SQL Editor** → **New query**
4. 复制 `migrations/0001_init.sql` 的全部内容，粘贴到编辑器，点击 **Run**
5. 进入 **Project Settings** → **API**，记录：
   - **Project URL** → 复制到 `.env.local` 的 `VITE_SUPABASE_URL`
   - **anon public key** → 复制到 `.env.local` 的 `VITE_SUPABASE_ANON_KEY`
6. 重启 `npm run dev` 即可

## 重新初始化（慎用）

如需清空数据重置：
```sql
TRUNCATE public.sub_tasks CASCADE;
TRUNCATE public.daily_plan_entries CASCADE;
TRUNCATE public.progress_logs CASCADE;
TRUNCATE public.daily_settings;
UPDATE public.default_settings SET available_hours = 6.0 WHERE id = 1;
```

## 行级安全（可选加固）

单用户场景默认关闭 RLS（anon key 拥有完整读写权限）。
如要严格隔离，可在每张表启用 RLS 并创建对应策略。详见 [Supabase 文档](https://supabase.com/docs/guides/auth/row-level-security)。
